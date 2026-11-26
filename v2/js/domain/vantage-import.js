// Importa el «Historial de posiciones» copiado del portal de Vantage a una cuenta del journal.
import { createId, nowIso } from "./ids.js";
import { getAccount } from "../storage/repos/accounts.js";
import { findTradeByMt5Position, importClosedMt5Trade } from "./trade.js";
import { parseVantagePositionHistory, vantagePositionToDraft } from "../adapters/vantage-paste.js";
import { MT5_SOURCE_TIMEZONES } from "../config.js";
import { vantageDirection } from "../adapters/vantage-paste.js";
import { listTrades, putTrade } from "../storage/repos/trades.js";
import { assertTrade } from "./integrity.js";

function checkOptions(opts) {
  if (!opts.accountId) throw new Error("Elegí la cuenta destino.");
  if (!opts.context) throw new Error("context de Account requerido");
  if (!MT5_SOURCE_TIMEZONES.includes(opts.timeZone)) throw new Error("Elegí el horario del servidor.");
}

async function mapRows(text, opts) {
  const parsed = parseVantagePositionHistory(text);
  const report = { read: parsed.positions.length + parsed.errors.length, created: 0, duplicates: 0, invalid: parsed.errors.length, unknownSymbols: 0, truncated: parsed.truncated, errors: parsed.errors.slice(), drafts: [] };
  const seen = new Set();
  for (const p of parsed.positions) {
    const mapped = vantagePositionToDraft(p, opts);
    if (!mapped.ok) {
      if (mapped.code === "UNKNOWN_SYMBOL") report.unknownSymbols += 1;
      report.invalid += 1;
      report.errors.push({ id: p.id, error: mapped.error, brokerSymbol: p.symbol });
      continue;
    }
    if (seen.has(p.id)) { report.duplicates += 1; continue; }
    seen.add(p.id);
    if (await findTradeByMt5Position(opts.accountId, p.id)) { report.duplicates += 1; continue; }
    report.drafts.push(mapped.draft);
    report.created += 1;
  }
  return report;
}

export async function previewVantagePaste(text, opts = {}) {
  checkOptions(opts);
  return mapRows(text, opts);
}

export async function syncVantagePaste(text, stageId, opts = {}) {
  checkOptions(opts);
  const account = await getAccount(opts.accountId);
  if (!account) throw new Error("account no existe");
  if (account.context !== opts.context) throw new Error("context incompatible con la Account");
  const importBatchId = opts.importBatchId || createId();
  const report = await mapRows(text, { ...opts, importBatchId });
  // Las posiciones que no se pudieron leer se informan y se saltean; las válidas se guardan.
  for (const draft of report.drafts) await importClosedMt5Trade({ ...draft, importBatchId }, stageId);
  const { drafts, ...summary } = report;
  return { ...summary, importBatchId };
}

/**
 * Corrige la dirección de los trades de Vantage ya importados cuando contradice precio y P&L
 * (versiones anteriores leían el Buy/Sell de Vantage al revés). Se puede correr siempre: si no hay nada que corregir, no escribe.
 */
export async function repairVantageDirections() {
  let fixed = 0;
  for (const t of await listTrades()) {
    if (t.sourceRef?.kind !== "VANTAGE_POSITION_HISTORY") continue;
    const right = vantageDirection({ openPrice: t.entry, closePrice: t.exit, pnl: t.sourceRef.grossPnl ?? t.netPnl, closeSide: t.direction === "SHORT" ? "BUY" : "SELL" });
    if (right === t.direction) continue;
    const next = { ...t, direction: right, updatedAt: nowIso() };
    assertTrade(next);
    await putTrade(next);
    fixed++;
  }
  return fixed;
}
