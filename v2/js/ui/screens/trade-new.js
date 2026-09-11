import { el } from "../render.js";
import { field } from "../forms/observation.js";
import { getSetup } from "../../storage/repos/setups.js";
import { createTrade, createClosedTrade, enrichTrade } from "../../domain/trade.js";
import { getActiveAccount, listStageAccounts, visibleActiveAccount } from "../../domain/account.js";
import { go } from "../router.js";
import { Context, Direction, Strategy, Style, CloseType, BlueVariant, Lifecycle, strategyLabel } from "../../domain/enums.js";
import { ROADMAP_ASSETS, SESSIONS } from "../../config.js";
import { normalizeAsset } from "../../domain/integrity.js";

function select(values, current) {
  const node = el("select", { className: "input" }, values.map(([v, l]) => el("option", { value: v, text: l })));
  node.value = current || values[0][0];
  return node;
}

function contextLabel(ctx) {
  return ctx === Context.PROP_CHALLENGE ? "PROP" : ctx;
}

export async function renderNuevoTrade(ctx) {
  const setupId = ctx.route.rest.startsWith("trade/") ? ctx.route.rest.slice("trade/".length) : "";
  const setup = setupId ? await getSetup(setupId) : null;
  const accounts = await listStageAccounts(ctx.stage.id);
  const active = await getActiveAccount();
  const initialContext = setup ? setup.context : Context.BACKTEST;
  const suggest = [];
  const seen = new Set();
  for (const a of ROADMAP_ASSETS) {
    if (!seen.has(a.id)) { seen.add(a.id); suggest.push(a.id); }
  }
  for (const extra of ["NZDJPY", "GBPUSD", "USDJPY", "GER40", "NAS100"]) {
    if (!seen.has(extra)) { seen.add(extra); suggest.push(extra); }
  }
  const asset = el("input", {
    className: "input",
    name: "asset",
    list: "nuevo-asset-suggest",
    value: setup ? setup.asset : "",
    autocomplete: "off",
  });
  const assetList = el("datalist", { id: "nuevo-asset-suggest" }, suggest.map((s) => el("option", { value: s })));
  const lifecycle = select([[Lifecycle.OPEN, "OPEN"], [Lifecycle.CLOSED, "CLOSED"]], Lifecycle.OPEN);
  lifecycle.setAttribute("name", "lifecycle");
  const context = select(Object.values(Context).map((c) => [c, contextLabel(c)]), initialContext);
  const direction = select(Object.values(Direction).map((d) => [d, d]), setup ? setup.direction : Direction.LONG);
  direction.setAttribute("name", "direction");
  const strategy = select(Object.values(Strategy).map((s) => [s, strategyLabel(s)]), setup ? setup.strategy : Strategy.UNCLASSIFIED);
  strategy.setAttribute("name", "strategy");
  const style = select([["", "—"]].concat(Object.values(Style).map((s) => [s, s])), setup && setup.style ? setup.style : "");
  style.setAttribute("name", "style");
  const variant = select([["", "—"]].concat(Object.values(BlueVariant).map((s) => [s, s])), "");
  variant.setAttribute("name", "variant");
  const session = select([["", "—"]].concat(SESSIONS.map((s) => [s, s])), "");
  session.setAttribute("name", "session");
  const openedAt = el("input", { className: "input", name: "openedAt", value: new Date().toISOString().slice(0, 16) });
  const closedAt = el("input", { className: "input", name: "closedAt", value: new Date().toISOString().slice(0, 16) });
  const entry = el("input", { className: "input", name: "entry", value: "" });
  const sl = el("input", { className: "input", name: "initialSL", value: "" });
  const tp = el("input", { className: "input", name: "tp", value: "" });
  const rr = el("input", { className: "input", name: "rrPlanned", value: "" });
  const riskPct = el("input", { className: "input", name: "riskPercent", value: "" });
  const riskMoney = el("input", { className: "input", name: "riskMoney", value: "" });
  const lots = el("input", { className: "input", name: "lots", value: "" });
  const exit = el("input", { className: "input", name: "exit", value: "" });
  const net = el("input", { className: "input", name: "netPnl", value: "" });
  const comm = el("input", { className: "input", name: "commission", value: "" });
  const swap = el("input", { className: "input", name: "swap", value: "" });
  const closeType = select(Object.values(CloseType).map((c) => [c, c]), CloseType.UNKNOWN);
  closeType.setAttribute("name", "closeType");
  const broker = el("input", { className: "input", value: "" });
  const mgmt = el("textarea", { className: "input", name: "management", rows: "2" });
  const note = el("textarea", { className: "input", name: "note", rows: "2" });
  const partials = select([["false", "No"], ["true", "Sí"]], "false");
  partials.setAttribute("name", "hasPartials");
  const accountPick = el("select", { className: "input" });
  const hint = el("p", { className: "hint", text: "" });
  const err = el("p", { className: "err", text: "" });
  const closedBlock = el("div", { className: "closed-only" });

  function paintAccounts() {
    const ctxVal = context.value;
    accountPick.replaceChildren();
    if (ctxVal === Context.BACKTEST) {
      accountPick.append(el("option", { value: "", text: "sin account (BACKTEST)" }));
      accountPick.disabled = true;
      hint.textContent = "BACKTEST no usa Account. accountId = null.";
      return;
    }
    accountPick.disabled = false;
    const compatible = accounts.filter((a) => a.context === ctxVal);
    accountPick.append(el("option", { value: "", text: compatible.length ? "elegí account" : "no hay account compatible" }));
    for (const a of compatible) {
      accountPick.append(el("option", { value: a.id, text: `${a.name} · ${contextLabel(a.context)}` }));
    }
    const pre = visibleActiveAccount(active, ctxVal);
    if (pre && compatible.some((a) => a.id === pre.id)) {
      accountPick.value = pre.id;
      hint.textContent = `Account activa preseleccionada (${pre.name}). Podés cambiarla.`;
    } else if (!compatible.length) {
      hint.textContent = `Falta una Account ${contextLabel(ctxVal)} activa. Creala en Cuentas.`;
    } else {
      hint.textContent = "Elegí Account. No se asigna en silencio.";
    }
  }
  context.addEventListener("change", paintAccounts);
  paintAccounts();

  closedBlock.append(
    field("closedAt", closedAt),
    field("exit", exit),
    field("netPnl", net),
    field("comisión (opcional)", comm),
    field("swap (opcional)", swap),
    field("Close type", closeType),
    field("Management", mgmt),
    field("Note", note),
    field("Variant", variant),
    field("Session", session),
    field("TP (opcional)", tp),
    field("RR planned (opcional)", rr),
  );

  function paintLifecycle() {
    const closed = lifecycle.value === Lifecycle.CLOSED;
    closedBlock.hidden = !closed;
    save.textContent = "Guardar operación";
  }
  lifecycle.addEventListener("change", paintLifecycle);

  const save = el("button", { type: "button", text: "Guardar operación" });
  paintLifecycle();
  save.addEventListener("click", async () => {
    err.textContent = "";
    try {
      const assetVal = normalizeAsset(asset.value);
      if (!assetVal) throw new Error("asset requerido");
      if (context.value !== Context.BACKTEST && !accountPick.value) {
        throw new Error("elegí una Account compatible o creá una en Cuentas");
      }
      const openedIso = openedAt.value ? new Date(openedAt.value).toISOString() : undefined;
      if (lifecycle.value === Lifecycle.CLOSED) {
        if (!closedAt.value) throw new Error("closedAt requerido");
        if (!exit.value) throw new Error("exit requerido");
        if (net.value === "") throw new Error("netPnl requerido");
        const closedIso = new Date(closedAt.value).toISOString();
        if (openedIso && closedIso < openedIso) throw new Error("closedAt no puede ser anterior a openedAt");
        const trade = await createClosedTrade({
          asset: assetVal,
          brokerSymbol: broker.value,
          context: context.value,
          direction: direction.value,
          strategy: strategy.value,
          style: style.value || null,
          variant: variant.value || null,
          session: session.value || null,
          accountId: context.value === Context.BACKTEST ? null : accountPick.value,
          openedAt: openedIso,
          closedAt: closedIso,
          entry: entry.value,
          initialSL: sl.value,
          tp: tp.value,
          rrPlanned: rr.value,
          exit: exit.value,
          netPnl: net.value,
          commission: comm.value,
          swap: swap.value,
          closeType: closeType.value,
          management: mgmt.value || null,
          note: note.value || null,
          setupId: setup ? setup.id : null,
          hasPartials: partials.value === "true",
          riskPercent: riskPct.value,
          riskMoney: riskMoney.value,
          lots: lots.value,
        }, ctx.stage.id);
        go("trade/" + trade.id);
        return;
      }
      const trade = await createTrade({
        asset: assetVal,
        brokerSymbol: broker.value,
        context: context.value,
        direction: direction.value,
        accountId: context.value === Context.BACKTEST ? null : accountPick.value,
        openedAt: openedIso,
        entry: entry.value,
        initialSL: sl.value,
        setupId: setup ? setup.id : null,
        hasPartials: partials.value === "true",
        riskPercent: riskPct.value,
        riskMoney: riskMoney.value,
        lots: lots.value,
      }, ctx.stage.id);
      const journal = {
        strategy: strategy.value,
        style: style.value || null,
        variant: variant.value || null,
        session: session.value || null,
        tp: tp.value,
        rrPlanned: rr.value,
        management: mgmt.value || null,
        note: note.value || null,
        riskPercent: riskPct.value,
        riskMoney: riskMoney.value,
      };
      const enriched = await enrichTrade(trade.id, journal);
      go("trade/" + enriched.id);
    } catch (e) {
      err.textContent = e.message;
    }
  });

  const refs = [];
  if (setup) {
    refs.push(el("p", { className: "hint", text: "Referencia del Setup. plannedEntry no se copia al entry." }));
    refs.push(el("p", { className: "meta", text: `plannedEntry ${setup.plannedEntry ?? "—"} · plannedSL ${setup.plannedSl ?? "—"} · plannedTP ${setup.plannedTp ?? "—"}` }));
  }

  return [
    el("section", { className: "panel form" }, [
      el("p", { className: "kicker", text: "Nueva operación" }),
      el("h1", { text: setup ? "Operación desde idea" : "Operación" }),
      ...refs,
      field("Estado", lifecycle),
      field("Asset", asset),
      assetList,
      field("brokerSymbol (opcional)", broker),
      field("Context", context),
      field("Account", accountPick),
      field("Direction", direction),
      field("Strategy", strategy),
      field("Style", style),
      field("openedAt", openedAt),
      field("entry (confirmar)", entry),
      field("initialSL (opcional)", sl),
      field("Riesgo % (opcional)", riskPct),
      field("Riesgo $ / € (opcional)", riskMoney),
      field("Lotaje", lots),
      field("Hubo cierres parciales", partials),
      closedBlock,
      hint,
      err,
      save,
    ]),
  ];
}
