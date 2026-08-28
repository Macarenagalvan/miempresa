import { el } from "../render.js";
import { field } from "../forms/observation.js";
import { AccountContext, Currency } from "../../domain/enums.js";
import {
  createAccount,
  listStageAccounts,
  setActiveAccount,
  getActiveAccount,
  accountBalance,
} from "../../domain/account.js";
import { listMovements } from "../../storage/repos/movements.js";
import { listTrades } from "../../storage/repos/trades.js";
import { go } from "../router.js";

function contextLabel(ctx) {
  if (ctx === AccountContext.PROP_CHALLENGE) return "PROP";
  return ctx;
}

export async function renderCuentas(ctx) {
  if (ctx.route.rest === "nueva") return renderNueva(ctx);
  const rows = await listStageAccounts(ctx.stage.id);
  const active = await getActiveAccount();
  const movements = await listMovements();
  const trades = await listTrades();
  const list = rows.length
    ? rows.map((a) => {
      const bal = accountBalance(a, movements, trades);
      const isOn = active && active.id === a.id;
      const item = el("button", { type: "button", className: "row hist" }, [
        el("strong", { text: a.name }),
        el("span", { text: contextLabel(a.context) }),
        el("span", { text: a.currency }),
        el("span", { text: String(bal) }),
        el("span", { text: isOn ? "activa" : "" }),
      ]);
      item.addEventListener("click", () => go("cuenta/" + a.id));
      return item;
    })
    : [el("p", { className: "empty", text: "No hay cuenta. El balance no es 0." })];
  return [
    el("section", { className: "panel" }, [
      el("h1", { text: "Cuentas" }),
      el("p", { className: "meta", text: "Ledger por cuenta. Sin FX. Backtest no vive acá." }),
      el("div", { className: "row-actions" }, [
        el("button", { type: "button", text: "Nueva cuenta", onclick: () => go("cuentas/nueva") }),
      ]),
      el("div", { className: "list" }, list),
    ]),
  ];
}

function renderNueva(ctx) {
  const name = el("input", { className: "input", value: "" });
  const context = el("select", { className: "input" }, [
    el("option", { value: "DEMO", text: "DEMO" }),
    el("option", { value: "LIVE", text: "LIVE" }),
    el("option", { value: "PROP", text: "PROP" }),
    el("option", { value: "FUNDED", text: "FUNDED" }),
  ]);
  const currency = el("select", { className: "input" }, Object.values(Currency).map((c) => el("option", { value: c, text: c })));
  currency.value = Currency.EUR;
  const initial = el("input", { className: "input", value: "" });
  const err = el("p", { className: "err", text: "" });
  const save = el("button", { type: "button", text: "Crear cuenta" });
  save.addEventListener("click", async () => {
    err.textContent = "";
    try {
      const account = await createAccount({
        name: name.value,
        context: context.value,
        currency: currency.value,
        initialAmount: initial.value,
      }, ctx.stage.id);
      go("cuenta/" + account.id);
    } catch (e) { err.textContent = e.message; }
  });
  return [
    el("section", { className: "panel" }, [
      el("h1", { text: "Nueva cuenta" }),
      field("nombre", name),
      field("tipo", context),
      field("moneda", currency),
      field("capital inicial", initial),
      el("p", { className: "hint", text: "El capital inicial no genera un Movement. No hay cuenta BACKTEST acá." }),
      err,
      el("div", { className: "row-actions" }, [
        save,
        el("button", { type: "button", className: "ghost", text: "Volver", onclick: () => go("cuentas") }),
      ]),
    ]),
  ];
}
