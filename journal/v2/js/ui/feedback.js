// Confirmaciones y avisos reutilizables: un solo estilo para toda la app.
import { el } from "./render.js";

/**
 * Pregunta antes de una acción. Devuelve true solo si la persona confirma.
 * opts: { title, body (string|string[]), confirmText, cancelText, danger }
 */
export function confirmDialog(opts = {}) {
  return new Promise((resolve) => {
    const {
      title = "¿Estás segura?",
      body = "",
      confirmText = "Sí, continuar",
      cancelText = "Cancelar",
      danger = false,
    } = opts;
    const lines = [].concat(body).filter(Boolean);
    const cancel = el("button", { type: "button", className: "ghost", text: cancelText });
    const confirm = el("button", { type: "button", className: danger ? "btn-danger" : "", text: confirmText });
    const dialog = el("dialog", { className: "rgm-dialog", "aria-labelledby": "rgm-dialog-title" }, [
      el("h2", { id: "rgm-dialog-title", text: title }),
      ...lines.map((line) => (line && line.nodeType ? line : el("p", { text: line }))),
      el("div", { className: "row-actions" }, [cancel, confirm]),
    ]);
    let answered = false;
    const finish = (value) => {
      if (answered) return;
      answered = true;
      try { dialog.close(); } catch (_) { /* ya cerrado */ }
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(false); });
    dialog.addEventListener("click", (e) => { if (e.target === dialog) finish(false); });
    document.body.append(dialog);
    dialog.showModal();
    (danger ? cancel : confirm).focus();
  });
}

let activeToast = null;

/**
 * Aviso breve abajo de la pantalla. Con actionText muestra un botón (ej. Deshacer).
 * Sobrevive a los cambios de pantalla porque vive en <body>.
 */
export function toast(message, opts = {}) {
  const { actionText = null, onAction = null, timeout = 4000, tone = "" } = opts;
  if (activeToast) activeToast.dismiss();
  const bar = el("div", { className: "rgm-toast" + (tone ? " is-" + tone : ""), role: "status", "aria-live": "polite" });
  const text = el("span", { text: message });
  bar.append(text);
  let timer = null;
  const handle = {
    dismiss() {
      clearTimeout(timer);
      bar.classList.add("is-leaving");
      setTimeout(() => bar.remove(), 200);
      if (activeToast === handle) activeToast = null;
    },
  };
  if (actionText && onAction) {
    const progress = el("i", { className: "rgm-toast-progress" });
    progress.style.animationDuration = timeout + "ms";
    const action = el("button", { type: "button", className: "rgm-toast-action", text: actionText });
    action.addEventListener("click", async () => {
      action.disabled = true;
      clearTimeout(timer);
      try { await onAction(); } finally { handle.dismiss(); }
    });
    bar.append(action, progress);
  }
  const close = el("button", { type: "button", className: "rgm-toast-close", "aria-label": "Cerrar aviso", text: "×" });
  close.addEventListener("click", () => handle.dismiss());
  bar.append(close);
  document.body.append(bar);
  timer = setTimeout(() => handle.dismiss(), timeout);
  activeToast = handle;
  return handle;
}
