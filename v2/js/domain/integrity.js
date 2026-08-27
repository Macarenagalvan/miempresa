import { META_ID, JOURNAL_EDITION, SCHEMA_VERSION } from "../config.js";
import {
  StageStatus,
  Context,
  Direction,
  Strategy,
  SetupStatus,
  BlueVariant,
  Style,
  ValidationMethod,
  Verdict,
  SetupQuality,
  Lifecycle,
  Result,
  CloseType,
  VoidReason,
} from "./enums.js";

export function assertMeta(meta) {
  if (!meta || meta.id !== META_ID) throw new Error("meta.id debe ser singleton");
  if (meta.journalEdition !== JOURNAL_EDITION) throw new Error("journalEdition inválido");
  if (meta.schemaVersion !== SCHEMA_VERSION) throw new Error("schemaVersion inválido");
  if (!meta.activeStageId) throw new Error("meta.activeStageId requerido");
}

export function assertStage(stage) {
  if (!stage || !stage.id) throw new Error("stage.id requerido");
  if (!stage.name) throw new Error("stage.name requerido");
  if (stage.status !== StageStatus.ACTIVE && stage.status !== StageStatus.ARCHIVED) {
    throw new Error("stage.status inválido");
  }
}

export function assertSingleActive(stages) {
  const active = stages.filter((s) => s.status === StageStatus.ACTIVE);
  if (active.length !== 1) throw new Error("debe existir exactamente una Stage ACTIVE");
}

export function normalizeAsset(raw) {
  if (raw == null) return "";
  const value = String(raw).trim().toUpperCase().replace(/\s+/g, "");
  if (value === "S&P500" || value === "SPX" || value === "US500") return "SP500";
  return value;
}

export function assertObservation(obs) {
  if (!obs || !obs.id) throw new Error("observation.id requerido");
  if (!obs.stageId) throw new Error("observation.stageId requerido");
  const asset = normalizeAsset(obs.asset);
  if (!asset) throw new Error("asset requerido");
  if (!obs.note || !String(obs.note).trim()) throw new Error("note requerido");
  if (!obs.date || !/^\d{4}-\d{2}-\d{2}$/.test(obs.date)) throw new Error("date inválida");
  if (obs.session && !["SYDNEY", "TOKYO", "LONDON", "NEW_YORK"].includes(obs.session)) {
    throw new Error("session inválida");
  }
}

export function computePlannedRr(direction, entry, sl, tp) {
  const e = Number(entry);
  const s = Number(sl);
  const t = Number(tp);
  if (![e, s, t].every(Number.isFinite)) return null;
  if (direction === Direction.LONG) {
    const risk = e - s;
    if (risk <= 0) return null;
    return (t - e) / risk;
  }
  if (direction === Direction.SHORT) {
    const risk = s - e;
    if (risk <= 0) return null;
    return (e - t) / risk;
  }
  return null;
}

export function checklistScore(items) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  const done = list.filter((i) => i && i.done).length;
  return { done, total, pct: total ? done / total : 0 };
}

const CONTEXTS = Object.values(Context);
const DIRECTIONS = Object.values(Direction);
const STRATEGIES = Object.values(Strategy);
const STATUSES = Object.values(SetupStatus);

export function assertSetup(setup) {
  if (!setup || !setup.id) throw new Error("setup.id requerido");
  if (!setup.stageId) throw new Error("setup.stageId requerido");
  if (!normalizeAsset(setup.asset)) throw new Error("asset requerido");
  if (!CONTEXTS.includes(setup.context)) throw new Error("context requerido");
  if (!DIRECTIONS.includes(setup.direction)) throw new Error("direction requerido");
  if (!STRATEGIES.includes(setup.strategy)) throw new Error("strategy inválida");
  if (!STATUSES.includes(setup.status)) throw new Error("status inválido");
  if (setup.variant && !Object.values(BlueVariant).includes(setup.variant)) {
    throw new Error("variant inválida");
  }
  if (setup.variant && setup.strategy !== Strategy.BLUE) {
    throw new Error("variant solo si strategy=BLUE");
  }
  if (setup.style && !Object.values(Style).includes(setup.style)) throw new Error("style inválido");
  if (setup.validationMethod && !Object.values(ValidationMethod).includes(setup.validationMethod)) {
    throw new Error("validationMethod inválido");
  }
  if (setup.verdict && !Object.values(Verdict).includes(setup.verdict)) throw new Error("verdict inválido");
  if (setup.setupQuality && !Object.values(SetupQuality).includes(setup.setupQuality)) {
    throw new Error("setupQuality inválido");
  }
}

export function assertUnlocked(setup) {
  if (setup.validationLockedAt) throw new Error("setup congelado: snapshot no se reescribe");
}

export function deriveResult(closeType, netPnl, declaredBe) {
  if (declaredBe || closeType === CloseType.BE) return Result.BE;
  const pnl = Number(netPnl);
  if (!Number.isFinite(pnl)) throw new Error("netPnl requerido para cerrar");
  if (pnl > 0) return Result.WIN;
  if (pnl < 0) return Result.LOSS;
  return Result.BE;
}

function finiteNum(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function hasPartialsRecorded(trade) {
  return Boolean(trade && trade.hasPartials === true);
}

export function computeRrRealized(trade) {
  if (!trade || trade.lifecycle !== Lifecycle.CLOSED) return null;
  if (hasPartialsRecorded(trade)) return null;
  const entry = finiteNum(trade.entry);
  const sl = finiteNum(trade.initialSL);
  const exit = finiteNum(trade.exit);
  if (entry == null || sl == null || exit == null) return null;
  if (entry === sl) return null;
  const risk = Math.abs(entry - sl);
  if (risk === 0) return null;
  const move = trade.direction === Direction.LONG ? exit - entry : entry - exit;
  return move / risk;
}

export function incompleteForR(trade) {
  const entry = finiteNum(trade.entry);
  const sl = finiteNum(trade.initialSL);
  return entry == null || sl == null || entry === sl;
}

export function assertTrade(trade) {
  if (!trade || !trade.id) throw new Error("trade.id requerido");
  if (!trade.stageId) throw new Error("trade.stageId requerido");
  if (!normalizeAsset(trade.asset)) throw new Error("asset requerido");
  if (!CONTEXTS.includes(trade.context)) throw new Error("context requerido");
  if (!DIRECTIONS.includes(trade.direction)) throw new Error("direction requerido");
  if (!Number.isFinite(Number(trade.entry))) throw new Error("entry requerido");
  if (!Object.values(Lifecycle).includes(trade.lifecycle)) throw new Error("lifecycle inválido");
  if (trade.context === Context.BACKTEST) {
    if (trade.accountId != null) throw new Error("BACKTEST no usa accountId");
  } else if (!trade.accountId) {
    throw new Error("accountId requerido fuera de BACKTEST");
  }
  if (trade.lifecycle === Lifecycle.OPEN) {
    if (trade.result != null || trade.closedAt != null) throw new Error("OPEN no lleva result/closedAt");
  }
  if (trade.lifecycle === Lifecycle.CLOSED) {
    if (!Number.isFinite(Number(trade.exit))) throw new Error("exit requerido");
    if (!trade.closedAt) throw new Error("closedAt requerido");
    if (!Number.isFinite(Number(trade.netPnl))) throw new Error("netPnl requerido");
    if (!Object.values(Result).includes(trade.result)) throw new Error("result inválido");
  }
  if (trade.lifecycle === Lifecycle.VOID) {
    if (!trade.voidedAt || !trade.voidReason) throw new Error("VOID requiere voidedAt y voidReason");
    if (!Object.values(VoidReason).includes(trade.voidReason)) throw new Error("voidReason inválido");
  }
}
