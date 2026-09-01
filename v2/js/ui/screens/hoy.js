import { el } from "../render.js";
import { listStageTrades } from "../../domain/trade.js";
import { getActiveAccount, balanceFor } from "../../domain/account.js";
import { listStageSignals } from "../../domain/signal.js";
import { listActiveSetups } from "../../domain/setup.js";
import { REAL_CONTEXTS } from "../../domain/integrity.js";
import { Lifecycle, SetupStatus } from "../../domain/enums.js";
import { go } from "../router.js";
import { greetingLine, longDate, icon, ICONS } from "../identity.js";

const FOLLOW_STATUSES = [SetupStatus.WATCHING, SetupStatus.WAITING_CONFIRMATION];

function contextLabel(ctx) {
  return ctx === "PROP_CHALLENGE" ? "PROP" : ctx;
}

function localYmd(value = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

function isLocalDay(value, day = localYmd()) {
  if (!value) return false;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value === day;
  return localYmd(value) === day;
}

function choice(title, line, path, pathIcon) {
  return el("button", { type: "button", className: "choice", onclick: () => go(path) }, [
    icon(pathIcon),
    el("strong", { text: title }),
    el("span", { text: line }),
  ]);
}

function histRow(cells, path, extraClass = "") {
  const row = el("button", { type: "button", className: "row hist" + extraClass }, cells);
  row.addEventListener("click", () => go(path));
  return row;
}

function officeCard(title, pathIcon, body) {
  return el("section", { className: "panel office-card" }, [
    el("h2", { className: "office-card-title" }, [
      icon(pathIcon),
      el("span", { text: title }),
    ]),
    body,
  ]);
}

function monthGrid(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const lastDate = new Date(year, month + 1, 0).getDate();
  const today = now.getDate();
  const rawTitle = now.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  const title = rawTitle ? rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1) : rawTitle;
  const heads = ["L", "M", "M", "J", "V", "S", "D"].map((d) => el("span", { className: "cal-dow", text: d }));
  const cells = [];
  for (let i = 0; i < firstDow; i += 1) {
    cells.push(el("span", { className: "cal-day is-pad", text: "" }));
  }
  for (let day = 1; day <= lastDate; day += 1) {
    cells.push(el("span", {
      className: "cal-day" + (day === today ? " is-today" : ""),
      text: String(day),
    }));
  }
  return el("div", { className: "cal-wrap" }, [
    el("p", { className: "cal-title", text: title }),
    el("div", { className: "cal-grid" }, heads.concat(cells)),
  ]);
}

export async function renderHoy(ctx) {
  const stageName = ctx.stage ? ctx.stage.name : "-";
  const today = localYmd();
  const trades = await listStageTrades(ctx.stage.id, { includeVoid: false });
  const real = trades.filter((t) => REAL_CONTEXTS.includes(t.context));
  const open = real.filter((t) => t.lifecycle === Lifecycle.OPEN);
  const closedToday = real.filter((t) => t.lifecycle === Lifecycle.CLOSED && isLocalDay(t.closedAt, today));
  const active = await getActiveAccount();
  const ideas = (await listActiveSetups(ctx.stage.id))
    .filter((s) => FOLLOW_STATUSES.includes(s.status));
  const signalsToday = (await listStageSignals(ctx.stage.id))
    .filter((s) => isLocalDay(s.printedAt, today));

  let accountBlock = null;
  if (active) {
    const bal = await balanceFor(active.id);
    accountBlock = el("p", {
      className: "meta num",
      text: active.name + " · " + contextLabel(active.context) + " · " + bal + " " + active.currency,
    });
  }

  const openList = open.length
    ? open.map((t) => histRow([
      el("strong", { text: t.asset }),
      el("span", { text: contextLabel(t.context) }),
      el("span", { text: t.direction }),
      el("span", { className: "num", text: String(t.entry) }),
    ], "trade/" + t.id, " is-open"))
    : [
      el("div", { className: "empty-block" }, [
        el("p", { className: "empty", text: "No hay operaciones Real abiertas." }),
        el("p", { className: "hint", text: "El escritorio sigue acá." }),
      ]),
    ];

  const closedList = closedToday.map((t) => {
    const tone = t.result === "WIN" ? " is-win" : t.result === "LOSS" ? " is-loss" : t.result === "BE" ? " is-be" : "";
    return histRow([
      el("strong", { text: t.asset }),
      el("span", { text: contextLabel(t.context) }),
      el("span", { text: t.result || "-" }),
      el("span", { className: "num", text: t.netPnl == null ? "-" : String(t.netPnl) }),
    ], "trade/" + t.id, tone);
  });

  const ideaList = ideas.map((s) => histRow([
    el("strong", { text: s.asset }),
    el("span", { text: s.direction }),
    el("span", { text: s.status === SetupStatus.WAITING_CONFIRMATION ? "esperando" : "siguiendo" }),
  ], "setup/" + s.id));

  const signalList = signalsToday.map((s) => histRow([
    el("strong", { text: s.asset }),
    el("span", { text: s.direction }),
    el("span", { text: s.disposition || "-" }),
  ], "senal/" + s.id));

  const tradingBlocks = [
    el("h2", { text: "Abiertas" }),
    el("div", { className: "list table-wrap" }, openList),
    closedToday.length ? el("h2", { text: "Cierres de hoy" }) : null,
    closedToday.length ? el("div", { className: "list table-wrap" }, closedList) : null,
    ideas.length ? el("h2", { text: "Ideas en seguimiento" }) : null,
    ideas.length ? el("div", { className: "list table-wrap" }, ideaList) : null,
    signalsToday.length ? el("h2", { text: "Señales de hoy" }) : null,
    signalsToday.length ? el("div", { className: "list table-wrap" }, signalList) : null,
  ];

  return [
    el("div", { className: "hoy-desk" }, [
      el("section", { className: "panel identity-band hoy-ident" }, [
        el("p", { className: "kicker", text: "Trading Office" }),
        el("h1", { text: greetingLine(ctx.meta) }),
        el("p", { className: "meta", text: longDate() + " · Etapa " + stageName }),
        accountBlock,
      ]),
      el("section", { className: "panel hoy-actions" }, [
        el("h2", { className: "hoy-col-title", text: "Registrar" }),
        el("div", { className: "choice-grid hoy-capture" }, [
          choice("Nota", "Algo que vi o aprendí.", "nuevo/observacion", ICONS.note),
          choice("Idea", "Una oportunidad que estoy siguiendo.", "nuevo/setup", ICONS.idea),
          choice("Operación", "Un trade que ejecuté o quiero registrar.", "nuevo/trade", ICONS.trade),
        ]),
      ]),
      el("section", { className: "panel hoy-trading" }, [
        el("h2", { className: "hoy-col-title", text: "Trading Hoy" }),
        ...tradingBlocks,
      ]),
      el("div", { className: "hoy-day" }, [
        el("h2", { className: "hoy-col-title day-label", text: "Mi Día" }),
        officeCard("Tareas", ICONS.task, emptyShell("No tenés tareas pendientes.")),
        officeCard("No olvidar", ICONS.pin, emptyShell("Nada anotado por ahora.")),
        officeCard("Calendario", ICONS.cal, monthGrid()),
        officeCard("Accesos rápidos", ICONS.link, emptyShell("Todavía no configuraste accesos rápidos.")),
      ]),
    ]),
  ];
}

function emptyShell(copy) {
  return el("p", { className: "empty office-empty", text: copy });
}
