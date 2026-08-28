import { ensureJournalSeed } from "../js/domain/stage.js";
import { createAccount, setActiveAccount, archiveAccount, accountBalance, visibleActiveAccount, getActiveAccount } from "../js/domain/account.js";
import { createMovement, listAccountMovements } from "../js/domain/movement.js";
import { createChallenge, linkAccountToChallenge, accountsForChallenge } from "../js/domain/challenge.js";
import { createPayout } from "../js/domain/payout.js";
import { createSetup } from "../js/domain/setup.js";
import { createTrade, closeTrade, voidTrade, amendClosedTrade } from "../js/domain/trade.js";
import { compute } from "../js/domain/stats.js";
import { Context } from "../js/domain/enums.js";
import { listTrades } from "../js/storage/repos/trades.js";
import { listMovements } from "../js/storage/repos/movements.js";
import { buildExportPayload } from "../js/services/backup.js";
import { V1_DB_NAME } from "../js/config.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
}

async function run() {
  const { stage } = await ensureJournalSeed();

  const bt = await createTrade({
    asset: "EURUSD", context: "BACKTEST", direction: "LONG", entry: 1.1,
  }, stage.id);
  assert("BACKTEST sigue sin account", bt.accountId == null && bt.context === "BACKTEST");

  const demoAcc = await createAccount({ name: "Demo", context: "DEMO", currency: "EUR", initialAmount: 1000 }, stage.id);
  const liveAcc = await createAccount({ name: "Live", context: "LIVE", currency: "EUR", initialAmount: 2000 }, stage.id);
  const propAcc = await createAccount({ name: "Prop", context: "PROP", currency: "USD", initialAmount: 50000 }, stage.id);
  const fundedAcc = await createAccount({ name: "Funded", context: "FUNDED", currency: "USD", initialAmount: 50000 }, stage.id);

  try {
    await createTrade({ asset: "EURUSD", context: "DEMO", direction: "LONG", entry: 1.1 }, stage.id);
    assert("DEMO exige Account", false);
  } catch (e) {
    assert("DEMO exige Account", /accountId/.test(e.message));
  }
  try {
    await createTrade({ asset: "EURUSD", context: "LIVE", direction: "LONG", entry: 1.1 }, stage.id);
    assert("LIVE exige Account", false);
  } catch (e) {
    assert("LIVE exige Account", /accountId/.test(e.message));
  }
  try {
    await createTrade({ asset: "EURUSD", context: "PROP_CHALLENGE", direction: "LONG", entry: 1.1 }, stage.id);
    assert("PROP exige Account", false);
  } catch (e) {
    assert("PROP exige Account", /accountId/.test(e.message));
  }
  try {
    await createTrade({ asset: "EURUSD", context: "FUNDED", direction: "LONG", entry: 1.1 }, stage.id);
    assert("FUNDED exige Account", false);
  } catch (e) {
    assert("FUNDED exige Account", /accountId/.test(e.message));
  }

  try {
    await createTrade({
      asset: "EURUSD", context: "LIVE", direction: "LONG", entry: 1.1, accountId: demoAcc.id,
    }, stage.id);
    assert("mismatch context/account rechazado", false);
  } catch (e) {
    assert("mismatch context/account rechazado", /incompatible/.test(e.message));
  }

  await setActiveAccount(liveAcc.id);
  const active = await getActiveAccount();
  assert("activeAccount preseleccionable si compatible", visibleActiveAccount(active, Context.LIVE)?.id === liveAcc.id);
  assert("activeAccount oculta si context no calza", visibleActiveAccount(active, Context.DEMO) == null);

  const archived = await createAccount({ name: "Vieja", context: "LIVE", currency: "EUR", initialAmount: 10 }, stage.id);
  await archiveAccount(archived.id);
  try {
    await createTrade({
      asset: "EURUSD", context: "LIVE", direction: "LONG", entry: 1.1, accountId: archived.id,
    }, stage.id);
    assert("Account archivada no válida", false);
  } catch (e) {
    assert("Account archivada no válida", /archivada/.test(e.message));
  }

  const liveOpen = await createTrade({
    asset: "EURUSD", context: "LIVE", direction: "LONG", entry: 1.12,
    accountId: liveAcc.id, brokerSymbol: "EURUSDc",
  }, stage.id);
  assert("Trade directo Real", liveOpen.context === "LIVE" && liveOpen.accountId === liveAcc.id);
  assert("brokerSymbol opcional", liveOpen.brokerSymbol === "EURUSDc");
  assert("Trade no tiene challengeId", liveOpen.challengeId == null);

  const setup = await createSetup({
    asset: "EURUSD", context: "PROP_CHALLENGE", direction: "LONG",
  }, stage.id);
  const propOpen = await createTrade({
    asset: "EURUSD", context: "PROP_CHALLENGE", direction: "LONG",
    entry: 1.13, accountId: propAcc.id, setupId: setup.id,
  }, stage.id);
  assert("Trade Real desde Setup", propOpen.setupId === setup.id && propOpen.accountId === propAcc.id);

  const ch = await createChallenge({
    firm: "FTMO", purchasedAt: "2026-08-01", size: 50000, cost: 299, currency: "USD",
  }, stage.id);
  await linkAccountToChallenge(propAcc.id, ch.id);
  assert("Challenge se deriva vía Account", (await accountsForChallenge(ch.id)).some((a) => a.id === propAcc.id));

  const movs0 = await listAccountMovements(liveAcc.id);
  const tradesAll = await listTrades();
  assert("OPEN no entra al balance", accountBalance(liveAcc, movs0, tradesAll) === 2000);

  const liveClosed = await closeTrade(liveOpen.id, {
    exit: 1.14, netPnl: 80, commission: -2, swap: 0, closeType: "TP",
  });
  assert("netPnl no se re-resta", liveClosed.netPnl === 80 && liveClosed.commission === -2);
  const afterClose = accountBalance(liveAcc, await listAccountMovements(liveAcc.id), await listTrades());
  assert("CLOSED PnL entra a Account balance", afterClose === 2080);

  await createMovement({ accountId: liveAcc.id, type: "DEPOSIT", amount: 20, date: "2026-08-21" }, stage.id);
  const combo = accountBalance(liveAcc, await listAccountMovements(liveAcc.id), await listTrades());
  assert("Movement + PnL combinan", combo === 2100);

  const pay = await createPayout({ challengeId: ch.id, amount: 500, currency: "USD", kind: "PAYOUT" }, stage.id);
  const propBal = accountBalance(propAcc, await listAccountMovements(propAcc.id), await listTrades());
  assert("Payout no afecta balance por sí mismo", propBal === 50000 && pay.amount === 500);

  const btClosed = await closeTrade(bt.id, { exit: 1.12, netPnl: 999, closeType: "TP" });
  const liveStill = accountBalance(liveAcc, await listAccountMovements(liveAcc.id), await listTrades());
  assert("BACKTEST no afecta Account balance", liveStill === 2100 && btClosed.netPnl === 999);
  assert("otro Account no afecta balance", accountBalance(demoAcc, await listAccountMovements(demoAcc.id), await listTrades()) === 1000);

  const demoT = await createTrade({
    asset: "EURUSD", context: "DEMO", direction: "SHORT", entry: 1.1, accountId: demoAcc.id,
  }, stage.id);
  await closeTrade(demoT.id, { exit: 1.09, netPnl: 15, closeType: "TP" });

  const fundedT = await createTrade({
    asset: "XAUUSD", context: "FUNDED", direction: "LONG", entry: 2400, accountId: fundedAcc.id,
  }, stage.id);
  await closeTrade(fundedT.id, { exit: 2410, netPnl: 40, closeType: "TP" });

  const all = await listTrades();
  const realStats = compute(all, { universe: "REAL", stageId: stage.id });
  const demoStats = compute(all, { universe: "DEMO", stageId: stage.id });
  const btStats = compute(all, { universe: "BACKTEST", stageId: stage.id });
  const propStats = compute(all, { context: Context.PROP_CHALLENGE, stageId: stage.id });
  const fundedStats = compute(all, { context: Context.FUNDED, stageId: stage.id });
  const eurusdReal = compute(all, { universe: "REAL", asset: "EURUSD", stageId: stage.id });
  assert("Demo separado de Real", demoStats.nClosed === 1 && demoStats.netPnl === 15 && realStats.netPnl !== 15);
  assert("Real no mete DEMO", realStats.netPnl === 120 && realStats.nClosed === 2);
  assert("Prop/Funded filtrables", propStats.nClosed === 0 && fundedStats.netPnl === 40);
  assert("WR/PF/expectancy usan misma stats.compute", realStats.winRate != null && Object.prototype.hasOwnProperty.call(realStats, "profitFactorUsd"));
  assert("stats agrupan por asset canónico", eurusdReal.netPnl === 80 && eurusdReal.nClosed === 1);
  assert("BACKTEST independiente", btStats.netPnl !== realStats.netPnl && btStats.netPnl !== demoStats.netPnl && Number(btStats.netPnl) >= 999);

  const voided = await voidTrade(liveClosed.id, "ACCIDENT");
  const afterVoid = accountBalance(liveAcc, await listAccountMovements(liveAcc.id), await listTrades());
  assert("VOID sale del balance", afterVoid === 2020 && voided.lifecycle === "VOID");

  const live2 = await createTrade({
    asset: "EURUSD", context: "LIVE", direction: "LONG", entry: 1.1, accountId: liveAcc.id,
  }, stage.id);
  const closed2 = await closeTrade(live2.id, { exit: 1.11, netPnl: 10, closeType: "TP" });
  const beforeAmend = accountBalance(liveAcc, await listAccountMovements(liveAcc.id), await listTrades());
  await amendClosedTrade(closed2.id, { netPnl: 25 });
  const afterAmend = accountBalance(liveAcc, await listAccountMovements(liveAcc.id), await listTrades());
  assert("amendment netPnl reconstruye balance", afterAmend === beforeAmend + 15);

  const payload = await buildExportPayload();
  assert("export conserva accountId", payload.trades.some((t) => t.id === propOpen.id && t.accountId === propAcc.id));
  assert("export Account.challengeId", payload.accounts.some((a) => a.id === propAcc.id && a.challengeId === ch.id));
  assert("export brokerSymbol", payload.trades.some((t) => t.brokerSymbol === "EURUSDc"));
  assert("FK trade→account", payload.trades.filter((t) => t.accountId).every((t) => payload.accounts.some((a) => a.id === t.accountId)));

  if (indexedDB.databases) {
    const dbs = await indexedDB.databases();
    assert("V1 aislado", !dbs.some((d) => d && d.name === V1_DB_NAME));
  } else assert("V1 aislado", true);

  const unusedMovs = await listMovements();
  assert("suite no inventa payout movement", !unusedMovs.some((m) => m.note && /payout/i.test(String(m.note))));

  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  lines.push("");
  lines.push(failed.length ? `${failed.length} fallos` : `${results.length} tests OK`);
  const out = document.getElementById("out");
  out.textContent += "\n\nSLICE 8\n" + lines.join("\n");
  if (failed.length) out.className = "fail";
  if (failed.length) throw new Error("slice8 " + failed.length);
}

export { run };
