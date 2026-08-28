import { STORES } from "../../config.js";
import { createRepo } from "./base.js";

const repo = createRepo(STORES.observations);

export const getObservation = repo.get;
export const putObservation = repo.put;
export const listObservations = repo.getAll;
export const countObservations = repo.count;
