import { el } from "../render.js";
import { assetPicker, coreFields, field } from "../forms/observation.js";
import { createObservation, defaultObservationDate } from "../../domain/observation.js";
import { go } from "../router.js";

export function renderNuevo(ctx) {
  if (ctx.route.rest === "observacion") return renderNuevaObservacion(ctx);
  return [
    el("section", { className: "panel" }, [
      el("h1", { text: "Nuevo" }),
      el("p", { className: "meta", text: "¿Qué querés registrar?" }),
      el("div", { className: "stack" }, [
        el("button", { type: "button", text: "Observación", onclick: () => go("nuevo/observacion") }),
        el("p", { className: "hint", text: "Setup y Trade llegan en slices posteriores." }),
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
    el("section", { className: "panel" }, [
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
