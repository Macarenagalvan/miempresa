// Acciones rápidas sobre operaciones: borrar (con confirmación + Deshacer) y editar.
import { el } from "./render.js";
import { go } from "./router.js";
import { confirmDialog, toast } from "./feedback.js";
import { previewTradeDeletion, deleteTrades, restoreDeletedTrades } from "../domain/trade-delete.js";

function refresh() {
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function describe(trade) {
  const day = String(trade.sourceRef?.sessionDate || trade.closedAt || trade.openedAt || "").slice(0, 10);
  return [trade.asset || "Sin activo", trade.direction || "", day].filter(Boolean).join(" · ");
}

/** Pide confirmación, borra y ofrece Deshacer. after: ruta a la que volver. */
export async function deleteTradeFlow(trade, { after = null } = {}) {
  const isBacktest = trade.context === "BACKTEST";
  const noun = isBacktest ? "backtest" : "operación";
  const preview = await previewTradeDeletion(trade.id);
  const extras = [];
  if (preview.attachments) extras.push(`${preview.attachments} captura${preview.attachments === 1 ? "" : "s"}`);
  if (preview.asrs) extras.push("su revisión");
  const ok = await confirmDialog({
    title: isBacktest ? "¿Borrar este backtest?" : "¿Borrar esta operación?",
    body: [
      el("p", { className: "rgm-dialog-target", text: describe(trade) }),
      extras.length ? `También se borran ${extras.join(" y ")}.` : null,
      "Vas a tener unos segundos para deshacerlo. No cambia nada en MT5.",
    ],
    confirmText: "Sí, borrar",
    danger: true,
  });
  if (!ok) return false;
  const { snapshot } = await deleteTrades(trade.id);
  if (after) go(after); else refresh();
  toast(`${isBacktest ? "Backtest" : "Operación"} borrad${isBacktest ? "o" : "a"}.`, {
    actionText: "Deshacer",
    timeout: 8000,
    onAction: async () => {
      await restoreDeletedTrades(snapshot);
      refresh();
      toast("Restaurado.", { timeout: 2500, tone: "ok" });
    },
  });
  return true;
}

/** Botones compactos Editar / Borrar para una fila de lista. */
export function rowActions(trade, { editable = true } = {}) {
  const stop = (fn) => (event) => { event.stopPropagation(); event.preventDefault(); fn(); };
  const edit = editable
    ? el("button", { type: "button", className: "icon-btn", title: "Editar", "aria-label": "Editar " + describe(trade),
      onclick: stop(() => go("trade/" + trade.id + "/editar")) }, [pencil()])
    : null;
  const del = el("button", { type: "button", className: "icon-btn is-danger", title: "Borrar", "aria-label": "Borrar " + describe(trade),
    onclick: stop(() => deleteTradeFlow(trade).catch((e) => toast(e.message, { tone: "error" }))) }, [trash()]);
  return el("div", { className: "row-quick" }, [edit, del]);
}

function svg(d) {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.8"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  for (const path of d) { const p = document.createElementNS(ns, "path"); p.setAttribute("d", path); s.append(p); }
  return s;
}
const pencil = () => svg(["M4 20h4L19 9l-4-4L4 16z", "M13.5 6.5l4 4"]);
const trash = () => svg(["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13", "M10 11v6M14 11v6"]);

/** Borrar un estudio / NO TRADE con confirmación y Deshacer. */
export async function deleteStudyFlow(obs, { after = null } = {}) {
  const { deleteObservation, restoreDeletedObservation } = await import("../domain/trade-delete.js");
  const ok = await confirmDialog({
    title: "¿Borrar este estudio?",
    body: [
      el("p", { className: "rgm-dialog-target", text: [obs.asset, obs.studyOutcome === "NO_TRADE" ? "NO TRADE" : "Estudio", obs.date].filter(Boolean).join(" · ") }),
      "Se borran también sus capturas. Vas a tener unos segundos para deshacerlo.",
    ],
    confirmText: "Sí, borrar",
    danger: true,
  });
  if (!ok) return false;
  const { snapshot } = await deleteObservation(obs.id);
  if (after) go(after); else refresh();
  toast("Estudio borrado.", {
    actionText: "Deshacer", timeout: 8000,
    onAction: async () => { await restoreDeletedObservation(snapshot); refresh(); toast("Restaurado.", { timeout: 2500, tone: "ok" }); },
  });
  return true;
}

export function studyRowActions(obs) {
  const stop = (fn) => (event) => { event.stopPropagation(); event.preventDefault(); fn(); };
  return el("div", { className: "row-quick" }, [
    el("button", { type: "button", className: "icon-btn", title: "Editar", "aria-label": "Editar estudio " + obs.asset, onclick: stop(() => go("observacion/" + obs.id)) }, [pencil()]),
    el("button", { type: "button", className: "icon-btn is-danger", title: "Borrar", "aria-label": "Borrar estudio " + obs.asset,
      onclick: stop(() => deleteStudyFlow(obs).catch((e) => toast(e.message, { tone: "error" }))) }, [trash()]),
  ]);
}
