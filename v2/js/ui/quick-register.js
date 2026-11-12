import { el } from "./render.js";
import { go } from "./router.js";

export function quickRegister() {
  return el("nav", { className: "row-actions", "aria-label": "Carga rápida" }, [
    ["Estudio / NO TRADE", "nuevo/estudio"],
    ["Trade simulado", "nuevo/trade?mode=simulated&context=BACKTEST"],
    ["Trade real", "nuevo/trade?mode=real"],
  ].map(([text, route]) => el("button", { type: "button", text, onclick: () => go(route) })));
}
