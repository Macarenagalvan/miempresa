import { uiLabel } from '../labels.js';
import { el } from "../render.js";
import { deleteButton, deletableRow } from '../delete-button.js';
import { field } from "../forms/observation.js";
import { AccountContext, ChallengeStatus, Currency, PayoutKind, VoidReason } from "../../domain/enums.js";
import { getChallenge } from "../../storage/repos/challenges.js";
import {
  updateChallenge,
  linkAccountToChallenge,
  accountsForChallenge,
} from "../../domain/challenge.js";
import { createAccount, listStageAccounts } from "../../domain/account.js";
import { createPayout, voidPayout, listChallengePayouts } from "../../domain/payout.js";
import { isPayoutLive } from "../../domain/integrity.js";
import { go } from "../router.js";

export async function renderChallengeDetail(ctx) {
  const id = ctx.route.rest;
  const ch = id ? await getChallenge(id) : null;
  if (!ch) {
    return [el("section", { className: "panel" }, [el("p", { className: "empty", text: "Fondeo no encontrado." })])];
  }
  const accounts = await accountsForChallenge(ch.id);
  const payouts = await listChallengePayouts(ch.id);
  const livePays = payouts.filter(isPayoutLive);
  const paid = livePays.reduce((s, p) => s + Number(p.amount), 0);
  const stageAccounts = await listStageAccounts(ctx.stage.id);
  const unlinkable = stageAccounts.filter((a) => !a.challengeId || a.challengeId === ch.id);
  const err = el("p", { className: "err", text: "" });

  const firm = el("input", { className: "input", value: ch.firm });
  const status = el("select", { className: "input" }, Object.values(ChallengeStatus).map((s) => el("option", { value: s, text: uiLabel(s) })));
  status.value = ch.status;
  const failReason = el("input", { className: "input", value: ch.failReason || "" });
  const target = el("input", { className: "input", value: ch.profitTargetPct ?? "" });
  const maxDd = el("input", { className: "input", value: ch.maxDrawdownPct ?? "" });
  const daily = el("input", { className: "input", value: ch.maxDailyLossPct ?? "" });
  const save = el("button", { type: "button", text: "Guardar fondeo" });
  save.addEventListener("click", async () => {
    err.textContent = "";
    try {
      await updateChallenge(ch.id, {
        firm: firm.value,
        status: status.value,
        failReason: failReason.value,
        profitTargetPct: target.value,
        maxDrawdownPct: maxDd.value,
        maxDailyLossPct: daily.value,
      });
      go("challenge/" + ch.id);
    } catch (e) { err.textContent = e.message; }
  });

  const pick = el("select", { className: "input" }, [
    el("option", { value: "", text: "cuenta existente" }),
    ...unlinkable.filter((a) => a.challengeId !== ch.id).map((a) => el("option", { value: a.id, text: `${a.name} · ${a.context === AccountContext.PROP_CHALLENGE ? "PROP" : a.context}` })),
  ]);
  const linkBtn = el("button", { type: "button", text: "Vincular cuenta" });
  linkBtn.addEventListener("click", async () => {
    err.textContent = "";
    try {
      if (!pick.value) throw new Error("elegí una cuenta");
      await linkAccountToChallenge(pick.value, ch.id);
      go("challenge/" + ch.id);
    } catch (e) { err.textContent = e.message; }
  });

  const newName = el("input", { className: "input", value: "" });
  const newCtx = el("select", { className: "input" }, [
    el("option", { value: "PROP", text: "Evaluación de fondeo" }),
    el("option", { value: "FUNDED", text: "Fondeada" }),
  ]);
  const newAmt = el("input", { className: "input", value: String(ch.size) });
  const createLinked = el("button", { type: "button", className: "ghost", text: "Crear cuenta vinculada" });
  createLinked.addEventListener("click", async () => {
    err.textContent = "";
    try {
      await createAccount({
        name: newName.value || `${ch.firm} ${newCtx.value}`,
        context: newCtx.value,
        currency: ch.currency,
        initialAmount: newAmt.value,
        challengeId: ch.id,
      }, ctx.stage.id);
      go("challenge/" + ch.id);
    } catch (e) { err.textContent = e.message; }
  });

  const pAmount = el("input", { className: "input", value: "" });
  const pDate = el("input", { className: "input", type: "date", value: new Date().toISOString().slice(0, 10) });
  const pKind = el("select", { className: "input" }, Object.values(PayoutKind).map((k) => el("option", { value: k, text: uiLabel(k) })));
  const pNote = el("input", { className: "input", value: "" });
  const addPay = el("button", { type: "button", text: "Registrar cobro" });
  addPay.addEventListener("click", async () => {
    err.textContent = "";
    try {
      await createPayout({
        challengeId: ch.id,
        amount: pAmount.value,
        date: pDate.value,
        kind: pKind.value,
        note: pNote.value,
        currency: ch.currency,
      }, ctx.stage.id);
      go("challenge/" + ch.id);
    } catch (e) { err.textContent = e.message; }
  });

  const accList = accounts.length
    ? accounts.map((a) => {
      const row = el("button", { type: "button", className: "row" }, [
        el("strong", { text: a.name }),
        el("span", { text: a.context === "PROP_CHALLENGE" ? "PROP" : a.context }),
        el("span", { text: a.currency }),
      ]);
      row.addEventListener("click", () => go("cuenta/" + a.id));
      return deletableRow(row,'account',a,'challenge/'+ch.id);
    })
    : [el("p", { className: "empty", text: "No hay cuentas vinculadas." })];

  const payList = payouts.length
    ? payouts.map((p) => {
      const live = isPayoutLive(p);
      const line = el("div", { className: "row hist" }, [
        el("span", { text: p.date }),
        el("span", { text: uiLabel(p.kind) }),
        el("span", { text: `${p.amount} ${p.currency}` }),
        el("span", { text: live ? "Registrado" : "Anulado" }),
        el("span", { className: "clip", text: p.note || "" }),
      ]);
      if (live) {
        const vb = el("button", { type: "button", className: "ghost", text: "Anular" });
        vb.addEventListener("click", async () => {
          try { await voidPayout(p.id, VoidReason.ACCIDENT); go("challenge/" + ch.id); }
          catch (e) { err.textContent = e.message; }
        });
        line.append(vb);
      }
      return line;
    })
    : [el("p", { className: "empty", text: "No hay cobros registrados." })];

  const rules = [
    ch.profitTargetPct != null ? `Objetivo ${ch.profitTargetPct}%` : null,
    ch.maxDrawdownPct != null ? `Pérdida máxima ${ch.maxDrawdownPct}%` : null,
    ch.maxDailyLossPct != null ? `Pérdida diaria ${ch.maxDailyLossPct}%` : null,
  ].filter(Boolean).join(" · ") || "Sin dato de saldo intradía";

  return [
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: `${uiLabel(ch.status)} · ${ch.currency}` }),
      el("h1", { text: ch.firm }),
      el("p", { className: "meta", text: `Tamaño ${ch.size} · costo ${ch.cost} ${ch.currency} · compra ${ch.purchasedAt}` }),
      el("p", { className: "meta", text: `Cobros ${paid} ${ch.currency} · fase máxima alcanzada ${ch.maxStageReached}` }),
      el("p", { className: "hint", text: `Reglas: ${rules}` }),
      field("Firma", firm),
      field("Estado", status),
      field("Motivo de cierre", failReason),
      field("Objetivo de beneficio (%)", target),
      field("Pérdida máxima (%)", maxDd),
      field("Pérdida diaria máxima (%)", daily),
      err,
      el("div", { className: "row-actions" }, [
        save,
        deleteButton('challenge',ch,'fondeo'),
        el("button", { type: "button", className: "ghost", text: "Volver", onclick: () => go("fondeo") }),
      ]),
    ]),
    el("section", { className: "panel" }, [
      el("h2", { text: "Cuentas vinculadas" }),
      el("div", { className: "list" }, accList),
      field("vincular existente", pick),
      linkBtn,
      field("nombre cuenta nueva", newName),
      field("tipo", newCtx),
      field("capital inicial", newAmt),
      createLinked,
      el("p", { className: "hint", text: "El estado del fondeo y el tipo de la cuenta se administran por separado." }),
    ]),
    el("section", { className: "panel" }, [
      el("h2", { text: "Cobros" }),
      el("p", { className: "hint", text: "Los cobros de fondeo se registran aparte. Si retiraste dinero de la cuenta MT5, registrá también el retiro en esa cuenta." }),
      field("Monto", pAmount),
      field("fecha", pDate),
      field("Tipo de cobro", pKind),
      field("nota", pNote),
      addPay,
      el("div", { className: "list" }, payList),
    ]),
  ];
}
