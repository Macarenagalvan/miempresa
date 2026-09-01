import { ensureJournalSeed } from "../js/domain/stage.js";
import {
  addOfficeEvent,
  updateOfficeEvent,
  archiveOfficeEvent,
  listEventsOnDate,
  listMonthEventDates,
  assertOfficeEvent,
  createOfficeEvent,
} from "../js/domain/office-event.js";
import { listOfficeEvents } from "../js/storage/repos/office-events.js";
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
  const startCount = await countCollection("officeEvents");
  assert("clean-ish start medible", Number.isFinite(startCount));

  let threw = false;
  try { await addOfficeEvent({ title: "   ", date: "2026-09-08" }); } catch (e) {
    threw = /title/.test(e.message);
  }
  assert("title obligatorio", threw);

  threw = false;
  try { await addOfficeEvent({ title: "Veterinario" }); } catch (e) {
    threw = /date/.test(e.message);
  }
  assert("date obligatoria", threw);

  const created = await addOfficeEvent({ title: "Veterinario", date: "2026-09-08", time: "16:30" });
  assert("crea event", created && created.title === "Veterinario");
  assert("date persistida", created.date === "2026-09-08");
  assert("time opcional persistida", created.time === "16:30");
  assert("note opcional null", created.note == null);
  assert("nace activo", created.archivedAt == null);
  assert("sin stageId", !Object.prototype.hasOwnProperty.call(created, "stageId") || created.stageId == null);
  assertOfficeEvent(created);

  const untimed = await addOfficeEvent({ title: "Pasar por OBI", date: "2026-09-08", note: "Barniz" });
  assert("evento sin hora", untimed.time == null);
  assert("note persistida", untimed.note === "Barniz");

  const later = await addOfficeEvent({ title: "Cena", date: "2026-09-08", time: "20:00" });
  const day = await listEventsOnDate("2026-09-08");
  assert("varios eventos mismo día", day.length >= 3 && day.some((e) => e.id === created.id) && day.some((e) => e.id === untimed.id));
  const timed = day.filter((e) => e.time).map((e) => e.time);
  assert("ordenar por hora", timed.join(",") === "16:30,20:00" || (timed[0] === "16:30" && timed[timed.length - 1] === "20:00"));
  const lastUntimed = day.filter((e) => !e.time);
  assert("evento sin hora al final", lastUntimed.length >= 1 && day[day.length - 1].time == null);

  const other = await listEventsOnDate("2026-09-01");
  assert("listar por día no mezcla", !other.some((e) => e.id === created.id));

  const edited = await updateOfficeEvent(created.id, { title: "Vet", time: "17:00", note: "Libreta" });
  assert("edita title/time/note", edited.title === "Vet" && edited.time === "17:00" && edited.note === "Libreta");

  const moved = await updateOfficeEvent(created.id, { date: "2026-09-09" });
  assert("mover a otra fecha", moved.date === "2026-09-09");
  assert("sale del día original", !(await listEventsOnDate("2026-09-08")).some((e) => e.id === created.id));
  assert("entra al día nuevo", (await listEventsOnDate("2026-09-09")).some((e) => e.id === created.id));

  const sept = await listMonthEventDates(2026, 8);
  assert("mes correcto", sept.has("2026-09-08") && sept.has("2026-09-09"));
  const aug = await listMonthEventDates(2026, 7);
  const countBefore = await countCollection("officeEvents");
  assert("navegación mes no muta datos", aug.size === 0 && (await countCollection("officeEvents")) === countBefore);

  const archived = await archiveOfficeEvent(created.id);
  assert("archivar setea archivedAt", Boolean(archived.archivedAt));
  assert("archivado fuera de agenda", !(await listEventsOnDate("2026-09-09")).some((e) => e.id === created.id));
  assert("archivado permanece en store", (await listOfficeEvents()).some((e) => e.id === created.id));

  threw = false;
  try {
    createOfficeEvent({ title: "x", date: "2026-09-08", stageId: "nope" });
    const bad = { ...untimed, stageId: "nope" };
    assertOfficeEvent(bad);
  } catch (e) {
    threw = /stageId/.test(e.message);
  }
  assert("rechaza stageId", threw);

  const payload = await buildExportPayload();
  assert("export preserva events", Array.isArray(payload.officeEvents) && payload.officeEvents.some((e) => e.id === untimed.id));

  const snap = emptyV2();
  snap.officeTasks = [];
  snap.officeNotes = [];
  snap.officeEvents = [{
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeev01",
    title: "restore-event",
    date: "2026-09-08",
    time: "16:30",
    note: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    archivedAt: null,
  }];
  snap.officeShortcuts = [];
  const ok2 = validateBackup(snap);
  assert("backup schema 2 con event válido", ok2.ok === true, (ok2.errors || []).join(" | "));
  await restoreBackup(snap, { confirmed: true, alreadyProtected: true });
  assert("restore schema 2 restaura events", (await listEventsOnDate("2026-09-08")).some((e) => e.title === "restore-event"));

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
  assert("restore schema 1 deja events vacíos", (await countCollection("officeEvents")) === 0);

  const before = compute([], { universe: "BACKTEST" });
  await addOfficeEvent({ title: "no-stats", date: "2026-09-08" });
  const after = compute([], { universe: "BACKTEST" });
  assert("stats WR intacto", before.winRate === after.winRate);
  assert("stats netPnl intacto", before.netPnl === after.netPnl);

  const seeded = await ensureJournalSeed();
  const host = document.createElement("div");
  host.append(...[].concat(await renderHoy(seeded)).filter(Boolean));
  assert("Hoy muestra calendario", Boolean(host.querySelector(".office-cal .cal-grid")));
  assert("composer título", host.querySelector(".cal-title-input") && host.querySelector(".cal-title-input").getAttribute("placeholder") === "Qué / título");
  assert("nav mes", Boolean(host.querySelector(".cal-nav-btn")));

  const failed = results.filter((r) => !r.ok);
  const hostOut = document.getElementById("out");
  if (hostOut) {
    const prev = hostOut.textContent ? hostOut.textContent + "\n" : "";
    const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
    lines.push("");
    lines.push(failed.length ? `slice17 ${failed.length} fallos` : `slice17 ${results.length} tests OK`);
    hostOut.textContent = prev + lines.join("\n");
    if (failed.length) hostOut.className = "fail";
  }
  console.log(results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}`).join("\n"));
  if (failed.length) throw new Error(`${failed.length} tests slice17 fallaron`);
}

export { run };
