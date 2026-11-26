// "Importaciones recientes": cada importación (MT5, Tradovate, Vantage) se puede deshacer entera.
import { el } from "./render.js";
import { listStageTrades } from "../domain/trade.js";
import { listStageAccounts } from "../domain/account.js";
import { deleteTrades, restoreDeletedTrades } from "../domain/trade-delete.js";
import { confirmDialog, toast } from "./feedback.js";

const fmt = (v, cur) => (v > 0 ? "+" : "") + v.toFixed(2).replace(".", ",") + (cur ? " " + cur : "");

export async function importHistoryPanel(ctx) {
  const box = el("section", { className: "panel", "aria-label": "Importaciones recientes" });
  const paint = async () => {
    const [trades, accounts] = await Promise.all([listStageTrades(ctx.stage.id, { includeVoid: false }), listStageAccounts(ctx.stage.id)]);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const groups = new Map();
    for (const t of trades) {
      if (!t.importBatchId) continue;
      const g = groups.get(t.importBatchId) || { id: t.importBatchId, trades: [], at: 0 };
      g.trades.push(t);
      g.at = Math.max(g.at, new Date(t.createdAt || 0).getTime());
      groups.set(t.importBatchId, g);
    }
    const list = [...groups.values()].sort((a, b) => b.at - a.at).slice(0, 8);
    box.replaceChildren(el("h2", { text: "Importaciones recientes" }),
      el("p", { className: "meta", text: "Si te equivocaste de archivo o de cuenta, borrá la importación entera. Podés deshacerlo." }));
    if (!list.length) { box.append(el("p", { className: "meta", text: "Todavía no importaste nada." })); return; }
    for (const g of list) {
      const acc = byId.get(g.trades[0].accountId);
      const net = g.trades.reduce((s, t) => s + (Number(t.netPnl) || 0), 0);
      const when = new Date(g.at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
      const del = el("button", { type: "button", className: "ghost btn-delete", text: "Borrar importación" });
      del.addEventListener("click", async () => {
        const ok = await confirmDialog({ title: "¿Borrar esta importación?", body: [`${g.trades.length} operaciones · ${acc ? acc.name : "cuenta"} · neto ${fmt(net, acc?.currency)}`, "Se borran solo las operaciones de esta importación."], confirmText: "Sí, borrar", danger: true });
        if (!ok) return;
        const { snapshot } = await deleteTrades(g.trades.map((t) => t.id));
        await paint();
        toast(`Importación borrada (${g.trades.length} operaciones).`, { actionText: "Deshacer", onAction: async () => { await restoreDeletedTrades(snapshot); await paint(); }, timeout: 10000 });
      });
      box.append(el("div", { className: "import-batch" }, [
        el("span", { text: `${when} · ${acc ? acc.name : "—"} · ${g.trades.length} operaciones · neto ${fmt(net, acc?.currency)}` }),
        del,
      ]));
    }
  };
  await paint();
  return box;
}
