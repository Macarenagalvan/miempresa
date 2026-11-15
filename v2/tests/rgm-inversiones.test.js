import './test-safety.js';
import { ensureJournalSeed } from "../js/domain/stage.js";
import { ensureDefaultAssets, loadPortfolio, saveTx, updateAsset, removeRecord, restoreRecords } from "../js/domain/investments.js";
import { buildExportPayload } from "../js/services/backup.js";

export async function run() {
  let n = 0;
  const check = (ok, msg) => { if (!ok) throw new Error(msg); n++; };
  await ensureJournalSeed();
  await ensureDefaultAssets(); await ensureDefaultAssets();
  let p = await loadPortfolio();
  const btc = p.rows.find((r) => r.asset.symbol === "BTC").asset;
  check(p.rows.filter((r) => r.asset.symbol === "BTC").length === 1 && p.rows.some((r) => r.asset.symbol === "SPCX"), "activos por defecto una sola vez");
  await saveTx({ assetId: btc.id, side: "BUY", date: "2026-01-01", qty: "0,1", price: "50000", fee: "10" });
  const second = await saveTx({ assetId: btc.id, side: "BUY", date: "2026-02-01", qty: "0.1", price: "70000" });
  await updateAsset(btc.id, { lastPrice: 80000 });
  p = await loadPortfolio();
  const r = p.rows.find((x) => x.asset.id === btc.id);
  check(Math.abs(r.qty - 0.2) < 1e-9 && Math.abs(r.cost - 12010) < 1e-6, "cantidad y costo con comisión");
  check(Math.abs(r.value - 16000) < 1e-6 && Math.abs(r.pnlPct - (16000 / 12010 - 1) * 100) < 1e-9, "valor y rendimiento");
  check(Math.abs(r.txs[0].changePct - 60) < 1e-9, "% desde cada compra");
  let failed = false; try { await saveTx({ assetId: btc.id, side: "SELL", date: "2026-03-01", qty: "1", price: "80000" }); } catch { failed = true; }
  check(failed, "no deja vender de más");
  await saveTx({ assetId: btc.id, side: "SELL", date: "2026-03-01", qty: "0.1", price: "80000" });
  p = await loadPortfolio();
  check(Math.abs(p.rows.find((x) => x.asset.id === btc.id).realized - (8000 - 6005)) < 1e-6, "ganancia realizada con costo promedio");
  const removed = await removeRecord(second.id);
  check((await loadPortfolio()).rows.find((x) => x.asset.id === btc.id).txs.length === 2, "borra compra");
  await restoreRecords(removed);
  check((await loadPortfolio()).rows.find((x) => x.asset.id === btc.id).txs.length === 3, "deshacer");
  check(((await buildExportPayload()).investments || []).length >= 5, "el respaldo incluye inversiones");
  document.getElementById("out").textContent += `\nRGM inversiones: ${n} tests OK\n`;
}
