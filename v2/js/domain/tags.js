// Diccionario de etiquetas de la estrategia (ver "Libro de la estrategia").
// Valores cerrados: el journal rechaza claves o valores que no existen, así
// las estadísticas por etiqueta no se parten por errores de escritura.

export const TAGS_VERSION = 1;

const t = (key, label, group, values, multi = false) => Object.freeze({
  key, label, group, multi, type: "enum",
  values: Object.freeze(values.map(([value, text]) => Object.freeze({ value, label: text }))),
});

export const TAG_DICTIONARY = Object.freeze([
  t("model", "Modelo", "Contexto", [["A_REVERSAL", "A · Giro tras barrida"], ["B_CONTINUATION", "B · Continuación apertura NY"]]),
  t("withDaily", "A favor del diario", "Contexto", [["YES", "Sí"], ["NO", "No"]]),
  t("crt", "CRT que manda", "Contexto", [["D", "D"], ["H12", "12h"], ["H8", "8h"], ["H4", "4h"], ["H1", "1h"], ["NONE", "Ninguno"]]),
  t("htfZone", "Zona HTF", "Contexto", [["FVG", "FVG"], ["IFVG", "iFVG"], ["MIT", "MIT"], ["TRENDLINE", "Directriz"], ["PRIOR_ACCUMULATION", "Acumulación previa"], ["DAILY_RANGE_EXTREME", "Extremo del rango D"], ["NONE", "Ninguna"]], true),
  t("location", "Ubicación", "Contexto", [["PREMIUM", "Premium"], ["EQ", "EQ 50%"], ["DISCOUNT", "Discount"]]),
  t("smt", "SMT", "Contexto", [["FOR", "A favor"], ["AGAINST", "En contra"], ["NONE", "Sin SMT"], ["NOT_CHECKED", "No mirado"]]),
  t("po3Phase", "Fase PO3 / AMD", "Contexto", [["ACCUMULATION", "Acumulación"], ["MANIPULATION", "Manipulación"], ["DISTRIBUTION", "Distribución"]]),
  t("sweep", "Barrida previa", "Liquidez", [["ASIA_H", "Asia H"], ["ASIA_L", "Asia L"], ["LONDON_H", "Londres H"], ["LONDON_L", "Londres L"], ["NY_H", "NY H"], ["NY_L", "NY L"], ["TF_LINE", "Línea de temporalidad"], ["EQUAL_HL", "Mínimos/máximos iguales"], ["NONE", "Ninguna"]], true),
  t("trigger", "Gatillo", "Ejecución", [["CHOCH_FVG", "CHOCH + FVG"], ["CHOCH_BREAK", "CHOCH + rotura con fuerza"], ["PULLBACK", "Retroceso tras desplazamiento"]]),
  t("execTf", "Temporalidad de ejecución", "Ejecución", [["M1", "1m"], ["M2", "2m"], ["M3", "3m"], ["M5", "5m"]]),
  t("tpVsLiquidity", "TP respecto de la liquidez", "Gestión", [["BEFORE", "Antes de la liquidez"], ["AT", "En la liquidez"], ["HTF_LINE", "En una línea HTF"]]),
  t("breakEven", "Break even", "Gestión", [["YES", "Sí"], ["NO", "No"]]),
  t("newsNearby", "Noticia cerca", "Filtro", [["YES", "Sí"], ["NO", "No"]]),
  Object.freeze({ key: "runAfterTpR", label: "Recorrido después del TP (R)", group: "Gestión", multi: false, type: "number", min: 0, max: 100 }),
]);

const BY_KEY = new Map(TAG_DICTIONARY.map((d) => [d.key, d]));

export function tagDefinition(key) { return BY_KEY.get(key) || null; }

/**
 * Valida y ordena las etiquetas. Devuelve null si no hay ninguna.
 * Acepta { model: "A_REVERSAL", sweep: ["ASIA_H", "TF_LINE"], runAfterTpR: 1.5 }.
 */
export function normalizeTags(input) {
  if (input == null) return null;
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("tags: debe ser un objeto { etiqueta: valor }.");
  const out = {};
  for (const [key, raw] of Object.entries(input)) {
    const def = BY_KEY.get(key);
    if (!def) throw new Error(`tags: la etiqueta «${key}» no existe en el diccionario.`);
    if (raw == null || raw === "" || (Array.isArray(raw) && raw.length === 0)) continue;
    if (def.type === "number") {
      const n = typeof raw === "number" ? raw : NaN;
      if (!Number.isFinite(n) || n < def.min || n > def.max) throw new Error(`tags.${key}: número entre ${def.min} y ${def.max}.`);
      out[key] = n;
      continue;
    }
    const list = Array.isArray(raw) ? raw : [raw];
    if (!def.multi && list.length > 1) throw new Error(`tags.${key}: admite un solo valor.`);
    const allowed = def.values.map((v) => v.value);
    for (const v of list) {
      if (typeof v !== "string" || !allowed.includes(v)) throw new Error(`tags.${key}: el valor «${v}» no existe en el diccionario.`);
    }
    const unique = allowed.filter((v) => list.includes(v));
    out[key] = def.multi ? unique : unique[0];
  }
  if (!Object.keys(out).length) return null;
  const ordered = {};
  for (const def of TAG_DICTIONARY) if (def.key in out) ordered[def.key] = out[def.key];
  return ordered;
}

export function tagValueLabel(key, value) {
  const def = BY_KEY.get(key);
  if (!def) return String(value);
  if (def.type === "number") return `${value}R`;
  const one = (v) => def.values.find((x) => x.value === v)?.label || v;
  return Array.isArray(value) ? value.map(one).join(" + ") : one(value);
}

/** Filas { label, text } en el orden del diccionario, para mostrar. */
export function describeTags(tags) {
  if (!tags || typeof tags !== "object") return [];
  return TAG_DICTIONARY.filter((d) => tags[d.key] != null).map((d) => ({ key: d.key, label: d.label, text: tagValueLabel(d.key, tags[d.key]) }));
}

/** true si el trade cumple todas las etiquetas pedidas. "__NONE__" pide trades sin esa etiqueta. */
export function tagsMatch(tags, filter) {
  if (!filter) return true;
  for (const [key, wanted] of Object.entries(filter)) {
    if (wanted == null || wanted === "") continue;
    const have = tags ? tags[key] : undefined;
    if (wanted === "__NONE__") { if (have != null) return false; continue; }
    if (have == null) return false;
    if (Array.isArray(have) ? !have.includes(wanted) : have !== wanted) return false;
  }
  return true;
}
