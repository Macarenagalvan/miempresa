import { el } from "../render.js";
import {
  getAuthState,
  signInWithPassword,
  signOut,
  authLabel,
  readSupabaseConfig,
  saveSupabaseConfig,
  configReady,
} from "../../services/auth.js";
import {
  getSyncSnapshot,
  syncStatusLabel,
  isOnline,
  syncNow,
  enableAndUploadLocalJournal,
  countLocalSyncable,
  cloudLooksEmpty,
  isRestoreBlocked,
  resolveConflictKeepLocal,
  resolveConflictUseCloud,
} from "../../services/sync-engine.js";
import { pullCloudRecords } from "../../services/sync-cloud.js";

async function refreshSyncPanel(node) {
  const panel = node.closest("#sincronizacion");
  if (!panel) return;
  panel.replaceWith(await buildSincronizacionPanel());
}

function formatWhen(iso) {
  if (!iso) return "nunca";
  return String(iso).replace("T", " ").slice(0, 19);
}

export async function buildSincronizacionPanel() {
  const state = await getAuthState();
  const cfg = readSupabaseConfig();
  const snap = await getSyncSnapshot();
  const online = isOnline();
  const syncState = snap.state;
  const err = el("p", {
    className: "err sync-err",
    text: state.status === "error" ? (state.error || "") : (syncState.lastError || ""),
  });
  const statusLine = el("p", { className: "sync-status", text: authLabel(state) });
  const engineLine = el("p", { className: "sync-engine-status", text: syncStatusLabel(snap, state, online) });
  const hint = el("p", {
    className: "hint",
    text: state.status === "missing_config"
      ? "Falta la URL y la key pública de Supabase. No hay sync todavía: esto solo autentica."
      : (syncState.enabled
        ? "IndexedDB sigue siendo la fuente de verdad. La nube es réplica."
        : "Disponible después de activar la sincronización."),
  });

  const syncNowBtn = el("button", { type: "button", className: "ghost sync-now", text: "Sincronizar ahora" });
  const canSync = state.status === "signed_in" && syncState.enabled && online && !snap.conflicts.length;
  syncNowBtn.disabled = !canSync;
  syncNowBtn.addEventListener("click", async () => {
    err.textContent = "";
    try {
      await syncNow({ reason: "manual" });
      await refreshSyncPanel(syncNowBtn);
    } catch (e) {
      err.textContent = e.message;
    }
  });

  const children = [
    el("p", { className: "kicker", text: "Nube" }),
    el("h1", { text: "Sincronización" }),
    statusLine,
    engineLine,
    hint,
    el("p", { className: "meta", text: "Última sync: " + formatWhen(syncState.lastSyncAt) }),
    el("p", { className: "meta", text: "Cambios pendientes: " + String(snap.pending) }),
    el("p", { className: "meta", text: "Dispositivo: " + (syncState.deviceId || "—") }),
    err,
  ];

  if (state.status === "signed_in") {
    const outBtn = el("button", { type: "button", className: "ghost sync-logout", text: "Cerrar sesión" });
    outBtn.addEventListener("click", async () => {
      err.textContent = "";
      await signOut();
      await refreshSyncPanel(outBtn);
    });
    children.push(el("div", { className: "row-actions" }, [outBtn, syncNowBtn]));
    if (!syncState.enabled) {
      const count = await countLocalSyncable();
      let cloudEmpty = true;
      if (online) {
        try {
          const rows = await pullCloudRecords();
          cloudEmpty = await cloudLooksEmpty(rows);
        } catch (e) {
          cloudEmpty = true;
          err.textContent = e.message;
        }
      }
      const uploadBtn = el("button", { type: "button", className: "sync-upload", text: "Subir este Journal a la nube" });
      uploadBtn.disabled = !online || !cloudEmpty || count === 0;
      uploadBtn.addEventListener("click", async () => {
        err.textContent = "";
        try {
          await enableAndUploadLocalJournal();
          await refreshSyncPanel(uploadBtn);
        } catch (e) {
          err.textContent = e.message;
        }
      });
      children.push(el("p", {
        className: "hint",
        text: cloudEmpty
          ? `Este dispositivo tiene ${count} registros locales. Cloud está vacío.`
          : "La nube ya tiene Journal. Este dispositivo tiene que bajar, no subir.",
      }));
      children.push(el("div", { className: "row-actions" }, [uploadBtn]));
    }
  } else {
    const email = el("input", { className: "input sync-email", type: "email", placeholder: "email", autocomplete: "username" });
    const password = el("input", { className: "input sync-password", type: "password", placeholder: "contraseña", autocomplete: "current-password" });
    const inBtn = el("button", { type: "button", className: "sync-login", text: "Iniciar sesión" });
    inBtn.addEventListener("click", async () => {
      err.textContent = "";
      if (!configReady(cfg)) {
        err.textContent = "Configurá URL y key pública antes de entrar.";
        return;
      }
      const result = await signInWithPassword(email.value, password.value);
      if (!result.ok) {
        err.textContent = (result.state && result.state.error) || "no se pudo iniciar sesión";
        return;
      }
      await refreshSyncPanel(inBtn);
    });
    children.push(el("div", { className: "sync-form" }, [
      el("label", { className: "field" }, [el("span", { text: "Email" }), email]),
      el("label", { className: "field" }, [el("span", { text: "Contraseña" }), password]),
      el("div", { className: "row-actions" }, [inBtn, syncNowBtn]),
    ]));
  }

  if (snap.conflicts.length) {
    children.push(el("h2", { text: "Conflicto" }));
    children.push(el("p", { className: "hint", text: "No se pisa ninguna versión. Elegí explícitamente cuál queda. El conflicto no se cierra si el push falla." }));
    for (const row of snap.conflicts) {
      const keepBtn = el("button", { type: "button", className: "ghost sync-keep-local", text: "Conservar local" });
      const cloudBtn = el("button", { type: "button", className: "ghost sync-use-cloud", text: "Usar versión de la nube" });
      keepBtn.disabled = !online;
      keepBtn.addEventListener("click", async () => {
        err.textContent = "";
        keepBtn.disabled = true;
        cloudBtn.disabled = true;
        try {
          const result = await resolveConflictKeepLocal(row.entityType, row.entityId);
          if (!result.ok) {
            err.textContent = result.reason === "stale"
              ? "La nube cambió mientras resolvías. El conflicto sigue abierto."
              : ("No se pudo conservar local: " + (result.reason || "error"));
          }
          await refreshSyncPanel(keepBtn);
        } catch (e) {
          err.textContent = e.message;
          keepBtn.disabled = false;
          cloudBtn.disabled = false;
        }
      });
      cloudBtn.addEventListener("click", async () => {
        err.textContent = "";
        keepBtn.disabled = true;
        cloudBtn.disabled = true;
        try {
          const result = await resolveConflictUseCloud(row.entityType, row.entityId);
          if (!result.ok) err.textContent = "No se pudo usar la nube: " + (result.reason || "error");
          await refreshSyncPanel(cloudBtn);
        } catch (e) {
          err.textContent = e.message;
          keepBtn.disabled = false;
          cloudBtn.disabled = false;
        }
      });
      children.push(el("article", { className: "sync-conflict" }, [
        el("p", { className: "kicker", text: row.entityType + " · " + row.entityId }),
        el("p", { className: "meta", text: "entidad " + row.entityType }),
        el("p", { className: "meta", text: "cloud revision " + String(row.cloudRevision) }),
        el("pre", { className: "sync-json", text: "versión local\n" + JSON.stringify(row.localPayload, null, 2) }),
        el("pre", { className: "sync-json", text: "versión cloud\n" + JSON.stringify(row.cloudPayload, null, 2) }),
        el("div", { className: "row-actions sync-conflict-actions" }, [keepBtn, cloudBtn]),
      ]));
    }
  }

  if (isRestoreBlocked(syncState)) {
    children.push(el("p", { className: "hint", text: "Restore local está bloqueado mientras la sincronización está activa. Seguridad > comodidad." }));
  }

  const urlInput = el("input", { className: "input sync-url", type: "url", value: cfg.url, placeholder: "https://xxxx.supabase.co", autocomplete: "off" });
  const keyInput = el("input", { className: "input sync-key", type: "password", value: cfg.publishableKey, placeholder: "publishable / anon key", autocomplete: "off" });
  const saveCfg = el("button", { type: "button", className: "ghost sync-save-cfg", text: "Guardar conexión" });
  saveCfg.addEventListener("click", async () => {
    err.textContent = "";
    try {
      saveSupabaseConfig({ url: urlInput.value, publishableKey: keyInput.value });
      await refreshSyncPanel(saveCfg);
    } catch (e) {
      err.textContent = e.message;
    }
  });
  children.push(el("details", { className: "sync-config-fold" }, [
    el("summary", { text: "Conexión de este dispositivo" }),
    el("p", { className: "hint", text: "URL del proyecto y key pública. Se guardan en este browser. Nunca una key de administración." }),
    urlInput,
    keyInput,
    el("div", { className: "row-actions" }, [saveCfg]),
  ]));
  return el("section", { className: "panel sync-panel", id: "sincronizacion" }, children);
}
