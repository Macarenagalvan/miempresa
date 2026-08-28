import { STORES } from "../../config.js";
import { createRepo } from "./base.js";
import { withStore, requestToPromise } from "../db.js";

const repo = createRepo(STORES.asrs);

export const getAsr = repo.get;
export const putAsr = repo.put;
export const listAsrs = repo.getAll;
export const countAsrs = repo.count;

export async function getAsrByTradeId(tradeId) {
  if (!tradeId) return undefined;
  return withStore(STORES.asrs, "readonly", (store) => {
    const idx = store.index("tradeId");
    return requestToPromise(idx.get(tradeId));
  });
}
