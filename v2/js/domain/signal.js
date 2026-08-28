import { createId, nowIso } from "./ids.js";
import { Context, Disposition, Resolution } from "./enums.js";
import {
  assertDeskSignal,
  assertPrintImmutable,
  DESK_PRINT_KEYS,
  isDeskResolved,
  normalizeAsset,
} from "./integrity.js";
import { getSignal, putSignal, listSignals } from "../storage/repos/signals.js";
import { getSetup } from "../storage/repos/setups.js";
import { getTrade } from "../storage/repos/trades.js";

const FIXTURE_NOTE = "SLICE9_FIXTURE";

function sourceRefOf(input) {
  const raw = input && input.sourceRef ? input.sourceRef : {};
  return {
    rgmSignalId: raw.rgmSignalId || null,
    rgmPrintAt: raw.rgmPrintAt || null,
    manualNote: raw.manualNote || FIXTURE_NOTE,
  };
}

function snapshotOf(input) {
  if (!input || input.snapshot == null) return null;
  if (typeof input.snapshot === "object") return { ...input.snapshot };
  return null;
}

async function assertLinks(setupId, tradeId) {
  if (setupId) {
    const setup = await getSetup(setupId);
    if (!setup) throw new Error("setup no existe");
  }
  if (tradeId) {
    const trade = await getTrade(tradeId);
    if (!trade) throw new Error("trade no existe");
  }
}

export async function createDeskSignalFromFixture(input, stageId) {
  if (!input) throw new Error("fixture requerido");
  const now = nowIso();
  const resolution = input.resolution || Resolution.OPEN;
  const sig = {
    id: input.id || createId(),
    stageId,
    recordSource: "MANUAL",
    context: input.context || Context.LIVE,
    asset: normalizeAsset(input.asset),
    brokerSymbol: input.brokerSymbol ? String(input.brokerSymbol).trim() : null,
    direction: input.direction,
    printedAt: input.printedAt || now,
    disposition: input.disposition || Disposition.NONE,
    resolution,
    resolvedAt: input.resolvedAt || (isDeskResolved(resolution) ? now : null),
    setupId: input.setupId || null,
    tradeId: input.tradeId || null,
    sourceRef: sourceRefOf(input),
    snapshot: snapshotOf(input),
    note: input.note ? String(input.note).trim() : null,
    createdAt: now,
    updatedAt: now,
  };
  await assertLinks(sig.setupId, sig.tradeId);
  assertDeskSignal(sig);
  await putSignal(sig);
  return sig;
}

export async function updateSignalFollowup(id, patch) {
  const current = await getSignal(id);
  if (!current) throw new Error("signal no existe");
  if (!patch) patch = {};
  for (const key of DESK_PRINT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)
      && JSON.stringify(patch[key] ?? null) !== JSON.stringify(current[key] ?? null)) {
      throw new Error("print original inmutable: " + key);
    }
  }
  const resolution = patch.resolution !== undefined ? patch.resolution : current.resolution;
  let resolvedAt = current.resolvedAt || null;
  if (patch.resolvedAt !== undefined) {
    resolvedAt = patch.resolvedAt || null;
  } else if (resolution === Resolution.OPEN) {
    resolvedAt = null;
  } else if (current.resolution === Resolution.OPEN && isDeskResolved(resolution)) {
    resolvedAt = nowIso();
  }
  const setupId = patch.setupId !== undefined ? (patch.setupId || null) : current.setupId;
  const tradeId = patch.tradeId !== undefined ? (patch.tradeId || null) : current.tradeId;
  await assertLinks(setupId, tradeId);
  const next = {
    ...current,
    disposition: patch.disposition !== undefined ? patch.disposition : current.disposition,
    resolution,
    resolvedAt,
    setupId,
    tradeId,
    note: patch.note !== undefined ? (patch.note ? String(patch.note).trim() : null) : current.note,
    updatedAt: nowIso(),
  };
  assertPrintImmutable(current, next);
  assertDeskSignal(next);
  await putSignal(next);
  return next;
}

export async function listStageSignals(stageId, opts = {}) {
  const all = await listSignals();
  return filterSignals(all, { ...opts, stageId });
}

export function filterSignals(signals, filters = {}) {
  const asset = filters.asset ? normalizeAsset(filters.asset) : "";
  const from = filters.from || "";
  const to = filters.to || "";
  return (signals || [])
    .filter((s) => {
      if (filters.stageId && s.stageId !== filters.stageId) return false;
      if (asset && normalizeAsset(s.asset) !== asset) return false;
      if (filters.direction && s.direction !== filters.direction) return false;
      if (filters.disposition && s.disposition !== filters.disposition) return false;
      if (filters.resolution && s.resolution !== filters.resolution) return false;
      if (from || to) {
        const day = String(s.printedAt || "").slice(0, 10);
        if (from && day < from) return false;
        if (to && day > to) return false;
      }
      return true;
    })
    .sort((a, b) => String(b.printedAt || "").localeCompare(String(a.printedAt || "")));
}
