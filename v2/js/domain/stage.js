import {
  JOURNAL_EDITION,
  SCHEMA_VERSION,
  INITIAL_STAGE_NAME,
} from "../config.js";
import { createId, nowIso } from "./ids.js";
import { StageStatus } from "./enums.js";
import { assertMeta, assertStage, assertSingleActive } from "./integrity.js";
import { getMeta, putMeta } from "../storage/repos/meta.js";
import { getStage, putStage, listStages } from "../storage/repos/stages.js";

export async function ensureJournalSeed() {
  const existing = await getMeta();
  if (existing) {
    assertMeta(existing);
    const stage = await getStage(existing.activeStageId);
    if (!stage) throw new Error("Stage activa referenciada no existe");
    assertStage(stage);
    const all = await listStages();
    assertSingleActive(all);
    return { meta: existing, stage };
  }

  const now = nowIso();
  const stage = {
    id: createId(),
    name: INITIAL_STAGE_NAME,
    status: StageStatus.ACTIVE,
    startedAt: now,
    endedAt: null,
    resetReason: null,
    backupRef: null,
  };
  assertStage(stage);
  await putStage(stage);

  const meta = {
    id: "singleton",
    schemaVersion: SCHEMA_VERSION,
    journalEdition: JOURNAL_EDITION,
    activeStageId: stage.id,
    traderName: "",
    createdAt: now,
    lastBackupAt: null,
    activeAccountId: null,
  };
  assertMeta(meta);
  await putMeta(meta);
  return { meta, stage };
}
