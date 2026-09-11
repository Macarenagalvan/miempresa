import { ensureJournalSeed } from "../js/domain/stage.js";
import { createAccount } from "../js/domain/account.js";
import { createTrade, createClosedTrade, enrichTrade, syncMt5Csv, findTradeByMt5Position } from "../js/domain/trade.js";
import { getTrade } from "../js/storage/repos/trades.js";
import { createSetup, evaluateSetup } from "../js/domain/setup.js";
import { compute, filterTrades } from "../js/domain/stats.js";
import { addTradeImage, listTradeImages } from "../js/storage/repos/attachments.js";
import { renderTradeDetail } from "../js/ui/screens/trade-detail.js";
import { renderHistorial } from "../js/ui/screens/historial.js";
import { renderNumeros } from "../js/ui/screens/numeros.js";
import { renderNuevoTrade } from "../js/ui/screens/trade-new.js";
import { MT5_SLICE11_ROWS, asMt5Csv } from "../js/fixtures/mt5-slice11.js";
import { ROADMAP_ASSETS, SCHEMA_VERSION } from "../js/config.js";
import {
  TradeRecordSource,
  Lifecycle,
  Strategy,
  Style,
  CloseType,
  Context,
  strategyLabel,
} from "../js/domain/enums.js";

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

function optionTexts(select) {
  return [...select.options].map((o) => o.textContent);
}

function pngBlob() {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  return new Blob([bytes], { type: "image/png" });
}

async function run() {
  const seed = await ensureJournalSeed();
  const { stage } = seed;
  const ctxBase = { ...seed, route: { name: "historial", rest: "", query: {} } };

  assert("GREEN_CRYPTO en enum", Strategy.GREEN_CRYPTO === "GREEN_CRYPTO");
  assert("GREEN intacto", Strategy.GREEN === "GREEN");
  assert("GREEN != GREEN_CRYPTO", Strategy.GREEN !== Strategy.GREEN_CRYPTO);
  assert("label GREEN CRYPTO", strategyLabel(Strategy.GREEN_CRYPTO) === "GREEN CRYPTO");
  assert("label GREEN no cambia", strategyLabel(Strategy.GREEN) === "GREEN");
  assert("RGM no es Strategy", !Object.values(Strategy).some((s) => /RGM|SHADOW|RCC/i.test(s)));
  assert("schema sin bump", SCHEMA_VERSION === 3);

  const setup = await createSetup({
    asset: "BTCUSD",
    context: Context.BACKTEST,
    direction: "LONG",
  }, stage.id);
  const evaled = await evaluateSetup(setup.id, { strategy: Strategy.GREEN_CRYPTO, style: Style.DAY });
  assert("Idea acepta GREEN_CRYPTO", evaled.strategy === Strategy.GREEN_CRYPTO);
  const stillGreenSetup = await evaluateSetup(setup.id, { strategy: Strategy.GREEN });
  assert("Idea también acepta GREEN", stillGreenSetup.strategy === Strategy.GREEN);
  await evaluateSetup(setup.id, { strategy: Strategy.GREEN_CRYPTO });

  const greenLegacy = await createClosedTrade({
    asset: "XAUUSD",
    direction: "LONG",
    strategy: Strategy.GREEN,
    style: Style.DAY,
    entry: 2400,
    exit: 2410,
    openedAt: "2026-09-11T08:00:00.000Z",
    closedAt: "2026-09-11T09:00:00.000Z",
    netPnl: 20,
    closeType: CloseType.TP,
  }, stage.id);
  assert("GREEN existente no se reescribe", greenLegacy.strategy === Strategy.GREEN);

  const crypto = await createClosedTrade({
    asset: "BTCUSD",
    direction: "LONG",
    strategy: Strategy.GREEN_CRYPTO,
    style: Style.DAY,
    entry: 65000,
    exit: 66000,
    openedAt: "2026-09-11T11:00:00.000Z",
    closedAt: "2026-09-11T12:00:00.000Z",
    netPnl: 80,
    closeType: CloseType.TP,
    note: "green-crypto-case",
  }, stage.id);
  assert("BTCUSD GREEN_CRYPTO persiste", crypto.strategy === Strategy.GREEN_CRYPTO && crypto.asset === "BTCUSD");
  const cryptoAgain = await getTrade(crypto.id);
  assert("reload GREEN_CRYPTO", cryptoAgain.strategy === Strategy.GREEN_CRYPTO);
  assert("GREEN no absorbe CRYPTO", filterTrades([greenLegacy, crypto], { strategy: Strategy.GREEN }).every((t) => t.strategy === Strategy.GREEN));
  assert("filtro GREEN_CRYPTO aislado", filterTrades([greenLegacy, crypto], { strategy: Strategy.GREEN_CRYPTO }).every((t) => t.id === crypto.id));
  const statsGreen = compute([greenLegacy, crypto], { universe: "BACKTEST", strategy: Strategy.GREEN });
  const statsCrypto = compute([greenLegacy, crypto], { universe: "BACKTEST", strategy: Strategy.GREEN_CRYPTO });
  assert("stats GREEN independiente", statsGreen.nClosed === 1 && statsGreen.netPnl === 20);
  assert("stats GREEN_CRYPTO independiente", statsCrypto.nClosed === 1 && statsCrypto.netPnl === 80);

  const histAll = flatten(await renderHistorial({ ...ctxBase, route: { name: "historial", rest: "", query: {} } }));
  const stratSel = histAll.querySelector('select[name="strategy"]');
  assert("Historial lista GREEN_CRYPTO", optionValues(stratSel).includes(Strategy.GREEN_CRYPTO));
  assert("Historial label GREEN CRYPTO", optionTexts(stratSel).includes("GREEN CRYPTO"));
  const histCrypto = flatten(await renderHistorial({
    ...ctxBase,
    route: { name: "historial", rest: "", query: { strategy: Strategy.GREEN_CRYPTO } },
  }));
  assert("Historial filtra GREEN_CRYPTO", /BTCUSD/.test(histCrypto.textContent) && /GREEN CRYPTO/.test(histCrypto.textContent));
  const cryptoRows = [...histCrypto.querySelectorAll(".row.hist strong")].map((n) => n.textContent);
  assert("Historial filtro no mezcla GREEN", cryptoRows.length >= 1 && cryptoRows.every((a) => a === "BTCUSD"));

  const numCrypto = flatten(await renderNumeros({
    ...ctxBase,
    route: { name: "numeros", rest: "", query: { universe: "BACKTEST", strategy: Strategy.GREEN_CRYPTO } },
  }));
  const numStrat = numCrypto.querySelector('select[name="strategy"]');
  assert("Números lista GREEN_CRYPTO", optionValues(numStrat).includes(Strategy.GREEN_CRYPTO));
  assert("Números label GREEN CRYPTO", optionTexts(numStrat).includes("GREEN CRYPTO"));

  const cardCrypto = flatten(await renderTradeDetail({
    ...seed,
    route: { name: "trade", rest: crypto.id, query: {} },
  }));
  assert("ficha muestra GREEN CRYPTO", /strategy GREEN CRYPTO/.test(cardCrypto.textContent));
  const editCrypto = flatten(await renderTradeDetail({
    ...seed,
    route: { name: "trade", rest: crypto.id + "/editar", query: {} },
  }));
  const editSel = editCrypto.querySelector('select[name="strategy"]');
  assert("editar value GREEN_CRYPTO", editSel && editSel.value === Strategy.GREEN_CRYPTO);
  assert("editar label GREEN CRYPTO", optionTexts(editSel).includes("GREEN CRYPTO"));

  const nuevo = flatten(await renderNuevoTrade({
    ...seed,
    route: { name: "nuevo", rest: "trade", query: {} },
  }));
  const nuevoStrat = nuevo.querySelector('select[name="strategy"]');
  assert("alta lista GREEN_CRYPTO", optionValues(nuevoStrat).includes(Strategy.GREEN_CRYPTO));
  assert("alta label GREEN CRYPTO", optionTexts(nuevoStrat).includes("GREEN CRYPTO"));
  const lotsInput = nuevo.querySelector('input[name="lots"]');
  assert("alta tiene Lotaje", lotsInput && lotsInput.tagName === "INPUT");
  assert("alta Lotaje vacío", lotsInput.value === "");
  const assetInput = nuevo.querySelector('input[name="asset"]');
  assert("alta asset libre", assetInput && assetInput.tagName === "INPUT");
  assert("ROADMAP no es whitelist de trade", !ROADMAP_ASSETS.some((a) => a.id === "NZDJPY") && !ROADMAP_ASSETS.some((a) => a.id === "BTCUSD"));

  const manual = await createClosedTrade({
    asset: "NZDJPY",
    direction: "SHORT",
    strategy: Strategy.RED,
    style: Style.SCALP,
    session: "LONDON",
    openedAt: "2026-09-11T07:00:00.000Z",
    closedAt: "2026-09-11T08:00:00.000Z",
    entry: 87.15,
    exit: 87.42,
    initialSL: 87.05,
    tp: 86.80,
    rrPlanned: 1.5,
    riskPercent: 0.5,
    riskMoney: 50,
    management: "parcial en 0.5R",
    note: "manual-closed-final",
    hasPartials: true,
    netPnl: -31,
    commission: -1.2,
    swap: -0.3,
    lots: 0.20,
    closeType: CloseType.SL,
  }, stage.id);
  assert("manual nace CLOSED", manual.lifecycle === Lifecycle.CLOSED && manual.strategy === Strategy.RED);
  assert("manual no pasó por OPEN", manual.openedAt && manual.closedAt && manual.exit === 87.42);
  const manualReload = await getTrade(manual.id);
  assert("reload manual strategy/style/SL", manualReload.strategy === Strategy.RED && manualReload.style === Style.SCALP && manualReload.initialSL === 87.05);
  assert("reload manual risk/mgmt/note", manualReload.riskPercent === 0.5 && manualReload.riskMoney === 50 && manualReload.management === "parcial en 0.5R" && manualReload.note === "manual-closed-final");
  assert("reload manual costs/partials", manualReload.commission === -1.2 && manualReload.swap === -0.3 && manualReload.hasPartials === true && manualReload.closeType === CloseType.SL);
  assert("reload manual TP/RR", manualReload.tp === 86.80 && manualReload.rrPlanned === 1.5);
  assert("CLOSED manual lots 0.20", manual.lots === 0.2);
  assert("reload CLOSED lots", manualReload.lots === 0.2);

  const cardClosed = flatten(await renderTradeDetail({
    ...seed,
    route: { name: "trade", rest: manual.id, query: {} },
  }));
  const closedTxt = cardClosed.textContent;
  assert("ficha CLOSED openedAt", /openedAt 2026-09-11T07:00:00.000Z/.test(closedTxt));
  assert("ficha CLOSED closedAt", /closedAt 2026-09-11T08:00:00.000Z/.test(closedTxt));
  assert("ficha CLOSED lots", /lots 0\.2/.test(closedTxt));
  assert("ficha CLOSED commission", /commission -1\.2/.test(closedTxt));
  assert("ficha CLOSED swap", /swap -0\.3/.test(closedTxt));

  const emptyLots = await createClosedTrade({
    asset: "EURUSD",
    direction: "LONG",
    strategy: Strategy.BLUE,
    entry: 1.1,
    exit: 1.2,
    openedAt: "2026-09-11T10:00:00.000Z",
    closedAt: "2026-09-11T11:00:00.000Z",
    netPnl: 10,
    closeType: CloseType.TP,
    lots: "",
  }, stage.id);
  assert("empty lots → null", emptyLots.lots === null);
  const emptyReload = await getTrade(emptyLots.id);
  assert("reload empty lots null", emptyReload.lots === null);

  let lotsInvalid = "";
  try {
    await createClosedTrade({
      asset: "EURUSD",
      direction: "LONG",
      entry: 1.1,
      exit: 1.2,
      openedAt: "2026-09-11T10:00:00.000Z",
      closedAt: "2026-09-11T11:00:00.000Z",
      netPnl: 1,
      closeType: CloseType.TP,
      lots: "no-num",
    }, stage.id);
  } catch (e) {
    lotsInvalid = e.message;
  }
  assert("lots inválido rechazado", lotsInvalid === "lots inválido");

  const openLots = await createTrade({
    asset: "NZDJPY",
    direction: "SHORT",
    entry: 87.15,
    lots: 0.20,
  }, stage.id);
  assert("OPEN manual lots 0.20", openLots.lifecycle === Lifecycle.OPEN && openLots.lots === 0.2);
  const openLotsReload = await getTrade(openLots.id);
  assert("reload OPEN lots", openLotsReload.lots === 0.2);
  const cardOpen = flatten(await renderTradeDetail({
    ...seed,
    route: { name: "trade", rest: openLots.id, query: {} },
  }));
  assert("ficha OPEN openedAt", /openedAt /.test(cardOpen.textContent));
  assert("ficha OPEN lots", /lots 0\.2/.test(cardOpen.textContent));
  assert("ficha OPEN no closedAt", !/closedAt /.test(cardOpen.textContent));
  assert("ficha OPEN no commission", !/commission /.test(cardOpen.textContent));

  let enrichLotsBlocked = "";
  try {
    await enrichTrade(openLots.id, { lots: 9 });
  } catch (e) {
    enrichLotsBlocked = e.message;
  }
  assert("enrich no edita lots", enrichLotsBlocked === "campo no editable: lots");
  const afterEnrichLots = await getTrade(openLots.id);
  assert("OPEN lots intacto post enrich reject", afterEnrichLots.lots === 0.2);

  const histManual = flatten(await renderHistorial({
    ...ctxBase,
    route: { name: "historial", rest: "", query: { asset: "NZDJPY", strategy: Strategy.RED } },
  }));
  assert("Historial muestra manual NZDJPY RED", /NZDJPY/.test(histManual.textContent) && /RED/.test(histManual.textContent));
  const statsManual = compute([manual], { universe: "BACKTEST", asset: "NZDJPY", strategy: Strategy.RED });
  assert("Números cuenta manual RED", statsManual.nClosed === 1 && statsManual.netPnl === -31);

  const bullfy = await createAccount(
    { name: "Bullfy PROP F6", context: Context.PROP_CHALLENGE, currency: "USD", initialAmount: 10000 },
    stage.id,
  );
  const src = { accountId: bullfy.id, context: bullfy.context, timeZone: "Europe/Athens" };
  const first = await syncMt5Csv(asMt5Csv([MT5_SLICE11_ROWS.nzdjpyShort]), stage.id, src);
  assert("MT5 reconoce NZDJPY", first.created === 1 && first.unknownSymbols === 0);
  const raw = await findTradeByMt5Position(bullfy.id, "20021");
  assert("MT5 una fila", raw && raw.accountId === bullfy.id && raw.lifecycle === Lifecycle.CLOSED && raw.direction === "SHORT");
  assert("MT5 UNCLASSIFIED", raw.strategy === Strategy.UNCLASSIFIED);
  assert("MT5 brokerSymbol", raw.brokerSymbol === "NZDJPY");
  assert("MT5 provenance", raw.recordSource === TradeRecordSource.MT5_EA && raw.sourceRef && raw.sourceRef.mt5Position === "20021");
  const mt5Lots = raw.lots;
  assert("MT5 lots importado", mt5Lots === 0.1);

  const classified = await enrichTrade(raw.id, {
    strategy: Strategy.RED,
    style: Style.SCALP,
    initialSL: 87.05,
    riskPercent: 0.4,
    riskMoney: 40,
    management: "corte broker",
    note: "mt5-enrich-final",
  });
  assert("MT5 editado RED SCALP SL", classified.strategy === Strategy.RED && classified.style === Style.SCALP && classified.initialSL === 87.05);
  const shot = await addTradeImage(classified.id, { type: "image/png", name: "mt5-final.png", blob: pngBlob() });
  const second = await syncMt5Csv(asMt5Csv([MT5_SLICE11_ROWS.nzdjpyShort]), stage.id, src);
  const again = await getTrade(classified.id);
  const shots = await listTradeImages(again.id);
  assert("reimport duplicate", second.created === 0 && second.duplicates === 1 && again.id === raw.id);
  assert("enriquecimiento sobrevive reimport", again.strategy === Strategy.RED && again.note === "mt5-enrich-final" && again.riskMoney === 40 && again.management === "corte broker");
  assert("MT5 lots no lo pisa enrich/reimport", again.lots === mt5Lots && again.recordSource === TradeRecordSource.MT5_EA && again.sourceRef.mt5Position === "20021");
  let mt5LotsPatch = "";
  try {
    await enrichTrade(again.id, { lots: 99 });
  } catch (e) {
    mt5LotsPatch = e.message;
  }
  assert("enrich no pisa lots MT5", mt5LotsPatch === "campo no editable: lots");
  const mt5AfterPatch = await getTrade(again.id);
  assert("MT5 lots intacto", mt5AfterPatch.lots === 0.1 && mt5AfterPatch.recordSource === TradeRecordSource.MT5_EA);
  assert("attachment sobrevive reimport", shots.length === 1 && shots[0].id === shot.id);
  const samePos = await findTradeByMt5Position(bullfy.id, "20021");
  assert("dedup por position", samePos.id === raw.id);

  const histMt5 = flatten(await renderHistorial({
    ...ctxBase,
    route: { name: "historial", rest: "", query: { asset: "NZDJPY", strategy: Strategy.RED } },
  }));
  assert("Historial incluye MT5 enriquecido", /NZDJPY/.test(histMt5.textContent));
  const statsMt5 = compute([again], { universe: "REAL", strategy: Strategy.RED, accountId: bullfy.id, stageId: stage.id });
  assert("Números REAL ve MT5 RED", statsMt5.nClosed === 1);

  const cardHint = flatten(await renderTradeDetail({
    ...seed,
    route: { name: "trade", rest: classified.id, query: {} },
  }));
  assert("hint imágenes locales", /Local en este dispositivo/.test(cardHint.textContent));
  assert("hint no promete cloud", !/sincroniz/i.test(cardHint.textContent));

  const openCrypto = await createTrade({
    asset: "BTCUSD",
    direction: "SHORT",
    entry: 67000,
  }, stage.id);
  const openEnriched = await enrichTrade(openCrypto.id, { strategy: Strategy.GREEN_CRYPTO, style: Style.SCALP });
  assert("OPEN + enrich GREEN_CRYPTO", openEnriched.lifecycle === Lifecycle.OPEN && openEnriched.strategy === Strategy.GREEN_CRYPTO);
  const openReload = await getTrade(openEnriched.id);
  assert("reload OPEN GREEN_CRYPTO", openReload.strategy === Strategy.GREEN_CRYPTO);

  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  lines.push("");
  lines.push(failed.length ? `${failed.length} fallos` : `${results.length} tests OK`);
  const out = document.getElementById("out");
  out.textContent += "\n\nSLICE 25\n" + lines.join("\n");
  if (failed.length) out.className = "fail";
  if (failed.length) throw new Error("slice25 " + failed.length);
}

export { run };
