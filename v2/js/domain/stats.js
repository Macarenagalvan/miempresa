import { Context, Lifecycle, Result, Disposition, Resolution } from "./enums.js";
import { computeRrRealized, hasPartialsRecorded, isDeskResolved, normalizeAsset, universeContexts } from "./integrity.js";
import { filterSignals } from "./signal.js";

export function realizedR(trade) {
  if (!trade || trade.lifecycle !== Lifecycle.CLOSED) return null;
  if (hasPartialsRecorded(trade)) return null;
  if (trade.rrRealized != null && trade.rrRealized !== "" && Number.isFinite(Number(trade.rrRealized))) {
    return Number(trade.rrRealized);
  }
  return computeRrRealized(trade);
}

export function filterTrades(trades, filters = {}) {
  const asset = filters.asset ? normalizeAsset(filters.asset) : "";
  const from = filters.from || "";
  const to = filters.to || "";
  return (trades || []).filter((t) => {
    if (filters.stageId && t.stageId !== filters.stageId) return false;
    if (filters.universe) {
      const allowed = universeContexts(filters.universe);
      if (allowed && !allowed.includes(t.context)) return false;
    }
    if (filters.context && t.context !== filters.context) return false;
    if (filters.accountId && t.accountId !== filters.accountId) return false;
    if (filters.accountIds && !filters.accountIds.includes(t.accountId)) return false;
    if (!filters.includeVoid && t.lifecycle === Lifecycle.VOID) return false;
    if (filters.lifecycle && t.lifecycle !== filters.lifecycle) return false;
    if (asset && normalizeAsset(t.asset) !== asset) return false;
    if (filters.strategy && t.strategy !== filters.strategy) return false;
    if (filters.variant && t.variant !== filters.variant) return false;
    if (filters.direction && t.direction !== filters.direction) return false;
    if (filters.session && t.session !== filters.session) return false;
    if (from || to) {
      const day = (t.closedAt || t.openedAt || "").slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
    }
    return true;
  });
}

function mean(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function streaks(closed) {
  const ordered = closed.slice().sort((a, b) => {
    const da = a.closedAt || a.openedAt || "";
    const db = b.closedAt || b.openedAt || "";
    if (da !== db) return da < db ? -1 : 1;
    return String(a.id) < String(b.id) ? -1 : 1;
  });
  let maxW = 0;
  let maxL = 0;
  let curW = 0;
  let curL = 0;
  for (const t of ordered) {
    if (t.result === Result.BE) continue;
    if (t.result === Result.WIN) {
      curW += 1;
      curL = 0;
      if (curW > maxW) maxW = curW;
    } else if (t.result === Result.LOSS) {
      curL += 1;
      curW = 0;
      if (curL > maxL) maxL = curL;
    }
  }
  return { maxConsecWins: maxW, maxConsecLosses: maxL };
}

function drawdown(moneyOrdered) {
  let curve = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of moneyOrdered) {
    curve += Number(t.netPnl);
    if (curve > peak) peak = curve;
    const dd = peak - curve;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

export function compute(trades, filters = {}) {
  const applied = {
    universe: filters.universe || null,
    context: filters.context || (filters.universe ? null : Context.BACKTEST),
    accountId: filters.accountId || null,
    accountIds: filters.accountIds || null,
    stageId: filters.stageId || null,
    asset: filters.asset || null,
    strategy: filters.strategy || null,
    variant: filters.variant || null,
    direction: filters.direction || null,
    session: filters.session || null,
    from: filters.from || null,
    to: filters.to || null,
  };
  const scoped = filterTrades(trades, { ...applied, includeVoid: false });
  const closed = scoped.filter((t) => (
    t.lifecycle === Lifecycle.CLOSED
    && (t.result === Result.WIN || t.result === Result.LOSS || t.result === Result.BE)
  ));
  const decided = closed.filter((t) => t.result === Result.WIN || t.result === Result.LOSS);
  const wins = closed.filter((t) => t.result === Result.WIN);
  const losses = closed.filter((t) => t.result === Result.LOSS);
  const money = closed.filter((t) => Number.isFinite(Number(t.netPnl)));
  const rRows = closed
    .map((t) => ({ r: realizedR(t) }))
    .filter((row) => row.r != null && Number.isFinite(row.r));

  const nClosed = closed.length;
  const nDecided = decided.length;
  const nMoney = money.length;
  const nR = rRows.length;
  const pnls = money.map((t) => Number(t.netPnl));
  const grossProfit = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0);
  let profitFactorUsd = null;
  if (grossLoss === 0 && grossProfit > 0) profitFactorUsd = Number.POSITIVE_INFINITY;
  else if (grossLoss === 0) profitFactorUsd = null;
  else profitFactorUsd = grossProfit / Math.abs(grossLoss);

  const moneyOrdered = money.slice().sort((a, b) => {
    const da = a.closedAt || a.openedAt || "";
    const db = b.closedAt || b.openedAt || "";
    if (da !== db) return da < db ? -1 : 1;
    return String(a.id) < String(b.id) ? -1 : 1;
  });
  const { maxConsecWins, maxConsecLosses } = streaks(closed);

  return {
    filters: applied,
    nClosed,
    nWins: wins.length,
    nLosses: losses.length,
    nBe: closed.filter((t) => t.result === Result.BE).length,
    nDecided,
    nMoney,
    nR,
    winRate: nDecided ? wins.length / nDecided : null,
    netPnl: nMoney ? pnls.reduce((a, b) => a + b, 0) : null,
    profitFactorUsd,
    expectancyUsd: nMoney ? mean(pnls) : null,
    expectancyR: nR ? mean(rRows.map((row) => row.r)) : null,
    maxDrawdown: nMoney ? drawdown(moneyOrdered) : null,
    maxConsecWins: nClosed ? maxConsecWins : null,
    maxConsecLosses: nClosed ? maxConsecLosses : null,
  };
}

export function computeDesk(signals, filters = {}) {
  const applied = {
    universe: "DESK",
    stageId: filters.stageId || null,
    asset: filters.asset || null,
    direction: filters.direction || null,
    disposition: filters.disposition || null,
    resolution: filters.resolution || null,
    from: filters.from || null,
    to: filters.to || null,
  };
  const scoped = filterSignals(signals, applied);
  const n = scoped.length;
  const nOpen = scoped.filter((s) => s.resolution === Resolution.OPEN).length;
  const nTp = scoped.filter((s) => s.resolution === Resolution.TP).length;
  const nSl = scoped.filter((s) => s.resolution === Resolution.SL).length;
  const nMissed = scoped.filter((s) => s.resolution === Resolution.MISSED).length;
  const nResolved = scoped.filter((s) => isDeskResolved(s.resolution)).length;
  const nTaken = scoped.filter((s) => s.disposition === Disposition.TAKEN).length;
  const nIgnored = scoped.filter((s) => s.disposition === Disposition.IGNORED).length;
  const nSkipped = scoped.filter((s) => s.disposition === Disposition.SKIPPED_OPEN_POSITION).length;
  const nStale = scoped.filter((s) => s.disposition === Disposition.STALE).length;
  const nNone = scoped.filter((s) => s.disposition === Disposition.NONE).length;
  const decided = nTaken + nIgnored;
  const hitDen = nTp + nSl;
  return {
    filters: applied,
    printed: n,
    nOpen,
    nTp,
    nSl,
    nMissed,
    nResolved,
    nTaken,
    nIgnored,
    nSkipped,
    nStale,
    nNone,
    resolutionRate: n ? nResolved / n : null,
    hitRate: hitDen ? nTp / hitDen : null,
    takeRate: decided ? nTaken / decided : null,
    skipRate: n ? nSkipped / n : null,
  };
}
