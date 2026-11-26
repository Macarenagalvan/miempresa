// Patrones: las métricas de siempre, agrupadas por etiqueta de la estrategia.
import { compute, filterTrades } from "./stats.js";
import { TAG_DICTIONARY } from "./tags.js";

export const SAMPLE_FEW = 10;
export const SAMPLE_RELIABLE = 30;
export const NONE = "__NONE__";

/** FEW (<10), INDICATIVE (10–29) o RELIABLE (30+). */
export function sampleLevel(n) {
  if (n >= SAMPLE_RELIABLE) return "RELIABLE";
  if (n >= SAMPLE_FEW) return "INDICATIVE";
  return "FEW";
}

const row = (stats, base, extra) => ({
  ...extra,
  n: stats.nClosed,
  winRate: stats.winRate,
  expectancyR: stats.expectancyR,
  netPnl: stats.netPnl,
  vsBaseR: stats.expectancyR != null && base.expectancyR != null ? stats.expectancyR - base.expectancyR : null,
  sample: sampleLevel(stats.nClosed),
});

const byExpectancy = (a, b) => (b.expectancyR ?? -Infinity) - (a.expectancyR ?? -Infinity) || b.n - a.n;

/**
 * filters: los mismos de compute() (universo, activo, fechas…), sin tags.
 * Devuelve la base, una tabla por etiqueta y las combinaciones de dos etiquetas con muestra suficiente.
 */
export function computePatterns(trades, filters = {}, { minComboN = SAMPLE_FEW } = {}) {
  const { tags: _ignored, ...scope } = filters;
  const base = compute(trades, scope);
  const groups = [];
  for (const def of TAG_DICTIONARY) {
    if (def.type !== "enum") continue;
    const rows = [];
    for (const v of def.values) {
      const s = compute(trades, { ...scope, tags: { [def.key]: v.value } });
      if (s.nClosed) rows.push(row(s, base, { value: v.value, label: v.label }));
    }
    const none = compute(trades, { ...scope, tags: { [def.key]: NONE } });
    if (rows.length) {
      rows.sort((a, b) => sampleOrder(a) - sampleOrder(b) || byExpectancy(a, b));
      if (none.nClosed) rows.push(row(none, base, { value: NONE, label: "Sin dato" }));
      groups.push({ key: def.key, label: def.label, group: def.group, rows });
    }
  }

  // Combinaciones: pares de etiquetas que existen en los trades del alcance.
  const scoped = filterTrades(trades, { ...base.filters, includeVoid: false });
  const pairs = new Map();
  const enumDefs = TAG_DICTIONARY.filter((d) => d.type === "enum");
  for (const t of scoped) {
    if (!t.tags) continue;
    const present = [];
    for (const d of enumDefs) {
      const v = t.tags[d.key];
      if (v == null) continue;
      for (const one of Array.isArray(v) ? v : [v]) present.push([d, one]);
    }
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const [da, va] = present[i], [db, vb] = present[j];
        if (da.key === db.key) continue;
        pairs.set(`${da.key}=${va}&${db.key}=${vb}`, [[da, va], [db, vb]]);
      }
    }
  }
  const combos = [];
  for (const [[da, va], [db, vb]] of pairs.values()) {
    const s = compute(trades, { ...scope, tags: { [da.key]: va, [db.key]: vb } });
    if (s.nClosed < minComboN) continue;
    const text = (d, v) => `${d.label}: ${d.values.find((x) => x.value === v)?.label || v}`;
    combos.push(row(s, base, { label: `${text(da, va)} + ${text(db, vb)}` }));
  }
  combos.sort(byExpectancy);
  const best = combos.slice(0, 5);
  const worst = combos.slice(-5).reverse().filter((c) => !best.includes(c));

  const untagged = scoped.filter((t) => !t.tags).length;
  return { base: row(base, base, { label: "Todos" }), groups, best, worst, untagged, tagged: scoped.length - untagged };
}

// Los grupos con muestra chica van al final aunque tengan mejor R.
function sampleOrder(r) { return r.sample === "FEW" ? 1 : 0; }
