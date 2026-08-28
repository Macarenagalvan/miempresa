import { STORES } from "../../config.js";
import { createRepo } from "./base.js";

const repo = createRepo(STORES.stages);

export const getStage = repo.get;
export const putStage = repo.put;
export const listStages = repo.getAll;
export const countStages = repo.count;
