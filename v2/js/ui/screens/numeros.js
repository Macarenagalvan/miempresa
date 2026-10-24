import { uiLabel } from '../labels.js';
import { listStageAccounts, getActiveAccount } from "../../domain/account.js";
import { field } from "../forms/observation.js";
import { resultCharts, label } from "../journal-insights.js";
import { el } from "../render.js";
import { listTrades } from "../../storage/repos/trades.js";
import { listSignals } from "../../storage/repos/signals.js";
import { compute, computeDesk, assetFilterOptions } from "../../domain/stats.js";
import { Context, Strategy, Direction, BlueVariant, Disposition, Resolution, strategyLabel } from "../../domain/enums.js";
import { SESSIONS } from "../../config.js";
import { isTestRecord } from "../../domain/test-record.js";
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

function fmt(value, kind) {
  if (value == null) return "—";
  if (value === Number.POSITIVE_INFINITY) return "∞";
  if (kind === "pct") return (value * 100).toFixed(1) + "%";
  if (kind === "r") return Number(value).toFixed(2);
  if (Number.isInteger(value)) return String(value);
  return Number(value).toFixed(2);
}

function metric(label, value, kind, note) {
  return el("div", { className: "metric" }, [
    el("span", { className: "kicker", text: label }),
    el("strong", { className: "num", text: fmt(value, kind) }),
    note ? el("span", { className: "meta", text: note }) : null,
  ]);
}

export async function renderNumeros(ctx) {
  const q = ctx.route.query || {};
  const accounts = await listStageAccounts(ctx.stage.id, {includeArchived:true});
  const active = await getActiveAccount();
  const defaultAccount = active || accounts[0];
  const selectedId = q.account === "all" ? "" : (q.account || (!q.universe ? defaultAccount?.id : "") || "");
  const universe = q.universe || ((accounts.find(a=>a.id===selectedId)||defaultAccount)?.context === "DEMO" ? "DEMO" : "REAL");
  const excludeTest = q.excludeTest === "1";
  const filters = {
    universe,
    context: q.context || "",
    accountId: selectedId,
    stageId: ctx.stage.id,
    asset: q.asset || "",
    strategy: q.strategy || "",
    variant: q.variant || "",
    direction: q.direction || "",
    session: q.session || "",
    from: q.from || "",
    to: q.to || "",
  };
  const uni = select(universe, [["REAL", "Operado · propias y fondeo"], ["DEMO", "Demo"], ["BACKTEST", "Backtest"]]);
  const rawTrades = await listTrades();
  const allTrades = excludeTest ? rawTrades.filter((trade) => !isTestRecord(trade)) : rawTrades;
  const excludedCount = excludeTest ? rawTrades.length - allTrades.length : 0;
  const allSignals = universe === "DESK" ? await listSignals() : [];
  const asset = select(filters.asset, assetFilterOptions(universe === "DESK" ? allSignals : allTrades, filters.asset, "Todos los activos"));
  asset.setAttribute("name", "asset");
  const direction = select(filters.direction, [["", "Todas"], ...Object.values(Direction).map((d) => [d, label(d)])]);
  const from = el("input", { className: "input slim", type: "date", value: filters.from });
  const to = el("input", { className: "input slim", type: "date", value: filters.to });
  if (universe === "DESK") {
    const deskFilters = {
      stageId: ctx.stage.id,
      asset: filters.asset,
      direction: filters.direction,
      disposition: q.disposition || "",
      resolution: q.resolution || "",
      from: filters.from,
      to: filters.to,
    };
    const desk = computeDesk(allSignals, deskFilters);
    const disp = select(deskFilters.disposition, [["", "disposition"], ...Object.values(Disposition).map((d) => [d, uiLabel(d)])]);
    const reso = select(deskFilters.resolution, [["", "resolution"], ...Object.values(Resolution).map((d) => [d, uiLabel(d)])]);
    function applyDesk() {
      go("numeros" + qs({
        universe: uni.value, asset: asset.value, direction: direction.value,
        disposition: disp.value, resolution: reso.value, from: from.value, to: to.value,
      }));
    }
    [uni, asset, direction, disp, reso, from, to].forEach((n) => n.addEventListener("change", applyDesk));
    return [
      el("section", { className: "panel" }, [
        el("p", { className: "kicker", text: "Universo Desk · stage activa" }),
        el("h1", { text: "Estadísticas" }),
        el("p", { className: "meta", text: "Métricas teóricas del aviso. No es WR/PnL de Trades." }),
        el("div", { className: "chips filters" }, [uni, asset, direction, disp, reso, from, to]),
        el("div", { className: "metrics" }, [
          metric("Printed", desk.printed),
          metric("OPEN", desk.nOpen),
          metric("TP", desk.nTp),
          metric("SL", desk.nSl),
          metric("MISSED", desk.nMissed),
          metric("TAKEN", desk.nTaken),
          metric("IGNORED", desk.nIgnored),
          metric("SKIPPED_OPEN_POSITION", desk.nSkipped),
          metric("STALE", desk.nStale),
          metric("NONE", desk.nNone),
          metric("Resolution Rate", desk.resolutionRate, "pct", `resueltas ${desk.nResolved}/${desk.printed}`),
          metric("Hit Rate teórico Desk", desk.hitRate, "pct", `TP/(TP+SL) n=${desk.nTp + desk.nSl}`),
          metric("Take Rate Maca", desk.takeRate, "pct", `T/(T+I) n=${desk.nTaken + desk.nIgnored}`),
          metric("Skip rate", desk.skipRate, "pct", `SKIPPED / printed`),
        ]),
        el("p", { className: "hint", text: "Take Rate excluye NONE, STALE y SKIPPED. Hit Rate excluye MISSED y OPEN." }),
      ]),
    ];
  }
  const compatible = accounts.filter(a => universe === "DEMO" ? a.context === "DEMO" : universe === "REAL" ? a.context !== "DEMO" : false);
  if (filters.accountId && !compatible.some(a=>a.id===filters.accountId)) filters.accountId = "";
  const accountSel=select(filters.accountId || "all", [["all","Todas las cuentas"], ...compatible.map(a=>[a.id,a.name])]);
  accountSel.setAttribute("aria-label", "Cuenta de estadísticas");
  const currencies=[...new Set(compatible.filter(a=>!filters.accountId||a.id===filters.accountId).map(a=>a.currency))];
  const mixed=currencies.length>1 && universe!=="BACKTEST";
  const currency=universe==="BACKTEST"?"simulado":currencies[0]||"";
  const stats = compute(allTrades, filters);
  if(mixed)for(const k of ['netPnl','profitFactorUsd','expectancyUsd','maxDrawdown'])stats[k]=null;
  const ctxSel = select(filters.context, [["", "Todos los tipos"], [Context.LIVE, "Cuenta propia"], [Context.PROP_CHALLENGE, "Evaluación"], [Context.FUNDED, "Fondeada"], [Context.DEMO, "DEMO"], [Context.BACKTEST, "BACKTEST"]]);
  const strategy = select(filters.strategy, [["", "Todas"], ...Object.values(Strategy).map((s) => [s, label(strategyLabel(s))])]);
  strategy.setAttribute("name", "strategy");
  const variant = select(filters.variant, [["", "Todas"], ...Object.values(BlueVariant).map((v) => [v, v])]);
  const session = select(filters.session, [["", "sesión"], ...SESSIONS.map((s) => [s, s])]);
  function apply() {
    go("numeros" + qs({
      universe: uni.value, context: uni.value === universe ? ctxSel.value : "", account: uni.value === universe ? accountSel.value : "all",
      excludeTest: uni.value === "BACKTEST" && excludeTest ? "1" : "",
      asset: asset.value, strategy: strategy.value, variant: variant.value,
      direction: direction.value, session: session.value, from: from.value, to: to.value,
    }));
  }
  [uni, accountSel, ctxSel, asset, strategy, variant, direction, session, from, to].forEach((n) => n.addEventListener("change", apply));
  return [
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: universe === "BACKTEST" ? "Pruebas históricas" : "Tus operaciones ejecutadas" }),
      el("h1", { text: "Estadísticas" }),
      el("p", { className: "meta", text: excludeTest
        ? `Backtesting: ${excludedCount} registros TEST / FICTICIO excluidos de estas estadísticas.`
        : mixed ? "Elegí una cuenta para ver importes: hay monedas distintas y no se suman entre sí." : "Resultados de operaciones cerradas. Los borradores y las operaciones anuladas no cuentan." }),
      el("div", { className: "journal-stat-filters" }, [field("Resultados",uni),field("Cuenta",accountSel),field("Tipo de cuenta",ctxSel),field("Activo",asset),field("Estrategia",strategy),field("Variante",variant),field("Dirección",direction),field("Sesión",session),field("Desde",from),field("Hasta",to)]),
      el("button", {type:"button",className:"ghost",text:"Limpiar filtros",onclick:()=>go("numeros")}),
      el("div", { className: "metrics" }, [
        metric("Operaciones cerradas", stats.nClosed),
        metric("Ganadas", stats.nWins),
        metric("Perdidas", stats.nLosses),
        metric("En equilibrio", stats.nBe),
        metric("Porcentaje de acierto", stats.winRate, "pct", `${stats.nDecided} ganadas o perdidas`),
        metric("Resultado neto", stats.netPnl, "n", `${stats.nMoney} operaciones · ${currency}`),
        metric("Factor de beneficio", stats.profitFactorUsd, "n", `${stats.nMoney} operaciones · ${currency}`),
        metric("Promedio por operación", stats.expectancyUsd, "n", `${stats.nMoney} operaciones · ${currency}`),
        metric("Promedio en R", stats.expectancyR, "r", `${stats.nR} con riesgo conocido`),
        metric("Caída máxima al cierre", stats.maxDrawdown),
        metric("Máx. ganadas seguidas", stats.maxConsecWins),
        metric("Máx. perdidas seguidas", stats.maxConsecLosses),
      ]),
      !mixed ? resultCharts(allTrades, filters, currency) : null,
      el("p", { className: "hint", text: "R mide el resultado respecto del riesgo inicial. Si falta ese dato, se muestra —; no impide calcular el saldo ni el resultado neto." }),
    ]),
  ];
}
