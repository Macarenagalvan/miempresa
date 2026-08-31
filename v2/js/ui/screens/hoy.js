import { el } from "../render.js";
import { listStageTrades } from "../../domain/trade.js";
import { getActiveAccount, balanceFor } from "../../domain/account.js";
import { listStageSignals } from "../../domain/signal.js";
import { REAL_CONTEXTS } from "../../domain/integrity.js";
import { Lifecycle } from "../../domain/enums.js";
import { go } from "../router.js";
import { greetingLine, longDate, icon, ICONS } from "../identity.js";

function contextLabel(ctx) {
  return ctx === "PROP_CHALLENGE" ? "PROP" : ctx;
}

function choice(title, line, path, pathIcon) {
  return el("button", { type: "button", className: "choice", onclick: () => go(path) }, [
    icon(pathIcon),
    el("strong", { text: title }),
    el("span", { text: line }),
  ]);
}

export async function renderHoy(ctx) {
  const stageName = ctx.stage ? ctx.stage.name : "-";
  const trades = await listStageTrades(ctx.stage.id, { includeVoid: false });
  const real = trades.filter((t) => REAL_CONTEXTS.includes(t.context));
  const open = real.filter((t) => t.lifecycle === Lifecycle.OPEN);
  const closed = real.filter((t) => t.lifecycle === Lifecycle.CLOSED).slice(0, 5);
  const active = await getActiveAccount();
  const signals = (await listStageSignals(ctx.stage.id)).slice(0, 3);

  let accountBlock;
  if (active) {
    const bal = await balanceFor(active.id);
    accountBlock = el("p", { className: "meta num", text: active.name + " · " + contextLabel(active.context) + " · " + bal + " " + active.currency });
  } else {
    accountBlock = el("div", { className: "empty-block" }, [
      el("p", { className: "empty", text: "Todavía no hay una cuenta activa." }),
      el("button", { type: "button", className: "ghost", text: "Abrir Cuentas", onclick: () => go("cuentas") }),
    ]);
  }

  const openList = open.length
    ? open.map((t) => {
      const row = el("button", { type: "button", className: "row hist is-open" }, [
        el("strong", { text: t.asset }),
        el("span", { text: contextLabel(t.context) }),
        el("span", { text: t.direction }),
        el("span", { className: "num", text: String(t.entry) }),
      ]);
      row.addEventListener("click", () => go("trade/" + t.id));
      return row;
    })
    : [
      el("div", { className: "empty-block" }, [
        el("p", { className: "empty", text: "Hoy no hay operaciones Real." }),
        el("p", { className: "hint", text: "El día igual se registra acá." }),
      ]),
    ];

  const closedList = closed.map((t) => {
    const tone = t.result === "WIN" ? " is-win" : t.result === "LOSS" ? " is-loss" : t.result === "BE" ? " is-be" : "";
    const row = el("button", { type: "button", className: "row hist" + tone }, [
      el("span", { text: (t.closedAt || "").slice(0, 10) }),
      el("strong", { text: t.asset }),
      el("span", { text: contextLabel(t.context) }),
      el("span", { text: t.result || "-" }),
      el("span", { className: "num", text: t.netPnl == null ? "-" : String(t.netPnl) }),
    ]);
    row.addEventListener("click", () => go("trade/" + t.id));
    return row;
  });

  const signalList = signals.map((s) => {
    const row = el("button", { type: "button", className: "row hist" }, [
      el("span", { text: String(s.printedAt || "").slice(0, 10) }),
      el("strong", { text: s.asset }),
      el("span", { text: s.direction }),
      el("span", { text: s.disposition || "-" }),
    ]);
    row.addEventListener("click", () => go("senal/" + s.id));
    return row;
  });

  const facts = [
    el("h2", { text: "Abiertas" }),
    el("div", { className: "list table-wrap" }, openList),
    closed.length ? el("h2", { text: "Últimos cierres Real" }) : null,
    closed.length ? el("div", { className: "list table-wrap" }, closedList) : null,
    signals.length ? el("h2", { text: "Últimas señales" }) : null,
    signals.length ? el("div", { className: "list table-wrap" }, signalList) : null,
  ];

  return [
    el("section", { className: "panel identity-band" }, [
      el("p", { className: "kicker", text: "Trading Journal" }),
      el("h1", { text: greetingLine(ctx.meta) }),
      el("p", { className: "meta", text: longDate() + " · Etapa " + stageName }),
      accountBlock,
    ]),
    el("div", { className: "hoy-board" }, [
      el("section", { className: "panel" }, facts),
      el("section", { className: "panel" }, [
        el("h2", { text: "Registrar" }),
        el("p", { className: "hint", text: "Nota, idea u operación. No hace falta un orden." }),
        el("div", { className: "choice-grid stack" }, [
          choice("Nota", "Algo que vi o aprendí.", "nuevo/observacion", ICONS.note),
          choice("Idea", "Una oportunidad que estoy siguiendo.", "nuevo/setup", ICONS.idea),
          choice("Operación", "Un trade que ejecuté o quiero registrar.", "nuevo/trade", ICONS.trade),
        ]),
      ]),
    ]),
  ];
}
