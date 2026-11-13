import { PRODUCT_SYNC_STORES } from "../../config.js";
import { withStore, withStores, requestToPromise } from "../db.js";
import { isApplying } from "../../services/sync-apply.js";

import { dirtyVersion } from '../sync-version.js';

async function writeVersion(storeName, id, record, tombstone) {
  const tracked = PRODUCT_SYNC_STORES.includes(storeName) && !isApplying();
  await withStores(tracked ? [storeName, 'syncLedger'] : [storeName], 'readwrite', async tx => {
    const store = tx.objectStore(storeName);
    if (tracked) {
      const ledger = tx.objectStore('syncLedger');
      const old = await requestToPromise(ledger.get(storeName + '::' + id));
      ledger.put(dirtyVersion(storeName, id, old, tombstone));
    }
    if (tombstone) store.delete(id); else store.put(record);
  });
  if (tracked) import('../../services/sync-engine.js').then(m => m.scheduleSync()).catch(() => {});
}


export function createRepo(storeName) {
  return {
    storeName,
    async get(id) {
      return withStore(storeName, "readonly", (store) => requestToPromise(store.get(id)));
    },
    async put(record) {
      await writeVersion(storeName, record.id, record, false);
      return record;
    },
    async getAll() {
      return withStore(storeName, "readonly", (store) => requestToPromise(store.getAll()));
    },
    async count() {
      return withStore(storeName, "readonly", (store) => requestToPromise(store.count()));
    },
    async delete(id) {
      await writeVersion(storeName, id, null, true);
    },
  };
}
