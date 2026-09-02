import { STORES } from "../../config.js";
import { createRepo } from "./base.js";

const repo = createRepo(STORES.syncConflicts);

export function conflictId(entityType, entityId) {
  return String(entityType) + "::" + String(entityId);
}

export async function getConflict(entityType, entityId) {
  return repo.get(conflictId(entityType, entityId));
}

export async function putConflict(row) {
  const id = conflictId(row.entityType, row.entityId);
  return repo.put({ ...row, id });
}

export async function listConflicts() {
  return repo.getAll();
}

export async function deleteConflict(entityType, entityId) {
  return repo.delete(conflictId(entityType, entityId));
}
