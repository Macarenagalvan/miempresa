// Importa el CSV de Desempeño de Tradovate a una cuenta del journal.
// Reutiliza el alta de trades cerrados importados y la protección de duplicados por posición.
import { createId } from "./ids.js";
import { getAccount } from "../storage/repos/accounts.js";
import { findTradeByMt5Position, importClosedMt5Trade, amendClosedTrade } from "./trade.js";
import { listTrades } from "../storage/repos/trades.js";
import { parseTradovatePerformance, tradovateRowToDraft } from "../adapters/tradovate.js";
import { TRADOVATE_SOURCE_TIMEZONES } from "../config.js";

function checkOptions(opts) {
  if (!opts.accountId) throw new Error("Elegí la cuenta destino.");
  if (!opts.context) throw new Error("context de Account requerido");
  if (!TRADOVATE_SOURCE_TIMEZONES.includes(opts.timeZone)) throw new Error("Elegí el horario del archivo.");
}

async function mapRows(text, opts) {
  const parsed = parseTradovatePerformance(text);
  const report = { read: parsed.read, created: 0, duplicates: 0, invalid: 0, unknownSymbols: 0, errors: [], drafts: [], repeated: 0 };
  const seen = new Set();
  for (const row of parsed.rows) {
    const mapped = tradovateRowToDraft(row.rec, opts);
    if (!mapped.ok) {
      if (mapped.code === "UNKNOWN_SYMBOL") report.unknownSymbols += 1;
      report.invalid += 1;
      report.errors.push({ index: row.index, id: mapped.id || null, error: mapped.error, brokerSymbol: mapped.brokerSymbol || row.rec.symbol });
      continue;
    }
    const pos = mapped.draft.sourceRef.mt5Position;
    if (seen.has(pos)) { report.repeated += 1; report.duplicates += 1; continue; }
    seen.add(pos);
    if (await findTradeByMt5Position(opts.accountId, pos)) { report.duplicates += 1; continue; }
    report.drafts.push(mapped.draft);
    report.created += 1;
  }
  return report;
}

export async function previewTradovateCsv(text, opts = {}) {
  checkOptions(opts);
  return mapRows(text, opts);
}

export async function syncTradovateCsv(text, stageId, opts = {}) {
  checkOptions(opts);
  const account = await getAccount(opts.accountId);
  if (!account) throw new Error("account no existe");
  if (account.context !== opts.context) throw new Error("context incompatible con la Account");
  const importBatchId = opts.importBatchId || createId();
  const report = await mapRows(text, { ...opts, importBatchId });
  // Las filas inválidas se informan y se saltean; las válidas se guardan.
  for (const draft of report.drafts) await importClosedMt5Trade(draft, stageId);
  const { drafts, ...summary } = report;
  return { ...summary, importBatchId };
}

// ---------- Comisiones sobre trades de Tradovate ya importados ----------

const isTradovateTrade = (t, accountId) => t.accountId === accountId && t.lifecycle === "CLOSED" && t.sourceRef?.kind === "TRADOVATE_PERFORMANCE" && Number.isFinite(Number(t.sourceRef.grossPnl));

/** Resumen por activo de los trades de Tradovate de una cuenta: cantidad, contratos, bruto, comisiones y neto actuales. */
export async function tradovateCommissionSummary(accountId) {
  const by = new Map();
  for (const t of (await listTrades()).filter((x) => isTradovateTrade(x, accountId))) {
    const row = by.get(t.asset) || { asset: t.asset, trades: 0, contracts: 0, gross: 0, commission: 0, net: 0, feePerContract: null, mixed: false };
    const lots = Number(t.lots) || 1;
    row.trades += 1; row.contracts += lots;
    row.gross += Number(t.sourceRef.grossPnl); row.commission += Number(t.commission || 0); row.net += Number(t.netPnl);
    const fee = t.commission == null ? 0 : Math.round(-Number(t.commission) / lots * 100) / 100;
    if (row.trades === 1) row.feePerContract = fee; else if (row.feePerContract !== fee) row.mixed = true;
    by.set(t.asset, row);
  }
  const round = (v) => Math.round(v * 100) / 100;
  return [...by.values()].map((r) => ({ ...r, gross: round(r.gross), commission: round(r.commission), net: round(r.net) })).sort((a, b) => a.asset.localeCompare(b.asset));
}

/** Recalcula comisión y neto (= bruto de Tradovate − comisión × contratos). Activos sin valor no se tocan. */
export async function applyTradovateCommissions(accountId, feesByAsset = {}) {
  if (!accountId) throw new Error("Elegí la cuenta.");
  const fees = {};
  for (const [asset, raw] of Object.entries(feesByAsset)) {
    if (raw == null || String(raw).trim() === "") continue;
    const n = Number(String(raw).trim().replace(",", "."));
    if (!Number.isFinite(n) || n < 0) throw new Error("La comisión de " + asset + " tiene que ser un número mayor o igual a 0.");
    fees[asset] = n;
  }
  let updated = 0, unchanged = 0;
  for (const t of (await listTrades()).filter((x) => isTradovateTrade(x, accountId) && fees[x.asset] != null)) {
    const lots = Number(t.lots) || 1;
    const commission = -Math.round(fees[t.asset] * lots * 100) / 100;
    const netPnl = Math.round((Number(t.sourceRef.grossPnl) + commission) * 100) / 100;
    if (t.commission === commission && Number(t.netPnl) === netPnl && t.swap === 0) { unchanged += 1; continue; }
    await amendClosedTrade(t.id, { netPnl, commission, swap: 0 });
    updated += 1;
  }
  return { updated, unchanged };
}
