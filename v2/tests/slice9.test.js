import { ensureJournalSeed } from "../js/domain/stage.js";
import * as signalApi from "../js/domain/signal.js";
import { createDeskSignalFromFixture, updateSignalFollowup, listStageSignals, filterSignals, loadSlice9Fixtures } from "../js/domain/signal.js";
import { SLICE9_DESK_FIXTURES, SLICE9_FIXTURE_NOTE } from "../js/fixtures/desk-slice9.js";
import { createSetup } from "../js/domain/setup.js";
import { createTrade, closeTrade } from "../js/domain/trade.js";
import { compute, computeDesk } from "../js/domain/stats.js";
import { Disposition, Resolution, DeskRecordSource } from "../js/domain/enums.js";
import { listTrades } from "../js/storage/repos/trades.js";
import { listSetups } from "../js/storage/repos/setups.js";
import { listSignals } from "../js/storage/repos/signals.js";
import { ingestPrint } from "../js/adapters/rgm.js";
import { buildExportPayload } from "../js/services/backup.js";
import { V1_DB_NAME } from "../js/config.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
}

async function run() {
  const { stage } = await ensureJournalSeed();
  const created = {};
  for (const fx of SLICE9_DESK_FIXTURES) {
    created[fx.key] = await createDeskSignalFromFixture(fx, stage.id);
  }
  const fixtureRows = Object.values(created);
  const deskFresh = computeDesk(fixtureRows, { stageId: stage.id });

  assert("crear Signal mediante fixture", created["taken-tp"].id && created["taken-tp"].asset === "EURUSD");
  assert("fixture marcada", created["taken-tp"].sourceRef.manualNote === SLICE9_FIXTURE_NOTE);
  assert("recordSource MANUAL", created["taken-tp"].recordSource === DeskRecordSource.MANUAL);

  const viaAdapter = await createDeskSignalFromFixture({
    asset: "EURUSD",
    direction: "LONG",
    context: "LIVE",
    printedAt: "2026-08-27T10:00:00.000Z",
    disposition: "NONE",
    resolution: "OPEN",
    recordSource: DeskRecordSource.RGM_ADAPTER,
    sourceRef: { rgmSignalId: "rgm-adapter-ok", rgmPrintAt: "2026-08-27T10:00:00.000Z", manualNote: SLICE9_FIXTURE_NOTE },
  }, stage.id);
  assert("DeskSignal acepta RGM_ADAPTER", viaAdapter.recordSource === DeskRecordSource.RGM_ADAPTER);
  try {
    await createDeskSignalFromFixture({
      asset: "EURUSD",
      direction: "SHORT",
      context: "LIVE",
      printedAt: "2026-08-27T10:01:00.000Z",
      disposition: "NONE",
      resolution: "OPEN",
      recordSource: "MT5_EA",
      sourceRef: { manualNote: SLICE9_FIXTURE_NOTE },
    }, stage.id);
    assert("DeskSignal rechaza MT5_EA", false);
  } catch (e) {
    assert("DeskSignal rechaza MT5_EA", /recordSource/.test(e.message));
  }

  try {
    ingestPrint();
    assert("no alta via adapter RGM", false);
  } catch (e) {
    assert("no alta via adapter RGM", /Slice 10/.test(e.message));
  }
  assert("no alta manual de producto", typeof signalApi.createDeskSignal !== "function");
  assert("alta solo via fixture/domain path", typeof createDeskSignalFromFixture === "function");

  const originalAsset = created["taken-tp"].asset;
  const originalPrint = created["taken-tp"].printedAt;
  const originalSnap = JSON.stringify(created["taken-tp"].snapshot);
  try {
    await updateSignalFollowup(created["taken-tp"].id, { asset: "XAUUSD" });
    assert("print original inmutable", false);
  } catch (e) {
    assert("print original inmutable", /inmutable/.test(e.message));
  }
  const afterReject = (await listSignals()).find((s) => s.id === created["taken-tp"].id);
  assert("asset print intacto", afterReject.asset === originalAsset && afterReject.printedAt === originalPrint);
  assert("snapshot intacto", JSON.stringify(afterReject.snapshot) === originalSnap);

  assert("TAKEN + SL válido", created["taken-sl"].disposition === Disposition.TAKEN && created["taken-sl"].resolution === Resolution.SL);
  assert("IGNORED + TP válido", created["ignored-tp"].disposition === Disposition.IGNORED && created["ignored-tp"].resolution === Resolution.TP);
  assert("SKIPPED + TP válido", created["skipped-tp"].disposition === Disposition.SKIPPED_OPEN_POSITION && created["skipped-tp"].resolution === Resolution.TP);

  const opens = (await listStageSignals(stage.id)).filter((s) => s.asset === "EURUSD" && s.resolution === Resolution.OPEN);
  assert("dos señales opuestas OPEN permitidas",
    opens.some((s) => s.direction === "LONG")
    && opens.some((s) => s.direction === "SHORT")
    && opens.length >= 2);

  const flipped = await updateSignalFollowup(created["none-open-short"].id, { disposition: Disposition.IGNORED });
  assert("cambiar disposition", flipped.disposition === Disposition.IGNORED && flipped.resolution === Resolution.OPEN);
  const resolved = await updateSignalFollowup(created["none-open-short"].id, { resolution: Resolution.MISSED });
  assert("cambiar resolution", resolved.resolution === Resolution.MISSED);
  assert("resolvedAt al salir de OPEN", Boolean(resolved.resolvedAt));
  assert("disposition independiente de resolution", resolved.disposition === Disposition.IGNORED && resolved.resolution === Resolution.MISSED);

  const nTradesBefore = (await listTrades()).length;
  const nSetupsBefore = (await listSetups()).length;
  await updateSignalFollowup(created["none-open-long"].id, { disposition: Disposition.TAKEN });
  assert("TAKEN no crea Trade", (await listTrades()).length === nTradesBefore);
  assert("TAKEN no crea Setup", (await listSetups()).length === nSetupsBefore);

  const setup = await createSetup({ asset: "EURUSD", context: "LIVE", direction: "LONG" }, stage.id);
  const linkedSetup = await updateSignalFollowup(created["none-open-long"].id, { setupId: setup.id });
  const setupAfter = (await listSetups()).find((s) => s.id === setup.id);
  assert("relación opcional Setup", linkedSetup.setupId === setup.id && linkedSetup.tradeId == null);
  assert("Setup.deskSignalId recíproco", setupAfter.deskSignalId === linkedSetup.id);

  const trade = await createTrade({
    asset: "EURUSD", context: "BACKTEST", direction: "LONG", entry: 1.1,
  }, stage.id);
  const linkedTrade = await updateSignalFollowup(created["none-open-long"].id, { tradeId: trade.id });
  const tradeAfter = (await listTrades()).find((t) => t.id === trade.id);
  assert("relación opcional Trade", linkedTrade.tradeId === trade.id);
  assert("Trade.deskSignalId recíproco", tradeAfter.deskSignalId === linkedTrade.id);

  try {
    await updateSignalFollowup(created["none-open-long"].id, { setupId: "no-existe" });
    assert("FK setup inválida rechazada", false);
  } catch (e) {
    assert("FK setup inválida rechazada", /setup/.test(e.message));
  }
  try {
    await updateSignalFollowup(created["none-open-long"].id, { tradeId: "no-existe" });
    assert("FK trade inválida rechazada", false);
  } catch (e) {
    assert("FK trade inválida rechazada", /trade/.test(e.message));
  }

  const all = await listSignals();
  assert("take rate correcto", deskFresh.takeRate === 2 / 4 && deskFresh.nTaken === 2 && deskFresh.nIgnored === 2);
  assert("skip rate/conteo correcto", deskFresh.nSkipped === 1 && deskFresh.skipRate === 1 / deskFresh.printed);
  assert("OPEN fuera de resolved", deskFresh.nOpen === 2 && deskFresh.nResolved === 6 && deskFresh.nResolved === deskFresh.printed - deskFresh.nOpen);
  assert("Hit Rate según fórmula Frozen", deskFresh.hitRate === 3 / 5);
  assert("Resolution Rate según fórmula Frozen", deskFresh.resolutionRate === 6 / 8);

  const closed = await closeTrade(trade.id, { exit: 1.12, netPnl: 25, closeType: "TP" });
  const tradeStats = compute(await listTrades(), { universe: "BACKTEST", stageId: stage.id });
  const deskAfter = computeDesk(fixtureRows, { stageId: stage.id });
  assert("Desk stats aisladas de Trade stats", deskAfter.printed === deskFresh.printed && tradeStats.nClosed >= 1);
  const still = (await listSignals()).find((s) => s.id === created["taken-tp"].id);
  assert("Signal TP no cambia Trade result", still.resolution === Resolution.TP && closed.result === "WIN");
  assert("Trade WIN no cambia Signal resolution", still.resolution === Resolution.TP);

  const eurusd = filterSignals(all, { stageId: stage.id, asset: "EURUSD" });
  const longs = filterSignals(all, { stageId: stage.id, direction: "LONG" });
  const taken = filterSignals(all, { stageId: stage.id, disposition: Disposition.TAKEN });
  const tps = filterSignals(all, { stageId: stage.id, resolution: Resolution.TP });
  const period = filterSignals(all, { stageId: stage.id, from: "2026-08-25", to: "2026-08-25" });
  assert("filtro asset", eurusd.every((s) => s.asset === "EURUSD") && eurusd.length >= 2);
  assert("filtro direction", longs.every((s) => s.direction === "LONG"));
  assert("filtro disposition", taken.every((s) => s.disposition === Disposition.TAKEN));
  assert("filtro resolution", tps.every((s) => s.resolution === Resolution.TP));
  assert("filtro período printedAt", period.every((s) => String(s.printedAt).slice(0, 10) === "2026-08-25"));

  const other = await createDeskSignalFromFixture({
    asset: "EURUSD", direction: "LONG", context: "LIVE",
    printedAt: "2026-08-26T10:00:00.000Z",
    disposition: "NONE", resolution: "OPEN",
    sourceRef: { manualNote: SLICE9_FIXTURE_NOTE, rgmSignalId: "other-stage" },
  }, "stage-other");
  const activeOnly = computeDesk(await listSignals(), { stageId: stage.id });
  const otherOnly = computeDesk(await listSignals(), { stageId: "stage-other" });
  assert("Stage aislada", other.stageId === "stage-other" && otherOnly.printed === 1 && activeOnly.printed >= deskFresh.printed);

  const again = await loadSlice9Fixtures(stage.id);
  assert("fixtures no se duplican al recargar", again.length === fixtureRows.length || again.some((s) => s.id === created["taken-tp"].id));

  const payload = await buildExportPayload();
  assert("export incluye signals", Array.isArray(payload.signals) && payload.signals.some((s) => s.id === created["taken-tp"].id));
  assert("export disposition/resolution", payload.signals.some((s) => s.disposition === "TAKEN" && s.resolution === "TP"));
  assert("export snapshot original", payload.signals.some((s) => s.id === created["taken-tp"].id && s.snapshot && s.snapshot.score === 70));
  assert("export sourceRef", payload.signals.some((s) => s.sourceRef && s.sourceRef.rgmSignalId === "rgm-taken-tp"));
  assert("export relaciones", payload.signals.some((s) => s.id === created["none-open-long"].id && s.setupId === setup.id && s.tradeId === trade.id));

  const deskUniverse = compute(await listTrades(), { universe: "DESK", stageId: stage.id });
  assert("universo DESK no mezcla trades", deskUniverse.nClosed === 0 && deskUniverse.netPnl == null);

  if (indexedDB.databases) {
    const dbs = await indexedDB.databases();
    assert("V1 aislado", !dbs.some((d) => d && d.name === V1_DB_NAME));
  } else assert("V1 aislado", true);

  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  lines.push("");
  lines.push(failed.length ? `${failed.length} fallos` : `${results.length} tests OK`);
  const out = document.getElementById("out");
  out.textContent += "\n\nSLICE 9\n" + lines.join("\n");
  if (failed.length) out.className = "fail";
  if (failed.length) throw new Error("slice9 " + failed.length);
}

export { run };
