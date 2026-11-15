// Portada de "Hoy": saludo RGM, registro en un toque, semana y racha.
import { el } from "../render.js";
import { go } from "../router.js";
import { greetingLine, longDate } from "../identity.js";
import { listStageTrades } from "../../domain/trade.js";
import { listActiveObservations } from "../../domain/observation.js";
import { realizedR } from "../../domain/stats.js";
import { isTestRecord } from "../../domain/test-record.js";

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOf = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : ymd(d); };

function quickCard(title, line, route, tone) {
  return el("button", { type: "button", className: "pulse-action " + tone, onclick: () => go(route) }, [
    el("strong", { text: title }), el("span", { text: line }),
  ]);
}

export async function hoyPulse(ctx) {
  const trades = (await listStageTrades(ctx.stage.id, { includeVoid: false })).filter((t) => !isTestRecord(t));
  const studies = (await listActiveObservations(ctx.stage.id)).filter((o) => o.studyOutcome && !isTestRecord(o));
  const records = [
    ...trades.map((t) => ({ kind: t.context === "BACKTEST" ? "bt" : "trade", day: dayOf(t.createdAt), t })),
    ...studies.map((o) => ({ kind: "nt", day: dayOf(o.createdAt), o })),
  ].filter((r) => r.day);
  const byDay = new Map();
  for (const r of records) byDay.set(r.day, (byDay.get(r.day) || 0) + 1);

  // Racha: días seguidos con al menos un registro (si hoy todavía no, cuenta desde ayer).
  const today = new Date();
  let cursor = new Date(today);
  if (!byDay.has(ymd(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (byDay.has(ymd(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
  const doneToday = byDay.has(ymd(today));

  // Semana actual (lunes a domingo)
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
  const weekDays = new Set(week.map(ymd));
  const inWeek = records.filter((r) => weekDays.has(r.day));
  const count = (k) => inWeek.filter((r) => r.kind === k).length;
  const weekR = inWeek.filter((r) => r.kind === "bt").map((r) => realizedR(r.t)).filter((v) => v != null && Number.isFinite(Number(v)));
  const sumR = weekR.reduce((s, v) => s + Number(v), 0);
  const letters = ["L", "M", "M", "J", "V", "S", "D"];
  const strip = el("div", { className: "pulse-week", "aria-label": "Registros de esta semana" }, week.map((d, i) => {
    const n = byDay.get(ymd(d)) || 0;
    const isToday = ymd(d) === ymd(today);
    const future = d > today && !isToday;
    return el("div", { className: "pulse-day" + (n ? " is-done" : "") + (isToday ? " is-today" : "") + (future ? " is-future" : ""), title: n ? `${n} registro${n === 1 ? "" : "s"}` : "Sin registros" }, [
      el("span", { className: "pulse-day-letter", text: letters[i] }),
      el("span", { className: "pulse-dot", text: n ? String(n) : "" }),
    ]);
  }));

  const latest = records.slice().sort((a, b) => String((b.t || b.o).createdAt).localeCompare(String((a.t || a.o).createdAt))).slice(0, 5);
  const latestList = latest.length
    ? el("div", { className: "pulse-latest" }, latest.map((r) => {
      const item = r.t || r.o;
      const result = r.kind === "nt" ? "NO TRADE" : (item.result || (item.isDraft ? "Borrador" : item.lifecycle === "OPEN" ? "Abierta" : "—"));
      const rv = r.t && r.t.lifecycle === "CLOSED" ? realizedR(r.t) : null;
      const tone = result === "WIN" ? "is-win" : result === "LOSS" ? "is-loss" : result === "BE" ? "is-be" : "";
      return el("button", { type: "button", className: "pulse-row", onclick: () => go(r.t ? "trade/" + item.id : "observacion/" + item.id) }, [
        el("span", { className: "pulse-kind", text: r.kind === "bt" ? "Backtest" : r.kind === "nt" ? "Estudio" : "Trade" }),
        el("strong", { text: item.asset || "—" }),
        el("span", { text: item.direction || item.bias || "" }),
        el("span", { className: "pulse-res " + tone, text: result }),
        el("span", { className: "pulse-r num", text: rv == null ? "" : (rv > 0 ? "+" : "") + Number(rv).toFixed(2) + "R" }),
      ]);
    }))
    : el("p", { className: "empty", text: "Todavía no hay registros. El primero es el más importante." });

  const message = doneToday
    ? "Hoy ya registraste. Así se construye el sistema."
    : streak
      ? `Llevás ${streak} día${streak === 1 ? "" : "s"} seguidos. Registrá algo hoy para no cortar la racha.`
      : "Un registro hoy, aunque sea un NO TRADE, ya cuenta.";

  return el("section", { className: "panel pulse" }, [
    el("div", { className: "pulse-head" }, [
      el("div", {}, [
        el("p", { className: "pulse-date", text: longDate() }),
        el("h1", { className: "pulse-hello", text: greetingLine(ctx.meta) }),
        el("p", { className: "pulse-motto", text: "Disciplina · Paciencia · Resultados" }),
      ]),
      el("div", { className: "pulse-streak" + (doneToday ? " is-lit" : "") }, [
        el("strong", { text: String(streak) }),
        el("span", { text: streak === 1 ? "día seguido" : "días seguidos" }),
      ]),
    ]),
    el("p", { className: "pulse-message", text: message }),
    el("div", { className: "pulse-actions" }, [
      quickCard("+ Trade", "Operación real o demo", "nuevo/trade", "is-gold"),
      quickCard("+ Backtest", "WIN / LOSS / BE en segundos", "backtesting?quick=bt", ""),
      quickCard("No trade", "Estudié y no había entrada", "backtesting?quick=nt", ""),
    ]),
    el("div", { className: "pulse-grid" }, [
      el("div", { className: "pulse-box" }, [
        el("h2", { text: "Esta semana" }),
        strip,
        el("div", { className: "pulse-counts" }, [
          el("div", {}, [el("strong", { text: String(count("trade")) }), el("span", { text: "trades" })]),
          el("div", {}, [el("strong", { text: String(count("bt")) }), el("span", { text: "backtests" })]),
          el("div", {}, [el("strong", { text: String(count("nt")) }), el("span", { text: "no trade" })]),
          el("div", {}, [el("strong", { className: sumR > 0 ? "is-win" : sumR < 0 ? "is-loss" : "", text: weekR.length ? (sumR > 0 ? "+" : "") + sumR.toFixed(1) + "R" : "—" }), el("span", { text: "R backtests" })]),
        ]),
      ]),
      el("div", { className: "pulse-box" }, [
        el("h2", { text: "Últimos registros" }),
        latestList,
      ]),
    ]),
  ]);
}
