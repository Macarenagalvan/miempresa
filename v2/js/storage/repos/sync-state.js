import { STORES, SYNC_STATE_ID } from "../../config.js";
import { createRepo } from "./base.js";

const repo = createRepo(STORES.syncState);

export async function getSyncStateRow() {
  return repo.get(SYNC_STATE_ID);
}

export async function putSyncStateRow(row) {
  return repo.put({ ...row, id: SYNC_STATE_ID });
}
