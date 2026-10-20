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
  console.log("UX Backtesting: ruta, render y formulario aislado OK");
}
