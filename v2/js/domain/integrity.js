import { META_ID, JOURNAL_EDITION, SCHEMA_VERSION } from "../config.js";
import { StageStatus } from "./enums.js";

export function assertMeta(meta) {
  if (!meta || meta.id !== META_ID) throw new Error("meta.id debe ser singleton");
  if (meta.journalEdition !== JOURNAL_EDITION) throw new Error("journalEdition inválido");
  if (meta.schemaVersion !== SCHEMA_VERSION) throw new Error("schemaVersion inválido");
  if (!meta.activeStageId) throw new Error("meta.activeStageId requerido");
}

export function assertStage(stage) {
  if (!stage || !stage.id) throw new Error("stage.id requerido");
  if (!stage.name) throw new Error("stage.name requerido");
  if (stage.status !== StageStatus.ACTIVE && stage.status !== StageStatus.ARCHIVED) {
    throw new Error("stage.status inválido");
  }
}

export function assertSingleActive(stages) {
  const active = stages.filter((s) => s.status === StageStatus.ACTIVE);
  if (active.length !== 1) throw new Error("debe existir exactamente una Stage ACTIVE");
}
