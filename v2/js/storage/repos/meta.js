import { META_ID, STORES } from "../../config.js";
import { createRepo } from "./base.js";

const repo = createRepo(STORES.meta);

export async function getMeta() {
  return repo.get(META_ID);
}

export async function putMeta(meta) {
  return repo.put({ ...meta, id: META_ID });
}
