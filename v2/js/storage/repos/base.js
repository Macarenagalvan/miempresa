import { withStore, requestToPromise } from "../db.js";

export function createRepo(storeName) {
  return {
    storeName,
    async get(id) {
      return withStore(storeName, "readonly", (store) => requestToPromise(store.get(id)));
    },
    async put(record) {
      await withStore(storeName, "readwrite", (store) => requestToPromise(store.put(record)));
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
    },
  };
}
