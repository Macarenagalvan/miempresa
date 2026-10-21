import { readBacktestFile, saveBacktestFile, inspectZip, crc32, ZIP_LIMITS } from "../js/services/backtest-zip.js";
import { fixtures } from "./backtest-zip.fixtures.js";
import { ensureJournalSeed } from "../js/domain/stage.js";
import { listTrades, getTrade } from "../js/storage/repos/trades.js";
import { listTradeImages } from "../js/storage/repos/attachments.js";
import { getLedgerEntry } from "../js/storage/repos/sync-ledger.js";
import { closeDb, openDb } from "../js/storage/db.js";
import { buildExportPayload, validateBackup } from "../js/services/backup.js";
import { compute } from "../js/domain/stats.js";
import { accountBalance } from "../js/domain/integrity.js";
import { backtestImporter } from "../js/ui/backtest-import.js";

const check = (value, message) => { if (!value) throw new Error(message); };
const bytes = name => Uint8Array.from(atob(fixtures[name]), c => c.charCodeAt(0));
const file = name => new File([bytes(name)], "backtest.zip", { type: "application/zip" });
async function rejects(fn, message) { let error; try { await fn(); } catch (e) { error = e; } check(error, message); }
async function snapshot() {
  const db = await openDb();
  const names = ["trades", "attachments", "syncLedger", "accounts", "movements"];
  return JSON.stringify(await Promise.all(names.map(name => new Promise((resolve, reject) => {
    const req = db.transaction(name).objectStore(name).getAll();
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  }))));
}
export async function run() {
  const { stage } = await ensureJournalSeed();
  const before = await snapshot(), oldTrades = await listTrades();
  const realStats = JSON.stringify(compute(oldTrades, { universe: "REAL" }));
  const balance = accountBalance({ id: "zip-test-account", initialAmount: 1000 }, [], oldTrades);
  check(crc32(new TextEncoder().encode("123456789")) === 0xcbf43926, "CRC32 no coincide con vector conocido");
  const good = await readBacktestFile(file("deflated"));
  check(good.images.length === 3 && good.parsed.backtest.asset === "EURUSD", "No lee ZIP deflate");
  check(good.images.map(i => i.mime).join() === "image/png,image/jpeg,image/webp", "No valida los tres formatos");
  check(good.images[0].phase === "BEFORE" && good.images[1].phase === "AFTER", "Fases incorrectas");
  check((await readBacktestFile(file("stored"))).images.length === 1, "No lee ZIP sin compresión");
  check((await readBacktestFile(file("descriptor"))).images.length === 1, "No lee descriptor estándar");
  check((await readBacktestFile(file("eight"))).images.length === 8, "No acepta límite de 8 capturas");
  check(await snapshot() === before, "Vista previa ZIP escribió datos");
  for (const name of ["traversal", "duplicateNames", "html", "mismatch", "tooMany", "extraJson", "bomb", "pixels", "totalPixels", "animated"]) {
    await rejects(() => readBacktestFile(file(name)), "Aceptó ZIP inseguro: " + name);
  }
  await rejects(() => readBacktestFile(new File([new Uint8Array(ZIP_LIMITS.bytes + 1)], "large.zip")), "Aceptó ZIP demasiado grande");
  await rejects(() => readBacktestFile(new File([bytes("stored").subarray(0, 40)], "broken.zip")), "Aceptó ZIP truncado");
  await rejects(() => saveBacktestFile({ parsed: good.parsed, images: good.images }, stage.id), "Aceptó paquete sin validación");
  // Mutate both headers as needed, so errors are not merely header discrepancies.
  const mutate = fn => {
    const b = bytes("deflated"), v = new DataView(b.buffer), end = b.length - 22, c = v.getUint32(end + 16, true), l = v.getUint32(c + 42, true);
    fn(b, v, c, l); return new File([b], "bad.zip");
  };
  const bads = [
    mutate((b, v, c, l) => { v.setUint16(c + 8, 1, true); v.setUint16(l + 6, 1, true); }),
    mutate((b, v, c) => v.setUint32(c + 38, 0xa0000000, true)),
    mutate((b, v, c) => v.setUint16(c + 6, 45, true)),
    mutate((b, v, c, l) => { v.setUint32(c + 24, 1, true); v.setUint32(l + 22, 1, true); }),
    mutate((b, v, c, l) => { v.setUint32(c + 16, 0, true); v.setUint32(l + 14, 0, true); }),
    mutate((b, v, c, l) => { b[l + 30] = 120; }),
    mutate((b, v, c) => v.setUint32(c + 42, c, true)),
  ];
  for (const bad of bads) await rejects(() => readBacktestFile(bad), "Aceptó cabecera/CRC/cifrado/ZIP64/expansión inválida");
  check(await snapshot() === before, "Rechazar ZIP escribió datos");
  const nativeDecompression = globalThis.DecompressionStream;
  globalThis.DecompressionStream = class { constructor() { throw new Error("No disponible"); } };
  try {
    await rejects(() => readBacktestFile(file("deflated")), "No informa falta de soporte nativo");
    check((await readBacktestFile(file("stored"))).images.length === 1, "ZIP sin compresión depende de DEFLATE");
    const jsonText = JSON.stringify({ format: "maca-backtest", version: 1, importId: "support-json-test", backtest: {} });
    check((await readBacktestFile(new File([jsonText], "plain.json"))).images.length === 0, "JSON depende de ZIP nativo");
  } finally { globalThis.DecompressionStream = nativeDecompression; }

  // Simulate quota failure after trade.add and one attachment.add have been queued.
  const add = IDBObjectStore.prototype.add;
  let n = 0;
  IDBObjectStore.prototype.add = function (...args) {
    if (this.name === "attachments" && ++n === 2) throw new DOMException("Cuota agotada", "QuotaExceededError");
    return add.apply(this, args);
  };
  try { await rejects(() => saveBacktestFile(good, stage.id), "No propagó fallo de almacenamiento"); }
  finally { IDBObjectStore.prototype.add = add; }
  check(n === 2 && await snapshot() === before, "Fallo dejó trade, imágenes o ledger parciales");

  const results = await Promise.allSettled([saveBacktestFile(good, stage.id), saveBacktestFile(good, stage.id)]);
  check(results.filter(r => r.status === "fulfilled").length === 1, "Duplicó ZIP concurrente");
  const trade = results.find(r => r.status === "fulfilled").value;
  let images = await listTradeImages(trade.id);
  check(images.length === 3 && trade.context === "BACKTEST" && trade.accountId === null, "Imágenes o aislamiento incorrectos");
  for (const image of images) check((await getLedgerEntry("attachments", image.id))?.dirty, "Falta ledger de captura");
  await closeDb(); await openDb(); images = await listTradeImages(trade.id);
  for (const original of good.images) {
    const saved = images.find(i => i.name === original.name);
    check(saved && saved.phase === original.phase && saved.mime === original.mime, "Perdió metadatos");
    const a = new Uint8Array(await original.blob.arrayBuffer()), b = new Uint8Array(await saved.blob.arrayBuffer());
    check(a.length === b.length && a.every((v, i) => v === b[i]), "Bytes de imagen no persistieron");
  }
  check((await getTrade(trade.id)).note === good.parsed.backtest.note, "Notas cambiadas");
  const exported = await buildExportPayload();
  check(validateBackup(exported).ok && exported.attachments.filter(a => a.entityId === trade.id).every(a => typeof a.dataBase64 === "string"), "Capturas incompatibles con backup habitual");
  // Same record via standalone JSON must also be rejected, without adding captures.
  const text = JSON.stringify({ format: "maca-backtest", version: 1, importId: good.parsed.importId, backtest: good.parsed.backtest });
  const json = await readBacktestFile(new File([text], "same.json"));
  const afterSuccess = await snapshot();
  await rejects(() => saveBacktestFile(json, stage.id), "JSON duplicó ZIP");
  await rejects(() => saveBacktestFile(good, stage.id), "ZIP duplicado añadió capturas");
  check(await snapshot() === afterSuccess, "Duplicado alteró registros");
  const draft = await saveBacktestFile(await readBacktestFile(file("draft")), stage.id);
  check(draft.isDraft && draft.asset === "" && (await listTradeImages(draft.id)).length === 1, "Borrador sin captura");
  const all = await listTrades();
  const protectedBefore = JSON.parse(before).slice(3), protectedAfter = JSON.parse(await snapshot()).slice(3);
  check(JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter), "ZIP cambió cuentas o movimientos");
  check(JSON.stringify(compute(all, { universe: "REAL" })) === realStats && accountBalance({ id: "zip-test-account", initialAmount: 1000 }, [], all) === balance, "ZIP afectó estadísticas o saldo real");
  for (const old of oldTrades) check(JSON.stringify(await getTrade(old.id)) === JSON.stringify(old), "Sobrescribió trade existente");

  const widget = backtestImporter(stage.id); document.body.append(widget.button, widget.panel); widget.button.click();
  const input = widget.panel.querySelector('input[type=file]'), data = new DataTransfer(); data.items.add(file("deflated")); input.files = data.files;
  const beforeUI = await snapshot(); input.dispatchEvent(new Event("change"));
  for (let i = 0; i < 300 && !widget.panel.querySelector("img"); i++) await new Promise(r => setTimeout(r, 10));
  check(widget.panel.querySelectorAll("img").length === 3 && await snapshot() === beforeUI, "Vista previa imágenes ausente o guardó datos");
  [...widget.panel.querySelectorAll("button")].find(b => b.textContent === "Cerrar importación").click();
  check(widget.panel.hidden && await snapshot() === beforeUI, "Cancelar ZIP guardó datos");
  widget.button.remove(); widget.panel.remove();
  console.log("ZIP: PNG/JPEG/WEBP, stored/deflate, validación, expansión, CRC, preview/cancel, atomicidad ante cuota, duplicados, blobs persistentes, backup y REAL OK");
}
