import { Direction, Result, Lifecycle } from "../domain/enums.js";
import { MT5_BROKER_SYMBOL_MAP, MT5_SOURCE_TIMEZONES } from "../config.js";

export const MT5_CSV_COLUMNS = Object.freeze([
  "ID", "Fecha", "Hora", "Fecha salida", "Hora salida", "Duracion", "Cuenta", "Modo",
  "Estrategia", "Variante", "Tipo", "Direccion", "Orden", "Activo", "Mercado", "Sesion",
  "Entrada", "SL", "TP", "Salida", "SL tecnico", "TP tecnico", "Fibonacci", "Confirmaciones",
  "Patron", "Gestion", "Capital inicial", "Capital final", "Riesgo $", "Riesgo %",
  "RR Inicial", "RR Final", "B/P Bruto", "Comisiones", "B/P Neto", "Resultado", "Lotaje",
  "Link", "Notas",
]);

const CANONICAL_ASSETS = Object.freeze([
  "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD",
  "EURGBP", "EURJPY", "GBPJPY", "XAUUSD", "BTCUSD", "ETHUSD", "SP500",
]);

export function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  const text = String(line == null ? "" : line);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") {
          cur += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === "\"") {
      inQuotes = true;
    } else if (ch === ";") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function splitLines(text) {
  return String(text || "").split(/\r\n|\n|\r/);
}

export function parseMt5Csv(text) {
  const rawLines = splitLines(text);
  const rows = [];
  const invalid = [];
  let header = null;
  let read = 0;
  rawLines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (/^sep\s*=\s*;/i.test(trimmed)) return;
    const cols = parseCsvLine(line.replace(/\r$/, ""));
    if (!header) {
      header = cols.map((c) => String(c).trim());
      if (header.length !== 39) {
        invalid.push({ index, error: "header no tiene 39 columnas", line: trimmed });
      }
      return;
    }
    read += 1;
    if (cols.length !== 39) {
      invalid.push({ index, error: "fila no tiene 39 columnas", line: trimmed });
      return;
    }
    const rec = {};
    MT5_CSV_COLUMNS.forEach((name, i) => {
      rec[name] = cols[i] == null ? "" : String(cols[i]);
    });
    rows.push({ index, rec });
  });
  return { rows, invalid, read, header };
}

export function normalizeBrokerSymbol(raw) {
  return String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function mapBrokerSymbolToAsset(raw) {
  const upper = normalizeBrokerSymbol(raw);
  if (!upper) return null;
  if (Object.prototype.hasOwnProperty.call(MT5_BROKER_SYMBOL_MAP, upper)) {
    return MT5_BROKER_SYMBOL_MAP[upper];
  }
  const compact = upper.replace(/[._-]/g, "");
  if (Object.prototype.hasOwnProperty.call(MT5_BROKER_SYMBOL_MAP, compact)) {
    return MT5_BROKER_SYMBOL_MAP[compact];
  }
  for (const asset of CANONICAL_ASSETS) {
    if (upper === asset || compact === asset) return asset;
    if (upper === asset + "C" || compact === asset + "C") return asset;
    if (upper === asset + "M" || compact === asset + "M") return asset;
    if (upper.startsWith(asset + ".") || upper.startsWith(asset + "-")) return asset;
  }
  return null;
}

export function mapMt5Side(raw) {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "LONG") return Direction.LONG;
  if (v === "SHORT") return Direction.SHORT;
  return null;
}

export function mapMt5Result(raw) {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "WIN") return Result.WIN;
  if (v === "LOSS") return Result.LOSS;
  if (v === "BE") return Result.BE;
  return null;
}

function finiteNum(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function tzParts(ms, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

export function isAllowedMt5Timezone(timeZone) {
  return MT5_SOURCE_TIMEZONES.includes(timeZone);
}

export function wallClockToIso(dateStr, timeStr, timeZone) {
  if (!timeZone) return { ok: false, error: "timezone fuente requerido" };
  if (!isAllowedMt5Timezone(timeZone)) return { ok: false, error: "timezone fuente no permitido" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) return { ok: false, error: "fecha inválida" };
  if (!/^\d{2}:\d{2}$/.test(String(timeStr || ""))) return { ok: false, error: "hora inválida" };
  const [y, mo, d] = String(dateStr).split("-").map(Number);
  const [hh, mm] = String(timeStr).split(":").map(Number);
  let guess = Date.UTC(y, mo - 1, d, hh, mm, 0);
  for (let i = 0; i < 4; i++) {
    const p = tzParts(guess, timeZone);
    const got = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
    const want = Date.UTC(y, mo - 1, d, hh, mm, 0);
    const delta = want - got;
    if (delta === 0) break;
    guess += delta;
  }
  const check = tzParts(guess, timeZone);
  if (check.year !== y || check.month !== mo || check.day !== d || check.hour !== hh || check.minute !== mm) {
    return { ok: false, error: "timezone no pudo resolver wall-clock" };
  }
  return {
    ok: true,
    iso: new Date(guess).toISOString(),
    wall: `${dateStr}T${timeStr}`,
    precision: "minute",
  };
}

export function dedupKey(accountId, mt5Position) {
  if (!accountId || mt5Position == null || mt5Position === "") return null;
  return String(accountId) + "::" + String(mt5Position);
}

export function toTradeDraft(rec, opts = {}) {
  const accountId = opts.accountId;
  const timeZone = opts.timeZone;
  const context = opts.context;
  if (!accountId) return { ok: false, error: "accountId requerido" };
  if (!context) return { ok: false, error: "context de Account requerido" };
  if (!timeZone) return { ok: false, error: "timezone fuente requerido" };
  const mt5Position = rec && rec.ID != null ? String(rec.ID).trim() : "";
  if (!mt5Position) return { ok: false, error: "ID ausente" };
  const brokerSymbol = rec && rec.Activo ? String(rec.Activo).trim() : "";
  if (!brokerSymbol) return { ok: false, error: "Activo ausente" };
  const asset = mapBrokerSymbolToAsset(brokerSymbol);
  if (!asset) return { ok: false, error: "símbolo sin mapping", code: "UNKNOWN_SYMBOL", brokerSymbol };
  const direction = mapMt5Side(rec && rec.Direccion);
  if (!direction) return { ok: false, error: "Direccion inválida" };
  const opened = wallClockToIso(rec.Fecha, rec.Hora, timeZone);
  if (!opened.ok) return { ok: false, error: "openedAt: " + opened.error };
  const closed = wallClockToIso(rec["Fecha salida"], rec["Hora salida"], timeZone);
  if (!closed.ok) return { ok: false, error: "closedAt: " + closed.error };
  const entry = finiteNum(rec.Entrada);
  const exit = finiteNum(rec.Salida);
  const netPnl = finiteNum(rec["B/P Neto"]);
  const lots = finiteNum(rec.Lotaje);
  const result = mapMt5Result(rec.Resultado);
  if (entry == null) return { ok: false, error: "Entrada inválida" };
  if (exit == null) return { ok: false, error: "Salida inválida" };
  if (netPnl == null) return { ok: false, error: "B/P Neto inválido" };
  if (result == null) return { ok: false, error: "Resultado inválido" };
  return {
    ok: true,
    draft: {
      recordSource: "MT5_EA",
      asset,
      brokerSymbol,
      context,
      direction,
      accountId,
      openedAt: opened.iso,
      closedAt: closed.iso,
      entry,
      exit,
      lifecycle: Lifecycle.CLOSED,
      netPnl,
      result,
      lots,
      setupId: null,
      deskSignalId: null,
      session: null,
      initialSL: null,
      currentSL: null,
      tp: null,
      commission: null,
      swap: null,
      closeType: "UNKNOWN",
      strategy: "UNCLASSIFIED",
      style: null,
      variant: null,
      hasPartials: false,
      importBatchId: opts.importBatchId || null,
      sourceRef: {
        mt5Ticket: null,
        mt5Position,
        mt5Deal: null,
        mt5AccountLogin: null,
        sourceTimeZone: timeZone,
        openedWall: opened.wall,
        closedWall: closed.wall,
        timePrecision: "minute",
      },
      costsCombinedRaw: rec.Comisiones === "" ? null : rec.Comisiones,
    },
  };
}

export function parseHtmlHistory() {
  throw new Error("MT5 HTML history no forma parte del contrato Slice 11");
}
