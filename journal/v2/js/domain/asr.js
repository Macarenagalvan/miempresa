import { createId, nowIso } from "./ids.js";
import { Lifecycle } from "./enums.js";
import { assertAsr } from "./integrity.js";
import { getTrade } from "../storage/repos/trades.js";
import { getAsr, putAsr, listAsrs, getAsrByTradeId } from "../storage/repos/asrs.js";

function todayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function emptyText(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function normalizeAsr(asr) {
  asr.conclusion = String(asr.conclusion || "").trim();
  asr.processNote = emptyText(asr.processNote);
  asr.executionNote = emptyText(asr.executionNote);
  asr.riskNote = emptyText(asr.riskNote);
  asr.psychologyNote = emptyText(asr.psychologyNote);
  asr.errorTag = emptyText(asr.errorTag);
  asr.setupId = asr.setupId || null;
  return asr;
}

export function isAsrPending(trade, asr) {
  return Boolean(trade && trade.lifecycle === Lifecycle.CLOSED && !asr);
}

export function asrStatusLabel(trade, asr) {
  if (!trade || trade.lifecycle === Lifecycle.VOID) return "";
  if (trade.lifecycle !== Lifecycle.CLOSED) return "";
  return asr ? "ASR hecho" : "ASR pendiente";
}

export function summarizeAsrs(asrs) {
  const list = Array.isArray(asrs) ? asrs : [];
  const wouldDoSame = { YES: 0, NO: 0, PARTLY: 0 };
  const errorTag = { NO_ERROR: 0, PROCESS: 0, EXECUTION: 0, RISK: 0, PSYCHOLOGY: 0 };
  let missingTag = 0;
  for (const row of list) {
    if (wouldDoSame[row.wouldDoSame] != null) wouldDoSame[row.wouldDoSame] += 1;
    if (!row.errorTag) missingTag += 1;
    else if (errorTag[row.errorTag] != null) errorTag[row.errorTag] += 1;
  }
  return { total: list.length, wouldDoSame, errorTag, missingTag };
}

export async function createAsr(input, stageId) {
  if (!input || !input.tradeId) throw new Error("asr.tradeId requerido");
  const trade = await getTrade(input.tradeId);
  if (!trade) throw new Error("trade no existe");
  if (trade.lifecycle !== Lifecycle.CLOSED) throw new Error("ASR solo sobre Trade CLOSED");
  const existing = await getAsrByTradeId(trade.id);
  if (existing) throw new Error("ya existe ASR de este Trade");
  const now = nowIso();
  const asr = normalizeAsr({
    id: createId(),
    stageId: stageId || trade.stageId,
    recordSource: "MANUAL",
    tradeId: trade.id,
    setupId: trade.setupId || null,
    date: input.date || todayIsoDate(),
    wouldDoSame: input.wouldDoSame,
    conclusion: input.conclusion,
    processNote: input.processNote,
    executionNote: input.executionNote,
    riskNote: input.riskNote,
    psychologyNote: input.psychologyNote,
    errorTag: input.errorTag,
    createdAt: now,
    updatedAt: now,
  });
  assertAsr(asr);
  await putAsr(asr);
  return asr;
}

export async function updateAsr(id, patch) {
  const current = await getAsr(id);
  if (!current) throw new Error("asr no existe");
  const next = normalizeAsr({
    ...current,
    ...patch,
    id: current.id,
    stageId: current.stageId,
    tradeId: current.tradeId,
    setupId: current.setupId,
    recordSource: current.recordSource,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  });
  assertAsr(next);
  await putAsr(next);
  return next;
}

export async function asrForTrade(tradeId) {
  return getAsrByTradeId(tradeId);
}

export async function listStageAsrs(stageId) {
  const all = await listAsrs();
  return all.filter((row) => !stageId || row.stageId === stageId);
}
