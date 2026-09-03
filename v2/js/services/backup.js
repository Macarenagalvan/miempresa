import {
  JOURNAL_EDITION,
  SCHEMA_VERSION,
  BACKUP_PRODUCT,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  EXPORT_COLLECTIONS,
  TRADING_COLLECTIONS,
  OFFICE_COLLECTIONS,
  STORES,
  SYNC_STORES,
} from "../config.js";
import { nowIso } from "../domain/ids.js";
import { getMeta, putMeta } from "../storage/repos/meta.js";
import { dumpCollections } from "../storage/repos/collections.js";
import { withStores } from "../storage/db.js";
import {
  assertBackupMeta,
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
import { ensureDeviceState, isRestoreBlocked } from "./sync-engine.js";

const V1_MESSAGE = "Este archivo pertenece a Journal V1 y no puede restaurarse en Journal V2.";

export function backupCollectionNames() {
  return EXPORT_COLLECTIONS.slice();
}

export function restoreStoreNames() {
  return Object.values(STORES).filter((name) => !SYNC_STORES.includes(name));
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

function pushError(errors, message) {
  errors.push(message);
}

function uniqueIds(list, label, errors) {
  const set = new Set();
  if (!Array.isArray(list)) return set;
  for (const rec of list) {
    if (!rec || rec.id == null || rec.id === "") {
      pushError(errors, `${label}: id faltante`);
      continue;
    }
    const id = String(rec.id);
    if (set.has(id)) pushError(errors, `${label}: id duplicado ${id}`);
    set.add(id);
  }
  return set;
}

function mustRef(id, set, errors, message) {
  if (id == null || id === "") {
    pushError(errors, message);
    return;
  }
  if (!set.has(String(id))) pushError(errors, message);
}

function optRef(id, set, errors, message) {
  if (id == null || id === "") return;
  if (!set.has(String(id))) pushError(errors, message);
}

function runAssert(fn, errors) {
  try {
    fn();
  } catch (err) {
    pushError(errors, err.message);
  }
}

export function validateBackup(payload) {
  const errors = [];
  const incompatibilities = [];
  const counts = emptyCounts();
  const classified = classifyBackup(payload);
  if (classified.kind !== "v2") {
    if (classified.kind === "future") incompatibilities.push(classified.reason);
    return {
      ok: false,
      kind: classified.kind,
      reason: classified.reason,
      errors: classified.reason ? [classified.reason] : [],
      incompatibilities,
      counts,
    };
  }

  if (!payload.meta || typeof payload.meta !== "object" || Array.isArray(payload.meta)) {
    pushError(errors, "meta faltante");
  }
  for (const name of TRADING_COLLECTIONS) {
    if (!Array.isArray(payload[name])) {
      pushError(errors, `store faltante: ${name}`);
      counts[name] = 0;
    } else {
      counts[name] = payload[name].length;
    }
  }
  for (const name of OFFICE_COLLECTIONS) {
    counts[name] = Array.isArray(payload[name]) ? payload[name].length : 0;
  }

  const stages = Array.isArray(payload.stages) ? payload.stages : [];
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  const movements = Array.isArray(payload.movements) ? payload.movements : [];
  const observations = Array.isArray(payload.observations) ? payload.observations : [];
  const setups = Array.isArray(payload.setups) ? payload.setups : [];
  const trades = Array.isArray(payload.trades) ? payload.trades : [];
  const asrs = Array.isArray(payload.asrs) ? payload.asrs : [];
  const signals = Array.isArray(payload.signals) ? payload.signals : [];
  const challenges = Array.isArray(payload.challenges) ? payload.challenges : [];
  const payouts = Array.isArray(payload.payouts) ? payload.payouts : [];
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];

  const stageIds = uniqueIds(stages, "stages", errors);
  const accountIds = uniqueIds(accounts, "accounts", errors);
  uniqueIds(movements, "movements", errors);
  const observationIds = uniqueIds(observations, "observations", errors);
  const setupIds = uniqueIds(setups, "setups", errors);
  const tradeIds = uniqueIds(trades, "trades", errors);
  uniqueIds(asrs, "asrs", errors);
  const signalIds = uniqueIds(signals, "signals", errors);
  const challengeIds = uniqueIds(challenges, "challenges", errors);
  uniqueIds(payouts, "payouts", errors);
  uniqueIds(attachments, "attachments", errors);

  if (payload.meta) {
    runAssert(() => assertBackupMeta(payload.meta), errors);
    if (payload.meta.activeStageId) {
      mustRef(payload.meta.activeStageId, stageIds, errors, "JournalMeta → activeStageId rota");
    }
    optRef(payload.meta.activeAccountId, accountIds, errors, "JournalMeta → activeAccountId rota");
  }

  runAssert(() => assertSingleActive(stages), errors);
  for (const stage of stages) runAssert(() => assertStage(stage), errors);

  for (const obs of observations) {
    runAssert(() => assertObservation(obs), errors);
    mustRef(obs && obs.stageId, stageIds, errors, "Observation.stageId rota");
  }

  for (const setup of setups) {
    runAssert(() => assertSetup(setup), errors);
    mustRef(setup && setup.stageId, stageIds, errors, "Setup.stageId rota");
    optRef(setup && setup.observationId, observationIds, errors, "Setup → Observation rota");
    optRef(setup && setup.deskSignalId, signalIds, errors, "Setup → Signal rota");
  }

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  for (const account of accounts) {
    runAssert(() => assertAccount(account), errors);
    mustRef(account && account.stageId, stageIds, errors, "Account.stageId rota");
    optRef(account && account.challengeId, challengeIds, errors, "Account → Challenge rota");
  }

  for (const trade of trades) {
    runAssert(() => assertTrade(trade), errors);
    mustRef(trade && trade.stageId, stageIds, errors, "Trade.stageId rota");
    optRef(trade && trade.setupId, setupIds, errors, "Trade → Setup rota");
    optRef(trade && trade.deskSignalId, signalIds, errors, "Trade → Signal rota");
    if (trade && trade.context !== Context.BACKTEST) {
      mustRef(trade.accountId, accountIds, errors, "Trade → Account rota");
      const account = accountById.get(trade.accountId);
      runAssert(() => assertTradeAccountPair(trade, account), errors);
    } else if (trade && trade.accountId != null) {
      pushError(errors, "BACKTEST no usa accountId");
    }
  }

  const asrTradeIds = new Set();
  for (const asr of asrs) {
    runAssert(() => assertAsr(asr), errors);
    mustRef(asr && asr.stageId, stageIds, errors, "ASR.stageId rota");
    mustRef(asr && asr.tradeId, tradeIds, errors, "ASR → Trade rota");
    if (asr && asr.tradeId) {
      const key = String(asr.tradeId);
      if (asrTradeIds.has(key)) pushError(errors, "ASR.tradeId duplicado");
      asrTradeIds.add(key);
    }
  }

  for (const mov of movements) {
    runAssert(() => assertMovement(mov), errors);
    mustRef(mov && mov.stageId, stageIds, errors, "Movement.stageId rota");
    mustRef(mov && mov.accountId, accountIds, errors, "Movement → Account rota");
  }

  for (const ch of challenges) {
    runAssert(() => assertChallenge(ch), errors);
    mustRef(ch && ch.stageId, stageIds, errors, "Challenge.stageId rota");
    optRef(ch && ch.accountId, accountIds, errors, "Challenge → Account rota");
  }

  for (const payout of payouts) {
    runAssert(() => assertPayout(payout), errors);
    mustRef(payout && payout.stageId, stageIds, errors, "Payout.stageId rota");
    mustRef(payout && payout.challengeId, challengeIds, errors, "Payout → Challenge rota");
  }

  for (const sig of signals) {
    runAssert(() => assertDeskSignal(sig), errors);
    mustRef(sig && sig.stageId, stageIds, errors, "Signal.stageId rota");
    optRef(sig && sig.setupId, setupIds, errors, "Signal → Setup rota");
    optRef(sig && sig.tradeId, tradeIds, errors, "Signal → Trade rota");
  }

  for (const att of attachments) {
    if (!att || att.id == null || att.id === "") pushError(errors, "attachments: id faltante");
  }

  return {
    ok: errors.length === 0,
    kind: "v2",
    reason: errors.length ? errors[0] : "",
    errors,
    incompatibilities,
    counts,
  };
}

export function previewFromPayload(payload, fileName = "") {
  const classified = classifyBackup(payload);
  const report = classified.kind === "v2"
    ? validateBackup(payload)
    : {
      ok: false,
      kind: classified.kind,
      reason: classified.reason,
      errors: classified.reason ? [classified.reason] : [],
      incompatibilities: classified.kind === "future" ? [classified.reason] : [],
      counts: emptyCounts(),
    };
  const meta = payload && payload.meta && typeof payload.meta === "object" ? payload.meta : null;
  const stages = Array.isArray(payload && payload.stages) ? payload.stages : [];
  return {
    fileName,
    ok: report.ok,
    kind: report.kind,
    reason: report.reason,
    errors: report.errors,
    incompatibilities: report.incompatibilities,
    product: payload && payload.product,
    format: payload && payload.format,
    journalEdition: payload && payload.journalEdition,
    schemaVersion: payload && payload.schemaVersion,
    backupVersion: payload && payload.backupVersion,
    exportedAt: payload && payload.exportedAt,
    counts: {
      stages: countOf(payload, "stages"),
      observations: countOf(payload, "observations"),
      setups: countOf(payload, "setups"),
      trades: countOf(payload, "trades"),
      asrs: countOf(payload, "asrs"),
      accounts: countOf(payload, "accounts"),
      movements: countOf(payload, "movements"),
      challenges: countOf(payload, "challenges"),
      payouts: countOf(payload, "payouts"),
      signals: countOf(payload, "signals"),
      attachments: countOf(payload, "attachments"),
    },
    stages: stages.map((s) => ({ id: s && s.id, name: s && s.name, status: s && s.status })),
    activeStageId: meta && meta.activeStageId,
    activeAccountId: meta && meta.activeAccountId,
    wrote: false,
  };
}

export function previewBackupText(text, fileName = "") {
  const parsed = parseBackupText(text);
  if (!parsed.ok) {
    return {
      fileName,
      ok: false,
      kind: parsed.kind,
      reason: parsed.reason,
      errors: parsed.reason ? [parsed.reason] : [],
      incompatibilities: parsed.kind === "future" ? [parsed.reason] : [],
      product: parsed.payload && parsed.payload.product,
      format: parsed.payload && parsed.payload.format,
      journalEdition: parsed.payload && parsed.payload.journalEdition,
      schemaVersion: parsed.payload && parsed.payload.schemaVersion,
      backupVersion: parsed.payload && parsed.payload.backupVersion,
      exportedAt: parsed.payload && parsed.payload.exportedAt,
      counts: emptyCounts(),
      stages: [],
      activeStageId: null,
      activeAccountId: null,
      wrote: false,
    };
  }
  return previewFromPayload(parsed.payload, fileName);
}

export async function buildExportPayload() {
  const meta = await getMeta();
  const collections = await dumpCollections();
  return {
    product: BACKUP_PRODUCT,
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    journalEdition: JOURNAL_EDITION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    meta,
    ...collections,
  };
}

function stampLocal(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function triggerDownload(payload, filename) {
  const body = JSON.stringify(payload, null, 2);
  const blob = new Blob([body], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
  return { filename, bytes: blob.size };
}

export async function downloadExport() {
  const payload = await buildExportPayload();
  const stamp = String(payload.exportedAt || "").slice(0, 19).replace(/[:T]/g, "-");
  triggerDownload(payload, `journal-v2-backup-${stamp}.json`);
  if (payload.meta) {
    await putMeta({ ...payload.meta, lastBackupAt: payload.exportedAt });
  }
  return payload;
}

export async function downloadCurrentBackup() {
  const payload = await buildExportPayload();
  const filename = `journal-v2-pre-restore-${stampLocal(new Date())}.json`;
  triggerDownload(payload, filename);
  if (payload.meta) {
    await putMeta({ ...payload.meta, lastBackupAt: payload.exportedAt });
  }
  return { payload, filename };
}

export async function applyRestoreTransaction(payload) {
  const storeNames = restoreStoreNames();
  await withStores(storeNames, "readwrite", (tx) => {
    for (const name of storeNames) {
      tx.objectStore(name).clear();
    }
    if (payload.meta) {
      tx.objectStore(STORES.meta).put({
        ...payload.meta,
        schemaVersion: SCHEMA_VERSION,
      });
    }
    for (const name of EXPORT_COLLECTIONS) {
      const rows = Array.isArray(payload[name]) ? payload[name] : [];
      const store = tx.objectStore(name);
      for (const rec of rows) store.put(rec);
    }
  });
}

export async function restoreBackup(input, options = {}) {
  const parsed = typeof input === "string"
    ? parseBackupText(input)
    : (() => {
      const classified = classifyBackup(input);
      return {
        ok: classified.kind === "v2",
        kind: classified.kind,
        reason: classified.reason,
        payload: input,
      };
    })();
  if (parsed.kind === "v1") {
    throw new Error(V1_MESSAGE);
  }
  if (parsed.kind === "future") {
    throw new Error("versión futura no soportada");
  }
  if (parsed.kind === "broken" || parsed.kind === "unknown" || !parsed.payload) {
    throw new Error(parsed.reason || "formato desconocido");
  }
  const report = validateBackup(parsed.payload);
  if (!report.ok) {
    throw new Error(report.reason || "backup inválido");
  }
  const syncState = await ensureDeviceState();
  if (isRestoreBlocked(syncState)) {
    throw new Error(syncState.restoreBlockedReason || "Restore bloqueado mientras la sincronización está activa.");
  }
  if (!options.confirmed) {
    throw new Error("restore exige confirmación explícita");
  }
  if (!options.alreadyProtected) {
    await downloadCurrentBackup();
  }
  await applyRestoreTransaction(parsed.payload);
  return previewFromPayload(parsed.payload, options.fileName || "");
}
