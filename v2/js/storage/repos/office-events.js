import { STORES } from "../../config.js";
import { createRepo } from "./base.js";

const repo = createRepo(STORES.officeEvents);

export const getOfficeEvent = repo.get;
export const putOfficeEvent = repo.put;
export const listOfficeEvents = repo.getAll;
export const countOfficeEvents = repo.count;
