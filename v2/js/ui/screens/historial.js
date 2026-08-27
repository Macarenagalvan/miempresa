import { el } from "../render.js";
import { listStageTrades } from "../../domain/trade.js";
import { Context } from "../../domain/enums.js";
import { go } from "../router.js";

export async function renderHistorial(ctx) {
  const rows = await listStageTrades(ctx.stage.id, { context: Context.BACKTEST });
  const list = rows.length
    ? rows.map((t) => {
      const when = (t.closedAt || t.openedAt || "").slice(0, 10);
      const r = t.lifecycle === "CLOSED"
        ? (t.rrRealized == null ? "R n/a" : `R ${Number(t.rrRealized).toFixed(2)}`)
        : (t.incompleteForR ? "R n/a" : "");
      const item = el("button", { type: "button", className: "row hist" }, [
        el("span", { text: when }),
        el("strong", { text: t.asset }),
        el("span", { text: `${t.direction} · ${t.strategy}` }),
        el("span", { text: t.lifecycle }),
        el("span", { text: t.result || "—" }),
        el("span", { text: t.netPnl == null ? "—" : String(t.netPnl) }),
        el("span", { text: r }),
      ]);
      item.addEventListener("click", () => go("trade/" + t.id));
      return item;
    })
    : [el("p", { className: "empty", text: "0 trades BACKTEST." })];

  return [
    el("section", { className: "panel" }, [
      el("h1", { text: "Historial" }),
      el("p", { className: "meta", text: "BACKTEST · stage activa. VOID fuera de esta lista." }),
      el("div", { className: "list" }, list),
    ]),
  ];
}
