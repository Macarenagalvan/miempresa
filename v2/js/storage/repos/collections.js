import { EXPORT_COLLECTIONS, STORES } from "../../config.js";
import { createRepo } from "./base.js";

const repos = {};
for (const name of EXPORT_COLLECTIONS) {
  repos[name] = createRepo(STORES[name]);
}

export async function dumpCollections() {
  const out = {};
  for (const name of EXPORT_COLLECTIONS) {
    out[name] = await repos[name].getAll();
  }
  return out;
}

export async function countCollection(name) {
  return repos[name].count();
}

export function repoFor(name) {
  return repos[name];
}
