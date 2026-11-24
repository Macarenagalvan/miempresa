import { el } from "../render.js";
import { field } from "../forms/observation.js";
import { setupCoreFields, readCore } from "../forms/setup.js";
import { createSetup } from "../../domain/setup.js";
import { getObservation } from "../../storage/repos/observations.js";
import { go } from "../router.js";

export async function renderNuevoSetup(ctx) {
  const obsId = ctx.route.rest.startsWith("setup/") ? ctx.route.rest.slice("setup/".length) : "";
  const fromObs = obsId ? await getObservation(obsId) : null;
  const fields = setupCoreFields({
    asset: fromObs ? fromObs.asset : "EURUSD",
    context: fromObs ? fromObs.context : "BACKTEST",
    direction: "",
  });
  const err = el("p", { className: "err", text: "" });
  const save = el("button", { type: "button", text: "Guardar" });
  save.addEventListener("click", async () => {
    err.textContent = "";
    try {
      const core = readCore(fields);
      const setup = await createSetup({
        ...core,
        observationId: fromObs ? fromObs.id : null,
      }, ctx.stage.id);
      go("setup/" + setup.id);
    } catch (e) {
      err.textContent = e.message;
    }
  });

  return [
    el("section", { className: "panel form" }, [
      el("p", { className: "kicker", text: "Nueva idea" }),
      el("h1", { text: "Idea" }),
      fromObs
        ? el("p", { className: "meta", text: `Desde nota ${fromObs.asset} · ${fromObs.date}` })
        : el("p", { className: "meta", text: "Directo. Sin nota de origen." }),
      field("Asset", el("div", { className: "chips" }, [fields.asset, fields.other])),
      field("Context", fields.context),
      field("Direction", fields.direction),
      el("p", { className: "hint", text: "Nace WATCHING + UNCLASSIFIED. Evaluar viene después. Internamente es un Setup." }),
      err,
      save,
    ]),
  ];
}
