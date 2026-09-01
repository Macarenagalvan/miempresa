import { ensureJournalSeed } from "../js/domain/stage.js";
import {
  addOfficeNote,
  updateOfficeNote,
  archiveOfficeNote,
  listHoyNotes,
  assertOfficeNote,
  createOfficeNote,
} from "../js/domain/office-note.js";
import { listOfficeNotes } from "../js/storage/repos/office-notes.js";
import { listObservations } from "../js/storage/repos/observations.js";
import { countCollection } from "../js/storage/repos/collections.js";
import { createObservation } from "../js/domain/observation.js";
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
  const startCount = await countCollection("officeNotes");
  assert("clean-ish start medible", Number.isFinite(startCount));

  let threw = false;
  try { await addOfficeNote({ text: "   " }); } catch (e) {
    threw = /text/.test(e.message);
  }
  assert("text obligatorio", threw);

  const created = await addOfficeNote({ text: "Preguntar al veterinario por las vacunas" });
  assert("crea note", created && created.text === "Preguntar al veterinario por las vacunas");
  assert("nace activa", created.archivedAt == null);
  assert("sin stageId", !Object.prototype.hasOwnProperty.call(created, "stageId") || created.stageId == null);
  assertOfficeNote(created);

  const multi = await addOfficeNote({ text: "Comprar barniz\nen OBI" });
  assert("multiline persistido", multi.text === "Comprar barniz\nen OBI");

  const listed = await listHoyNotes();
  assert("lista activas incluye altas", listed.some((n) => n.id === created.id) && listed.some((n) => n.id === multi.id));

  const beforeEdit = created.updatedAt;
  const edited = await updateOfficeNote(created.id, { text: "Preguntar al vet por las vacunas" });
  assert("edita texto", edited.text === "Preguntar al vet por las vacunas");
  assert("updatedAt cambia", edited.updatedAt !== beforeEdit && edited.createdAt === created.createdAt);

  const archived = await archiveOfficeNote(created.id);
  assert("archivar setea archivedAt", Boolean(archived.archivedAt));
  const afterArch = await listHoyNotes();
  assert("archivada fuera de Hoy", !afterArch.some((n) => n.id === created.id));
  const stored = (await listOfficeNotes()).some((n) => n.id === created.id);
  assert("archivada permanece en store", stored);

  threw = false;
  try {
    createOfficeNote({ text: "x", stageId: "nope" });
    const bad = { ...created, stageId: "nope", text: "x", archivedAt: null };
    assertOfficeNote(bad);
  } catch (e) {
    threw = /stageId/.test(e.message);
  }
  assert("rechaza stageId", threw);

  const seed = await ensureJournalSeed();
  const obsBefore = (await listObservations()).length;
  await createObservation({ asset: "EURUSD", note: "pullback lento" }, seed.stage.id);
  const obsAfter = await listObservations();
  const notesAfterObs = await listOfficeNotes();
  assert("AssetObservation no entra a officeNotes", !notesAfterObs.some((n) => n.text === "pullback lento"));
  assert("OfficeNote no entra a observations", !obsAfter.some((o) => o.note === "Comprar barniz\nen OBI"));
  assert("observations creció aparte", obsAfter.length === obsBefore + 1);

  const payload = await buildExportPayload();
  assert("export preserva notes", Array.isArray(payload.officeNotes) && payload.officeNotes.some((n) => n.id === multi.id));

  const snap = emptyV2();
  snap.officeTasks = [];
  snap.officeNotes = [{
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeen01",
    text: "restore-note",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    archivedAt: null,
  }];
  snap.officeEvents = [];
  snap.officeShortcuts = [];
  const ok2 = validateBackup(snap);
  assert("backup schema 2 con note válido", ok2.ok === true, (ok2.errors || []).join(" | "));
  await restoreBackup(snap, { confirmed: true, alreadyProtected: true });
  const restored = await listHoyNotes();
  assert("restore schema 2 restaura notes", restored.some((n) => n.text === "restore-note"));

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
  assert("restore schema 1 deja notes vacías", (await countCollection("officeNotes")) === 0);

  const before = compute([], { universe: "BACKTEST" });
  await addOfficeNote({ text: "no-stats" });
  const after = compute([], { universe: "BACKTEST" });
  assert("stats WR intacto", before.winRate === after.winRate);
  assert("stats netPnl intacto", before.netPnl === after.netPnl);

  const seeded = await ensureJournalSeed();
  const host = document.createElement("div");
  host.append(...[].concat(await renderHoy(seeded)).filter(Boolean));
  assert("Hoy muestra composer notas", Boolean(host.querySelector(".note-input")));
  assert("placeholder humano", host.querySelector(".note-input").getAttribute("placeholder") === "Anotá algo para no olvidarte…");
  assert("acción Guardar", Boolean(host.querySelector(".note-add") && host.querySelector(".note-add").textContent === "Guardar"));

  const failed = results.filter((r) => !r.ok);
  const hostOut = document.getElementById("out");
  if (hostOut) {
    const prev = hostOut.textContent ? hostOut.textContent + "\n" : "";
    const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
    lines.push("");
    lines.push(failed.length ? `slice16 ${failed.length} fallos` : `slice16 ${results.length} tests OK`);
    hostOut.textContent = prev + lines.join("\n");
    if (failed.length) hostOut.className = "fail";
  }
  console.log(results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}`).join("\n"));
  if (failed.length) throw new Error(`${failed.length} tests slice16 fallaron`);
}

export { run };
