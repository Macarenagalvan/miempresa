// Vantage (portal web) → Journal: lee el texto copiado de «Historial de posiciones».
// Cada posición viene en bloques de líneas:
//   Buy|Sell (lado del CIERRE) · símbolo · cerrado/total · precio de cierre · precio de apertura ·
//   P&L · P&L neto · a/b (costos) · apertura <tab> cierre · #posición · estado
// La dirección del trade es la contraria al lado del cierre.
import { mapBrokerSymbolToAsset, wallClockToIso } from "./mt5.js";

const SIDE = { BUY: "BUY", SELL: "SELL", COMPRA: "BUY", COMPRAR: "BUY", VENTA: "SELL", VENDER: "SELL" };

/** "27,228.28" · "+30.09" · "-12.88" · "27.228,28" → número; null si no es un número. */
export function parseVantageNumber(raw) {
  let s = String(raw == null ? "" : raw).trim().replace(/\s/g, "").replace(/^\+/, "");
  if (!s) return null;
  const neg = s.startsWith("-") || s.startsWith("−");
  s = s.replace(/^[-−]/, "");
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

/** "19/11/2026 18:02:15" (DD/MM/YYYY) → { date, time, original } */
export function parseVantageDateTime(raw) {
  const m = String(raw || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const pad = (v) => String(v).padStart(2, "0");
  const [, d, mo, y, h, mi] = m;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  if (dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d || +h > 23) return null;
  return { date: `${y}-${pad(mo)}-${pad(d)}`, time: `${pad(h)}:${mi}`, original: String(raw).trim() };
}

/** Parte el texto pegado en posiciones. Devuelve las completas y cuántos bloques quedaron cortados. */
export function parseVantagePositionHistory(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const positions = [], errors = [];
  let truncated = 0, lastEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    const side = SIDE[lines[i].toUpperCase()];
    if (!side || !/^[A-Za-z0-9._#+-]{2,20}$/.test(lines[i + 1] || "")) continue;
    // Buscar la línea de fechas (dos fechas) y el #posición dentro del bloque.
    let j = i + 2, dates = null;
    for (; j < Math.min(lines.length, i + 14); j++) {
      const parts = lines[j].split(/\t+|\s{2,}/).map((p) => p.trim()).filter(Boolean);
      if (parts.length === 2 && parseVantageDateTime(parts[0]) && parseVantageDateTime(parts[1])) { dates = parts; break; }
      if (SIDE[lines[j].toUpperCase()] && j > i + 2) break;
    }
    const idLine = dates ? lines[j + 1] || "" : "";
    const id = (idLine.match(/^#?(\d{5,})$/) || [])[1];
    const fields = dates ? lines.slice(i + 2, j) : [];
    if (!dates || !id || fields.length < 5) { truncated += 1; continue; }
    const [volume, closeRaw, openRaw, pnlRaw, netRaw, costsRaw] = fields;
    const vol = String(volume).split("/").map(parseVantageNumber);
    const closePrice = parseVantageNumber(closeRaw), openPrice = parseVantageNumber(openRaw);
    const pnl = parseVantageNumber(pnlRaw), net = netRaw == null ? pnl : parseVantageNumber(netRaw);
    const costs = costsRaw && /\//.test(costsRaw) ? costsRaw.split("/").map(parseVantageNumber) : null;
    const status = lines[j + 2] || "";
    const opened = parseVantageDateTime(dates[0]), closed = parseVantageDateTime(dates[1]);
    const rec = { id, closeSide: side, symbol: lines[i + 1], lots: vol[0], totalLots: vol[1] ?? vol[0], closePrice, openPrice, pnl, net, costs, opened, closed, status };
    if ([rec.lots, closePrice, openPrice, net].some((v) => v == null)) errors.push({ id, error: "números ilegibles" });
    else positions.push(rec);
    i = j + 1;
    lastEnd = /^[A-Za-zÁ-ú]+$/.test(status) && !SIDE[status.toUpperCase()] ? j + 2 : j + 1;
  }
  if (positions.length && lastEnd < lines.length - 1) truncated += 1;
  return { positions, errors, truncated };
}

/**
 * Dirección del trade. Manda la plata: si el precio subió y se ganó (o bajó y se perdió) fue LONG; al revés, SHORT.
 * El texto Buy/Sell de Vantage no siempre es el lado del cierre, así que solo se usa si el precio o el P&L son 0.
 */
export function vantageDirection(p) {
  const move = Number(p.closePrice) - Number(p.openPrice);
  const money = Number(p.pnl ?? p.net);
  if (Number.isFinite(move) && Number.isFinite(money) && move !== 0 && money !== 0) return move * money > 0 ? "LONG" : "SHORT";
  return p.closeSide === "BUY" ? "SHORT" : "LONG";
}

export function vantagePositionToDraft(p, opts = {}) {
  const { accountId, context, timeZone } = opts;
  if (!accountId) return { ok: false, error: "accountId requerido" };
  if (!context) return { ok: false, error: "context de Account requerido" };
  const asset = mapBrokerSymbolToAsset(p.symbol);
  if (!asset) return { ok: false, error: "símbolo sin mapping", code: "UNKNOWN_SYMBOL", brokerSymbol: p.symbol, id: p.id };
  const opened = wallClockToIso(p.opened.date, p.opened.time, timeZone);
  if (!opened.ok) return { ok: false, error: "apertura: " + opened.error, id: p.id };
  const closed = wallClockToIso(p.closed.date, p.closed.time, timeZone);
  if (!closed.ok) return { ok: false, error: "cierre: " + closed.error, id: p.id };
  if (closed.iso < opened.iso) return { ok: false, error: "cierre anterior a la apertura", id: p.id };
  const netPnl = Math.round(p.net * 100) / 100;
  const gross = p.pnl == null ? null : Math.round(p.pnl * 100) / 100;
  const costs = gross == null ? null : Math.round((netPnl - gross) * 100) / 100;
  return {
    ok: true,
    draft: {
      recordSource: "MT5_EA",
      asset,
      brokerSymbol: p.symbol,
      context,
      direction: vantageDirection(p),
      accountId,
      openedAt: opened.iso,
      closedAt: closed.iso,
      entry: p.openPrice,
      exit: p.closePrice,
      lifecycle: "CLOSED",
      netPnl,
      result: netPnl > 0 ? "WIN" : netPnl < 0 ? "LOSS" : "BE",
      lots: p.lots,
      setupId: null,
      deskSignalId: null,
      session: null,
      initialSL: null,
      currentSL: null,
      tp: null,
      commission: costs,
      swap: costs == null ? null : 0,
      closeType: "UNKNOWN",
      strategy: "UNCLASSIFIED",
      style: null,
      variant: null,
      hasPartials: p.totalLots != null && p.lots != null && p.totalLots !== p.lots,
      rrPlanned: null,
      riskMoney: null,
      riskPercent: null,
      importBatchId: opts.importBatchId || null,
      sourceRef: {
        kind: "VANTAGE_POSITION_HISTORY",
        broker: "Vantage",
        mt5Ticket: null,
        mt5Position: p.id,
        mt5Deal: null,
        mt5AccountLogin: null,
        grossPnl: gross,
        sourceTimeZone: timeZone,
        openedWall: `${p.opened.date}T${p.opened.time}`,
        closedWall: `${p.closed.date}T${p.closed.time}`,
        openedOriginal: p.opened.original,
        closedOriginal: p.closed.original,
        timePrecision: "minute",
      },
    },
  };
}
