// Proceso de cada operación/backtest: qué setup, qué confluencias, cómo estaba y si siguió el plan.
// Basado en la lectura actual de Maca (liquidez y estructura). Todo es opcional.
import { nowIso } from "./ids.js";
import { getTrade, putTrade } from "../storage/repos/trades.js";

export const FAMILIES = [["CONTINUATION", "Continuación"], ["PULLBACK", "Retroceso"], ["REVERSAL", "Reversión"]];
export const CONFLUENCES = [
  ["SWEEP", "Barrido de liquidez"], ["PDH_PDL", "PDH / PDL"], ["SESSION_HL", "High/Low de sesión"],
  ["SMT", "SMT"], ["DISPLACEMENT", "Desplazamiento"], ["BOS_CHOCH", "BOS / CHOCH"],
  ["FVG", "FVG"], ["IFVG", "iFVG"], ["PREMIUM_DISCOUNT", "Premium / Discount"], ["CRT", "CRT"], ["AMD", "AMD"],
];
export const EMOTIONS = [
  ["CALM", "Calma"], ["CONFIDENT", "Confianza"], ["ANXIOUS", "Ansiedad"], ["FOMO", "FOMO"],
  ["REVENGE", "Revancha"], ["TIRED", "Cansancio"], ["BORED", "Aburrimiento"],
];
export const PLAN = [["YES", "Sí"], ["PARTIAL", "A medias"], ["NO", "No"]];
export const ERRORS = [
  ["EARLY", "Entrada anticipada"], ["NO_CONFIRMATION", "Sin confirmación"], ["IMPULSIVE", "Impulsividad"],
  ["OFF_HOURS", "Fuera de horario"], ["RISK", "Riesgo no respetado"], ["OVERTRADING", "Sobreoperación"],
  ["MOVED_SL", "Moví el SL"], ["EARLY_EXIT", "Cerré antes de tiempo"],
];

const keys = (list) => new Set(list.map(([k]) => k));
const ALLOWED = { family: keys(FAMILIES), emotion: keys(EMOTIONS), plan: keys(PLAN), confluences: keys(CONFLUENCES), errors: keys(ERRORS) };

export function labelOf(list, key) {
  return list.find(([k]) => k === key)?.[1] || key;
}

/** Limpia la entrada: descarta valores desconocidos. Devuelve null si está vacío. */
export function normalizeProcess(input = {}) {
  const out = {
    family: ALLOWED.family.has(input.family) ? input.family : null,
    emotion: ALLOWED.emotion.has(input.emotion) ? input.emotion : null,
    plan: ALLOWED.plan.has(input.plan) ? input.plan : null,
    confluences: [...new Set([].concat(input.confluences || []).filter((c) => ALLOWED.confluences.has(c)))],
    errors: [...new Set([].concat(input.errors || []).filter((e) => ALLOWED.errors.has(e)))],
  };
  const empty = !out.family && !out.emotion && !out.plan && !out.confluences.length && !out.errors.length;
  return empty ? null : out;
}

export function isSameProcess(a, b) {
  return JSON.stringify(normalizeProcess(a || {})) === JSON.stringify(normalizeProcess(b || {}));
}

export async function setTradeProcess(id, input) {
  const current = await getTrade(id);
  if (!current) throw new Error("Este registro ya no existe.");
  const process = normalizeProcess(input || {});
  if (isSameProcess(current.process, process)) return current;
  const next = { ...current, process, updatedAt: nowIso() };
  await putTrade(next);
  return next;
}

/** Texto corto para listas y reportes. */
export function describeProcess(p) {
  if (!p) return "";
  const parts = [];
  if (p.family) parts.push(labelOf(FAMILIES, p.family));
  if (p.plan) parts.push("Plan: " + labelOf(PLAN, p.plan));
  if (p.emotion) parts.push("Emoción: " + labelOf(EMOTIONS, p.emotion));
  if (p.confluences?.length) parts.push("Confluencias: " + p.confluences.map((c) => labelOf(CONFLUENCES, c)).join(", "));
  if (p.errors?.length) parts.push("Errores: " + p.errors.map((e) => labelOf(ERRORS, e)).join(", "));
  return parts.join(" · ");
}
