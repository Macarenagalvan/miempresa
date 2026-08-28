import { el } from "../render.js";
import { listStageSignals } from "../../domain/signal.js";
import { Disposition, Resolution, Direction } from "../../domain/enums.js";
import { ROADMAP_ASSETS } from "../../config.js";
import { go } from "../router.js";

function qs(query) {
  const parts = [];
  for (const [k, v] of Object.entries(query)) {
    if (v) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  }
  return parts.length ? "?" + parts.join("&") : "";
}

function select(current, options) {
  const node = el("select", { className: "input slim" }, options.map(([v, l]) => el("option", { value: v, text: l })));
  node.value = current || "";
  return node;
}

function labelDisposition(v) {
  if (v === Disposition.SKIPPED_OPEN_POSITION) return "SKIPPED";
  return v;
}

export async function renderSenales(ctx) {
  const q = ctx.route.query || {};
  const filters = {
    asset: q.asset || "",
    direction: q.direction || "",
    disposition: q.disposition || "",
    resolution: q.resolution || "",
    from: q.from || "",
    to: q.to || "",
  };
  const rows = await listStageSignals(ctx.stage.id, filters);
  const asset = select(filters.asset, [["", "asset"], ...ROADMAP_ASSETS.map((a) => [a.id, a.label])]);
  const direction = select(filters.direction, [["", "dir"], ...Object.values(Direction).map((d) => [d, d])]);
  const disposition = select(filters.disposition, [["", "disposition"], ...Object.values(Disposition).map((d) => [d, labelDisposition(d)])]);
  const resolution = select(filters.resolution, [["", "resolution"], ...Object.values(Resolution).map((d) => [d, d])]);
  const from = el("input", { className: "input slim", type: "date", value: filters.from });
  const to = el("input", { className: "input slim", type: "date", value: filters.to });
  function apply() {
    go("senales" + qs({
      asset: asset.value,
      direction: direction.value,
      disposition: disposition.value,
      resolution: resolution.value,
      from: from.value,
      to: to.value,
    }));
  }
  [asset, direction, disposition, resolution, from, to].forEach((n) => n.addEventListener("change", apply));
  const list = rows.length
    ? rows.map((s) => {
      const item = el("button", { type: "button", className: "row hist" }, [
        el("span", { text: String(s.printedAt || "").slice(0, 16).replace("T", " ") }),
        el("strong", { text: s.asset }),
        el("span", { text: s.direction }),
        el("span", { text: labelDisposition(s.disposition) }),
        el("span", { text: s.resolution }),
      ]);
      if (s.resolution === Resolution.OPEN) item.className += " is-open";
      item.addEventListener("click", () => go("senal/" + s.id));
      return item;
    })
    : [el("p", { className: "empty", text: "No hay señales en esta etapa." })];
  return [
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: "Universo Desk · stage activa" }),
      el("h1", { text: "Señales" }),
      el("p", { className: "meta", text: "Registro del print. No es el motor RGM. Sin alta manual de producto." }),
      el("div", { className: "chips filters" }, [asset, direction, disposition, resolution, from, to]),
      el("p", { className: "meta", text: `${rows.length} señales` }),
      el("div", { className: "list" }, list),
    ]),
  ];
}
