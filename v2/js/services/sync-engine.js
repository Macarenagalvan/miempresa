import { localModeState, isSyncPaused, PAUSED_LABEL, withSyncStores, assertModeInTransaction } from './sync-mode.js';
import { assertSyncOwner, bindSyncOwner } from './sync-owner.js';
import { dirtyVersion, sameVersion, syncSnapshot, acknowledgePush, applyCloudVersion } from '../storage/sync-version.js';
import { withStores, requestToPromise } from '../storage/db.js';
import {
  EXPORT_COLLECTIONS,
  DB_NAME,
  INITIAL_STAGE_NAME,
  PRODUCT_SYNC_STORES,
  SCHEMA_VERSION,
  SYNC_DEBOUNCE_MS,
  SYNC_PUSH_ORDER,
  SYNC_STATE_ID,
} from "../config.js";
import { createId, nowIso } from "../domain/ids.js";
import { encodeSyncPayload, decodeSyncPayload } from "./sync-payload.js";
import { getMeta } from "../storage/repos/meta.js";
import { repoFor, countCollection } from "../storage/repos/collections.js";
import { getLedgerEntry, listLedger } from "../storage/repos/sync-ledger.js";
import { getConflict, putConflict, listConflicts } from "../storage/repos/sync-conflicts.js";
import { isApplying } from "./sync-apply.js";
import { pullCloudRecords, pushCloudRecord } from "./sync-cloud.js";
import { configReady, getAuthState, authGeneration } from "./auth.js";

let debounceTimer = null;
let inflight = null;
let queued = false;
let listeners = [];
let lastCloudCache = [];
let onlineOverride = null;
const modeChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(DB_NAME + ':sync-mode') : null;
if (modeChannel) modeChannel.onmessage = () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null; queued = false;
  emit();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('journal-sync-mode'));
};

export function setOnlineOverride(value) {
  onlineOverride = value;
}

export function resetSyncEngine() {
  if (debounceTimer) clearTimeout(debounceTimer);
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
  return withStores(['syncState'], 'readwrite', async tx => {
    const store = tx.objectStore('syncState');
    const existing = await requestToPromise(store.get(SYNC_STATE_ID));
    if (existing?.deviceId) { const next = localModeState(existing); if (next !== existing) store.put(next); return next; }
    const next = localModeState({ ...defaultState(), ...existing });
    if (!next.deviceId) next.deviceId = createId();
    store.put(next); return next;
  });
}

export async function patchSyncState(patch, owner = null) {
  await ensureDeviceState();
  const next = await withStores(['syncState'], 'readwrite', async tx => {
    const store = tx.objectStore('syncState');
    const current = await requestToPromise(store.get(SYNC_STATE_ID));
    if (owner) await assertModeInTransaction(tx, owner);
    const value = { ...current, ...patch, id: SYNC_STATE_ID, deviceId: current.deviceId,
      ownerUserId: current.ownerUserId, ownerProject: current.ownerProject,
      modeVersion: current.modeVersion, paused: current.paused, modeEpoch: current.modeEpoch };
    if (isSyncPaused(current)) { value.enabled = false; value.status = 'paused'; value.lastError = null; }
    store.put(value); return value;
  });
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
  if (isSyncPaused(state)) return PAUSED_LABEL;
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
  const entry = await withStores(['syncLedger'], 'readwrite', async tx => {
    const store = tx.objectStore('syncLedger');
    const old = await requestToPromise(store.get(entityType + '::' + entityId));
    const next = dirtyVersion(entityType, entityId, old, Boolean(opts.tombstone));
    store.put(next); return next;
  });
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

async function readLocalRecord(entityType, entityId) {
  if (entityType === "meta") return getMeta();
  const repo = repoFor(entityType);
  return repo ? repo.get(entityId) : null;
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
        return { action: 'apply', replaceId: other.id };
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
        return { action: 'apply', replaceId: other.id };
      }
    }
  }
  if (entityType === "asrs" && payload.tradeId) {
    const repo = repoFor("asrs");
    const other = (await repo.getAll()).find((row) => row.id !== payload.id && row.tradeId === payload.tradeId);
    if (other) {
      const ledger = await getLedgerEntry("asrs", other.id);
      if (ledger && ledger.dirty) return { action: "conflict", local: other };
      return { action: 'apply', replaceId: other.id };
    }
  }
  return { action: "apply", record: payload };
}

async function openConflict(entityType, entityId, cloud, localPayload, expected, owner) {
  await putConflict({
    entityType,
    entityId,
    cloudRevision: cloud.revision,
    cloudPayload: cloud.payload,
    localPayload: localPayload || {},
    incomingExpected: expected,
    createdAt: nowIso(),
    resolvedAt: null,
  }, owner);
  await patchSyncState({ status: "conflict", lastError: null }, owner);
}

async function applyCloudRow(cloud, owner) {
  const entityType = cloud.entityType;
  const entityId = cloud.entityId;
  const { entry: ledger, local } = await syncSnapshot(entityType, entityId);
  const cloudRev = Number(cloud.revision);

  if (cloud.tombstone) {
    if (ledger && ledger.dirty && local) {
      await openConflict(entityType, entityId, cloud, local, ledger.cloudRevision, owner);
      return "conflict";
    }
    if (!await applyCloudVersion(entityType, entityId, null, true, ledger, cloudRev, owner)) {
      await openConflict(entityType, entityId, cloud, await readLocalRecord(entityType, entityId), ledger?.cloudRevision || 0, owner);
      return 'conflict';
    }
    return "tombstone";
  }

  if (!ledger) {
    const ident = await resolveIncomingIdentity(entityType, cloud.payload);
    if (ident.action === "conflict") {
      await openConflict(entityType, entityId, cloud, ident.local, 0, owner);
      return "conflict";
    }
    if (!await applyCloudVersion(entityType, entityId, decodeSyncPayload(entityType, cloud.payload), false, ledger, cloudRev, owner, ident.replaceId)) {
      await openConflict(entityType, entityId, cloud, await readLocalRecord(entityType, entityId), ledger?.cloudRevision || 0, owner);
      return 'conflict';
    }
    return "apply";
  }

  if (!ledger.dirty && Number(ledger.cloudRevision) === cloudRev) return "noop";

  if (!ledger.dirty && cloudRev > Number(ledger.cloudRevision || 0)) {
    const ident = await resolveIncomingIdentity(entityType, cloud.payload);
    if (ident.action === "conflict") {
      await openConflict(entityType, entityId, cloud, ident.local, ledger.cloudRevision, owner);
      return "conflict";
    }
    if (!await applyCloudVersion(entityType, entityId, decodeSyncPayload(entityType, cloud.payload), false, ledger, cloudRev, owner, ident.replaceId)) {
      await openConflict(entityType, entityId, cloud, await readLocalRecord(entityType, entityId), ledger?.cloudRevision || 0, owner);
      return 'conflict';
    }
    return "apply";
  }

  if (ledger.dirty && Number(ledger.cloudRevision || 0) === cloudRev) return "keep_dirty";

  if (ledger.dirty && Number(ledger.cloudRevision || 0) !== cloudRev) {
    await openConflict(entityType, entityId, cloud, local, ledger.cloudRevision, owner);
    return "conflict";
  }
  return "noop";
}

export async function pullNow(expected) {
  const owner = await assertSyncOwner(expected);
  const rows = await pullCloudRecords(owner);
  lastCloudCache = rows.slice();
  const results = [];
  for (const row of rows) { await assertSyncOwner(owner); results.push(await applyCloudRow(row, owner)); }
  await patchSyncState({ lastPullAt: nowIso() }, owner);
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

export async function pushDirty(expected) {
  const owner = await assertSyncOwner(expected);
  const state = await ensureDeviceState();
  const dirty = sortDirty((await listLedger()).filter((row) => row.dirty));
  const results = [];
  for (const listed of dirty) {
    await assertSyncOwner(owner);
    const { entry, local: snapshotLocal } = await syncSnapshot(listed.entityType, listed.entityId);
    if (!entry?.dirty) continue;
    const open = await getConflict(entry.entityType, entry.entityId);
    if (open && !open.resolvedAt) {
      results.push({ id: entry.id, status: "blocked_conflict" });
      continue;
    }
    const local = entry.tombstone ? null : snapshotLocal;
    if (!entry.tombstone && !local) {
      results.push({ id: entry.id, status: "missing_local" });
      continue;
    }
    const response = await pushCloudRecord({
      entityType: entry.entityType,
      entityId: entry.entityId,
      payload: entry.tombstone ? {} : await encodeSyncPayload(entry.entityType, local),
      expectedRevision: Number(entry.cloudRevision || 0),
      tombstone: Boolean(entry.tombstone),
      deviceId: state.deviceId,
    }, owner);
    await assertSyncOwner(owner);
    if (response && response.ok) {
      await acknowledgePush(entry, response.revision, owner);
      results.push({ id: entry.id, status: "pushed", revision: response.revision });
      continue;
    }
    const kind = response && response.kind;
    if (kind === "conflict" || kind === "missing") {
      await openConflict(entry.entityType, entry.entityId, {
        revision: response.cloud_revision || entry.cloudRevision,
        payload: response.cloud_payload || {},
      }, local, entry.cloudRevision, owner);
      results.push({ id: entry.id, status: "conflict" });
      continue;
    }
    throw new Error("push rechazado");
  }
  await patchSyncState({ lastPushAt: nowIso() }, owner);
  return results;
}

export async function countLocalSyncable() {
  let total = (await getMeta()) ? 1 : 0;
  for (const name of EXPORT_COLLECTIONS) total += await countCollection(name);
  return total;
}

export async function markAllLocalDirty(expected) {
  const owner = await assertSyncOwner(expected);
  await withSyncStores(['meta', ...EXPORT_COLLECTIONS, 'syncLedger'], owner, async tx => {
    for (const name of ['meta', ...EXPORT_COLLECTIONS]) {
      for (const row of await requestToPromise(tx.objectStore(name).getAll())) {
        const ledger = tx.objectStore('syncLedger');
        const old = await requestToPromise(ledger.get(name + '::' + row.id));
        ledger.put(dirtyVersion(name, row.id, old));
      }
    }
  });
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
  if (isSyncPaused(await ensureDeviceState())) return { applied: false, reason: "paused" };
  const auth = await getAuthState();
  if (auth.status !== "signed_in" || !configReady()) return { applied: false, reason: "no_auth" };
  if (!(await isLocalJournalEmpty())) return { applied: false, reason: "local_present" };
  if (!isOnline()) {
    await patchSyncState({ pendingBootstrap: true, status: "offline_dirty" });
    return { applied: false, reason: "offline" };
  }
  await ensureDeviceState();
  await bindSyncOwner();
  const owner = await assertSyncOwner();
  const pulled = await pullNow(owner);
  if (await cloudLooksEmpty(pulled.rows)) return { applied: false, reason: "cloud_empty" };
  await patchSyncState({
    enabled: true, pendingBootstrap: false, lastSyncAt: nowIso(), status: "idle", lastError: null,
  }, owner);
  return { applied: true, reason: "pulled" };
}

export async function discardVirginSeedIfCloudHasJournal() {
  const state = await ensureDeviceState();
  if (isSyncPaused(state) || !state.pendingBootstrap || !(await isVirginLocalSeed()) || !isOnline()) {
    return { discarded: false };
  }
  await bindSyncOwner();
  const owner = await assertSyncOwner();
  const pulled = await pullCloudRecords(owner);
  if (await cloudLooksEmpty(pulled)) return { discarded: false };
  const seedIds = (await repoFor('stages').getAll()).map(row => row.id);
  const seeds = await Promise.all(seedIds.map(id => syncSnapshot('stages', id)));
  lastCloudCache = pulled;
  for (const row of pulled) await applyCloudRow(row, owner);
  // Remove the unused seed only after the incoming Journal has been applied.
  await withSyncStores(['stages', 'syncLedger'], owner, async tx => {
    const store = tx.objectStore('stages');
    for (const id of seedIds) {
      if (pulled.some(row => row.entityType === 'stages' && row.entityId === id)) continue;
      const ledgerStore = tx.objectStore('syncLedger');
      const ledger = await requestToPromise(ledgerStore.get('stages::' + id));
      const seed = seeds.find(row => row.local?.id === id);
      const current = await requestToPromise(store.get(id));
      if (seed && (seed.entry ? sameVersion(ledger, seed.entry) : !ledger) && JSON.stringify(current) === JSON.stringify(seed.local)) {
        store.delete(id); ledgerStore.delete('stages::' + id);
      }
    }
  });
  await patchSyncState({
    pendingBootstrap: false, enabled: true, lastSyncAt: nowIso(), status: "idle", lastError: null,
  }, owner);
  return { discarded: true };
}

export async function enableAndUploadLocalJournal() {
  if (isSyncPaused(await ensureDeviceState())) throw new Error(PAUSED_LABEL);
  if (!isOnline()) throw new Error("sin conexión");
  const auth = await getAuthState();
  if (auth.status !== "signed_in") throw new Error("hace falta iniciar sesión");
  await ensureDeviceState();
  await bindSyncOwner();
  const owner = await assertSyncOwner();
  const cloudRows = await pullCloudRecords(owner);
  if (!(await cloudLooksEmpty(cloudRows))) {
    throw new Error("la nube ya tiene Journal. No se sube este dispositivo en silencio.");
  }
  await markAllLocalDirty(owner);
  await patchSyncState({ enabled: true, lastError: null, status: "syncing", userId: auth.userId || null }, owner);
  const pushed = await pushDirty(owner);
  await patchSyncState({ enabled: true, lastSyncAt: nowIso(), status: "idle", lastError: null }, owner);
  return pushed;
}

export async function pauseSync() {
  await ensureDeviceState();
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null; queued = false;
  const next = await withStores(['syncState'], 'readwrite', async tx => {
    const store = tx.objectStore('syncState');
    const state = await requestToPromise(store.get(SYNC_STATE_ID));
    const next = { ...state, paused: true, enabled: false, modeEpoch: createId(), status: 'paused', lastError: null };
    store.put(next); return next;
  });
  modeChannel?.postMessage('paused');
  emit(); return next;
}
function reviewKey(ledger, conflicts) {
  return JSON.stringify([ledger.sort((a,b) => a.id.localeCompare(b.id)), conflicts.sort((a,b) => a.id.localeCompare(b.id))]);
}
export async function prepareSyncResume() {
  await ensureDeviceState();
  const owner = await assertSyncOwner(null, { allowPaused: true });
  return withStores(['syncState', 'syncLedger', 'syncConflicts', 'observations'], 'readonly', async tx => {
    const state = await requestToPromise(tx.objectStore('syncState').get(SYNC_STATE_ID));
    if ((await requestToPromise(tx.objectStore('observations').getAll())).some(o => o.recovery)) throw new Error('Los históricos recuperados se conservan en modo local. La sincronización de estos vínculos aún no está habilitada.');
    const ledger = await requestToPromise(tx.objectStore('syncLedger').getAll());
    const conflicts = await requestToPromise(tx.objectStore('syncConflicts').getAll());
    return { owner, modeEpoch: state.modeEpoch, pending: ledger.filter(r => r.dirty).length,
      conflicts: conflicts.filter(r => !r.resolvedAt).length, reviewKey: reviewKey(ledger, conflicts) };
  });
}
export async function resumeSync(review) {
  if (!review?.owner) throw new Error('Revisá cuenta, proyecto y pendientes antes de reactivar.');
  await assertSyncOwner(review.owner, { allowPaused: true });
  await withStores(['syncState', 'syncLedger', 'syncConflicts', 'observations'], 'readwrite', async tx => {
    const store = tx.objectStore('syncState');
    const state = await requestToPromise(store.get(SYNC_STATE_ID));
    if ((await requestToPromise(tx.objectStore('observations').getAll())).some(o => o.recovery)) throw new Error('Los históricos recuperados se conservan en modo local. La sincronización de estos vínculos aún no está habilitada.');
    const ledger = await requestToPromise(tx.objectStore('syncLedger').getAll());
    const conflicts = await requestToPromise(tx.objectStore('syncConflicts').getAll());
    if (authGeneration() !== review.owner.generation || state.modeEpoch !== review.modeEpoch || state.ownerUserId !== review.owner.userId || state.ownerProject !== review.owner.project || reviewKey(ledger, conflicts) !== review.reviewKey) throw new Error('Los datos o la pausa cambiaron. Revisá los pendientes de nuevo.');
    store.put({ ...state, paused: false, enabled: true, modeEpoch: createId(), status: conflicts.some(r => !r.resolvedAt) ? 'conflict' : 'idle', lastError: null });
  });
  // No network call or conflict resolution here. The user can sync explicitly.
  modeChannel?.postMessage('resumed');
  emit(); return ensureDeviceState();
}
export async function setSyncEnabled(enabled, review) {
  return enabled ? resumeSync(review) : pauseSync();
}

export function isRestoreBlocked(state) {
  return Boolean(state && state.enabled);
}

export async function syncNow(opts = {}) {
  const state = await ensureDeviceState();
  const auth = await getAuthState();
  if (isSyncPaused(state)) return { skipped: true, reason: "paused" };
  if (!state.enabled) return { skipped: true, reason: "disabled" };
  if (auth.status !== "signed_in") return { skipped: true, reason: "signed_out" };
  if (!isOnline()) {
    await patchSyncState({ status: "offline_dirty" });
    return { skipped: true, reason: "offline" };
  }
  const owner = await assertSyncOwner();
  if (inflight) {
    queued = true;
    return inflight;
  }
  inflight = (async () => {
    try {
      await patchSyncState({ status: "syncing", lastError: null, userId: auth.userId || null }, owner);
      if (state.pendingBootstrap) await discardVirginSeedIfCloudHasJournal();
      const pulled = await pullNow(owner);
      const pushed = await pushDirty(owner);
      const snap = await getSyncSnapshot();
      await patchSyncState({
        lastSyncAt: nowIso(),
        lastError: null,
        status: snap.conflicts.length ? "conflict" : "idle",
      }, owner);
      return { skipped: false, pulled, pushed, conflicts: snap.conflicts.length };
    } catch (err) {
      await patchSyncState({ status: "error", lastError: err && err.message ? err.message : String(err) }, owner).catch(() => {});
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
