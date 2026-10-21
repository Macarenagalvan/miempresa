import { Context, Lifecycle, Strategy } from "./enums.js";
import { assertTrade, normalizeAsset, deriveResult, computeRrRealized, incompleteForR } from "./integrity.js";
import { createId, nowIso } from "./ids.js";
import { openDb } from "../storage/db.js";
import { STORES } from "../config.js";
import { buildTradeImage } from "../storage/repos/attachments.js";
import { isTestRecord } from "./test-record.js";

export const MAX_BACKTEST_BYTES = 65536;
const fields = ["asset", "direction", "openedAt", "closedAt", "entry", "initialSL", "tp", "exit", "netPnl", "strategy", "result", "note"];
const labels = { asset: "activo", direction: "dirección", openedAt: "fecha de entrada", closedAt: "fecha de cierre", entry: "entrada", initialSL: "SL", tp: "TP", exit: "salida", netPnl: "PnL", strategy: "estrategia", result: "resultado" };
function object(value) { return value && typeof value === "object" && !Array.isArray(value); }
export function parseBacktest(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_BACKTEST_BYTES) throw new Error("El archivo supera 64 KB.");
  let raw;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new Error("El archivo no contiene JSON válido."); }
  if (!object(raw) || raw.format !== "maca-backtest" || raw.version !== 1) throw new Error("Formato no compatible: se requiere maca-backtest versión 1.");
  if (Object.keys(raw).some(k => !["format", "version", "importId", "backtest"].includes(k))) throw new Error("El archivo contiene campos no admitidos.");
  if (typeof raw.importId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(raw.importId)) throw new Error("importId debe tener entre 8 y 100 letras, números, guiones o guiones bajos.");
  if (!object(raw.backtest) || Object.keys(raw.backtest).some(k => !fields.includes(k))) throw new Error("Backtest inválido o con campos no admitidos. No se aceptan cuentas, contexto ni identificadores internos.");
  const b = {};
  for (const key of fields) {
    const v = raw.backtest[key];
    if (v == null) { b[key] = null; continue; }
    if (["entry", "initialSL", "tp", "exit", "netPnl"].includes(key)) {
      if (typeof v !== "number" || !Number.isFinite(v) || (key !== "netPnl" && v <= 0)) throw new Error(key + ": debe ser un número válido" + (key === "netPnl" ? "." : " mayor que cero."));
      b[key] = v;
    } else {
      if (typeof v !== "string" || v.length > (key === "note" ? 20000 : 100)) throw new Error(key + ": texto inválido o demasiado largo.");
      b[key] = key === "note" ? v : v.trim() || null;
    }
  }
  b.asset = b.asset == null ? null : normalizeAsset(b.asset);
  if (b.asset && !/^[A-Z0-9._/-]{1,40}$/.test(b.asset)) throw new Error("Activo inválido.");
  if (b.direction && !["LONG", "SHORT"].includes(b.direction)) throw new Error("direction debe ser LONG o SHORT.");
  if (b.strategy && !Object.values(Strategy).includes(b.strategy)) throw new Error("Estrategia no admitida; usá UNCLASSIFIED y describila en note.");
  if (b.result && !["WIN", "LOSS", "BE"].includes(b.result)) throw new Error("result debe ser WIN, LOSS o BE.");
  for (const key of ["openedAt", "closedAt"]) {
    if (!b[key]) continue;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(b[key]) || !Number.isFinite(Date.parse(b[key]))) throw new Error(key + ": usá fecha ISO con zona horaria.");
    const datePart = b[key].slice(0,10);
    if (new Date(datePart + "T00:00:00Z").toISOString().slice(0,10) !== datePart) throw new Error(key + ": fecha inexistente.");
    b[key] = new Date(b[key]).toISOString();
  }
  if (b.openedAt && b.closedAt && b.closedAt < b.openedAt) throw new Error("El cierre no puede ser anterior a la entrada.");
  if (b.entry != null && b.initialSL != null && b.direction && (b.direction === "LONG" ? b.initialSL >= b.entry : b.initialSL <= b.entry)) throw new Error("El SL debe estar del lado de riesgo de la entrada.");
  if (b.netPnl != null && b.result && deriveResult("UNKNOWN", b.netPnl, false) !== b.result) throw new Error("El resultado no coincide con el signo del PnL.");
  const missing = fields.filter(k => k !== "note" && (b[k] == null || b[k] === "" || (k === "strategy" && b[k] === "UNCLASSIFIED"))).map(k => labels[k]);
  return { importId: raw.importId, backtest: b, missing };
}
function hasIdentity(b) {
  return typeof b.asset === "string" && b.asset.trim() !== "" &&
    ["LONG", "SHORT"].includes(b.direction) && typeof b.openedAt === "string" &&
    Number.isFinite(Date.parse(b.openedAt)) && Number.isFinite(b.entry) && b.entry > 0;
}
function signature(b) {
  if (!hasIdentity(b)) return null;
  return JSON.stringify([normalizeAsset(b.asset), b.direction || null, b.openedAt || null, b.entry ?? null, b.initialSL ?? null, b.tp ?? null, b.closedAt || b.draftClosedAt || null, b.exit ?? b.draftExit ?? null, b.netPnl ?? b.draftNetPnl ?? null]);
}
function storedSignature(sourceRef) {
  if (sourceRef?.kind !== "BACKTEST_JSON") return null;
  try {
    const values = JSON.parse(sourceRef.signature);
    if (!Array.isArray(values) || values.length !== 9) return null;
    const [asset, direction, openedAt, entry] = values;
    return hasIdentity({ asset, direction, openedAt, entry }) ? sourceRef.signature : null;
  } catch { return null; }
}
export function buildImportedBacktest(preview, stageId, forceDraft = false) {
  const { backtest: b, importId, missing } = preview;
  const draft = forceDraft || missing.length > 0;
  const now = nowIso();
  const trade = {
    id: createId(), stageId, recordSource: "MANUAL", context: Context.BACKTEST, accountId: null,
    asset: b.asset || "", direction: b.direction || null, openedAt: b.openedAt, entry: b.entry,
    initialSL: b.initialSL, currentSL: b.initialSL, tp: b.tp, strategy: b.strategy || Strategy.UNCLASSIFIED,
    lifecycle: draft ? Lifecycle.OPEN : Lifecycle.CLOSED, isDraft: draft,
    exit: draft ? null : b.exit, closedAt: draft ? null : b.closedAt,
    netPnl: draft ? null : b.netPnl, result: draft ? null : b.result,
    draftExit: draft ? b.exit : null, draftClosedAt: draft ? b.closedAt : null, draftNetPnl: draft ? b.netPnl : null,
    closeType: draft ? null : "UNKNOWN", draftCloseType: draft ? "UNKNOWN" : null,
    note: b.note || null, management: null, hasPartials: false, commission: null, swap: null,
    lots: null, setupId: null, deskSignalId: null, style: null, variant: null, session: null,
    riskPercent: null, riskMoney: null, rrPlanned: null, importBatchId: null,
    sourceRef: { kind: "BACKTEST_JSON", importId, signature: signature(b), declaredResult: b.result },
    createdAt: now, updatedAt: now, voidedAt: null, voidReason: null, costComplete: false,
  };
  trade.incompleteForR = incompleteForR(trade);
  trade.rrRealized = computeRrRealized(trade);
  assertTrade(trade);
  return trade;
}
// Scan and add share one transaction: simultaneous tabs cannot both insert.
export async function importBacktest(text, stageId, forceDraft = false, images = []) {
  const preview = parseBacktest(text);
  const trade = buildImportedBacktest(preview, stageId, forceDraft);
  const captures = images.map(image => buildTradeImage(trade.id, image));
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([STORES.trades, STORES.syncLedger, ...(captures.length ? [STORES.attachments] : [])], "readwrite");
    const store = tx.objectStore(STORES.trades);
    let failure;
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error("No se pudo guardar el backtest."));
    const scan = store.getAll();
    scan.onsuccess = () => {
      try {
        const duplicate = scan.result.some(t => t.context === Context.BACKTEST && (
          // File identity remains authoritative, including after edits or test marking.
          (t.sourceRef?.kind === "BACKTEST_JSON" && t.sourceRef.importId === preview.importId)
          || (!isTestRecord(t) && !isTestRecord(trade) && trade.sourceRef.signature !== null && (
            storedSignature(t.sourceRef) === trade.sourceRef.signature || signature(t) === trade.sourceRef.signature
          ))
        ));
        if (duplicate) { failure = new Error("Este backtest ya existe. No se importó ni se sobrescribió ningún registro."); tx.abort(); return; }
        store.add(trade);
        for (const capture of captures) {
          tx.objectStore(STORES.attachments).add(capture);
          tx.objectStore(STORES.syncLedger).put({ id: STORES.attachments + "::" + capture.id, entityType: STORES.attachments, entityId: capture.id, cloudRevision: 0, dirty: true, tombstone: false, localChangedAt: capture.createdAt });
        }
        tx.objectStore(STORES.syncLedger).put({ id: STORES.trades + "::" + trade.id, entityType: STORES.trades, entityId: trade.id, cloudRevision: 0, dirty: true, tombstone: false, localChangedAt: trade.updatedAt });
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
  });
  // Existing sync, if enabled, picks up the ordinary local ledger entry.
  return trade;
}
