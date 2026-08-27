import { ensureJournalSeed } from "../js/domain/stage.js";
import {
  createAccount,
  archiveAccount,
  setActiveAccount,
  getActiveAccount,
  listStageAccounts,
  correctInitialAmount,
  accountBalance,
} from "../js/domain/account.js";
import { createMovement, voidMovement, listAccountMovements } from "../js/domain/movement.js";
import { getAccount } from "../js/storage/repos/accounts.js";
import { getMeta } from "../js/storage/repos/meta.js";
import { compute } from "../js/domain/stats.js";
import { Context } from "../js/domain/enums.js";
import { buildExportPayload } from "../js/services/backup.js";
import { V1_DB_NAME } from "../js/config.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
}

async function run() {
  const { stage } = await ensureJournalSeed();
  assert("cero cuentas fantasma", (await listStageAccounts(stage.id, { includeArchived: true })).length === 0);

  try {
    await createAccount({ name: "x", context: "FOO", currency: "EUR", initialAmount: 100 }, stage.id);
    assert("tipo inválido rechazado", false);
  } catch (e) {
    assert("tipo inválido rechazado", /inválido/.test(e.message));
  }
  try {
    await createAccount({ name: "x", context: "BACKTEST", currency: "EUR", initialAmount: 100 }, stage.id);
    assert("BACKTEST no es tipo de cuenta Slice 6", false);
  } catch (e) {
    assert("BACKTEST no es tipo de cuenta Slice 6", /inválido/.test(e.message));
  }
  try {
    await createAccount({ name: "x", context: "LIVE", initialAmount: 100 }, stage.id);
    assert("currency required", false);
  } catch (e) {
    assert("currency required", /currency/.test(e.message));
  }
  try {
    await createAccount({ name: "x", context: "LIVE", currency: "EUR", initialAmount: "abc" }, stage.id);
    assert("initialAmount válido", false);
  } catch (e) {
    assert("initialAmount válido", /initialAmount/.test(e.message));
  }

  const demo = await createAccount({ name: "Demo EU", context: "DEMO", currency: "EUR", initialAmount: 1000 }, stage.id);
  const live = await createAccount({ name: "Live USD", context: "LIVE", currency: "USD", initialAmount: 2500 }, stage.id);
  const prop = await createAccount({ name: "Prop 50k", context: "PROP", currency: "USD", initialAmount: 50000 }, stage.id);
  const funded = await createAccount({ name: "Funded", context: "FUNDED", currency: "EUR", initialAmount: 8000 }, stage.id);
  assert("crear Account válida", demo.name === "Demo EU" && demo.status === "ACTIVE");
  assert("DEMO válido", demo.context === "DEMO");
  assert("LIVE válido", live.context === "LIVE");
  assert("PROP persiste PROP_CHALLENGE", prop.context === "PROP_CHALLENGE");
  assert("FUNDED válido", funded.context === "FUNDED");
  assert("sin Movement INITIAL", (await listAccountMovements(demo.id)).length === 0);

  try {
    await setActiveAccount("00000000-0000-4000-8000-000000000404");
    assert("no activar inexistente", false);
  } catch (e) {
    assert("no activar inexistente", /no existe/.test(e.message));
  }
  await setActiveAccount(demo.id);
  assert("marcar Account activa", (await getActiveAccount()).id === demo.id);
  assert("meta.activeAccountId", (await getMeta()).activeAccountId === demo.id);

  const dep = await createMovement({ accountId: demo.id, type: "DEPOSIT", amount: 200, date: "2026-08-01" }, stage.id);
  const wd = await createMovement({ accountId: demo.id, type: "WITHDRAWAL", amount: 50, date: "2026-08-02" }, stage.id);
  const fee = await createMovement({ accountId: demo.id, type: "FEE", amount: 10, date: "2026-08-03", note: "comision" }, stage.id);
  const adjP = await createMovement({ accountId: demo.id, type: "ADJUSTMENT", amount: 15, date: "2026-08-04" }, stage.id);
  const adjN = await createMovement({ accountId: demo.id, type: "ADJUSTMENT", amount: -5, date: "2026-08-05" }, stage.id);
  assert("crear DEPOSIT", dep.amount === 200 && dep.type === "DEPOSIT");
  assert("crear WITHDRAWAL", wd.amount === -50 && wd.type === "WITHDRAWAL");
  assert("crear FEE", fee.amount === -10 && fee.type === "FEE_EXTERNAL");
  assert("crear ADJUSTMENT positivo", adjP.amount === 15);
  assert("crear ADJUSTMENT negativo", adjN.amount === -5);
  assert("moneda del movement = Account", fee.currency === "EUR");

  try {
    await createMovement({ accountId: "00000000-0000-4000-8000-000000000404", type: "DEPOSIT", amount: 1 }, stage.id);
    assert("Movement exige Account existente", false);
  } catch (e) {
    assert("Movement exige Account existente", /account no existe/.test(e.message));
  }
  try {
    await createMovement({ accountId: demo.id, type: "DEPOSIT", amount: -20 }, stage.id);
    assert("DEPOSIT no acepta negativo", false);
  } catch (e) {
    assert("DEPOSIT no acepta negativo", /positivo/.test(e.message));
  }

  const movs = await listAccountMovements(demo.id);
  const bal = accountBalance(demo, movs);
  assert("balance = initial + signed movements", bal === 1000 + 200 - 50 - 10 + 15 - 5, String(bal));

  const before = await getAccount(demo.id);
  const patched = { ...before, initialAmount: 1 };
  await (await import("../js/storage/repos/accounts.js")).putAccount(patched);
  const afterSilent = await getAccount(demo.id);
  assert("repo puede escribir initialAmount crudo", afterSilent.initialAmount === 1);
  const restored = await correctInitialAmount(demo.id, 1000);
  assert("corrección explícita de initialAmount", restored.initialAmount === 1000);

  const voided = await voidMovement(dep.id, "ACCIDENT");
  assert("invalidar Movement no lo borra", Boolean(await (await import("../js/storage/repos/movements.js")).getMovement(dep.id)));
  assert("VOID deja de afectar balance", accountBalance(demo, await listAccountMovements(demo.id)) === 1000 - 50 - 10 + 15 - 5);
  assert("VOID conserva motivo", voided.lifecycle === "VOID" && voided.voidReason === "ACCIDENT");

  await setActiveAccount(demo.id);
  await archiveAccount(demo.id);
  assert("archivar conserva Movements", (await listAccountMovements(demo.id)).length === 5);
  assert("archivar activa limpia activeAccountId", (await getMeta()).activeAccountId == null);
  assert("getActiveAccount vacío post-archivo", (await getActiveAccount()) == null);
  try {
    await setActiveAccount(demo.id);
    assert("no activar archivada", false);
  } catch (e) {
    assert("no activar archivada", /archivada/.test(e.message));
  }

  const sample = [
    { id: "s1", stageId: stage.id, context: Context.BACKTEST, lifecycle: "CLOSED", result: "WIN", netPnl: 10, asset: "EURUSD", strategy: "UNCLASSIFIED", openedAt: "2026-08-01", closedAt: "2026-08-01", hasPartials: false, entry: 1.1, initialSL: 1.09, exit: 1.12, direction: "LONG" },
  ];
  const statsA = compute(sample, { context: Context.BACKTEST, stageId: stage.id });
  const statsB = compute(sample, { context: Context.BACKTEST, stageId: stage.id });
  assert("movements no afectan stats.compute", statsA.netPnl === statsB.netPnl && statsA.nClosed === 1);

  const payload = await buildExportPayload();
  assert("export contiene accounts", payload.accounts.some((a) => a.id === live.id && a.currency === "USD"));
  assert("export contiene movements", payload.movements.some((m) => m.id === fee.id && m.accountId === demo.id));
  assert("export meta.activeAccountId", payload.meta.activeAccountId == null || typeof payload.meta.activeAccountId === "string");
  assert("FK accountId válido", payload.movements.every((m) => payload.accounts.some((a) => a.id === m.accountId)));

  if (indexedDB.databases) {
    const dbs = await indexedDB.databases();
    assert("V1 aislado", !dbs.some((d) => d && d.name === V1_DB_NAME));
  } else assert("V1 aislado", true);

  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  lines.push("");
  lines.push(failed.length ? `${failed.length} fallos` : `${results.length} tests OK`);
  const out = document.getElementById("out");
  out.textContent += "\n\nSLICE 6\n" + lines.join("\n");
  if (failed.length) out.className = "fail";
  if (failed.length) throw new Error("slice6 " + failed.length);
}

export { run };
