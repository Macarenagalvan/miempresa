import { el } from "../render.js";
import { field } from "../forms/observation.js";
import { getTrade } from "../../storage/repos/trades.js";
import { getSetup } from "../../storage/repos/setups.js";
import { updateOpenTrade, closeTrade, voidTrade } from "../../domain/trade.js";
import { CloseType, VoidReason, Lifecycle } from "../../domain/enums.js";
import { go } from "../router.js";

function partialsSelect(current) {
  const node = el("select", { className: "input" }, [
    el("option", { value: "false", text: "No" }),
    el("option", { value: "true", text: "Sí" }),
  ]);
  node.value = current === true ? "true" : "false";
  return node;
}

export async function renderTradeDetail(ctx) {
  const closeMode = ctx.route.rest.includes("/cerrar");
  const voidMode = ctx.route.rest.includes("/void");
  const id = ctx.route.rest.replace(/\/(cerrar|void)$/, "");
  const trade = id ? await getTrade(id) : null;
  if (!trade) {
    return [el("section", { className: "panel" }, [el("p", { className: "empty", text: "Trade no encontrado." })])];
  }
  const setup = trade.setupId ? await getSetup(trade.setupId) : null;
  if (closeMode) return renderClose(trade);
  if (voidMode) return renderVoid(trade);
  return renderCard(trade, setup);
}

function renderCard(trade, setup) {
  const err = el("p", { className: "err", text: "" });
  const sl = el("input", { className: "input", value: trade.currentSL ?? "" });
  const mgmt = el("textarea", { className: "input", rows: "3" });
  mgmt.value = trade.management || "";
  const partials = partialsSelect(trade.hasPartials);
  const actions = [];

  if (trade.lifecycle === Lifecycle.OPEN) {
    const save = el("button", { type: "button", text: "Guardar gestión" });
    save.addEventListener("click", async () => {
      try {
        await updateOpenTrade(trade.id, {
          currentSL: sl.value,
          management: mgmt.value,
          hasPartials: partials.value === "true",
        });
        go("trade/" + trade.id);
      } catch (e) { err.textContent = e.message; }
    });
    actions.push(save);
    actions.push(el("button", { type: "button", text: "Cerrar operación", onclick: () => go("trade/" + trade.id + "/cerrar") }));
  }
  if (trade.lifecycle !== Lifecycle.VOID) {
    actions.push(el("button", { type: "button", className: "ghost", text: "VOID", onclick: () => go("trade/" + trade.id + "/void") }));
  }
  if (setup) {
    actions.push(el("button", { type: "button", className: "ghost", text: "Ver Setup", onclick: () => go("setup/" + setup.id) }));
  }

  let rLabel = "R al cierre";
  if (trade.lifecycle === Lifecycle.CLOSED) {
    if (trade.hasPartials) rLabel = "R n/a · parciales (exit no es media ponderada)";
    else if (trade.rrRealized == null) rLabel = "R n/a";
    else rLabel = `R ${trade.rrRealized.toFixed(2)}`;
  } else if (trade.incompleteForR) {
    rLabel = "INCOMPLETO PARA R / RISK";
  } else if (trade.hasPartials) {
    rLabel = "R n/a al cierre · parciales";
  }

  return [
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: `${trade.lifecycle} · ${trade.context}` }),
      el("h1", { text: `${trade.asset} ${trade.direction}` }),
      el("p", { className: "meta", text: `entry ${trade.entry} · strategy ${trade.strategy}` }),
      setup ? el("p", { className: "meta", text: `plannedEntry ${setup.plannedEntry ?? "—"} ≠ actual ${trade.entry}` }) : null,
      el("p", { className: "meta", text: `initialSL ${trade.initialSL ?? "—"} · currentSL ${trade.currentSL ?? "—"}` }),
      el("p", { className: "meta", text: rLabel }),
      trade.result ? el("p", { className: "meta", text: `${trade.result} · netPnl ${trade.netPnl}` }) : null,
      trade.lifecycle === Lifecycle.OPEN ? field("currentSL", sl) : null,
      trade.lifecycle === Lifecycle.OPEN
        ? field("Hubo cierres parciales", partials)
        : el("p", { className: "meta", text: `Hubo cierres parciales: ${trade.hasPartials === true ? "Sí" : "No"}` }),
      trade.lifecycle === Lifecycle.OPEN ? field("Gestión (nota)", mgmt) : el("p", { className: "meta", text: trade.management || "" }),
      trade.voidReason ? el("p", { className: "hint", text: `VOID ${trade.voidReason} ${trade.voidedAt}` }) : null,
      err,
      el("div", { className: "row-actions" }, actions),
    ]),
  ];
}

function renderClose(trade) {
  const exit = el("input", { className: "input", value: "" });
  const closedAt = el("input", { className: "input", value: new Date().toISOString().slice(0, 16) });
  const net = el("input", { className: "input", value: "" });
  const comm = el("input", { className: "input", value: "" });
  const swap = el("input", { className: "input", value: "" });
  const closeType = el("select", { className: "input" }, Object.values(CloseType).map((c) => el("option", { value: c, text: c })));
  closeType.value = CloseType.MANUAL;
  const mgmt = el("textarea", { className: "input", rows: "2" });
  mgmt.value = trade.management || "";
  const partials = partialsSelect(trade.hasPartials);
  const err = el("p", { className: "err", text: "" });
  const save = el("button", { type: "button", text: "Cerrar" });
  save.addEventListener("click", async () => {
    err.textContent = "";
    try {
      await closeTrade(trade.id, {
        exit: exit.value,
        closedAt: closedAt.value ? new Date(closedAt.value).toISOString() : undefined,
        netPnl: net.value,
        commission: comm.value,
        swap: swap.value,
        closeType: closeType.value,
        declaredBe: closeType.value === CloseType.BE,
        management: mgmt.value,
        hasPartials: partials.value === "true",
      });
      go("trade/" + trade.id);
    } catch (e) { err.textContent = e.message; }
  });
  return [
    el("section", { className: "panel" }, [
      el("h1", { text: "Cerrar operación" }),
      field("exit", exit),
      field("closedAt", closedAt),
      field("netPnl", net),
      field("comisión", comm),
      field("swap", swap),
      field("motivo de cierre", closeType),
      field("Hubo cierres parciales", partials),
      field("gestión (nota)", mgmt),
      el("p", { className: "hint", text: "WIN/LOSS salen del signo de netPnl. BE solo si closeType=BE o netPnl exacto 0." }),
      err,
      save,
    ]),
  ];
}

function renderVoid(trade) {
  const reason = el("select", { className: "input" }, Object.values(VoidReason).map((r) => el("option", { value: r, text: r })));
  const err = el("p", { className: "err", text: "" });
  const save = el("button", { type: "button", text: "Confirmar VOID" });
  save.addEventListener("click", async () => {
    try {
      await voidTrade(trade.id, reason.value);
      go("trade/" + trade.id);
    } catch (e) { err.textContent = e.message; }
  });
  return [
    el("section", { className: "panel" }, [
      el("h1", { text: "VOID" }),
      el("p", { className: "hint", text: "Solo duplicado, fantasma, prueba, accidente o inválido. No para esconder un LOSS." }),
      field("voidReason", reason),
      err,
      save,
    ]),
  ];
}
