import { el } from "../render.js";
import {
  downloadExport,
  downloadCurrentBackup,
  previewBackupText,
  restoreBackup,
} from "../../services/backup.js";
import { getMeta, putMeta } from "../../storage/repos/meta.js";
import { applyIdentity, visibleName } from "../identity.js";

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
