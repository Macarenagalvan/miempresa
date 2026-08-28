import { ensureJournalSeed } from "../js/domain/stage.js";
import {
  createObservation,
  updateObservation,
  archiveObservation,
  listActiveObservations,
  defaultObservationDate,
} from "../js/domain/observation.js";
import { assertObservation, normalizeAsset } from "../js/domain/integrity.js";
import { getObservation, listObservations } from "../js/storage/repos/observations.js";
import { buildExportPayload } from "../js/services/backup.js";
import { V1_DB_NAME, DB_NAME } from "../js/config.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
}

async function run() {
  const { stage } = await ensureJournalSeed();
  const ids = [];

  assert("normalize S&P 500 → SP500", normalizeAsset("S&P 500") === "SP500");
  try {
    assertObservation({ id: "x", stageId: "s" });
    assert("reject sin asset/note", false);
  } catch (e) {
    assert("reject sin asset/note", /asset|note/.test(e.message), e.message);
  }

  const created = await createObservation({ asset: "EURUSD", note: "london slow pullback" }, stage.id);
  ids.push(created.id);
  assert("crea observation válida", created.asset === "EURUSD" && created.note.includes("london"));
  assert("date automática YYYY-MM-DD", created.date === defaultObservationDate());
  assert("context BACKTEST / source MANUAL", created.context === "BACKTEST" && created.recordSource === "MANUAL");
  assert("promotedSetupId null", created.promotedSetupId == null);
  assert("no archived", created.archived === false);

  try {
    await createObservation({ asset: "EURUSD", note: "   " }, stage.id);
    assert("note requerida", false);
  } catch (e) {
    assert("note requerida", e.message === "note requerido");
  }
  try {
    await createObservation({ asset: "", note: "x" }, stage.id);
    assert("asset requerido", false);
  } catch (e) {
    assert("asset requerido", e.message === "asset requerido");
  }

  const dated = await createObservation({ asset: "nzdusd", note: "tokyo", date: "2026-08-01" }, stage.id);
  ids.push(dated.id);
  assert("date editable en alta", dated.date === "2026-08-01" && dated.asset === "NZDUSD");

  const listed = await listActiveObservations(stage.id, "EURUSD");
  assert("listado filtra EURUSD", listed.some((o) => o.id === created.id) && listed.every((o) => o.asset === "EURUSD"));

  const edited = await updateObservation(created.id, {
    note: "london slow pullback + ema hold",
    timeframe: "4H",
    session: "LONDON",
    tags: ["slow-pb", "ema"],
  });
  assert("edición persiste note/análisis", edited.note.includes("ema hold") && edited.session === "LONDON");

  const reopened = await getObservation(created.id);
  assert("lectura post update", reopened.timeframe === "4H" && reopened.tags.includes("slow-pb"));

  const ten = [];
  for (let i = 0; i < 10; i++) {
    const row = await createObservation({
      asset: "EURUSD",
      note: `eurusd sample ${i}`,
      date: `2026-08-${String(10 + i).padStart(2, "0")}`,
    }, stage.id);
    ten.push(row.id);
    ids.push(row.id);
  }
  const eur = await listActiveObservations(stage.id, "EURUSD");
  assert("10 EURUSD listadas", ten.every((id) => eur.some((o) => o.id === id)), String(eur.length));
  assert("orden cronológico desc", eur[0].date >= eur[eur.length - 1].date);

  const payload = await buildExportPayload();
  assert("export contiene observations", payload.observations.some((o) => o.id === created.id));

  await archiveObservation(created.id);
  const after = await listActiveObservations(stage.id, "EURUSD");
  assert("archivado sale del listado", after.every((o) => o.id !== created.id));
  const stored = await getObservation(created.id);
  assert("archivado no es hard delete", stored && stored.archived === true);

  for (const id of ten.concat(dated.id)) await archiveObservation(id);

  if (indexedDB.databases) {
    const dbs = await indexedDB.databases();
    assert("V1 aislado", !(dbs || []).some((d) => d && d.name === V1_DB_NAME) && (dbs || []).some((d) => d.name === DB_NAME));
  } else {
    assert("V1 aislado (sin databases())", true);
  }

  const leftover = (await listObservations()).filter((o) => !o.archived && o.note.startsWith("eurusd sample"));
  assert("fixtures de test no quedan activas", leftover.length === 0, String(leftover.length));

  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  lines.push("");
  lines.push(failed.length ? `${failed.length} fallos` : `${results.length} tests OK`);
  const out = document.getElementById("out");
  out.textContent = (out.textContent ? out.textContent + "\n\n" : "") + "SLICE 1\n" + lines.join("\n");
  if (!failed.length) out.className = out.className === "fail" ? "fail" : "ok";
  else out.className = "fail";
  if (failed.length) throw new Error("slice1 " + failed.length);
}

export { run };
