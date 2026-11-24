// Exportar operaciones/backtests a CSV o Excel, e importar backtests desde CSV o Excel.
import { buildXlsx, readXlsx, excelSerial, serialToDay, XS } from "./xlsx.js";
import { realizedR } from "../domain/stats.js";
import { strategyLabel, Strategy, Style } from "../domain/enums.js";
import { SESSIONS, ALL_SESSIONS, sessionLabel } from "../config.js";
import { FAMILIES, CONFLUENCES, EMOTIONS, PLAN, ERRORS, labelOf } from "../domain/process.js";

// ---------- formato ----------
const CONTEXT_LABEL = { BACKTEST: "Backtest", LIVE: "Cuenta propia", DEMO: "Demo", PROP_CHALLENGE: "Evaluación", FUNDED: "Fondeada" };
const DIR_LABEL = { LONG: "LONG", SHORT: "SHORT" };
const pad = (n) => String(n).padStart(2, "0");

function localParts(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { d, day: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

function dayOf(trade) {
  if (trade.sourceRef?.sessionDate) return trade.sourceRef.sessionDate;
  const p = localParts(trade.openedAt || trade.closedAt);
  return p ? `${p.d.getFullYear()}-${pad(p.d.getMonth() + 1)}-${pad(p.d.getDate())}` : null;
}

function dayToDisplay(day) {
  if (!day) return "";
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

function dayToSerial(day) {
  if (!day) return null;
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000 + 25569;
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function statusLabel(t) {
  if (t.lifecycle === "VOID") return "Anulada";
  if (t.isDraft) return "Borrador";
  if (t.lifecycle === "OPEN") return "Abierta";
  return "Cerrada";
}

function originLabel(t) {
  if (t.sourceRef?.sessionDate) return "Carga rápida";
  if (t.sourceRef?.kind === "BACKTEST_JSON") return "JSON";
  if (t.sourceRef?.kind === "TABLE_IMPORT") return "CSV / Excel";
  if (t.sourceRef?.kind === "TRADOVATE_PERFORMANCE") return "Tradovate";
  if (t.sourceRef?.kind === "VANTAGE_POSITION_HISTORY") return "Portal web";
  if (t.recordSource === "MT5_EA" || t.sourceRef?.mt5Position) return "MT5";
  return "Manual";
}

// type: text | day | time | num | money | r | result
function columns(kind, accountsById) {
  const acc = (t) => accountsById[t.accountId];
  const base = [
    { h: "Fecha", w: 12, type: "day", get: dayOf },
  ];
  if (kind === "operaciones") {
    base.push(
      { h: "Hora entrada", w: 11, type: "time", get: (t) => localParts(t.openedAt)?.time || null, iso: (t) => t.openedAt },
      { h: "Fecha cierre", w: 12, type: "day", get: (t) => { const p = localParts(t.closedAt); return p ? `${p.d.getFullYear()}-${pad(p.d.getMonth() + 1)}-${pad(p.d.getDate())}` : null; } },
      { h: "Hora cierre", w: 11, type: "time", get: (t) => localParts(t.closedAt)?.time || null },
      { h: "Tipo", w: 14, type: "text", get: (t) => CONTEXT_LABEL[t.context] || t.context },
      { h: "Cuenta", w: 18, type: "text", get: (t) => acc(t)?.name || "" },
    );
  }
  base.push(
    { h: "Activo", w: 12, type: "text", get: (t) => t.asset || "" },
    { h: "Dirección", w: 10, type: "text", get: (t) => DIR_LABEL[t.direction] || t.direction || "" },
    { h: "Resultado", w: 11, type: "result", get: (t) => t.result || (t.studyOutcome === "NO_TRADE" ? "NO TRADE" : "") },
    { h: "R", w: 8, type: "r", get: (t) => (t.lifecycle === "CLOSED" ? num(realizedR(t)) : null) },
  );
  if (kind === "operaciones") {
    base.push(
      { h: "Neto", w: 12, type: "money", get: (t) => num(t.netPnl) },
      { h: "Moneda", w: 8, type: "text", get: (t) => acc(t)?.currency || "" },
      { h: "Estado", w: 11, type: "text", get: statusLabel },
      { h: "Entrada", w: 11, type: "num", get: (t) => num(t.entry) },
      { h: "SL", w: 11, type: "num", get: (t) => num(t.initialSL) },
      { h: "TP", w: 11, type: "num", get: (t) => num(t.tp) },
      { h: "Salida", w: 11, type: "num", get: (t) => num(t.exit) },
      { h: "Lotes", w: 8, type: "num", get: (t) => num(t.lots) },
      { h: "Comisión", w: 10, type: "money", get: (t) => num(t.commission) },
      { h: "Swap", w: 9, type: "money", get: (t) => num(t.swap) },
      { h: "Riesgo %", w: 9, type: "num", get: (t) => num(t.riskPercent) },
      { h: "RR planificado", w: 10, type: "num", get: (t) => num(t.rrPlanned) },
    );
  }
  base.push(
    { h: "Estrategia", w: 13, type: "text", get: (t) => (t.strategy && t.strategy !== "UNCLASSIFIED" ? strategyLabel(t.strategy) : "") },
    { h: "Estilo", w: 9, type: "text", get: (t) => t.style || "" },
    { h: "Sesión", w: 11, type: "text", get: (t) => sessionLabel(t.session) },
    { h: "Setup", w: 13, type: "text", get: (t) => (t.process?.family ? labelOf(FAMILIES, t.process.family) : "") },
    { h: "Plan", w: 9, type: "text", get: (t) => (t.process?.plan ? labelOf(PLAN, t.process.plan) : "") },
    ...(kind === "operaciones" ? [{ h: "Emoción", w: 12, type: "text", get: (t) => (t.process?.emotion ? labelOf(EMOTIONS, t.process.emotion) : "") }] : []),
    { h: "Confluencias", w: 30, type: "text", get: (t) => (t.process?.confluences || []).map((c) => labelOf(CONFLUENCES, c)).join(", ") },
    { h: "Errores", w: 26, type: "text", get: (t) => (t.process?.errors || []).map((e) => labelOf(ERRORS, e)).join(", ") },
    { h: "Notas", w: 42, type: "text", get: (t) => [t.note, t.management].filter(Boolean).join(" · ") },
    { h: "Origen", w: 12, type: "text", get: originLabel },
    { h: "ID", w: 10, type: "text", get: (t) => t.id || "" },
  );
  return base;
}

function sortRows(rows) {
  return rows.slice().sort((a, b) => String(dayOf(a) || a.date || "").localeCompare(String(dayOf(b) || b.date || "")) || String(a.openedAt || a.createdAt || "").localeCompare(String(b.openedAt || b.createdAt || "")));
}

function studyAsRow(o) {
  return { id: o.id, asset: o.asset, direction: o.bias === "NEUTRAL" ? null : o.bias, studyOutcome: o.studyOutcome, note: o.note, sourceRef: { sessionDate: o.date }, session: o.session };
}

function summaryRows(trades, kind) {
  const closed = trades.filter((t) => t.lifecycle === "CLOSED");
  const wins = closed.filter((t) => t.result === "WIN").length;
  const losses = closed.filter((t) => t.result === "LOSS").length;
  const be = closed.filter((t) => t.result === "BE").length;
  const rs = closed.map((t) => num(realizedR(t))).filter((r) => r != null);
  const rTotal = rs.reduce((s, r) => s + r, 0);
  const net = closed.map((t) => num(t.netPnl)).filter((v) => v != null);
  const decided = wins + losses;
  const now = new Date();
  const rows = [
    [{ v: "Journal · " + (kind === "operaciones" ? "Operaciones" : "Backtesting"), s: XS.TITLE }],
    [{ v: "Disciplina · Paciencia · Resultados", s: XS.LABEL }],
    [],
    [{ v: "Generado", s: XS.LABEL }, { v: excelSerial(now), s: XS.DATETIME }],
    [{ v: "Registros", s: XS.LABEL }, trades.length],
    [{ v: "Cerrados", s: XS.LABEL }, closed.length],
    [{ v: "Ganados", s: XS.LABEL }, { v: wins, s: XS.WIN }],
    [{ v: "Perdidos", s: XS.LABEL }, { v: losses, s: XS.LOSS }],
    [{ v: "Break even", s: XS.LABEL }, { v: be, s: XS.BE }],
    [{ v: "Winrate (sin BE)", s: XS.LABEL }, decided ? { v: Math.round((wins / decided) * 1000) / 10 + " %" } : "—"],
    [{ v: "R total", s: XS.LABEL }, rs.length ? { v: rTotal, s: rTotal >= 0 ? XS.R_WIN : XS.R_LOSS } : "—"],
    [{ v: "R promedio (expectativa)", s: XS.LABEL }, rs.length ? { v: rTotal / rs.length, s: XS.R } : "—"],
    [{ v: "R calculado sobre", s: XS.LABEL }, `${rs.length} registros con R`],
  ];
  if (kind === "operaciones") rows.push([{ v: "Neto total", s: XS.LABEL }, net.length ? { v: net.reduce((s, v) => s + v, 0), s: XS.MONEY } : "—"]);
  return rows;
}

function xlsxCell(col, t) {
  const v = col.get(t);
  if (v == null || v === "") return null;
  switch (col.type) {
    case "day": return { v: dayToSerial(v), s: XS.DATE };
    case "time": return { v, s: XS.DEFAULT };
    case "num": return { v, s: XS.NUM };
    case "money": return { v, s: XS.MONEY };
    case "r": return { v, s: v > 0 ? XS.R_WIN : v < 0 ? XS.R_LOSS : XS.R };
    case "result": return { v, s: v === "WIN" ? XS.WIN : v === "LOSS" ? XS.LOSS : v === "BE" ? XS.BE : XS.DEFAULT };
    default: return { v: String(v) };
  }
}

function csvValue(col, t) {
  const v = col.get(t);
  if (v == null) return "";
  if (col.type === "day") return dayToDisplay(v);
  if (typeof v === "number") return String(v).replace(".", ",");
  const s = String(v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * kind: "operaciones" | "backtests"; format: "csv" | "xlsx"
 * studies: estudios NO TRADE a incluir (solo backtests)
 */
export function exportRecords({ trades, studies = [], accounts = [], kind = "operaciones", format = "xlsx" }) {
  const accountsById = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const cols = columns(kind, accountsById);
  const rows = sortRows([...trades, ...studies.map(studyAsRow)]);
  const base = `journal-${kind}-${stamp()}`;
  if (format === "csv") {
    const lines = [cols.map((c) => c.h).join(";"), ...rows.map((t) => cols.map((c) => csvValue(c, t)).join(";"))];
    download(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), base + ".csv");
    return rows.length;
  }
  const sheet = {
    name: kind === "operaciones" ? "Operaciones" : "Backtests",
    rows: [cols.map((c) => ({ v: c.h, s: XS.HEADER })), ...rows.map((t) => cols.map((c) => xlsxCell(c, t)))],
    widths: cols.map((c) => c.w),
    freeze: 1,
    filter: true,
    rowHeights: { 0: 22 },
  };
  const summary = { name: "Resumen", rows: summaryRows(trades, kind), widths: [28, 22] };
  download(buildXlsx([sheet, summary]), base + ".xlsx");
  return rows.length;
}

/** Plantilla vacía para cargar backtests en Excel. */
export function downloadBacktestTemplate() {
  const heads = ["Fecha", "Activo", "Dirección", "Resultado", "R", "Estrategia", "Estilo", "Sesión", "Notas"];
  const help = [
    [{ v: "Cómo completar la plantilla", s: XS.TITLE }],
    [],
    [{ v: "Fecha", s: XS.LABEL }, "Día de la sesión histórica. Ej.: 14/11/2026 o 2026-11-14"],
    [{ v: "Activo", s: XS.LABEL }, "Ej.: NAS100, XAUUSD, MNQ"],
    [{ v: "Dirección", s: XS.LABEL }, "LONG o SHORT (también sirve Compra / Venta)"],
    [{ v: "Resultado", s: XS.LABEL }, "WIN, LOSS, BE o NO TRADE"],
    [{ v: "R", s: XS.LABEL }, "Opcional. Positivo en WIN, negativo en LOSS, 0 en BE. Ej.: 2 · -1 · 1,5"],
    [{ v: "Estrategia", s: XS.LABEL }, "Opcional: " + Object.values(Strategy).filter((s) => s !== "UNCLASSIFIED").map(strategyLabel).join(", ")],
    [{ v: "Estilo", s: XS.LABEL }, "Opcional: " + Object.values(Style).join(", ")],
    [{ v: "Sesión", s: XS.LABEL }, "Opcional: Asia, Londres, NY AM, NY PM"],
    [{ v: "Notas", s: XS.LABEL }, "Opcional. Texto libre."],
    [],
    ["Completá la hoja «Backtests» (una fila por backtest) y después usá Importar en la pantalla Backtesting."],
    ["Antes de guardar vas a ver una vista previa. Lo repetido se marca y no se carga, salvo que lo pidas."],
  ];
  download(buildXlsx([
    { name: "Backtests", rows: [heads.map((h) => ({ v: h, s: XS.HEADER }))], widths: [12, 12, 10, 11, 8, 13, 9, 11, 42], freeze: 1, rowHeights: { 0: 22 } },
    { name: "Cómo completar", rows: help, widths: [16, 90] },
  ]), "plantilla-backtests.xlsx");
}

// ---------- importación ----------
function fold(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

const HEADER_KEYS = {
  date: ["fecha", "date", "fecha de sesion", "fecha de sesion historica", "dia", "sessiondate", "data"],
  asset: ["activo", "asset", "simbolo", "symbol", "instrumento"],
  direction: ["direccion", "direction", "lado", "side", "tipo de orden"],
  result: ["resultado", "result", "outcome", "esito"],
  r: ["r", "resultado en r", "r realizado", "rr", "rr realizado", "r multiple"],
  strategy: ["estrategia", "strategy", "setup", "color"],
  style: ["estilo", "style"],
  session: ["sesion", "session"],
  note: ["notas", "nota", "note", "notes", "comentario", "comentarios"],
  type: ["tipo", "context", "contexto"],
};

function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((cell, i) => {
    const key = fold(cell);
    for (const [field, names] of Object.entries(HEADER_KEYS)) {
      if (names.includes(key) && map[field] == null) map[field] = i;
    }
  });
  return map;
}

function parseCsv(text) {
  const clean = text.replace(/^﻿/, "");
  const first = clean.split(/\r?\n/, 1)[0] || "";
  const delim = [";", "\t", ","].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function parseDay(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v > 20000 && v < 80000 ? serialToDay(v) : null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  if (/^\d{5}(\.\d+)?$/.test(s)) return serialToDay(Number(s));
  return null;
  function valid(y, mo, d) {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
}

function parseNumber(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const s = String(v).trim().replace(/\s/g, "").replace(/^\+/, "").replace(/r$/i, "");
  if (!s) return null;
  const normalized = s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function parseDirection(v) {
  const s = fold(v);
  if (!s) return null;
  if (["long", "buy", "compra", "alcista", "acquisto"].includes(s)) return "LONG";
  if (["short", "sell", "venta", "bajista", "vendita"].includes(s)) return "SHORT";
  return undefined;
}

function parseResult(v) {
  const s = fold(v).replace(/[_\s-]+/g, " ");
  if (!s) return null;
  if (["win", "w", "ganada", "ganado", "ganancia", "tp", "profit"].includes(s)) return "WIN";
  if (["loss", "l", "perdida", "perdido", "sl", "stop"].includes(s)) return "LOSS";
  if (["be", "breakeven", "break even", "empate"].includes(s)) return "BE";
  if (["no trade", "notrade", "nt", "sin entrada", "no entrada"].includes(s)) return "NO_TRADE";
  return undefined;
}

function parseStrategy(v) {
  const s = fold(v).replace(/\s+/g, "_").toUpperCase();
  if (!s) return null;
  return Object.values(Strategy).includes(s) ? s : undefined;
}

function parseStyle(v) {
  const s = fold(v).toUpperCase();
  if (!s) return null;
  const alias = { DAYTRADING: "DAY", "DAY TRADING": "DAY", SCALPING: "SCALP" };
  const out = alias[s] || s;
  return Object.values(Style).includes(out) ? out : undefined;
}

function parseSession(v) {
  const s = fold(v).replace(/[\s-]+/g, "_").toUpperCase();
  if (!s) return null;
  const alias = { LONDRES: "LONDON", LONDRA: "LONDON", ASIA: "ASIA", TOKIO: "TOKYO", NY_AM: "NY_AM", NYAM: "NY_AM", NY_PM: "NY_PM", NYPM: "NY_PM", NUEVA_YORK: "NEW_YORK", NY: "NEW_YORK", NEWYORK: "NEW_YORK" };
  const out = alias[s] || s;
  return ALL_SESSIONS.includes(out) ? out : undefined;
}

/** Lee un archivo CSV o XLSX y devuelve filas normalizadas con su estado. */
export async function readBacktestTable(file) {
  const name = file.name || "";
  let rows;
  if (/\.xlsx$/i.test(name)) rows = await readXlsx(file);
  else if (/\.(csv|txt|tsv)$/i.test(name)) rows = parseCsv(await file.text());
  else throw new Error("Elegí un archivo .csv o .xlsx.");
  const headerAt = rows.findIndex((r) => { const m = mapHeaders(r || []); return m.date != null && m.asset != null; });
  if (headerAt < 0) throw new Error("No encontré los encabezados. La primera fila necesita al menos «Fecha» y «Activo». Descargá la plantilla para ver el formato.");
  const map = mapHeaders(rows[headerAt]);
  if (map.result == null && map.r == null) throw new Error("Falta la columna «Resultado» (o «R»).");
  const items = [];
  for (let i = headerAt + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const get = (f) => (map[f] == null ? null : r[map[f]]);
    if (!r.some((v) => v != null && String(v).trim() !== "")) continue;
    const line = i + 1;
    const issues = [], notes = [];
    const typeRaw = fold(get("type"));
    if (typeRaw && !["backtest", "bt", ""].includes(typeRaw)) {
      items.push({ line, status: "skip", issues: ["No es un backtest (las operaciones reales se importan desde MT5)."], data: { asset: String(get("asset") ?? ""), date: parseDay(get("date")) } });
      continue;
    }
    const date = parseDay(get("date"));
    if (!date) issues.push("Fecha inválida");
    const asset = String(get("asset") ?? "").trim().toUpperCase();
    if (!asset) issues.push("Falta el activo");
    let direction = parseDirection(get("direction"));
    if (direction === undefined) { issues.push("Dirección inválida"); direction = null; }
    let rValue = parseNumber(get("r"));
    if (Number.isNaN(rValue)) { issues.push("R no es un número"); rValue = null; }
    let result = parseResult(get("result"));
    if (result === undefined) { issues.push("Resultado inválido (usá WIN, LOSS, BE o NO TRADE)"); result = null; }
    if (result == null && rValue != null) { result = rValue > 0 ? "WIN" : rValue < 0 ? "LOSS" : "BE"; notes.push("Resultado deducido del R"); }
    if (result == null && !issues.length) issues.push("Falta el resultado");
    if (result === "LOSS" && rValue > 0) { rValue = -rValue; notes.push("R pasado a negativo"); }
    if (result === "WIN" && rValue != null && rValue <= 0) issues.push("WIN con R negativo o cero");
    if (result === "BE" && rValue != null && rValue !== 0) issues.push("BE debe tener R 0");
    if (result !== "NO_TRADE" && result && !direction) issues.push("Falta la dirección");
    let strategy = parseStrategy(get("strategy"));
    if (strategy === undefined) { notes.push(`Estrategia «${get("strategy")}» no reconocida: queda sin clasificar`); strategy = null; }
    let style = parseStyle(get("style"));
    if (style === undefined) { notes.push("Estilo no reconocido"); style = null; }
    let session = parseSession(get("session"));
    if (session === undefined) { notes.push("Sesión no reconocida"); session = null; }
    const note = String(get("note") ?? "").trim();
    items.push({
      line, issues, notes,
      status: issues.length ? "error" : "new",
      data: { date, asset, direction, result, r: result === "NO_TRADE" ? null : rValue, strategy, style, session, note },
    });
  }
  if (!items.length) throw new Error("El archivo no tiene filas para importar.");
  return items;
}

export function backtestKey(d) {
  return [d.date, String(d.asset || "").toUpperCase(), d.direction || "", d.result || "", d.r == null ? "" : Number(d.r).toFixed(4)].join("|");
}
