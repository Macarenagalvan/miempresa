import { ROADMAP_ASSETS } from "../../config.js";
import { listActiveObservations } from "../../domain/observation.js";
import { el } from "../render.js";
import { go } from "../router.js";

function assetLabel(id) {
  const hit = ROADMAP_ASSETS.find((a) => a.id === id);
  return hit ? hit.label : id;
}

export async function renderEstudio(ctx) {
  const filter = ctx.route.rest || "";
  const rows = await listActiveObservations(ctx.stage.id, filter || null);
  const chips = el("div", { className: "chips" });
  const all = el("button", { type: "button", className: "chip" + (!filter ? " is-on" : ""), text: "Todos" });
  all.addEventListener("click", () => go("estudio"));
  chips.append(all);
  for (const asset of ROADMAP_ASSETS) {
    const btn = el("button", {
      type: "button",
      className: "chip" + (filter === asset.id ? " is-on" : ""),
      text: asset.label,
    });
    btn.addEventListener("click", () => go("estudio/" + asset.id));
    chips.append(btn);
  }

  const list = rows.length
    ? rows.map((obs) => {
      const item = el("button", { type: "button", className: "row" }, [
        el("strong", { text: assetLabel(obs.asset) }),
        el("span", { text: obs.date }),
        el("span", { className: "clip", text: obs.note }),
      ]);
      item.addEventListener("click", () => go("observacion/" + obs.id));
      return item;
    })
    : [el("p", { className: "empty", text: filter ? `0 observaciones de ${filter}.` : "0 observaciones." })];

  return [
    el("section", { className: "panel" }, [
      el("h1", { text: "Estudio" }),
      el("p", { className: "meta", text: "Observaciones · cronológico" }),
      chips,
      el("div", { className: "list" }, list),
    ]),
  ];
}
