import { el } from "../render.js";
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
    return [el("section", { className: "panel" }, [el("p", { className: "empty", text: "Challenge no encontrado." })])];
  }
  const accounts = await accountsForChallenge(ch.id);
  const payouts = await listChallengePayouts(ch.id);
  const livePays = payouts.filter(isPayoutLive);
  const paid = livePays.reduce((s, p) => s + Number(p.amount), 0);
  const stageAccounts = await listStageAccounts(ctx.stage.id);
  const unlinkable = stageAccounts.filter((a) => !a.challengeId || a.challengeId === ch.id);
  const err = el("p", { className: "err", text: "" });

  const firm = el("input", { className: "input", value: ch.firm });
  const status = el("select", { className: "input" }, Object.values(ChallengeStatus).map((s) => el("option", { value: s, text: s })));
  status.value = ch.status;
  const failReason = el("input", { className: "input", value: ch.failReason || "" });
  const target = el("input", { className: "input", value: ch.profitTargetPct ?? "" });
  const maxDd = el("input", { className: "input", value: ch.maxDrawdownPct ?? "" });
  const daily = el("input", { className: "input", value: ch.maxDailyLossPct ?? "" });
  const save = el("button", { type: "button", text: "Guardar challenge" });
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
  const linkBtn = el("button", { type: "button", text: "Vincular account" });
  linkBtn.addEventListener("click", async () => {
    err.textContent = "";
    try {
      if (!pick.value) throw new Error("elegí una account");
      await linkAccountToChallenge(pick.value, ch.id);
      go("challenge/" + ch.id);
    } catch (e) { err.textContent = e.message; }
  });

  const newName = el("input", { className: "input", value: "" });
  const newCtx = el("select", { className: "input" }, [
    el("option", { value: "PROP", text: "PROP" }),
    el("option", { value: "FUNDED", text: "FUNDED" }),
  ]);
  const newAmt = el("input", { className: "input", value: String(ch.size) });
  const createLinked = el("button", { type: "button", className: "ghost", text: "Crear account vinculada" });
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
  const pKind = el("select", { className: "input" }, Object.values(PayoutKind).map((k) => el("option", { value: k, text: k })));
  const pNote = el("input", { className: "input", value: "" });
  const addPay = el("button", { type: "button", text: "Registrar payout" });
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
      return row;
    })
    : [el("p", { className: "empty", text: "0 accounts vinculadas." })];

  const payList = payouts.length
    ? payouts.map((p) => {
      const live = isPayoutLive(p);
      const line = el("div", { className: "row hist" }, [
        el("span", { text: p.date }),
        el("span", { text: p.kind }),
        el("span", { text: `${p.amount} ${p.currency}` }),
        el("span", { text: live ? "vive" : "VOID" }),
        el("span", { className: "clip", text: p.note || "" }),
      ]);
      if (live) {
        const vb = el("button", { type: "button", className: "ghost", text: "VOID" });
        vb.addEventListener("click", async () => {
          try { await voidPayout(p.id, VoidReason.ACCIDENT); go("challenge/" + ch.id); }
          catch (e) { err.textContent = e.message; }
        });
        line.append(vb);
      }
      return line;
    })
    : [el("p", { className: "empty", text: "0 payouts." })];

  const rules = [
    ch.profitTargetPct != null ? `target ${ch.profitTargetPct}%` : null,
    ch.maxDrawdownPct != null ? `maxDD ${ch.maxDrawdownPct}%` : null,
    ch.maxDailyLossPct != null ? `daily ${ch.maxDailyLossPct}%` : null,
  ].filter(Boolean).join(" · ") || "n/a — sin dato de equity intradía";

  return [
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: `${ch.status} · ${ch.currency}` }),
      el("h1", { text: ch.firm }),
      el("p", { className: "meta", text: `size ${ch.size} · costo ${ch.cost} ${ch.currency} · compra ${ch.purchasedAt}` }),
      el("p", { className: "meta", text: `payouts ${paid} ${ch.currency} · maxStage ${ch.maxStageReached}` }),
      el("p", { className: "hint", text: `Reglas: ${rules}` }),
      field("firma", firm),
      field("status", status),
      field("failReason", failReason),
      field("profitTargetPct", target),
      field("maxDrawdownPct", maxDd),
      field("maxDailyLossPct", daily),
      err,
      el("div", { className: "row-actions" }, [
        save,
        el("button", { type: "button", className: "ghost", text: "Volver", onclick: () => go("fondeo") }),
      ]),
    ]),
    el("section", { className: "panel" }, [
      el("h2", { text: "Accounts" }),
      el("div", { className: "list" }, accList),
      field("vincular existente", pick),
      linkBtn,
      field("nombre cuenta nueva", newName),
      field("tipo", newCtx),
      field("capital inicial", newAmt),
      createLinked,
      el("p", { className: "hint", text: "Cambiar status del challenge no transforma el tipo de la account." }),
    ]),
    el("section", { className: "panel" }, [
      el("h2", { text: "Payouts" }),
      el("p", { className: "hint", text: "No es WIN. No mueve accountBalance. Si sale de MT5, Movement WITHDRAWAL aparte." }),
      field("amount", pAmount),
      field("fecha", pDate),
      field("kind", pKind),
      field("nota", pNote),
      addPay,
      el("div", { className: "list" }, payList),
    ]),
  ];
}
