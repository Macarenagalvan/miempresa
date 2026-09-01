import { DB_NAME, V1_DB_NAME, STORES, JOURNAL_EDITION, SCHEMA_VERSION } from "../js/config.js";
import { openDb, listStoreNames } from "../js/storage/db.js";
import { ensureJournalSeed } from "../js/domain/stage.js";
import { getMeta } from "../js/storage/repos/meta.js";
import { listStages, getStage } from "../js/storage/repos/stages.js";
import { countCollection, repoFor } from "../js/storage/repos/collections.js";
import { attachmentsRepo } from "../js/storage/repos/attachments.js";
import { buildExportPayload } from "../js/services/backup.js";

const results = [];

function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
  if (!cond) console.error("FAIL", name, detail);
}

async function run() {
  const proto = location.protocol;
  document.getElementById("proto").textContent = `protocolo: ${proto}`;
  assert("no depende de file:// para correr", proto === "http:" || proto === "https:", proto);

  const db = await openDb();
  assert("abre IndexedDB JournalV2", db.name === DB_NAME, db.name);

  const names = await listStoreNames();
  const expected = Object.values(STORES).sort();
  assert("stores del schema vigente", JSON.stringify([...names].sort()) === JSON.stringify(expected), names.join(","));

  const first = await ensureJournalSeed();
  const second = await ensureJournalSeed();
  const stages = await listStages();
  const meta = await getMeta();

  assert("JournalMeta.journalEdition = v2", meta.journalEdition === JOURNAL_EDITION);
  assert("JournalMeta.schemaVersion vigente", meta.schemaVersion === SCHEMA_VERSION);
  assert("meta.activeStageId es UUID", typeof meta.activeStageId === "string" && meta.activeStageId.length >= 32);
  assert("exactamente una Stage", stages.length === 1, String(stages.length));
  assert("Stage ACTIVE", stages[0].status === "ACTIVE");
  assert("segundo boot no duplica Stage", first.stage.id === second.stage.id && stages.length === 1);
  assert("Stage referenciada existe", Boolean(await getStage(meta.activeStageId)));

  for (const emptyName of ["accounts", "movements", "observations", "setups", "trades", "asrs", "signals", "challenges", "payouts", "officeTasks", "officeNotes", "officeEvents", "officeShortcuts"]) {
    const n = await countCollection(emptyName);
    assert(`${emptyName} nace en 0`, n === 0, String(n));
  }
  assert("attachments reserva vacía", (await attachmentsRepo.count()) === 0);

  const probeId = "00000000-0000-4000-8000-000000000099";
  await repoFor("observations").put({ id: probeId, note: "probe-slice0" });
  const readBack = await repoFor("observations").get(probeId);
  assert("repository write/read", readBack && readBack.note === "probe-slice0");
  await repoFor("observations").delete(probeId);
  assert("repository delete", (await repoFor("observations").get(probeId)) == null);
  assert("observations vuelve a 0", (await countCollection("observations")) === 0);

  const payload = await buildExportPayload();
  assert("export journalEdition v2", payload.journalEdition === "v2");
  assert("export schemaVersion vigente", payload.schemaVersion === SCHEMA_VERSION);
  assert("export product Journal V2", payload.product === "Journal V2");
  assert("export format journal-v2", payload.format === "journal-v2");
  assert("export backupVersion 1", payload.backupVersion === 1);
  assert("export tiene exportedAt", typeof payload.exportedAt === "string" && payload.exportedAt.includes("T"));
  assert("export incluye meta y stages", Boolean(payload.meta) && Array.isArray(payload.stages) && payload.stages.length === 1);
  for (const key of ["accounts", "movements", "observations", "setups", "trades", "asrs", "signals", "challenges", "payouts", "attachments", "officeTasks", "officeNotes", "officeEvents", "officeShortcuts"]) {
    assert(`export.${key} array`, Array.isArray(payload[key]));
  }
  assert("export attachments reserva vacía", Array.isArray(payload.attachments) && payload.attachments.length === 0);

  if (indexedDB.databases) {
    const dbs = await indexedDB.databases();
    const v1 = (dbs || []).some((d) => d && d.name === V1_DB_NAME);
    const v2 = (dbs || []).some((d) => d && d.name === DB_NAME);
    assert("existe JournalV2", v2 === true, JSON.stringify(dbs));
    assert("Slice 0 no abre/crea TradingJournalDB", v1 === false, JSON.stringify(dbs));
  } else {
    assert("indexedDB.databases no disponible; V2 nunca referencia TradingJournalDB en código de app", true);
  }

  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  lines.push("");
  lines.push(failed.length ? `${failed.length} fallos` : `${results.length} tests OK`);
  document.getElementById("out").textContent = lines.join("\n");
  document.getElementById("out").className = failed.length ? "fail" : "ok";
  console.log(lines.join("\n"));
  if (failed.length) throw new Error(`${failed.length} tests fallaron`);
}

export { run };
