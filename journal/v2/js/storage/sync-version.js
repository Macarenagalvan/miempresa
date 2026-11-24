import { withSyncStores } from '../services/sync-mode.js';
import { withStores, requestToPromise } from './db.js';
import { createId, nowIso } from '../domain/ids.js';
import { applyRemoteMeta } from '../domain/sync-meta.js';

export function dirtyVersion(entityType, entityId, old, tombstone = false) {
  return { ...old, id: entityType + '::' + entityId, entityType, entityId: String(entityId),
    cloudRevision: Number(old?.cloudRevision || 0), localVersion: createId(),
    dirty: true, tombstone, localChangedAt: nowIso() };
}
export async function syncSnapshot(entityType, entityId) {
  return withStores([entityType, 'syncLedger'], 'readonly', async tx => ({
    local: await requestToPromise(tx.objectStore(entityType).get(entityId)),
    entry: await requestToPromise(tx.objectStore('syncLedger').get(entityType + '::' + entityId)),
  }));
}
export function sameVersion(a, b) {
  return Boolean(a && b && (a.localVersion || a.localChangedAt) === (b.localVersion || b.localChangedAt)
    && a.tombstone === b.tombstone && a.cloudRevision === b.cloudRevision);
}
// ACK changes metadata only, never the user's record. New edits keep their token.
export async function acknowledgePush(entry, revision, owner) {
  return withSyncStores(['syncLedger'], owner, async tx => {
    const store = tx.objectStore('syncLedger');
    const current = await requestToPromise(store.get(entry.id));
    if (!current || Number(current.cloudRevision) >= Number(revision)) return false;
    const unchanged = sameVersion(current, entry);
    store.put({ ...current, cloudRevision: Number(revision), dirty: !unchanged });
    return unchanged;
  });
}

// Compare and apply inside one IndexedDB transaction; concurrent local edits win.
export async function applyCloudVersion(entityType, entityId, payload, tombstone, expected, revision, owner, replaceId = null) {
  return withSyncStores([entityType, 'syncLedger'], owner, async tx => {
    const store = tx.objectStore(entityType), ledger = tx.objectStore('syncLedger');
    const id = entityType + '::' + entityId;
    const current = await requestToPromise(ledger.get(id));
    if (expected ? !sameVersion(current, expected) || current.dirty !== expected.dirty : Boolean(current)) return false;
    if (replaceId && replaceId !== entityId) {
      const other = await requestToPromise(ledger.get(entityType + '::' + replaceId));
      if (other?.dirty) return false;
      store.delete(replaceId);
    }
    if (tombstone) { if (entityType !== 'meta') store.delete(entityId); }
    else {
      if (payload?.id !== entityId) throw new Error('Identidad de registro remoto inválida.');
      const record = entityType === 'meta' ? applyRemoteMeta(await requestToPromise(store.get(entityId)), payload) : payload;
      store.put(record);
    }
    ledger.put({ ...current, id, entityType, entityId, cloudRevision: Number(revision), dirty: false,
      tombstone, localChangedAt: nowIso(), localVersion: createId() });
    return true;
  });
}
