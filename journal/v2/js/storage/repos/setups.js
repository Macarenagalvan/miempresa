import { STORES } from "../../config.js";
import { createRepo } from "./base.js";

const repo = createRepo(STORES.setups);

export const getSetup = repo.get;
export const putSetup = repo.put;
export const listSetups = repo.getAll;
export const countSetups = repo.count;
