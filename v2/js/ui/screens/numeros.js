import { el } from "../render.js";
import { listTrades } from "../../storage/repos/trades.js";
import { compute } from "../../domain/stats.js";
import { Context, Strategy, Direction, BlueVariant } from "../../domain/enums.js";
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

function fmt(value, kind) {
  if (value == null) return "n/a";
  if (value === Number.POSITIVE_INFINITY) return "∞";
  if (kind === "pct") return (value * 100).toFixed(1) + "%";
  if (kind === "r") return Number(value).toFixed(2);
  if (Number.isInteger(value)) return String(value);
  return Number(value).toFixed(2);
}

function metric(label, value, kind, note) {
  return el("div", { className: "metric" }, [
    el("span", { className: "kicker", text: label }),
    el("strong", { text: fmt(value, kind) }),
    note ? el("span", { className: "meta", text: note }) : null,
  ]);
}

export async function renderNumeros(ctx) {
  const q = ctx.route.query || {};
  const universe = q.universe || "BACKTEST";
  const filters = {
    universe,
    context: q.context || "",
    accountId: q.account || "",
    stageId: ctx.stage.id,
    asset: q.asset || "",
    strategy: q.strategy || "",
    variant: q.variant || "",
    direction: q.direction || "",
    session: q.session || "",
    from: q.from || "",
    to: q.to || "",
  };
  const stats = compute(await listTrades(), filters);
  const uni = select(universe, [["REAL", "Real"], ["DEMO", "Demo"], ["BACKTEST", "Backtest"]]);
  const ctxSel = select(filters.context, [["", "context"], [Context.LIVE, "LIVE"], [Context.PROP_CHALLENGE, "PROP"], [Context.FUNDED, "FUNDED"], [Context.DEMO, "DEMO"], [Context.BACKTEST, "BACKTEST"]]);
  const asset = select(filters.asset, [["", "asset"], ...ROADMAP_ASSETS.map((a) => [a.id, a.label])]);
  const strategy = select(filters.strategy, [["", "strategy"], ...Object.values(Strategy).map((s) => [s, s])]);
  const variant = select(filters.variant, [["", "variant"], ...Object.values(BlueVariant).map((v) => [v, v])]);
  const direction = select(filters.direction, [["", "dir"], ...Object.values(Direction).map((d) => [d, d])]);
  const session = select(filters.session, [["", "sesión"], ...SESSIONS.map((s) => [s, s])]);
  const from = el("input", { className: "input slim", type: "date", value: filters.from });
  const to = el("input", { className: "input slim", type: "date", value: filters.to });
  function apply() {
    go("numeros" + qs({
      universe: uni.value, context: ctxSel.value,
      asset: asset.value, strategy: strategy.value, variant: variant.value,
      direction: direction.value, session: session.value, from: from.value, to: to.value,
    }));
  }
  [uni, ctxSel, asset, strategy, variant, direction, session, from, to].forEach((n) => n.addEventListener("change", apply));
  return [
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: `Universo ${universe} · stage activa` }),
      el("h1", { text: "Números" }),
      el("p", { className: "meta", text: "Real = LIVE+PROP+FUNDED. Demo aparte. Desk no. Misma stats.compute()." }),
      el("div", { className: "chips filters" }, [uni, ctxSel, asset, strategy, variant, direction, session, from, to]),
      el("div", { className: "metrics" }, [
        metric("Total Trades", stats.nClosed),
        metric("Wins", stats.nWins),
        metric("Losses", stats.nLosses),
        metric("BE", stats.nBe),
        metric("Win Rate", stats.winRate, "pct", `n decided ${stats.nDecided}`),
        metric("Net PnL", stats.netPnl, "n", `n money ${stats.nMoney}`),
        metric("Profit Factor $", stats.profitFactorUsd, "n", `n money ${stats.nMoney}`),
        metric("Expectancy $", stats.expectancyUsd, "n", `n money ${stats.nMoney}`),
        metric("Expectancy R", stats.expectancyR, "r", `R metrics · n=${stats.nR}`),
        metric("Max Drawdown $", stats.maxDrawdown),
        metric("Max consec Wins", stats.maxConsecWins),
        metric("Max consec Losses", stats.maxConsecLosses),
      ]),
      el("p", { className: "hint", text: "Expectancy R = mean(R) sobre U_R. Average R no se muestra aparte. Parciales fuera de U_R." }),
    ]),
  ];
}
