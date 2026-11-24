import { projectMetaForSync } from "../domain/sync-meta.js";
import { encodeAttachment, decodeAttachment } from "./backup-images.js";

// Attachments must cross Supabase's JSON boundary as bytes, not as Blob: {}.
// Reuse the validated portable format already used by backup/restore.
export async function encodeSyncPayload(entityType, record) {
  if (entityType === "meta") return projectMetaForSync(record);
  if (entityType === "attachments") {
    return encodeAttachment(record.blob instanceof Blob ? record : decodeAttachment(record));
  }
  return record;
}

export function decodeSyncPayload(entityType, payload) {
  return entityType === "attachments" ? decodeAttachment(payload) : payload;
}
