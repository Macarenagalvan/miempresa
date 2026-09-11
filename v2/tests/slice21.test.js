import { ensureJournalSeed } from "../js/domain/stage.js";
import { createAccount } from "../js/domain/account.js";
import {
  createTrade,
  createClosedTrade,
  enrichTrade,
  syncMt5Csv,
  findTradeByMt5Position,
} from "../js/domain/trade.js";
import { compute, filterTrades } from "../js/domain/stats.js";
import { MT5_SLICE11_ROWS, asMt5Csv } from "../js/fixtures/mt5-slice11.js";
import {
  TradeRecordSource,
  Lifecycle,
  Strategy,
  Style,
  CloseType,
  Result,
} from "../js/domain/enums.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
}

function sameRef(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function run() {
  const { stage } = await ensureJournalSeed();
  const tz = "Europe/Athens";
  const live = await createAccount(
    { name: "Live F2", context: "LIVE", currency: "EUR", initialAmount: 1000 },
    stage.id,
  );
  const src = { accountId: live.id, context: live.context, timeZone: tz };

  const openLegacy = await createTrade({
    asset: "EURUSD",
    context: "BACKTEST",
    direction: "LONG",
    entry: 1.1,
    initialSL: 1.09,
  }, stage.id);
  assert("OPEN legacy sigue OPEN", openLegacy.lifecycle === Lifecycle.OPEN && openLegacy.closedAt == null);
  assert("OPEN legacy strategy desde setup/none", openLegacy.strategy === Strategy.UNCLASSIFIED);
  assert("OPEN legacy recordSource MANUAL", openLegacy.recordSource === TradeRecordSource.MANUAL);

  const openEnriched = await enrichTrade(openLegacy.id, { strategy: Strategy.BLUE, style: Style.DAY, note: "open note" });
  assert("enrich OPEN strategy", openEnriched.strategy === Strategy.BLUE && openEnriched.style === Style.DAY);
  assert("enrich OPEN sigue OPEN", openEnriched.lifecycle === Lifecycle.OPEN && openEnriched.result == null);

  try {
    await enrichTrade(openLegacy.id, { closeType: CloseType.SL });
    assert("enrich OPEN no acepta closeType", false);
  } catch (e) {
    assert("enrich OPEN no acepta closeType", /closeType solo en CLOSED/.test(e.message));
  }

  const imported = await syncMt5Csv(asMt5Csv([MT5_SLICE11_ROWS.nzdjpyShort]), stage.id, src);
  assert("import NZDJPY crea 1", imported.created === 1 && imported.unknownSymbols === 0 && imported.duplicates === 0);
  const raw = await findTradeByMt5Position(live.id, "20021");
  assert("MT5 nace UNCLASSIFIED", raw && raw.strategy === Strategy.UNCLASSIFIED && raw.asset === "NZDJPY");
  assert("MT5 nace SHORT CLOSED", raw.direction === "SHORT" && raw.lifecycle === Lifecycle.CLOSED);
  assert("MT5 recordSource", raw.recordSource === TradeRecordSource.MT5_EA);
  const beforeRef = raw.sourceRef;
  const beforeAccount = raw.accountId;
  const beforeBroker = raw.brokerSymbol;
  const beforeCreated = raw.createdAt;

  const classified = await enrichTrade(raw.id, {
    strategy: Strategy.RED,
    style: Style.SCALP,
    closeType: CloseType.SL,
    management: "parcial no; corte en SL",
    note: "NZDJPY QA F2",
  });
  assert("enrich RED", classified.strategy === Strategy.RED);
  assert("enrich SCALP", classified.style === Style.SCALP);
  assert("enrich closeType SL", classified.closeType === CloseType.SL);
  assert("enrich management", classified.management === "parcial no; corte en SL");
  assert("enrich note", classified.note === "NZDJPY QA F2");
  assert("sigue CLOSED", classified.lifecycle === Lifecycle.CLOSED);
  assert("result LOSS por netPnl", classified.result === Result.LOSS);
  assert("provenance recordSource", classified.recordSource === TradeRecordSource.MT5_EA);
  assert("provenance sourceRef", sameRef(classified.sourceRef, beforeRef));
  assert("provenance accountId", classified.accountId === beforeAccount);
  assert("provenance brokerSymbol", classified.brokerSymbol === beforeBroker);
  assert("provenance createdAt", classified.createdAt === beforeCreated);
  assert("dedup position intacta", classified.sourceRef && classified.sourceRef.mt5Position === "20021");

  const persisted = await findTradeByMt5Position(live.id, "20021");
  assert("persist RED+SCALP+SL", persisted.strategy === Strategy.RED && persisted.style === Style.SCALP && persisted.closeType === CloseType.SL);

  try {
    await enrichTrade(persisted.id, { recordSource: TradeRecordSource.MANUAL });
    assert("rechaza recordSource", false);
  } catch (e) {
    assert("rechaza recordSource", /campo no editable/.test(e.message));
  }
  try {
    await enrichTrade(persisted.id, { accountId: "x" });
    assert("rechaza accountId", false);
  } catch (e) {
    assert("rechaza accountId", /campo no editable/.test(e.message));
  }
  try {
    await enrichTrade(persisted.id, { sourceRef: { mt5Position: "hack" } });
    assert("rechaza sourceRef", false);
  } catch (e) {
    assert("rechaza sourceRef", /campo no editable/.test(e.message));
  }
  try {
    await enrichTrade(persisted.id, { brokerSymbol: "EURUSD" });
    assert("rechaza brokerSymbol", false);
  } catch (e) {
    assert("rechaza brokerSymbol", /campo no editable/.test(e.message));
  }
  try {
    await enrichTrade(persisted.id, { id: "other" });
    assert("rechaza id", false);
  } catch (e) {
    assert("rechaza id", /campo no editable/.test(e.message));
  }
  const afterReject = await findTradeByMt5Position(live.id, "20021");
  assert("prohibidos no cambiaron", afterReject.recordSource === TradeRecordSource.MT5_EA
    && afterReject.accountId === beforeAccount
    && afterReject.brokerSymbol === beforeBroker
    && afterReject.sourceRef.mt5Position === "20021"
    && afterReject.strategy === Strategy.RED);

  const reimport = await syncMt5Csv(asMt5Csv([MT5_SLICE11_ROWS.nzdjpyShort]), stage.id, src);
  assert("reimport nuevas 0", reimport.created === 0);
  assert("reimport duplicada 1", reimport.duplicates === 1);
  const afterDup = await findTradeByMt5Position(live.id, "20021");
  assert("reimport no pisa RED", afterDup.strategy === Strategy.RED);
  assert("reimport no pisa SCALP", afterDup.style === Style.SCALP);
  assert("reimport no pisa note", afterDup.note === "NZDJPY QA F2");
  assert("reimport no pisa management", afterDup.management === "parcial no; corte en SL");
  assert("reimport no pisa SL", afterDup.closeType === CloseType.SL);

  const all = [afterDup];
  const asRed = compute(all, { universe: "REAL", strategy: Strategy.RED, stageId: stage.id, accountId: live.id });
  const asUnc = compute(all, { universe: "REAL", strategy: Strategy.UNCLASSIFIED, stageId: stage.id, accountId: live.id });
  assert("stats RED cuenta el trade", asRed.nClosed === 1 && asRed.nLosses === 1);
  assert("stats UNCLASSIFIED ya no lo cuenta", asUnc.nClosed === 0);
  const filteredRed = filterTrades(all, { strategy: Strategy.RED });
  const filteredUnc = filterTrades(all, { strategy: Strategy.UNCLASSIFIED });
  assert("filterTrades RED", filteredRed.length === 1 && filteredRed[0].id === afterDup.id);
  assert("filterTrades UNCLASSIFIED vacío", filteredUnc.length === 0);

  const closed = await createClosedTrade({
    asset: "NZDJPY",
    context: "BACKTEST",
    direction: "SHORT",
    strategy: Strategy.RED,
    style: Style.SCALP,
    openedAt: "2026-09-11T07:40:00.000Z",
    closedAt: "2026-09-11T08:05:00.000Z",
    entry: 87.15,
    exit: 87.42,
    netPnl: -19.2,
    closeType: CloseType.SL,
    commission: -1.2,
    swap: 0,
  }, stage.id);
  assert("createClosed lifecycle", closed.lifecycle === Lifecycle.CLOSED);
  assert("createClosed no OPEN intermedio", closed.openedAt && closed.closedAt && closed.exit === 87.42);
  assert("createClosed RED SCALP SL", closed.strategy === Strategy.RED && closed.style === Style.SCALP && closed.closeType === CloseType.SL);
  assert("createClosed SHORT NZDJPY", closed.asset === "NZDJPY" && closed.direction === "SHORT");
  assert("createClosed result LOSS", closed.result === Result.LOSS);
  assert("createClosed MANUAL", closed.recordSource === TradeRecordSource.MANUAL);
  assert("createClosed netPnl no descuenta commission", closed.netPnl === -19.2 && closed.commission === -1.2 && closed.swap === 0);

  const withCosts = compute([closed], { universe: "BACKTEST", stageId: stage.id });
  assert("stats usan netPnl dado", withCosts.netPnl === -19.2);

  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  lines.push("");
  lines.push(failed.length ? `${failed.length} fallos` : `${results.length} tests OK`);
  const out = document.getElementById("out");
  out.textContent += "\n\nSLICE 21\n" + lines.join("\n");
  if (failed.length) out.className = "fail";
  if (failed.length) throw new Error("slice21 " + failed.length);
}

export { run };
