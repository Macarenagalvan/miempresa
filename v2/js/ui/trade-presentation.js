import { el } from "./render.js";

export function localDateTimeValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function tradeState(trade) {
  return trade.lifecycle === "VOID" ? "VOID" : trade.isDraft ? "DRAFT" : trade.lifecycle;
}

export function stateBadge(trade) {
  const state = tradeState(trade);
  return el("span", { className: "state-badge state-" + state.toLowerCase(), text: ({
    DRAFT: "BORRADOR", OPEN: "Abierta", CLOSED: "Cerrada", VOID: "Anulada",
  })[state] || state });
}

export function tradeSection(title, fields) {
  return el("section", { className: "trade-form-section" }, [
    el("div", { className: "trade-section-heading" }, [el("h2", { text: title })]),
    el("div", { className: "trade-fields-grid" }, fields),
  ]);
}
