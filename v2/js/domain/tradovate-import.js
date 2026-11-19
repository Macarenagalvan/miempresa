// Importa el CSV de Desempeño de Tradovate a una cuenta del journal.
// Reutiliza el alta de trades cerrados importados y la protección de duplicados por posición.
import { createId } from "./ids.js";
import { getAccount } from "../storage/repos/accounts.js";
import { findTradeByMt5Position, importClosedMt5Trade } from "./trade.js";
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
  if (report.invalid) throw new Error("El archivo tiene filas inválidas; no se guardó nada.");
  for (const draft of report.drafts) await importClosedMt5Trade(draft, stageId);
  const { drafts, ...summary } = report;
  return { ...summary, importBatchId };
}
