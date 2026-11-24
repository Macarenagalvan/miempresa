import { STORES } from "../../config.js";
import { createRepo } from "./base.js";

const repo = createRepo(STORES.trades);

export const getTrade = repo.get;
export const putTrade = repo.put;
export const listTrades = repo.getAll;
export const countTrades = repo.count;
