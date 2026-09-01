import { ensureJournalSeed } from "../js/domain/stage.js";
import {
  addOfficeTask,
  updateOfficeTask,
  completeOfficeTask,
  reopenOfficeTask,
  archiveOfficeTask,
  listHoyTasks,
  assertOfficeTask,
  createOfficeTask,
} from "../js/domain/office-task.js";
import { listOfficeTasks } from "../js/storage/repos/office-tasks.js";
import { countCollection } from "../js/storage/repos/collections.js";
import {
  buildExportPayload,
  validateBackup,
  restoreBackup,
} from "../js/services/backup.js";
import { compute } from "../js/domain/stats.js";
import { emptyV2, STAGE_EMPTY } from "./slice12.payloads.js";
import { renderHoy } from "../js/ui/screens/hoy.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
  if (!cond) console.error("FAIL", name, detail);
}

async function run() {
  await ensureJournalSeed();
  const startCount = await countCollection("officeTasks");
  assert("clean-ish start medible", Number.isFinite(startCount));

  let threw = false;
  try { await addOfficeTask({ text: "   " }); } catch (e) {
    threw = /text/.test(e.message);
  }
  assert("text obligatorio", threw);

  const created = await addOfficeTask({ text: "Llamar al veterinario" });
  assert("crea task", created && created.text === "Llamar al veterinario");
  assert("dueDate opcional null", created.dueDate == null);
  assert("nace pendiente", created.done === false && created.completedAt == null && created.archivedAt == null);
  assert("sin stageId", !Object.prototype.hasOwnProperty.call(created, "stageId") || created.stageId == null);
  assertOfficeTask(created);

  const listed = await listHoyTasks();
  assert("lista pendientes incluye alta", listed.pending.some((t) => t.id === created.id));

  const dated = await addOfficeTask({ text: "Pagar luz", dueDate: listed.today });
  assert("dueDate hoy persistida", dated.dueDate === listed.today);

  const edited = await updateOfficeTask(created.id, { text: "Llamar al vet", dueDate: "2026-08-01" });
  assert("edita texto", edited.text === "Llamar al vet");
  assert("edita dueDate", edited.dueDate === "2026-08-01");

  const done = await completeOfficeTask(created.id);
  assert("completar done", done.done === true);
  assert("completar completedAt", typeof done.completedAt === "string" && done.completedAt.includes("T"));
  const afterDone = await listHoyTasks();
  assert("completada no está en pendientes", !afterDone.pending.some((t) => t.id === created.id));
  assert("completada hoy visible", afterDone.doneToday.some((t) => t.id === created.id));

  const reopened = await reopenOfficeTask(created.id);
  assert("reabrir quita done", reopened.done === false && reopened.completedAt == null);
  const afterOpen = await listHoyTasks();
  assert("reabierta vuelve a pendientes", afterOpen.pending.some((t) => t.id === created.id));

  const archived = await archiveOfficeTask(created.id);
  assert("archivar setea archivedAt", Boolean(archived.archivedAt));
  const afterArch = await listHoyTasks();
  assert("archivada fuera de Hoy", !afterArch.pending.some((t) => t.id === created.id) && !afterArch.doneToday.some((t) => t.id === created.id));
  const stored = (await listOfficeTasks()).some((t) => t.id === created.id);
  assert("archivada permanece en store", stored);

  threw = false;
  try {
    createOfficeTask({ text: "x", stageId: "nope" });
    const bad = { ...created, stageId: "nope", text: "x", done: false, completedAt: null };
    assertOfficeTask(bad);
  } catch (e) {
    threw = /stageId/.test(e.message);
  }
  assert("rechaza stageId", threw);

  const payload = await buildExportPayload();
  assert("export preserva tasks", Array.isArray(payload.officeTasks) && payload.officeTasks.some((t) => t.id === dated.id));

  const snap = emptyV2();
  snap.officeTasks = [{
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeet01",
    text: "restore-me",
    dueDate: null,
    done: false,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    completedAt: null,
    archivedAt: null,
  }];
  snap.officeNotes = [];
  snap.officeEvents = [];
  snap.officeShortcuts = [];
  const ok2 = validateBackup(snap);
  assert("backup schema 2 con task válido", ok2.ok === true, (ok2.errors || []).join(" | "));
  await restoreBackup(snap, { confirmed: true, alreadyProtected: true });
  const restored = await listHoyTasks();
  assert("restore schema 2 restaura tasks", restored.pending.some((t) => t.text === "restore-me"));

  const s1 = emptyV2();
  s1.schemaVersion = 1;
  s1.meta = { ...s1.meta, schemaVersion: 1 };
  delete s1.officeTasks;
  delete s1.officeNotes;
  delete s1.officeEvents;
  delete s1.officeShortcuts;
  s1.observations = [{
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeee001",
    stageId: STAGE_EMPTY,
    asset: "EURUSD",
    note: "keep",
    date: "2026-08-01",
  }];
  await restoreBackup(s1, { confirmed: true, alreadyProtected: true });
  assert("restore schema 1 deja tasks vacías", (await countCollection("officeTasks")) === 0);

  const before = compute([], { universe: "BACKTEST" });
  await addOfficeTask({ text: "no-stats" });
  const after = compute([], { universe: "BACKTEST" });
  assert("stats WR intacto", before.winRate === after.winRate);
  assert("stats netPnl intacto", before.netPnl === after.netPnl);

  const seed = await ensureJournalSeed();
  const host = document.createElement("div");
  host.append(...[].concat(await renderHoy(seed)).filter(Boolean));
  assert("Hoy muestra composer", Boolean(host.querySelector(".task-input")));
  assert("placeholder humano", host.querySelector(".task-input").getAttribute("placeholder") === "¿Qué tenés pendiente?");

  const failed = results.filter((r) => !r.ok);
  const hostOut = document.getElementById("out");
  if (hostOut) {
    const prev = hostOut.textContent ? hostOut.textContent + "\n" : "";
    const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
    lines.push("");
    lines.push(failed.length ? `slice15 ${failed.length} fallos` : `slice15 ${results.length} tests OK`);
    hostOut.textContent = prev + lines.join("\n");
    if (failed.length) hostOut.className = "fail";
  }
  console.log(results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}`).join("\n"));
  if (failed.length) throw new Error(`${failed.length} tests slice15 fallaron`);
}

export { run };
