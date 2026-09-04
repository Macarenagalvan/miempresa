import { createId, nowIso } from "./ids.js";
import {
  getOfficeTask,
  putOfficeTask,
  listOfficeTasks,
} from "../storage/repos/office-tasks.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function localYmd(value = new Date()) {
  if (typeof value === "string" && DATE_RE.test(value)) return value;
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

export function assertOfficeTask(task) {
  if (!task || !task.id) throw new Error("task.id requerido");
  if (task.stageId != null && task.stageId !== "") throw new Error("OfficeTask no lleva stageId");
  const text = String(task.text || "").trim();
  if (!text) throw new Error("text requerido");
  if (task.dueDate != null && task.dueDate !== "" && !DATE_RE.test(task.dueDate)) {
    throw new Error("dueDate inválida");
  }
  if (typeof task.done !== "boolean") throw new Error("done inválido");
  if (!task.createdAt) throw new Error("createdAt requerido");
  if (!task.updatedAt) throw new Error("updatedAt requerido");
  if (task.done && !task.completedAt) throw new Error("completedAt requerido si done");
  if (!task.done && task.completedAt) throw new Error("completedAt solo si done");
}

function normalizeDue(raw) {
  if (raw == null || raw === "") return null;
  const value = String(raw).trim();
  if (!DATE_RE.test(value)) throw new Error("dueDate inválida");
  return value;
}

export function createOfficeTask(input = {}) {
  const now = nowIso();
  const task = {
    id: createId(),
    text: String(input.text || "").trim(),
    dueDate: normalizeDue(input.dueDate),
    done: false,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    archivedAt: null,
  };
  assertOfficeTask(task);
  return task;
}

export async function addOfficeTask(input) {
  const task = createOfficeTask(input);
  await putOfficeTask(task);
  return task;
}

export async function updateOfficeTask(id, patch = {}) {
  const current = await getOfficeTask(id);
  if (!current) throw new Error("task no existe");
  if (current.archivedAt) throw new Error("task archivada");
  const next = {
    ...current,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  };
  if (Object.prototype.hasOwnProperty.call(patch, "text")) {
    next.text = String(patch.text || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(patch, "dueDate")) {
    next.dueDate = normalizeDue(patch.dueDate);
  }
  delete next.stageId;
  assertOfficeTask(next);
  await putOfficeTask(next);
  return next;
}

export async function completeOfficeTask(id) {
  const current = await getOfficeTask(id);
  if (!current) throw new Error("task no existe");
  if (current.archivedAt) throw new Error("task archivada");
  if (current.done) return current;
  const next = {
    ...current,
    done: true,
    completedAt: nowIso(),
    updatedAt: nowIso(),
  };
  delete next.stageId;
  assertOfficeTask(next);
  await putOfficeTask(next);
  return next;
}

export async function reopenOfficeTask(id) {
  const current = await getOfficeTask(id);
  if (!current) throw new Error("task no existe");
  if (current.archivedAt) throw new Error("task archivada");
  if (!current.done) return current;
  const next = {
    ...current,
    done: false,
    completedAt: null,
    updatedAt: nowIso(),
  };
  delete next.stageId;
  assertOfficeTask(next);
  await putOfficeTask(next);
  return next;
}

export async function archiveOfficeTask(id) {
  const current = await getOfficeTask(id);
  if (!current) throw new Error("task no existe");
  if (current.archivedAt) return current;
  const next = {
    ...current,
    archivedAt: nowIso(),
    updatedAt: nowIso(),
  };
  delete next.stageId;
  assertOfficeTask(next);
  await putOfficeTask(next);
  return next;
}

export function isHoyVisible(task, today = localYmd()) {
  if (!task || task.archivedAt) return false;
  if (!task.done) return true;
  return Boolean(task.completedAt && localYmd(task.completedAt) === today);
}

export async function listHoyTasks(today = localYmd()) {
  const all = await listOfficeTasks();
  const visible = all.filter((t) => isHoyVisible(t, today));
  const pending = visible.filter((t) => !t.done).sort((a, b) => {
    const ad = a.dueDate || "9999-99-99";
    const bd = b.dueDate || "9999-99-99";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
  const doneToday = visible.filter((t) => t.done).sort((a, b) => {
    return (a.completedAt || "") < (b.completedAt || "") ? 1 : -1;
  });
  return { pending, doneToday, today };
}

export { localYmd as taskLocalYmd };
