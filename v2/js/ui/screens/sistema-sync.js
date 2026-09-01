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

async function refreshSyncPanel(node) {
  const panel = node.closest("#sincronizacion");
  if (!panel) return;
  panel.replaceWith(await buildSincronizacionPanel());
}

export async function buildSincronizacionPanel() {
  const state = await getAuthState();
  const cfg = readSupabaseConfig();
  const err = el("p", { className: "err sync-err", text: state.status === "error" ? (state.error || "") : "" });
  const statusLine = el("p", { className: "sync-status", text: authLabel(state) });
  const hint = el("p", {
    className: "hint",
    text: state.status === "missing_config"
      ? "Falta la URL y la key pública de Supabase. No hay sync todavía: esto solo autentica."
      : "Login no sube ni baja el Journal. La sincronización se activa en O8C.",
  });

  const syncNow = el("button", {
    type: "button",
    className: "ghost sync-now",
    text: "Sincronizar ahora",
    disabled: "disabled",
  });
  syncNow.disabled = true;
  const syncNowHint = el("p", {
    className: "meta",
    text: "Disponible después de activar la sincronización.",
  });

  const children = [
    el("p", { className: "kicker", text: "Nube" }),
    el("h1", { text: "Sincronización" }),
    statusLine,
    hint,
    err,
  ];

  if (state.status === "signed_in") {
    const outBtn = el("button", { type: "button", className: "ghost sync-logout", text: "Cerrar sesión" });
    outBtn.addEventListener("click", async () => {
      err.textContent = "";
      await signOut();
      await refreshSyncPanel(outBtn);
    });
    children.push(el("div", { className: "row-actions" }, [outBtn, syncNow]));
    children.push(syncNowHint);
  } else {
    const email = el("input", {
      className: "input sync-email",
      type: "email",
      placeholder: "email",
      autocomplete: "username",
    });
    const password = el("input", {
      className: "input sync-password",
      type: "password",
      placeholder: "contraseña",
      autocomplete: "current-password",
    });
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
      el("div", { className: "row-actions" }, [inBtn, syncNow]),
    ]));
    children.push(syncNowHint);
  }

  const urlInput = el("input", {
    className: "input sync-url",
    type: "url",
    value: cfg.url,
    placeholder: "https://xxxx.supabase.co",
    autocomplete: "off",
  });
  const keyInput = el("input", {
    className: "input sync-key",
    type: "password",
    value: cfg.publishableKey,
    placeholder: "publishable / anon key",
    autocomplete: "off",
  });
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
