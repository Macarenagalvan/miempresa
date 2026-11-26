import { el } from "../render.js";
import { listTrades } from "../../storage/repos/trades.js";
import { assetFilterOptions } from "../../domain/stats.js";
import { computePatterns, SAMPLE_FEW, SAMPLE_RELIABLE } from "../../domain/patterns.js";
import { isTestRecord } from "../../domain/test-record.js";
import { go } from "../router.js";
import { parseTagsFile, matchTags, applyTags, MATCH_WINDOW_MINUTES } from "../../domain/tags-import.js";

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

const pct = (v) => (v == null ? "Sin dato" : Math.round(v * 100) + "%");
const r = (v) => (v == null ? "Sin dato" : (v > 0 ? "+" : "") + v.toFixed(2) + "R");

function table(rows, firstHeader) {
  const t = el("table", { className: "journal-table" });
  t.append(el("tr", {}, [firstHeader, "Trades", "Ganadas", "R promedio", "vs. tu promedio", "Muestra"].map((text) => el("th", { text }))));
  for (const x of rows) {
    const few = x.sample === "FEW";
    t.append(el("tr", {}, [
      el("td", { text: x.label, style: "white-space:normal" }),
      el("td", { text: String(x.n) }),
      el("td", { text: pct(x.winRate) }),
      el("td", { text: r(x.expectancyR) }),
      el("td", { text: r(x.vsBaseR) }),
      el("td", {}, [el("span", { className: "badge" + (few ? " badge-warn" : ""), text: (few ? "⚠ " : "") + SAMPLE_TEXT[x.sample] })]),
    ]));
  }
  return el("div", { className: "table-wrap" }, [t]);
}

const STATUS_TEXT = { MATCH: "Encontrado", NOT_FOUND: "No encontrado", AMBIGUOUS: "Hay varios iguales" };

function tagsImporter(trades) {
  const input = el("input", { type: "file", accept: ".json,application/json", "aria-label": "Archivo de etiquetas" });
  const preview = el("div");
  const err = el("p", { className: "err", "aria-live": "polite" });
  const confirm = el("button", { type: "button", text: "Guardar etiquetas", disabled: true });
  let rows = null;
  input.addEventListener("change", async () => {
    err.textContent = ""; preview.replaceChildren(); confirm.disabled = true; rows = null;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const items = parseTagsFile(await file.text());
      rows = matchTags(trades, items);
      const t = el("table", { className: "journal-table" });
      t.append(el("tr", {}, ["Ficha", "Activo", "Apertura", "Estado"].map((text) => el("th", { text }))));
      for (const r of rows) {
        const state = STATUS_TEXT[r.status] + (r.status === "MATCH" && r.replaces ? " · reemplaza etiquetas" : "");
        t.append(el("tr", {}, [r.item.label || "—", r.item.asset + " " + r.item.direction, r.item.openedAt, state].map((text) => el("td", { text }))));
      }
      const ok = rows.filter((r) => r.status === "MATCH").length;
      preview.replaceChildren(
        el("p", { text: `${ok} de ${rows.length} fichas encontraron su trade.` }),
        el("div", { className: "table-wrap" }, [t]),
      );
      confirm.disabled = ok === 0;
    } catch (e) { err.textContent = e.message; }
  });
  confirm.addEventListener("click", async () => {
    if (!rows) return;
    confirm.disabled = true;
    try {
      const n = await applyTags(rows);
      preview.replaceChildren(el("p", { text: `Listo: ${n} trades etiquetados.` }));
      setTimeout(() => go("patrones" + location.hash.replace(/^#\/patrones/, "")), 800);
    } catch (e) { err.textContent = e.message; confirm.disabled = false; }
  });
  return el("details", { className: "panel" }, [
    el("summary", { text: "Etiquetar trades reales (archivo de Claude)" }),
    el("p", { className: "meta", text: `Subí el archivo .json que te arma Claude. Cada ficha se pega al trade del mismo activo, dirección y precio de entrada (si la ficha no trae entrada, por la hora: ±${MATCH_WINDOW_MINUTES} minutos). Nada se guarda hasta que confirmes.` }),
    input, err, preview, el("div", { className: "row-actions" }, [confirm]),
  ]);
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

  const importer = tagsImporter(trades);
  const upload = el("button", { type: "button", className: "ghost", text: "Subir etiquetas", onclick: () => { importer.open = true; importer.scrollIntoView({ behavior: "smooth", block: "start" }); importer.querySelector("input")?.focus(); } });
  const head = el("section", { className: "panel" }, [
    el("p", { className: "kicker", text: "Qué te funciona" }),
    el("div", { className: "screen-head" }, [el("h1", { text: "Patrones" }), upload]),
    el("p", { className: "meta", text: "Tus resultados separados por las etiquetas de tu estrategia. Cada fila dice cuántos trades hay, cuántos ganaste y cuánto ganás en promedio." }),
    el("div", { className: "chips filters" }, [uni, asset, from, to]),
    el("p", {}, [
      el("strong", { text: `Todos: ${p.base.n} trades · ganadas ${pct(p.base.winRate)} · ${r(p.base.expectancyR)} por trade` }),
    ]),
    el("p", { className: "hint", text: `${p.tagged} con etiquetas · ${p.untagged} sin etiquetas. Muestra: menos de ${SAMPLE_FEW} trades = muy pocos (marcado con ⚠, no te fíes); de ${SAMPLE_FEW} a ${SAMPLE_RELIABLE - 1} = orientativo; ${SAMPLE_RELIABLE} o más = confiable.` }),
  ]);

  if (!p.groups.length) {
    return [head, importer, el("section", { className: "panel" }, [
      el("h2", { text: "Todavía no hay trades con etiquetas" }),
      el("p", { className: "meta", text: "Las etiquetas llegan con los backtests que importás (ZIP con etiquetas) o, para trades reales, con el archivo de etiquetas que te arma Claude (panel de arriba). Cuando haya, aparecen acá." }),
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
  return [head, combos, ...sections, importer];
}
