import './test-safety.js';
import { ensureJournalSeed } from "../js/domain/stage.js";
import { createClosedTrade } from "../js/domain/trade.js";
import { getTrade } from "../js/storage/repos/trades.js";
import { setTradeProcess, normalizeProcess } from "../js/domain/process.js";
import { buildWeeklyReview, mondayOf } from "../js/services/weekly-review.js";

export async function run() {
  let n = 0;
  const check = (ok, msg) => { if (!ok) throw new Error(msg); n++; };
  const seed = await ensureJournalSeed();
  check(normalizeProcess({ family: "X", confluences: ["NOPE"] }) === null, "proceso vacío/desconocido es null");
  const bt = await createClosedTrade({ context: "BACKTEST", sessionDate: "2026-10-05", asset: "RGMPROC", direction: "LONG", result: "WIN", rrRealized: "2" }, seed.stage.id);
  await setTradeProcess(bt.id, { family: "REVERSAL", plan: "YES", confluences: ["SMT", "SMT", "IFVG"], errors: ["EARLY"] });
  const saved = await getTrade(bt.id);
  check(saved.process.family === "REVERSAL" && saved.process.confluences.length === 2 && saved.rrRealized === 2, "guarda proceso sin tocar el trade");
  await setTradeProcess(bt.id, {});
  check((await getTrade(bt.id)).process === null, "se puede vaciar");
  const review = await buildWeeklyReview(seed.stage.id, mondayOf(new Date()));
  check(review.markdown.includes("Pedido para la IA") && review.markdown.includes("RGMPROC"), "revisión semanal incluye pedido y el backtest de la semana");
  check(/^RGM-revision-semanal-\d{4}-\d{2}-\d{2}\.md$/.test(review.filename), "nombre de archivo");
  document.getElementById("out").textContent += `\nRGM fase 4: ${n} tests OK\n`;
}
