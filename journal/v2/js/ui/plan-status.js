// Panel "Reglas de hoy" (en Hoy) y aviso corto (al registrar un trade).
import { el } from "./render.js";
import { go } from "./router.js";
import { SIGNALS, loadDayStatus, setDaySignal } from "../domain/plan-rules.js";

const money = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + "$" + Math.abs(v).toFixed(2).replace(/\.00$/, "");

function chip(label, text, state) {
  return el("div", { className: "plan-chip is-" + state }, [el("span", { text: label }), el("strong", { text })]);
}

export async function planTodayPanel(ctx) {
  const box = el("section", { className: "panel plan-today", "aria-label": "Reglas de hoy" });
  const paint = async () => {
    const s = await loadDayStatus(ctx.stage.id);
    box.replaceChildren();
    if (!s) {
      box.append(el("h2", { text: "Reglas de hoy" }),
        el("p", { className: "meta", text: "Cargá los números de tu plan y el journal te avisa cuando llegás a un límite." }),
        el("button", { type: "button", text: "Cargar mis reglas", onclick: () => go("practica") }));
      return;
    }
    const head = el("div", { className: "plan-head" }, [el("h2", { text: "Reglas de hoy" }), el("button", { type: "button", className: "link-btn", text: "Editar reglas", onclick: () => go("practica") })]);
    box.append(head);
    if (s.closed) {
      box.append(el("div", { className: "plan-closed", role: "alert" }, [
        el("strong", { text: "Día cerrado. Mirá el gráfico, no operes." }),
        el("ul", {}, s.stops.map((w) => el("li", { text: w }))),
      ]));
    }
    const chips = s.checks.map((c) => chip(c.label, `${c.value}/${c.limit}`, c.state));
    for (const a of s.accounts) {
      const worst = a.checks.some((c) => c.state === "stop") ? "stop" : a.checks.some((c) => c.state === "warn") ? "warn" : "ok";
      chips.push(chip(a.account.name, `hoy ${money(a.day)} · semana ${money(a.week)}${a.risk != null ? ` · riesgo $${a.risk}` : ""}`, worst));
    }
    if (chips.length) box.append(el("div", { className: "plan-chips" }, chips));
    const funded = s.accounts.filter((a) => a.riskNote);
    for (const a of funded) box.append(el("p", { className: "meta", text: `${a.account.name}: ${a.riskNote}.` }));
    if (s.rules.signalsLimit != null) {
      const list = el("div", { className: "plan-signals" }, SIGNALS.map(([key, label]) => {
        const auto = s.auto.includes(key);
        const box2 = el("input", { type: "checkbox" });
        box2.checked = s.signals.includes(key);
        box2.disabled = auto;
        box2.addEventListener("change", async () => { box2.disabled = true; await setDaySignal(key, box2.checked); await paint(); });
        return el("label", { className: "journal-confirm" }, [box2, el("span", { text: label + (auto ? " (marcado en un trade)" : "") })]);
      }));
      box.append(el("h3", { text: `Señales de que no estoy apta · ${s.signals.length}/${s.rules.signalsLimit}` }), list);
    }
  };
  await paint();
  return box;
}

/** Aviso corto para el formulario de trade. No bloquea: un trade ya hecho se registra igual. */
export async function planWarning(ctx) {
  try {
    const s = await loadDayStatus(ctx.stage.id);
    if (!s || !s.closed) return null;
    return el("div", { className: "plan-closed", role: "note" }, [
      el("strong", { text: "Según tu plan, hoy ya cerraste:" }),
      el("ul", {}, s.stops.map((w) => el("li", { text: w }))),
      el("span", { className: "meta", text: "Si es un trade que ya hiciste, registralo igual: sirve para revisarlo." }),
    ]);
  } catch { return null; }
}
