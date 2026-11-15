// Cargar resultados diarios (movimientos) y corregir capital/moneda de una cuenta desde un link, con confirmación.
import { el } from "./render.js";
import { confirmDialog, toast } from "./feedback.js";
import { listStageAccounts, correctInitialAmount } from "../domain/account.js";
import { createMovement } from "../domain/movement.js";
import { getAccount, putAccount } from "../storage/repos/accounts.js";
import { listMovements } from "../storage/repos/movements.js";
import { listTrades } from "../storage/repos/trades.js";
import { nowIso } from "../domain/ids.js";
import { createChallenge, listStageChallenges, moveAccountToChallenge } from "../domain/challenge.js";

function decode(raw) {
  const b64 = String(raw).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  if (!data || typeof data.account !== "string") throw new Error("Link inválido.");
  const movements = Array.isArray(data.movements) ? data.movements.slice(0, 200) : [];
  for (const m of movements) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date) || !Number.isFinite(Number(m.amount)) || Number(m.amount) === 0) throw new Error("Link inválido.");
  }
  const ch = data.challenge && typeof data.challenge === "object" ? data.challenge : null;
  if (ch && (!/^\d{4}-\d{2}-\d{2}$/.test(ch.purchasedAt) || !Number.isFinite(Number(ch.cost)) || !ch.firm)) throw new Error("Link inválido.");
  return { account: data.account, initialAmount: data.initialAmount ?? null, currency: data.currency ?? null, movements, challenge: ch };
}

export async function applyAccountLink(raw, stageId) {
  history.replaceState(null, "", "#/cuentas");
  let pack;
  try { pack = decode(raw); } catch (_) { toast("El link no se pudo leer.", { tone: "error" }); return; }
  const accounts = await listStageAccounts(stageId, { includeArchived: true });
  const acc = accounts.find((a) => a.name === pack.account);
  if (!acc) { toast(`No encontré la cuenta «${pack.account}».`, { tone: "error", timeout: 6000 }); return; }
  const [movs, trades] = await Promise.all([listMovements(), listTrades()]);
  const empty = !movs.some((m) => m.accountId === acc.id) && !trades.some((t) => t.accountId === acc.id);
  const changeCurrency = pack.currency && pack.currency !== acc.currency;
  if (changeCurrency && !empty) { toast("La moneda solo se puede cambiar en una cuenta sin registros.", { tone: "error" }); return; }
  const existing = new Set(movs.filter((m) => m.accountId === acc.id).map((m) => m.date + "|" + Number(m.amount).toFixed(2) + "|" + (m.note || "")));
  const fresh = pack.movements.filter((m) => !existing.has(m.date + "|" + Number(m.amount).toFixed(2) + "|" + (m.note || "")));
  const total = fresh.reduce((s, m) => s + Number(m.amount), 0);
  const body = [el("p", { className: "rgm-dialog-target", text: acc.name })];
  if (pack.initialAmount != null && Number(pack.initialAmount) !== Number(acc.initialAmount)) body.push(`Capital inicial: ${acc.initialAmount} → ${pack.initialAmount}`);
  if (changeCurrency) body.push(`Moneda: ${acc.currency} → ${pack.currency}`);
  if (fresh.length) body.push(`${fresh.length} resultados diarios (total ${total > 0 ? "+" : ""}${total.toFixed(2)}). Cuentan para el saldo, no para las estadísticas por trade.`);
  if (pack.movements.length > fresh.length) body.push(`${pack.movements.length - fresh.length} ya estaban cargados: se omiten.`);
  let targetCh = null;
  if (pack.challenge) {
    const all = await listStageChallenges(stageId);
    targetCh = all.find((c) => c.firm === pack.challenge.firm && c.purchasedAt === pack.challenge.purchasedAt && Number(c.cost) === Number(pack.challenge.cost)) || null;
    if (!targetCh) body.push(`Nuevo fondeo ${pack.challenge.firm} comprado el ${pack.challenge.purchasedAt.split("-").reverse().join("/")} · costo ${pack.challenge.cost} ${pack.challenge.currency || "EUR"}`);
    if (!targetCh || acc.challengeId !== targetCh.id) body.push("La cuenta pasa a ese fondeo.");
  }
  if (body.length === 1) { toast("No hay nada nuevo para cargar en esa cuenta."); return; }
  const ok = await confirmDialog({ title: "¿Aplicar estos cambios?", body, confirmText: "Sí, aplicar" });
  if (!ok) return;
  if (pack.challenge) {
    if (!targetCh) targetCh = await createChallenge({ firm: pack.challenge.firm, purchasedAt: pack.challenge.purchasedAt, cost: pack.challenge.cost, currency: pack.challenge.currency || "EUR", size: pack.challenge.size ?? 25, note: pack.challenge.note || null }, stageId);
    if (acc.challengeId !== targetCh.id) await moveAccountToChallenge(acc.id, targetCh.id);
  }
  if (changeCurrency) { const cur = await getAccount(acc.id); await putAccount({ ...cur, currency: pack.currency, updatedAt: nowIso() }); }
  if (pack.initialAmount != null) await correctInitialAmount(acc.id, pack.initialAmount);
  for (const m of fresh) await createMovement({ accountId: acc.id, type: "ADJUSTMENT", amount: Number(m.amount), date: m.date, note: m.note || "Resultado diario" }, stageId);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  toast("Cuenta actualizada.", { tone: "ok", timeout: 3000 });
}
