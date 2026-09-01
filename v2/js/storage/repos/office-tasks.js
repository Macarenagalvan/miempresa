import { STORES } from "../../config.js";
import { createRepo } from "./base.js";

const repo = createRepo(STORES.officeTasks);

export const getOfficeTask = repo.get;
export const putOfficeTask = repo.put;
export const listOfficeTasks = repo.getAll;
export const countOfficeTasks = repo.count;
