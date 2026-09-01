import { el } from "../render.js";
import {
  downloadExport,
  downloadCurrentBackup,
  previewBackupText,
  restoreBackup,
} from "../../services/backup.js";
import { getMeta, putMeta } from "../../storage/repos/meta.js";
import { applyIdentity, visibleName } from "../identity.js";
import {
  addOfficeShortcut,
  updateOfficeShortcut,
  archiveOfficeShortcut,
  moveOfficeShortcut,
  listHoyShortcuts,
} from "../../domain/office-shortcut.js";

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

function ghostMini(label, className, onClick) {
  const btn = el("button", { type: "button", className: "ghost task-mini " + className, text: label });
  btn.addEventListener("click", onClick);
  return btn;
}

async function refreshOficina(node) {
  const panel = node.closest(".office-sistema");
  if (!panel) return;
  panel.replaceWith(await buildOficinaPanel());
}

function shortcutEditor(item) {
  const labelField = el("input", { className: "input shortcut-edit-label", type: "text", value: item.label });
  const urlField = el("input", { className: "input shortcut-edit-url", type: "text", value: item.url });
  return { labelField, urlField };
}

async function buildOficinaPanel() {
  const items = await listHoyShortcuts();
  const err = el("p", { className: "err shortcut-err", text: "" });
  const labelInput = el("input", {
    className: "input shortcut-label",
    type: "text",
    placeholder: "TradingView",
    autocomplete: "off",
  });
  const urlInput = el("input", {
    className: "input shortcut-url",
    type: "url",
    placeholder: "https://… o http://localhost:8080",
    autocomplete: "off",
  });
  const addBtn = el("button", { type: "button", className: "ghost shortcut-add", text: "Agregar" });

  async function submit() {
    err.textContent = "";
    try {
      await addOfficeShortcut({ label: labelInput.value, url: urlInput.value });
      labelInput.value = "";
      urlInput.value = "";
      await refreshOficina(addBtn);
    } catch (e) {
      err.textContent = e.message;
    }
  }
  addBtn.addEventListener("click", submit);
  urlInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      submit();
    }
  });

  const rows = items.map((item, index) => {
    const row = el("div", { className: "shortcut-admin-row" });
    function showEdit() {
      const fields = shortcutEditor(item);
      const save = ghostMini("Guardar", "shortcut-save", async () => {
        err.textContent = "";
        try {
          await updateOfficeShortcut(item.id, { label: fields.labelField.value, url: fields.urlField.value });
          await refreshOficina(row);
        } catch (e) {
          err.textContent = e.message;
        }
      });
      const cancel = ghostMini("Cancelar", "shortcut-cancel", async () => {
        await refreshOficina(row);
      });
      row.replaceChildren(el("div", { className: "shortcut-edit" }, [
        fields.labelField, fields.urlField, save, cancel,
      ]));
      fields.labelField.focus();
    }
    row.append(
      el("div", { className: "shortcut-admin-main" }, [
        el("p", { className: "shortcut-admin-label", text: item.label }),
        el("p", { className: "shortcut-admin-url", text: item.url }),
      ]),
      el("div", { className: "shortcut-admin-actions" }, [
        ghostMini("Subir", "shortcut-up", async () => {
          if (index === 0) return;
          await moveOfficeShortcut(item.id, "up");
          await refreshOficina(row);
        }),
        ghostMini("Bajar", "shortcut-down", async () => {
          if (index === items.length - 1) return;
          await moveOfficeShortcut(item.id, "down");
          await refreshOficina(row);
        }),
        ghostMini("Editar", "shortcut-edit-btn", showEdit),
        ghostMini("Archivar", "shortcut-archive-btn", async () => {
          await archiveOfficeShortcut(item.id);
          await refreshOficina(row);
        }),
      ]),
    );
    return row;
  });

  const empty = items.length
    ? null
    : el("p", { className: "empty office-empty", text: "Todavía no configuraste accesos rápidos." });

  return el("section", { className: "panel office-sistema", id: "oficina" }, [
    el("p", { className: "kicker", text: "Oficina" }),
    el("h1", { text: "Accesos rápidos" }),
    el("p", { className: "hint", text: "Se abren desde Hoy. No entran a Números. Ejemplos (no se guardan solos): TradingView, RGM Desk." }),
    el("div", { className: "shortcut-composer" }, [labelInput, urlInput, addBtn]),
    err,
    empty,
    el("div", { className: "shortcut-admin-list" }, rows),
  ]);
}

export async function renderSistema(ctx) {
  const status = el("p", { className: "hint", text: "Restore reemplaza todo el Journal. No hay merge." });
  const err = el("p", { className: "err", text: "" });
  const previewBox = el("div", { className: "list" }, []);
  const file = el("input", { className: "input", type: "file", accept: "application/json,.json" });
  file.style.display = "none";

  let pendingText = "";
  let pendingName = "";
  let preview = null;
  let protectedNow = false;

  const confirmCheck = el("input", { type: "checkbox" });
  confirmCheck.disabled = true;
  const protectCheck = el("input", { type: "checkbox" });
  protectCheck.disabled = true;

  const restoreBtn = el("button", { type: "button", className: "danger", text: "Confirmar reemplazo" });
  restoreBtn.disabled = true;

  function refreshRestoreGate() {
    restoreBtn.disabled = !(preview && preview.ok && confirmCheck.checked && protectCheck.checked && protectedNow);
  }

  function showPreview(next) {
    preview = next;
    const extra = [];
    if (next.kind === "v1") {
      extra.push(el("p", { className: "err", text: "Este archivo pertenece a Journal V1 y no puede restaurarse en Journal V2." }));
    }
    if (next.errors && next.errors.length) {
      extra.push(el("p", { className: "err", text: next.errors.slice(0, 8).join(" · ") }));
    }
    if (next.incompatibilities && next.incompatibilities.length) {
      extra.push(el("p", { className: "err", text: next.incompatibilities.join(" · ") }));
    }
    previewBox.replaceChildren(...countLines(next), ...extra);
    confirmCheck.checked = false;
    confirmCheck.disabled = !next.ok;
    refreshRestoreGate();
  }

  const exportBtn = el("button", { type: "button", text: "Exportar backup" });
  exportBtn.addEventListener("click", async () => {
    err.textContent = "";
    exportBtn.disabled = true;
    try {
      await downloadExport();
      status.textContent = "Backup V2 descargado.";
    } catch (e) {
      err.textContent = e.message;
    } finally {
      exportBtn.disabled = false;
    }
  });

  const protectBtn = el("button", { type: "button", className: "ghost", text: "Descargar backup actual" });
  protectBtn.addEventListener("click", async () => {
    err.textContent = "";
    try {
      const saved = await downloadCurrentBackup();
      protectedNow = true;
      protectCheck.disabled = false;
      status.textContent = `Backup previo: ${saved.filename}`;
    } catch (e) {
      protectedNow = false;
      protectCheck.checked = false;
      protectCheck.disabled = true;
      err.textContent = e.message;
    }
    refreshRestoreGate();
  });

  const pickBtn = el("button", { type: "button", text: "Elegir backup JSON" });
  pickBtn.addEventListener("click", () => {
    err.textContent = "";
    file.click();
  });

  file.addEventListener("change", async () => {
    const chosen = file.files && file.files[0];
    file.value = "";
    if (!chosen) return;
    try {
      pendingText = await chosen.text();
      pendingName = chosen.name;
      const next = previewBackupText(pendingText, pendingName);
      showPreview(next);
    } catch (e) {
      err.textContent = e.message;
    }
  });

  confirmCheck.addEventListener("change", refreshRestoreGate);
  protectCheck.addEventListener("change", refreshRestoreGate);

  restoreBtn.addEventListener("click", async () => {
    err.textContent = "";
    if (!pendingText || !preview || !preview.ok) {
      err.textContent = "Elegí un backup V2 válido y revisá el preview.";
      return;
    }
    if (!protectedNow || !protectCheck.checked) {
      err.textContent = "Descargá el backup actual antes de restaurar.";
      return;
    }
    if (!confirmCheck.checked) {
      err.textContent = "Confirmá que entendés que el restore reemplaza todo.";
      return;
    }
    restoreBtn.disabled = true;
    try {
      await restoreBackup(pendingText, {
        confirmed: true,
        alreadyProtected: true,
        fileName: pendingName,
      });
      status.textContent = "Restore completo. Recargando…";
      location.reload();
    } catch (e) {
      err.textContent = e.message;
      restoreBtn.disabled = false;
    }
  });

  const confirmLabel = el("label", { className: "check" }, [
    confirmCheck,
    el("span", { text: "Entiendo que esto borra el Journal actual y lo reemplaza." }),
  ]);
  const protectLabel = el("label", { className: "check" }, [
    protectCheck,
    el("span", { text: "Ya descargué el backup del estado actual." }),
  ]);

  const meta = await getMeta();
  const nameInput = el("input", { className: "input", value: visibleName(meta), placeholder: "Maca" });
  const nameStatus = el("p", { className: "hint", text: "Aparece en el saludo y en la barra. Sin login." });
  const saveName = el("button", { type: "button", text: "Guardar nombre" });
  saveName.addEventListener("click", async () => {
    const next = { ...meta, traderName: String(nameInput.value || "").trim() };
    await putMeta(next);
    if (ctx) ctx.meta = next;
    applyIdentity(next, ctx && ctx.stage);
    nameStatus.textContent = next.traderName
      ? "Nombre visible: " + next.traderName
      : "Nombre vacío. El saludo queda en Buen día, sin Trader.";
  });

  return [
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: "Perfil" }),
      el("h1", { text: "Quién usa este journal" }),
      el("label", { className: "field" }, [
        el("span", { text: "Nombre visible" }),
        nameInput,
      ]),
      nameStatus,
      el("div", { className: "row-actions" }, [saveName]),
    ]),
    await buildOficinaPanel(),
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: "Sistema · técnico" }),
      el("h1", { text: "Backup / Restore" }),
      el("p", { className: "hint", text: "Producto técnico: Journal V2. Solo backup nativo. No migra V1, CSV MT5 ni JSONL RGM." }),
      el("div", { className: "row-actions" }, [exportBtn]),
    ]),
    el("section", { className: "panel panel-danger" }, [
      el("p", { className: "kicker", text: "Operación destructiva" }),
      el("h2", { text: "Restaurar backup" }),
      status,
      file,
      el("div", { className: "row-actions" }, [pickBtn, protectBtn, restoreBtn]),
      confirmLabel,
      protectLabel,
      err,
      previewBox,
    ]),
  ];
}
