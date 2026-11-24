import { el } from "./render.js";
import { go } from "./router.js";

export function quickRegister() {
  return el("nav", { className: "row-actions", "aria-label": "Carga rápida" }, [
    ["Carga rápida de backtesting", "backtesting"],
    ["Trade demo", "nuevo/trade?mode=simulated&context=DEMO"],
    ["Trade real", "nuevo/trade?mode=real"],
  ].map(([text, route]) => el("button", { type: "button", text, onclick: () => go(route) })));
}
