import { el } from "../render.js";
import { listStageTrades } from "../../domain/trade.js";
import { asrStatusLabel, isAsrPending, listStageAsrs } from "../../domain/asr.js";
import { filterTrades, realizedR, assetFilterOptions } from "../../domain/stats.js";
import { Context, Strategy, Direction, Lifecycle, BlueVariant, strategyLabel } from "../../domain/enums.js";
import { listStageAccounts } from "../../domain/account.js";
import { SESSIONS } from "../../config.js";
import { go } from "../router.js";
import { stateBadge } from "../trade-presentation.js";

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
  const allTrades = await listStageTrades(ctx.stage.id, { includeVoid: q.lifecycle === "VOID" });
  const raw = allTrades.filter((trade) => trade.context !== Context.BACKTEST);
  const accounts = await listStageAccounts(ctx.stage.id, { includeArchived: true });
  const filters = {
    context: q.context === Context.BACKTEST ? "" : (q.context || ""),
    accountId: q.account || "",
    stageId: ctx.stage.id,
    asset: q.asset || "",
    strategy: q.strategy || "",
    variant: q.variant || "",
    direction: q.direction || "",
    session: q.session || "",
    from: q.from || "",
    to: q.to || "",
    lifecycle: q.lifecycle === "DRAFT" ? "" : (q.lifecycle || ""),
    includeVoid: q.lifecycle === "VOID",
  };
  const rows = filterTrades(q.context === Context.BACKTEST ? allTrades.filter((t) => t.context === Context.BACKTEST) : raw, filters)
    .filter(t => q.lifecycle === "DRAFT" ? t.isDraft : q.lifecycle === "OPEN" ? !t.isDraft : true);
  const asrByTrade = {};
  for (const row of await listStageAsrs(ctx.stage.id)) {
    asrByTrade[row.tradeId] = row;
  }
  const pendingCount = rows.filter((t) => isAsrPending(t, asrByTrade[t.id])).length;
  const ctxSel = select(q.context === Context.BACKTEST ? Context.BACKTEST : filters.context, [["", "todos los contextos"], [Context.BACKTEST, "BACKTEST"], [Context.DEMO, "DEMO"], [Context.LIVE, "LIVE"], [Context.PROP_CHALLENGE, "PROP"], [Context.FUNDED, "FUNDED"]]);
  const accSel = select(filters.accountId, [["", "todas las cuentas"], ...accounts.map((a) => [a.id, a.name])]);
  const asset = select(filters.asset, assetFilterOptions(q.context === Context.BACKTEST ? allTrades.filter(t => t.context === Context.BACKTEST) : raw, filters.asset, "activo"));
  asset.setAttribute("name", "asset");
  const strategy = select(filters.strategy, [["", "estrategia"], ...Object.values(Strategy).map((s) => [s, strategyLabel(s)])]);
  strategy.setAttribute("name", "strategy");
  const variant = select(filters.variant, [["", "variante"], ...Object.values(BlueVariant).map((v) => [v, v])]);
  const direction = select(filters.direction, [["", "dir"], ...Object.values(Direction).map((d) => [d, d])]);
  const session = select(filters.session, [["", "sesión"], ...SESSIONS.map((s) => [s, s])]);
  const lifecycle = select(q.lifecycle, [["", "Borradores y operaciones"], ["DRAFT", "BORRADOR"], [Lifecycle.OPEN, "OPEN · Abiertas"], [Lifecycle.CLOSED, "CLOSED · Cerradas"], [Lifecycle.VOID, "VOID · Anuladas"]]);
  const from = el("input", { className: "input slim", type: "date", value: filters.from });
  const to = el("input", { className: "input slim", type: "date", value: filters.to });
  function apply() {
    go("historial" + qs({
      context: ctxSel.value, account: accSel.value,
      asset: asset.value, strategy: strategy.value, variant: variant.value,
      direction: direction.value, session: session.value, lifecycle: lifecycle.value,
      from: from.value, to: to.value,
    }));
  }
  [ctxSel, accSel, asset, strategy, variant, direction, session, lifecycle, from, to].forEach((n) => n.addEventListener("change", apply));
  const stageEmpty = (q.context === Context.BACKTEST ? allTrades.filter((t) => t.context === Context.BACKTEST) : raw).length === 0;
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
      const tone = t.result === "WIN" ? " is-win" : t.result === "LOSS" ? " is-loss" : t.result === "BE" ? " is-be" : "";
      const open = t.lifecycle === "OPEN" ? " is-open" : "";
      const item = el("button", { type: "button", className: "row hist" + tone + open }, [
        el("span", { text: when }),
        el("strong", { text: t.asset }),
        el("span", { text: t.context === "PROP_CHALLENGE" ? "PROP" : t.context }),
        el("span", { text: `${t.direction} · ${strategyLabel(t.strategy)}` }),
        stateBadge(t),
        el("span", { text: t.result || "—" }),
        el("span", { className: "num", text: t.netPnl == null ? "—" : String(t.netPnl) }),
        el("span", { className: "num", text: r }),
        el("span", { text: asrStatusLabel(t, asrByTrade[t.id]) || "—" }),
      ]);
      item.addEventListener("click", () => go("trade/" + t.id));
      return item;
    })
    : [el("div", { className: "empty-block" }, [
      el("p", { className: "empty", text: stageEmpty
        ? "Todavía no registraste operaciones en esta etapa."
        : "No hay operaciones con este filtro." }),
      el("button", { type: "button", className: "ghost", text: "Nueva operación", onclick: () => go("nuevo/trade") }),
    ])];
  return [
    el("section", { className: "panel" }, [
      el("div", { className: "historial-header" }, [
        el("div", {}, [
          el("h1", { text: "Operaciones" }),
          el("p", { className: "meta", text: "Consultá tus trades y revisiones de la etapa activa." }),
          el("a", { href: "#/backtesting", text: "Las pruebas históricas están en Backtesting →" }),
        ]),
        el("button", { type: "button", className: "top-new-trade", text: "+ Nueva operación", onclick: () => go("nuevo/trade") }),
      ]),
      el("div", { className: "filters-basic", "aria-label": "Filtros rápidos" }, [ctxSel, accSel, asset, lifecycle]),
      (() => {
        const advanced = el("details", { className: "filters-advanced" }, [
          el("summary", { text: "Más filtros · estrategia, sesión, dirección y fechas" }),
          el("div", { className: "chips filters" }, [
            strategy, variant, direction, session, from, to,
            el("button", { type: "button", className: "ghost filters-reset", text: "Limpiar filtros", onclick: () => go("historial") }),
          ]),
        ]);
        advanced.open = Boolean(filters.strategy || filters.variant || filters.direction || filters.session || filters.from || filters.to);
        return advanced;
      })(),
      stageEmpty
        ? null
        : el("p", { className: "meta historial-count", text: `${rows.length} operaciones · ${pendingCount} ASR pendiente` }),
      el("div", { className: "list table-wrap" }, list),
    ]),
  ];
}
