import { ensureJournalSeed } from "../js/domain/stage.js";
import { createObservation } from "../js/domain/observation.js";
import {
  createSetup,
  evaluateSetup,
  closeSetupStatus,
  listActiveSetups,
  listSetupsForObservation,
} from "../js/domain/setup.js";
import { computePlannedRr } from "../js/domain/integrity.js";
import { Strategy, SetupStatus } from "../js/domain/enums.js";
import { buildExportPayload } from "../js/services/backup.js";
import { CHECKLIST_FIXTURE_ITEMS } from "../js/fixtures/checklist-slice2.js";
import { V1_DB_NAME, DB_NAME } from "../js/config.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
}

async function run() {
  const { stage } = await ensureJournalSeed();

  try {
    await createSetup({ asset: "EURUSD", context: "BACKTEST" }, stage.id);
    assert("direction required", false);
  } catch (e) {
    assert("direction required", e.message === "direction requerido");
  }

  const direct = await createSetup({
    asset: "EURUSD",
    context: "BACKTEST",
    direction: "LONG",
  }, stage.id);
  assert("alta mínima", direct.asset === "EURUSD" && direct.direction === "LONG");
  assert("UNCLASSIFIED default", direct.strategy === Strategy.UNCLASSIFIED);
  assert("WATCHING default", direct.status === SetupStatus.WATCHING);
  assert("cero default Blue", direct.strategy !== "BLUE");
  assert("sin observationId si directo", direct.observationId == null);

  const obs = await createObservation({ asset: "EURUSD", note: "zona 1.170" }, stage.id);
  const fromObs = await createSetup({
    asset: obs.asset,
    context: obs.context,
    direction: "SHORT",
    observationId: obs.id,
  }, stage.id);
  const second = await createSetup({
    asset: obs.asset,
    context: "BACKTEST",
    direction: "LONG",
    observationId: obs.id,
  }, stage.id);
  assert("crear desde Observation", fromObs.observationId === obs.id && fromObs.asset === "EURUSD");
  assert("1 obs → N setups", (await listSetupsForObservation(obs.id)).length === 2);
  const still = await (await import("../js/storage/repos/observations.js")).getObservation(obs.id);
  assert("obs no se archiva al crear setup", still.archived === false);

  const rr = computePlannedRr("LONG", 1.10, 1.09, 1.13);
  assert("plannedRR derivado", Math.abs(rr - 3) < 1e-9, String(rr));

  const evaluated = await evaluateSetup(fromObs.id, {
    strategy: "RED",
    structure: "BOS + FVG",
    plannedEntry: 1.10,
    plannedSl: 1.12,
    plannedTp: 1.06,
    validationMethod: "SELF",
    verdict: "VALID",
    checklist: CHECKLIST_FIXTURE_ITEMS.map((i, idx) => ({ ...i, done: idx < 2, source: "fixture-slice2" })),
  });
  assert("evaluación posterior", evaluated.strategy === "RED" && evaluated.verdict === "VALID");
  assert("plannedRR no tipeado", evaluated.plannedRr != null && evaluated.plannedEntry === 1.10);
  assert("checklist snapshot", evaluated.checklist.length === CHECKLIST_FIXTURE_ITEMS.length);
  assert("checklist score", evaluated.checklistScore.done === 2 && evaluated.checklistScore.total === 4);
  assert("provenance SELF", evaluated.validationMethod === "SELF");

  const listed = await listActiveSetups(stage.id, "EURUSD");
  assert("listado Estudio setups", listed.some((s) => s.id === fromObs.id));

  const locked = await closeSetupStatus(fromObs.id, "DISCARDED");
  assert("freeze al descartar", Boolean(locked.validationLockedAt) && locked.status === "DISCARDED");
  try {
    await evaluateSetup(fromObs.id, { verdict: "INVALID" });
    assert("no reescribe snapshot congelado", false);
  } catch (e) {
    assert("no reescribe snapshot congelado", /congelado/.test(e.message));
  }

  const open = await evaluateSetup(direct.id, { comment: "aún watching" });
  assert("edición antes de freeze", open.comment === "aún watching" && !open.validationLockedAt);

  const expired = await closeSetupStatus(second.id, "EXPIRED");
  assert("freeze al expirar", Boolean(expired.validationLockedAt));

  const payload = await buildExportPayload();
  assert("export incluye setups", payload.setups.some((s) => s.id === direct.id && s.observationId == null));
  assert("FK observationId en export", payload.setups.some((s) => s.observationId === obs.id));

  if (indexedDB.databases) {
    const dbs = await indexedDB.databases();
    assert("V1 aislado", !(dbs || []).some((d) => d.name === V1_DB_NAME) && dbs.some((d) => d.name === DB_NAME));
  } else {
    assert("V1 aislado", true);
  }

  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  lines.push("");
  lines.push(failed.length ? `${failed.length} fallos` : `${results.length} tests OK`);
  const out = document.getElementById("out");
  out.textContent += "\n\nSLICE 2\n" + lines.join("\n");
  if (failed.length) out.className = "fail";
  if (failed.length) throw new Error("slice2 " + failed.length);
}

export { run };
