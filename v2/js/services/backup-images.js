// JSON cannot preserve Blob bytes. Keep a portable encoding at the backup boundary.
export async function encodeAttachment(record) {
  if (!(record.blob instanceof Blob)) {
    throw new Error(`La captura ${record.name || record.id} no tiene contenido. No se generó el respaldo.`);
  }
  const bytes = new Uint8Array(await record.blob.arrayBuffer());
  if (!bytes.length) throw new Error(`La captura ${record.name || record.id} está vacía. No se generó el respaldo.`);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  const { blob, ...metadata } = record;
  return { ...metadata, size: bytes.length, dataBase64: btoa(binary) };
}

export function decodeAttachment(record) {
  if (record.blob instanceof Blob) return record;
  if (typeof record.dataBase64 !== "string") {
    throw new Error(`La captura ${record.name || record.id} no contiene su imagen. El respaldo antiguo no permite recuperarla.`);
  }
  const encoded = record.dataBase64;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error(`La captura ${record.name || record.id} tiene contenido inválido.`);
  }
  const binary = atob(encoded);
  if (!binary.length || binary.length !== Number(record.size)) {
    throw new Error(`La captura ${record.name || record.id} está vacía o incompleta.`);
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const { dataBase64, ...metadata } = record;
  return { ...metadata, blob: new Blob([bytes], { type: record.mime || "application/octet-stream" }) };
}
