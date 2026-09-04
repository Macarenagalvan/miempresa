import { ensureJournalSeed } from "../js/domain/stage.js";
import {
  addOfficeShortcut,
  updateOfficeShortcut,
  archiveOfficeShortcut,
  moveOfficeShortcut,
  listHoyShortcuts,
  assertOfficeShortcut,
  createOfficeShortcut,
  normalizeShortcutUrl,
} from "../js/domain/office-shortcut.js";
import { listOfficeShortcuts } from "../js/storage/repos/office-shortcuts.js";
import { countCollection } from "../js/storage/repos/collections.js";
import {
  buildExportPayload,
  validateBackup,
  restoreBackup,
} from "../js/services/backup.js";
import { compute } from "../js/domain/stats.js";
import { emptyV2, STAGE_EMPTY } from "./slice12.payloads.js";
import { renderHoy } from "../js/ui/screens/hoy.js";
import { renderSistema } from "../js/ui/screens/sistema.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
  if (!cond) console.error("FAIL", name, detail);
}

async function run() {
  await ensureJournalSeed();
  const startCount = await countCollection("officeShortcuts");
  assert("clean-ish start medible", Number.isFinite(startCount));

  let threw = false;
  try { await addOfficeShortcut({ label: "   ", url: "https://www.tradingview.com/" }); } catch (e) {
    threw = /label/.test(e.message);
  }
  assert("label obligatorio", threw);

  threw = false;
  try { await addOfficeShortcut({ label: "TV" }); } catch (e) {
    threw = /url/.test(e.message);
  }
  assert("url obligatoria", threw);

  threw = false;
  try { normalizeShortcutUrl("localhost:8080"); } catch (e) {
    threw = /http:\/\/ o https:\/\//.test(e.message);
  }
  assert("localhost sin esquema se rechaza con pista", threw);

  threw = false;
  try { await addOfficeShortcut({ label: "x", url: "javascript:alert(1)" }); } catch (e) {
    threw = /url/.test(e.message);
  }
  assert("javascript rechazado", threw);

  threw = false;
  try { await addOfficeShortcut({ label: "x", url: "data:text/html,hi" }); } catch (e) {
    threw = /url/.test(e.message);
  }
  assert("data rechazado", threw);

  const httpsOk = await addOfficeShortcut({ label: "TradingView", url: "https://www.tradingview.com/" });
  assert("https válido", httpsOk && httpsOk.url === "https://www.tradingview.com/");
  assert("nace activo", httpsOk.archivedAt == null);
  assert("sin stageId", !Object.prototype.hasOwnProperty.call(httpsOk, "stageId") || httpsOk.stageId == null);
  assertOfficeShortcut(httpsOk);

  const httpOk = await addOfficeShortcut({ label: "RGM Desk", url: "http://localhost:8080" });
  assert("http local válido", httpOk.url === "http://localhost:8080");

  const listed = await listHoyShortcuts();
  assert("lista activas incluye altas", listed.some((s) => s.id === httpsOk.id) && listed.some((s) => s.id === httpOk.id));
  assert("orden de alta", listed.findIndex((s) => s.id === httpsOk.id) < listed.findIndex((s) => s.id === httpOk.id));

  await moveOfficeShortcut(httpOk.id, "up");
  const afterUp = await listHoyShortcuts();
  assert("subir cambia orden", afterUp[0].id === httpOk.id && afterUp[1].id === httpsOk.id);

  await moveOfficeShortcut(httpOk.id, "down");
  const afterDown = await listHoyShortcuts();
  assert("bajar restaura orden", afterDown[0].id === httpsOk.id && afterDown[1].id === httpOk.id);

  const edited = await updateOfficeShortcut(httpsOk.id, { label: "TV", url: "https://www.tradingview.com/chart/" });
  assert("edita label/url", edited.label === "TV" && edited.url === "https://www.tradingview.com/chart/");

  const archived = await archiveOfficeShortcut(httpsOk.id);
  assert("archivar setea archivedAt", Boolean(archived.archivedAt));
  assert("archivado fuera de Hoy", !(await listHoyShortcuts()).some((s) => s.id === httpsOk.id));
  assert("archivado permanece en store", (await listOfficeShortcuts()).some((s) => s.id === httpsOk.id));

  threw = false;
  try {
    createOfficeShortcut({ label: "x", url: "https://example.com", stageId: "nope" });
    const bad = { ...httpOk, stageId: "nope" };
    assertOfficeShortcut(bad);
  } catch (e) {
    threw = /stageId/.test(e.message);
  }
  assert("rechaza stageId", threw);

  const payload = await buildExportPayload();
  assert("export preserva shortcuts", Array.isArray(payload.officeShortcuts) && payload.officeShortcuts.some((s) => s.id === httpOk.id));

  const snap = emptyV2();
  snap.officeTasks = [];
  snap.officeNotes = [];
  snap.officeEvents = [];
  snap.officeShortcuts = [{
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeees01",
    label: "restore-tv",
    url: "https://www.tradingview.com/",
    order: 0,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    archivedAt: null,
  }];
  const ok2 = validateBackup(snap);
  assert("backup schema 2 con shortcut válido", ok2.ok === true, (ok2.errors || []).join(" | "));
  await restoreBackup(snap, { confirmed: true, alreadyProtected: true });
  assert("restore schema 2 restaura shortcuts", (await listHoyShortcuts()).some((s) => s.label === "restore-tv"));

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
  assert("restore schema 1 deja shortcuts vacíos", (await countCollection("officeShortcuts")) === 0);

  const before = compute([], { universe: "BACKTEST" });
  await addOfficeShortcut({ label: "no-stats", url: "https://example.com" });
  const after = compute([], { universe: "BACKTEST" });
  assert("stats WR intacto", before.winRate === after.winRate);
  assert("stats netPnl intacto", before.netPnl === after.netPnl);

  const seeded = await ensureJournalSeed();
  const host = document.createElement("div");
  host.append(...[].concat(await renderHoy(seeded)).filter(Boolean));
  const chip = host.querySelector("a.shortcut-chip");
  assert("Hoy muestra chip", Boolean(chip) && chip.textContent.includes("no-stats"));
  assert("chip target blank", chip && chip.getAttribute("target") === "_blank");
  assert("chip rel seguro", chip && chip.getAttribute("rel") === "noopener noreferrer");
  assert("Hoy no edita URL", host.querySelectorAll(".office-shortcuts input").length === 0);

  const sys = document.createElement("div");
  sys.append(...[].concat(await renderSistema(seeded)).filter(Boolean));
  assert("Sistema tiene Oficina", Boolean(sys.querySelector("#oficina.office-sistema")));
  assert("Sistema tiene alta", Boolean(sys.querySelector(".shortcut-label") && sys.querySelector(".shortcut-url")));

  const failed = results.filter((r) => !r.ok);
  const hostOut = document.getElementById("out");
  if (hostOut) {
    const prev = hostOut.textContent ? hostOut.textContent + "\n" : "";
    const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
    lines.push("");
    lines.push(failed.length ? `slice18 ${failed.length} fallos` : `slice18 ${results.length} tests OK`);
    hostOut.textContent = prev + lines.join("\n");
    if (failed.length) hostOut.className = "fail";
  }
  console.log(results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}`).join("\n"));
  if (failed.length) throw new Error(`${failed.length} tests slice18 fallaron`);
}

export { run };
