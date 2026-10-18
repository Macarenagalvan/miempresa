import { encodeAttachment, decodeAttachment } from "../js/services/backup-images.js";
import { buildExportPayload, applyRestoreTransaction, validateBackup } from "../js/services/backup.js";
import { attachmentsRepo } from "../js/storage/repos/attachments.js";
import { richV2, ATT } from "./slice12.payloads.js";

export async function run() {
  function check(value, message) { if (!value) throw new Error(message); }
  const bytes = new Uint8Array(100003).map((_, i) => i % 256);
  const record = { id: ATT, name: "TEST.png", mime: "image/png", size: bytes.length, blob: new Blob([bytes], { type: "image/png" }) };
  const encoded = await encodeAttachment(record);
  const decoded = decodeAttachment(JSON.parse(JSON.stringify(encoded)));
  check(decoded.blob.type === "image/png", "MIME conservado");
  check(new Uint8Array(await decoded.blob.arrayBuffer()).every((b, i) => b === bytes[i]), "bytes conservados");
  const payload = richV2();
  payload.attachments = [{ ...payload.attachments[0], ...encoded }];
  await applyRestoreTransaction(payload);
  const exported = JSON.parse(JSON.stringify(await buildExportPayload()));
  check(validateBackup(exported).ok, "exportación válida");
  await applyRestoreTransaction(exported);
  check((await attachmentsRepo.get(ATT)).blob.size === bytes.length, "imagen restaurada en almacenamiento");
  for (const bad of [{ blob: {} }, { dataBase64: "???" }, { dataBase64: "AQID", size: 4 }]) {
    const broken = structuredClone(exported);
    broken.attachments = [{ id: ATT, ...bad }];
    check(!validateBackup(broken).ok, "rechaza captura perdida o corrupta");
    let failed = false;
    try { await applyRestoreTransaction(broken); } catch { failed = true; }
    check(failed, "restore rechaza captura corrupta");
    check((await attachmentsRepo.get(ATT)).blob.size === bytes.length, "rechazo conserva datos existentes");
  }
  const legacy = richV2();
  legacy.backupVersion = 1;
  legacy.attachments = [];
  check(validateBackup(legacy).ok, "respaldo anterior sin imágenes sigue siendo compatible");
  console.log("backup-images: roundtrip binario, restore y protección ante corrupción OK");
}
