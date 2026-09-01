import { createId, nowIso } from "./ids.js";
import {
  getOfficeShortcut,
  putOfficeShortcut,
  listOfficeShortcuts,
} from "../storage/repos/office-shortcuts.js";

function normalizeLabel(raw) {
  const value = String(raw || "").trim();
  if (!value) throw new Error("label requerido");
  return value;
}

export function normalizeShortcutUrl(raw) {
  const value = String(raw == null ? "" : raw).trim();
  if (!value) throw new Error("url requerida");
  const lower = value.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:") || lower.startsWith("blob:") || lower.startsWith("file:")) {
    throw new Error("url inválida");
  }
  if (!/^https?:\/\//i.test(value)) {
    throw new Error("url inválida · usá http:// o https://");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch (err) {
    throw new Error("url inválida");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("url inválida");
  }
  return value;
}

export function assertOfficeShortcut(item) {
  if (!item || !item.id) throw new Error("shortcut.id requerido");
  if (item.stageId != null && item.stageId !== "") throw new Error("OfficeShortcut no lleva stageId");
  const label = String(item.label || "").trim();
  if (!label) throw new Error("label requerido");
  normalizeShortcutUrl(item.url);
  if (!Number.isFinite(Number(item.order))) throw new Error("order inválido");
  if (!item.createdAt) throw new Error("createdAt requerido");
  if (!item.updatedAt) throw new Error("updatedAt requerido");
}

export function createOfficeShortcut(input = {}) {
  const now = nowIso();
  const item = {
    id: createId(),
    label: normalizeLabel(input.label),
    url: normalizeShortcutUrl(input.url),
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : 0,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  assertOfficeShortcut(item);
  return item;
}

export function isActiveShortcut(item) {
  return Boolean(item) && !item.archivedAt;
}

export function compareShortcuts(a, b) {
  const ao = Number(a && a.order);
  const bo = Number(b && b.order);
  if (ao !== bo) return ao < bo ? -1 : 1;
  return (a.createdAt || "") < (b.createdAt || "") ? -1 : 1;
}

export async function listHoyShortcuts() {
  const all = await listOfficeShortcuts();
  return all.filter(isActiveShortcut).sort(compareShortcuts);
}

async function nextOrder() {
  const active = await listHoyShortcuts();
  if (!active.length) return 0;
  return active.reduce((max, item) => Math.max(max, Number(item.order) || 0), 0) + 1;
}

export async function addOfficeShortcut(input = {}) {
  const order = Object.prototype.hasOwnProperty.call(input, "order")
    ? Number(input.order)
    : await nextOrder();
  const item = createOfficeShortcut({ ...input, order });
  await putOfficeShortcut(item);
  return item;
}

export async function updateOfficeShortcut(id, patch = {}) {
  const current = await getOfficeShortcut(id);
  if (!current) throw new Error("shortcut no existe");
  if (current.archivedAt) throw new Error("shortcut archivado");
  const next = {
    ...current,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  };
  if (Object.prototype.hasOwnProperty.call(patch, "label")) {
    next.label = normalizeLabel(patch.label);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "url")) {
    next.url = normalizeShortcutUrl(patch.url);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "order")) {
    next.order = Number(patch.order);
  }
  delete next.stageId;
  assertOfficeShortcut(next);
  await putOfficeShortcut(next);
  return next;
}

export async function archiveOfficeShortcut(id) {
  const current = await getOfficeShortcut(id);
  if (!current) throw new Error("shortcut no existe");
  if (current.archivedAt) return current;
  const next = {
    ...current,
    archivedAt: nowIso(),
    updatedAt: nowIso(),
  };
  delete next.stageId;
  assertOfficeShortcut(next);
  await putOfficeShortcut(next);
  return next;
}

export async function moveOfficeShortcut(id, direction) {
  const delta = direction === "up" || direction === -1 ? -1 : 1;
  const active = await listHoyShortcuts();
  const index = active.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("shortcut no existe");
  const swapWith = index + delta;
  if (swapWith < 0 || swapWith >= active.length) return active[index];
  const a = active[index];
  const b = active[swapWith];
  const orderA = Number(a.order);
  const orderB = Number(b.order);
  const nextA = await updateOfficeShortcut(a.id, { order: orderB });
  await updateOfficeShortcut(b.id, { order: orderA });
  return nextA;
}

export { listOfficeShortcuts };
