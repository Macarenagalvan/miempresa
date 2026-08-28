import { el } from "../render.js";
import { listStageTrades } from "../../domain/trade.js";
import { getActiveAccount, balanceFor } from "../../domain/account.js";
import { REAL_CONTEXTS } from "../../domain/integrity.js";
import { Lifecycle } from "../../domain/enums.js";
import { go } from "../router.js";

function contextLabel(ctx) {
  return ctx === "PROP_CHALLENGE" ? "PROP" : ctx;
}

export async function renderHoy(ctx) {
  const stageName = ctx.stage ? ctx.stage.name : "—";
  const trades = await listStageTrades(ctx.stage.id, { includeVoid: false });
  const real = trades.filter((t) => REAL_CONTEXTS.includes(t.context));
  const open = real.filter((t) => t.lifecycle === Lifecycle.OPEN);
  const closed = real.filter((t) => t.lifecycle === Lifecycle.CLOSED).slice(0, 5);
  const active = await getActiveAccount();
  let balLine = "no hay cuenta activa";
  if (active) {
    const bal = await balanceFor(active.id);
    balLine = `${active.name} · ${contextLabel(active.context)} · ${bal} ${active.currency}`;
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
    : [el("p", { className: "empty", text: "No hay operaciones Real en esta etapa." })];

  const closedList = closed.map((t) => {
    const tone = t.result === "WIN" ? " is-win" : t.result === "LOSS" ? " is-loss" : t.result === "BE" ? " is-be" : "";
    const row = el("button", { type: "button", className: "row hist" + tone }, [
      el("span", { text: (t.closedAt || "").slice(0, 10) }),
      el("strong", { text: t.asset }),
      el("span", { text: contextLabel(t.context) }),
      el("span", { text: t.result || "—" }),
      el("span", { className: "num", text: t.netPnl == null ? "—" : String(t.netPnl) }),
    ]);
    row.addEventListener("click", () => go("trade/" + t.id));
    return row;
  });

  return [
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: "Universo Real · stage activa" }),
      el("h1", { text: "Hoy" }),
      el("p", { className: "meta", text: `Stage: ${stageName}` }),
      el("p", { className: "meta num", text: balLine }),
      el("p", { className: "hint", text: "Real = LIVE / PROP / FUNDED. Demo y Backtest no completan este tablero." }),
      el("h2", { text: "Abiertas" }),
      el("div", { className: "list table-wrap" }, openList),
      closed.length
        ? el("h2", { text: "Últimos cierres Real" })
        : null,
      closed.length ? el("div", { className: "list table-wrap" }, closedList) : null,
      el("div", { className: "row-actions" }, [
        el("button", { type: "button", text: "Nuevo", onclick: () => go("nuevo") }),
      ]),
    ]),
  ];
}
