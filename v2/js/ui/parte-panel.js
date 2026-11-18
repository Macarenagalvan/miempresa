// Panel "Parte del día" en Hoy. Todo se pinta como texto (textContent); nada del parte se ejecuta.
import { el } from "./render.js";
import { fetchParte, personalAlerts } from "../domain/parte.js";
import { loadDayStatus, ymd } from "../domain/plan-rules.js";

const ext = (text, href) => (href ? el("a", { href, target: "_blank", rel: "noopener noreferrer", text }) : el("span", { text }));

export function parteNode(p, status, today = ymd(new Date())) {
  const fresh = p.date === today;
  const when = fresh ? (p.slot === "pm" ? "antes de NY" : "antes de Londres") : `del ${p.date.split("-").reverse().join("/")}`;
  const box = el("section", { className: "panel parte", "aria-label": "Parte del día" });
  box.append(el("div", { className: "plan-head" }, [
    el("h2", { text: `Parte del Nasdaq · ${when}` }),
    el("span", { className: "parte-bias is-" + p.bias.toLowerCase(), text: p.biasLabel }),
  ]));
  if (!fresh) box.append(el("p", { className: "meta", text: "Todavía no hay parte de hoy; este es el último." }));
  if (p.biasNote) box.append(el("p", { text: p.biasNote }));
  const mine = personalAlerts(p, status);
  const alerts = [...mine, ...p.alerts];
  if (alerts.length) box.append(el("ul", { className: "parte-alerts" }, alerts.map((a) => el("li", { text: a }))));
  if (p.events.length) {
    box.append(el("h3", { text: "Calendario (hora de Italia)" }), el("ul", { className: "parte-list" }, p.events.map((e) =>
      el("li", { className: e.impact === "high" ? "is-high" : "" }, [
        el("strong", { text: (e.time || "—") + " " }), ext(e.title, e.url),
        e.confirmed ? null : el("span", { className: "meta", text: " (sin confirmar)" }),
      ]))));
  }
  if (p.earnings.length) box.append(el("h3", { text: "Resultados que mueven el NQ" }), el("ul", { className: "parte-list" }, p.earnings.map((e) =>
    el("li", {}, [ext(e.company, e.url), el("span", { text: ` · ${e.when}${e.note ? " · " + e.note : ""}` })]))));
  if (p.gauges.length) box.append(el("div", { className: "plan-chips" }, p.gauges.map((g) =>
    el("div", { className: "plan-chip is-ok", title: g.note }, [el("span", { text: g.name }), el("strong", { text: g.value }), g.note ? el("span", { text: g.note }) : null]))));
  if (p.overnight.length) {
    const d = el("details", {}, [el("summary", { text: "Qué pasó" }), el("ul", { className: "parte-list" }, p.overnight.map((s) => el("li", { text: s })))]);
    box.append(d);
  }
  if (p.sources.length) box.append(el("p", { className: "meta parte-sources" }, ["Fuentes: ", ...p.sources.flatMap((s, i) => [i ? " · " : "", ext(s.title || "link", s.url)])]));
  box.append(el("p", { className: "meta", text: "Resumen automático: es contexto, no una señal. Confirmá la hora de los datos fuertes en su link." }));
  return box;
}

export async function partePanel(ctx) {
  const holder = el("div", { className: "parte-holder" });
  // No bloquea Hoy: carga en segundo plano y aparece cuando llega.
  Promise.all([fetchParte(), loadDayStatus(ctx.stage.id).catch(() => null)])
    .then(([p, status]) => { if (p) holder.replaceChildren(parteNode(p, status)); })
    .catch(() => {});
  return holder;
}
