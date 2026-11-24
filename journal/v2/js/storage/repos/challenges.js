import { STORES } from "../../config.js";
import { createRepo } from "./base.js";

const repo = createRepo(STORES.challenges);

export const getChallenge = repo.get;
export const putChallenge = repo.put;
export const listChallenges = repo.getAll;
export const countChallenges = repo.count;
