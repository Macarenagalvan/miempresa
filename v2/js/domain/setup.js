import { createId, nowIso } from "./ids.js";
import {
  Strategy,
  SetupStatus,
} from "./enums.js";
import {
  assertSetup,
  assertUnlocked,
  normalizeAsset,
  computePlannedRr,
  checklistScore,
} from "./integrity.js";
import { getSetup, putSetup, listSetups } from "../storage/repos/setups.js";
import { getObservation } from "../storage/repos/observations.js";

const EVAL_KEYS = [
  "strategy", "variant", "style", "session", "timeframes", "structure", "pattern",
  "pullbackDepth", "emaNote", "fibNote", "zone", "plannedEntry", "plannedSl",
  "plannedTp", "comment", "setupQuality", "validationMethod", "validatorVersion",
  "verdict", "checklist",
];

function emptyEval() {
  return {
    variant: null,
    style: null,
    session: null,
    timeframes: null,
    structure: null,
    pattern: null,
    pullbackDepth: null,
    emaNote: null,
    fibNote: null,
    zone: null,
    plannedEntry: null,
    plannedSl: null,
    plannedTp: null,
    plannedRr: null,
    comment: null,
    setupQuality: null,
    validationMethod: null,
    validatorVersion: null,
    verdict: null,
    checklist: [],
    checklistScore: { done: 0, total: 0, pct: 0 },
  };
}

function derive(setup) {
  setup.plannedRr = computePlannedRr(setup.direction, setup.plannedEntry, setup.plannedSl, setup.plannedTp);
  setup.checklistScore = checklistScore(setup.checklist);
  if (setup.validationMethod !== "GROK_VALIDATOR") setup.validatorVersion = setup.validatorVersion || null;
  if (setup.strategy !== Strategy.BLUE) setup.variant = null;
  return setup;
}

export async function createSetup(input, stageId) {
  let observationId = input.observationId || null;
  if (observationId) {
    const obs = await getObservation(observationId);
    if (!obs) throw new Error("observation origen no existe");
  }
  const now = nowIso();
  const setup = derive({
    id: createId(),
    stageId,
    recordSource: "MANUAL",
    asset: normalizeAsset(input.asset),
    context: input.context,
    direction: input.direction,
    strategy: Strategy.UNCLASSIFIED,
    status: SetupStatus.WATCHING,
    ...emptyEval(),
    observationId,
    deskSignalId: null,
    validationLockedAt: null,
    takenAt: null,
    amendedAfterLock: false,
    amendReason: null,
    createdAt: now,
    updatedAt: now,
  });
  assertSetup(setup);
  await putSetup(setup);
  return setup;
}

export async function updateSetup(id, patch, opts = {}) {
  const current = await getSetup(id);
  if (!current) throw new Error("setup no existe");
  const touchesEval = EVAL_KEYS.some((k) => Object.prototype.hasOwnProperty.call(patch, k));
  if (touchesEval && current.validationLockedAt && !opts.amend) {
    assertUnlocked(current);
  }
  const next = derive({
    ...current,
    ...patch,
    id: current.id,
    stageId: current.stageId,
    observationId: current.observationId,
    recordSource: current.recordSource,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  });
  if (patch.asset != null) next.asset = normalizeAsset(patch.asset);
  if (patch.checklist != null) next.checklist = patch.checklist;
  assertSetup(next);
  await putSetup(next);
  return next;
}

export async function evaluateSetup(id, patch) {
  return updateSetup(id, patch);
}

export async function closeSetupStatus(id, status) {
  if (status !== SetupStatus.DISCARDED && status !== SetupStatus.EXPIRED) {
    throw new Error("solo DISCARDED o EXPIRED cierran el setup en Slice 2");
  }
  const current = await getSetup(id);
  if (!current) throw new Error("setup no existe");
  const next = derive({
    ...current,
    status,
    validationLockedAt: current.validationLockedAt || nowIso(),
    updatedAt: nowIso(),
  });
  assertSetup(next);
  await putSetup(next);
  return next;
}

export async function listActiveSetups(stageId, asset) {
  const all = await listSetups();
  return all
    .filter((s) => s.stageId === stageId)
    .filter((s) => !asset || s.asset === normalizeAsset(asset))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listSetupsForObservation(observationId) {
  const all = await listSetups();
  return all.filter((s) => s.observationId === observationId);
}

export async function lockSetupOnTrade(setupId) {
  const current = await getSetup(setupId);
  if (!current) throw new Error("setup no existe");
  if (current.validationLockedAt) return current;
  const next = derive({
    ...current,
    validationLockedAt: nowIso(),
    updatedAt: nowIso(),
  });
  assertSetup(next);
  await putSetup(next);
  return next;
}
