import { DB_NAME, DB_VERSION } from "../config.js";
import { applyMigrations } from "./migrations.js";

let opening = null;

export function openDb() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      applyMigrations(req.result, event.oldVersion || 0, req.result.version);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("no se pudo abrir JournalV2"));
  });
  return opening;
}

export async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    Promise.resolve(fn(store, tx)).then(resolve, reject);
    tx.onerror = () => reject(tx.error);
  });
}

export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listStoreNames() {
  const db = await openDb();
  return Array.from(db.objectStoreNames);
}
