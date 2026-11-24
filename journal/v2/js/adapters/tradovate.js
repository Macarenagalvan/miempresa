// Tradovate → Journal: lee el CSV de «Informes de cuenta → Desempeño» (Performance).
// Cada fila es un trade cerrado (par compra/venta). No trae cuenta ni comisiones:
// la cuenta la elige la usuaria y la comisión por contrato es opcional.
import { wallClockToIso } from "./mt5.js";

export const TRADOVATE_REQUIRED_COLUMNS = Object.freeze([
  "symbol", "buyFillId", "sellFillId", "qty", "buyPrice", "sellPrice", "pnl", "boughtTimestamp", "soldTimestamp",
]);

// Raíz del contrato (sin mes/año) → activo del journal.
export const TRADOVATE_ROOT_ASSETS = Object.freeze({ MNQ: "MNQ", NQ: "NQ", MGC: "MGC", GC: "GC", MES: "MES", ES: "ES" });

export function parseCommaCsv(text) {
  const clean = String(text || "").replace(/^﻿/, "");
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

export function isTradovatePerformanceCsv(text) {
  const first = parseCommaCsv(String(text || "").split(/\r?\n/, 1)[0] || "")[0] || [];
  const names = first.map((c) => c.trim());
  return TRADOVATE_REQUIRED_COLUMNS.every((c) => names.includes(c));
}

/** "$68.00" → 68 · "$(51.00)" → -51 · "-$1,234.50" → -1234.5 */
export function parseTradovateMoney(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s.replace(/\$/g, "")) || /^-/.test(s);
  const digits = s.replace(/[()$\s-]/g, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  const n = Number(digits);
  return negative ? -n : n;
}

function parsePrice(raw) {
  const s = String(raw == null ? "" : raw).trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** "11/19/2026 16:22:42" (MM/DD/YYYY) → { date: "2026-11-19", time: "16:22", seconds: "42", ms } */
export function parseTradovateTimestamp(raw) {
  const m = String(raw || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, mo, d, y, h, mi, sec = "00"] = m;
  const pad = (v) => String(v).padStart(2, "0");
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec));
  if (dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d || +h > 23) return null;
  return { date: `${y}-${pad(mo)}-${pad(d)}`, time: `${pad(h)}:${mi}`, seconds: pad(sec), sortKey: dt.getTime(), original: String(raw).trim() };
}

export function mapTradovateSymbol(raw) {
  const s = String(raw || "").trim().toUpperCase();
  const m = s.match(/^([A-Z]{1,4}?)([FGHJKMNQUVXZ])(\d{1,2})$/);
  const root = m ? m[1] : s;
  return TRADOVATE_ROOT_ASSETS[root] || null;
}

export function parseTradovatePerformance(text) {
  const table = parseCommaCsv(text);
  if (!table.length) return { rows: [], invalid: [], read: 0 };
  const header = table[0].map((c) => c.trim());
  const missing = TRADOVATE_REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw new Error("No es el CSV de Desempeño de Tradovate (faltan columnas: " + missing.join(", ") + ").");
  const rows = table.slice(1).map((cells, i) => {
    const rec = {};
    header.forEach((name, j) => { rec[name] = cells[j] == null ? "" : String(cells[j]).trim(); });
    return { index: i + 2, rec };
  });
  return { rows, invalid: [], read: rows.length, header };
}

export function tradovatePositionId(rec) {
  const buy = String(rec.buyFillId || "").trim(), sell = String(rec.sellFillId || "").trim();
  if (!/^\d+$/.test(buy) || !/^\d+$/.test(sell)) return null;
  return "TV-" + buy + "-" + sell;
}

/** Convierte una fila de Desempeño en el borrador de trade cerrado que usa el importador del journal. */
export function tradovateRowToDraft(rec, opts = {}) {
  const { accountId, context, timeZone } = opts;
  if (!accountId) return { ok: false, error: "accountId requerido" };
  if (!context) return { ok: false, error: "context de Account requerido" };
  if (!timeZone) return { ok: false, error: "timezone fuente requerido" };
  const position = tradovatePositionId(rec);
  if (!position) return { ok: false, error: "IDs de ejecución inválidos" };
  const brokerSymbol = String(rec.symbol || "").trim();
  const asset = mapTradovateSymbol(brokerSymbol);
  if (!asset) return { ok: false, error: "símbolo sin mapping", code: "UNKNOWN_SYMBOL", brokerSymbol, id: position };
  const qty = Number(String(rec.qty || "").trim());
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, error: "Cantidad inválida", id: position };
  const buyPrice = parsePrice(rec.buyPrice), sellPrice = parsePrice(rec.sellPrice);
  if (buyPrice == null || sellPrice == null) return { ok: false, error: "Precio inválido", id: position };
  const gross = parseTradovateMoney(rec.pnl);
  if (gross == null) return { ok: false, error: "P&L inválido", id: position };
  const bought = parseTradovateTimestamp(rec.boughtTimestamp), sold = parseTradovateTimestamp(rec.soldTimestamp);
  if (!bought || !sold) return { ok: false, error: "Fecha/hora inválida", id: position };
  // Si la venta fue primero, el trade fue corto.
  const short = sold.sortKey < bought.sortKey;
  const open = short ? sold : bought, close = short ? bought : sold;
  const opened = wallClockToIso(open.date, open.time, timeZone);
  if (!opened.ok) return { ok: false, error: "apertura: " + opened.error, id: position };
  const closed = wallClockToIso(close.date, close.time, timeZone);
  if (!closed.ok) return { ok: false, error: "cierre: " + closed.error, id: position };
  const fee = opts.feePerContract == null || opts.feePerContract === "" ? null : Number(opts.feePerContract);
  if (fee != null && (!Number.isFinite(fee) || fee < 0)) return { ok: false, error: "Comisión inválida" };
  const commission = fee == null ? null : -Math.round(fee * qty * 100) / 100;
  const netPnl = Math.round((gross + (commission || 0)) * 100) / 100;
  const result = netPnl > 0 ? "WIN" : netPnl < 0 ? "LOSS" : "BE";
  return {
    ok: true,
    draft: {
      recordSource: "MT5_EA",
      asset,
      brokerSymbol,
      context,
      direction: short ? "SHORT" : "LONG",
      accountId,
      openedAt: opened.iso,
      closedAt: closed.iso,
      entry: short ? sellPrice : buyPrice,
      exit: short ? buyPrice : sellPrice,
      lifecycle: "CLOSED",
      netPnl,
      result,
      lots: qty,
      setupId: null,
      deskSignalId: null,
      session: null,
      initialSL: null,
      currentSL: null,
      tp: null,
      commission,
      swap: fee == null ? null : 0,
      closeType: "UNKNOWN",
      strategy: "UNCLASSIFIED",
      style: null,
      variant: null,
      hasPartials: false,
      rrPlanned: null,
      riskMoney: null,
      riskPercent: null,
      importBatchId: opts.importBatchId || null,
      sourceRef: {
        kind: "TRADOVATE_PERFORMANCE",
        broker: "Tradovate",
        mt5Ticket: null,
        mt5Position: position,
        mt5Deal: null,
        mt5AccountLogin: null,
        buyFillId: String(rec.buyFillId).trim(),
        sellFillId: String(rec.sellFillId).trim(),
        grossPnl: gross,
        sourceTimeZone: timeZone,
        openedWall: `${open.date}T${open.time}`,
        closedWall: `${close.date}T${close.time}`,
        openedOriginal: open.original,
        closedOriginal: close.original,
        timePrecision: "minute",
      },
    },
  };
}
