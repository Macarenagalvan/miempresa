import { readBacktestFile, saveBacktestFile, crc32 } from "../js/services/backtest-zip.js";
import { ensureJournalSeed } from "../js/domain/stage.js";
import { listTrades, getTrade, putTrade } from "../js/storage/repos/trades.js";
import { openDb } from "../js/storage/db.js";
import { backtestImporter } from "../js/ui/backtest-import.js";

const check = (ok, message) => { if (!ok) throw new Error(message); };
// Small stored ZIPs with synthetic notes, preserving the four reported identity shapes.
function jsonZip(raw) {
  const name = new TextEncoder().encode("backtest.json"), data = new TextEncoder().encode(JSON.stringify(raw));
  const size = 30 + name.length + data.length, central = 46 + name.length;
  const bytes = new Uint8Array(size + central + 22), v = new DataView(bytes.buffer);
  v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true);
  v.setUint32(14, crc32(data), true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true);
  v.setUint16(26, name.length, true); bytes.set(name, 30); bytes.set(data, 30 + name.length);
  v.setUint32(size, 0x02014b50, true); v.setUint16(size + 4, 20, true); v.setUint16(size + 6, 20, true);
  v.setUint32(size + 16, crc32(data), true); v.setUint32(size + 20, data.length, true); v.setUint32(size + 24, data.length, true);
  v.setUint16(size + 28, name.length, true); bytes.set(name, size + 46);
  const end = size + central;
  v.setUint32(end, 0x06054b50, true); v.setUint16(end + 8, 1, true); v.setUint16(end + 10, 1, true);
  v.setUint32(end + 12, central, true); v.setUint32(end + 16, size, true);
  return new File([bytes], "practice.zip", { type: "application/zip" });
}
async function zip(raw) {
  const { fixtures } = await import("./backtest-zip.fixtures.js");
  const { inspectZip } = await import("../js/services/backtest-zip.js");
  const source = Uint8Array.from(atob(fixtures.stored), c => c.charCodeAt(0));
  const entry = inspectZip(source).find(e => !e.json);
  // Reuse the validated synthetic image's local record and central directory entry.
  const sv = new DataView(source.buffer), oldCentral = sv.getUint32(source.length - 6, true);
  let imageCentral = oldCentral;
  while (new TextDecoder().decode(source.slice(imageCentral + 46, imageCentral + 46 + sv.getUint16(imageCentral + 28, true))) !== entry.name) {
    imageCentral += 46 + sv.getUint16(imageCentral + 28, true) + sv.getUint16(imageCentral + 30, true) + sv.getUint16(imageCentral + 32, true);
  }
  const localOffset = sv.getUint32(imageCentral + 42, true);
  const localLength = 30 + sv.getUint16(localOffset + 26, true) + sv.getUint16(localOffset + 28, true) + sv.getUint32(imageCentral + 20, true);
  const centralLength = 46 + sv.getUint16(imageCentral + 28, true) + sv.getUint16(imageCentral + 30, true) + sv.getUint16(imageCentral + 32, true);
  const base = new Uint8Array(await jsonZip(raw).arrayBuffer()), bv = new DataView(base.buffer), c = bv.getUint32(base.length - 6, true);
  const out = new Uint8Array(base.length + localLength + centralLength);
  out.set(base.slice(0, c)); out.set(source.slice(localOffset, localOffset + localLength), c);
  out.set(base.slice(c, base.length - 22), c + localLength);
  const second = base.length - 22 + localLength;
  out.set(source.slice(imageCentral, imageCentral + centralLength), second); out.set(base.slice(-22), out.length - 22);
  const ov = new DataView(out.buffer), end = out.length - 22;
  ov.setUint32(second + 42, c, true); ov.setUint16(end + 8, 2, true); ov.setUint16(end + 10, 2, true);
  ov.setUint32(end + 12, base.length - 22 - c + centralLength, true); ov.setUint32(end + 16, c + localLength, true);
  return new File([out], "practice.zip", { type: "application/zip" });
}
async function snapshot() {
  const db = await openDb();
  return JSON.stringify(await Promise.all(["trades", "attachments", "syncLedger"].map(name => new Promise((resolve, reject) => {
    const req = db.transaction(name).objectStore(name).getAll();
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  }))));
}
export async function run() {
  const { stage } = await ensureJournalSeed(), before = await listTrades();
  const files = await Promise.all(["08-london", "08-newyork", "09-london", "09-newyork"].map((key, i) => zip({
    format: "maca-backtest", version: 1, importId: "regression-four-" + key,
    backtest: { asset: "NAS100", direction: "LONG", openedAt: null, entry: i === 3 ? 23803.42 : null,
      initialSL: i === 3 ? 23790.59 : null, tp: i === 3 ? 23847.6 : null, strategy: "MACA", note: "Practice " + key },
  })));
  const bundles = [], trades = [];
  for (const file of files) {
    const bundle = await readBacktestFile(file); bundles.push(bundle);
    const trade = await saveBacktestFile(bundle, stage.id, true); trades.push(trade);
    check(trade.sourceRef.signature === null, "Firmó identidad incompleta de los cuatro ZIP");
  }
  check((await listTrades()).length === before.length + 4, "No importó los cuatro ZIP secuenciales");
  // The reported two missing rows were voided imports, with pre-fix stored signatures.
  for (const i of [0, 3]) {
    const t = trades[i];
    await putTrade({ ...t, lifecycle: "VOID", voidedAt: new Date().toISOString(), voidReason: "DUPLICATE",
      sourceRef: { ...t.sourceRef, signature: JSON.stringify([t.asset, t.direction, null, t.entry, t.initialSL, t.tp, null, null, null]) } });
  }
  const unchanged = await snapshot();
  for (let i = 0; i < 4; i++) {
    let error;
    try { await saveBacktestFile(bundles[i], stage.id, true); } catch (e) { error = e; }
    check(error?.code === "BACKTEST_DUPLICATE" && error.reason === "IMPORT_ID" && error.tradeId === trades[i].id, "No identificó importId existente");
    check(error.message.includes("anulado") === [0, 3].includes(i), "No distingue registro anulado");
  }
  check(await snapshot() === unchanged, "Reimportar modificó datos o ledger");
  const widget = backtestImporter(stage.id); document.body.append(widget.button, widget.panel); widget.button.click();
  const transfer = new DataTransfer(); transfer.items.add(files[0]);
  const input = widget.panel.querySelector('input[type="file"]'); input.files = transfer.files; input.dispatchEvent(new Event("change"));
  for (let i = 0; i < 200 && !widget.panel.querySelector("dl"); i++) await new Promise(r => setTimeout(r, 10));
  [...widget.panel.querySelectorAll("button")].find(b => b.textContent === "Confirmar y guardar").click();
  for (let i = 0; i < 200 && !widget.panel.querySelector('[role="alert"] a'); i++) await new Promise(r => setTimeout(r, 10));
  check(widget.panel.querySelector('[role="alert"] a')?.getAttribute("href") === "#/trade/" + trades[0].id + "?from=backtesting", "No enlaza al duplicado anulado");
  check(await snapshot() === unchanged, "Rechazo desde UI modificó datos");
  widget.button.remove(); widget.panel.remove();
  for (const old of before) check(JSON.stringify(await getTrade(old.id)) === JSON.stringify(old), "Modificó registro previo");
  console.log("Cuatro ZIP: importación secuencial, identidad incompleta, reimportación anulada y enlace al original OK");
}
