import { el } from "../render.js";
import {
  downloadExport,
  downloadCurrentBackup,
  previewBackupText,
  restoreBackup,
} from "../../services/backup.js";
import { getMeta, putMeta } from "../../storage/repos/meta.js";
import { applyIdentity, visibleName, iconBtn, ICONS } from "../identity.js";
import { DB_NAME, SCHEMA_VERSION, BACKUP_PRODUCT, BACKUP_FORMAT, BACKUP_VERSION } from "../../config.js";
import {
  addOfficeShortcut,
  updateOfficeShortcut,
  archiveOfficeShortcut,
  moveOfficeShortcut,
  listHoyShortcuts,
} from "../../domain/office-shortcut.js";
import { buildSincronizacionPanel } from "./sistema-sync.js";

function countLines(preview) {
  const c = preview.counts || {};
  return [
    el("p", { className: "meta", text: `archivo ${preview.fileName || "—"}` }),
    el("p", { className: "meta", text: `producto ${preview.product || "—"} · formato ${preview.format || "—"}` }),
    el("p", { className: "meta", text: `journalEdition ${preview.journalEdition || "—"} · schema ${preview.schemaVersion ?? "—"} · backup ${preview.backupVersion ?? "—"}` }),
    el("p", { className: "meta", text: `fecha ${preview.exportedAt || "—"}` }),
    el("p", { className: "meta", text: preview.ok ? "válido" : `inválido · ${preview.reason || preview.kind}` }),
    el("p", { className: "meta", text: `Stage(s) ${c.stages || 0}` }),
    el("p", { className: "meta", text: `Observations ${c.observations || 0} · Setups ${c.setups || 0} · Trades ${c.trades || 0}` }),
    el("p", { className: "meta", text: `ASRs ${c.asrs || 0} · Accounts ${c.accounts || 0} · Movements ${c.movements || 0}` }),
    el("p", { className: "meta", text: `Challenges ${c.challenges || 0} · Payouts ${c.payouts || 0} · Signals ${c.signals || 0}` }),
    el("p", { className: "meta", text: `attachments ${c.attachments || 0}` }),
  ];
}
