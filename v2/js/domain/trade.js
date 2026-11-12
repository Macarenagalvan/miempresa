import { createId, nowIso } from "./ids.js";
import { assertExecution } from "./execution.js";
import { applyJournalPatch } from "./trade-journal.js";
import { withStores, requestToPromise } from "../storage/db.js";
import { STORES } from "../config.js";
import { Context, Lifecycle, Strategy, TradeRecordSource } from "./enums.js";
import {
  assertTrade,
  assertTradeAccountPair,
  normalizeAsset,
  deriveResult,
  computeRrRealized,
  incompleteForR,
  parseRiskNum,
  parseLots,
} from "./integrity.js";
import { getTrade, putTrade, listTrades } from "../storage/repos/trades.js";
import { getSetup } from "../storage/repos/setups.js";
import { getAccount } from "../storage/repos/accounts.js";
import { lockSetupOnTrade } from "./setup.js";
import { parseMt5Csv, toTradeDraft, dedupKey } from "../adapters/mt5.js";

function numOrNull(v) {
  if (v == null || String(v).trim() === "") return null;
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

export async function createTrade(input, stageId) {
  let setup = null;
  if (input.setupId) {
    setup = await getSetup(input.setupId);
    if (!setup) throw new Error("setup no existe");
  }
  const snap = snapshotFromSetup(setup);
  const sl = numOrNull(input.initialSL);
  const now = nowIso();
  const context = input.context || (setup && setup.context) || Context.BACKTEST;
  assertExecution({ ...input, asset: input.asset || setup?.asset, direction: input.direction || setup?.direction,
    openedAt: input.openedAt || (context === Context.BACKTEST || input.isDraft ? null : now) }, { closed: false, draft: input.isDraft === true });
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
  const trade = deriveTrade({
    id: createId(),
    stageId,
    recordSource: TradeRecordSource.MANUAL,
    asset: normalizeAsset(input.asset || (setup && setup.asset)),
    brokerSymbol: input.brokerSymbol ? String(input.brokerSymbol).trim() : null,
    context,
    direction: input.direction || (setup && setup.direction),
    accountId,
    openedAt: input.openedAt || (input.isDraft === true || context === Context.BACKTEST ? null : now),
    entry: numOrNull(input.entry),
    isDraft: input.isDraft === true,
    draftExit: input.isDraft === true ? numOrNull(input.exit) : null,
    draftNetPnl: input.isDraft === true ? numOrNull(input.netPnl) : null,
    draftClosedAt: input.isDraft === true ? (input.closedAt || null) : null,
    draftCommission: input.isDraft === true ? numOrNull(input.commission) : null,
    draftSwap: input.isDraft === true ? numOrNull(input.swap) : null,
    draftCloseType: input.isDraft === true ? (input.closeType || null) : null,
    lifecycle: Lifecycle.OPEN,
    initialSL: sl,
    currentSL: sl,
    tp: numOrNull(input.tp),
    lots: parseLots(input.lots),
    setupId: setup ? setup.id : null,
    deskSignalId: null,
    session: (setup && setup.session) || input.session || null,
    closedAt: null,
    exit: null,
    closeType: null,
    commission: null,
    swap: null,
    netPnl: null,
    result: null,
    management: input.management || null,
    hasPartials: input.hasPartials === true,
    executionQuality: null,
    note: input.note || null,
    importBatchId: null,
    sourceRef: input.sourceRef || null,
    strategy: snap.strategy,
    style: snap.style,
    variant: snap.variant,
    rrPlanned: setup ? setup.plannedRr : null,
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

export async function updateOpenTrade(id, patch) {
  const current = await getTrade(id);
  if (!current) throw new Error("trade no existe");
  if (current.lifecycle !== Lifecycle.OPEN) throw new Error("solo un OPEN se edita así");
  const next = deriveTrade({
    ...current,
    ...patch,
    id: current.id,
    stageId: current.stageId,
    setupId: current.setupId,
    recordSource: current.recordSource,
    context: current.context,
    accountId: current.accountId,
    strategy: current.strategy,
    style: current.style,
    variant: current.variant,
    initialSL: current.initialSL,
    currentSL: patch.currentSL != null ? numOrNull(patch.currentSL) : current.currentSL,
    management: patch.management != null ? patch.management : current.management,
    hasPartials: patch.hasPartials != null ? patch.hasPartials === true : current.hasPartials === true,
    note: patch.note != null ? patch.note : current.note,
    tp: patch.tp != null ? numOrNull(patch.tp) : current.tp,
    lots: patch.lots != null ? numOrNull(patch.lots) : current.lots,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  });
  if (current.initialSL == null && patch.initialSL != null) {
    const sl = numOrNull(patch.initialSL);
    next.initialSL = sl;
    if (next.currentSL == null) next.currentSL = sl;
  }
  assertTrade(next);
  await putTrade(next);
  return next;
}

export async function updateDraftTrade(id, patch) {
  const current = await getTrade(id);
  if (!current || current.lifecycle !== Lifecycle.OPEN || current.isDraft !== true) throw new Error("borrador no encontrado");
  const next = deriveTrade({
    ...current,
    ...(current.context === Context.BACKTEST && current.sourceRef?.kind === "BACKTEST_JSON" ? {
      asset: patch.asset !== undefined ? normalizeAsset(patch.asset) : current.asset,
      direction: patch.direction !== undefined ? (patch.direction || null) : current.direction,
    } : {}),
    openedAt: patch.openedAt !== undefined ? patch.openedAt : current.openedAt,
    entry: patch.entry !== undefined ? numOrNull(patch.entry) : current.entry,
    draftExit: patch.exit !== undefined ? numOrNull(patch.exit) : current.draftExit,
    draftNetPnl: patch.netPnl !== undefined ? numOrNull(patch.netPnl) : current.draftNetPnl,
    draftClosedAt: patch.closedAt !== undefined ? patch.closedAt : current.draftClosedAt,
    initialSL: patch.initialSL !== undefined ? numOrNull(patch.initialSL) : current.initialSL,
    currentSL: patch.initialSL !== undefined ? numOrNull(patch.initialSL) : current.currentSL,
    tp: patch.tp !== undefined ? numOrNull(patch.tp) : current.tp,
    lots: patch.lots !== undefined ? parseLots(patch.lots) : current.lots,
    updatedAt: nowIso(),
  });
  assertTrade(next);
  await putTrade(next);
  return next;
}

export async function activateDraftTrade(id) {
  const current = await getTrade(id);
  if (!current || current.lifecycle !== Lifecycle.OPEN || !current.isDraft) throw new Error("borrador no encontrado");
  if (!current.openedAt) throw new Error("Completá la fecha de entrada antes de abrir la operación.");
  assertExecution(current, { closed: false });
  const next = deriveTrade({ ...current, isDraft: false, updatedAt: nowIso() });
  assertTrade(next);
  await putTrade(next);
  return next;
}

// One transaction preserves the original identity, notes, images and sync revision.
export async function completeDraftTrade(id, input, journal, target = "DRAFT") {
  if (!["DRAFT", "OPEN", "CLOSED"].includes(target)) throw new Error("Estado inválido.");
  const result = await withStores([STORES.trades, STORES.syncLedger], "readwrite", async tx => {
    const store = tx.objectStore(STORES.trades);
    const current = await requestToPromise(store.get(id));
    if (!current || current.lifecycle !== Lifecycle.OPEN || !current.isDraft) throw new Error("El borrador cambió. Volvé a abrirlo.");
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== current.updatedAt) throw new Error("El borrador cambió en otra pantalla. Volvé a abrirlo.");
    let next = applyJournalPatch(current, journal);
    for (const key of ["asset", "direction", "openedAt", "entry"]) {
      if (input[key] !== undefined) next[key] = key === "entry" ? numOrNull(input[key]) : input[key];
    }
    next.asset = normalizeAsset(next.asset);
    const execution = { ...next, initialSL: journal.initialSL ?? next.initialSL, tp: journal.tp ?? next.tp,
      entry: input.entry ?? next.entry, exit: input.exit, closedAt: input.closedAt, netPnl: input.netPnl };
    assertExecution(execution, { closed: target === "CLOSED", draft: target === "DRAFT" });
    next.isDraft = target === "DRAFT";
    next.lifecycle = target === "CLOSED" ? Lifecycle.CLOSED : Lifecycle.OPEN;
    if (target === "CLOSED") {
      next.exit = numOrNull(input.exit);
      next.closedAt = input.closedAt;
      next.netPnl = numOrNull(input.netPnl);
      next.closeType = current.draftCloseType || "UNKNOWN";
      next.commission = current.draftCommission ?? null;
      next.swap = current.draftSwap ?? null;
      next.result = deriveResult(next.closeType, next.netPnl, next.closeType === "BE");
    }
    next.draftExit = target !== "CLOSED" ? numOrNull(input.exit) : null;
    next.draftClosedAt = target !== "CLOSED" ? (input.closedAt || null) : null;
    next.draftNetPnl = target !== "CLOSED" ? numOrNull(input.netPnl) : null;
    if (target === "CLOSED") for (const key of ["draftCommission", "draftSwap", "draftCloseType"]) next[key] = null;
    next.updatedAt = nowIso();
    next = deriveTrade(next);
    assertTrade(next);
    const ledger = tx.objectStore(STORES.syncLedger);
    const ledgerId = STORES.trades + "::" + id;
    const old = await requestToPromise(ledger.get(ledgerId));
    store.put(next);
    ledger.put({ ...old, id: ledgerId, entityType: STORES.trades, entityId: id, cloudRevision: old?.cloudRevision || 0,
      dirty: true, tombstone: false, localChangedAt: next.updatedAt });
    return next;
  });
  import("../services/sync-engine.js").then(m => m.scheduleSync()).catch(() => {});
  return result;
}

export async function closeTrade(id, input) {
  const current = await getTrade(id);
  if (!current) throw new Error("trade no existe");
  if (current.lifecycle !== Lifecycle.OPEN) throw new Error("solo se cierra un OPEN");
  assertExecution({ ...current, ...input, openedAt: current.openedAt,
    closedAt: input.closedAt || (current.context === Context.BACKTEST ? null : nowIso()) });
  if (current.isDraft && !current.openedAt) throw new Error("Completá la fecha de entrada del borrador antes de cerrarlo.");
  if (current.openedAt && input.closedAt && new Date(input.closedAt) < new Date(current.openedAt)) {
    throw new Error("La fecha de cierre no puede ser anterior a la entrada.");
  }
  const netPnl = numOrNull(input.netPnl);
  const result = deriveResult(input.closeType, netPnl, input.declaredBe);
  const next = deriveTrade({
    ...current,
    lifecycle: Lifecycle.CLOSED,
    isDraft: false,
    draftExit: null,
    draftNetPnl: null,
    draftClosedAt: null,
    draftCommission: null,
    draftSwap: null,
    draftCloseType: null,
    exit: numOrNull(input.exit),
    closedAt: input.closedAt || nowIso(),
    netPnl,
    commission: numOrNull(input.commission),
    swap: numOrNull(input.swap),
    closeType: input.closeType || "UNKNOWN",
    result,
    management: input.management != null ? input.management : current.management,
    hasPartials: input.hasPartials != null ? input.hasPartials === true : current.hasPartials === true,
    executionQuality: input.executionQuality || current.executionQuality,
    updatedAt: nowIso(),
  });
  assertTrade(next);
  await putTrade(next);
  return next;
}

export async function voidTrade(id, reason) {
  const current = await getTrade(id);
  if (!current) throw new Error("trade no existe");
  if (current.lifecycle === Lifecycle.VOID) return current;
  const next = deriveTrade({
    ...current,
    lifecycle: Lifecycle.VOID,
    voidedAt: nowIso(),
    voidReason: reason,
    updatedAt: nowIso(),
  });
  assertTrade(next);
  await putTrade(next);
  return next;
}

export async function amendClosedTrade(id, patch) {
  const current = await getTrade(id);
  if (!current) throw new Error("trade no existe");
  if (current.lifecycle !== Lifecycle.CLOSED) throw new Error("solo se amenda un CLOSED");
  const netPnl = patch.netPnl != null ? numOrNull(patch.netPnl) : current.netPnl;
  const next = deriveTrade({
    ...current,
    netPnl,
    commission: patch.commission !== undefined ? numOrNull(patch.commission) : current.commission,
    swap: patch.swap !== undefined ? numOrNull(patch.swap) : current.swap,
    result: patch.netPnl != null
      ? deriveResult(current.closeType, netPnl, current.closeType === "BE")
      : current.result,
    updatedAt: nowIso(),
  });
  assertTrade(next);
  await putTrade(next);
  return next;
}

export async function findTradeByMt5Position(accountId, mt5Position) {
  const key = dedupKey(accountId, mt5Position);
  if (!key) return null;
  const all = await listTrades();
  return all.find((t) => (
    t.accountId === accountId
    && t.sourceRef
    && String(t.sourceRef.mt5Position) === String(mt5Position)
    && t.lifecycle !== Lifecycle.VOID
  )) || null;
}

async function enrichExistingMt5TradeFromDraft(existing, draft) {
  if (!existing || !draft) return { trade: existing, updated: false };
  if (existing.recordSource !== TradeRecordSource.MT5_EA) {
    return { trade: existing, updated: false };
  }

  const next = { ...existing };
  let changed = false;

  const fillNumberIfMissing = (field, raw, parser = numOrNull) => {
    if (next[field] != null) return;
    const value = parser(raw);
    if (value == null) return;
    next[field] = value;
    changed = true;
  };

  fillNumberIfMissing("initialSL", draft.initialSL);
  fillNumberIfMissing("currentSL", draft.currentSL != null ? draft.currentSL : draft.initialSL);
  fillNumberIfMissing("tp", draft.tp);
  fillNumberIfMissing("rrPlanned", draft.rrPlanned);
  fillNumberIfMissing("riskPercent", draft.riskPercent, parseRiskNum);
  fillNumberIfMissing("riskMoney", draft.riskMoney, parseRiskNum);

  if (!changed) return { trade: existing, updated: false };

  next.updatedAt = nowIso();
  deriveTrade(next);
  assertTrade(next);
  await putTrade(next);
  return { trade: next, updated: true };
}

export async function importClosedMt5Trade(draft, stageId) {
  if (!draft) throw new Error("draft MT5 requerido");
  if (draft.recordSource !== TradeRecordSource.MT5_EA) throw new Error("recordSource MT5_EA requerido");
  if (!draft.accountId) throw new Error("accountId requerido");
  const account = await getAccount(draft.accountId);
  if (!account) throw new Error("account no existe");
  const now = nowIso();
  const initialSL = numOrNull(draft.initialSL);
  const trade = deriveTrade({
    id: createId(),
    stageId,
    recordSource: TradeRecordSource.MT5_EA,
    asset: normalizeAsset(draft.asset),
    brokerSymbol: draft.brokerSymbol ? String(draft.brokerSymbol).trim() : null,
    context: draft.context,
    direction: draft.direction,
    accountId: account.id,
    openedAt: draft.openedAt,
    entry: numOrNull(draft.entry),
    lifecycle: Lifecycle.CLOSED,
    initialSL,
    currentSL: draft.currentSL != null ? numOrNull(draft.currentSL) : initialSL,
    tp: numOrNull(draft.tp),
    lots: numOrNull(draft.lots),
    setupId: null,
    deskSignalId: null,
    session: null,
    closedAt: draft.closedAt,
    exit: numOrNull(draft.exit),
    closeType: "UNKNOWN",
    commission: numOrNull(draft.commission),
    swap: numOrNull(draft.swap),
    netPnl: numOrNull(draft.netPnl),
    result: draft.result,
    management: null,
    hasPartials: draft.hasPartials === true,
    executionQuality: null,
    note: null,
    importBatchId: draft.importBatchId || null,
    sourceRef: draft.sourceRef || null,
    strategy: Strategy.UNCLASSIFIED,
    style: null,
    variant: null,
    rrPlanned: numOrNull(draft.rrPlanned),
    riskPercent: parseRiskNum(draft.riskPercent),
    riskMoney: parseRiskNum(draft.riskMoney),
    rrRealized: null,
    voidedAt: null,
    voidReason: null,
    createdAt: now,
    updatedAt: now,
  });
  assertTrade(trade);
  assertTradeAccountPair(trade, account);
  await putTrade(trade);
  return trade;
}

export async function previewMt5Csv(text, opts = {}) {
  if (!opts.accountId) throw new Error("accountId requerido");
  if (!opts.context) throw new Error("context de Account requerido");
  if (!opts.timeZone) throw new Error("timezone fuente requerido");
  const parsed = parseMt5Csv(text);
  const report = {
    accountId: opts.accountId,
    context: opts.context,
    timeZone: opts.timeZone,
    read: parsed.read,
    created: 0,
    duplicates: 0,
    invalid: parsed.invalid.length,
    unknownSymbols: 0,
    errors: parsed.invalid.slice(),
    drafts: [],
  };
  for (const row of parsed.rows) {
    const mapped = toTradeDraft(row.rec, opts);
    if (!mapped.ok) {
      if (mapped.code === "UNKNOWN_SYMBOL") report.unknownSymbols += 1;
      report.invalid += 1;
      report.errors.push({
        index: row.index,
        error: mapped.error,
        id: row.rec && row.rec.ID,
        brokerSymbol: mapped.brokerSymbol || (row.rec && row.rec.Activo),
      });
      continue;
    }
    const existing = await findTradeByMt5Position(opts.accountId, mapped.draft.sourceRef.mt5Position);
    if (existing) {
      report.duplicates += 1;
      continue;
    }
    report.drafts.push(mapped.draft);
    report.created += 1;
  }
  return report;
}

export async function syncMt5Csv(text, stageId, opts = {}) {
  if (!opts.accountId) throw new Error("accountId requerido");
  if (!opts.context) throw new Error("context de Account requerido");
  if (!opts.timeZone) throw new Error("timezone fuente requerido");
  const account = await getAccount(opts.accountId);
  if (!account) throw new Error("account no existe");
  if (account.context !== opts.context) {
    throw new Error("context incompatible con la Account");
  }
  const importBatchId = opts.importBatchId || createId();
  const parsed = parseMt5Csv(text);
  const report = {
    accountId: account.id,
    context: opts.context,
    timeZone: opts.timeZone,
    importBatchId,
    read: parsed.read,
    created: 0,
    duplicates: 0,
    enriched: 0,
    invalid: parsed.invalid.length,
    unknownSymbols: 0,
    errors: parsed.invalid.slice(),
  };
  for (const row of parsed.rows) {
    const mapped = toTradeDraft(row.rec, { ...opts, importBatchId });
    if (!mapped.ok) {
      if (mapped.code === "UNKNOWN_SYMBOL") report.unknownSymbols += 1;
      report.invalid += 1;
      report.errors.push({
        index: row.index,
        error: mapped.error,
        id: row.rec && row.rec.ID,
        brokerSymbol: mapped.brokerSymbol || (row.rec && row.rec.Activo),
      });
      continue;
    }
    const detail = opts.htmlDetails?.[mapped.draft.sourceRef.mt5Position];
    if (detail) {
      mapped.draft.commission = detail.commission;
      mapped.draft.swap = detail.swap;
      mapped.draft.sourceRef = {...mapped.draft.sourceRef, mt5AccountLogin: detail.sourceLogin, htmlEvidence: detail};
    }
    const existing = await findTradeByMt5Position(account.id, mapped.draft.sourceRef.mt5Position);
    if (existing) {
      report.duplicates += 1;
      const enriched = await enrichExistingMt5TradeFromDraft(existing, mapped.draft);
      if (enriched.updated) report.enriched += 1;
      continue;
    }
    await importClosedMt5Trade(mapped.draft, stageId);
    report.created += 1;
  }
  return report;
}

export async function listStageTrades(stageId, opts = {}) {
  const all = await listTrades();
  return all
    .filter((t) => t.stageId === stageId)
    .filter((t) => !opts.context || t.context === opts.context)
    .filter((t) => !opts.accountId || t.accountId === opts.accountId)
    .filter((t) => opts.includeVoid || t.lifecycle !== Lifecycle.VOID)
    .filter((t) => !opts.setupId || t.setupId === opts.setupId)
    .sort((a, b) => {
      const da = a.closedAt || a.openedAt || "";
      const db = b.closedAt || b.openedAt || "";
      return da < db ? 1 : -1;
    });
}

export { enrichTrade, createClosedTrade, TRADE_JOURNAL_FIELDS } from "./trade-journal.js";
