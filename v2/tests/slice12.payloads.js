import {
  JOURNAL_EDITION,
  SCHEMA_VERSION,
  BACKUP_PRODUCT,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  META_ID,
} from "../js/config.js";

export const STAGE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const STAGE_ARCH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
export const ACC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
export const CH = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
export const OBS = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
export const SETUP = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
export const TRADE_LIVE = "ffffffff-ffff-4fff-8fff-fffffffffff1";
export const TRADE_BT = "ffffffff-ffff-4fff-8fff-fffffffffff2";
export const TRADE_VOID = "ffffffff-ffff-4fff-8fff-fffffffffff3";
export const ASR = "99999999-9999-4999-8999-999999999991";
export const SIG = "88888888-8888-4888-8888-888888888881";
export const MOV = "77777777-7777-4777-8777-777777777771";
export const PAY = "66666666-6666-4666-8666-666666666661";
export const ATT = "55555555-5555-4555-8555-555555555551";
export const STAGE_EMPTY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae0";

function wrapMeta(stageId, extra = {}) {
  return {
    id: META_ID,
    schemaVersion: SCHEMA_VERSION,
    journalEdition: JOURNAL_EDITION,
    activeStageId: stageId,
    traderName: "Maca",
    createdAt: "2026-08-01T00:00:00.000Z",
    lastBackupAt: null,
    activeAccountId: extra.activeAccountId === undefined ? ACC : extra.activeAccountId,
    ...extra,
  };
}

export function emptyV2() {
  return {
    product: BACKUP_PRODUCT,
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    journalEdition: JOURNAL_EDITION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: "2026-08-28T12:00:00.000Z",
    meta: wrapMeta(STAGE_EMPTY, { activeAccountId: null, traderName: "" }),
    stages: [{
      id: STAGE_EMPTY,
      name: "V2 · vacío",
      status: "ACTIVE",
      startedAt: "2026-08-28T12:00:00.000Z",
      endedAt: null,
      resetReason: null,
      backupRef: null,
    }],
    accounts: [],
    movements: [],
    observations: [],
    setups: [],
    trades: [],
    asrs: [],
    signals: [],
    challenges: [],
    payouts: [],
    attachments: [],
  };
}

export function richV2() {
  return {
    product: BACKUP_PRODUCT,
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    journalEdition: JOURNAL_EDITION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: "2026-08-28T13:00:00.000Z",
    meta: wrapMeta(STAGE),
    stages: [
      {
        id: STAGE,
        name: "V2 · restore",
        status: "ACTIVE",
        startedAt: "2026-08-01T00:00:00.000Z",
        endedAt: null,
        resetReason: null,
        backupRef: null,
      },
      {
        id: STAGE_ARCH,
        name: "archivo",
        status: "ARCHIVED",
        startedAt: "2026-07-01T00:00:00.000Z",
        endedAt: "2026-07-31T00:00:00.000Z",
        resetReason: null,
        backupRef: null,
      },
    ],
    accounts: [{
      id: ACC,
      stageId: STAGE,
      name: "Live restore",
      context: "LIVE",
      currency: "EUR",
      status: "ACTIVE",
      initialAmount: 1000,
      challengeId: CH,
    }],
    movements: [{
      id: MOV,
      stageId: STAGE,
      accountId: ACC,
      type: "DEPOSIT",
      amount: 200,
      date: "2026-08-02",
    }],
    observations: [{
      id: OBS,
      stageId: STAGE,
      asset: "EURUSD",
      note: "obs restore",
      date: "2026-08-03",
      archived: true,
    }],
    setups: [{
      id: SETUP,
      stageId: STAGE,
      asset: "EURUSD",
      context: "LIVE",
      direction: "LONG",
      strategy: "UNCLASSIFIED",
      status: "WATCHING",
      observationId: OBS,
      deskSignalId: SIG,
    }],
    trades: [
      {
        id: TRADE_LIVE,
        stageId: STAGE,
        asset: "EURUSD",
        context: "LIVE",
        direction: "LONG",
        accountId: ACC,
        setupId: SETUP,
        deskSignalId: SIG,
        entry: 1.1,
        exit: 1.12,
        initialSL: 1.09,
        lifecycle: "CLOSED",
        result: "WIN",
        netPnl: 40,
        openedAt: "2026-08-04T08:00:00.000Z",
        closedAt: "2026-08-04T10:00:00.000Z",
        recordSource: "MT5_EA",
        sourceRef: { mt5Position: "9001", mt5TicketIn: "11", mt5TicketOut: "12" },
        importBatchId: "batch-mt5-12",
      },
      {
        id: TRADE_BT,
        stageId: STAGE,
        asset: "EURUSD",
        context: "BACKTEST",
        direction: "SHORT",
        accountId: null,
        entry: 1.2,
        lifecycle: "OPEN",
        openedAt: "2026-08-05T08:00:00.000Z",
      },
      {
        id: TRADE_VOID,
        stageId: STAGE,
        asset: "XAUUSD",
        context: "BACKTEST",
        direction: "LONG",
        accountId: null,
        entry: 2400,
        lifecycle: "VOID",
        voidedAt: "2026-08-06T08:00:00.000Z",
        voidReason: "TEST",
      },
    ],
    asrs: [{
      id: ASR,
      stageId: STAGE,
      tradeId: TRADE_LIVE,
      wouldDoSame: "YES",
      conclusion: "ok",
      date: "2026-08-04",
    }],
    signals: [{
      id: SIG,
      stageId: STAGE,
      asset: "EURUSD",
      direction: "LONG",
      printedAt: "2026-08-04T07:00:00.000Z",
      recordSource: "RGM_ADAPTER",
      disposition: "TAKEN",
      resolution: "TP",
      resolvedAt: "2026-08-04T10:00:00.000Z",
      context: "LIVE",
      setupId: SETUP,
      tradeId: TRADE_LIVE,
      sourceRef: { rgmSignalId: "rgm-12", rgmPrintAt: "2026-08-04T07:00:00.000Z" },
    }],
    challenges: [{
      id: CH,
      stageId: STAGE,
      firm: "Firm X",
      purchasedAt: "2026-08-01",
      size: 50000,
      cost: 300,
      currency: "EUR",
      status: "ACTIVE",
      accountId: ACC,
    }],
    payouts: [{
      id: PAY,
      stageId: STAGE,
      challengeId: CH,
      date: "2026-08-20",
      amount: 500,
      currency: "EUR",
      kind: "PAYOUT",
    }],
    attachments: [{
      id: ATT,
      entityType: "trade",
      entityId: TRADE_LIVE,
    }],
  };
}
