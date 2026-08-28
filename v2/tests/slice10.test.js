import { ensureJournalSeed } from "../js/domain/stage.js";
import { createDeskSignalFromFixture, ingestRgmPayload, syncRgmJsonl, listStageSignals, findSignalByRgmId } from "../js/domain/signal.js";
import { ingestPrint, applyResolution, parseRgmJsonl, DEFAULT_RGM_SOURCE_ASSET, DEFAULT_RGM_SOURCE_CONTEXT } from "../js/adapters/rgm.js";
import { RGM_SLICE10_LINES, RGM_SLICE10_SOURCE_ASSET, RGM_SLICE10_SOURCE_CONTEXT, asJsonl } from "../js/fixtures/rgm-slice10.js";
import { RGM_SOURCE_ASSET, RGM_SOURCE_CONTEXT } from "../js/config.js";
import { createSetup } from "../js/domain/setup.js";
import { createTrade } from "../js/domain/trade.js";
import { computeDesk } from "../js/domain/stats.js";
import { listSetups } from "../js/storage/repos/setups.js";
import { listTrades } from "../js/storage/repos/trades.js";
import { listSignals } from "../js/storage/repos/signals.js";
import { buildExportPayload } from "../js/services/backup.js";
import { DeskRecordSource, Disposition, Resolution } from "../js/domain/enums.js";
import { V1_DB_NAME } from "../js/config.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
}

async function run() {
  const { stage } = await ensureJournalSeed();
  const asset = RGM_SOURCE_ASSET;
  const context = RGM_SOURCE_CONTEXT;
  const src = { sourceAsset: asset, sourceContext: context };
  assert("sourceAsset de instancia = SP500", asset === "SP500" && asset === RGM_SLICE10_SOURCE_ASSET && asset === DEFAULT_RGM_SOURCE_ASSET);
  assert("sourceContext de instancia = LIVE", context === "LIVE" && context === RGM_SLICE10_SOURCE_CONTEXT && context === DEFAULT_RGM_SOURCE_CONTEXT);

  const mapped = ingestPrint(RGM_SLICE10_LINES.resolvedTp, src);
  assert("payload RGM válido → draft", mapped.ok && mapped.draft.sourceRef.rgmSignalId === "rgm-real-tp");
  assert("direction desde side", mapped.draft.direction === "LONG");
  assert("printedAt desde alert_t", mapped.draft.printedAt === "2026-08-27T15:50:00.000Z");
  assert("signal_close_t no es printedAt", mapped.draft.snapshot.signal_close_t === "2026-08-27T16:40:00.000Z" && mapped.draft.printedAt !== mapped.draft.snapshot.signal_close_t);
  assert("recordSource RGM_ADAPTER en draft", mapped.draft.recordSource === DeskRecordSource.RGM_ADAPTER);
  assert("asset viene de sourceAsset", mapped.draft.asset === "SP500");
  assert("context viene de sourceContext", mapped.draft.context === "LIVE");
  assert("no infiere asset del payload", !("asset" in RGM_SLICE10_LINES.resolvedTp) && mapped.draft.asset === asset);
  assert("no infiere context del payload", !("context" in RGM_SLICE10_LINES.resolvedTp) && mapped.draft.context === context);
  assert("side LONG verificado", ingestPrint(RGM_SLICE10_LINES.resolvedTp, src).draft.direction === "LONG");
  assert("side SHORT verificado", ingestPrint(RGM_SLICE10_LINES.resolvedSl, src).draft.direction === "SHORT");

  try {
    ingestPrint(RGM_SLICE10_LINES.resolvedTp, {});
    assert("sourceAsset obligatorio", false);
  } catch (e) {
    assert("sourceAsset obligatorio", /sourceAsset/.test(e.message));
  }
  try {
    ingestPrint(RGM_SLICE10_LINES.resolvedTp, { sourceAsset: asset });
    assert("sourceContext obligatorio", false);
  } catch (e) {
    assert("sourceContext obligatorio", /sourceContext/.test(e.message));
  }

  const nBefore = (await listSignals()).length;
  ingestPrint(RGM_SLICE10_LINES.resolvedTp, src);
  assert("ingestPrint no escribe IDB", (await listSignals()).length === nBefore);

  const nSetupsBefore = (await listSetups()).length;
  const nTradesBefore = (await listTrades()).length;
  const createdTp = await ingestRgmPayload(RGM_SLICE10_LINES.resolvedTp, stage.id, src);
  assert("TP → resolution TP", createdTp.status === "created" && createdTp.signal.resolution === Resolution.TP);
  assert("TP no inventa TAKEN", createdTp.signal.disposition === Disposition.NONE);
  assert("persiste RGM_ADAPTER", createdTp.signal.recordSource === DeskRecordSource.RGM_ADAPTER);
  assert("persiste context LIVE de fuente", createdTp.signal.context === "LIVE");
  assert("snapshot conserva resolved raw", createdTp.signal.snapshot.rgmResolvedRaw === "TP" && createdTp.signal.snapshot.raw.id === "rgm-real-tp");

  const createdSl = await ingestRgmPayload(RGM_SLICE10_LINES.resolvedSl, stage.id, src);
  assert("SL → resolution SL", createdSl.signal.resolution === Resolution.SL && createdSl.signal.disposition === Disposition.NONE);

  const createdSkip = await ingestRgmPayload(RGM_SLICE10_LINES.skippedOpen, stage.id, src);
  assert("SKIPPED → disposition", createdSkip.signal.disposition === Disposition.SKIPPED_OPEN_POSITION);
  assert("SKIPPED no inventa resolution", createdSkip.signal.resolution === Resolution.OPEN);
  assert("SKIPPED raw en snapshot", createdSkip.signal.snapshot.rgmResolvedRaw === "SKIPPED_OPEN_POSITION");

  const createdOpen = await ingestRgmPayload(RGM_SLICE10_LINES.openedLong, stage.id, src);
  const createdShort = await ingestRgmPayload(RGM_SLICE10_LINES.openedShort, stage.id, src);
  assert("OPENED no → TAKEN", createdOpen.signal.disposition === Disposition.NONE && createdOpen.signal.resolution === Resolution.OPEN);
  assert("kind OPENED en snapshot", createdOpen.signal.snapshot.kind === "OPENED");
  assert("LONG y SHORT independientes", createdOpen.signal.direction === "LONG" && createdShort.signal.direction === "SHORT");

  assert("alta RGM no crea Setup", (await listSetups()).length === nSetupsBefore);
  assert("alta RGM no crea Trade", (await listTrades()).length === nTradesBefore);

  const again = await ingestRgmPayload(RGM_SLICE10_LINES.resolvedTp, stage.id, src);
  assert("señal repetida no duplica", again.status === "duplicate" && again.signal.id === createdTp.signal.id);
  const sameId = await findSignalByRgmId("rgm-real-tp");
  assert("dedup por payload.id", sameId && sameId.id === createdTp.signal.id);

  const updated = await ingestRgmPayload(RGM_SLICE10_LINES.laterTpSameId, stage.id, src);
  assert("update posterior TP", updated.status === "updated" && updated.signal.resolution === Resolution.TP);
  assert("first-print inmutable en update", updated.signal.printedAt === createdOpen.signal.printedAt && updated.signal.snapshot.entry === createdOpen.signal.snapshot.entry && updated.signal.snapshot.raw.resolved == null);

  const conflict = await ingestRgmPayload(RGM_SLICE10_LINES.conflictPrint, stage.id, src);
  assert("conflicto no sobrescribe print", conflict.status === "conflict" && (await findSignalByRgmId("rgm-real-tp")).direction === "LONG");

  const unknown = await ingestRgmPayload(RGM_SLICE10_LINES.unknownResolved, stage.id, src);
  assert("resolved desconocido se conserva raw", unknown.signal.snapshot.rgmResolvedRaw === "PARTIAL" && unknown.signal.resolution === Resolution.OPEN);

  const badId = await ingestRgmPayload(RGM_SLICE10_LINES.invalidNoId, stage.id, src);
  const badSide = await ingestRgmPayload(RGM_SLICE10_LINES.invalidNoSide, stage.id, src);
  const badAlert = await ingestRgmPayload(RGM_SLICE10_LINES.invalidNoAlert, stage.id, src);
  assert("payload inválido no corrompe", badId.status === "invalid" && badSide.status === "invalid" && badAlert.status === "invalid");

  try {
    await syncRgmJsonl(asJsonl([RGM_SLICE10_LINES.openedLong]), stage.id, src);
    assert("syncFrom requerido", false);
  } catch (e) {
    assert("syncFrom requerido", /syncFrom/.test(e.message));
  }

  const parsedBroken = parseRgmJsonl(asJsonl([RGM_SLICE10_LINES.historic]) + "not-json\n");
  assert("JSONL inválido se reporta", parsedBroken.invalid.length === 1);

  const sync1 = await syncRgmJsonl(
    asJsonl([RGM_SLICE10_LINES.historic, RGM_SLICE10_LINES.openedLong, RGM_SLICE10_LINES.openedShort, RGM_SLICE10_LINES.resolvedSl]),
    stage.id,
    { ...src, syncFrom: "2026-08-27T00:00:00.000Z" },
  );
  assert("histórico anterior excluido", sync1.excluded >= 1);
  assert("sync no importa pre-syncFrom", !(await findSignalByRgmId("rgm-real-historic")));
  const sync2 = await syncRgmJsonl(
    asJsonl([RGM_SLICE10_LINES.openedLong, RGM_SLICE10_LINES.openedShort, RGM_SLICE10_LINES.resolvedSl]),
    stage.id,
    { ...src, syncFrom: "2026-08-27T00:00:00.000Z" },
  );
  assert("sync idempotente", sync2.created === 0 && sync2.duplicates >= 2);

  const applySkip = applyResolution(RGM_SLICE10_LINES.skippedOpen);
  assert("applyResolution SKIPPED no es TP", applySkip.disposition === Disposition.SKIPPED_OPEN_POSITION && applySkip.resolution == null);

  const payload = await buildExportPayload();
  assert("export incluye señales RGM", payload.signals.some((s) => s.sourceRef && s.sourceRef.rgmSignalId === "rgm-real-tp" && s.recordSource === "RGM_ADAPTER"));

  const desk = computeDesk(await listStageSignals(stage.id), { stageId: stage.id });
  assert("stats Desk con import RGM", desk.printed >= 4);

  await createSetup({ asset: "EURUSD", context: "LIVE", direction: "LONG" }, stage.id);
  await createTrade({ asset: "EURUSD", context: "BACKTEST", direction: "LONG", entry: 1.1 }, stage.id);
  const afterManual = await ingestRgmPayload(RGM_SLICE10_LINES.resolvedTp, stage.id, src);
  assert("reimport no crea Setup/Trade extra", afterManual.status === "duplicate");

  if (indexedDB.databases) {
    const dbs = await indexedDB.databases();
    assert("V1 aislado", !dbs.some((d) => d && d.name === V1_DB_NAME));
  } else assert("V1 aislado", true);

  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  lines.push("");
  lines.push(failed.length ? `${failed.length} fallos` : `${results.length} tests OK`);
  const out = document.getElementById("out");
  out.textContent += "\n\nSLICE 10\n" + lines.join("\n");
  if (failed.length) out.className = "fail";
  if (failed.length) throw new Error("slice10 " + failed.length);
}

export { run };
