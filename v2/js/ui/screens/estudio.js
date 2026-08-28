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
      text: "Observaciones",
      onclick: () => go(asset ? "estudio/" + asset : "estudio"),
    }),
    el("button", {
      type: "button",
      className: "chip" + (tab === "setups" ? " is-on" : ""),
      text: "Setups",
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
      : [el("p", { className: "empty", text: "0 setups." })];
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
      : [el("p", { className: "empty", text: asset ? `0 observaciones de ${asset}.` : "0 observaciones." })];
  }

  return [
    el("section", { className: "panel" }, [
      el("h1", { text: "Estudio" }),
      tabs,
      chips,
      el("div", { className: "list" }, list),
    ]),
  ];
}
