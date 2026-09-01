import {
  DB_NAME,
  SCHEMA_VERSION,
  DB_VERSION,
  STORES,
  OFFICE_COLLECTIONS,
  EXPORT_COLLECTIONS,
  JOURNAL_EDITION,
} from "../js/config.js";
import { openDb, closeDb, resetOpenCache, listStoreNames } from "../js/storage/db.js";
import { applyMigrations } from "../js/storage/migrations.js";
import { ensureJournalSeed } from "../js/domain/stage.js";
import { getMeta } from "../js/storage/repos/meta.js";
import { countCollection, dumpCollections, repoFor } from "../js/storage/repos/collections.js";
import {
  buildExportPayload,
  classifyBackup,
  validateBackup,
  restoreBackup,
} from "../js/services/backup.js";
import { compute } from "../js/domain/stats.js";
import { emptyV2, richV2, STAGE_EMPTY } from "./slice12.payloads.js";
import { SLICE5_TRADES, SLICE5_STAGE } from "../js/fixtures/stats-slice5.js";
import { Context } from "../js/domain/enums.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
  if (!cond) console.error("FAIL", name, detail);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function schema1Backup() {
  const payload = emptyV2();
  payload.schemaVersion = 1;
  payload.meta = { ...payload.meta, schemaVersion: 1 };
  delete payload.officeTasks;
  delete payload.officeNotes;
  delete payload.officeEvents;
  delete payload.officeShortcuts;
  payload.observations = [{
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01",
    stageId: STAGE_EMPTY,
    asset: "EURUSD",
    note: "schema-1-keep",
    date: "2026-08-01",
  }];
  return payload;
}

function schema2BackupWithOffice() {
  const payload = emptyV2();
  payload.officeTasks = [{
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee11",
    text: "restored-task",
    dueDate: null,
    done: false,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    completedAt: null,
    archivedAt: null,
  }];
  payload.officeNotes = [{
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee12",
    text: "restored-note",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    archivedAt: null,
  }];
  payload.officeEvents = [{
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee13",
    title: "restored-event",
    date: "2026-09-01",
    time: "18:00",
    note: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  }];
  payload.officeShortcuts = [{
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee14",
    label: "TV",
    url: "https://www.tradingview.com/",
    order: 0,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  }];
  return payload;
}

function openAtVersion(version) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = (event) => {
      applyMigrations(req.result, event.oldVersion || 0, req.result.version);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("openAtVersion"));
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteJournalDb() {
  await closeDb();
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      if (err) reject(err);
      else resolve();
    };
    req.onsuccess = () => finish();
    req.onerror = () => finish(req.error || new Error("deleteDatabase"));
    req.onblocked = () => setTimeout(() => finish(), 80);
  });
  resetOpenCache();
}

async function run() {
  await ensureJournalSeed();
  const db = await openDb();
  assert("DB_VERSION app = 2", DB_VERSION === 2);
  assert("SCHEMA_VERSION app = 2", SCHEMA_VERSION === 2);
  assert("IDB version 2", db.version === 2, String(db.version));

  const names = await listStoreNames();
  for (const store of OFFICE_COLLECTIONS) {
    assert(`store ${store} existe`, names.includes(store), names.join(","));
  }
  for (const name of Object.values(STORES)) {
    assert(`store trading/office ${name}`, names.includes(name));
  }

  for (const name of OFFICE_COLLECTIONS) {
    const n = await countCollection(name);
    assert(`${name} vacío al nacer o post-slice12`, n === 0, String(n));
  }

  const exported = await buildExportPayload();
  assert("export schema 2", exported.schemaVersion === 2 && exported.journalEdition === JOURNAL_EDITION);
  for (const name of OFFICE_COLLECTIONS) {
    assert(`export incluye ${name}`, Array.isArray(exported[name]));
  }
  assert("export office vacío clean", OFFICE_COLLECTIONS.every((n) => exported[n].length === 0));

  const schema1 = schema1Backup();
  const report1 = validateBackup(schema1);
  assert("backup schema 1 válido sin collections Office", report1.ok === true, report1.errors.join(" | "));
  assert("classify schema 1 es v2", classifyBackup(schema1).kind === "v2");

  await restoreBackup(schema1, { confirmed: true, alreadyProtected: true });
  const metaAfter1 = await getMeta();
  assert("restore schema 1 deja meta live schema 2", metaAfter1.schemaVersion === 2);
  assert("restore schema 1 conserva stage", metaAfter1.activeStageId === STAGE_EMPTY);
  const obsAfter1 = await repoFor("observations").get("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01");
  assert("restore schema 1 conserva trading", Boolean(obsAfter1) && obsAfter1.note === "schema-1-keep");
  for (const name of OFFICE_COLLECTIONS) {
    const n = await countCollection(name);
    assert(`Office vacío tras restore schema 1 (${name})`, n === 0, String(n));
  }

  const schema2 = schema2BackupWithOffice();
  const report2 = validateBackup(schema2);
  assert("backup schema 2 con Office válido", report2.ok === true, report2.errors.join(" | "));
  await restoreBackup(schema2, { confirmed: true, alreadyProtected: true });
  assert("restore schema 2 conserva task", Boolean(await repoFor("officeTasks").get("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee11")));
  assert("restore schema 2 conserva note", Boolean(await repoFor("officeNotes").get("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee12")));
  assert("restore schema 2 conserva event", Boolean(await repoFor("officeEvents").get("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee13")));
  assert("restore schema 2 conserva shortcut", Boolean(await repoFor("officeShortcuts").get("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee14")));
  const dumped = await dumpCollections();
  assert("trading no se inventa en restore Office", dumped.trades.length === 0 && dumped.observations.length === 0);

  await restoreBackup(schema1, { confirmed: true, alreadyProtected: true });
  assert("restore schema 1 limpia Office previo", (await countCollection("officeTasks")) === 0);
  assert("restore schema 1 no exige Office keys", (await countCollection("officeShortcuts")) === 0);

  const future = clone(emptyV2());
  future.schemaVersion = SCHEMA_VERSION + 1;
  assert("future schema rechazado classify", classifyBackup(future).kind === "future");
  let futureMsg = null;
  try {
    await restoreBackup(future, { confirmed: true, alreadyProtected: true });
  } catch (err) {
    futureMsg = err.message;
  }
  assert("future schema restore bloqueado", typeof futureMsg === "string" && futureMsg.includes("futura"));

  const v1 = {
    version: 3,
    exportedAt: "2026-01-01T00:00:00.000Z",
    trades: [],
    asrs: [],
    accounts: [],
    btcOps: [],
    activeAccountId: null,
    traderName: "x",
  };
  assert("V1 classify", classifyBackup(v1).kind === "v1");
  let v1Msg = null;
  try {
    await restoreBackup(v1, { confirmed: true, alreadyProtected: true });
  } catch (err) {
    v1Msg = err.message;
  }
  assert("V1 restore bloqueado", typeof v1Msg === "string" && v1Msg.includes("Journal V1"));

  const beforeStats = compute(SLICE5_TRADES, { context: Context.BACKTEST, stageId: SLICE5_STAGE });
  await repoFor("officeTasks").put({
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee99",
    text: "no-entra-a-stats",
    dueDate: null,
    done: true,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    completedAt: "2026-09-01T11:00:00.000Z",
    archivedAt: null,
  });
  const afterStats = compute(SLICE5_TRADES, { context: Context.BACKTEST, stageId: SLICE5_STAGE });
  assert("Office no altera WR", beforeStats.winRate === afterStats.winRate && beforeStats.nClosed === afterStats.nClosed);
  assert("Office no altera netPnl", beforeStats.netPnl === afterStats.netPnl);
  await repoFor("officeTasks").delete("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee99");

  const richOk = validateBackup(richV2());
  assert("fixture rich V2 sigue válido", richOk.ok === true, richOk.errors.join(" | "));

  await deleteJournalDb();
  const dbV1 = await openAtVersion(1);
  assert("upgrade prep abre v1", dbV1.version === 1, String(dbV1.version));
  const v1Names = Array.from(dbV1.objectStoreNames);
  assert("v1 no tiene Office", OFFICE_COLLECTIONS.every((n) => !v1Names.includes(n)), v1Names.join(","));
  const stageId = "11111111-1111-4111-8111-111111111111";
  const keepObs = "22222222-2222-4222-8222-222222222222";
  await new Promise((resolve, reject) => {
    const tx = dbV1.transaction(["meta", "stages", "observations"], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore("stages").put({
      id: stageId,
      name: "V2 · inicio",
      status: "ACTIVE",
      startedAt: "2026-08-01T00:00:00.000Z",
      endedAt: null,
      resetReason: null,
      backupRef: null,
    });
    tx.objectStore("meta").put({
      id: "singleton",
      schemaVersion: 1,
      journalEdition: "v2",
      activeStageId: stageId,
      traderName: "Maca",
      createdAt: "2026-08-01T00:00:00.000Z",
      lastBackupAt: null,
      activeAccountId: null,
    });
    tx.objectStore("observations").put({
      id: keepObs,
      stageId,
      asset: "EURUSD",
      note: "keep-across-upgrade",
      date: "2026-08-02",
    });
  });
  dbV1.close();
  resetOpenCache();

  const dbV2 = await openDb();
  assert("upgrade 1→2 sube IDB version", dbV2.version === 2, String(dbV2.version));
  const upgradedNames = await listStoreNames();
  for (const name of OFFICE_COLLECTIONS) {
    assert(`upgrade crea ${name}`, upgradedNames.includes(name));
  }
  for (const name of ["meta", "stages", "accounts", "trades", "observations", "attachments"]) {
    assert(`upgrade conserva store ${name}`, upgradedNames.includes(name));
  }
  const kept = await requestToPromise(dbV2.transaction("observations").objectStore("observations").get(keepObs));
  assert("upgrade conserva observation", kept && kept.note === "keep-across-upgrade");
  const seed = await ensureJournalSeed();
  assert("upgrade bump meta a schema 2", seed.meta.schemaVersion === 2);
  assert("upgrade no resetea stage", seed.meta.activeStageId === stageId);
  for (const name of OFFICE_COLLECTIONS) {
    assert(`upgrade Office vacío ${name}`, (await countCollection(name)) === 0);
  }
  assert("EXPORT_COLLECTIONS cubre Office", OFFICE_COLLECTIONS.every((n) => EXPORT_COLLECTIONS.includes(n)));

  const failed = results.filter((r) => !r.ok);
  const host = document.getElementById("out");
  if (host) {
    const prev = host.textContent ? host.textContent + "\n" : "";
    const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
    lines.push("");
    lines.push(failed.length ? `slice13 ${failed.length} fallos` : `slice13 ${results.length} tests OK`);
    host.textContent = prev + lines.join("\n");
    if (failed.length) host.className = "fail";
  }
  console.log(results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}`).join("\n"));
  if (failed.length) throw new Error(`${failed.length} tests slice13 fallaron`);
}

export { run };
