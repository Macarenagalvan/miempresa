import { STORES } from "../../config.js";
import { createRepo } from "./base.js";

const repo = createRepo(STORES.officeNotes);

export const getOfficeNote = repo.get;
export const putOfficeNote = repo.put;
export const listOfficeNotes = repo.getAll;
export const countOfficeNotes = repo.count;
