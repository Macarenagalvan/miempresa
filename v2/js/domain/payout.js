import { createId, nowIso } from "./ids.js";
import { Lifecycle, PayoutKind } from "./enums.js";
import { assertPayout, isPayoutLive } from "./integrity.js";
import { getChallenge } from "../storage/repos/challenges.js";
import { getAccount } from "../storage/repos/accounts.js";
import { getPayout, putPayout, listPayouts } from "../storage/repos/payouts.js";

function todayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function createPayout(input, stageId) {
  if (!input || !input.challengeId) throw new Error("payout.challengeId requerido");
  const challenge = await getChallenge(input.challengeId);
  if (!challenge) throw new Error("challenge no existe");
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount debe ser positivo");
  const currency = input.currency || challenge.currency;
  if (currency !== challenge.currency) throw new Error("currency incompatible con el Challenge");
  let accountId = input.accountId || null;
  if (accountId) {
    const account = await getAccount(accountId);
    if (!account) throw new Error("account no existe");
  }
  const now = nowIso();
  const payout = {
    id: createId(),
    stageId: stageId || challenge.stageId,
    challengeId: challenge.id,
    accountId,
    date: input.date || todayIsoDate(),
    amount,
    currency,
    kind: input.kind || PayoutKind.PAYOUT,
    note: input.note ? String(input.note).trim() : null,
    lifecycle: null,
    voidedAt: null,
    voidReason: null,
    createdAt: now,
    updatedAt: now,
  };
  assertPayout(payout);
  await putPayout(payout);
  return payout;
}

export async function voidPayout(id, reason) {
  const current = await getPayout(id);
  if (!current) throw new Error("payout no existe");
  if (current.lifecycle === Lifecycle.VOID) return current;
  const next = {
    ...current,
    lifecycle: Lifecycle.VOID,
    voidedAt: nowIso(),
    voidReason: reason,
    updatedAt: nowIso(),
  };
  assertPayout(next);
  await putPayout(next);
  return next;
}

export async function listChallengePayouts(challengeId) {
  const all = await listPayouts();
  return all
    .filter((p) => p.challengeId === challengeId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function fundingSummary(challenges, payouts) {
  const list = challenges || [];
  const pays = (payouts || []).filter(isPayoutLive);
  const statusCounts = {};
  const costByCurrency = {};
  const payoutByCurrency = {};
  for (const ch of list) {
    statusCounts[ch.status] = (statusCounts[ch.status] || 0) + 1;
    costByCurrency[ch.currency] = (costByCurrency[ch.currency] || 0) + Number(ch.cost || 0);
  }
  for (const p of pays) {
    payoutByCurrency[p.currency] = (payoutByCurrency[p.currency] || 0) + Number(p.amount || 0);
  }
  return {
    nChallenges: list.length,
    statusCounts,
    costByCurrency,
    payoutByCurrency,
    nPayouts: pays.length,
  };
}
