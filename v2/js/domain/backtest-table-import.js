// Importación de backtests desde CSV / Excel (filas ya leídas por table-io).
import { listTrades } from "../storage/repos/trades.js";
import { listActiveObservations, saveStudy } from "./observation.js";
import { createClosedTrade } from "./trade-journal.js";
import { backtestKey } from "../services/table-io.js";

/** Marca como "dup" lo que ya está en el journal o se repite dentro del archivo. */
export async function classifyBacktestItems(items, stageId) {
  const trades = (await listTrades()).filter((t) => t.lifecycle !== "VOID" && t.context === "BACKTEST" && t.sourceRef?.sessionDate);
  const known = new Set(trades.map((t) => backtestKey({ date: t.sourceRef.sessionDate, asset: t.asset, direction: t.direction, result: t.result, r: t.rrRealized })));
  const studies = await listActiveObservations(stageId);
  const knownStudies = new Set(studies.filter((o) => o.studyOutcome === "NO_TRADE").map((o) => o.date + "|" + o.asset));
  const seen = new Set();
  for (const item of items) {
    if (item.status !== "new") continue;
    const d = item.data;
    const key = d.result === "NO_TRADE" ? d.date + "|" + d.asset : backtestKey(d);
    const inJournal = d.result === "NO_TRADE" ? knownStudies.has(key) : known.has(key);
    if (inJournal) { item.status = "dup"; item.issues = ["Ya está cargado en el journal"]; }
    else if (seen.has(key)) { item.status = "dup"; item.issues = ["Repetido dentro del archivo"]; }
    seen.add(key);
  }
  return items;
}

export function countItems(items) {
  const c = { new: 0, dup: 0, error: 0, skip: 0 };
  for (const i of items) c[i.status] = (c[i.status] || 0) + 1;
  return c;
}

/** Guarda las filas válidas. includeDuplicates: también las marcadas como repetidas. */
export async function importBacktestItems(items, stageId, { includeDuplicates = false } = {}) {
  const chosen = items.filter((i) => i.status === "new" || (includeDuplicates && i.status === "dup"));
  const report = { created: 0, studies: 0, failed: [] };
  for (const item of chosen) {
    const d = item.data;
    try {
      if (d.result === "NO_TRADE") {
        await saveStudy({ date: d.date, asset: d.asset, bias: d.direction, studyOutcome: "NO_TRADE", note: d.note, session: d.session }, stageId);
        report.studies += 1;
      } else {
        await createClosedTrade({
          context: "BACKTEST", sessionDate: d.date, asset: d.asset, direction: d.direction, result: d.result,
          rrRealized: d.r == null ? "" : d.r, note: d.note || null,
          ...(d.strategy ? { strategy: d.strategy } : {}),
          ...(d.style ? { style: d.style } : {}),
          ...(d.session ? { session: d.session } : {}),
        }, stageId);
        report.created += 1;
      }
    } catch (e) {
      report.failed.push({ line: item.line, message: e.message });
    }
  }
  return report;
}
