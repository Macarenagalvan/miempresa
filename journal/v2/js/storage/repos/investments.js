import { STORES } from "../../config.js";
import { createRepo } from "./base.js";

const repo = createRepo(STORES.investments);

export const getInvestment = repo.get;
export const putInvestment = repo.put;
export const listInvestments = repo.getAll;
export const deleteInvestment = repo.delete;
