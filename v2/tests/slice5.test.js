import { compute, filterTrades, realizedR } from "../js/domain/stats.js";
import { computeRrRealized, hasPartialsRecorded } from "../js/domain/integrity.js";
import {
  SLICE5_STAGE, OTHER_STAGE, SLICE5_TRADES,
  EXPECTED_ALL, EXPECTED_EURUSD, EXPECTED_RED, EXPECTED_UNCLASSIFIED,
} from "../js/fixtures/stats-slice5.js";
import { Context } from "../js/domain/enums.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
}
function close(a, b) {
  if (a == null && b == null) return true;
  if (a === Infinity && b === Infinity) return true;
  return Math.abs(Number(a) - Number(b)) < 1e-9;
}

async function run() {
  const base = { context: Context.BACKTEST, stageId: SLICE5_STAGE };
  const all = compute(SLICE5_TRADES, base);
  assert("W/L/BE", all.nWins === EXPECTED_ALL.nWins && all.nLosses === EXPECTED_ALL.nLosses && all.nBe === EXPECTED_ALL.nBe);
  assert("Total CLOSED", all.nClosed === EXPECTED_ALL.nClosed);
  assert("WR excluye BE", close(all.winRate, EXPECTED_ALL.winRate));
  assert("Net PnL", close(all.netPnl, EXPECTED_ALL.netPnl));
  assert("PF$", close(all.profitFactorUsd, EXPECTED_ALL.profitFactorUsd));
  assert("Expectancy $", close(all.expectancyUsd, EXPECTED_ALL.expectancyUsd));
  assert("n R válido", all.nR === EXPECTED_ALL.nR);
  assert("Expectancy R", close(all.expectancyR, EXPECTED_ALL.expectancyR));
  assert("Max DD", close(all.maxDrawdown, EXPECTED_ALL.maxDrawdown));
  assert("max consec W", all.maxConsecWins === EXPECTED_ALL.maxConsecWins);
  assert("max consec L", all.maxConsecLosses === EXPECTED_ALL.maxConsecLosses);
  assert("OPEN excluido", !filterTrades(SLICE5_TRADES, { ...base, lifecycle: "CLOSED" }).some((t) => t.id === "t7"));
  assert("VOID excluido", all.nClosed === 7 && !filterTrades(SLICE5_TRADES, base).some((t) => t.id === "t8"));
  assert("VOID no entra a PnL", all.netPnl === EXPECTED_ALL.netPnl);
  const eurusd = compute(SLICE5_TRADES, { ...base, asset: "EURUSD" });
  assert("filtro asset EURUSD", eurusd.nClosed === EXPECTED_EURUSD.nClosed && eurusd.nLosses === 1);
  assert("WR EURUSD", close(eurusd.winRate, EXPECTED_EURUSD.winRate));
  assert("nR EURUSD", eurusd.nR === EXPECTED_EURUSD.nR);
  assert("ExpR EURUSD", close(eurusd.expectancyR, EXPECTED_EURUSD.expectancyR));
  const red = compute(SLICE5_TRADES, { ...base, strategy: "RED" });
  assert("filtro strategy RED", red.nClosed === EXPECTED_RED.nClosed && close(red.winRate, EXPECTED_RED.winRate));
  const unc = compute(SLICE5_TRADES, { ...base, strategy: "UNCLASSIFIED" });
  assert("UNCLASSIFIED válido", unc.nClosed === EXPECTED_UNCLASSIFIED.nClosed && unc.nWins === 1 && unc.expectancyR == null);
  const blueA = compute(SLICE5_TRADES, { ...base, strategy: "BLUE", variant: "BLUE_A" });
  assert("filtro variant BLUE_A", blueA.nClosed === 1 && blueA.nWins === 1);
  const shorts = compute(SLICE5_TRADES, { ...base, direction: "SHORT" });
  assert("filtro direction SHORT", shorts.nClosed === 1 && shorts.nWins === 1);
  const london = compute(SLICE5_TRADES, { ...base, session: "LONDON" });
  assert("filtro session LONDON", london.nClosed === 5);
  const period = compute(SLICE5_TRADES, { ...base, from: "2026-01-02", to: "2026-01-03" });
  assert("filtro período", period.nClosed === 2 && period.nWins === 1 && period.nLosses === 1);
  const other = compute(SLICE5_TRADES, { context: Context.BACKTEST, stageId: OTHER_STAGE });
  assert("Stage aislada", other.nClosed === 1 && other.netPnl === 8);
  const live = compute(SLICE5_TRADES, { context: "LIVE", stageId: SLICE5_STAGE });
  const back = compute(SLICE5_TRADES, base);
  assert("BACKTEST aislado", back.netPnl !== live.netPnl && live.nClosed === 1 && live.netPnl === 1000);
  assert("LIVE no entra al default BACKTEST", live.netPnl === 1000 && back.netPnl === 90);
  const partial = SLICE5_TRADES.find((t) => t.id === "t9");
  assert("parciales detectados", hasPartialsRecorded(partial) === true);
  assert("R n/a con parciales", computeRrRealized(partial) == null && realizedR(partial) == null);
  assert("parciales fuera de U_R", back.nR === EXPECTED_ALL.nR);
  const empty = compute([], base);
  assert("vacío WR n/a", empty.winRate == null && empty.expectancyR == null && empty.profitFactorUsd == null);
  const onlyWins = compute(SLICE5_TRADES.filter((t) => t.id === "t1"), base);
  assert("PF infinito sin losses $", onlyWins.profitFactorUsd === Number.POSITIVE_INFINITY);
  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  lines.push("");
  lines.push(failed.length ? `${failed.length} fallos` : `${results.length} tests OK`);
  const out = document.getElementById("out");
  out.textContent += "\n\nSLICE 5\n" + lines.join("\n");
  if (failed.length) out.className = "fail";
  if (failed.length) throw new Error("slice5 " + failed.length);
}

export { run };
