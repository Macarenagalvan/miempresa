import { createId, nowIso } from "./ids.js";
import { AccountContext, AccountStatus } from "./enums.js";
import {
  assertAccount,
  normalizeAccountContext,
  accountBalance as balanceOf,
} from "./integrity.js";
import { getAccount, putAccount, listAccounts } from "../storage/repos/accounts.js";
import { listMovements } from "../storage/repos/movements.js";
import { listTrades } from "../storage/repos/trades.js";
import { getMeta, putMeta } from "../storage/repos/meta.js";
import { linkAccountToChallenge } from "./challenge.js";

export function accountBalance(account, movements, trades) {
  return balanceOf(account, movements, trades);
}

export async function createAccount(input, stageId) {
  const context = normalizeAccountContext(input.context);
  if (!Object.values(AccountContext).includes(context)) {
    throw new Error("context de cuenta inválido");
  }
  const initial = Number(input.initialAmount);
  if (!Number.isFinite(initial)) throw new Error("initialAmount inválido");
  const now = nowIso();
  const account = {
    id: createId(),
    stageId,
    name: String(input.name || "").trim(),
    currency: input.currency,
    context,
    initialAmount: initial,
    broker: null,
    mt5Login: null,
    challengeId: input.challengeId || null,
    status: AccountStatus.ACTIVE,
    createdAt: now,
    updatedAt: now,
  };
  assertAccount(account);
  await putAccount(account);
  if (account.challengeId) {
    await linkAccountToChallenge(account.id, account.challengeId);
    return getAccount(account.id);
  }
  return account;
}

export async function archiveAccount(id) {
  const current = await getAccount(id);
  if (!current) throw new Error("account no existe");
  if (current.status === AccountStatus.ARCHIVED) return current;
  const next = { ...current, status: AccountStatus.ARCHIVED, updatedAt: nowIso() };
  assertAccount(next);
  await putAccount(next);
  const meta = await getMeta();
  if (meta && meta.activeAccountId === id) {
    await putMeta({ ...meta, activeAccountId: null });
  }
  return next;
}

export async function correctInitialAmount(id, amount) {
  const current = await getAccount(id);
  if (!current) throw new Error("account no existe");
  const n = Number(amount);
  if (!Number.isFinite(n)) throw new Error("initialAmount inválido");
  const next = { ...current, initialAmount: n, updatedAt: nowIso() };
  assertAccount(next);
  await putAccount(next);
  return next;
}

export async function setActiveAccount(id) {
  if (!id) {
    const meta = await getMeta();
    await putMeta({ ...meta, activeAccountId: null });
    return null;
  }
  const account = await getAccount(id);
  if (!account) throw new Error("account no existe");
  if (account.status === AccountStatus.ARCHIVED) throw new Error("no se activa una cuenta archivada");
  const meta = await getMeta();
  await putMeta({ ...meta, activeAccountId: account.id });
  return account;
}

export async function getActiveAccount() {
  const meta = await getMeta();
  const id = meta && meta.activeAccountId;
  if (!id) return null;
  const account = await getAccount(id);
  if (!account || account.status === AccountStatus.ARCHIVED) return null;
  return account;
}

export async function listStageAccounts(stageId, opts = {}) {
  const all = await listAccounts();
  return all
    .filter((a) => a.stageId === stageId)
    .filter((a) => opts.includeArchived || a.status !== AccountStatus.ARCHIVED)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function balanceFor(accountId) {
  const account = await getAccount(accountId);
  if (!account) throw new Error("account no existe");
  const movements = await listMovements();
  const trades = await listTrades();
  return accountBalance(account, movements, trades);
}

export function visibleActiveAccount(active, tradeContext) {
  if (!active) return null;
  if (active.status === AccountStatus.ARCHIVED) return null;
  if (normalizeAccountContext(active.context) !== tradeContext) return null;
  return active;
}
