import { ensureJournalSeed } from "../js/domain/stage.js";
import { renderHoy } from "../js/ui/screens/hoy.js";
import { greetingLine } from "../js/ui/identity.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
  if (!cond) console.error("FAIL", name, detail);
}

function flatten(nodes) {
  const host = document.createElement("div");
  host.append(...[].concat(nodes).filter(Boolean));
  return host;
}

async function run() {
  const seed = await ensureJournalSeed();
  const nodes = await renderHoy(seed);
  const host = flatten(nodes);
  const text = host.textContent || "";
  const greet = greetingLine(seed.meta);

  assert("Hoy renderiza escritorio", Boolean(host.querySelector(".hoy-desk")) && Boolean(host.querySelector(".hoy-ident")) && Boolean(host.querySelector(".hoy-day")));
  assert("kicker Trading Office", Boolean(host.querySelector(".kicker") && host.querySelector(".kicker").textContent === "Trading Office"));
  assert("saludo contextual", text.includes(greet) && /Buen (día|as tardes|as noches)/.test(greet));
  assert("muestra etapa", text.includes("Etapa ") && Boolean(seed.stage && seed.stage.name && text.includes(seed.stage.name)));
  assert("sin cuenta no inventa balance", !text.includes("Abrir Cuentas") && !text.includes("Todavía no hay una cuenta activa."));
  assert("columna Trading Hoy", text.includes("Trading Hoy"));
  assert("columna Mi Día", text.includes("Mi Día"));
  assert("empty abiertas honesto", text.includes("No hay operaciones Real abiertas."));
  assert("no pinta cierres ficticios", !text.includes("Cierres de hoy"));
  assert("no pinta ideas ficticias", !text.includes("Ideas en seguimiento"));
  assert("no pinta señales ficticias", !text.includes("Señales de hoy"));
  assert("tareas vacías", text.includes("No tenés tareas pendientes."));
  assert("no olvidar vacío", text.includes("Nada anotado por ahora."));
  assert("accesos vacíos", text.includes("Todavía no configuraste accesos rápidos."));
  assert("mini calendario del mes", Boolean(host.querySelector(".cal-grid")) && host.querySelectorAll(".cal-day.is-today").length === 1);
  const choices = [...host.querySelectorAll("button.choice")];
  const labels = choices.map((b) => (b.querySelector("strong") || {}).textContent);
  assert("atajos Nota Idea Operación", labels.includes("Nota") && labels.includes("Idea") && labels.includes("Operación"));
  const orig = location.hash;
  const clicks = [];
  choices.forEach((btn) => {
    btn.click();
    clicks.push(location.hash);
  });
  location.hash = orig;
  assert("Nota abre nuevo/observacion", clicks.includes("#/nuevo/observacion"));
  assert("Idea abre nuevo/setup", clicks.includes("#/nuevo/setup"));
  assert("Operación abre nuevo/trade", clicks.includes("#/nuevo/trade"));
  assert("resto de Mi Día sin CRUD", host.querySelectorAll(".hoy-day .office-card:not(.office-tasks):not(.office-notes):not(.office-cal) input, .hoy-day .office-card:not(.office-tasks):not(.office-notes):not(.office-cal) textarea, .hoy-day .office-card:not(.office-tasks):not(.office-notes):not(.office-cal) select").length === 0);
  assert("No olvidar tiene composer", Boolean(host.querySelector(".office-notes .note-input")));
  assert("calendario tiene días clicables", host.querySelectorAll("button.cal-day[data-ymd]").length > 0);
  assert("Calendario tiene alta rápida", Boolean(host.querySelector(".office-cal .cal-title-input")));
  assert("Tareas tiene alta rápida", Boolean(host.querySelector(".office-tasks .task-input")));

  const failed = results.filter((r) => !r.ok);
  const hostOut = document.getElementById("out");
  if (hostOut) {
    const prev = hostOut.textContent ? hostOut.textContent + "\n" : "";
    const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
    lines.push("");
    lines.push(failed.length ? `slice14 ${failed.length} fallos` : `slice14 ${results.length} tests OK`);
    hostOut.textContent = prev + lines.join("\n");
    if (failed.length) hostOut.className = "fail";
  }
  console.log(results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}`).join("\n"));
  if (failed.length) throw new Error(`${failed.length} tests slice14 fallaron`);
}

export { run };
