import { ensureJournalSeed } from "../js/domain/stage.js";
import { createObservation } from "../js/domain/observation.js";
import { createSetup, evaluateSetup } from "../js/domain/setup.js";
import { getSetup } from "../js/storage/repos/setups.js";
import {
  createTrade,
  updateOpenTrade,
  closeTrade,
  voidTrade,
  listStageTrades,
} from "../js/domain/trade.js";
import { getTrade, listTrades } from "../js/storage/repos/trades.js";
import { deriveResult, computeRrRealized } from "../js/domain/integrity.js";
import { buildExportPayload } from "../js/services/backup.js";
import { V1_DB_NAME } from "../js/config.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
}

async function run() {
  const { stage } = await ensureJournalSeed();

  const direct = await createTrade({
    asset: "EURUSD",
    context: "BACKTEST",
    direction: "LONG",
    entry: 1.1,
  }, stage.id);
  assert("trade BACKTEST directo", direct.setupId == null && direct.context === "BACKTEST");
  assert("accountId null BACKTEST", direct.accountId == null);
  assert("OPEN sin SL incompleto R", direct.incompleteForR === true && direct.lifecycle === "OPEN");

  try {
    await createTrade({
      asset: "EURUSD",
      context: "LIVE",
      direction: "LONG",
      entry: 1.1,
    }, stage.id);
    assert("LIVE exige account", false);
  } catch (e) {
    assert("LIVE exige account", /accountId/.test(e.message));
  }

  const obs = await createObservation({ asset: "EURUSD", note: "zona" }, stage.id);
  const setup = await createSetup({
    asset: "EURUSD",
    context: "BACKTEST",
    direction: "LONG",
    observationId: obs.id,
  }, stage.id);
  await evaluateSetup(setup.id, {
    plannedEntry: 1.1,
    plannedSl: 1.09,
    plannedTp: 1.13,
    strategy: "RED",
  });
  const unlocked = await getSetup(setup.id);
  assert("eval editable antes del trade", !unlocked.validationLockedAt);

  const t1 = await createTrade({
    asset: setup.asset,
    context: setup.context,
    direction: setup.direction,
    entry: 1.105,
    initialSL: 1.09,
    setupId: setup.id,
  }, stage.id);
  assert("trade desde setup", t1.setupId === setup.id);
  assert("planned ≠ actual", t1.entry === 1.105 && unlocked.plannedEntry === 1.1);
  assert("strategy snapshot", t1.strategy === "RED");
  const locked = await getSetup(setup.id);
  assert("primer trade congela setup", Boolean(locked.validationLockedAt));
  try {
    await evaluateSetup(setup.id, { verdict: "VALID" });
    assert("eval bloqueada post trade", false);
  } catch (e) {
    assert("eval bloqueada post trade", /congelado/.test(e.message));
  }

  const moved = await updateOpenTrade(t1.id, { currentSL: 1.095, management: "parcial TP1, mismo trade" });
  assert("currentSL no pisa initialSL", moved.initialSL === 1.09 && moved.currentSL === 1.095);
  assert("parcial no crea trade nuevo", (await listStageTrades(stage.id, { setupId: setup.id })).length === 1);

  const closed = await closeTrade(t1.id, { exit: 1.13, netPnl: 30, closeType: "TP" });
  assert("cierre WIN", closed.result === "WIN" && closed.lifecycle === "CLOSED");
  assert("R derivado", Math.abs(closed.rrRealized - ((1.13 - 1.105) / (1.105 - 1.09))) < 1e-9);

  const lossT = await createTrade({
    asset: "EURUSD", context: "BACKTEST", direction: "LONG", entry: 1.1, initialSL: 1.09, setupId: setup.id,
  }, stage.id);
  const lost = await closeTrade(lossT.id, { exit: 1.09, netPnl: -12, closeType: "SL" });
  assert("LOSS", lost.result === "LOSS");

  const beT = await createTrade({
    asset: "EURUSD", context: "BACKTEST", direction: "LONG", entry: 1.1, initialSL: 1.09, setupId: setup.id,
  }, stage.id);
  const be = await closeTrade(beT.id, { exit: 1.1, netPnl: 0.4, closeType: "BE", declaredBe: true });
  assert("BE declarado no por aproximación", be.result === "BE" && be.netPnl === 0.4);
  assert("signo 0 es BE", deriveResult("MANUAL", 0) === "BE");
  assert("0.01 no es BE", deriveResult("MANUAL", 0.01) === "WIN");

  const noR = await createTrade({
    asset: "EURUSD", context: "BACKTEST", direction: "LONG", entry: 1.2,
  }, stage.id);
  const closedNoR = await closeTrade(noR.id, { exit: 1.21, netPnl: 5, closeType: "MANUAL" });
  assert("R n/a sin initialSL", closedNoR.rrRealized == null && computeRrRealized(closedNoR) == null);

  const listed = await listStageTrades(stage.id, { setupId: setup.id });
  assert("1 setup → N trades", listed.length === 3);

  try {
    await voidTrade(closed.id);
    assert("VOID exige motivo", false);
  } catch (e) {
    assert("VOID exige motivo", /voidReason/.test(e.message));
  }
  const voided = await voidTrade(closed.id, "TEST");
  assert("VOID persistido", voided.lifecycle === "VOID" && Boolean(await getTrade(voided.id)));
  const hist = await listStageTrades(stage.id, { context: "BACKTEST" });
  assert("Historial lista no-VOID", hist.some((t) => t.id === lost.id) && hist.every((t) => t.lifecycle !== "VOID"));
  assert("VOID no desaparece", (await listTrades()).some((t) => t.id === voided.id));

  const payload = await buildExportPayload();
  assert("export contiene trades", payload.trades.some((t) => t.id === t1.id && t.setupId === setup.id));

  if (indexedDB.databases) {
    const dbs = await indexedDB.databases();
    assert("V1 aislado", !dbs.some((d) => d.name === V1_DB_NAME));
  } else assert("V1 aislado", true);

  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  lines.push("");
  lines.push(failed.length ? `${failed.length} fallos` : `${results.length} tests OK`);
  const out = document.getElementById("out");
  out.textContent += "\n\nSLICE 3\n" + lines.join("\n");
  if (failed.length) out.className = "fail";
  if (failed.length) throw new Error("slice3 " + failed.length);
}

export { run };
