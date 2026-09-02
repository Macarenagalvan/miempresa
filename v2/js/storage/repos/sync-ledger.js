import { STORES } from "../../config.js";
import { createRepo } from "./base.js";

const repo = createRepo(STORES.syncLedger);

export function ledgerId(entityType, entityId) {
  return String(entityType) + "::" + String(entityId);
}

export async function getLedgerEntry(entityType, entityId) {
  return repo.get(ledgerId(entityType, entityId));
}

export async function putLedgerEntry(entry) {
  const id = ledgerId(entry.entityType, entry.entityId);
  return repo.put({ ...entry, id });
}

export async function listLedger() {
  return repo.getAll();
}

export async function deleteLedgerEntry(entityType, entityId) {
  return repo.delete(ledgerId(entityType, entityId));
}
