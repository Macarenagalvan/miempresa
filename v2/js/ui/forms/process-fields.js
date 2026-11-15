// Campos de proceso con fichas tocables (un toque para elegir, otro para quitar).
import { el } from "../render.js";
import { FAMILIES, CONFLUENCES, EMOTIONS, PLAN, ERRORS } from "../../domain/process.js";

function single(name, list, current) {
  let value = current || null;
  const buttons = list.map(([key, text]) => {
    const b = el("button", { type: "button", className: "chip", text, "aria-pressed": "false" });
    b.addEventListener("click", () => { value = value === key ? null : key; paint(); });
    b.dataset.value = key;
    return b;
  });
  function paint() { for (const b of buttons) { const on = b.dataset.value === value; b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on)); } }
  paint();
  return { node: el("div", { className: "chips", role: "group", "aria-label": name, "data-process": name }, buttons), read: () => value };
}

function multi(name, list, current) {
  const value = new Set(current || []);
  const buttons = list.map(([key, text]) => {
    const b = el("button", { type: "button", className: "chip", text, "aria-pressed": "false" });
    b.addEventListener("click", () => { if (value.has(key)) value.delete(key); else value.add(key); paint(); });
    b.dataset.value = key;
    return b;
  });
  function paint() { for (const b of buttons) { const on = value.has(b.dataset.value); b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on)); } }
  paint();
  return { node: el("div", { className: "chips", role: "group", "aria-label": name, "data-process": name }, buttons), read: () => [...value] };
}

const row = (label, control, hint) => el("div", { className: "process-row" }, [
  el("span", { className: "process-label", text: label }), control.node, hint ? el("span", { className: "process-hint", text: hint }) : null,
]);

/**
 * opts.emotion / opts.errors: mostrar esos bloques (en backtesting suelen sobrar).
 */
export function processFields(current = null, opts = {}) {
  const { emotion = true, errors = true } = opts;
  const family = single("Tipo de setup", FAMILIES, current?.family);
  const plan = single("¿Seguiste el plan?", PLAN, current?.plan);
  const conf = multi("Confluencias", CONFLUENCES, current?.confluences);
  const emo = single("Cómo estabas", EMOTIONS, current?.emotion);
  const errs = multi("Errores", ERRORS, current?.errors);
  const node = el("div", { className: "process-fields" }, [
    row("Tipo de setup", family),
    row("¿Seguiste el plan?", plan),
    row("Confluencias", conf, "Marcá las que estaban antes de entrar."),
    emotion ? row("Cómo estabas al entrar", emo) : null,
    errors ? row("Errores", errs, "Sin juicio: es para ver patrones.") : null,
  ]);
  return {
    node,
    read: () => ({
      family: family.read(), plan: plan.read(), confluences: conf.read(),
      emotion: emotion ? emo.read() : current?.emotion || null,
      errors: errors ? errs.read() : current?.errors || [],
    }),
  };
}
