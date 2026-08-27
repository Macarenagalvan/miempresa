import { el } from "../render.js";
import { getSetup } from "../../storage/repos/setups.js";
import { evaluateSetup, closeSetupStatus } from "../../domain/setup.js";
import { evaluateFields } from "../forms/setup.js";
import { go } from "../router.js";
import { SetupStatus } from "../../domain/enums.js";

export async function renderSetupDetail(ctx) {
  const evaluateMode = ctx.route.name === "setup" && ctx.route.rest.includes("/evaluar");
  const id = ctx.route.rest.replace(/\/evaluar$/, "");
  const setup = id ? await getSetup(id) : null;
  if (!setup) {
    return [el("section", { className: "panel" }, [el("p", { className: "empty", text: "Setup no encontrado." })])];
  }

  if (evaluateMode) return renderEvaluate(setup);

  const locked = Boolean(setup.validationLockedAt);
  const err = el("p", { className: "err", text: "" });
  const actions = [];
  if (!locked) {
    actions.push(el("button", { type: "button", text: "Evaluar setup", onclick: () => go("setup/" + setup.id + "/evaluar") }));
    actions.push(el("button", { type: "button", className: "ghost", text: "Descartar", onclick: async () => {
      try { await closeSetupStatus(setup.id, SetupStatus.DISCARDED); go("setup/" + setup.id); }
      catch (e) { err.textContent = e.message; }
    } }));
    actions.push(el("button", { type: "button", className: "ghost", text: "Expirar", onclick: async () => {
      try { await closeSetupStatus(setup.id, SetupStatus.EXPIRED); go("setup/" + setup.id); }
      catch (e) { err.textContent = e.message; }
    } }));
  }

  const origin = setup.observationId
    ? el("button", { type: "button", className: "ghost", text: "Ver Observation origen", onclick: () => go("observacion/" + setup.observationId) })
    : el("p", { className: "meta", text: "Sin Observation origen." });

  return [
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: setup.status }),
      el("h1", { text: `${setup.asset} ${setup.direction}` }),
      el("p", { className: "meta", text: `${setup.context} · ${setup.strategy} · ${setup.createdAt.slice(0, 10)}` }),
      setup.plannedRr != null ? el("p", { className: "meta", text: `plannedRR ${setup.plannedRr.toFixed(2)}` }) : null,
      setup.verdict ? el("p", { className: "meta", text: `verdict ${setup.verdict} · ${setup.validationMethod || "sin method"}` }) : el("p", { className: "meta", text: "Todavía no juzgado." }),
      locked ? el("p", { className: "hint", text: `Congelado ${setup.validationLockedAt}` }) : null,
      origin,
      err,
      el("div", { className: "row-actions" }, actions),
    ]),
  ];
}

function renderEvaluate(setup) {
  const form = evaluateFields(setup);
  const err = el("p", { className: "err", text: "" });
  const save = el("button", { type: "button", text: "Guardar evaluación" });
  save.addEventListener("click", async () => {
    err.textContent = "";
    try {
      await evaluateSetup(setup.id, form.read());
      go("setup/" + setup.id);
    } catch (e) {
      err.textContent = e.message;
    }
  });
  return [
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: "Evaluar setup" }),
      el("h1", { text: setup.asset }),
      el("p", { className: "hint", text: "Checklist fixture Slice 2. No es el Validator." }),
      ...form.nodes,
      err,
      save,
    ]),
  ];
}
