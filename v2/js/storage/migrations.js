import { STORES, STORE_INDEXES } from "../config.js";

export function applyMigrations(db, oldVersion, newVersion) {
  if (oldVersion < 1 && newVersion >= 1) {
    migrateTo1(db);
  }
}

function migrateTo1(db) {
  for (const name of Object.values(STORES)) {
    if (db.objectStoreNames.contains(name)) continue;
    const store = db.createObjectStore(name, { keyPath: "id" });
    const indexes = STORE_INDEXES[name] || [];
    for (const [indexName, keyPath, options] of indexes) {
      store.createIndex(indexName, keyPath, options);
    }
  }
}
