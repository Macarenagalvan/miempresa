// Cargar resultados diarios (movimientos) y corregir capital/moneda de una cuenta desde un link, con confirmación.
import { el } from "./render.js";
import { confirmDialog, toast } from "./feedback.js";
import { listStageAccounts, correctInitialAmount, createAccount, archiveAccount, balanceFor } from "../domain/account.js";
import { createMovement } from "../domain/movement.js";
import { getAccount, putAccount } from "../storage/repos/accounts.js";
import { listMovements } from "../storage/repos/movements.js";
import { listTrades } from "../storage/repos/trades.js";
import { nowIso } from "../domain/ids.js";
import { createChallenge, listStageChallenges, moveAccountToChallenge, updateChallenge } from "../domain/challenge.js";
import { ChallengeStatus } from "../domain/enums.js";

const STATUS_LABEL = { ACTIVE: "Activa", PHASE1_PASSED: "Fase 1 pasada", FUNDED: "Fondeada" };

function decode(raw) {
  const b64 = String(raw).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  if (data && Array.isArray(data.balances)) {
    const balances = data.balances.slice(0, 20).map((b) => ({ account: String(b.account || ""), target: Number(b.target), note: typeof b.note === "string" ? b.note.slice(0, 120) : "" }));
    if (!balances.length || balances.some((b) => !b.account || !Number.isFinite(b.target))) throw new Error("Link inválido.");
    return { balances };
  }
  if (!data || typeof data.account !== "string") throw new Error("Link inválido.");
  const movements = Array.isArray(data.movements) ? data.movements.slice(0, 200) : [];
  for (const m of movements) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date) || !Number.isFinite(Number(m.amount)) || Number(m.amount) === 0) throw new Error("Link inválido.");
  }
  const ch = data.challenge && typeof data.challenge === "object" ? data.challenge : null;
  if (ch && (!/^\d{4}-\d{2}-\d{2}$/.test(ch.purchasedAt) || !Number.isFinite(Number(ch.cost)) || !ch.firm)) throw new Error("Link inválido.");
  const create = data.create && typeof data.create === "object" ? data.create : null;
  if (create && (!["PROP_CHALLENGE", "FUNDED", "LIVE", "DEMO"].includes(create.context) || !Number.isFinite(Number(data.initialAmount)) || !data.currency)) throw new Error("Link inválido.");
  const challengeStatus = data.challengeStatus && Object.values(ChallengeStatus).includes(data.challengeStatus) ? data.challengeStatus : null;
  const archive = Array.isArray(data.archive) ? data.archive.filter((x) => typeof x === "string").slice(0, 10) : [];
  return { archive, account: data.account, initialAmount: data.initialAmount ?? null, currency: data.currency ?? null, movements, challenge: ch, create, challengeStatus };
}

export async function applyAccountLink(raw, stageId) {
  history.replaceState(null, "", "#/cuentas");
  let pack;
  try { pack = decode(raw); } catch (_) { toast("El link no se pudo leer.", { tone: "error" }); return; }
  const accounts = await listStageAccounts(stageId, { includeArchived: true });
  if (pack.balances) return applyBalances(pack.balances, accounts, stageId);
  let acc = accounts.find((a) => a.name === pack.account);
  if (!acc && pack.create) return createFromLink(pack, stageId);
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

async function findOrPlanChallenge(pack, stageId) {
  if (!pack.challenge) return { ch: null, isNew: false };
  const all = await listStageChallenges(stageId);
  const ch = all.find((c) => c.firm === pack.challenge.firm && c.purchasedAt === pack.challenge.purchasedAt && Number(c.cost) === Number(pack.challenge.cost)) || null;
  return { ch, isNew: !ch };
}

async function createFromLink(pack, stageId) {
  const { ch, isNew } = await findOrPlanChallenge(pack, stageId);
  const ctxLabel = { PROP_CHALLENGE: "Challenge", FUNDED: "Fondeada", LIVE: "Cuenta propia", DEMO: "Demo" }[pack.create.context];
  const body = [el("p", { className: "rgm-dialog-target", text: pack.account }), `Cuenta nueva · ${ctxLabel} · ${pack.initialAmount} ${pack.currency}`];
  if (pack.challenge) body.push(isNew ? `Nuevo fondeo ${pack.challenge.firm} del ${pack.challenge.purchasedAt.split("-").reverse().join("/")}` : `Queda en el fondeo ${pack.challenge.firm} del ${pack.challenge.purchasedAt.split("-").reverse().join("/")}`);
  if (pack.challengeStatus && (!ch || ch.status !== pack.challengeStatus)) body.push(`Estado del fondeo: ${STATUS_LABEL[pack.challengeStatus] || pack.challengeStatus}`);
  const toArchive = (await listStageAccounts(stageId)).filter((a) => pack.archive.includes(a.name));
  for (const a of toArchive) body.push(`${a.name} se archiva (pasó la evaluación). Su historial se conserva.`);
  const ok = await confirmDialog({ title: "¿Crear esta cuenta?", body, confirmText: "Sí, crear" });
  if (!ok) return;
  let target = ch;
  if (pack.challenge && !target) target = await createChallenge({ firm: pack.challenge.firm, purchasedAt: pack.challenge.purchasedAt, cost: pack.challenge.cost, currency: pack.challenge.currency || "EUR", size: pack.challenge.size ?? 25, note: pack.challenge.note || null }, stageId);
  if (target && pack.challengeStatus && target.status !== pack.challengeStatus) await updateChallenge(target.id, { status: pack.challengeStatus });
  await createAccount({ name: pack.account, currency: pack.currency, context: pack.create.context, initialAmount: Number(pack.initialAmount), challengeId: target ? target.id : null }, stageId);
  for (const m of pack.movements) await createMovement({ accountId: (await listStageAccounts(stageId)).find((a) => a.name === pack.account).id, type: "ADJUSTMENT", amount: Number(m.amount), date: m.date, note: m.note || "Resultado diario" }, stageId);
  for (const a of toArchive) await archiveAccount(a.id);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  toast("Cuenta creada.", { tone: "ok", timeout: 3000 });
}

// Iguala el saldo de cada cuenta al de la plataforma con un ajuste (la diferencia se calcula en el momento).
async function applyBalances(list, accounts, stageId) {
  const rows = [];
  for (const b of list) {
    const acc = accounts.find((a) => a.name === b.account);
    if (!acc) { rows.push({ b, missing: true }); continue; }
    const current = Math.round(Number(await balanceFor(acc.id)) * 100) / 100;
    const diff = Math.round((b.target - current) * 100) / 100;
    rows.push({ b, acc, current, diff });
  }
  const money = (v) => v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const body = rows.map((r) => r.missing ? `${r.b.account}: no la encontré, se saltea.` : r.diff === 0 ? `${r.acc.name}: ya está en ${money(r.b.target)}.` : `${r.acc.name}: ${money(r.current)} → ${money(r.b.target)} (ajuste ${r.diff > 0 ? "+" : ""}${money(r.diff)})`);
  const todo = rows.filter((r) => !r.missing && r.diff !== 0);
  if (!todo.length) { await confirmDialog({ title: "Todo coincide", body, confirmText: "Listo", cancelText: "Cerrar" }); return; }
  const ok = await confirmDialog({ title: "¿Igualar los saldos?", body, confirmText: "Sí, igualar" });
  if (!ok) return;
  const today = new Date(); const d = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  for (const r of todo) await createMovement({ accountId: r.acc.id, type: "ADJUSTMENT", amount: r.diff, date: d, note: r.b.note || "Ajuste para igualar el saldo de la plataforma" }, stageId);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  toast("Saldos igualados.", { tone: "ok", timeout: 3000 });
}
