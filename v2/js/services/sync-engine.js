import {
  EXPORT_COLLECTIONS,
  INITIAL_STAGE_NAME,
  META_ID,
  PRODUCT_SYNC_STORES,
  SCHEMA_VERSION,
  SYNC_DEBOUNCE_MS,
  SYNC_PUSH_ORDER,
  SYNC_STATE_ID,
} from "../config.js";
import { createId, nowIso } from "../domain/ids.js";
import { projectMetaForSync, applyRemoteMeta } from "../domain/sync-meta.js";
import { getMeta, putMeta } from "../storage/repos/meta.js";
import { repoFor, countCollection } from "../storage/repos/collections.js";
import { getSyncStateRow, putSyncStateRow } from "../storage/repos/sync-state.js";
import { getLedgerEntry, putLedgerEntry, listLedger } from "../storage/repos/sync-ledger.js";
import { getConflict, putConflict, listConflicts } from "../storage/repos/sync-conflicts.js";
import { withApplyLock, isApplying } from "./sync-apply.js";
import { pullCloudRecords, pushCloudRecord } from "./sync-cloud.js";
import { configReady, getAuthState } from "./auth.js";

let debounceTimer = null;
let inflight = null;
let queued = false;
let listeners = [];
let lastCloudCache = [];
let onlineOverride = null;

export function setOnlineOverride(value) {
  onlineOverride = value;
}

export function resetSyncEngine() {
  debounceTimer = null;
  inflight = null;
  queued = false;
  lastCloudCache = [];
  onlineOverride = null;
}

export function onSyncChange(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((item) => item !== fn); };
}

function emit() {
  for (const fn of listeners) {
    try { fn(); } catch (_) { /* ignore */ }
  }
}

export function isOnline() {
  if (onlineOverride != null) return Boolean(onlineOverride);
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

function defaultState() {
  return {
    id: SYNC_STATE_ID,
    deviceId: createId(),
    deviceLabel: null,
    enabled: false,
    userId: null,
    lastSyncAt: null,
    lastPullAt: null,
    lastPushAt: null,
    lastError: null,
    status: "local_only",
    pendingBootstrap: false,
    restoreBlockedReason: "Restore bloqueado mientras la sincronización está activa.",
  };
}

export async function ensureDeviceState() {
  const existing = await getSyncStateRow();
  if (existing && existing.deviceId) return existing;
  const next = { ...defaultState(), ...(existing || {}) };
  if (!next.deviceId) next.deviceId = createId();
  await putSyncStateRow(next);
  return next;
}

export async function patchSyncState(patch) {
  const current = await ensureDeviceState();
  const next = { ...current, ...patch, id: SYNC_STATE_ID, deviceId: current.deviceId };
  await putSyncStateRow(next);
  emit();
  return next;
}

export async function getSyncSnapshot() {
  const state = await ensureDeviceState();
  const ledger = await listLedger();
  const conflicts = (await listConflicts()).filter((row) => !row.resolvedAt);
  const pending = ledger.filter((row) => row.dirty).length;
  return { state, ledger, conflicts, pending };
}

export function syncStatusLabel(snapshot, auth, online) {
  const state = snapshot && snapshot.state ? snapshot.state : {};
  if (state.status === "syncing") return "Sincronizando…";
  if (snapshot && snapshot.conflicts && snapshot.conflicts.length) return "Conflicto";
  if (state.status === "error" && state.lastError) return "Error";
  if (!online) {
    return snapshot && snapshot.pending
      ? "Sin conexión · cambios guardados localmente"
      : "Sin conexión · cambios guardados";
  }
  if (!state.enabled || !auth || auth.status !== "signed_in") return "Solo local";
  if (state.lastSyncAt) return "Sincronizado";
  return "Solo local";
}

export async function noteLocalMutation(entityType, entityId, opts = {}) {
  if (isApplying()) return null;
  if (!PRODUCT_SYNC_STORES.includes(entityType) || entityId == null || entityId === "") return null;
  const existing = await getLedgerEntry(entityType, entityId);
  const entry = {
    entityType,
    entityId: String(entityId),
    cloudRevision: existing ? Number(existing.cloudRevision || 0) : 0,
    dirty: true,
    tombstone: Boolean(opts.tombstone),
    localChangedAt: nowIso(),
  };
  await putLedgerEntry(entry);
  const state = await ensureDeviceState();
  if (!isOnline()) await patchSyncState({ status: "offline_dirty", lastError: null });
  else if (state.enabled) scheduleSync();
  emit();
  return entry;
}

export function scheduleSync() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    syncNow({ reason: "debounce" }).catch(() => {});
  }, SYNC_DEBOUNCE_MS);
}

function payloadFor(entityType, record) {
  return entityType === "meta" ? projectMetaForSync(record) : record;
}

async function readLocalRecord(entityType, entityId) {
  if (entityType === "meta") return getMeta();
  const repo = repoFor(entityType);
  return repo ? repo.get(entityId) : null;
}

async function writeLocalRecord(entityType, payload) {
  if (entityType === "meta") {
    const local = await getMeta();
    return putMeta(applyRemoteMeta(local, payload));
  }
  const repo = repoFor(entityType);
  if (!repo) throw new Error("store desconocido: " + entityType);
  return repo.put(payload);
}

async function deleteLocalRecord(entityType, entityId) {
  if (entityType === "meta") return;
  const repo = repoFor(entityType);
  if (repo) await repo.delete(entityId);
}

function rgmIdOf(record) {
  return record && record.sourceRef && record.sourceRef.rgmSignalId
    ? String(record.sourceRef.rgmSignalId) : null;
}

function mt5KeyOf(record) {
  if (!record || record.accountId == null || !record.sourceRef || record.sourceRef.mt5Position == null) {
    return null;
  }
  return String(record.accountId) + "::" + String(record.sourceRef.mt5Position);
}

async function resolveIncomingIdentity(entityType, payload) {
  if (!payload || !payload.id) return { action: "apply", record: payload };
  if (entityType === "signals") {
    const rgmId = rgmIdOf(payload);
    if (rgmId) {
      const repo = repoFor("signals");
      const other = (await repo.getAll()).find((row) => row.id !== payload.id && rgmIdOf(row) === rgmId);
      if (other) {
        const ledger = await getLedgerEntry("signals", other.id);
        if (ledger && ledger.dirty) return { action: "conflict", local: other };
        await withApplyLock(async () => { await repo.delete(other.id); });
      }
    }
  }
  if (entityType === "trades") {
    const key = mt5KeyOf(payload);
    if (key) {
      const repo = repoFor("trades");
      const other = (await repo.getAll()).find((row) => row.id !== payload.id && mt5KeyOf(row) === key);
      if (other) {
        const ledger = await getLedgerEntry("trades", other.id);
        if (ledger && ledger.dirty) return { action: "conflict", local: other };
        await withApplyLock(async () => { await repo.delete(other.id); });
      }
    }
  }
  if (entityType === "asrs" && payload.tradeId) {
    const repo = repoFor("asrs");
    const other = (await repo.getAll()).find((row) => row.id !== payload.id && row.tradeId === payload.tradeId);
    if (other) {
      const ledger = await getLedgerEntry("asrs", other.id);
      if (ledger && ledger.dirty) return { action: "conflict", local: other };
      await withApplyLock(async () => { await repo.delete(other.id); });
    }
  }
  return { action: "apply", record: payload };
}

async function openConflict(entityType, entityId, cloud, localPayload, expected) {
  await putConflict({
    entityType,
    entityId,
    cloudRevision: cloud.revision,
    cloudPayload: cloud.payload,
    localPayload: localPayload || {},
    incomingExpected: expected,
    createdAt: nowIso(),
    resolvedAt: null,
  });
  await patchSyncState({ status: "conflict", lastError: null });
}

async function applyCloudRow(cloud) {
  const entityType = cloud.entityType;
  const entityId = cloud.entityId;
  const ledger = await getLedgerEntry(entityType, entityId);
  const local = await readLocalRecord(entityType, entityId);
  const cloudRev = Number(cloud.revision);

  if (cloud.tombstone) {
    if (ledger && ledger.dirty && local) {
      await openConflict(entityType, entityId, cloud, local, ledger.cloudRevision);
      return "conflict";
    }
    await withApplyLock(async () => {
      if (local) await deleteLocalRecord(entityType, entityId);
    });
    await putLedgerEntry({
      entityType, entityId, cloudRevision: cloudRev, dirty: false, tombstone: true, localChangedAt: nowIso(),
    });
    return "tombstone";
  }

  if (!ledger) {
    const ident = await resolveIncomingIdentity(entityType, cloud.payload);
    if (ident.action === "conflict") {
      await openConflict(entityType, entityId, cloud, ident.local, 0);
      return "conflict";
    }
    await withApplyLock(async () => { await writeLocalRecord(entityType, cloud.payload); });
    await putLedgerEntry({
      entityType, entityId, cloudRevision: cloudRev, dirty: false, tombstone: false, localChangedAt: nowIso(),
    });
    return "apply";
  }

  if (!ledger.dirty && Number(ledger.cloudRevision) === cloudRev) return "noop";

  if (!ledger.dirty && cloudRev > Number(ledger.cloudRevision || 0)) {
    const ident = await resolveIncomingIdentity(entityType, cloud.payload);
    if (ident.action === "conflict") {
      await openConflict(entityType, entityId, cloud, ident.local, ledger.cloudRevision);
      return "conflict";
    }
    await withApplyLock(async () => { await writeLocalRecord(entityType, cloud.payload); });
    await putLedgerEntry({
      ...ledger, cloudRevision: cloudRev, dirty: false, tombstone: false, localChangedAt: nowIso(),
    });
    return "apply";
  }

  if (ledger.dirty && Number(ledger.cloudRevision || 0) === cloudRev) return "keep_dirty";

  if (ledger.dirty && Number(ledger.cloudRevision || 0) !== cloudRev) {
    await openConflict(entityType, entityId, cloud, local, ledger.cloudRevision);
    return "conflict";
  }
  return "noop";
}

export async function pullNow() {
  const rows = await pullCloudRecords();
  lastCloudCache = rows.slice();
  const results = [];
  for (const row of rows) results.push(await applyCloudRow(row));
  await patchSyncState({ lastPullAt: nowIso() });
  return { rows, results };
}

function sortDirty(entries) {
  const rank = new Map(SYNC_PUSH_ORDER.map((name, i) => [name, i]));
  return entries.slice().sort((a, b) => {
    const da = rank.has(a.entityType) ? rank.get(a.entityType) : 99;
    const db = rank.has(b.entityType) ? rank.get(b.entityType) : 99;
    return da !== db ? da - db : String(a.entityId).localeCompare(String(b.entityId));
  });
}

export async function pushDirty() {
  const state = await ensureDeviceState();
  const dirty = sortDirty((await listLedger()).filter((row) => row.dirty));
  const results = [];
  for (const entry of dirty) {
    const open = await getConflict(entry.entityType, entry.entityId);
    if (open && !open.resolvedAt) {
      results.push({ id: entry.id, status: "blocked_conflict" });
      continue;
    }
    const local = entry.tombstone ? null : await readLocalRecord(entry.entityType, entry.entityId);
    if (!entry.tombstone && !local) {
      results.push({ id: entry.id, status: "missing_local" });
      continue;
    }
    const response = await pushCloudRecord({
      entityType: entry.entityType,
      entityId: entry.entityId,
      payload: entry.tombstone ? {} : payloadFor(entry.entityType, local),
      expectedRevision: Number(entry.cloudRevision || 0),
      tombstone: Boolean(entry.tombstone),
      deviceId: state.deviceId,
    });
    if (response && response.ok) {
      await putLedgerEntry({
        ...entry, cloudRevision: Number(response.revision), dirty: false, localChangedAt: nowIso(),
      });
      results.push({ id: entry.id, status: "pushed", revision: response.revision });
      continue;
    }
    const kind = response && response.kind;
    if (kind === "conflict" || kind === "missing") {
      await openConflict(entry.entityType, entry.entityId, {
        revision: response.cloud_revision || entry.cloudRevision,
        payload: response.cloud_payload || {},
      }, local, entry.cloudRevision);
      results.push({ id: entry.id, status: "conflict" });
      continue;
    }
    throw new Error("push rechazado");
  }
  await patchSyncState({ lastPushAt: nowIso() });
  return results;
}

export async function countLocalSyncable() {
  let total = (await getMeta()) ? 1 : 0;
  for (const name of EXPORT_COLLECTIONS) total += await countCollection(name);
  return total;
}

export async function markAllLocalDirty() {
  const meta = await getMeta();
  if (meta) {
    await putLedgerEntry({
      entityType: "meta", entityId: META_ID, cloudRevision: 0, dirty: true, tombstone: false, localChangedAt: nowIso(),
    });
  }
  for (const name of EXPORT_COLLECTIONS) {
    const rows = await repoFor(name).getAll();
    for (const row of rows) {
      await putLedgerEntry({
        entityType: name, entityId: row.id, cloudRevision: 0, dirty: true, tombstone: false, localChangedAt: nowIso(),
      });
    }
  }
}

export async function cloudLooksEmpty(rows) {
  const list = rows || lastCloudCache;
  return !list.some((row) => !row.tombstone && (row.entityType === "meta" || row.entityType === "stages"));
}

export async function isLocalJournalEmpty() {
  if (await getMeta()) return false;
  for (const name of EXPORT_COLLECTIONS) {
    if (await countCollection(name)) return false;
  }
  return true;
}

export async function isVirginLocalSeed() {
  const meta = await getMeta();
  if (!meta) return false;
  const stages = await repoFor("stages").getAll();
  if (stages.length !== 1 || stages[0].name !== INITIAL_STAGE_NAME) return false;
  for (const name of EXPORT_COLLECTIONS) {
    if (name === "stages") continue;
    if (await countCollection(name)) return false;
  }
  return true;
}

export async function bootstrapFromCloudIfEmpty() {
  const auth = await getAuthState();
  if (auth.status !== "signed_in" || !configReady()) return { applied: false, reason: "no_auth" };
  if (!(await isLocalJournalEmpty())) return { applied: false, reason: "local_present" };
  if (!isOnline()) {
    await patchSyncState({ pendingBootstrap: true, status: "offline_dirty" });
    return { applied: false, reason: "offline" };
  }
  const pulled = await pullNow();
  if (await cloudLooksEmpty(pulled.rows)) return { applied: false, reason: "cloud_empty" };
  await patchSyncState({
    enabled: true, pendingBootstrap: false, lastSyncAt: nowIso(), status: "idle", lastError: null,
  });
  return { applied: true, reason: "pulled" };
}

export async function discardVirginSeedIfCloudHasJournal() {
  const state = await ensureDeviceState();
  if (!state.pendingBootstrap || !(await isVirginLocalSeed()) || !isOnline()) {
    return { discarded: false };
  }
  const pulled = await pullCloudRecords();
  if (await cloudLooksEmpty(pulled)) return { discarded: false };
  await withApplyLock(async () => {
    const stages = await repoFor("stages").getAll();
    for (const stage of stages) await repoFor("stages").delete(stage.id);
  });
  lastCloudCache = pulled;
  for (const row of pulled) await applyCloudRow(row);
  await patchSyncState({
    pendingBootstrap: false, enabled: true, lastSyncAt: nowIso(), status: "idle", lastError: null,
  });
  return { discarded: true };
}

export async function enableAndUploadLocalJournal() {
  if (!isOnline()) throw new Error("sin conexión");
  const auth = await getAuthState();
  if (auth.status !== "signed_in") throw new Error("hace falta iniciar sesión");
  const pulled = await pullNow();
  if (!(await cloudLooksEmpty(pulled.rows))) {
    throw new Error("la nube ya tiene Journal. No se sube este dispositivo en silencio.");
  }
  await markAllLocalDirty();
  await patchSyncState({ enabled: true, lastError: null, status: "syncing", userId: auth.userId || null });
  const pushed = await pushDirty();
  await patchSyncState({ enabled: true, lastSyncAt: nowIso(), status: "idle", lastError: null });
  return pushed;
}

export async function setSyncEnabled(enabled) {
  return patchSyncState({ enabled: Boolean(enabled), status: enabled ? "idle" : "local_only" });
}

export function isRestoreBlocked(state) {
  return Boolean(state && state.enabled);
}

export async function syncNow(opts = {}) {
  const state = await ensureDeviceState();
  const auth = await getAuthState();
  if (!state.enabled) return { skipped: true, reason: "disabled" };
  if (auth.status !== "signed_in") return { skipped: true, reason: "signed_out" };
  if (!isOnline()) {
    await patchSyncState({ status: "offline_dirty" });
    return { skipped: true, reason: "offline" };
  }
  if (inflight) {
    queued = true;
    return inflight;
  }
  inflight = (async () => {
    await patchSyncState({ status: "syncing", lastError: null, userId: auth.userId || null });
    try {
      if (state.pendingBootstrap) await discardVirginSeedIfCloudHasJournal();
      const pulled = await pullNow();
      const pushed = await pushDirty();
      const snap = await getSyncSnapshot();
      await patchSyncState({
        lastSyncAt: nowIso(),
        lastError: null,
        status: snap.conflicts.length ? "conflict" : "idle",
      });
      return { skipped: false, pulled, pushed, conflicts: snap.conflicts.length };
    } catch (err) {
      await patchSyncState({ status: "error", lastError: err && err.message ? err.message : String(err) });
      throw err;
    } finally {
      inflight = null;
      if (queued) {
        queued = false;
        syncNow({ reason: "queued" }).catch(() => {});
      }
      emit();
    }
  })();
  return inflight;
}

export function bindNetworkSync() {
  if (typeof window === "undefined") return;
  window.addEventListener("online", () => { syncNow({ reason: "online" }).catch(() => {}); });
  window.addEventListener("offline", () => { patchSyncState({ status: "offline_dirty" }).catch(() => {}); });
}

export function getCachedCloudRecords() {
  return lastCloudCache.slice();
}

export { SCHEMA_VERSION };
