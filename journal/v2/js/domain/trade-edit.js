// Edición completa de registros ya guardados.
// - Backtests de carga rápida: fecha, activo, dirección, resultado, R y clasificación.
// - Operaciones manuales: también precios, fechas y resultado neto.
// - Operaciones importadas de MT5: la ejecución queda protegida (MT5 es la fuente).
import { nowIso } from "./ids.js";
import { validDay, assertExecution } from "./execution.js";
import { assertTrade, normalizeAsset, deriveResult, parseLots } from "./integrity.js";
import { deriveTrade } from "./trade-journal.js";
import { getTrade, putTrade } from "../storage/repos/trades.js";
import { Lifecycle, Strategy, Style } from "./enums.js";
import { ALL_SESSIONS } from "../config.js";

const num = (v) => {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

export function isQuickBacktest(trade) {
  return trade?.context === "BACKTEST" && validDay(trade?.sourceRef?.sessionDate);
}

export function isMt5Trade(trade) {
  return trade?.recordSource === "MT5_EA" || trade?.sourceRef?.mt5Position != null;
}

/** ¿Se pueden editar precios y fechas? */
export function executionEditable(trade) {
  return !isQuickBacktest(trade) && !isMt5Trade(trade) && trade?.isDraft !== true
    && (trade?.lifecycle === Lifecycle.CLOSED || trade?.lifecycle === Lifecycle.OPEN);
}

function guard(current, expectedUpdatedAt) {
  if (!current) throw new Error("Este registro ya no existe.");
  if (current.lifecycle === Lifecycle.VOID) throw new Error("Un registro anulado no se edita.");
  if (expectedUpdatedAt && expectedUpdatedAt !== current.updatedAt) throw new Error("El registro cambió mientras lo editabas. Volvé a abrirlo.");
}

function classification(next, input) {
  if (input.strategy !== undefined) {
    const s = input.strategy || Strategy.UNCLASSIFIED;
    if (!Object.values(Strategy).includes(s)) throw new Error("Estrategia inválida.");
    next.strategy = s;
  }
  if (input.style !== undefined) {
    if (input.style && !Object.values(Style).includes(input.style)) throw new Error("Estilo inválido.");
    next.style = input.style || null;
  }
  if (input.session !== undefined) {
    if (input.session && !ALL_SESSIONS.includes(input.session)) throw new Error("Sesión inválida.");
    next.session = input.session || null;
  }
  if (input.note !== undefined) next.note = String(input.note || "").trim() || null;
}

export async function editQuickBacktest(id, input) {
  const current = await getTrade(id);
  guard(current, input.expectedUpdatedAt);
  if (!isQuickBacktest(current)) throw new Error("Este registro no es un backtest de carga rápida.");
  if (!validDay(input.sessionDate)) throw new Error("Fecha de sesión inválida.");
  const asset = normalizeAsset(input.asset);
  if (!asset) throw new Error("Completá el activo.");
  if (!["LONG", "SHORT"].includes(input.direction)) throw new Error("Elegí LONG o SHORT.");
  if (!["WIN", "LOSS", "BE"].includes(input.result)) throw new Error("Elegí WIN, LOSS o BE.");
  let r = num(input.rrRealized);
  if (Number.isNaN(r)) throw new Error("R debe ser un número.");
  if (r != null && input.result === "LOSS" && r > 0) r = -r;
  if (r != null && (input.result === "WIN" ? r <= 0 : input.result === "LOSS" ? r >= 0 : r !== 0)) {
    throw new Error("R debe ser positivo para WIN, negativo para LOSS y cero para BE.");
  }
  const next = { ...current, asset, direction: input.direction, result: input.result, rrRealized: r,
    sourceRef: { ...current.sourceRef, sessionDate: input.sessionDate }, updatedAt: nowIso() };
  classification(next, input);
  const derived = deriveTrade(next);
  assertTrade(derived);
  await putTrade(derived);
  return derived;
}

/** Corrige los datos de ejecución de una operación manual (abierta o cerrada). */
export async function editManualExecution(id, input) {
  const current = await getTrade(id);
  guard(current, input.expectedUpdatedAt);
  if (!executionEditable(current)) throw new Error("La ejecución de este registro no se puede editar.");
  const closed = current.lifecycle === Lifecycle.CLOSED;
  const asset = normalizeAsset(input.asset);
  const exec = { asset, direction: input.direction, openedAt: input.openedAt, entry: input.entry,
    ...(closed ? { closedAt: input.closedAt, exit: input.exit, netPnl: input.netPnl } : {}) };
  assertExecution(exec, { closed });
  for (const k of ["commission", "swap"]) {
    if (Number.isNaN(num(input[k]))) throw new Error(k === "commission" ? "Comisión inválida." : "Swap inválido.");
  }
  const next = {
    ...current,
    asset,
    direction: input.direction,
    openedAt: input.openedAt,
    entry: num(input.entry),
    lots: input.lots !== undefined ? parseLots(input.lots) : current.lots,
    updatedAt: nowIso(),
  };
  if (closed) {
    next.closedAt = input.closedAt;
    next.exit = num(input.exit);
    next.netPnl = num(input.netPnl);
    if (input.commission !== undefined) next.commission = num(input.commission);
    if (input.swap !== undefined) next.swap = num(input.swap);
    next.result = deriveResult(next.closeType, next.netPnl, next.closeType === "BE");
  }
  const derived = deriveTrade(next);
  assertTrade(derived);
  await putTrade(derived);
  return derived;
}
