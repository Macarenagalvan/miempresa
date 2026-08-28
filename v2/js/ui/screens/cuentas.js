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
        el("span", { text: String(bal) }),
        el("span", { text: isOn ? "activa" : "" }),
      ]);
      item.addEventListener("click", () => go("cuenta/" + a.id));
      return item;
    })
    : [el("p", { className: "empty", text: "No hay cuenta. El balance no es 0." })];
  const meta = await getMeta();
  const mt5 = meta && meta.mt5Sync ? meta.mt5Sync : {};
  const accountSel = el("select", { className: "input" }, [
    el("option", { value: "", text: "elegí Account destino" }),
    ...rows.map((a) => el("option", { value: a.id, text: `${a.name} · ${contextLabel(a.context)}` })),
  ]);
  if (mt5.accountId && rows.some((a) => a.id === mt5.accountId)) accountSel.value = mt5.accountId;
  else if (active) accountSel.value = active.id;
  const contextOut = el("p", { className: "meta", text: "" });
  function selectedAccount() {
    return rows.find((a) => a.id === accountSel.value) || null;
  }
  function paintContext() {
    const acc = selectedAccount();
    contextOut.textContent = acc ? `context ${acc.context}` : "context —";
  }
  paintContext();
  accountSel.addEventListener("change", paintContext);
  const tzSel = el("select", { className: "input" }, [
    el("option", { value: "", text: "timezone fuente MT5" }),
    ...MT5_SOURCE_TIMEZONES.map((z) => el("option", { value: z, text: z })),
  ]);
  tzSel.value = mt5.timeZone || "";
  const file = el("input", { className: "input", type: "file", accept: ".csv,.txt,text/csv" });
  file.style.display = "none";
  const syncErr = el("p", { className: "err", text: "" });
  const previewBox = el("div", { className: "list" }, []);
  let pendingText = "";
  let pendingName = "";
  function showPreview(report) {
    previewBox.replaceChildren(
      el("p", { className: "meta", text: `Account ${report.accountId}` }),
      el("p", { className: "meta", text: `context ${report.context}` }),
      el("p", { className: "meta", text: `timezone ${report.timeZone}` }),
      el("p", { className: "meta", text: `leídas ${report.read} · nuevas ${report.created} · duplicadas ${report.duplicates} · inválidas ${report.invalid} · símbolos sin mapping ${report.unknownSymbols}` }),
    );
  }
  const pickBtn = el("button", { type: "button", text: "Elegir maca_mt5.csv" });
  pickBtn.addEventListener("click", () => {
    syncErr.textContent = "";
    const acc = selectedAccount();
    if (!acc) { syncErr.textContent = "Elegí Account destino."; return; }
    if (!tzSel.value) { syncErr.textContent = "Elegí timezone de la fuente MT5."; return; }
    file.click();
  });
  file.addEventListener("change", async () => {
    const chosen = file.files && file.files[0];
    file.value = "";
    if (!chosen) return;
    const acc = selectedAccount();
    if (!acc || !tzSel.value) return;
    try {
      const buf = await chosen.arrayBuffer();
      pendingText = new TextDecoder("windows-1252").decode(buf);
      pendingName = chosen.name;
      const report = await previewMt5Csv(pendingText, {
        accountId: acc.id,
        context: acc.context,
        timeZone: tzSel.value,
      });
      showPreview(report);
    } catch (e) {
      syncErr.textContent = e.message;
    }
  });
  const confirmBtn = el("button", { type: "button", text: "Confirmar import MT5" });
  confirmBtn.addEventListener("click", async () => {
    syncErr.textContent = "";
    const acc = selectedAccount();
    if (!acc) { syncErr.textContent = "Elegí Account destino."; return; }
    if (!tzSel.value) { syncErr.textContent = "Elegí timezone de la fuente MT5."; return; }
    if (!pendingText) { syncErr.textContent = "Elegí el CSV y revisá el preview."; return; }
    try {
      const report = await syncMt5Csv(pendingText, ctx.stage.id, {
        accountId: acc.id,
        context: acc.context,
        timeZone: tzSel.value,
      });
      await putMeta({
        ...meta,
        mt5Sync: {
          accountId: acc.id,
          context: acc.context,
          timeZone: tzSel.value,
          fileName: pendingName,
          lastSyncAt: nowIso(),
          report,
        },
      });
      pendingText = "";
      go("cuentas");
    } catch (e) {
      syncErr.textContent = e.message;
    }
  });
  const last = mt5.report
    ? el("p", { className: "meta", text: `última sync ${mt5.lastSyncAt || "—"} · ${mt5.fileName || ""} · nuevas ${mt5.report.created} · dup ${mt5.report.duplicates}` })
    : el("p", { className: "meta", text: "sin sync MT5 todavía" });
  return [
    el("section", { className: "panel" }, [
      el("h1", { text: "Cuentas" }),
      el("p", { className: "meta", text: "Ledger por cuenta. Sin FX. Backtest no vive acá." }),
      el("div", { className: "row-actions" }, [
        el("button", { type: "button", text: "Nueva cuenta", onclick: () => go("cuentas/nueva") }),
      ]),
      el("div", { className: "list" }, list),
    ]),
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: "MT5 · lectura local" }),
      el("h2", { text: "Sincronizar MT5" }),
      el("p", { className: "hint", text: "CSV de MacaJournalExport v1.01. El Journal solo lee. No crea Accounts." }),
      field("Account destino", accountSel),
      contextOut,
      field("timezone fuente", tzSel),
      file,
      el("div", { className: "row-actions" }, [pickBtn, confirmBtn]),
      syncErr,
      previewBox,
      last,
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
