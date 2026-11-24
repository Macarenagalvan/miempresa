import { STORES } from "../../config.js";
import { createRepo } from "./base.js";

const repo = createRepo(STORES.signals);

export const getSignal = repo.get;
export const putSignal = repo.put;
export const listSignals = repo.getAll;
export const countSignals = repo.count;
