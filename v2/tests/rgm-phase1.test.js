import './test-safety.js';
import { ensureJournalSeed } from "../js/domain/stage.js";
import { createClosedTrade } from "../js/domain/trade.js";
import { getTrade } from "../js/storage/repos/trades.js";
import { addTradeImage, listTradeImages } from "../js/storage/repos/attachments.js";
import { deleteTrades, restoreDeletedTrades } from "../js/domain/trade-delete.js";
import { editQuickBacktest } from "../js/domain/trade-edit.js";
import { findSimilarQuickBacktest } from "../js/domain/duplicates.js";
import { buildXlsx, readXlsx, XS } from "../js/services/xlsx.js";
import { readBacktestTable } from "../js/services/table-io.js";
import { classifyBacktestItems, importBacktestItems, countItems } from "../js/domain/backtest-table-import.js";

export async function run() {
  let n = 0;
  const check = (ok, msg) => { if (!ok) throw new Error(msg); n++; };
  const seed = await ensureJournalSeed();
  const stageId = seed.stage.id;

  // Borrar + deshacer conserva todo (incluidas capturas)
  const bt = await createClosedTrade({ context: "BACKTEST", sessionDate: "2026-10-01", asset: "RGMTEST", direction: "LONG", result: "WIN", rrRealized: "2" }, stageId);
  await addTradeImage(bt.id, { name: "TEST.png", mime: "image/png", blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), phase: "BEFORE" });
  const { counts, snapshot } = await deleteTrades(bt.id);
  check(counts.trades === 1 && counts.attachments === 1, "borra trade y captura");
  check(!(await getTrade(bt.id)), "trade borrado");
  await restoreDeletedTrades(snapshot);
  check((await getTrade(bt.id))?.rrRealized === 2, "deshacer restaura trade");
  check((await listTradeImages(bt.id)).length === 1, "deshacer restaura captura");

  // Duplicados de carga rápida
  check(Boolean(await findSimilarQuickBacktest({ sessionDate: "2026-10-01", asset: "rgmtest", direction: "LONG", result: "WIN", rrRealized: "2" })), "detecta repetido");
  check(!(await findSimilarQuickBacktest({ sessionDate: "2026-10-01", asset: "RGMTEST", direction: "LONG", result: "WIN", rrRealized: "3" })), "R distinto no es repetido");

  // Editar backtest: LOSS con R positivo se guarda negativo
  const edited = await editQuickBacktest(bt.id, { sessionDate: "2026-10-02", asset: "RGMTEST", direction: "SHORT", result: "LOSS", rrRealized: "1", strategy: "BLUE" });
  check(edited.rrRealized === -1 && edited.sourceRef.sessionDate === "2026-10-02" && edited.strategy === "BLUE", "edita backtest");
  let failed = false;
  try { await editQuickBacktest(bt.id, { sessionDate: "2026-10-02", asset: "RGMTEST", direction: "SHORT", result: "BE", rrRealized: "1" }); } catch { failed = true; }
  check(failed, "BE con R distinto de 0 rechazado");

  // XLSX ida y vuelta + importación con repetidos
  const blob = buildXlsx([{ name: "Backtests", rows: [
    ["Fecha", "Activo", "Dirección", "Resultado", "R"].map((v) => ({ v, s: XS.HEADER })),
    [{ v: 46297, s: XS.DATE }, "RGMTEST", "SHORT", "LOSS", -1],
    ["03/10/2026", "RGMTEST", "compra", "win", "1,5"],
    ["03/10/2026", "RGMTEST", "LONG", "WIN", 1.5],
    ["fecha mala", "RGMTEST", "LONG", "WIN", 1],
  ] }]);
  const file = new File([blob], "test.xlsx");
  const rows = await readXlsx(file);
  check(rows[0][0] === "Fecha" && rows[1][4] === -1, "lee xlsx propio");
  const items = await classifyBacktestItems(await readBacktestTable(file), stageId);
  const c = countItems(items);
  check(items[0].data.date === "2026-10-02", "fecha serial de Excel");
  check(c.new === 1 && c.dup === 2 && c.error === 1, "clasifica nuevo / repetido / error: " + JSON.stringify(c));
  const report = await importBacktestItems(items, stageId);
  check(report.created === 1 && !report.failed.length, "importa solo lo nuevo");

  document.getElementById("out").textContent += `\nRGM fase 1: ${n} tests OK\n`;
}
