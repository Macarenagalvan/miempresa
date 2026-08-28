import {
  JOURNAL_EDITION,
  SCHEMA_VERSION,
  BACKUP_PRODUCT,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  EXPORT_COLLECTIONS,
  STORES,
} from "../config.js";
import { nowIso } from "../domain/ids.js";
import { getMeta, putMeta } from "../storage/repos/meta.js";
import { dumpCollections } from "../storage/repos/collections.js";
import { withStores } from "../storage/db.js";
import {
  assertMeta,
  assertStage,
  assertSingleActive,
  assertObservation,
  assertSetup,
  assertTrade,
  assertAsr,
  assertAccount,
  assertMovement,
  assertChallenge,
  assertPayout,
  assertDeskSignal,
  assertTradeAccountPair,
} from "../domain/integrity.js";
import { Context } from "../domain/enums.js";

const V1_MESSAGE = "Este archivo pertenece a Journal V1 y no puede restaurarse en Journal V2.";

export function backupCollectionNames() {
  return EXPORT_COLLECTIONS.slice();
}

export function restoreStoreNames() {
  return Object.values(STORES);
}

function emptyCounts() {
  const counts = {};
  for (const name of EXPORT_COLLECTIONS) counts[name] = 0;
  return counts;
}

function countOf(payload, name) {
  return Array.isArray(payload && payload[name]) ? payload[name].length : 0;
}

export function classifyBackup(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "unknown", reason: "formato desconocido" };
  }
  const edition = value.journalEdition;
  const format = value.format;
  const product = value.product;
  const looksV2 = edition === JOURNAL_EDITION
    || format === BACKUP_FORMAT
    || product === BACKUP_PRODUCT;
  if (looksV2) {
    const schema = Number(value.schemaVersion);
    const bver = value.backupVersion == null ? BACKUP_VERSION : Number(value.backupVersion);
    if ((Number.isFinite(schema) && schema > SCHEMA_VERSION)
      || (Number.isFinite(bver) && bver > BACKUP_VERSION)) {
      return { kind: "future", reason: "versión futura no soportada" };
    }
    return { kind: "v2", reason: "" };
  }
  const looksV1 = value.version === 3
    || edition === "v1"
    || Array.isArray(value.btcOps)
    || (Array.isArray(value.trades) && value.activeAccountId !== undefined && value.schemaVersion == null);
  if (looksV1) {
    return { kind: "v1", reason: V1_MESSAGE };
  }
  return { kind: "unknown", reason: "formato desconocido" };
}

export function parseBackupText(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, kind: "broken", reason: "JSON vacío o roto", payload: null };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, kind: "broken", reason: "JSON roto", payload: null };
  }
  const classified = classifyBackup(value);
  if (classified.kind !== "v2") {
    return { ok: false, kind: classified.kind, reason: classified.reason, payload: value };
  }
  return { ok: true, kind: "v2", reason: "", payload: value };
}
