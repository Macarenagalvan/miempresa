import { el } from "../render.js";
import { listStageTrades } from "../../domain/trade.js";
import { asrStatusLabel, isAsrPending, listStageAsrs } from "../../domain/asr.js";
import { filterTrades, realizedR } from "../../domain/stats.js";
import { Context, Strategy, Direction, Lifecycle, BlueVariant } from "../../domain/enums.js";
import { ROADMAP_ASSETS, SESSIONS } from "../../config.js";
import { go } from "../router.js";

function qs(query) {
  const parts = [];
  for (const [k, v] of Object.entries(query)) {
    if (v) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  }
  return parts.length ? "?" + parts.join("&") : "";
}

function select(current, options) {
  const node = el("select", { className: "input slim" }, options.map(([v, l]) => el("option", { value: v, text: l })));
  node.value = current || "";
  return node;
}

export async function renderHistorial(ctx) {
  const q = ctx.route.query || {};
  const raw = await listStageTrades(ctx.stage.id, { context: Context.BACKTEST, includeVoid: false });
  const filters = {
    context: Context.BACKTEST,
    stageId: ctx.stage.id,
    asset: q.asset || "",
    strategy: q.strategy || "",
    variant: q.variant || "",
    direction: q.direction || "",
    session: q.session || "",
    from: q.from || "",
    to: q.to || "",
    lifecycle: q.lifecycle || "",
  };
  const rows = filterTrades(raw, filters);
  const asrByTrade = {};
  for (const row of await listStageAsrs(ctx.stage.id)) {
    asrByTrade[row.tradeId] = row;
  }
  const pendingCount = rows.filter((t) => isAsrPending(t, asrByTrade[t.id])).length;
  const asset = select(filters.asset, [["", "asset"], ...ROADMAP_ASSETS.map((a) => [a.id, a.label])]);
  const strategy = select(filters.strategy, [["", "strategy"], ...Object.values(Strategy).map((s) => [s, s])]);
  const variant = select(filters.variant, [["", "variant"], ...Object.values(BlueVariant).map((v) => [v, v])]);
  const direction = select(filters.direction, [["", "dir"], ...Object.values(Direction).map((d) => [d, d])]);
  const session = select(filters.session, [["", "sesión"], ...SESSIONS.map((s) => [s, s])]);
  const lifecycle = select(filters.lifecycle, [["", "OPEN+CLOSED"], [Lifecycle.OPEN, "OPEN"], [Lifecycle.CLOSED, "CLOSED"]]);
  const from = el("input", { className: "input slim", type: "date", value: filters.from });
  const to = el("input", { className: "input slim", type: "date", value: filters.to });
  function apply() {
    go("historial" + qs({
      asset: asset.value, strategy: strategy.value, variant: variant.value,
      direction: direction.value, session: session.value, lifecycle: lifecycle.value,
      from: from.value, to: to.value,
    }));
  }
  [asset, strategy, variant, direction, session, lifecycle, from, to].forEach((n) => n.addEventListener("change", apply));
  const list = rows.length
    ? rows.map((t) => {
      const when = (t.closedAt || t.openedAt || "").slice(0, 10);
      let r = "";
      if (t.lifecycle === "CLOSED") {
        const rr = realizedR(t);
        r = rr == null ? "R n/a" : `R ${Number(rr).toFixed(2)}`;
      } else if (t.incompleteForR || t.hasPartials) {
        r = "R n/a";
      }
      const item = el("button", { type: "button", className: "row hist" }, [
        el("span", { text: when }),
        el("strong", { text: t.asset }),
        el("span", { text: `${t.direction} · ${t.strategy}` }),
        el("span", { text: t.lifecycle }),
        el("span", { text: t.result || "—" }),
        el("span", { text: t.netPnl == null ? "—" : String(t.netPnl) }),
        el("span", { text: r }),
        el("span", { text: asrStatusLabel(t, asrByTrade[t.id]) || "—" }),
      ]);
      item.addEventListener("click", () => go("trade/" + t.id));
      return item;
    })
    : [el("p", { className: "empty", text: "0 trades BACKTEST con este filtro." })];
  return [
    el("section", { className: "panel" }, [
      el("h1", { text: "Historial" }),
      el("p", { className: "meta", text: "BACKTEST · stage activa. VOID fuera." }),
      el("div", { className: "chips filters" }, [asset, strategy, variant, direction, session, lifecycle, from, to]),
      el("p", { className: "meta", text: `${rows.length} filas · ${pendingCount} ASR pendiente` }),
      el("div", { className: "list" }, list),
    ]),
  ];
}
