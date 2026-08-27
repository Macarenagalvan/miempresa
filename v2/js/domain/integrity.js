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

export function normalizeAsset(raw) {
  if (raw == null) return "";
  const value = String(raw).trim().toUpperCase().replace(/\s+/g, "");
  if (value === "S&P500" || value === "SPX" || value === "US500") return "SP500";
  return value;
}

export function assertObservation(obs) {
  if (!obs || !obs.id) throw new Error("observation.id requerido");
  if (!obs.stageId) throw new Error("observation.stageId requerido");
  const asset = normalizeAsset(obs.asset);
  if (!asset) throw new Error("asset requerido");
  if (!obs.note || !String(obs.note).trim()) throw new Error("note requerido");
  if (!obs.date || !/^\d{4}-\d{2}-\d{2}$/.test(obs.date)) throw new Error("date inválida");
  if (obs.session && !["SYDNEY", "TOKYO", "LONDON", "NEW_YORK"].includes(obs.session)) {
    throw new Error("session inválida");
  }
}
