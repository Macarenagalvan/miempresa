import { createId, nowIso } from "./ids.js";
import {
  getOfficeEvent,
  putOfficeEvent,
  listOfficeEvents,
} from "../storage/repos/office-events.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeEventDate(raw) {
  const value = String(raw || "").trim();
  if (!DATE_RE.test(value)) throw new Error("date inválida");
  return value;
}

export function normalizeEventTime(raw) {
  if (raw == null || raw === "") return null;
  let value = String(raw).trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) value = value.slice(0, 5);
  if (!TIME_RE.test(value)) throw new Error("time inválida");
  return value;
}

export function normalizeEventNote(raw) {
  if (raw == null || raw === "") return null;
  const value = String(raw).trim();
  return value || null;
}

export function assertOfficeEvent(event) {
  if (!event || !event.id) throw new Error("event.id requerido");
  if (event.stageId != null && event.stageId !== "") throw new Error("OfficeEvent no lleva stageId");
  const title = String(event.title || "").trim();
  if (!title) throw new Error("title requerido");
  if (!DATE_RE.test(event.date)) throw new Error("date inválida");
  if (event.time != null && event.time !== "" && !TIME_RE.test(event.time)) {
    throw new Error("time inválida");
  }
  if (!event.createdAt) throw new Error("createdAt requerido");
  if (!event.updatedAt) throw new Error("updatedAt requerido");
}

export function createOfficeEvent(input = {}) {
  const now = nowIso();
  const event = {
    id: createId(),
    title: String(input.title || "").trim(),
    date: normalizeEventDate(input.date),
    time: normalizeEventTime(input.time),
    note: normalizeEventNote(input.note),
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  assertOfficeEvent(event);
  return event;
}

export async function addOfficeEvent(input) {
  const event = createOfficeEvent(input);
  await putOfficeEvent(event);
  return event;
}

export async function updateOfficeEvent(id, patch = {}) {
  const current = await getOfficeEvent(id);
  if (!current) throw new Error("event no existe");
  if (current.archivedAt) throw new Error("event archivado");
  const next = {
    ...current,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  };
  if (Object.prototype.hasOwnProperty.call(patch, "title")) {
    next.title = String(patch.title || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(patch, "date")) {
    next.date = normalizeEventDate(patch.date);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "time")) {
    next.time = normalizeEventTime(patch.time);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "note")) {
    next.note = normalizeEventNote(patch.note);
  }
  delete next.stageId;
  assertOfficeEvent(next);
  await putOfficeEvent(next);
  return next;
}

export async function archiveOfficeEvent(id) {
  const current = await getOfficeEvent(id);
  if (!current) throw new Error("event no existe");
  if (current.archivedAt) return current;
  const next = {
    ...current,
    archivedAt: nowIso(),
    updatedAt: nowIso(),
  };
  delete next.stageId;
  assertOfficeEvent(next);
  await putOfficeEvent(next);
  return next;
}

export function isActiveEvent(event) {
  return Boolean(event) && !event.archivedAt;
}

export function compareEvents(a, b) {
  if (a.time && b.time) {
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    return (a.createdAt || "") < (b.createdAt || "") ? -1 : 1;
  }
  if (a.time && !b.time) return -1;
  if (!a.time && b.time) return 1;
  return (a.createdAt || "") < (b.createdAt || "") ? -1 : 1;
}

export async function listEventsOnDate(date) {
  const day = normalizeEventDate(date);
  const all = await listOfficeEvents();
  return all.filter((ev) => isActiveEvent(ev) && ev.date === day).sort(compareEvents);
}

export async function listMonthEventDates(year, monthIndex) {
  const prefix = String(year) + "-" + String(monthIndex + 1).padStart(2, "0");
  const all = await listOfficeEvents();
  const days = new Set();
  for (const ev of all) {
    if (!isActiveEvent(ev) || !ev.date || ev.date.slice(0, 7) !== prefix) continue;
    days.add(ev.date);
  }
  return days;
}

export { DATE_RE as EVENT_DATE_RE, TIME_RE as EVENT_TIME_RE };
