import { STORES, STORE_INDEXES, OFFICE_COLLECTIONS } from "../config.js";

const V1_STORE_NAMES = [
  STORES.meta,
  STORES.stages,
  STORES.accounts,
  STORES.movements,
  STORES.observations,
  STORES.setups,
  STORES.trades,
  STORES.asrs,
  STORES.signals,
  STORES.challenges,
  STORES.payouts,
  STORES.attachments,
];

export function applyMigrations(db, oldVersion, newVersion) {
  if (oldVersion < 1 && newVersion >= 1) {
    migrateTo1(db);
  }
  if (oldVersion < 2 && newVersion >= 2) {
    migrateTo2(db);
  }
  if (oldVersion < 3 && newVersion >= 3) {
    migrateTo3(db);
  }
}

function createStoreIfMissing(db, name) {
  if (db.objectStoreNames.contains(name)) return;
  const store = db.createObjectStore(name, { keyPath: "id" });
  const indexes = STORE_INDEXES[name] || [];
  for (const [indexName, keyPath, options] of indexes) {
    store.createIndex(indexName, keyPath, options);
  }
}

function migrateTo1(db) {
  for (const name of V1_STORE_NAMES) {
    createStoreIfMissing(db, name);
  }
}

function migrateTo2(db) {
  for (const name of OFFICE_COLLECTIONS) {
    createStoreIfMissing(db, name);
  }
}

function migrateTo3(db) {
  createStoreIfMissing(db, STORES.syncState);
  createStoreIfMissing(db, STORES.syncLedger);
  createStoreIfMissing(db, STORES.syncConflicts);
}
