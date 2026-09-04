import { createId, nowIso } from "./ids.js";
import {
  getOfficeNote,
  putOfficeNote,
  listOfficeNotes,
} from "../storage/repos/office-notes.js";

export function assertOfficeNote(note) {
  if (!note || !note.id) throw new Error("note.id requerido");
  if (note.stageId != null && note.stageId !== "") throw new Error("OfficeNote no lleva stageId");
  const text = String(note.text || "").trim();
  if (!text) throw new Error("text requerido");
  if (!note.createdAt) throw new Error("createdAt requerido");
  if (!note.updatedAt) throw new Error("updatedAt requerido");
}

export function createOfficeNote(input = {}) {
  const now = nowIso();
  const note = {
    id: createId(),
    text: String(input.text || "").trim(),
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  assertOfficeNote(note);
  return note;
}

export async function addOfficeNote(input) {
  const note = createOfficeNote(input);
  await putOfficeNote(note);
  return note;
}

export async function updateOfficeNote(id, patch = {}) {
  const current = await getOfficeNote(id);
  if (!current) throw new Error("note no existe");
  if (current.archivedAt) throw new Error("note archivada");
  const next = {
    ...current,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  };
  if (Object.prototype.hasOwnProperty.call(patch, "text")) {
    next.text = String(patch.text || "").trim();
  }
  delete next.stageId;
  assertOfficeNote(next);
  await putOfficeNote(next);
  return next;
}

export async function archiveOfficeNote(id) {
  const current = await getOfficeNote(id);
  if (!current) throw new Error("note no existe");
  if (current.archivedAt) return current;
  const next = {
    ...current,
    archivedAt: nowIso(),
    updatedAt: nowIso(),
  };
  delete next.stageId;
  assertOfficeNote(next);
  await putOfficeNote(next);
  return next;
}

export function isHoyVisibleNote(note) {
  return Boolean(note) && !note.archivedAt;
}

export async function listHoyNotes() {
  const all = await listOfficeNotes();
  return all
    .filter(isHoyVisibleNote)
    .sort((a, b) => ((a.createdAt || "") < (b.createdAt || "") ? 1 : -1));
}
