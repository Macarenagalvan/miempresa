import { accountOverview, link, label, money } from "../journal-insights.js";
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
import { previewMt5Csv, syncMt5Csv } from "../../domain/trade.js";
import { MT5_SOURCE_TIMEZONES } from "../../config.js";
import { getMeta, putMeta } from "../../storage/repos/meta.js";
import { nowIso } from "../../domain/ids.js";
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
        el("span", { className: "num", text: money(bal, a.currency) }),
        el("span", { text: isOn ? "activa" : "" }),
      ]);
      item.addEventListener("click", () => go("cuenta/" + a.id));
      return item;
    })
    : [el("div", { className: "empty-block" }, [
      el("p", { className: "empty", text: "Todavía no agregaste una cuenta." }),
      el("p", { className: "hint", text: "Usá el capital inicial, antes de las operaciones que vas a importar." }),
      el("button", { type: "button", className: "ghost", text: "Nueva cuenta", onclick: () => go("cuentas/nueva") }),
    ])];
  return [
    await accountOverview(ctx),
    el("section", { className: "panel" }, [
      el("h1", { text: "Cuentas" }),
      el("p", { className: "meta", text: "Elegí una cuenta para ver sus movimientos o administrar el capital." }),
      el("div", { className: "row-actions" }, [
        el("button", { type: "button", text: "Nueva cuenta", onclick: () => go("cuentas/nueva") }),
      ]),
      el("div", { className: "list table-wrap" }, list),
    ]),
    el("section", { className: "panel" }, [el("h2", {text:"Traer operaciones de MT5"}), el("p", {className:"hint",text:"Importá directamente el informe HTML. Revisá la cuenta, los netos y los duplicados antes de guardar."}), link("Importar HTML o CSV de MT5", "importar")]),
  ];
}

function renderNueva(ctx) {
  const name = el("input", { className: "input", value: "" });
  const context = el("select", { className: "input" }, [
    el("option", { value: "DEMO", text: "Demo · práctica" }),
    el("option", { value: "LIVE", text: "Propia · dinero real" }),
    el("option", { value: "PROP", text: "Challenge · evaluación de fondeo" }),
    el("option", { value: "FUNDED", text: "Fondeada · evaluación aprobada" }),
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
      await setActiveAccount(account.id);
      go("importar?account=" + account.id);
    } catch (e) { err.textContent = e.message; }
  });
  return [
    el("section", { className: "panel form" }, [
      el("h1", { text: "Nueva cuenta" }),
      field("nombre", name),
      field("tipo", context),
      field("moneda", currency),
      field("capital inicial", initial),
      el("p", { className: "hint", text: "Ingresá el capital de partida, no el saldo después de operar. Los resultados se sumarán al registrar o importar operaciones." }),
      err,
      el("div", { className: "row-actions" }, [
        save,
        el("button", { type: "button", className: "ghost", text: "Volver", onclick: () => go("cuentas") }),
      ]),
    ]),
  ];
}