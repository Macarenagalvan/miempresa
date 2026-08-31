import { ROADMAP_ASSETS } from "../../config.js";
import { listActiveObservations } from "../../domain/observation.js";
import { listActiveSetups } from "../../domain/setup.js";
import { el } from "../render.js";
import { go } from "../router.js";

function assetLabel(id) {
  const hit = ROADMAP_ASSETS.find((a) => a.id === id);
  return hit ? hit.label : id;
}

function parseEstudio(rest) {
  const parts = (rest || "").split("/").filter(Boolean);
  if (parts[0] === "setups") return { tab: "setups", asset: parts[1] || "" };
  return { tab: "obs", asset: parts[0] || "" };
}

export async function renderEstudio(ctx) {
  const { tab, asset } = parseEstudio(ctx.route.rest);
  const tabs = el("div", { className: "chips" }, [
    el("button", {
      type: "button",
      className: "chip" + (tab === "obs" ? " is-on" : ""),
      text: "Notas",
      onclick: () => go(asset ? "estudio/" + asset : "estudio"),
    }),
    el("button", {
      type: "button",
      className: "chip" + (tab === "setups" ? " is-on" : ""),
      text: "Ideas",
      onclick: () => go(asset ? "estudio/setups/" + asset : "estudio/setups"),
    }),
  ]);

  const chips = el("div", { className: "chips" });
  const allPath = tab === "setups" ? "estudio/setups" : "estudio";
  chips.append(el("button", {
    type: "button",
    className: "chip" + (!asset ? " is-on" : ""),
    text: "Todos",
    onclick: () => go(allPath),
  }));
  for (const item of ROADMAP_ASSETS) {
    const path = tab === "setups" ? "estudio/setups/" + item.id : "estudio/" + item.id;
    chips.append(el("button", {
      type: "button",
      className: "chip" + (asset === item.id ? " is-on" : ""),
      text: item.label,
      onclick: () => go(path),
    }));
  }

  let list;
  if (tab === "setups") {
    const rows = await listActiveSetups(ctx.stage.id, asset || null);
    list = rows.length
      ? rows.map((s) => {
        const item = el("button", { type: "button", className: "row" }, [
          el("strong", { text: assetLabel(s.asset) }),
          el("span", { text: s.status }),
          el("span", { className: "clip", text: `${s.direction} · ${s.strategy}` }),
        ]);
        item.addEventListener("click", () => go("setup/" + s.id));
        return item;
      })
      : [el("div", { className: "empty-block" }, [
        el("p", { className: "empty", text: asset ? `Todavía no hay ideas de ${asset}.` : "Todavía no hay ideas guardadas." }),
        el("button", { type: "button", className: "ghost", text: "Nueva idea", onclick: () => go("nuevo/setup") }),
      ])];
  } else {
    const rows = await listActiveObservations(ctx.stage.id, asset || null);
    list = rows.length
      ? rows.map((obs) => {
        const item = el("button", { type: "button", className: "row" }, [
          el("strong", { text: assetLabel(obs.asset) }),
          el("span", { text: obs.date }),
          el("span", { className: "clip", text: obs.note }),
        ]);
        item.addEventListener("click", () => go("observacion/" + obs.id));
        return item;
      })
      : [el("div", { className: "empty-block" }, [
        el("p", { className: "empty", text: asset ? `Todavía no hay notas de ${asset}.` : "Todavía no guardaste notas de mercado." }),
        el("button", { type: "button", className: "ghost", text: "Nueva nota", onclick: () => go("nuevo/observacion") }),
      ])];
  }

  return [
    el("section", { className: "panel" }, [
      el("h1", { text: "Estudio" }),
      el("p", { className: "hint", text: "Notas de lo que observás. Una nota puede pasar después a idea; no es obligatorio." }),
      tabs,
      chips,
      el("div", { className: "list" }, list),
    ]),
  ];
}
