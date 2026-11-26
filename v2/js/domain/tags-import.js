// Fichas de etiquetas para trades que ya están en el journal (por ejemplo, los reales
// importados de Tradovate o Vantage). Formato "maca-tags" v1:
// { "format": "maca-tags", "version": 1, "items": [
//   { "asset": "NAS100", "direction": "SHORT", "openedAt": "2026-11-26T10:45:00-05:00",
//     "entry": 26251.55, "session": "NY_AM", "tags": { "model": "A_REVERSAL", ... } } ] }
import { nowIso } from "./ids.js";
import { assertTrade, normalizeAsset } from "./integrity.js";
import { normalizeTags } from "./tags.js";
import { Lifecycle } from "./enums.js";
import { getTrade, putTrade } from "../storage/repos/trades.js";
import { SESSIONS } from "../config.js";

export const MATCH_WINDOW_MINUTES = 5;
const MAX_ITEMS = 500;
const ITEM_FIELDS = ["asset", "direction", "openedAt", "entry", "session", "tags", "label"];

export function parseTagsFile(text) {
  if (typeof text !== "string" || text.length > 1_000_000) throw new Error("Archivo de etiquetas inválido o demasiado grande.");
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("El archivo no es un JSON válido."); }
  if (!data || data.format !== "maca-tags" || data.version !== 1 || !Array.isArray(data.items)) {
    throw new Error("Formato no reconocido: se espera maca-tags versión 1 con una lista items.");
  }
  if (!data.items.length || data.items.length > MAX_ITEMS) throw new Error(`El archivo debe tener entre 1 y ${MAX_ITEMS} fichas.`);
  return data.items.map((raw, i) => {
    const where = `Ficha ${i + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${where}: formato inválido.`);
    const extra = Object.keys(raw).filter((k) => !ITEM_FIELDS.includes(k));
    if (extra.length) throw new Error(`${where}: campos no admitidos (${extra.join(", ")}).`);
    const asset = normalizeAsset(raw.asset);
    if (!asset) throw new Error(`${where}: falta el activo.`);
    if (!["LONG", "SHORT"].includes(raw.direction)) throw new Error(`${where}: direction debe ser LONG o SHORT.`);
    const opened = typeof raw.openedAt === "string" ? Date.parse(raw.openedAt) : NaN;
    if (!Number.isFinite(opened) || !/(Z|[+-]\d{2}:\d{2})$/.test(raw.openedAt)) throw new Error(`${where}: openedAt debe ser fecha y hora ISO con zona horaria.`);
    if (raw.entry != null && !(typeof raw.entry === "number" && Number.isFinite(raw.entry) && raw.entry > 0)) throw new Error(`${where}: entry debe ser un número positivo.`);
    if (raw.session != null && !SESSIONS.includes(raw.session)) throw new Error(`${where}: session debe ser ${SESSIONS.join(", ")}.`);
    let tags;
    try { tags = normalizeTags(raw.tags); } catch (e) { throw new Error(`${where}: ${e.message}`); }
    if (!tags) throw new Error(`${where}: no trae etiquetas.`);
    return { asset, direction: raw.direction, openedAt: raw.openedAt, openedMs: opened, entry: raw.entry ?? null, session: raw.session ?? null, tags, label: typeof raw.label === "string" ? raw.label.slice(0, 120) : "" };
  });
}

/** Busca el trade de cada ficha: mismo activo y dirección, apertura a ±5 minutos. */
export function matchTags(trades, items, windowMinutes = MATCH_WINDOW_MINUTES) {
  const windowMs = windowMinutes * 60_000;
  const live = trades.filter((t) => t.lifecycle !== Lifecycle.VOID && t.openedAt);
  return items.map((item) => {
    let found = live.filter((t) => normalizeAsset(t.asset) === item.asset && t.direction === item.direction
      && Math.abs(Date.parse(t.openedAt) - item.openedMs) <= windowMs);
    if (found.length > 1 && item.entry != null) {
      const near = (t) => Math.abs(Number(t.entry) - item.entry);
      const best = Math.min(...found.map(near));
      found = found.filter((t) => near(t) === best);
    }
    if (!found.length) return { item, trade: null, status: "NOT_FOUND" };
    if (found.length > 1) return { item, trade: null, status: "AMBIGUOUS", count: found.length };
    const trade = found[0];
    return { item, trade, status: "MATCH", replaces: Boolean(trade.tags) };
  });
}

/** Guarda las etiquetas en los trades encontrados. Revalida cada trade antes de escribir. */
export async function applyTags(rows) {
  let saved = 0;
  for (const row of rows) {
    if (row.status !== "MATCH") continue;
    const current = await getTrade(row.trade.id);
    if (!current) continue;
    const next = { ...current, tags: row.item.tags, updatedAt: nowIso() };
    if (row.item.session && !current.session) next.session = row.item.session;
    assertTrade(next);
    await putTrade(next);
    saved++;
  }
  return saved;
}
