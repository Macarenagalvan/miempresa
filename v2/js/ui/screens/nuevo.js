import { el } from "../render.js";
import { assetPicker, coreFields, field } from "../forms/observation.js";
import { createObservation, defaultObservationDate } from "../../domain/observation.js";
import { renderNuevoSetup } from "./setup-new.js";
import { renderNuevoTrade } from "./trade-new.js";
import { go } from "../router.js";

export async function renderNuevo(ctx) {
  if (ctx.route.rest === "observacion") return renderNuevaObservacion(ctx);
  if (ctx.route.rest === "setup" || ctx.route.rest.startsWith("setup/")) return renderNuevoSetup(ctx);
  if (ctx.route.rest === "trade" || ctx.route.rest.startsWith("trade/")) return renderNuevoTrade(ctx);
  return [
    el("section", { className: "panel form" }, [
      el("h1", { text: "Nuevo" }),
      el("p", { className: "meta", text: "¿Qué querés registrar?" }),
      el("div", { className: "stack" }, [
        el("button", { type: "button", text: "Observación", onclick: () => go("nuevo/observacion") }),
        el("button", { type: "button", text: "Setup", onclick: () => go("nuevo/setup") }),
        el("button", { type: "button", text: "Trade", onclick: () => go("nuevo/trade") }),
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
      el("p", { className: "kicker", text: "Nuevo" }),
      el("h1", { text: "Observación" }),
      field("Asset", pickerHost),
      field("Fecha", cores.date),
      field("Nota", cores.note),
      err,
      save,
    ]),
  ];
}
