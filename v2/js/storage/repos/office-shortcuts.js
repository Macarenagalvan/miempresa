import { STORES } from "../../config.js";
import { createRepo } from "./base.js";

const repo = createRepo(STORES.officeShortcuts);

export const getOfficeShortcut = repo.get;
export const putOfficeShortcut = repo.put;
export const listOfficeShortcuts = repo.getAll;
export const countOfficeShortcuts = repo.count;
