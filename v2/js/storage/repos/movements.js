import { STORES } from "../../config.js";
import { createRepo } from "./base.js";

const repo = createRepo(STORES.movements);

export const getMovement = repo.get;
export const putMovement = repo.put;
export const listMovements = repo.getAll;
export const countMovements = repo.count;
