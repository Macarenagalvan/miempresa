import { getObservation } from "../../storage/repos/observations.js";
import { updateObservation, archiveObservation } from "../../domain/observation.js";
import { el } from "../render.js";
import { assetPicker, coreFields, optionalFields, field } from "../forms/observation.js";
import { go } from "../router.js";

export async function renderObservationDetail(ctx) {
  const id = ctx.route.rest;
  const obs = id ? await getObservation(id) : null;
  if (!obs || obs.archived) {
    return [el("section", { className: "panel" }, [el("p", { className: "empty", text: "Nota no encontrada." })])];
  }

  const state = { asset: obs.asset };
  const pickerHost = el("div");
  const cores = coreFields({ date: obs.date });
  cores.note.value = obs.note;
  const optionals = optionalFields(obs);
  const err = el("p", { className: "err", text: "" });

  function paintPicker() {
    pickerHost.replaceChildren(assetPicker(state.asset, (id) => {
      state.asset = id;
      paintPicker();
    }));
  }
  paintPicker();

  const save = el("button", { type: "button", text: "Guardar cambios" });
  save.addEventListener("click", async () => {
    err.textContent = "";
    try {
      await updateObservation(obs.id, {
        asset: state.asset,
        date: cores.date.value,
        note: cores.note.value,
        ...optionals.read(),
      });
      go("estudio/" + state.asset);
    } catch (e) {
      err.textContent = e.message;
    }
  });

  const archive = el("button", { type: "button", className: "ghost", text: "Archivar" });
  archive.addEventListener("click", async () => {
    await archiveObservation(obs.id);
    go("estudio");
  });

  return [
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: "Nota · Estudio" }),
      el("h1", { text: obs.asset }),
      field("Asset", pickerHost),
      field("Fecha", cores.date),
      field("Nota", cores.note),
      el("h2", { text: "Completar análisis" }),
      ...optionals.nodes,
      err,
      el("div", { className: "row-actions" }, [
        save,
        el("button", { type: "button", text: "Crear Setup", onclick: () => go("nuevo/setup/" + obs.id) }),
        archive,
      ]),
    ]),
  ];
}
