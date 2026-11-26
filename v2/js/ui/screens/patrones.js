import { el } from "../render.js";
import { listTrades } from "../../storage/repos/trades.js";
import { assetFilterOptions } from "../../domain/stats.js";
import { computePatterns, SAMPLE_FEW, SAMPLE_RELIABLE } from "../../domain/patterns.js";
import { isTestRecord } from "../../domain/test-record.js";
import { go } from "../router.js";

const SAMPLE_TEXT = { FEW: "Muy pocos", INDICATIVE: "Orientativo", RELIABLE: "Confiable" };

function qs(query) {
  const parts = Object.entries(query).filter(([, v]) => v).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v));
  return parts.length ? "?" + parts.join("&") : "";
}

function select(current, options, label) {
  const node = el("select", { className: "input slim", "aria-label": label }, options.map(([v, l]) => el("option", { value: v, text: l })));
  node.value = current || "";
  return node;
}

const pct = (v) => (v == null ? "—" : Math.round(v * 100) + "%");
const r = (v) => (v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(2) + "R");

function table(rows, firstHeader) {
  const t = el("table", { className: "journal-table" });
  t.append(el("tr", {}, [firstHeader, "Trades", "Ganadas", "R promedio", "vs. tu promedio", "Muestra"].map((text) => el("th", { text }))));
  for (const x of rows) {
    const few = x.sample === "FEW";
    t.append(el("tr", { style: few ? "opacity:.55" : "" }, [
      el("td", { text: x.label, style: "white-space:normal" }),
      el("td", { text: String(x.n) }),
      el("td", { text: pct(x.winRate) }),
      el("td", { text: r(x.expectancyR) }),
      el("td", { text: r(x.vsBaseR) }),
      el("td", {}, [el("span", { className: "badge", text: SAMPLE_TEXT[x.sample] })]),
    ]));
  }
  return el("div", { className: "table-wrap" }, [t]);
}

export async function renderPatrones(ctx) {
  const q = ctx.route.query || {};
  const universe = ["BACKTEST", "REAL", "DEMO"].includes(q.universe) ? q.universe : "BACKTEST";
  const trades = (await listTrades()).filter((t) => !isTestRecord(t));
  const filters = { universe, stageId: ctx.stage.id, asset: q.asset || "", from: q.from || "", to: q.to || "" };
  const p = computePatterns(trades, filters);

  const uni = select(universe, [["BACKTEST", "Backtest"], ["REAL", "Operado · propias y fondeo"], ["DEMO", "Demo"]], "Qué trades mirar");
  const asset = select(filters.asset, assetFilterOptions(trades, filters.asset, "Todos los activos"), "Activo");
  const from = el("input", { className: "input slim", type: "date", value: filters.from, "aria-label": "Desde" });
  const to = el("input", { className: "input slim", type: "date", value: filters.to, "aria-label": "Hasta" });
  const apply = () => go("patrones" + qs({ universe: uni.value, asset: asset.value, from: from.value, to: to.value }));
  [uni, asset, from, to].forEach((n) => n.addEventListener("change", apply));

  const head = el("section", { className: "panel" }, [
    el("p", { className: "kicker", text: "Qué te funciona" }),
    el("h1", { text: "Patrones" }),
    el("p", { className: "meta", text: "Tus resultados separados por las etiquetas de tu estrategia. Cada fila dice cuántos trades hay, cuántos ganaste y cuánto ganás en promedio." }),
    el("div", { className: "chips filters" }, [uni, asset, from, to]),
    el("p", {}, [
      el("strong", { text: `Todos: ${p.base.n} trades · ganadas ${pct(p.base.winRate)} · ${r(p.base.expectancyR)} por trade` }),
    ]),
    el("p", { className: "hint", text: `${p.tagged} con etiquetas · ${p.untagged} sin etiquetas. Muestra: menos de ${SAMPLE_FEW} trades = muy pocos (en gris, no te fíes); de ${SAMPLE_FEW} a ${SAMPLE_RELIABLE - 1} = orientativo; ${SAMPLE_RELIABLE} o más = confiable.` }),
  ]);

  if (!p.groups.length) {
    return [head, el("section", { className: "panel" }, [
      el("h2", { text: "Todavía no hay trades con etiquetas" }),
      el("p", { className: "meta", text: "Las etiquetas llegan con los backtests que importás (ZIP o JSON con «tags»). Cuando haya, aparecen acá." }),
    ])];
  }

  const combos = el("section", { className: "panel" }, [
    el("h2", { text: "Combinaciones" }),
    el("p", { className: "meta", text: `Dos etiquetas juntas, solo si hay ${SAMPLE_FEW} trades o más.` }),
    ...(p.best.length
      ? [el("h3", { text: "Las que mejor te van" }), table(p.best, "Combinación"),
        ...(p.worst.length ? [el("h3", { text: "Las que peor te van" }), table(p.worst, "Combinación")] : [])]
      : [el("p", { className: "hint", text: `Todavía ninguna combinación llega a ${SAMPLE_FEW} trades.` })]),
  ]);

  const byGroup = {};
  for (const g of p.groups) (byGroup[g.group] ||= []).push(g);
  const sections = Object.entries(byGroup).map(([group, list]) => el("section", { className: "panel" }, [
    el("p", { className: "kicker", text: group }),
    ...list.flatMap((g) => [el("h2", { text: g.label }), table(g.rows, g.label)]),
  ]));
  return [head, combos, ...sections];
}
