import { createId, nowIso } from "./ids.js";
import { Context, Lifecycle, Strategy, TradeRecordSource } from "./enums.js";
import {
  assertTrade,
  assertTradeAccountPair,
  normalizeAsset,
  deriveResult,
  computeRrRealized,
  incompleteForR,
  parseRiskNum,
} from "./integrity.js";
import { getTrade, putTrade, listTrades } from "../storage/repos/trades.js";
import { getSetup } from "../storage/repos/setups.js";
import { getAccount } from "../storage/repos/accounts.js";
import { lockSetupOnTrade } from "./setup.js";
import { parseMt5Csv, toTradeDraft, dedupKey } from "../adapters/mt5.js";

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
    recordSource: TradeRecordSource.MANUAL,
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
