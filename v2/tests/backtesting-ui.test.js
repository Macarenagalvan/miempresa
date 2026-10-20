import { ensureJournalSeed } from "../js/domain/stage.js";
import { renderBacktesting } from "../js/ui/screens/backtesting.js";
import { renderNuevoTrade } from "../js/ui/screens/trade-new.js";
import { routeList } from "../js/ui/router.js";

function intoHost(nodes) {
  const host = document.createElement("div");
  host.append(...[].concat(nodes).filter(Boolean));
  return host;
}

export async function run() {
  const seed = await ensureJournalSeed();
  const page = intoHost(await renderBacktesting({
    ...seed, route: { name: "backtesting", rest: "", query: {} },
  }));
  if (!routeList().backtesting) throw new Error("Falta ruta Backtesting");
  if (!page.querySelector("h1") || page.querySelector("h1").textContent !== "Backtesting") {
    throw new Error("Falta pantalla Backtesting");
  }
  if (![...page.querySelectorAll("button")].some((b) => /Registrar backtest|Nuevo backtest/.test(b.textContent))) {
    throw new Error("Falta acción de registro histórico");
  }

  const form = intoHost(await renderNuevoTrade({
    ...seed, route: { name: "nuevo", rest: "trade", query: { context: "BACKTEST" } },
  }));
  const context = [...form.querySelectorAll("select")].find((node) =>
    [...node.options].some((option) => option.value === "BACKTEST")
    && [...node.options].some((option) => option.value === "LIVE"));
  if (!context || context.value !== "BACKTEST" || !context.disabled) {
    throw new Error("El registro dedicado no fija BACKTEST");
  }
  const status = form.querySelector('select[name="lifecycle"]');
  if (!status || status.value !== "CLOSED") {
    throw new Error("El registro histórico debe empezar como cerrado");
  }
  if (!form.querySelector(".trade-form .trade-fields-grid") || !form.querySelector("details.trade-extra")) {
    throw new Error("El formulario debe agrupar campos y plegar los secundarios");
  }
  const result = form.querySelector(".trade-result");
  if (!result || result.hidden) throw new Error("Un backtest cerrado debe mostrar su resultado");
  const account = [...form.querySelectorAll("label.field")].find((label) =>
    label.textContent.trim().startsWith("Cuenta"));
  if (!account || !account.hidden) throw new Error("Backtesting no debe pedir una cuenta");
  if (form.querySelector('input[name="openedAt"]').type !== "datetime-local") {
    throw new Error("La entrada debe usar selector de fecha y hora local");
  }
  const capturedBefore = form.querySelector('input[name="capture-before"]');
  const capturedAfter = form.querySelector('input[name="capture-after"]');
  if (!capturedBefore || !capturedAfter || !capturedBefore.multiple || !capturedAfter.multiple) {
    throw new Error("El registro debe permitir múltiples capturas Antes y Después");
  }
  if (form.querySelector('input[name="openedAt"]').value !== "") {
    throw new Error("Backtesting debe pedir la fecha histórica sin inventar la actual");
  }
  const entry = form.querySelector('input[name="entry"]');
  const sl = form.querySelector('input[name="initialSL"]');
  const tp = form.querySelector('input[name="tp"]');
  const exit = form.querySelector('input[name="exit"]');
  for (const [input, value] of [[entry, "200"], [sl, "195"], [tp, "210"], [exit, "205"]]) {
    input.value = value;
    input.dispatchEvent(new Event("input"));
  }
  const preview = form.querySelector(".trade-rr-preview");
  if (!preview || !preview.textContent.includes("2.00R") || !preview.textContent.includes("1.00R")) {
    throw new Error("Falla la vista previa 2R planificado / 1R realizado");
  }
  const contextField = [...form.querySelectorAll("label.field")].find((label) => label.textContent.trim().startsWith("Contexto"));
  if (!contextField || !contextField.hidden) throw new Error("Contexto BACKTEST no debe ocupar espacio");
  status.value = "OPEN";
  status.dispatchEvent(new Event("change"));
  if (!result.hidden) throw new Error("Un registro OPEN no debe pedir resultado final");
  console.log("UX Backtesting: ruta, render, formulario agrupado y estado CLOSED/OPEN OK");
}
