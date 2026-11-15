// Detección de registros probablemente repetidos, antes de guardar o importar.
import { listTrades } from "../storage/repos/trades.js";
import { listActiveObservations } from "./observation.js";
import { normalizeAsset } from "./integrity.js";
import { backtestKey } from "../services/table-io.js";

const live = (t) => t.lifecycle !== "VOID";

/** Backtest de carga rápida: misma fecha, activo, dirección, resultado y R. */
export async function findSimilarQuickBacktest({ sessionDate, asset, direction, result, rrRealized }, excludeId = null) {
  const key = backtestKey({ date: sessionDate, asset: normalizeAsset(asset), direction, result, r: rrRealized === "" || rrRealized == null ? null : Number(rrRealized) });
  const all = await listTrades();
  return all.find((t) => t.id !== excludeId && live(t) && t.context === "BACKTEST" && t.sourceRef?.sessionDate
    && backtestKey({ date: t.sourceRef.sessionDate, asset: t.asset, direction: t.direction, result: t.result, r: t.rrRealized }) === key) || null;
}

/** Estudio NO TRADE del mismo día y activo. */
export async function findSimilarStudy(stageId, { date, asset }) {
  const a = normalizeAsset(asset);
  const studies = await listActiveObservations(stageId);
  return studies.find((o) => o.date === date && o.asset === a && o.studyOutcome === "NO_TRADE") || null;
}

/**
 * Operación con fecha y hora: mismo tipo, cuenta, activo y dirección, con entrada
 * a menos de 2 minutos, o mismo día y mismo precio de entrada.
 */
export async function findSimilarTrade({ context, accountId, asset, direction, openedAt, entry }, excludeId = null) {
  const a = normalizeAsset(asset);
  const at = openedAt ? Date.parse(openedAt) : NaN;
  const all = await listTrades();
  return all.find((t) => {
    if (t.id === excludeId || !live(t) || t.context !== context || t.asset !== a || t.direction !== direction) return false;
    if ((t.accountId || null) !== (accountId || null)) return false;
    const tAt = t.openedAt ? Date.parse(t.openedAt) : NaN;
    if (Number.isFinite(at) && Number.isFinite(tAt) && Math.abs(at - tAt) <= 2 * 60 * 1000) return true;
    const sameDay = openedAt && t.openedAt && new Date(at).toDateString() === new Date(tAt).toDateString();
    return Boolean(sameDay && entry != null && entry !== "" && Number(entry) === Number(t.entry));
  }) || null;
}

export function describeRecord(t) {
  const day = String(t.sourceRef?.sessionDate || t.openedAt || t.date || "").slice(0, 10);
  const r = t.rrRealized != null ? ` · R ${t.rrRealized}` : "";
  return [day, t.asset, t.direction, t.result || t.studyOutcome].filter(Boolean).join(" · ") + r;
}
