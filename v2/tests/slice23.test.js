import { ensureJournalSeed } from "../js/domain/stage.js";
import { createClosedTrade, enrichTrade } from "../js/domain/trade.js";
import { getTrade } from "../js/storage/repos/trades.js";
import { compute, filterTrades, assetsPresent, assetFilterOptions } from "../js/domain/stats.js";
import { renderHistorial } from "../js/ui/screens/historial.js";
import { renderNumeros } from "../js/ui/screens/numeros.js";
import { ROADMAP_ASSETS } from "../js/config.js";
import { Strategy, Style, CloseType, Lifecycle, TradeRecordSource } from "../js/domain/enums.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
}

function flatten(nodes) {
  const host = document.createElement("div");
  host.append(...[].concat(nodes).filter(Boolean));
  return host;
}

function optionValues(select) {
  return [...select.options].map((o) => o.value);
}

async function closed(stageId, input) {
  return createClosedTrade({
    openedAt: "2026-09-11T09:00:00.000Z",
    closedAt: "2026-09-11T10:00:00.000Z",
    entry: 1,
    exit: 2,
    closeType: CloseType.MANUAL,
    style: Style.DAY,
    ...input,
  }, stageId);
}

async function run() {
  const seed = await ensureJournalSeed();
  const { stage } = seed;
  const ctxBase = { ...seed, route: { name: "historial", rest: "", query: {} } };

  const nzd1 = await closed(stage.id, {
    asset: "NZDJPY", direction: "SHORT", strategy: Strategy.RED,
    netPnl: -10, note: "f4-nzd-1",
  });
  const nzd2 = await closed(stage.id, {
    asset: "nzdjpy", direction: "SHORT", strategy: Strategy.RED,
    netPnl: -5, note: "f4-nzd-2",
  });
  const eur = await closed(stage.id, {
    asset: "EURUSD", direction: "LONG", strategy: Strategy.BLUE,
    netPnl: 8, note: "f4-eur",
  });
  const ger = await closed(stage.id, {
    asset: "GER40", direction: "LONG", strategy: Strategy.PINK,
    netPnl: 3, note: "f4-ger",
  });

  const before = JSON.stringify(await getTrade(nzd1.id));

  const present = assetsPresent([nzd1, nzd2, eur, ger]);
  assert("assetsPresent normaliza y dedup", present.join(",") === "EURUSD,GER40,NZDJPY");
  const opts = assetFilterOptions([nzd1, nzd2, eur, ger], "");
  const values = opts.map((o) => o[0]);
  assert("opciones sin duplicados", values.length === new Set(values).size);
  assert("opciones no son solo ROADMAP", values.includes("NZDJPY") && values.includes("GER40"));
  assert("ROADMAP_ASSETS intacto", ROADMAP_ASSETS.map((a) => a.id).join(",") === "EURUSD,NZDUSD,XAUUSD,SP500");

  const histAll = flatten(await renderHistorial(ctxBase));
  const histAsset = histAll.querySelector('[name="asset"]');
  const histOpts = optionValues(histAsset);
  assert("Historial filtro incluye NZDJPY", histOpts.includes("NZDJPY"));
  assert("Historial filtro incluye GER40", histOpts.includes("GER40"));
  assert("Historial filtro sin dup NZDJPY", histOpts.filter((v) => v === "NZDJPY").length === 1);
  assert("Historial Todos muestra NZDJPY", /NZDJPY/.test(histAll.textContent));
  assert("Historial Todos muestra EURUSD", /EURUSD/.test(histAll.textContent));

  const histNzd = flatten(await renderHistorial({
    ...seed,
    route: { name: "historial", rest: "", query: { asset: "NZDJPY" } },
  }));
  const histRows = [...histNzd.querySelectorAll("button.row.hist")];
  const histAssets = histRows.map((row) => (row.querySelector("strong") || {}).textContent);
  assert("Historial NZDJPY solo esos trades", histRows.length >= 2 && histAssets.length > 0 && histAssets.every((a) => a === "NZDJPY"));
  assert("Historial NZDJPY no lista EURUSD", !histAssets.includes("EURUSD") && !histAssets.includes("GER40"));

  const histRed = flatten(await renderHistorial({
    ...seed,
    route: { name: "historial", rest: "", query: { asset: "NZDJPY", strategy: Strategy.RED } },
  }));
  const histRedRows = [...histRed.querySelectorAll("button.row.hist")];
  const histRedAssets = histRedRows.map((row) => (row.querySelector("strong") || {}).textContent);
  const histRedMeta = histRedRows.map((row) => row.textContent);
  assert("Historial NZDJPY+RED", histRedRows.length >= 2 && histRedAssets.every((a) => a === "NZDJPY") && histRedMeta.every((t) => /RED/.test(t)));

  const numAll = flatten(await renderNumeros({
    ...seed,
    route: { name: "numeros", rest: "", query: { universe: "BACKTEST" } },
  }));
  const numAsset = numAll.querySelector('[name="asset"]');
  assert("Números filtro incluye NZDJPY", optionValues(numAsset).includes("NZDJPY"));
  assert("Números filtro incluye GER40", optionValues(numAsset).includes("GER40"));
  assert("Números filtro sin dup", optionValues(numAsset).filter((v) => v === "NZDJPY").length === 1);

  const statsNzd = compute([nzd1, nzd2, eur, ger], { universe: "BACKTEST", asset: "NZDJPY" });
  assert("Números NZDJPY solo esos", statsNzd.nClosed === 2 && statsNzd.netPnl === -15);
  const statsEur = compute([nzd1, nzd2, eur, ger], { universe: "BACKTEST", asset: "EURUSD" });
  assert("Números EURUSD separado", statsEur.nClosed === 1 && statsEur.netPnl === 8);
  const statsRed = compute([nzd1, nzd2, eur, ger], { universe: "BACKTEST", asset: "NZDJPY", strategy: Strategy.RED });
  assert("Números NZDJPY+RED intersección", statsRed.nClosed === 2 && statsRed.netPnl === -15);
  const statsPink = compute([nzd1, nzd2, eur, ger], { universe: "BACKTEST", asset: "NZDJPY", strategy: Strategy.PINK });
  assert("Números NZDJPY+PINK vacío", statsPink.nClosed === 0);

  const numNzd = flatten(await renderNumeros({
    ...seed,
    route: { name: "numeros", rest: "", query: { universe: "BACKTEST", asset: "NZDJPY" } },
  }));
  assert("Números UI NZDJPY seleccionado", numNzd.querySelector('[name="asset"]').value === "NZDJPY");
  const totalMetric = [...numNzd.querySelectorAll(".metric")].find((m) => /Total Trades/.test(m.textContent));
  const totalN = totalMetric && totalMetric.querySelector("strong") ? Number(totalMetric.querySelector("strong").textContent) : 0;
  assert("Números UI Total Trades NZDJPY", Number.isFinite(totalN) && totalN >= 2);

  const unc = await closed(stage.id, {
    asset: "NZDJPY", direction: "SHORT", strategy: Strategy.UNCLASSIFIED,
    netPnl: -2, note: "f4-unc",
  });
  const asUnc = filterTrades([unc], { strategy: Strategy.UNCLASSIFIED });
  assert("UNCLASSIFIED filtrable", asUnc.length === 1 && asUnc[0].id === unc.id);
  const afterEnrich = await enrichTrade(unc.id, { strategy: Strategy.RED });
  assert("enrich UNCLASSIFIED → RED", afterEnrich.strategy === Strategy.RED);
  assert("ya no está en UNCLASSIFIED", filterTrades([afterEnrich], { strategy: Strategy.UNCLASSIFIED }).length === 0);
  assert("aparece en RED", filterTrades([afterEnrich], { strategy: Strategy.RED, asset: "NZDJPY" }).some((t) => t.id === unc.id));

  const after = JSON.stringify(await getTrade(nzd1.id));
  assert("filtros no mutan trades", before === after);
  assert("provenance manual intacta", (await getTrade(nzd1.id)).recordSource === TradeRecordSource.MANUAL);
  assert("lifecycle intacto", (await getTrade(nzd1.id)).lifecycle === Lifecycle.CLOSED);

  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  lines.push("");
  lines.push(failed.length ? `${failed.length} fallos` : `${results.length} tests OK`);
  const out = document.getElementById("out");
  out.textContent += "\n\nSLICE 23\n" + lines.join("\n");
  if (failed.length) out.className = "fail";
  if (failed.length) throw new Error("slice23 " + failed.length);
}

export { run };
