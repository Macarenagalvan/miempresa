import { STORES } from "../../config.js";
import { createRepo } from "./base.js";

export const attachmentsRepo = createRepo(STORES.attachments);
