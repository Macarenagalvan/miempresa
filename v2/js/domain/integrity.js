import { META_ID, JOURNAL_EDITION, SCHEMA_VERSION } from "../config.js";
import {
  StageStatus,
  Context,
  Direction,
  Strategy,
  SetupStatus,
  BlueVariant,
  Style,
  ValidationMethod,
  Verdict,
  SetupQuality,
  Lifecycle,
  Result,
  CloseType,
  VoidReason,
  WouldDoSame,
  ErrorTag,
  AccountContext,
  AccountStatus,
  Currency,
  MovementType,
  ChallengeStatus,
  PayoutKind,
  Disposition,
  Resolution,
  DeskRecordSource,
} from "./enums.js";

function assertMetaShape(meta) {
  if (!meta || meta.id !== META_ID) throw new Error("meta.id debe ser singleton");
  if (meta.journalEdition !== JOURNAL_EDITION) throw new Error("journalEdition inválido");
  if (!meta.activeStageId) throw new Error("meta.activeStageId requerido");
}

export function assertBackupMeta(meta) {
  assertMetaShape(meta);
  const schema = Number(meta.schemaVersion);
  if (!Number.isInteger(schema) || schema < 1 || schema > SCHEMA_VERSION) {
    throw new Error("schemaVersion inválido");
  }
}

export function assertMeta(meta) {
  assertMetaShape(meta);
  if (meta.schemaVersion !== SCHEMA_VERSION) throw new Error("schemaVersion inválido");
}
