import { PRODUCT_SYNC_STORES } from "../../config.js";
import { withStore, withStores, requestToPromise } from "../db.js";
import { isApplying } from "../../services/sync-apply.js";

import { dirtyVersion } from '../sync-version.js';

async function writeVersion(storeName, id, record, tombstone) {
  const tracked = PRODUCT_SYNC_STORES.includes(storeName) && !isApplying();
  await withStores([...new Set([storeName, ...(tracked ? ['syncLedger'] : []), ...(['trades', 'attachments'].includes(storeName) ? ['observations'] : [])])], 'readwrite', async tx => {
    const store = tx.objectStore(storeName);
    if (storeName === 'trades' && (await requestToPromise(store.get(id)))?.studyConversion) throw new Error('Original protegido: revertí la conversión desde el estudio antes de editarlo.');
    if (storeName === 'attachments') {
      const observations = await requestToPromise(tx.objectStore('observations').getAll());
      if (observations.some(o => o.recovery && (o.recovery.attachmentIds.includes(id) || (record?.entityType === 'trade' && record.entityId === o.recovery.tradeId)))) throw new Error('Captura original protegida por la recuperación histórica.');
    }
    if (storeName === 'observations') {
      const old = await requestToPromise(store.get(id));
      if (old?.recovery && (tombstone || JSON.stringify(old.recovery) !== JSON.stringify(record.recovery) || old.archived !== record.archived)) throw new Error('El vínculo de recuperación solo se modifica mediante conversión o reversión.');
    }
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
