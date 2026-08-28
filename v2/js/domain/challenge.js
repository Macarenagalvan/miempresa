import { createId, nowIso } from "./ids.js";
import { ChallengeStatus, Currency } from "./enums.js";
import { assertChallenge } from "./integrity.js";
import { getChallenge, putChallenge, listChallenges } from "../storage/repos/challenges.js";
import { getAccount, putAccount, listAccounts } from "../storage/repos/accounts.js";

function todayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function stageReached(status, current) {
  const now = Number(current) || 0;
  if (status === ChallengeStatus.PHASE1_PASSED) return Math.max(now, 1);
  if (status === ChallengeStatus.FUNDED) return Math.max(now, 2);
  return now;
}

const TERMINAL = new Set([
  ChallengeStatus.FAILED,
  ChallengeStatus.REFUNDED,
  ChallengeStatus.CANCELLED,
]);

export async function createChallenge(input, stageId) {
  const now = nowIso();
  const status = input.status || ChallengeStatus.ACTIVE;
  const ch = {
    id: createId(),
    stageId,
    firm: String(input.firm || "").trim(),
    purchasedAt: input.purchasedAt || todayIsoDate(),
    size: Number(input.size),
    cost: Number(input.cost),
    currency: input.currency || Currency.EUR,
    status,
    format: input.format ? String(input.format).trim() : null,
    accountId: null,
    failReason: input.failReason || null,
    maxDailyLossPct: numOrNull(input.maxDailyLossPct),
    maxDrawdownPct: numOrNull(input.maxDrawdownPct),
    profitTargetPct: numOrNull(input.profitTargetPct),
    endedAt: input.endedAt || null,
    maxStageReached: stageReached(status, 0),
    note: input.note || null,
    createdAt: now,
    updatedAt: now,
  };
  assertChallenge(ch);
  await putChallenge(ch);
  return ch;
}

export async function updateChallenge(id, patch) {
  const current = await getChallenge(id);
  if (!current) throw new Error("challenge no existe");
  const status = patch.status || current.status;
  if (patch.status && !Object.values(ChallengeStatus).includes(patch.status)) {
    throw new Error("challenge.status inválido");
  }
  const next = {
    ...current,
    firm: patch.firm != null ? String(patch.firm).trim() : current.firm,
    purchasedAt: patch.purchasedAt || current.purchasedAt,
    size: patch.size != null ? Number(patch.size) : current.size,
    cost: patch.cost != null ? Number(patch.cost) : current.cost,
    currency: patch.currency || current.currency,
    status,
    format: patch.format !== undefined ? (patch.format ? String(patch.format).trim() : null) : current.format,
    failReason: patch.failReason !== undefined ? patch.failReason : current.failReason,
    maxDailyLossPct: patch.maxDailyLossPct !== undefined ? numOrNull(patch.maxDailyLossPct) : current.maxDailyLossPct,
    maxDrawdownPct: patch.maxDrawdownPct !== undefined ? numOrNull(patch.maxDrawdownPct) : current.maxDrawdownPct,
    profitTargetPct: patch.profitTargetPct !== undefined ? numOrNull(patch.profitTargetPct) : current.profitTargetPct,
    note: patch.note !== undefined ? patch.note : current.note,
    maxStageReached: stageReached(status, current.maxStageReached),
    endedAt: patch.endedAt !== undefined
      ? patch.endedAt
      : (TERMINAL.has(status) ? (current.endedAt || todayIsoDate()) : current.endedAt),
    accountId: current.accountId,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  };
  assertChallenge(next);
  await putChallenge(next);
  return next;
}

export async function linkAccountToChallenge(accountId, challengeId) {
  const account = await getAccount(accountId);
  if (!account) throw new Error("account no existe");
  const challenge = await getChallenge(challengeId);
  if (!challenge) throw new Error("challenge no existe");
  if (account.challengeId && account.challengeId !== challengeId) {
    throw new Error("account ya tiene un challenge");
  }
  const nextAccount = { ...account, challengeId, updatedAt: nowIso() };
  await putAccount(nextAccount);
  if (!challenge.accountId) {
    const nextCh = { ...challenge, accountId: account.id, updatedAt: nowIso() };
    assertChallenge(nextCh);
    await putChallenge(nextCh);
    return { account: nextAccount, challenge: nextCh };
  }
  return { account: nextAccount, challenge };
}

export async function listStageChallenges(stageId) {
  const all = await listChallenges();
  return all
    .filter((c) => c.stageId === stageId)
    .sort((a, b) => String(b.purchasedAt).localeCompare(String(a.purchasedAt)));
}

export async function accountsForChallenge(challengeId) {
  const all = await listAccounts();
  return all.filter((a) => a.challengeId === challengeId);
}
