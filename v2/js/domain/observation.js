import { createId, nowIso } from "./ids.js";
import { assertObservation, normalizeAsset } from "./integrity.js";
import {
  getObservation,
  putObservation,
  listObservations,
} from "../storage/repos/observations.js";

function todayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function emptyOptionals() {
  return {
    timeframe: null,
    session: null,
    priceBehavior: null,
    pullback: null,
    emaReaction: null,
    fibReaction: null,
    pattern: null,
    srBehavior: null,
    tags: [],
  };
}

export function defaultObservationDate() {
  return todayIsoDate();
}

export async function createObservation(input, stageId) {
  const now = nowIso();
  const obs = {
    id: createId(),
    stageId,
    recordSource: "MANUAL",
    context: "BACKTEST",
    asset: normalizeAsset(input.asset),
    date: input.date || todayIsoDate(),
    note: String(input.note || "").trim(),
    ...emptyOptionals(),
    promotedSetupId: null,
    archived: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  assertObservation(obs);
  await putObservation(obs);
  return obs;
}

export async function updateObservation(id, patch) {
  const current = await getObservation(id);
  if (!current) throw new Error("observation no existe");
  const next = {
    ...current,
    ...patch,
    id: current.id,
    stageId: current.stageId,
    recordSource: current.recordSource,
    context: current.context,
    promotedSetupId: current.promotedSetupId,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  };
  if (patch.asset != null) next.asset = normalizeAsset(patch.asset);
  if (patch.note != null) next.note = String(patch.note).trim();
  if (patch.tags != null) next.tags = Array.isArray(patch.tags) ? patch.tags.filter(Boolean) : [];
  assertObservation(next);
  await putObservation(next);
  return next;
}

export async function archiveObservation(id) {
  return updateObservation(id, { archived: true, archivedAt: nowIso() });
}

export async function listActiveObservations(stageId, asset) {
  const all = await listObservations();
  return all
    .filter((o) => o.stageId === stageId)
    .filter((o) => !o.archived)
    .filter((o) => !asset || o.asset === normalizeAsset(asset))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
}
