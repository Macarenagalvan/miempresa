import { createId, nowIso } from "./ids.js";
import { AccountStatus, Lifecycle } from "./enums.js";
import {
  assertMovement,
  normalizeMovementType,
  signedMovementAmount,
} from "./integrity.js";
import { getAccount } from "../storage/repos/accounts.js";
import { getMovement, putMovement, listMovements } from "../storage/repos/movements.js";

function todayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function createMovement(input, stageId) {
  if (!input || !input.accountId) throw new Error("movement.accountId requerido");
  const account = await getAccount(input.accountId);
  if (!account) throw new Error("account no existe");
  if (account.status === AccountStatus.ARCHIVED) throw new Error("cuenta archivada no recibe movements");
  const type = normalizeMovementType(input.type);
  if (type === "INITIAL") throw new Error("INITIAL no se usa: el capital va en initialAmount");
  const signed = signedMovementAmount(type, input.amount);
  const now = nowIso();
  const mov = {
    id: createId(),
    stageId: stageId || account.stageId,
    accountId: account.id,
    type,
    amount: signed,
    currency: account.currency,
    date: input.date || todayIsoDate(),
    note: input.note ? String(input.note).trim() : null,
    recordSource: "MANUAL",
    lifecycle: null,
    voidedAt: null,
    voidReason: null,
    createdAt: now,
    updatedAt: now,
  };
  assertMovement(mov);
  await putMovement(mov);
  return mov;
}

export async function voidMovement(id, reason) {
  const current = await getMovement(id);
  if (!current) throw new Error("movement no existe");
  if (current.lifecycle === Lifecycle.VOID) return current;
  const next = {
    ...current,
    lifecycle: Lifecycle.VOID,
    voidedAt: nowIso(),
    voidReason: reason,
    updatedAt: nowIso(),
  };
  assertMovement(next);
  await putMovement(next);
  return next;
}

export async function listAccountMovements(accountId) {
  const all = await listMovements();
  return all
    .filter((m) => m.accountId === accountId)
    .sort((a, b) => {
      if (a.date === b.date) return String(a.createdAt) < String(b.createdAt) ? 1 : -1;
      return a.date < b.date ? 1 : -1;
    });
}
