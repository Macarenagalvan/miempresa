import { parseBacktest, importBacktest } from "../js/domain/backtest-import.js";
import { listTrades, getTrade, putTrade } from "../js/storage/repos/trades.js";
import { getLedgerEntry } from "../js/storage/repos/sync-ledger.js";
import { ensureJournalSeed } from "../js/domain/stage.js";
import { updateDraftTrade, closeTrade } from "../js/domain/trade.js";
import { closeDb, openDb } from "../js/storage/db.js";
import { accountBalance, assertTrade } from "../js/domain/integrity.js";
import { compute } from "../js/domain/stats.js";
import { backtestImporter } from "../js/ui/backtest-import.js";

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const raw = () => ({ format: "maca-backtest", version: 1, importId: "test-json-import-01", backtest: {
  asset: "EURUSD", direction: "LONG", openedAt: "2025-03-01T10:00:00+02:00", closedAt: "2025-03-01T11:00:00+02:00",
  entry: 100, initialSL: 95, tp: 110, exit: 110, netPnl: 20, strategy: "MACA", result: "WIN", note: "Notas intactas\n<img src=x onerror=alert(1)> 😺",
} });
async function rejects(fn, message) { let rejected = false; try { await fn(); } catch { rejected = true; } assert(rejected, message); }
export async function run() {
  const { stage } = await ensureJournalSeed();
  const before = await listTrades();
  const protectedSnapshot = async () => {
    const db = await openDb();
    return Promise.all(["accounts", "movements"].map(name => new Promise((resolve, reject) => {
      const req = db.transaction(name).objectStore(name).getAll();
      req.onsuccess = () => resolve(JSON.stringify(req.result)); req.onerror = () => reject(req.error);
    })));
  };
  const protectedBefore = await protectedSnapshot();
  const realBefore = JSON.stringify(compute(before, { universe: "REAL" }));
  const balanceBefore = accountBalance({ id: "test-account", initialAmount: 1000 }, [], before);
  for (const bad of ["{", "[]", "null", JSON.stringify({ ...raw(), version: 2 }), JSON.stringify({ ...raw(), accountId: "x" }), " ".repeat(65537)]) {
    await rejects(() => parseBacktest(bad), "Archivo inválido aceptado");
  }
  for (const patch of [{ context: "LIVE" }, { accountId: "x" }, { id: "existing" }, { entry: "100" }, { entry: true }, { direction: "BUY" }, { openedAt: "2025-02-30T10:00:00Z" }, { openedAt: "2025-03-01" }, { closedAt: "2020-01-01T00:00:00Z" }, { initialSL: 101 }, { result: "LOSS" }, { note: "x".repeat(20001) }]) {
    const bad = raw(); Object.assign(bad.backtest, patch);
    await rejects(() => importBacktest(JSON.stringify(bad), stage.id), "Datos inválidos persistidos");
  }
  assert((await listTrades()).length === before.length, "Validación escribió datos");
  const source = JSON.stringify(raw());
  parseBacktest(source);
  assert((await listTrades()).length === before.length, "Vista previa guardó datos");
  const trade = await importBacktest(source, stage.id);
  assert(trade.context === "BACKTEST" && trade.accountId === null && trade.lifecycle === "CLOSED" && trade.result === "WIN", "Mapeo inseguro");
  assert(trade.note === raw().backtest.note && trade.openedAt === "2025-03-01T08:00:00.000Z", "Notas o zona horaria alteradas");
  const ledger = await getLedgerEntry("trades", trade.id);
  assert(ledger?.dirty === true, "Falta ledger habitual");
  await rejects(() => importBacktest(source, stage.id), "Reimportación duplicada");
  const changed = raw(); changed.importId = "another-json-test"; changed.backtest.note = "Distinta nota";
  await rejects(() => importBacktest(JSON.stringify(changed), stage.id), "Contenido duplicado con otro ID");
  const original = JSON.stringify(await getTrade(trade.id));
  changed.importId = raw().importId; changed.backtest.entry = 101;
  await rejects(() => importBacktest(JSON.stringify(changed), stage.id), "Reutilizó ID cambiado");
  assert(JSON.stringify(await getTrade(trade.id)) === original, "Sobrescribió registro");
  const partial = { format: "maca-backtest", version: 1, importId: "draft-json-test", backtest: { note: "Falta gráfico", result: "WIN" } };
  const draft = await importBacktest(JSON.stringify(partial), stage.id);
  assert(draft.isDraft && draft.openedAt === null && draft.entry === null && draft.asset === "" && draft.direction === null && draft.sourceRef.declaredResult === "WIN", "Borrador inventó datos");
  await rejects(() => closeTrade(draft.id, { exit: 100, netPnl: 1 }), "Cerró borrador incompleto");
  const edited = await updateDraftTrade(draft.id, { asset: "xauusd", direction: "LONG", openedAt: "2025-03-02T10:00:00Z", entry: 100, initialSL: 90 });
  assert(edited.asset === "XAUUSD" && edited.direction === "LONG" && edited.note === "Falta gráfico", "Borrador no editable");
  const closed = await closeTrade(draft.id, { exit: 110, closedAt: "2025-03-02T11:00:00Z", netPnl: 10, closeType: "MANUAL" });
  assert(closed.lifecycle === "CLOSED" && !closed.isDraft, "No se pudo completar");
  await rejects(() => importBacktest(JSON.stringify(partial), stage.id), "Reimportó borrador editado");
  await rejects(() => assertTrade({ ...draft, isDraft: false }), "Admitió registro activo sin activo/dirección");
  await rejects(() => assertTrade({ ...draft, context: "LIVE", accountId: "test-account" }), "Relajó validación real");
  const concurrent = raw(); concurrent.importId = "concurrent-json-test"; concurrent.backtest.entry = 102;
  const results = await Promise.allSettled([importBacktest(JSON.stringify(concurrent), stage.id), importBacktest(JSON.stringify(concurrent), stage.id)]);
  assert(results.filter(r => r.status === "fulfilled").length === 1, "Dos confirmaciones simultáneas duplicaron el backtest");
  const manual = { ...trade, id: crypto.randomUUID(), entry: 103, sourceRef: null };
  await putTrade(manual);
  const manualFile = raw(); manualFile.importId = "manual-json-test"; manualFile.backtest.entry = 103;
  await rejects(() => importBacktest(JSON.stringify(manualFile), stage.id), "Duplicó backtest manual");
  await closeDb(); await openDb();
  assert((await getTrade(trade.id)).note === trade.note, "No persistió tras reabrir");
  const after = await listTrades();
  for (const old of before) assert(JSON.stringify(await getTrade(old.id)) === JSON.stringify(old), "Cambió registro previo");
  assert(JSON.stringify(compute(after, { universe: "REAL" })) === realBefore, "Cambió estadísticas reales");
  assert(accountBalance({ id: "test-account", initialAmount: 1000 }, [], after) === balanceBefore, "Cambió saldo");
  assert(JSON.stringify(await protectedSnapshot()) === JSON.stringify(protectedBefore), "Cambió cuentas o movimientos");

  // File selection and preview must never write, including after cancellation.
  const widget = backtestImporter(stage.id);
  document.body.append(widget.button, widget.panel);
  const count = after.length;
  widget.button.click();
  const dt = new DataTransfer(); dt.items.add(new File([source], "test.json", { type: "application/json" }));
  const input = widget.panel.querySelector('input[type="file"]'); input.files = dt.files; input.dispatchEvent(new Event("change"));
  for (let i = 0; i < 100 && !widget.panel.querySelector("dl"); i++) await new Promise(r => setTimeout(r, 10));
  assert(widget.panel.querySelector("dl")?.textContent.includes(raw().backtest.note), "Falta vista previa de notas");
  assert(!widget.panel.querySelector("img"), "Interpretó HTML del archivo");
  assert((await listTrades()).length === count, "Seleccionar archivo guardó datos");
  [...widget.panel.querySelectorAll("button")].find(b => b.textContent === "Cerrar importación").click();
  assert(widget.panel.hidden && (await listTrades()).length === count, "Cancelar guardó datos");
  widget.button.remove(); widget.panel.remove();
  console.log("Importación JSON: validación, vista previa, cancelación, persistencia, borradores editables, duplicados concurrentes, notas y separación REAL OK");
}
