import { createId, nowIso } from "./ids.js";
import { Context, Lifecycle, Strategy, Style, BlueVariant, CloseType, TradeRecordSource } from "./enums.js";
import {
  assertTrade,
  assertTradeAccountPair,
  normalizeAsset,
  deriveResult,
  computeRrRealized,
  incompleteForR,
  parseRiskNum,
} from "./integrity.js";
import { getTrade, putTrade } from "../storage/repos/trades.js";
import { getSetup } from "../storage/repos/setups.js";
import { getAccount } from "../storage/repos/accounts.js";
import { lockSetupOnTrade } from "./setup.js";
import { SESSIONS } from "../config.js";

export const TRADE_JOURNAL_FIELDS = Object.freeze([
  "strategy",
  "style",
  "variant",
  "session",
  "initialSL",
  "tp",
  "rrPlanned",
  "management",
  "note",
  "hasPartials",
  "closeType",
  "riskPercent",
  "riskMoney",
]);

const JOURNAL_FIELD_SET = new Set(TRADE_JOURNAL_FIELDS);

function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function snapshotFromSetup(setup) {
  if (!setup) {
    return { strategy: Strategy.UNCLASSIFIED, style: null, variant: null };
  }
  return {
    strategy: setup.strategy || Strategy.UNCLASSIFIED,
    style: setup.style || null,
    variant: setup.variant || null,
  };
}

function deriveTrade(trade) {
  trade.hasPartials = trade.hasPartials === true;
  trade.incompleteForR = incompleteForR(trade);
  trade.rrRealized = computeRrRealized(trade);
  trade.costComplete = trade.commission != null && trade.swap != null;
  return trade;
}

function assertJournalPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("patch de journal requerido");
  }
  const keys = Object.keys(patch);
  if (!keys.length) throw new Error("patch de journal vacío");
  const banned = keys.filter((k) => !JOURNAL_FIELD_SET.has(k));
  if (banned.length) throw new Error("campo no editable: " + banned[0]);
}

function applyJournalField(next, field, raw) {
  if (field === "strategy") {
    if (!Object.values(Strategy).includes(raw)) throw new Error("strategy inválida");
    next.strategy = raw;
    return;
  }
  if (field === "style") {
    if (raw == null || raw === "") { next.style = null; return; }
    if (!Object.values(Style).includes(raw)) throw new Error("style inválido");
    next.style = raw;
    return;
  }
  if (field === "variant") {
    if (raw == null || raw === "") { next.variant = null; return; }
    if (!Object.values(BlueVariant).includes(raw)) throw new Error("variant inválida");
    next.variant = raw;
    return;
  }
  if (field === "session") {
    if (raw == null || raw === "") { next.session = null; return; }
    if (!SESSIONS.includes(raw)) throw new Error("session inválida");
    next.session = raw;
    return;
  }
  if (field === "initialSL") {
    const sl = numOrNull(raw);
    next.initialSL = sl;
    if (next.currentSL == null) next.currentSL = sl;
    return;
  }
  if (field === "tp") {
    next.tp = numOrNull(raw);
    return;
  }
  if (field === "rrPlanned") {
    next.rrPlanned = numOrNull(raw);
    return;
  }
  if (field === "management") {
    next.management = raw == null || raw === "" ? null : String(raw);
    return;
  }
  if (field === "note") {
    next.note = raw == null || raw === "" ? null : String(raw);
    return;
  }
  if (field === "hasPartials") {
    next.hasPartials = raw === true;
    return;
  }
  if (field === "closeType") {
    if (!Object.values(CloseType).includes(raw)) throw new Error("closeType inválido");
    next.closeType = raw;
    return;
  }
  if (field === "riskPercent") {
    next.riskPercent = parseRiskNum(raw);
    return;
  }
  if (field === "riskMoney") {
    next.riskMoney = parseRiskNum(raw);
  }
}

export async function enrichTrade(id, patch) {
  const current = await getTrade(id);
  if (!current) throw new Error("trade no existe");
  if (current.lifecycle === Lifecycle.VOID) throw new Error("VOID no se enriquece");
  if (current.lifecycle !== Lifecycle.OPEN && current.lifecycle !== Lifecycle.CLOSED) {
    throw new Error("solo OPEN o CLOSED se enriquecen");
  }
  assertJournalPatch(patch);
  if (Object.prototype.hasOwnProperty.call(patch, "closeType") && current.lifecycle !== Lifecycle.CLOSED) {
    throw new Error("closeType solo en CLOSED");
  }
  const next = {
    ...current,
    id: current.id,
    stageId: current.stageId,
    accountId: current.accountId,
    recordSource: current.recordSource,
    sourceRef: current.sourceRef,
    brokerSymbol: current.brokerSymbol,
    createdAt: current.createdAt,
    importBatchId: current.importBatchId,
    setupId: current.setupId,
    deskSignalId: current.deskSignalId,
    context: current.context,
    asset: current.asset,
    direction: current.direction,
    entry: current.entry,
    exit: current.exit,
    openedAt: current.openedAt,
    closedAt: current.closedAt,
    netPnl: current.netPnl,
    result: current.result,
    lifecycle: current.lifecycle,
    lots: current.lots,
    commission: current.commission,
    swap: current.swap,
  };
  for (const field of TRADE_JOURNAL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      applyJournalField(next, field, patch[field]);
    }
  }
  if (next.lifecycle === Lifecycle.CLOSED && Object.prototype.hasOwnProperty.call(patch, "closeType")) {
    next.result = deriveResult(next.closeType, next.netPnl, next.closeType === CloseType.BE);
  }
  const derived = deriveTrade({ ...next, updatedAt: nowIso() });
  assertTrade(derived);
  await putTrade(derived);
  return derived;
}

export async function createClosedTrade(input, stageId) {
  if (!input) throw new Error("input requerido");
  let setup = null;
  if (input.setupId) {
    setup = await getSetup(input.setupId);
    if (!setup) throw new Error("setup no existe");
  }
  const snap = snapshotFromSetup(setup);
  const now = nowIso();
  const context = input.context || (setup && setup.context) || Context.BACKTEST;
  let account = null;
  let accountId = null;
  if (context === Context.BACKTEST) {
    accountId = null;
  } else {
    if (!input.accountId) throw new Error("accountId requerido fuera de BACKTEST");
    account = await getAccount(input.accountId);
    if (!account) throw new Error("account no existe");
    accountId = account.id;
  }
  const netPnl = numOrNull(input.netPnl);
  const closeType = input.closeType || CloseType.UNKNOWN;
  if (!Object.values(CloseType).includes(closeType)) throw new Error("closeType inválido");
  const result = deriveResult(closeType, netPnl, closeType === CloseType.BE || input.declaredBe === true);
  const sl = numOrNull(input.initialSL);
  let strategy = snap.strategy;
  if (input.strategy != null && input.strategy !== "") {
    if (!Object.values(Strategy).includes(input.strategy)) throw new Error("strategy inválida");
    strategy = input.strategy;
  }
  let style = snap.style;
  if (Object.prototype.hasOwnProperty.call(input, "style")) {
    if (input.style == null || input.style === "") style = null;
    else if (!Object.values(Style).includes(input.style)) throw new Error("style inválido");
    else style = input.style;
  }
  let variant = snap.variant;
  if (Object.prototype.hasOwnProperty.call(input, "variant")) {
    if (input.variant == null || input.variant === "") variant = null;
    else if (!Object.values(BlueVariant).includes(input.variant)) throw new Error("variant inválida");
    else variant = input.variant;
  }
  const trade = deriveTrade({
    id: createId(),
    stageId,
    recordSource: TradeRecordSource.MANUAL,
    asset: normalizeAsset(input.asset || (setup && setup.asset)),
    brokerSymbol: input.brokerSymbol ? String(input.brokerSymbol).trim() : null,
    context,
    direction: input.direction || (setup && setup.direction),
    accountId,
    openedAt: input.openedAt || now,
    entry: numOrNull(input.entry),
    lifecycle: Lifecycle.CLOSED,
    initialSL: sl,
    currentSL: sl,
    tp: numOrNull(input.tp),
    lots: numOrNull(input.lots),
    setupId: setup ? setup.id : null,
    deskSignalId: null,
    session: (setup && setup.session) || input.session || null,
    closedAt: input.closedAt || now,
    exit: numOrNull(input.exit),
    closeType,
    commission: numOrNull(input.commission),
    swap: numOrNull(input.swap),
    netPnl,
    result,
    management: input.management || null,
    hasPartials: input.hasPartials === true,
    executionQuality: input.executionQuality || null,
    note: input.note || null,
    importBatchId: null,
    sourceRef: input.sourceRef || null,
    strategy,
    style,
    variant,
    rrPlanned: input.rrPlanned != null ? numOrNull(input.rrPlanned) : (setup ? setup.plannedRr : null),
    riskPercent: parseRiskNum(input.riskPercent),
    riskMoney: parseRiskNum(input.riskMoney),
    rrRealized: null,
    voidedAt: null,
    voidReason: null,
    createdAt: now,
    updatedAt: now,
  });
  assertTrade(trade);
  assertTradeAccountPair(trade, account);
  await putTrade(trade);
  if (trade.setupId && trade.lifecycle !== Lifecycle.VOID) {
    await lockSetupOnTrade(trade.setupId);
  }
  return trade;
}
