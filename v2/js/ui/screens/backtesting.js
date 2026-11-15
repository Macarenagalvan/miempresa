import { backtestImporter } from "../backtest-import.js";
import { el } from "../render.js";
import { listStageTrades } from "../../domain/trade.js";
import { compute, realizedR } from "../../domain/stats.js";
import { Context, Lifecycle } from "../../domain/enums.js";
import { isTestRecord } from "../../domain/test-record.js";
import { go } from "../router.js";
import { stateBadge } from "../trade-presentation.js";
import { quickBacktest } from "./backtest-quick.js";
import { listActiveObservations } from "../../domain/observation.js";
import { computeStudies } from "../../domain/stats.js";

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
  const day = String(trade.sourceRef?.sessionDate || trade.closedAt || trade.openedAt || "").slice(0, 10) || "Sin fecha";
  const status = trade.isDraft === true ? "Borrador" : (trade.lifecycle === Lifecycle.CLOSED ? (trade.result || "Cerrado") : "En curso");
  const value = trade.lifecycle === Lifecycle.CLOSED ? fmtR(realizedR(trade)) : "Pendiente";
  return el("button", {
    type: "button",
    className: "bt-row",
    onclick: () => go("trade/" + trade.id + "?from=backtesting"),
    "aria-label": `Abrir backtest ${trade.asset} ${trade.direction}, ${day}`,
  }, [
    el("span", { className: "bt-row-date", text: day }),
    el("strong", { text: trade.asset || "Activo pendiente" }),
    el("span", { text: trade.direction || "Dirección pendiente" }),
    trade.lifecycle === Lifecycle.CLOSED ? el("span", { className: "state-badge", text: status }) : stateBadge(trade),
    el("span", { className: "bt-row-r", text: value }),
  ]);
}

export async function renderBacktesting(ctx) {
  const studies = await listActiveObservations(ctx.stage.id);
  const studyStats = computeStudies(studies, { stageId: ctx.stage.id });
  const trades = (await listStageTrades(ctx.stage.id, { includeVoid: false }))
    .filter((trade) => trade.context === Context.BACKTEST && trade.isDraft !== true)
    .sort((a, b) => String(b.sourceRef?.sessionDate || b.closedAt || b.openedAt || "").localeCompare(String(a.sourceRef?.sessionDate || a.closedAt || a.openedAt || "")));
  const test = trades.filter(isTestRecord);
  const genuine = trades.filter((trade) => !isTestRecord(trade));
  const stats = compute(genuine, { universe: "BACKTEST", stageId: ctx.stage.id });
  const importer = backtestImporter(ctx.stage.id);
  const action = () => document.querySelector(".quick-bt input")?.focus();
  const qa = test.length ? el("details", { className: "bt-test-fold" }, [
    el("summary", { text: `Datos de prueba (${test.length}) · excluidos del resumen` }),
    el("div", { className: "bt-list" }, test.map(tradeRow)),
  ]) : null;

  return [
    el("section", { className: "panel bt-hero" }, [el("h1", { text: "Backtesting" })]),
    quickBacktest(ctx),
    el("section", { className: "panel" }, [
      el("div", { className: "row-actions" }, [importer.button,
        el("button", { type: "button", className: "ghost", text: "Ver estadísticas", onclick: () => go("numeros?universe=BACKTEST&excludeTest=1") })]),
      el("div", { className: "bt-summary" }, [
        summary("Registros", genuine.length, "Pruebas históricas"),
        summary("Cerrados", stats.nClosed, "Con resultado registrado"),
        summary("Expectativa", fmtR(stats.expectancyR), `Calculada con ${stats.nR} R válidos`),
      ]),
    ]),
    importer.panel,
    el("section", { className: "panel" }, [
      el("h2", { text: "Estudios" }),
      el("p", { text: `${studyStats.total} estudios · ${studyStats.noTrade} NO TRADE · ${studyStats.unclassified} sin clasificar` }),
      el("p", { className: "hint", text: `NO TRADE / estudios clasificados: ${studyStats.noTradeRate == null ? "—" : (studyStats.noTradeRate * 100).toFixed(1) + "%"} (${studyStats.noTrade}/${studyStats.classified}). No incluye operaciones ni estudios sin clasificar.` }),
      ...studies.filter(o => !isTestRecord(o)).map(o => el("button", { type: "button", className: "row", text: `${o.date} · ${o.asset} · ${o.studyOutcome || "Sin clasificar"}`, onclick: () => go("observacion/" + o.id) })),
    ]),
    el("section", { className: "panel bt-register" }, [
      el("div", { className: "bt-section-heading" }, [
        el("div", {}, [
          el("h2", { text: "Historial de backtests" }),
          el("p", { className: "hint", text: "Abrí un registro para revisarlo y ver sus capturas." }),
        ]),
        el("button", { type: "button", className: "ghost", text: "Nuevo backtest", onclick: action }),
      ]),
      genuine.length
        ? el("div", { className: "bt-list" }, genuine.map(tradeRow))
        : el("div", { className: "empty-block" }, [
          el("p", { className: "empty", text: "Todavía no tenés backtests registrados." }),
          el("p", { className: "hint", text: "Empezá con el activo y la dirección. Elegí el resultado y guardá en un clic." }),
          el("button", { type: "button", text: "Registrar primer backtest", onclick: action }),
        ]),
      qa,
      el("p", { className: "hint", text: "Podés registrar backtests manualmente o importar un archivo JSON con vista previa." }),
    ]),
  ];
}
