import {
  JOURNAL_EDITION,
  SCHEMA_VERSION,
  BACKUP_PRODUCT,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  EXPORT_COLLECTIONS,
  META_ID,
} from "../js/config.js";
import { ensureJournalSeed } from "../js/domain/stage.js";
import { getMeta } from "../js/storage/repos/meta.js";
import { listStages } from "../js/storage/repos/stages.js";
import { dumpCollections, repoFor } from "../js/storage/repos/collections.js";
import { attachmentsRepo } from "../js/storage/repos/attachments.js";
import {
  buildExportPayload,
  classifyBackup,
  parseBackupText,
  validateBackup,
  previewBackupText,
  restoreBackup,
  applyRestoreTransaction,
  downloadCurrentBackup,
} from "../js/services/backup.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
  if (!cond) console.error("FAIL", name, detail);
}

const STAGE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const STAGE_ARCH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ACC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const CH = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OBS = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const SETUP = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const TRADE_LIVE = "ffffffff-ffff-4fff-8fff-fffffffffff1";
const TRADE_BT = "ffffffff-ffff-4fff-8fff-fffffffffff2";
const TRADE_VOID = "ffffffff-ffff-4fff-8fff-fffffffffff3";
const ASR = "99999999-9999-4999-8999-999999999991";
const SIG = "88888888-8888-4888-8888-888888888881";
const MOV = "77777777-7777-4777-8777-777777777771";
const PAY = "66666666-6666-4666-8666-666666666661";
const ATT = "55555555-5555-4555-8555-555555555551";
const STAGE_EMPTY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae0";

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

function emptyV2() {
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
    accounts: [], movements: [], observations: [], setups: [], trades: [],
    asrs: [], signals: [], challenges: [], payouts: [], attachments: [],
  };
}
