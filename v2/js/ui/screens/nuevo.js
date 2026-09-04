import { el } from "../render.js";
import { assetPicker, coreFields, field } from "../forms/observation.js";
import { createObservation, defaultObservationDate } from "../../domain/observation.js";
import { renderNuevoSetup } from "./setup-new.js";
import { renderNuevoTrade } from "./trade-new.js";
import { go } from "../router.js";
import { icon, ICONS } from "../identity.js";

function choice(title, line, path, pathIcon) {
  return el("button", { type: "button", className: "choice", onclick: () => go(path) }, [
    icon(pathIcon),
    el("strong", { text: title }),
    el("span", { text: line }),
  ]);
}

export async function renderNuevo(ctx) {
  if (ctx.route.rest === "observacion") return renderNuevaObservacion(ctx);
  if (ctx.route.rest === "setup" || ctx.route.rest.startsWith("setup/")) return renderNuevoSetup(ctx);
  if (ctx.route.rest === "trade" || ctx.route.rest.startsWith("trade/")) return renderNuevoTrade(ctx);
  return [
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: "Nuevo" }),
      el("h1", { text: "¿Qué querés registrar?" }),
      el("p", { className: "hint", text: "Tres entradas distintas. Ninguna abre un wizard." }),
      el("div", { className: "choice-grid" }, [
        choice("Nota", "Algo que vi o aprendí del mercado.", "nuevo/observacion", ICONS.note),
        choice("Idea", "Una oportunidad que estoy siguiendo.", "nuevo/setup", ICONS.idea),
        choice("Operación", "Un trade que ejecuté o quiero registrar.", "nuevo/trade", ICONS.trade),
      ]),
    ]),
  ];
}

function renderNuevaObservacion(ctx) {
  const state = { asset: "EURUSD" };
  const pickerHost = el("div");
  const cores = coreFields({ date: defaultObservationDate() });
  cores.note.value = "";

  function paintPicker() {
    pickerHost.replaceChildren(assetPicker(state.asset, (id) => {
      state.asset = id;
      paintPicker();
    }));
  }
  paintPicker();

  const err = el("p", { className: "err", text: "" });
  const save = el("button", { type: "button", text: "Guardar" });
  save.addEventListener("click", async () => {
    err.textContent = "";
    try {
      const obs = await createObservation({
        asset: state.asset,
        note: cores.note.value,
        date: cores.date.value,
      }, ctx.stage.id);
      go("observacion/" + obs.id);
    } catch (e) {
      err.textContent = e.message;
    }
  });

  return [
    el("section", { className: "panel form" }, [
      el("p", { className: "kicker", text: "Nueva nota" }),
      el("h1", { text: "Nota" }),
      el("p", { className: "hint", text: "Estudio. No crea una idea ni una operación." }),
      field("Asset", pickerHost),
      field("Fecha", cores.date),
      field("Nota", cores.note),
      err,
      save,
    ]),
  ];
}
