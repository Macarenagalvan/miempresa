import { createId, nowIso } from "./ids.js";
import { Context, Lifecycle, Strategy } from "./enums.js";
import {
  assertTrade,
  assertTradeAccountPair,
  normalizeAsset,
  deriveResult,
  computeRrRealized,
  incompleteForR,
} from "./integrity.js";
import { getTrade, putTrade, listTrades } from "../storage/repos/trades.js";
import { getSetup } from "../storage/repos/setups.js";
import { getAccount } from "../storage/repos/accounts.js";
import { lockSetupOnTrade } from "./setup.js";

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
    recordSource: "MANUAL",
    asset: normalizeAsset(input.asset || (setup && setup.asset)),
    brokerSymbol: input.brokerSymbol ? String(input.brokerSymbol).trim() : null,
    context,
    direction: input.direction || (setup && setup.direction),
    accountId,
    openedAt: input.openedAt || now,
    entry: numOrNull(input.entry),
    lifecycle: Lifecycle.OPEN,
    initialSL: sl,
    currentSL: sl,
    tp: numOrNull(input.tp),
    lots: numOrNull(input.lots),
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
    strategy: snap.strategy,
    style: snap.style,
    variant: snap.variant,
    rrPlanned: setup ? setup.plannedRr : null,
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

export async function closeTrade(id, input) {
  const current = await getTrade(id);
  if (!current) throw new Error("trade no existe");
  if (current.lifecycle !== Lifecycle.OPEN) throw new Error("solo se cierra un OPEN");
  const netPnl = numOrNull(input.netPnl);
  const result = deriveResult(input.closeType, netPnl, input.declaredBe);
  const next = deriveTrade({
    ...current,
    lifecycle: Lifecycle.CLOSED,
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
