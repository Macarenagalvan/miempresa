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
