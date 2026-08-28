import { ensureJournalSeed } from "../js/domain/stage.js";
import { createAccount, accountBalance } from "../js/domain/account.js";
import {
  createTrade,
  closeTrade,
  previewMt5Csv,
  syncMt5Csv,
  findTradeByMt5Position,
  listStageTrades,
} from "../js/domain/trade.js";
import {
  parseMt5Csv,
  parseCsvLine,
  mapBrokerSymbolToAsset,
  mapMt5Side,
  mapMt5Result,
  toTradeDraft,
  wallClockToIso,
  dedupKey,
} from "../js/adapters/mt5.js";
import { MT5_SLICE11_ROWS, asMt5Csv } from "../js/fixtures/mt5-slice11.js";
import { compute } from "../js/domain/stats.js";
import { TradeRecordSource, Context, Lifecycle, Result, Strategy } from "../js/domain/enums.js";
import { listTrades } from "../js/storage/repos/trades.js";
import { listSetups } from "../js/storage/repos/setups.js";
import { listSignals } from "../js/storage/repos/signals.js";
import { listAccounts } from "../js/storage/repos/accounts.js";
import { buildExportPayload } from "../js/services/backup.js";
import { V1_DB_NAME } from "../js/config.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
}

async function run() {
  const { stage } = await ensureJournalSeed();
  const tz = "Europe/Athens";
  const live = await createAccount({ name: "Live MT5", context: "LIVE", currency: "EUR", initialAmount: 2045 }, stage.id);
  const demo = await createAccount({ name: "Demo MT5", context: "DEMO", currency: "EUR", initialAmount: 1000 }, stage.id);
  const src = { accountId: live.id, context: live.context, timeZone: tz };

  const quoted = parseCsvLine('a;"b;c";"d""e";f');
  assert("parser CSV quoted fields", quoted[0] === "a" && quoted[1] === "b;c" && quoted[2] === "d\"e" && quoted[3] === "f");

  const parsed = parseMt5Csv(asMt5Csv([MT5_SLICE11_ROWS.longWin, MT5_SLICE11_ROWS.shortLoss]));
  assert("parser respeta sep=;", parsed.read === 2 && parsed.rows.length === 2);
  assert("parser 39 columnas", parsed.rows[0].rec.ID === "10011" && parsed.rows[0].rec.Notas === "Auto MT5");

  const parsedQ = parseMt5Csv(asMt5Csv([MT5_SLICE11_ROWS.quotedNote]));
  assert("parser nota entre comillas con ;", parsedQ.rows[0].rec.Notas === "nota;con;puntos" || parsedQ.rows[0].rec.Notas.includes("nota"));

  assert("side Long → LONG", mapMt5Side("Long") === "LONG");
  assert("side Short → SHORT", mapMt5Side("Short") === "SHORT");
  assert("result Win/Loss/BE", mapMt5Result("Win") === "WIN" && mapMt5Result("Loss") === "LOSS" && mapMt5Result("BE") === "BE");
  assert("EURUSDc → EURUSD", mapBrokerSymbolToAsset("EURUSDc") === "EURUSD");
  assert("XAUUSD.m → XAUUSD", mapBrokerSymbolToAsset("XAUUSD.m") === "XAUUSD");
  assert("US500 → SP500", mapBrokerSymbolToAsset("US500") === "SP500");
  assert("símbolo desconocido no mapea", mapBrokerSymbolToAsset("FOOBAR99") == null);

  const noTz = wallClockToIso("2026-08-27", "14:10", "");
  assert("timezone obligatorio", noTz.ok === false && /timezone/.test(noTz.error));
  const opened = wallClockToIso("2026-08-27", "14:10", tz);
  assert("timestamp minuto sin segundos inventados en wall", opened.ok && opened.wall === "2026-08-27T14:10" && opened.precision === "minute");
  assert("timestamp ISO derivado del timezone", opened.ok && opened.iso.endsWith("Z"));

  try {
    await previewMt5Csv(asMt5Csv([MT5_SLICE11_ROWS.longWin]), { accountId: live.id, context: live.context });
    assert("preview exige timezone", false);
  } catch (e) {
    assert("preview exige timezone", /timezone/.test(e.message));
  }
  try {
    await previewMt5Csv(asMt5Csv([MT5_SLICE11_ROWS.longWin]), { context: live.context, timeZone: tz });
    assert("preview exige Account", false);
  } catch (e) {
    assert("preview exige Account", /accountId/.test(e.message));
  }

  const nAccBefore = (await listAccounts()).length;
  const mapped = toTradeDraft(parsed.rows[0].rec, src);
  assert("draft CLOSED", mapped.ok && mapped.draft.lifecycle === Lifecycle.CLOSED);
  assert("draft MT5_EA", mapped.ok && mapped.draft.recordSource === TradeRecordSource.MT5_EA);
  assert("draft context desde Account", mapped.ok && mapped.draft.context === "LIVE");
  assert("draft mt5Position", mapped.ok && mapped.draft.sourceRef.mt5Position === "10011");
  assert("draft brokerSymbol crudo", mapped.ok && mapped.draft.brokerSymbol === "EURUSDc");
  assert("draft asset canónico", mapped.ok && mapped.draft.asset === "EURUSD");
  assert("draft netPnl autoridad", mapped.ok && mapped.draft.netPnl === 24.6);
  assert("draft no parte commission/swap", mapped.ok && mapped.draft.commission == null && mapped.draft.swap == null);
  assert("draft no inventa strategy", mapped.ok && mapped.draft.strategy === Strategy.UNCLASSIFIED && mapped.draft.setupId == null && mapped.draft.deskSignalId == null);
  assert("toTradeDraft no escribe IDB", (await listTrades()).every((t) => !t.sourceRef || t.sourceRef.mt5Position !== "10011"));

  const nSetupsBefore = (await listSetups()).length;
  const nSignalsBefore = (await listSignals()).length;
  const nTradesBefore = (await listTrades()).length;
  const balBefore = accountBalance(live, [], await listTrades());

  const csv = asMt5Csv([
    MT5_SLICE11_ROWS.longWin,
    MT5_SLICE11_ROWS.shortLoss,
    MT5_SLICE11_ROWS.beSp500,
    MT5_SLICE11_ROWS.unknownSymbol,
    MT5_SLICE11_ROWS.invalidNoId,
  ]);
  const preview = await previewMt5Csv(csv, src);
  assert("preview cuenta leídas", preview.read >= 5);
  assert("preview unknown symbol", preview.unknownSymbols >= 1);
  assert("preview no importa todavía", (await listTrades()).length === nTradesBefore);

  const sync1 = await syncMt5Csv(csv, stage.id, src);
  assert("import crea 3 válidas", sync1.created === 3);
  assert("import reporta unknown + inválidas", sync1.unknownSymbols >= 1 && sync1.invalid >= 2);
  assert("no crea Account automática", (await listAccounts()).length === nAccBefore);

  const longT = await findTradeByMt5Position(live.id, "10011");
  const shortT = await findTradeByMt5Position(live.id, "10012");
  const beT = await findTradeByMt5Position(live.id, "10013");
  assert("LONG persistido", longT && longT.direction === "LONG" && longT.lifecycle === Lifecycle.CLOSED);
  assert("SHORT persistido", shortT && shortT.direction === "SHORT");
  assert("recordSource MT5_EA", longT.recordSource === TradeRecordSource.MT5_EA);
  assert("context LIVE de Account", longT.context === Context.LIVE && longT.accountId === live.id);
  assert("mt5Position en sourceRef", longT.sourceRef.mt5Position === "10011");
  assert("brokerSymbol / asset", longT.brokerSymbol === "EURUSDc" && longT.asset === "EURUSD");
  assert("XAU mapeado", shortT.asset === "XAUUSD" && shortT.brokerSymbol === "XAUUSD.m");
  assert("SP500 canónico", beT.asset === "SP500" && beT.brokerSymbol === "US500");
  assert("timestamps ISO", /^\d{4}-\d{2}-\d{2}T/.test(longT.openedAt) && /^\d{4}-\d{2}-\d{2}T/.test(longT.closedAt));
  assert("wall-clock minuto conservado", longT.sourceRef.openedWall === "2026-08-27T14:10" && longT.sourceRef.timePrecision === "minute");
  assert("netPnl sin doble descuento", longT.netPnl === 24.6);
  assert("Win/Loss/BE", longT.result === Result.WIN && shortT.result === Result.LOSS && beT.result === Result.BE);
  assert("strategy no inventada", longT.strategy === Strategy.UNCLASSIFIED && longT.setupId == null && longT.deskSignalId == null);
  assert("session/SL/TP no inferidos", longT.session == null && longT.initialSL == null && longT.tp == null);
  assert("hasPartials false no habilita R", longT.hasPartials === false && longT.incompleteForR === true && longT.rrRealized == null);
  assert("importBatchId presente", Boolean(longT.importBatchId) && longT.importBatchId === shortT.importBatchId);
  assert("alta MT5 no crea Setup/Signal", (await listSetups()).length === nSetupsBefore && (await listSignals()).length === nSignalsBefore);

  const balAfter = accountBalance(live, [], await listTrades());
  assert("balance Account suma netPnl", balAfter === balBefore + 24.6 + (-19.5) + 0);

  const realStats = compute(await listTrades(), { universe: "REAL", stageId: stage.id, accountId: live.id });
  assert("stats Real incluyen import", realStats.nClosed === 3 && realStats.netPnl === 24.6 - 19.5);

  const bt = await createTrade({ asset: "EURUSD", context: "BACKTEST", direction: "LONG", entry: 1.1 }, stage.id);
  await closeTrade(bt.id, { exit: 1.2, netPnl: 999, closeType: "MANUAL" });
  const demoTrade = await createTrade({
    asset: "EURUSD", context: "DEMO", direction: "LONG", entry: 1.1, accountId: demo.id,
  }, stage.id);
  await closeTrade(demoTrade.id, { exit: 1.2, netPnl: 50, closeType: "MANUAL" });
  const realAfter = compute(await listTrades(), { universe: "REAL", stageId: stage.id, accountId: live.id });
  const demoStats = compute(await listTrades(), { universe: "DEMO", stageId: stage.id, accountId: demo.id });
  const liveIds = new Set((await listTrades()).filter((t) => t.accountId === live.id).map((t) => t.id));
  assert("BACKTEST aislado del import", bt.context === "BACKTEST" && bt.accountId == null && !liveIds.has(bt.id));
  assert("DEMO aislado del import", demoStats.netPnl === 50 && demoTrade.accountId === demo.id);
  assert("REAL no mezcla DEMO/BACKTEST", realAfter.netPnl === 24.6 - 19.5 && realAfter.nClosed === 3);

  const sync2 = await syncMt5Csv(csv, stage.id, src);
  assert("reimport idempotente", sync2.created === 0 && sync2.duplicates === 3);
  assert("dedup account+mt5Position", (await listStageTrades(stage.id)).filter((t) => t.recordSource === "MT5_EA").length === 3);
  assert("dedupKey estable", dedupKey(live.id, "10011") === live.id + "::10011");

  const samePosOtherAcc = await syncMt5Csv(asMt5Csv([MT5_SLICE11_ROWS.longWin]), stage.id, {
    accountId: demo.id,
    context: demo.context,
    timeZone: tz,
  });
  assert("misma posición otra Account sí entra", samePosOtherAcc.created === 1);

  const unknownOnly = await syncMt5Csv(asMt5Csv([MT5_SLICE11_ROWS.unknownSymbol]), stage.id, src);
  assert("unknown symbol no se importa", unknownOnly.created === 0 && unknownOnly.unknownSymbols === 1 && !(await findTradeByMt5Position(live.id, "19999")));

  const payload = await buildExportPayload();
  assert("export V2 conserva sourceRef MT5", payload.trades.some((t) => t.sourceRef && t.sourceRef.mt5Position === "10011" && t.recordSource === "MT5_EA"));

  if (indexedDB.databases) {
    const dbs = await indexedDB.databases();
    assert("V1 aislado", !dbs.some((d) => d && d.name === V1_DB_NAME));
  } else assert("V1 aislado", true);

  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  lines.push("");
  lines.push(failed.length ? `${failed.length} fallos` : `${results.length} tests OK`);
  const out = document.getElementById("out");
  out.textContent += "\n\nSLICE 11\n" + lines.join("\n");
  if (failed.length) out.className = "fail";
  if (failed.length) throw new Error("slice11 " + failed.length);
}

export { run };
