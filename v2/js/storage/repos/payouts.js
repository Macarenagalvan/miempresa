import { STORES } from "../../config.js";
import { createRepo } from "./base.js";

const repo = createRepo(STORES.payouts);

export const getPayout = repo.get;
export const putPayout = repo.put;
export const listPayouts = repo.getAll;
export const countPayouts = repo.count;
