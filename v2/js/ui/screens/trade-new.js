import { el } from "../render.js";
import { field } from "../forms/observation.js";
import { getSetup } from "../../storage/repos/setups.js";
import { createTrade } from "../../domain/trade.js";
import { getActiveAccount, listStageAccounts, visibleActiveAccount } from "../../domain/account.js";
import { go } from "../router.js";
import { Context, Direction } from "../../domain/enums.js";
import { ROADMAP_ASSETS } from "../../config.js";

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
  const asset = select(ROADMAP_ASSETS.map((a) => [a.id, a.label]), setup ? setup.asset : "EURUSD");
  const context = select(Object.values(Context).map((c) => [c, contextLabel(c)]), initialContext);
  const direction = select(Object.values(Direction).map((d) => [d, d]), setup ? setup.direction : Direction.LONG);
  const openedAt = el("input", { className: "input", value: new Date().toISOString().slice(0, 16) });
  const entry = el("input", { className: "input", value: "" });
  const sl = el("input", { className: "input", value: "" });
  const broker = el("input", { className: "input", value: "" });
  const partials = select([["false", "No"], ["true", "Sí"]], "false");
  const accountPick = el("select", { className: "input" });
  const hint = el("p", { className: "hint", text: "" });
  const err = el("p", { className: "err", text: "" });

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

  const save = el("button", { type: "button", text: "Guardar OPEN" });
  save.addEventListener("click", async () => {
    err.textContent = "";
    try {
      if (context.value !== Context.BACKTEST && !accountPick.value) {
        throw new Error("elegí una Account compatible o creá una en Cuentas");
      }
      const trade = await createTrade({
        asset: asset.value,
        brokerSymbol: broker.value,
        context: context.value,
        direction: direction.value,
        accountId: context.value === Context.BACKTEST ? null : accountPick.value,
        openedAt: openedAt.value ? new Date(openedAt.value).toISOString() : undefined,
        entry: entry.value,
        initialSL: sl.value,
        setupId: setup ? setup.id : null,
        hasPartials: partials.value === "true",
      }, ctx.stage.id);
      go("trade/" + trade.id);
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
      el("p", { className: "kicker", text: "Nuevo" }),
      el("h1", { text: setup ? "Trade desde Setup" : "Trade" }),
      ...refs,
      field("Asset", asset),
      field("brokerSymbol (opcional)", broker),
      field("Context", context),
      field("Account", accountPick),
      field("Direction", direction),
      field("openedAt", openedAt),
      field("entry (confirmar)", entry),
      field("initialSL (opcional)", sl),
      field("Hubo cierres parciales", partials),
      hint,
      err,
      save,
    ]),
  ];
}
