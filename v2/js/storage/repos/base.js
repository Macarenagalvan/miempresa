import { PRODUCT_SYNC_STORES } from "../../config.js";
import { withStore, requestToPromise } from "../db.js";
import { isApplying } from "../../services/sync-apply.js";

async function trackMutation(storeName, id, tombstone) {
  if (isApplying()) return;
  if (!PRODUCT_SYNC_STORES.includes(storeName) || id == null || id === "") return;
  const { noteLocalMutation } = await import("../../services/sync-engine.js");
  await noteLocalMutation(storeName, id, { tombstone: Boolean(tombstone) });
}

export function createRepo(storeName) {
  return {
    storeName,
    async get(id) {
      return withStore(storeName, "readonly", (store) => requestToPromise(store.get(id)));
    },
    async put(record) {
      await withStore(storeName, "readwrite", (store) => requestToPromise(store.put(record)));
      if (record && record.id != null) await trackMutation(storeName, record.id, false);
      return record;
    },
    async getAll() {
      return withStore(storeName, "readonly", (store) => requestToPromise(store.getAll()));
    },
    async count() {
      return withStore(storeName, "readonly", (store) => requestToPromise(store.count()));
    },
    async delete(id) {
      await withStore(storeName, "readwrite", (store) => requestToPromise(store.delete(id)));
      await trackMutation(storeName, id, true);
    },
  };
}
