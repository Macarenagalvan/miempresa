import { el } from "../render.js";
import { field } from "../forms/observation.js";
import { getSetup } from "../../storage/repos/setups.js";
import { createTrade } from "../../domain/trade.js";
import { go } from "../router.js";
import { Context, Direction } from "../../domain/enums.js";
import { ROADMAP_ASSETS } from "../../config.js";

function select(values, current) {
  const node = el("select", { className: "input" }, values.map(([v, l]) => el("option", { value: v, text: l })));
  node.value = current || values[0][0];
  return node;
}

export async function renderNuevoTrade(ctx) {
  const setupId = ctx.route.rest.startsWith("trade/") ? ctx.route.rest.slice("trade/".length) : "";
  const setup = setupId ? await getSetup(setupId) : null;
  const asset = select(ROADMAP_ASSETS.map((a) => [a.id, a.label]), setup ? setup.asset : "EURUSD");
  const context = select([[Context.BACKTEST, Context.BACKTEST]], setup ? setup.context : Context.BACKTEST);
  const direction = select(Object.values(Direction).map((d) => [d, d]), setup ? setup.direction : Direction.LONG);
  const openedAt = el("input", { className: "input", value: new Date().toISOString().slice(0, 16) });
  const entry = el("input", { className: "input", value: "" });
  const sl = el("input", { className: "input", value: "" });
  const partials = select([["false", "No"], ["true", "Sí"]], "false");
  const err = el("p", { className: "err", text: "" });

  const save = el("button", { type: "button", text: "Guardar OPEN" });
  save.addEventListener("click", async () => {
    err.textContent = "";
    try {
      const trade = await createTrade({
        asset: asset.value,
        context: Context.BACKTEST,
        direction: direction.value,
        openedAt: openedAt.value ? new Date(openedAt.value).toISOString() : undefined,
        entry: entry.value,
        initialSL: sl.value,
        setupId: setup ? setup.id : null,
        hasPartials: partials.value === "true",
      }, ctx.stage.id);
      go("trade/" + trade.id);
    } catch (e) {
      err.textContent = e.message;
    }
  });

  const refs = [];
  if (setup) {
    refs.push(el("p", { className: "hint", text: "Referencia del Setup. plannedEntry no se copia al entry." }));
    refs.push(el("p", { className: "meta", text: `plannedEntry ${setup.plannedEntry ?? "—"} · plannedSL ${setup.plannedSl ?? "—"} · plannedTP ${setup.plannedTp ?? "—"}` }));
  }

  return [
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: "Nuevo" }),
      el("h1", { text: setup ? "Trade desde Setup" : "Trade BACKTEST" }),
      ...refs,
      field("Asset", asset),
      field("Context", context),
      field("Direction", direction),
      field("openedAt", openedAt),
      field("entry (confirmar)", entry),
      field("initialSL (opcional)", sl),
      field("Hubo cierres parciales", partials),
      el("p", { className: "hint", text: "Sin SL = incompleto para R. accountId = null en BACKTEST. Parciales = flag, no se leen de la nota." }),
      err,
      save,
    ]),
  ];
}
