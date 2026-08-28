import { STORES } from "../../config.js";
import { createRepo } from "./base.js";

const repo = createRepo(STORES.accounts);

export const getAccount = repo.get;
export const putAccount = repo.put;
export const listAccounts = repo.getAll;
export const countAccounts = repo.count;
