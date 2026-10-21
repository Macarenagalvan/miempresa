// Check encoded dimensions before asking the browser to allocate a decoded bitmap.
export async function validateCapture(name, bytes, limits) {
  const bad = () => { throw new Error("Captura inválida, animada o con formato distinto de su extensión: " + name); };
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (p, n) => String.fromCharCode(...bytes.subarray(p, p + n));
  let width, height, mime;
  if (/\.png$/i.test(name)) {
    if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b) || ascii(12, 4) !== "IHDR" || v.getUint32(8) !== 13) bad();
    width = v.getUint32(16); height = v.getUint32(20); mime = "image/png";
    let p = 8, ended = false;
    while (p + 12 <= bytes.length) {
      const size = v.getUint32(p), type = ascii(p + 4, 4);
      if (p + 12 + size > bytes.length || type === "acTL") bad();
      p += 12 + size;
      if (type === "IEND") { if (size || p !== bytes.length) bad(); ended = true; break; }
    }
    if (!ended) bad();
  } else if (/\.jpe?g$/i.test(name)) {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) bad();
    mime = "image/jpeg";
    let p = 2;
    while (p + 4 <= bytes.length) {
      if (bytes[p++] !== 255) bad();
      while (bytes[p] === 255) p++;
      const marker = bytes[p++];
      if (marker === 217 || marker === 218) break;
      const size = v.getUint16(p);
      if (size < 2 || p + size > bytes.length) bad();
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if (size < 8) bad(); height = v.getUint16(p + 3); width = v.getUint16(p + 5); break;
      }
      p += size;
    }
  } else if (/\.webp$/i.test(name)) {
    if (bytes.length < 20 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP" || v.getUint32(4, true) + 8 !== bytes.length) bad();
    mime = "image/webp";
    const type = ascii(12, 4), u24 = p => bytes[p] | bytes[p + 1] << 8 | bytes[p + 2] << 16;
    if (type === "VP8X") {
      if (bytes.length < 30) bad();
      if (bytes[20] & 2) bad(); width = u24(24) + 1; height = u24(27) + 1;
    } else if (type === "VP8 ") {
      if (bytes.length < 30) bad();
      if (ascii(23, 3) !== "\x9d\x01\x2a") bad(); width = v.getUint16(26, true) & 16383; height = v.getUint16(28, true) & 16383;
    } else if (type === "VP8L" && bytes.length >= 25 && bytes[20] === 47) {
      const bits = v.getUint32(21, true); width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1;
    } else bad();
    let p = 12;
    while (p + 8 <= bytes.length) {
      const size = v.getUint32(p + 4, true), chunk = ascii(p, 4);
      if (chunk === "ANIM" || chunk === "ANMF" || p + 8 + size > bytes.length) bad();
      p += 8 + size + (size & 1);
    }
    if (p !== bytes.length) bad();
  } else bad();
  if (!width || !height || width > limits.dimension || height > limits.dimension || width * height > limits.imagePixels) throw new Error("Captura demasiado grande: máximo 8192 px por lado y 12 megapíxeles por imagen.");
  const blob = new Blob([bytes], { type: mime });
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "none" });
    if (bitmap.width !== width || bitmap.height !== height) bad();
  } catch { bad(); }
  finally { bitmap?.close(); }
  return Object.freeze({ name, mime, blob, width, height, phase: /^before[-_]/i.test(name) ? "BEFORE" : /^after[-_]/i.test(name) ? "AFTER" : null });
}
