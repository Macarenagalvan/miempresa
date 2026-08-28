import { el } from "../render.js";
import { field } from "../forms/observation.js";
import { AccountStatus, MovementType, VoidReason } from "../../domain/enums.js";
import {
  archiveAccount,
  setActiveAccount,
  getActiveAccount,
  accountBalance,
  correctInitialAmount,
} from "../../domain/account.js";
import { createMovement, voidMovement, listAccountMovements } from "../../domain/movement.js";
import { getAccount } from "../../storage/repos/accounts.js";
import { listTrades } from "../../storage/repos/trades.js";
import { go } from "../router.js";

function contextLabel(ctx) {
  return ctx === "PROP_CHALLENGE" ? "PROP" : ctx;
}

function typeLabel(type) {
  return type === MovementType.FEE_EXTERNAL ? "FEE" : type;
}

export async function renderCuentaDetail(ctx) {
  const id = ctx.route.rest;
  const account = id ? await getAccount(id) : null;
  if (!account) {
    return [el("section", { className: "panel" }, [el("p", { className: "empty", text: "Cuenta no encontrada." })])];
  }
  const movements = await listAccountMovements(account.id);
  const trades = await listTrades();
  const bal = accountBalance(account, movements, trades);
  const active = await getActiveAccount();
  const isActive = active && active.id === account.id;
  const err = el("p", { className: "err", text: "" });
  const actions = [];
  if (account.status === AccountStatus.ACTIVE) {
    if (!isActive) {
      actions.push(el("button", { type: "button", text: "Marcar activa", onclick: async () => {
        try { await setActiveAccount(account.id); go("cuenta/" + account.id); }
        catch (e) { err.textContent = e.message; }
      } }));
    }
    actions.push(el("button", { type: "button", className: "ghost", text: "Archivar", onclick: async () => {
      try { await archiveAccount(account.id); go("cuentas"); }
      catch (e) { err.textContent = e.message; }
    } }));
  }
  actions.push(el("button", { type: "button", className: "ghost", text: "Volver", onclick: () => go("cuentas") }));

  const type = el("select", { className: "input" }, [
    el("option", { value: "DEPOSIT", text: "DEPOSIT" }),
    el("option", { value: "WITHDRAWAL", text: "WITHDRAWAL" }),
    el("option", { value: "FEE", text: "FEE" }),
    el("option", { value: "ADJUSTMENT", text: "ADJUSTMENT" }),
  ]);
  const amount = el("input", { className: "input", value: "" });
  const date = el("input", { className: "input", type: "date", value: new Date().toISOString().slice(0, 10) });
  const note = el("input", { className: "input", value: "" });
  const add = el("button", { type: "button", text: "Agregar movement" });
  add.addEventListener("click", async () => {
    err.textContent = "";
    try {
      await createMovement({
        accountId: account.id,
        type: type.value,
        amount: amount.value,
        date: date.value,
        note: note.value,
      }, account.stageId);
      go("cuenta/" + account.id);
    } catch (e) { err.textContent = e.message; }
  });

  const initial = el("input", { className: "input", value: String(account.initialAmount) });
  const correct = el("button", { type: "button", className: "ghost", text: "Corregir capital inicial" });
  correct.addEventListener("click", async () => {
    err.textContent = "";
    try {
      await correctInitialAmount(account.id, initial.value);
      go("cuenta/" + account.id);
    } catch (e) { err.textContent = e.message; }
  });

  const rows = movements.length
    ? movements.map((m) => {
      const live = m.lifecycle !== "VOID" && !m.voidedAt;
      const line = el("div", { className: "row hist" }, [
        el("span", { text: m.date }),
        el("span", { text: typeLabel(m.type) }),
        el("span", { text: String(m.amount) }),
        el("span", { text: live ? "vive" : "VOID" }),
        el("span", { className: "clip", text: m.note || "" }),
      ]);
      if (live) {
        const voidBtn = el("button", { type: "button", className: "ghost", text: "VOID" });
        voidBtn.addEventListener("click", async () => {
          try {
            await voidMovement(m.id, VoidReason.ACCIDENT);
            go("cuenta/" + account.id);
          } catch (e) { err.textContent = e.message; }
        });
        line.append(voidBtn);
      }
      return line;
    })
    : [el("p", { className: "empty", text: "0 movements." })];

  return [
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: `${contextLabel(account.context)} · ${account.status}` }),
      el("h1", { text: account.name }),
      el("p", { className: "meta", text: `${account.currency} · inicial ${account.initialAmount} · saldo ${bal}` }),
      isActive ? el("p", { className: "meta", text: "Cuenta activa" }) : null,
      field("capital inicial (corrección explícita)", initial),
      correct,
      err,
      el("div", { className: "row-actions" }, actions),
    ]),
    account.status === AccountStatus.ACTIVE
      ? el("section", { className: "panel" }, [
        el("h2", { text: "Nuevo movement" }),
        field("tipo", type),
        field("monto (positivo; ADJUSTMENT puede ser negativo)", amount),
        field("fecha", date),
        field("nota", note),
        el("p", { className: "hint", text: "DEPOSIT suma. WITHDRAWAL y FEE restan. ADJUSTMENT usa el signo que escribas." }),
        add,
      ])
      : null,
    el("section", { className: "panel" }, [
      el("h2", { text: "Movements" }),
      el("div", { className: "list" }, rows),
    ]),
  ];
}
