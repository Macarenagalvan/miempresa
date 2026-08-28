import {
  JOURNAL_EDITION,
  SCHEMA_VERSION,
  BACKUP_PRODUCT,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  EXPORT_COLLECTIONS,
  META_ID,
} from "../js/config.js";
import { ensureJournalSeed } from "../js/domain/stage.js";
import { getMeta } from "../js/storage/repos/meta.js";
import { listStages } from "../js/storage/repos/stages.js";
import { dumpCollections, repoFor } from "../js/storage/repos/collections.js";
import { attachmentsRepo } from "../js/storage/repos/attachments.js";
import {
  buildExportPayload,
  classifyBackup,
  parseBackupText,
  validateBackup,
  previewBackupText,
  restoreBackup,
  applyRestoreTransaction,
  downloadCurrentBackup,
} from "../js/services/backup.js";
import {
  emptyV2,
  richV2,
  STAGE,
  ACC,
  CH,
  OBS,
  SETUP,
  TRADE_LIVE,
  TRADE_VOID,
  ATT,
  STAGE_EMPTY,
} from "./slice12.payloads.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
  if (!cond) console.error("FAIL", name, detail);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function snapshotIds() {
  const collections = await dumpCollections();
  const out = {};
  for (const name of EXPORT_COLLECTIONS) {
    out[name] = (collections[name] || []).map((r) => r.id).sort();
  }
  const meta = await getMeta();
  return { meta, collections, ids: out };
}

async function run() {
  await ensureJournalSeed();

  const exported = await buildExportPayload();
  assert("export V2 válido", exported.journalEdition === JOURNAL_EDITION && exported.schemaVersion === SCHEMA_VERSION);
  assert("metadata product", exported.product === BACKUP_PRODUCT);
  assert("metadata format", exported.format === BACKUP_FORMAT);
  assert("metadata backupVersion", exported.backupVersion === BACKUP_VERSION);
  for (const name of EXPORT_COLLECTIONS) {
    assert(`export incluye ${name}`, Array.isArray(exported[name]));
  }
  assert("export incluye meta", Boolean(exported.meta && exported.meta.id === META_ID));

  assert("classify v2", classifyBackup(exported).kind === "v2");
  const v1 = { version: 3, exportedAt: "2026-01-01T00:00:00.000Z", trades: [], asrs: [], accounts: [], btcOps: [], activeAccountId: null, traderName: "x" };
  assert("V1 rechazado classify", classifyBackup(v1).kind === "v1");
  let v1Restore = null;
  try {
    await restoreBackup(v1, { confirmed: true, alreadyProtected: true });
  } catch (e) { v1Restore = e.message; }
  assert("V1 restore bloqueado", typeof v1Restore === "string" && v1Restore.includes("Journal V1"));

  const broken = parseBackupText("{no-json");
  assert("JSON roto rechazado", broken.ok === false && broken.kind === "broken");
  assert("formato desconocido", classifyBackup({ foo: 1 }).kind === "unknown");
  const future = clone(emptyV2());
  future.backupVersion = BACKUP_VERSION + 1;
  assert("versión futura rechazada", classifyBackup(future).kind === "future");
  let futureRestore = null;
  try {
    await restoreBackup(future, { confirmed: true, alreadyProtected: true });
  } catch (e) { futureRestore = e.message; }
  assert("future no se restaura", typeof futureRestore === "string" && futureRestore.includes("futura"));

  const missingStore = clone(emptyV2());
  delete missingStore.trades;
  const missingReport = validateBackup(missingStore);
  assert("store faltante", missingReport.ok === false && missingReport.errors.some((m) => m.includes("trades")));

  const dup = clone(emptyV2());
  dup.stages.push({ ...dup.stages[0] });
  const dupReport = validateBackup(dup);
  assert("ID duplicado", dupReport.ok === false && dupReport.errors.some((m) => m.includes("duplicado")));

  const brokenFk = clone(richV2());
  brokenFk.trades[0].setupId = "no-existe";
  const fkReport = validateBackup(brokenFk);
  assert("FK rota", fkReport.ok === false && fkReport.errors.some((m) => m.includes("Setup")));

  const badEnum = clone(richV2());
  badEnum.trades[0].lifecycle = "WEIRD";
  const enumReport = validateBackup(badEnum);
  assert("enum inválido", enumReport.ok === false && enumReport.errors.some((m) => m.toLowerCase().includes("lifecycle")));

  const beforePreview = await snapshotIds();
  const preview = previewBackupText(JSON.stringify(richV2()), "rich.json");
  const afterPreview = await snapshotIds();
  assert("preview no modifica DB", JSON.stringify(beforePreview.ids) === JSON.stringify(afterPreview.ids));
  assert("preview válido", preview.ok === true && preview.wrote === false);
  assert("preview counts trades", preview.counts.trades === 3);
  assert("preview file", preview.fileName === "rich.json");

  const beforeCancel = await snapshotIds();
  let cancelMsg = null;
  try {
    await restoreBackup(richV2(), { confirmed: false, alreadyProtected: true });
  } catch (e) { cancelMsg = e.message; }
  const afterCancel = await snapshotIds();
  assert("cancel restore no modifica DB", JSON.stringify(beforeCancel.ids) === JSON.stringify(afterCancel.ids));
  assert("cancel exige confirmación", typeof cancelMsg === "string" && cancelMsg.includes("confirmación"));

  const markerId = "00000000-0000-4000-8000-00000000c12a";
  await repoFor("observations").put({
    id: markerId,
    stageId: (await getMeta()).activeStageId,
    asset: "EURUSD",
    note: "MARKER-SLICE12",
    date: "2026-08-28",
  });
  assert("marker escrito", Boolean(await repoFor("observations").get(markerId)));

  const pre = await downloadCurrentBackup();
  assert("backup previo payload", Boolean(pre && pre.payload && pre.filename && pre.filename.startsWith("journal-v2-pre-restore-")));
  assert("backup previo filename", pre.filename.endsWith(".json"));

  await restoreBackup(richV2(), { confirmed: true, alreadyProtected: true, fileName: "rich.json" });
  const afterRich = await snapshotIds();
  assert("restore válido", afterRich.meta && afterRich.meta.activeStageId === STAGE);
  assert("reemplazo no merge", (await repoFor("observations").get(markerId)) == null);
  assert("Stage activa restaurada", (await listStages()).some((s) => s.id === STAGE && s.status === "ACTIVE"));
  assert("activeAccount restaurada", afterRich.meta.activeAccountId === ACC);
  const live = afterRich.collections.trades.find((t) => t.id === TRADE_LIVE);
  assert("Trade ↔ Account", live && live.accountId === ACC);
  const acc = afterRich.collections.accounts.find((a) => a.id === ACC);
  assert("Challenge ↔ Account", acc && acc.challengeId === CH);
  const asr = afterRich.collections.asrs[0];
  assert("ASR ↔ Trade", asr && asr.tradeId === TRADE_LIVE);
  const sig = afterRich.collections.signals[0];
  assert("Signal relations", sig && sig.setupId === SETUP && sig.tradeId === TRADE_LIVE);
  const voided = afterRich.collections.trades.find((t) => t.id === TRADE_VOID);
  const archivedObs = afterRich.collections.observations.find((o) => o.id === OBS);
  assert("VOID preservado", voided && voided.lifecycle === "VOID" && voided.voidReason === "TEST");
  assert("archive preservado", archivedObs && archivedObs.archived === true);
  assert("sourceRef RGM preservado", sig && sig.sourceRef && sig.sourceRef.rgmSignalId === "rgm-12");
  assert("sourceRef MT5 preservado", live && live.sourceRef && live.sourceRef.mt5Position === "9001");
  assert("importBatchId preservado", live && live.importBatchId === "batch-mt5-12");
  assert("attachments preservado", afterRich.collections.attachments.some((a) => a.id === ATT));

  const emptyReport = validateBackup(emptyV2());
  assert("empty V2 válido", emptyReport.ok === true, emptyReport.errors.join(" | "));
  await restoreBackup(emptyV2(), { confirmed: true, alreadyProtected: true });
  const afterEmpty = await snapshotIds();
  assert("empty restore stages=1", afterEmpty.ids.stages.length === 1 && afterEmpty.ids.stages[0] === STAGE_EMPTY);
  assert("empty restore trades=0", afterEmpty.ids.trades.length === 0);
  assert("empty activeAccount null", afterEmpty.meta.activeAccountId == null);
  assert("empty attachments 0", (await attachmentsRepo.count()) === 0);

  await restoreBackup(richV2(), { confirmed: true, alreadyProtected: true });
  const exportedAfter = await buildExportPayload();
  const original = richV2();
  let semantic = true;
  for (const name of EXPORT_COLLECTIONS) {
    const a = (exportedAfter[name] || []).map((r) => r.id).sort();
    const b = (original[name] || []).map((r) => r.id).sort();
    if (JSON.stringify(a) !== JSON.stringify(b)) semantic = false;
  }
  assert("export posterior equivalente", semantic
    && exportedAfter.meta.activeStageId === original.meta.activeStageId
    && exportedAfter.meta.activeAccountId === original.meta.activeAccountId);

  const beforeAtomic = await snapshotIds();
  const sabotage = clone(richV2());
  sabotage.attachments[0].id = { bad: true };
  let atomicErr = null;
  try {
    await applyRestoreTransaction(sabotage);
  } catch (e) { atomicErr = e; }
  const afterAtomic = await snapshotIds();
  assert("atomicidad lanza", Boolean(atomicErr));
  assert("atomicidad rollback", JSON.stringify(beforeAtomic.ids) === JSON.stringify(afterAtomic.ids));
  assert("atomicidad conserva live", Boolean(await repoFor("trades").get(TRADE_LIVE)));

  const failed = results.filter((r) => !r.ok);
  const host = document.getElementById("out");
  if (host) {
    const prev = host.textContent ? host.textContent + "\n" : "";
    const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
    lines.push("");
    lines.push(failed.length ? `slice12 ${failed.length} fallos` : `slice12 ${results.length} tests OK`);
    host.textContent = prev + lines.join("\n");
    if (failed.length) host.className = "fail";
  }
  console.log(results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}`).join("\n"));
  if (failed.length) throw new Error(`${failed.length} tests slice12 fallaron`);
}

export { run };
