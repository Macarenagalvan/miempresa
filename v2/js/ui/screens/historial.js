import { uiLabel } from '../labels.js';
import { money, label, link } from "../journal-insights.js";
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
  const ctxSel = select(q.context === Context.BACKTEST ? Context.BACKTEST : filters.context, [["", "Todos los tipos"], [Context.BACKTEST, "BACKTEST"], [Context.DEMO, "DEMO"], [Context.LIVE, "Cuenta propia"], [Context.PROP_CHALLENGE, "Evaluación"], [Context.FUNDED, "Fondeada"]]);
  const accSel = select(filters.accountId, [["", "todas las cuentas"], ...accounts.map((a) => [a.id, a.name])]);
  const asset = select(filters.asset, assetFilterOptions(q.context === Context.BACKTEST ? allTrades.filter(t => t.context === Context.BACKTEST) : raw, filters.asset, "activo"));
  asset.setAttribute("name", "asset");
  const strategy = select(filters.strategy, [["", "estrategia"], ...Object.values(Strategy).map((s) => [s, uiLabel(strategyLabel(s))])]);
  strategy.setAttribute("name", "strategy");
  const variant = select(filters.variant, [["", "variante"], ...Object.values(BlueVariant).map((v) => [v, v])]);
  const direction = select(filters.direction, [["", "Dirección"], ...Object.values(Direction).map((d) => [d, uiLabel(d)])]);
  const session = select(filters.session, [["", "sesión"], ...SESSIONS.map((s) => [s, s])]);
  const lifecycle = select(q.lifecycle, [["", "Borradores y operaciones"], ["DRAFT", "BORRADOR"], [Lifecycle.OPEN, "Abiertas"], [Lifecycle.CLOSED, "Cerradas"], [Lifecycle.VOID, "Anuladas"]]);
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
        r = rr == null ? "R —" : `R ${Number(rr).toFixed(2)}`;
      } else if (t.incompleteForR || t.hasPartials) {
        r = "R —";
      }
      const tone = t.result === "WIN" ? " is-win" : t.result === "LOSS" ? " is-loss" : t.result === "BE" ? " is-be" : "";
      const open = t.lifecycle === "OPEN" ? " is-open" : "";
      const item = el("button", { type: "button", className: "row hist journal-history-row" + tone + open }, [
        el("span", { text: when }),
        el("strong", { text: t.asset }),
        el("span", { text: label(t.context) }),
        el("span", { text: `${label(t.direction)} · ${label(strategyLabel(t.strategy))}` }),
        stateBadge(t),
        el("span", { text: t.result ? label(t.result) : "—" }),
        el("span", { className: "num", text: t.netPnl == null ? "—" : money(t.netPnl, accounts.find(a=>a.id===t.accountId)?.currency || "") }),
        el("span", { className: "num", text: r }),
        el("span", { text: isAsrPending(t, asrByTrade[t.id]) ? "Revisión pendiente" : asrByTrade[t.id] ? "Revisada" : "—" }),
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
          el("p", { className: "meta", text: "Tus operaciones, resultados y capturas. Abrí una fila para ver o completar su análisis." }),
          el("a", { href: "#/backtesting", text: "Las pruebas históricas están en Backtesting →" }),
        ]),
        el("button", { type: "button", className: "top-new-trade", text: "+ Nueva operación", onclick: () => go("nuevo/trade") }),
      ]),
      el("div", {className:"journal-actions"}, [link("Importar HTML de MT5", "importar"),link("Ver estadísticas", "numeros"+(filters.accountId?"?account="+filters.accountId:""))]),
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
        : el("p", { className: "meta historial-count", text: `${rows.length} operaciones · ${pendingCount} revisiones pendientes` }),
      el("div", {className:"journal-hist-head", "aria-hidden":"true"}, ["Fecha","Activo","Tipo","Dirección / estrategia","Estado","Resultado","Neto","R","Revisión"].map(text=>el("span",{text}))),
      el("div", { className: "list table-wrap" }, list),
    ]),
  ];
}
