import { ensureJournalSeed } from "../js/domain/stage.js";
import { createChallenge, updateChallenge, linkAccountToChallenge, accountsForChallenge } from "../js/domain/challenge.js";
import { createPayout, voidPayout, listChallengePayouts } from "../js/domain/payout.js";
import { createAccount, accountBalance } from "../js/domain/account.js";
import { createTrade } from "../js/domain/trade.js";
import { createMovement, listAccountMovements } from "../js/domain/movement.js";
import { compute } from "../js/domain/stats.js";
import { Context } from "../js/domain/enums.js";
import { getChallenge } from "../js/storage/repos/challenges.js";
import { getPayout } from "../js/storage/repos/payouts.js";
import { listMovements } from "../js/storage/repos/movements.js";
import { buildExportPayload } from "../js/services/backup.js";
import { V1_DB_NAME } from "../js/config.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
}

async function run() {
  const { stage } = await ensureJournalSeed();

  try {
    await createChallenge({ purchasedAt: "2026-08-01", size: 50, cost: 300, currency: "USD" }, stage.id);
    assert("firm required", false);
  } catch (e) {
    assert("firm required", /firm/.test(e.message));
  }
  try {
    await createChallenge({ firm: "FTMO", size: 50, cost: 300, currency: "USD", purchasedAt: "no" }, stage.id);
    assert("purchasedAt válida", false);
  } catch (e) {
    assert("purchasedAt válida", /purchasedAt/.test(e.message));
  }

  const nMovBeforeCh = (await listMovements()).length;
  const ch = await createChallenge({
    firm: "FTMO",
    purchasedAt: "2026-08-01",
    size: 50000,
    cost: 299,
    currency: "USD",
    status: "ACTIVE",
    profitTargetPct: 8,
    maxDrawdownPct: 10,
  }, stage.id);
  assert("crear Challenge válido", ch.firm === "FTMO" && ch.stageId === stage.id);
  assert("status válido default ACTIVE", ch.status === "ACTIVE");
  assert("Challenge pertenece a Stage", ch.stageId === stage.id);
  assert("Challenge no crea Account", (await accountsForChallenge(ch.id)).length === 0);
  assert("Challenge.accountId null al nacer", ch.accountId == null);
  assert("costo Challenge no crea Movement", (await listMovements()).length === nMovBeforeCh);

  try {
    await updateChallenge(ch.id, { status: "FOO" });
    assert("status inválido rechazado", false);
  } catch (e) {
    assert("status inválido rechazado", /status/.test(e.message));
  }

  const evalAcc = await createAccount({
    name: "FTMO eval",
    context: "PROP",
    currency: "USD",
    initialAmount: 50000,
  }, stage.id);
  await linkAccountToChallenge(evalAcc.id, ch.id);
  const linked = await getChallenge(ch.id);
  assert("vincular Account existente", (await accountsForChallenge(ch.id)).some((a) => a.id === evalAcc.id));
  assert("relación solo Account.challengeId", linked.accountId == null);
  assert("Account.challengeId", (await accountsForChallenge(ch.id))[0].challengeId === ch.id);

  const fundedAcc = await createAccount({
    name: "FTMO funded",
    context: "FUNDED",
    currency: "USD",
    initialAmount: 50000,
    challengeId: ch.id,
  }, stage.id);
  const accs = await accountsForChallenge(ch.id);
  assert("1 Challenge → N Accounts", accs.length === 2 && accs.some((a) => a.id === fundedAcc.id));
  assert("Challenge.accountId no es contrato", (await getChallenge(ch.id)).accountId == null);
  assert("context FUNDED intacto", fundedAcc.context === "FUNDED");
  assert("eval sigue PROP_CHALLENGE", evalAcc.context === "PROP_CHALLENGE" || (accs.find((a) => a.id === evalAcc.id).context === "PROP_CHALLENGE"));

  const afterStatus = await updateChallenge(ch.id, { status: "FUNDED" });
  assert("cambiar status", afterStatus.status === "FUNDED");
  const accsAfter = await accountsForChallenge(ch.id);
  assert("status no transforma Accounts",
    accsAfter.find((a) => a.id === evalAcc.id).context === "PROP_CHALLENGE"
    && accsAfter.find((a) => a.id === fundedAcc.id).context === "FUNDED");
  assert("maxStageReached no baja", afterStatus.maxStageReached >= 2);

  const trade = await createTrade({
    asset: "EURUSD", context: "BACKTEST", direction: "LONG", entry: 1.1,
  }, stage.id);
  assert("Trade no necesita challengeId", trade.challengeId == null);

  try {
    await createPayout({ amount: 100, currency: "USD", kind: "PAYOUT" }, stage.id);
    assert("challengeId obligatorio", false);
  } catch (e) {
    assert("challengeId obligatorio", /challengeId/.test(e.message));
  }
  try {
    await createPayout({ challengeId: ch.id, amount: -10, kind: "PAYOUT" }, stage.id);
    assert("amount positivo", false);
  } catch (e) {
    assert("amount positivo", /positivo/.test(e.message));
  }
  try {
    await createPayout({ challengeId: ch.id, amount: 50, currency: "EUR", kind: "PAYOUT" }, stage.id);
    assert("currency coherente", false);
  } catch (e) {
    assert("currency coherente", /incompatible/.test(e.message));
  }
  try {
    await createPayout({ challengeId: ch.id, amount: 50, kind: "BONUS" }, stage.id);
    assert("kind válido", false);
  } catch (e) {
    assert("kind válido", /kind/.test(e.message));
  }

  const pay = await createPayout({
    challengeId: ch.id,
    amount: 1200,
    date: "2026-08-20",
    kind: "PAYOUT",
    currency: "USD",
  }, stage.id);
  assert("crear Payout válido", pay.amount === 1200 && pay.kind === "PAYOUT" && pay.challengeId === ch.id);

  assert("Payout no crea Movement", (await listAccountMovements(evalAcc.id)).length === 0);
  const balBefore = accountBalance(evalAcc, await listAccountMovements(evalAcc.id));
  assert("Payout no mueve accountBalance", balBefore === 50000);

  const wd = await createMovement({
    accountId: evalAcc.id,
    type: "WITHDRAWAL",
    amount: 1200,
    date: "2026-08-20",
    note: "retiro MT5 mismo flujo",
  }, stage.id);
  const balAfterWd = accountBalance(evalAcc, await listAccountMovements(evalAcc.id));
  assert("no doble contabilización Payout/Movement", balAfterWd === 48800 && wd.amount === -1200);

  const sample = [{
    id: "s7", stageId: stage.id, context: Context.BACKTEST, lifecycle: "CLOSED", result: "WIN",
    netPnl: 10, asset: "EURUSD", strategy: "UNCLASSIFIED", openedAt: "2026-08-01",
    closedAt: "2026-08-01", hasPartials: false, entry: 1.1, initialSL: 1.09, exit: 1.12, direction: "LONG",
  }];
  const stats = compute(sample, { context: Context.BACKTEST, stageId: stage.id });
  assert("Payout no entra en stats de trades", stats.netPnl === 10 && stats.nClosed === 1);
  assert("costo Challenge no entra en stats", stats.netPnl === 10);

  const voided = await voidPayout(pay.id, "ACCIDENT");
  assert("VOID Payout conserva row", (await getPayout(pay.id)).id === pay.id);
  assert("VOID motivo", voided.lifecycle === "VOID" && voided.voidReason === "ACCIDENT");
  assert("VOID sale de vivos", (await listChallengePayouts(ch.id)).filter((p) => p.lifecycle !== "VOID" && !p.voidedAt).length === 0);

  const closed = await updateChallenge(ch.id, { status: "CANCELLED" });
  assert("cerrar Challenge conserva Accounts", (await accountsForChallenge(ch.id)).length === 2);
  assert("CANCELLED no borra Payout", Boolean(await getPayout(pay.id)));
  assert("endedAt al cerrar", Boolean(closed.endedAt));

  const payload = await buildExportPayload();
  assert("export challenges", payload.challenges.some((c) => c.id === ch.id && c.firm === "FTMO"));
  assert("export payouts", payload.payouts.some((p) => p.id === pay.id && p.challengeId === ch.id));
  assert("export Account.challengeId", payload.accounts.some((a) => a.id === evalAcc.id && a.challengeId === ch.id));
  assert("FK payout→challenge", payload.payouts.every((p) => payload.challenges.some((c) => c.id === p.challengeId)));

  if (indexedDB.databases) {
    const dbs = await indexedDB.databases();
    assert("V1 aislado", !dbs.some((d) => d && d.name === V1_DB_NAME));
  } else assert("V1 aislado", true);

  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  lines.push("");
  lines.push(failed.length ? `${failed.length} fallos` : `${results.length} tests OK`);
  const out = document.getElementById("out");
  out.textContent += "\n\nSLICE 7\n" + lines.join("\n");
  if (failed.length) out.className = "fail";
  if (failed.length) throw new Error("slice7 " + failed.length);
}

export { run };
