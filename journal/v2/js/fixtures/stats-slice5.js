export const SLICE5_STAGE = "stage-s5";
export const OTHER_STAGE = "stage-other";

export const SLICE5_TRADES = [
  { id: "t1", stageId: SLICE5_STAGE, context: "BACKTEST", asset: "EURUSD", direction: "LONG", strategy: "RED", variant: null, session: "LONDON", lifecycle: "CLOSED", result: "WIN", netPnl: 30, entry: 1.10, initialSL: 1.09, exit: 1.12, rrRealized: 2, hasPartials: false, closedAt: "2026-01-02T10:00:00.000Z", openedAt: "2026-01-02T09:00:00.000Z" },
  { id: "t2", stageId: SLICE5_STAGE, context: "BACKTEST", asset: "EURUSD", direction: "LONG", strategy: "RED", variant: null, session: "LONDON", lifecycle: "CLOSED", result: "LOSS", netPnl: -10, entry: 1.10, initialSL: 1.09, exit: 1.09, rrRealized: -1, hasPartials: false, closedAt: "2026-01-03T10:00:00.000Z", openedAt: "2026-01-03T09:00:00.000Z" },
  { id: "t3", stageId: SLICE5_STAGE, context: "BACKTEST", asset: "EURUSD", direction: "LONG", strategy: "RED", variant: null, session: "NEW_YORK", lifecycle: "CLOSED", result: "BE", netPnl: 0, entry: 1.10, initialSL: 1.09, exit: 1.10, rrRealized: 0, hasPartials: false, closedAt: "2026-01-04T10:00:00.000Z", openedAt: "2026-01-04T09:00:00.000Z" },
  { id: "t4", stageId: SLICE5_STAGE, context: "BACKTEST", asset: "EURUSD", direction: "SHORT", strategy: "UNCLASSIFIED", variant: null, session: "TOKYO", lifecycle: "CLOSED", result: "WIN", netPnl: 20, entry: 1.10, initialSL: null, exit: 1.08, rrRealized: null, hasPartials: false, closedAt: "2026-01-05T10:00:00.000Z", openedAt: "2026-01-05T09:00:00.000Z" },
  { id: "t5", stageId: SLICE5_STAGE, context: "BACKTEST", asset: "EURUSD", direction: "LONG", strategy: "BLUE", variant: "BLUE_A", session: "LONDON", lifecycle: "CLOSED", result: "WIN", netPnl: 15, entry: 1.10, initialSL: 1.09, exit: 1.115, rrRealized: 1.5, hasPartials: false, closedAt: "2026-01-06T10:00:00.000Z", openedAt: "2026-01-06T09:00:00.000Z" },
  { id: "t6", stageId: SLICE5_STAGE, context: "BACKTEST", asset: "NZDUSD", direction: "LONG", strategy: "RED", variant: null, session: "LONDON", lifecycle: "CLOSED", result: "LOSS", netPnl: -5, entry: 0.60, initialSL: 0.59, exit: 0.59, rrRealized: -1, hasPartials: false, closedAt: "2026-01-07T10:00:00.000Z", openedAt: "2026-01-07T09:00:00.000Z" },
  { id: "t7", stageId: SLICE5_STAGE, context: "BACKTEST", asset: "EURUSD", direction: "LONG", strategy: "RED", variant: null, session: "LONDON", lifecycle: "OPEN", result: null, netPnl: null, entry: 1.10, initialSL: 1.09, exit: null, rrRealized: null, hasPartials: false, closedAt: null, openedAt: "2026-01-08T09:00:00.000Z" },
  { id: "t8", stageId: SLICE5_STAGE, context: "BACKTEST", asset: "EURUSD", direction: "LONG", strategy: "RED", variant: null, session: "LONDON", lifecycle: "VOID", result: "LOSS", netPnl: -99, entry: 1.10, initialSL: 1.09, exit: 1.09, rrRealized: -1, hasPartials: false, closedAt: "2026-01-08T10:00:00.000Z", openedAt: "2026-01-08T09:00:00.000Z", voidReason: "TEST", voidedAt: "2026-01-08T11:00:00.000Z" },
  { id: "t9", stageId: SLICE5_STAGE, context: "BACKTEST", asset: "EURUSD", direction: "LONG", strategy: "RED", variant: null, session: "LONDON", lifecycle: "CLOSED", result: "WIN", netPnl: 40, entry: 1.10, initialSL: 1.09, exit: 1.13, rrRealized: 3, hasPartials: true, management: "parcial TP1, mismo trade", closedAt: "2026-01-09T10:00:00.000Z", openedAt: "2026-01-09T09:00:00.000Z" },
  { id: "t10", stageId: SLICE5_STAGE, context: "LIVE", asset: "EURUSD", direction: "LONG", strategy: "RED", variant: null, session: "LONDON", lifecycle: "CLOSED", result: "WIN", netPnl: 1000, accountId: "acc-1", entry: 1.10, initialSL: 1.09, exit: 1.12, rrRealized: 2, hasPartials: false, closedAt: "2026-01-09T12:00:00.000Z", openedAt: "2026-01-09T11:00:00.000Z" },
  { id: "t11", stageId: OTHER_STAGE, context: "BACKTEST", asset: "EURUSD", direction: "LONG", strategy: "RED", variant: null, session: "LONDON", lifecycle: "CLOSED", result: "WIN", netPnl: 8, entry: 1.10, initialSL: 1.09, exit: 1.11, rrRealized: 1, hasPartials: false, closedAt: "2026-01-10T10:00:00.000Z", openedAt: "2026-01-10T09:00:00.000Z" },
];

export const EXPECTED_ALL = {
  nClosed: 7, nWins: 4, nLosses: 2, nBe: 1, nDecided: 6,
  winRate: 4 / 6, netPnl: 90, profitFactorUsd: 105 / 15, expectancyUsd: 90 / 7,
  nR: 5, expectancyR: 1.5 / 5, maxDrawdown: 10, maxConsecWins: 2, maxConsecLosses: 1,
};

export const EXPECTED_EURUSD = {
  nClosed: 6, nWins: 4, nLosses: 1, nBe: 1, winRate: 4 / 5, netPnl: 95, nR: 4, expectancyR: 2.5 / 4,
};

export const EXPECTED_RED = { nClosed: 5, nWins: 2, nLosses: 2, nBe: 1, winRate: 2 / 4, nR: 4 };
export const EXPECTED_UNCLASSIFIED = { nClosed: 1, nWins: 1, nLosses: 0, nBe: 0, winRate: 1, nR: 0, expectancyR: null };
