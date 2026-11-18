// Preparación de la sesión (análisis + rutina de mente y cuerpo) por día. Vive en meta.dayPrep (entra en el respaldo).
import { getMeta, putMeta } from "../storage/repos/meta.js";
import { ymd } from "./plan-rules.js";

export const PREP_ITEMS = [
  ["levels", "Zonas de liquidez y niveles marcados"],
  ["scenarios", "Escenarios armados (si pasa A… si pasa B…)"],
  ["alarms", "Alarmas puestas"],
  ["yoga", "Hice yoga"],
  ["meditation", "Medité"],
];
export const BIAS_OPTIONS = [["", "—"], ["BULL", "Alcista"], ["BEAR", "Bajista"], ["RANGE", "Rango"]];
const KEYS = new Set(PREP_ITEMS.map(([k]) => k));

/** Después de las 20:00 se prepara el día siguiente (el análisis de la noche anterior). */
export function prepDay(now = new Date()) {
  const d = new Date(now);
  if (d.getHours() >= 20) d.setDate(d.getDate() + 1);
  return ymd(d);
}

function clean(rec = {}) {
  const out = { bias: BIAS_OPTIONS.some(([k]) => k === rec.bias) ? rec.bias : "", note: typeof rec.note === "string" ? rec.note.slice(0, 1000) : "" };
  for (const k of KEYS) out[k] = rec[k] === true;
  return out;
}

export async function getAllPrep() {
  const meta = (await getMeta()) || {};
  return meta.dayPrep || {};
}

export async function getPrep(day) {
  return clean((await getAllPrep())[day]);
}

export async function savePrep(day, patch) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Día inválido");
  const meta = (await getMeta()) || {};
  const all = { ...(meta.dayPrep || {}) };
  const rec = clean({ ...all[day], ...patch });
  const empty = !rec.bias && !rec.note && ![...KEYS].some((k) => rec[k]);
  if (empty) delete all[day]; else all[day] = rec;
  const cutoff = ymd(new Date(Date.now() - 730 * 864e5));
  for (const d of Object.keys(all)) if (d < cutoff) delete all[d];
  await putMeta({ ...meta, dayPrep: all });
  return rec;
}
