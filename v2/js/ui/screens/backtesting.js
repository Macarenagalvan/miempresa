import { el } from "../render.js";
import { listStageTrades } from "../../domain/trade.js";
import { compute, realizedR } from "../../domain/stats.js";
import { Context, Lifecycle } from "../../domain/enums.js";
import { isTestRecord } from "../../domain/test-record.js";
import { go } from "../router.js";
import { stateBadge } from "../trade-presentation.js";

function fmtR(value) {
  return value == null || !Number.isFinite(Number(value))
    ? "R —" : "R " + Number(value).toFixed(2);
}

function summary(label, value, note) {
  return el("div", { className: "bt-stat" }, [
    el("span", { className: "bt-stat-label", text: label }),
    el("strong", { text: String(value) }),
    el("span", { className: "bt-stat-note", text: note }),
  ]);
}

function tradeRow(trade) {
  const day = String(trade.closedAt || trade.openedAt || "").slice(0, 10) || "Sin fecha";
  const status = trade.isDraft === true ? "Borrador" : (trade.lifecycle === Lifecycle.CLOSED ? (trade.result || "Cerrado") : "En curso");
  const value = trade.lifecycle === Lifecycle.CLOSED ? fmtR(realizedR(trade)) : "Pendiente";
  return el("button", {
    type: "button",
    className: "bt-row",
    onclick: () => go("trade/" + trade.id + "?from=backtesting"),
    "aria-label": `Abrir backtest ${trade.asset} ${trade.direction}, ${day}`,
  }, [
    el("span", { className: "bt-row-date", text: day }),
    el("strong", { text: trade.asset }),
    el("span", { text: trade.direction }),
    stateBadge(trade),
    el("span", { className: "bt-row-r", text: value }),
  ]);
}

export async function renderBacktesting(ctx) {
  const trades = (await listStageTrades(ctx.stage.id, { includeVoid: false }))
    .filter((trade) => trade.context === Context.BACKTEST)
    .sort((a, b) => String(b.closedAt || b.openedAt || "").localeCompare(String(a.closedAt || a.openedAt || "")));
  const test = trades.filter(isTestRecord);
  const genuine = trades.filter((trade) => !isTestRecord(trade));
  const stats = compute(genuine, { universe: "BACKTEST", stageId: ctx.stage.id });
  const action = () => go("nuevo/trade?context=BACKTEST");
  const qa = test.length ? el("details", { className: "bt-test-fold" }, [
    el("summary", { text: `Datos de prueba (${test.length}) · excluidos del resumen` }),
    el("div", { className: "bt-list" }, test.map(tradeRow)),
  ]) : null;

  return [
    el("section", { className: "panel bt-hero" }, [
      el("p", { className: "kicker", text: "Práctica y análisis histórico" }),
      el("h1", { text: "Backtesting" }),
      el("p", { className: "hint", text: "Registrá pruebas históricas sin mezclarlas con operaciones ejecutadas ni afectar el saldo de ninguna cuenta." }),
      el("div", { className: "row-actions" }, [
        el("button", { type: "button", text: "+ Registrar backtest", onclick: action }),
        el("button", { type: "button", className: "ghost", text: "Ver estadísticas", onclick: () => go("numeros?universe=BACKTEST&excludeTest=1") }),
      ]),
      el("div", { className: "bt-summary" }, [
        summary("Registros", genuine.length, "Pruebas históricas"),
        summary("Cerrados", stats.nClosed, "Con resultado registrado"),
        summary("Expectativa", fmtR(stats.expectancyR), `Calculada con ${stats.nR} R válidos`),
      ]),
    ]),
    el("section", { className: "panel bt-register" }, [
      el("div", { className: "bt-section-heading" }, [
        el("div", {}, [
          el("h2", { text: "Historial de backtests" }),
          el("p", { className: "hint", text: "Abrí un registro para editarlo, revisar la operación y adjuntar capturas del gráfico." }),
        ]),
        el("button", { type: "button", className: "ghost", text: "Nuevo backtest", onclick: action }),
      ]),
      genuine.length
        ? el("div", { className: "bt-list" }, genuine.map(tradeRow))
        : el("div", { className: "empty-block" }, [
          el("p", { className: "empty", text: "Todavía no tenés backtests registrados." }),
          el("p", { className: "hint", text: "Empezá con el activo y la dirección. Podés guardar un borrador y completar fechas, precios y resultado después." }),
          el("button", { type: "button", text: "Registrar primer backtest", onclick: action }),
        ]),
      qa,
      el("p", { className: "hint", text: "Nota: esto es registro manual. La importación masiva de archivos de backtesting todavía no está implementada." }),
    ]),
  ];
}
