import { el } from "../render.js";
import { field } from "../forms/observation.js";
import { ChallengeStatus, Currency } from "../../domain/enums.js";
import { createChallenge, listStageChallenges, accountsForChallenge } from "../../domain/challenge.js";
import { listPayouts } from "../../storage/repos/payouts.js";
import { fundingSummary, listChallengePayouts } from "../../domain/payout.js";
import { isPayoutLive } from "../../domain/integrity.js";
import { go } from "../router.js";

export async function renderFondeo(ctx) {
  if (ctx.route.rest === "nuevo") return renderNuevo(ctx);
  const rows = await listStageChallenges(ctx.stage.id);
  const payouts = await listPayouts();
  const summary = fundingSummary(rows, payouts);
  const list = rows.length
    ? await Promise.all(rows.map(async (ch) => {
      const accs = await accountsForChallenge(ch.id);
      const pays = (await listChallengePayouts(ch.id)).filter(isPayoutLive);
      const paid = pays.reduce((s, p) => s + Number(p.amount), 0);
      const item = el("button", { type: "button", className: "row hist" }, [
        el("strong", { text: ch.firm }),
        el("span", { className: "num", text: String(ch.size) }),
        el("span", { text: ch.status }),
        el("span", { text: `${accs.length} cta` }),
        el("span", { className: "num", text: paid ? `${paid} ${ch.currency}` : "—" }),
      ]);
      item.addEventListener("click", () => go("challenge/" + ch.id));
      return item;
    }))
    : [el("p", { className: "empty", text: "No hay challenges en esta etapa." })];
  const costBits = Object.entries(summary.costByCurrency).map(([c, n]) => `${n} ${c}`).join(" · ") || "—";
  const payBits = Object.entries(summary.payoutByCurrency).map(([c, n]) => `${n} ${c}`).join(" · ") || "—";
  return [
    el("section", { className: "panel" }, [
      el("h1", { text: "Fondeo" }),
      el("p", { className: "meta", text: `${summary.nChallenges} challenges · costo ${costBits} · payouts ${payBits}` }),
      el("p", { className: "hint", text: "No es performance de trading. Sin FX." }),
      el("div", { className: "row-actions" }, [
        el("button", { type: "button", text: "Nuevo challenge", onclick: () => go("fondeo/nuevo") }),
      ]),
      el("div", { className: "list table-wrap" }, list),
    ]),
  ];
}

function renderNuevo(ctx) {
  const firm = el("input", { className: "input", value: "" });
  const purchasedAt = el("input", { className: "input", type: "date", value: new Date().toISOString().slice(0, 10) });
  const size = el("input", { className: "input", value: "" });
  const cost = el("input", { className: "input", value: "" });
  const currency = el("select", { className: "input" }, Object.values(Currency).map((c) => el("option", { value: c, text: c })));
  const status = el("select", { className: "input" }, Object.values(ChallengeStatus).map((s) => el("option", { value: s, text: s })));
  const format = el("input", { className: "input", value: "" });
  const err = el("p", { className: "err", text: "" });
  const save = el("button", { type: "button", text: "Crear challenge" });
  save.addEventListener("click", async () => {
    err.textContent = "";
    try {
      const ch = await createChallenge({
        firm: firm.value,
        purchasedAt: purchasedAt.value,
        size: size.value,
        cost: cost.value,
        currency: currency.value,
        status: status.value,
        format: format.value,
      }, ctx.stage.id);
      go("challenge/" + ch.id);
    } catch (e) { err.textContent = e.message; }
  });
  return [
    el("section", { className: "panel form" }, [
      el("h1", { text: "Nuevo challenge" }),
      field("firma", firm),
      field("comprado", purchasedAt),
      field("size", size),
      field("costo", cost),
      field("moneda", currency),
      field("status", status),
      field("formato (opcional)", format),
      el("p", { className: "hint", text: "No crea Account. El costo no es un Movement ni un LOSS." }),
      err,
      el("div", { className: "row-actions" }, [
        save,
        el("button", { type: "button", className: "ghost", text: "Volver", onclick: () => go("fondeo") }),
      ]),
    ]),
  ];
}
