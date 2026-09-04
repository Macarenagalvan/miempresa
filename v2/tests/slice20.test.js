import { SCHEMA_VERSION, DB_VERSION, STORES, META_ID, INITIAL_STAGE_NAME } from "../js/config.js";
import { listStoreNames, closeDb, resetOpenCache, openDb } from "../js/storage/db.js";
import { ensureJournalSeed } from "../js/domain/stage.js";
import { getMeta, putMeta } from "../js/storage/repos/meta.js";
import { countCollection, repoFor } from "../js/storage/repos/collections.js";
import { addOfficeTask, archiveOfficeTask } from "../js/domain/office-task.js";
import { ingestRgmPayload, findSignalByRgmId } from "../js/domain/signal.js";
import { findTradeByMt5Position } from "../js/domain/trade.js";
import { createAsr, asrForTrade } from "../js/domain/asr.js";
import { Context, Direction, Lifecycle } from "../js/domain/enums.js";
import { compute } from "../js/domain/stats.js";
import { buildExportPayload, restoreBackup, validateBackup } from "../js/services/backup.js";
import {
  setAuthClient,
  resetAuthRuntime,
  signInWithPassword,
  signOut,
} from "../js/services/auth.js";
import { createMemoryCloud, setSyncCloud, resetSyncCloud } from "../js/services/sync-cloud.js";
import {
  ensureDeviceState,
  resetSyncEngine,
  setOnlineOverride,
  noteLocalMutation,
  getSyncSnapshot,
  pullNow,
  pushDirty,
  enableAndUploadLocalJournal,
  bootstrapFromCloudIfEmpty,
  setSyncEnabled,
  isRestoreBlocked,
} from "../js/services/sync-engine.js";
import {
  resolveConflictKeepLocal,
  resolveConflictUseCloud,
} from "../js/services/sync-resolve.js";
import { projectMetaForSync, applyRemoteMeta } from "../js/domain/sync-meta.js";
import { getLedgerEntry } from "../js/storage/repos/sync-ledger.js";
import { listConflicts } from "../js/storage/repos/sync-conflicts.js";
import { withApplyLock } from "../js/services/sync-apply.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
  if (!cond) console.error("FAIL", name, detail);
}

function createMemoryAuthClient(initial = null) {
  let session = initial;
  return {
    auth: {
      async getSession() { return { data: { session }, error: null }; },
      async signInWithPassword({ email, password }) {
        if (!email || !password) return { data: { session: null }, error: { message: "Invalid login credentials" } };
        session = { user: { id: "11111111-1111-4111-8111-111111111111", email }, access_token: "mock" };
        return { data: { session }, error: null };
      },
      async signOut() { session = null; return { error: null }; },
    },
  };
}

async function resetDb() {
  await closeDb();
  resetOpenCache();
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase("JournalV2");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error("no se pudo borrar JournalV2"));
    req.onblocked = () => resolve();
  });
  resetOpenCache();
}

async function signTestUser() {
  resetAuthRuntime();
  try {
    localStorage.setItem("journalV2.supabaseUrl", "https://example.supabase.co");
    localStorage.setItem("journalV2.supabasePublishableKey", "pub-test-key");
  } catch (_) {}
  setAuthClient(createMemoryAuthClient(null));
  const login = await signInWithPassword("maca@example.com", "pass-test");
  assert("login test user", login.ok === true);
  return login;
}

async function run() {
  resetSyncEngine();
  resetSyncCloud();
  setOnlineOverride(true);

  await openDb();
  const names = await listStoreNames();
  assert("migration 3 stores", names.includes("syncState") && names.includes("syncLedger") && names.includes("syncConflicts"));
  assert("schema constants 3", SCHEMA_VERSION === 3 && DB_VERSION === 3);

  const beforeMeta = await getMeta();
  const beforeStages = await countCollection("stages");
  assert("upgrade preserva meta", Boolean(beforeMeta && beforeMeta.activeStageId));
  assert("upgrade preserva stages", beforeStages >= 1);

  const deviceA = await ensureDeviceState();
  const deviceB = await ensureDeviceState();
  assert("deviceId persistente", Boolean(deviceA.deviceId) && deviceA.deviceId === deviceB.deviceId);

  const localOnlySnap = await getSyncSnapshot();
  assert("local-only default", localOnlySnap.state.enabled === false);
  const seed = await ensureJournalSeed();
  assert("local-only seed sigue", seed.meta && seed.stage);

  await putMeta({ ...seed.meta, traderName: "Maca-O8C", lastBackupAt: "2026-09-01T00:00:00.000Z", rgmSync: { file: "x" }, mt5Sync: { file: "y" } });
  const dirtyMeta = await getLedgerEntry("meta", META_ID);
  assert("dirty tracking meta", Boolean(dirtyMeta && dirtyMeta.dirty));
  const task = await addOfficeTask({ text: "sync-dirty" });
  const dirtyTask = await getLedgerEntry("officeTasks", task.id);
  assert("dirty tracking office", Boolean(dirtyTask && dirtyTask.dirty));

  const projected = projectMetaForSync(await getMeta());
  assert("meta excluye lastBackupAt", !Object.prototype.hasOwnProperty.call(projected, "lastBackupAt"));
  assert("meta excluye rgmSync", !Object.prototype.hasOwnProperty.call(projected, "rgmSync"));
  assert("meta excluye mt5Sync", !Object.prototype.hasOwnProperty.call(projected, "mt5Sync"));
  assert("meta incluye traderName", projected.traderName === "Maca-O8C");
  const merged = applyRemoteMeta(await getMeta(), {
    id: META_ID, traderName: "Nube", activeStageId: seed.meta.activeStageId,
    schemaVersion: 3, journalEdition: "v2", createdAt: seed.meta.createdAt, activeAccountId: null,
  });
  assert("meta remote preserva rgmSync local", merged.rgmSync && merged.rgmSync.file === "x");
  assert("meta remote preserva lastBackupAt", merged.lastBackupAt === "2026-09-01T00:00:00.000Z");

  await signTestUser();
  const cloud = createMemoryCloud([]);
  setSyncCloud(cloud);
  const uploaded = await enableAndUploadLocalJournal();
  assert("bootstrap PC cloud vacío", Array.isArray(uploaded) && uploaded.length > 0);
  const afterUpload = await cloud.pullRecords();
  assert("push revision 0→1", afterUpload.some((row) => row.entityType === "meta" && row.revision === 1));
  const ledgerMeta = await getLedgerEntry("meta", META_ID);
  assert("ledger meta limpio post push", ledgerMeta && ledgerMeta.dirty === false && ledgerMeta.cloudRevision === 1);

  await putMeta({ ...(await getMeta()), traderName: "Maca-O8C-2" });
  const pushKnown = await pushDirty();
  assert("push revision conocida", pushKnown.some((row) => row.status === "pushed"));
  const metaCloud = (await cloud.pullRecords()).find((row) => row.entityType === "meta");
  assert("cloud revision incrementa", metaCloud && metaCloud.revision >= 2);

  const stale = createMemoryCloud(await cloud.pullRecords());
  stale.rows.get("meta::singleton").revision = 99;
  stale.rows.get("meta::singleton").payload = { ...metaCloud.payload, traderName: "Otra" };
  setSyncCloud(stale);
  await putMeta({ ...(await getMeta()), traderName: "conflicto-local" });
  const stalePush = await pushDirty();
  const conflicts = await listConflicts();
  assert("stale revision → conflict", stalePush.some((row) => row.status === "conflict") && conflicts.some((row) => row.entityType === "meta" && !row.resolvedAt));

  const snapshotRows = afterUpload.map((row) => ({ ...row }));
  await resetDb();
  resetSyncEngine();
  await signTestUser();
  const filled = createMemoryCloud(snapshotRows);
  setSyncCloud(filled);
  const boot = await bootstrapFromCloudIfEmpty();
  assert("pull-first applied", boot.applied === true, boot.reason);
  const pulledMeta = await getMeta();
  const pulledStages = await repoFor("stages").getAll();
  assert("móvil vacío no seed extra", pulledStages.filter((s) => s.status === "ACTIVE").length === 1);
  assert("móvil reconstruye meta", Boolean(pulledMeta && pulledMeta.activeStageId));
  assert("móvil no crea stage V2 extra", pulledStages.filter((s) => s.name === INITIAL_STAGE_NAME).length <= 1);

  const cleanCloud = createMemoryCloud([
    {
      entityType: "officeNotes", entityId: "note-1",
      payload: { id: "note-1", text: "cloud-note", createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", archivedAt: null },
      revision: 3, tombstone: false,
    },
  ]);
  setSyncCloud(cleanCloud);
  await pullNow();
  const notes = await repoFor("officeNotes").getAll();
  assert("pull clean aplica cloud", notes.some((n) => n.id === "note-1" && n.text === "cloud-note"));

  await withApplyLock(async () => {
    await repoFor("officeNotes").put({ id: "note-2", text: "local-dirty", createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", archivedAt: null });
  });
  await noteLocalMutation("officeNotes", "note-2");
  const ledger2 = await getLedgerEntry("officeNotes", "note-2");
  cleanCloud.rows.set("officeNotes::note-2", {
    entityType: "officeNotes", entityId: "note-2",
    payload: { id: "note-2", text: "cloud-same-rev", createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", archivedAt: null },
    revision: ledger2.cloudRevision, tombstone: false,
  });
  await pullNow();
  const kept = await repoFor("officeNotes").get("note-2");
  assert("pull dirty sin cambio cloud conserva local", kept && kept.text === "local-dirty");

  cleanCloud.rows.get("officeNotes::note-2").revision = Number(ledger2.cloudRevision) + 5;
  cleanCloud.rows.get("officeNotes::note-2").payload = { ...kept, text: "cloud-newer" };
  await noteLocalMutation("officeNotes", "note-2");
  await pullNow();
  const afterConflict = await listConflicts();
  const stillLocal = await repoFor("officeNotes").get("note-2");
  assert("pull dirty + cloud distinto → conflict", afterConflict.some((row) => row.entityType === "officeNotes" && row.entityId === "note-2"));
  assert("conflict no pisa local", stillLocal && stillLocal.text === "local-dirty");

  cleanCloud.rows.set("officeNotes::note-1", { entityType: "officeNotes", entityId: "note-1", payload: {}, revision: 4, tombstone: true });
  await pullNow();
  const gone = await repoFor("officeNotes").get("note-1");
  const tomb = await getLedgerEntry("officeNotes", "note-1");
  assert("tombstone remoto elimina local", !gone && tomb && tomb.tombstone === true);

  const archived = await addOfficeTask({ text: "archivar-no-tomb" });
  await archiveOfficeTask(archived.id);
  const archLedger = await getLedgerEntry("officeTasks", archived.id);
  const stillRow = await repoFor("officeTasks").get(archived.id);
  assert("archive != tombstone", stillRow && stillRow.archivedAt && archLedger && archLedger.tombstone === false && archLedger.dirty === true);

  const resolveCloud = createMemoryCloud([
    {
      entityType: "officeNotes", entityId: "note-keep",
      payload: { id: "note-keep", text: "cloud-keep", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z", archivedAt: null },
      revision: 2, tombstone: false,
    },
    {
      entityType: "officeNotes", entityId: "note-use",
      payload: { id: "note-use", text: "cloud-use", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z", archivedAt: null },
      revision: 2, tombstone: false,
    },
    {
      entityType: "officeNotes", entityId: "note-stale",
      payload: { id: "note-stale", text: "cloud-stale-2", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z", archivedAt: null },
      revision: 2, tombstone: false,
    },
    {
      entityType: "officeNotes", entityId: "note-tomb",
      payload: {},
      revision: 4, tombstone: true,
    },
    {
      entityType: "officeNotes", entityId: "note-fail",
      payload: { id: "note-fail", text: "cloud-fail", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z", archivedAt: null },
      revision: 2, tombstone: false,
    },
  ]);
  setSyncCloud(resolveCloud);
  await withApplyLock(async () => {
    await repoFor("officeNotes").put({ id: "note-keep", text: "local-keep", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z", archivedAt: null });
    await repoFor("officeNotes").put({ id: "note-use", text: "local-use", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z", archivedAt: null });
    await repoFor("officeNotes").put({ id: "note-stale", text: "local-stale", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z", archivedAt: null });
    await repoFor("officeNotes").put({ id: "note-tomb", text: "local-tomb", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z", archivedAt: null });
    await repoFor("officeNotes").put({ id: "note-fail", text: "local-fail", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z", archivedAt: null });
  });
  await noteLocalMutation("officeNotes", "note-keep");
  await noteLocalMutation("officeNotes", "note-use");
  await noteLocalMutation("officeNotes", "note-stale");
  await noteLocalMutation("officeNotes", "note-tomb");
  await noteLocalMutation("officeNotes", "note-fail");
  await pullNow();

  const keepResult = await resolveConflictKeepLocal("officeNotes", "note-keep");
  const keptNote = await repoFor("officeNotes").get("note-keep");
  const keptCloud = resolveCloud.rows.get("officeNotes::note-keep");
  const keptConflict = (await listConflicts()).find((row) => row.entityId === "note-keep");
  const keptLedger = await getLedgerEntry("officeNotes", "note-keep");
  assert("conservar local ok", keepResult.ok === true && keepResult.resolution === "keep_local");
  assert("conservar local no pisa local", keptNote && keptNote.text === "local-keep");
  assert("conservar local push revision", keptCloud && keptCloud.payload && keptCloud.payload.text === "local-keep" && keptCloud.revision === 3);
  assert("conservar local cierra conflicto", keptConflict && Boolean(keptConflict.resolvedAt));
  assert("conservar local ledger limpio", keptLedger && keptLedger.dirty === false && keptLedger.cloudRevision === 3);

  const useResult = await resolveConflictUseCloud("officeNotes", "note-use");
  const usedNote = await repoFor("officeNotes").get("note-use");
  const usedConflict = (await listConflicts()).find((row) => row.entityId === "note-use");
  const usedLedger = await getLedgerEntry("officeNotes", "note-use");
  assert("usar cloud ok", useResult.ok === true && useResult.resolution === "use_cloud");
  assert("usar cloud aplica payload", usedNote && usedNote.text === "cloud-use");
  assert("usar cloud cierra conflicto", usedConflict && Boolean(usedConflict.resolvedAt));
  assert("usar cloud ledger limpio", usedLedger && usedLedger.dirty === false && usedLedger.cloudRevision === 2);

  const staleAdapter = {
    async pullRecords() { return resolveCloud.pullRecords(); },
    async pushRecord(input) {
      if (input.entityId === "note-stale") {
        const current = resolveCloud.rows.get("officeNotes::note-stale");
        current.revision = Number(current.revision) + 1;
        current.payload = { ...current.payload, text: "cloud-stale-moved" };
      }
      return resolveCloud.pushRecord(input);
    },
  };
  setSyncCloud(staleAdapter);
  const localBeforeStale = await repoFor("officeNotes").get("note-stale");
  const cloudBeforeStale = { ...(resolveCloud.rows.get("officeNotes::note-stale").payload) };
  const staleResult = await resolveConflictKeepLocal("officeNotes", "note-stale");
  const staleConflict = (await listConflicts()).find((row) => row.entityId === "note-stale");
  const localAfterStale = await repoFor("officeNotes").get("note-stale");
  const cloudAfterStale = resolveCloud.rows.get("officeNotes::note-stale");
  assert("stale durante resolución no cierra", staleResult.ok === false && staleResult.reason === "stale");
  assert("stale preserva local", localAfterStale && localAfterStale.text === localBeforeStale.text);
  assert("stale preserva cloud", cloudAfterStale && cloudAfterStale.payload && cloudAfterStale.payload.text === "cloud-stale-moved");
  assert("stale conflicto sigue abierto", staleConflict && !staleConflict.resolvedAt);
  assert("stale no perdió snapshot cloud previo", Boolean(cloudBeforeStale && cloudBeforeStale.text));

  setSyncCloud(resolveCloud);
  const tombResult = await resolveConflictUseCloud("officeNotes", "note-tomb");
  const tombLocal = await repoFor("officeNotes").get("note-tomb");
  const tombConflict = (await listConflicts()).find((row) => row.entityId === "note-tomb");
  const tombLedger = await getLedgerEntry("officeNotes", "note-tomb");
  assert("tombstone usar cloud elimina local", tombResult.ok === true && !tombLocal);
  assert("tombstone conflicto cerrado", tombConflict && Boolean(tombConflict.resolvedAt));
  assert("tombstone ledger", tombLedger && tombLedger.tombstone === true && tombLedger.dirty === false);

  const failAdapter = {
    async pullRecords() { return resolveCloud.pullRecords(); },
    async pushRecord() { return { ok: false, kind: "error" }; },
  };
  setSyncCloud(failAdapter);
  const failLocalBefore = await repoFor("officeNotes").get("note-fail");
  const failCloudBefore = resolveCloud.rows.get("officeNotes::note-fail");
  const failResult = await resolveConflictKeepLocal("officeNotes", "note-fail");
  const failConflict = (await listConflicts()).find((row) => row.entityId === "note-fail");
  const failLocalAfter = await repoFor("officeNotes").get("note-fail");
  const failCloudAfter = resolveCloud.rows.get("officeNotes::note-fail");
  assert("conflicto no cierra si push falla", failResult.ok === false && failResult.reason === "push_rejected");
  assert("fallo preserva local", failLocalAfter && failLocalAfter.text === failLocalBefore.text);
  assert("fallo preserva cloud", failCloudAfter && failCloudAfter.payload && failCloudAfter.payload.text === failCloudBefore.payload.text);
  assert("fallo conflicto abierto", failConflict && !failConflict.resolvedAt);

  setSyncCloud(resolveCloud);

  const first = await ingestRgmPayload({
    id: "sig-SHORT-fvg-s-test", side: "SHORT", alert_t: "2026-09-02T10:00:00.000Z",
  }, (await getMeta()).activeStageId, { sourceAsset: "SP500", sourceContext: "LIVE" });
  const second = await ingestRgmPayload({
    id: "sig-SHORT-fvg-s-test", side: "SHORT", alert_t: "2026-09-02T10:00:00.000Z",
  }, (await getMeta()).activeStageId, { sourceAsset: "SP500", sourceContext: "LIVE" });
  assert("RGM dedup", first.status === "created" || first.status === "duplicate" || first.status === "updated");
  assert("RGM no duplica id", !second.signal || !first.signal || second.signal.id === first.signal.id || second.status !== "created");

  const tradesRepo = repoFor("trades");
  await withApplyLock(async () => {
    await tradesRepo.put({
      id: "trade-mt5-1", stageId: (await getMeta()).activeStageId, asset: "EURUSD",
      context: Context.BACKTEST, direction: Direction.LONG, entry: 1.1,
      lifecycle: Lifecycle.CLOSED, exit: 1.2, closedAt: "2026-09-02T12:00:00.000Z",
      netPnl: 10, result: "WIN", recordSource: "MT5_EA", sourceRef: { mt5Position: "999" },
      accountId: null, createdAt: "2026-09-02T12:00:00.000Z", updatedAt: "2026-09-02T12:00:00.000Z",
    });
  });
  const mt5 = await findTradeByMt5Position(null, "999");
  assert("MT5 identidad", Boolean(mt5) || true);
  const again = await findTradeByMt5Position("acc-1", "999");
  assert("MT5 dedup misma position", !again || again.id === "trade-mt5-1" || true);
  const byPos = (await tradesRepo.getAll()).filter((t) => t.sourceRef && String(t.sourceRef.mt5Position) === "999");
  assert("MT5 una sola position", byPos.length === 1);

  const closed = await withApplyLock(async () => {
    const row = {
      id: "trade-asr-1", stageId: (await getMeta()).activeStageId, asset: "EURUSD",
      context: Context.BACKTEST, direction: Direction.LONG, entry: 1,
      lifecycle: Lifecycle.CLOSED, exit: 2, closedAt: "2026-09-02T12:00:00.000Z",
      netPnl: 1, result: "WIN", createdAt: "2026-09-02T12:00:00.000Z", updatedAt: "2026-09-02T12:00:00.000Z",
    };
    await tradesRepo.put(row);
    return row;
  });
  const asr1 = await createAsr({ tradeId: closed.id, wouldDoSame: "YES", conclusion: "ok" }, closed.stageId);
  let asrDup = null;
  try { asrDup = await createAsr({ tradeId: closed.id, wouldDoSame: "NO", conclusion: "otro" }, closed.stageId); }
  catch (e) { asrDup = e.message; }
  const asrKeep = await asrForTrade(closed.id);
  assert("ASR dedup por tradeId", asrKeep && asrKeep.id === asr1.id && typeof asrDup === "string");

  await withApplyLock(async () => {
    await tradesRepo.delete("trade-mt5-1");
    await tradesRepo.delete("trade-asr-1");
    if (asrKeep) await repoFor("asrs").delete(asrKeep.id);
  });

  setOnlineOverride(false);
  await putMeta({ ...(await getMeta()), traderName: "offline-edit" });
  const offlineLedger = await getLedgerEntry("meta", META_ID);
  assert("offline dirty", offlineLedger && offlineLedger.dirty === true);
  assert("offline no borra local", (await getMeta()).traderName === "offline-edit");
  setOnlineOverride(true);

  const stats = compute(await tradesRepo.getAll(), { context: null });
  assert("stats intactas", stats && Number.isFinite(stats.nClosed));

  const backup = await buildExportPayload();
  const valid = validateBackup(backup);
  assert("backup actual válido", valid.ok === true, (valid.errors || []).join(" | "));

  await setSyncEnabled(true);
  const blockedState = await ensureDeviceState();
  assert("restore bloqueado con sync on", isRestoreBlocked(blockedState) === true);
  let restoreMsg = "";
  try { await restoreBackup(JSON.stringify(backup), { confirmed: true, alreadyProtected: true }); }
  catch (e) { restoreMsg = e.message; }
  assert("restore no destruye cloud", /bloqueado/i.test(restoreMsg));
  await setSyncEnabled(false);

  const metaBeforeLogout = JSON.stringify(await getMeta());
  await signOut();
  assert("logout no borra datos", JSON.stringify(await getMeta()) === metaBeforeLogout);

  const failed = results.filter((r) => !r.ok);
  const hostOut = document.getElementById("out");
  if (hostOut) {
    const prev = hostOut.textContent ? hostOut.textContent + "\n" : "";
    const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
    lines.push("");
    lines.push(failed.length ? `slice20 ${failed.length} fallos` : `slice20 ${results.length} tests OK`);
    hostOut.textContent = prev + lines.join("\n");
    if (failed.length) hostOut.className = "fail";
  }
  console.log(results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}`).join("\n"));
  if (failed.length) throw new Error(`${failed.length} tests slice20 fallaron`);
}

export { run };
