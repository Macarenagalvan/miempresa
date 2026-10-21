// Deliberately bounded ZIP subset. No filesystem extraction or remote library.
// ZIP layout: PKWARE APPNOTE 6.3.10; decompression: native Compression Streams API.
import { MAX_BACKTEST_BYTES, parseBacktest, importBacktest } from "../domain/backtest-import.js";
import { ATTACHMENT_MAX_BYTES } from "../storage/repos/attachments.js";
import { validateCapture } from "./backtest-zip-images.js";

export const ZIP_LIMITS = Object.freeze({ bytes: 25 * 1024 * 1024, images: 8, imageBytes: ATTACHMENT_MAX_BYTES, totalImageBytes: 24 * 1024 * 1024, imagePixels: 12000000, totalPixels: 24000000, dimension: 8192 });
const packages = new WeakMap();
const fail = message => { throw new Error(message || "ZIP inválido o dañado."); };
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i; for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function inspectZip(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 22 || bytes.length > ZIP_LIMITS.bytes) fail("ZIP vacío, inválido o mayor que 25 MB.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = n => v.getUint16(n, true), u32 = n => v.getUint32(n, true);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length)) end--;
  if (end < Math.max(0, bytes.length - 65557)) fail();
  const count = u16(end + 10), centralSize = u32(end + 12), centralStart = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || count < 2 || count > ZIP_LIMITS.images + 1 || centralStart + centralSize !== end) fail("El ZIP debe contener un JSON y entre 1 y 8 imágenes, sin volúmenes ni ZIP64.");
  const entries = [], names = new Set(), ranges = [];
  let p = centralStart, total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || u32(p) !== 0x02014b50) fail();
    const flags = u16(p + 8), method = u16(p + 10), crc = u32(p + 16), packed = u32(p + 20), size = u32(p + 24);
    const nameLen = u16(p + 28), extraLen = u16(p + 30), commentLen = u16(p + 32), local = u32(p + 42);
    const next = p + 46 + nameLen + extraLen + commentLen;
    if (next > end || u16(p + 34) || (flags & ~0x080e) || ![0, 8].includes(method) || u16(p + 6) > 20 || ![0, 0x8000].includes(u32(p + 38) >>> 16 & 0xf000)) fail("ZIP con cifrado, enlaces o método no admitido.");
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,70}\.(json|png|jpg|jpeg|webp)$/i.test(name) || names.has(name.toLowerCase())) fail("Usá nombres simples y únicos en la raíz del ZIP, sin carpetas ni rutas.");
    const json = name === "backtest.json";
    if (!json && /\.json$/i.test(name)) fail("El único JSON debe llamarse backtest.json.");
    names.add(name.toLowerCase());
    if (!size || size > (json ? MAX_BACKTEST_BYTES : ZIP_LIMITS.imageBytes) || !packed || size / packed > 200) fail("Un archivo excede el límite de tamaño o de expansión del ZIP.");
    if (!json) total += size;
    if (total > ZIP_LIMITS.totalImageBytes) fail("Las imágenes superan 24 MB en total.");
    // Reject ZIP64 extra fields and malformed extra records before decompression.
    const checkExtra = (start, length) => {
      const finish = start + length;
      while (start < finish) {
        if (start + 4 > finish || u16(start) === 1 || start + 4 + u16(start + 2) > finish) fail("ZIP64 o metadatos ZIP inválidos.");
        start += 4 + u16(start + 2);
      }
    };
    checkExtra(p + 46 + nameLen, extraLen);
    if (local + 30 > centralStart || u32(local) !== 0x04034b50 || u16(local + 4) > 20 || u16(local + 6) !== flags || u16(local + 8) !== method || u16(local + 26) !== nameLen) fail();
    const localExtra = u16(local + 28), start = local + 30 + nameLen + localExtra;
    if (start + packed > centralStart || !nameBytes.every((b, j) => bytes[local + 30 + j] === b)) fail();
    checkExtra(local + 30 + nameLen, localExtra);
    let finish = start + packed;
    if (flags & 8) {
      // Data descriptor may have an optional signature (APPNOTE 4.3.9).
      if (finish + 12 > centralStart) fail();
      if (u32(finish) === 0x08074b50) finish += 4;
      if (finish + 12 > centralStart || u32(finish) !== crc || u32(finish + 4) !== packed || u32(finish + 8) !== size) fail();
      finish += 12;
    } else if (u32(local + 14) !== crc || u32(local + 18) !== packed || u32(local + 22) !== size) fail();
    if (method === 0 && packed !== size) fail();
    ranges.push([local, finish]);
    entries.push({ name, json, method, crc, size, start, packed }); p = next;
  }
  if (p !== end || !entries.some(e => e.json)) fail("Falta backtest.json.");
  ranges.sort((a, b) => a[0] - b[0]);
  // No hidden local entries, overlapping data, executable prefix or trailing payload.
  if (ranges[0][0] !== 0 || ranges.at(-1)[1] !== centralStart || ranges.some((r, i) => i && r[0] !== ranges[i - 1][1])) fail("El ZIP contiene datos superpuestos u ocultos.");
  return entries;
}
async function extract(bytes, entry) {
  let output;
  const packed = bytes.subarray(entry.start, entry.start + entry.packed);
  if (entry.method === 0) output = packed.slice();
  else {
    let stream;
    try { stream = new DecompressionStream("deflate-raw"); } catch { fail("Este navegador no puede abrir ZIP comprimidos. Actualizalo o usá un ZIP sin compresión; el JSON sigue disponible."); }
    // Small input chunks and bounded output prevent trusting declared ZIP sizes.
    let offset = 0;
    const source = new ReadableStream({ pull(controller) {
      if (offset === packed.length) { controller.close(); return; }
      const next = Math.min(offset + 1024, packed.length); controller.enqueue(packed.subarray(offset, next)); offset = next;
    } });
    const reader = source.pipeThrough(stream).getReader();
    const chunks = []; let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        length += value.length;
        if (length > entry.size) { await reader.cancel(); fail("El contenido expandido supera el tamaño declarado."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    output = new Uint8Array(length); let p = 0;
    for (const chunk of chunks) { output.set(chunk, p); p += chunk.length; }
  }
  if (output.length !== entry.size || crc32(output) !== entry.crc) fail("El ZIP está dañado (tamaño o integridad incorrectos).");
  return output;
}
export async function readBacktestFile(file) {
  if (!(file instanceof Blob)) fail("Elegí un archivo JSON o ZIP.");
  let text, images = [];
  if (/\.zip$/i.test(file.name || "")) {
    if (file.size > ZIP_LIMITS.bytes) fail("El ZIP supera 25 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer()), entries = inspectZip(bytes);
    const json = entries.find(e => e.json);
    text = new TextDecoder("utf-8", { fatal: true }).decode(await extract(bytes, json));
    parseBacktest(text); // Reject invalid data before decoding any image.
    let totalPixels = 0;
    for (const entry of entries.filter(e => !e.json)) {
      const image = await validateCapture(entry.name, await extract(bytes, entry), ZIP_LIMITS);
      totalPixels += image.width * image.height;
      if (totalPixels > ZIP_LIMITS.totalPixels) fail("Las capturas superan 24 megapíxeles en total.");
      images.push(image);
    }
  } else {
    if (file.size > MAX_BACKTEST_BYTES) fail("El archivo supera 64 KB.");
    text = await file.text();
  }
  const result = Object.freeze({ parsed: parseBacktest(text), images: Object.freeze(images) });
  packages.set(result, { text, images });
  return result;
}
export async function saveBacktestFile(preview, stageId, draft) {
  const saved = packages.get(preview);
  if (!saved) fail("Seleccioná y revisá el archivo antes de guardar.");
  return importBacktest(saved.text, stageId, draft, saved.images);
}
