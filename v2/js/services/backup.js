import { JOURNAL_EDITION, SCHEMA_VERSION } from "../config.js";
import { nowIso } from "../domain/ids.js";
import { getMeta, putMeta } from "../storage/repos/meta.js";
import { dumpCollections } from "../storage/repos/collections.js";

export async function buildExportPayload() {
  const meta = await getMeta();
  const collections = await dumpCollections();
  return {
    journalEdition: JOURNAL_EDITION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    meta,
    ...collections,
  };
}

export async function downloadExport() {
  const payload = await buildExportPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const stamp = payload.exportedAt.slice(0, 19).replace(/[:T]/g, "-");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `journal-v2-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  if (payload.meta) {
    await putMeta({ ...payload.meta, lastBackupAt: payload.exportedAt });
  }
  return payload;
}
