// Inversiones a largo plazo (BTC, acciones). Separadas del trading: no entran en estadísticas ni saldos.
// Un solo almacén con tres tipos de registro: ASSET (activo), TX (compra/venta) y PLAN (compra planeada).
import { createId, nowIso } from "./ids.js";
import { listInvestments, putInvestment, getInvestment, deleteInvestment } from "../storage/repos/investments.js";

export const DEFAULT_ASSETS = [
  { symbol: "BTC", name: "Bitcoin", type: "CRYPTO", priceSource: "coingecko:bitcoin" },
  { symbol: "SPCX", name: "SpaceX", type: "STOCK", priceSource: "manual" },
];

const num = (v) => {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
const validDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");

export async function ensureDefaultAssets() {
  const all = await listInvestments();
  if (all.some((r) => r.kind === "ASSET")) return;
  for (const a of DEFAULT_ASSETS) await addAsset(a);
}

export async function addAsset({ symbol, name, type = "STOCK", priceSource = "manual" }) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) throw new Error("Poné el símbolo (ej.: BTC, SPCX).");
  const all = await listInvestments();
  if (all.some((r) => r.kind === "ASSET" && r.symbol === sym)) throw new Error(`${sym} ya está en tu cartera.`);
  const now = nowIso();
  const rec = { id: createId(), kind: "ASSET", symbol: sym, name: String(name || sym).trim(), type, priceSource,
    lastPrice: null, lastPriceAt: null, targetPct: null, createdAt: now, updatedAt: now };
  await putInvestment(rec);
  return rec;
}

export async function updateAsset(id, patch) {
  const cur = await getInvestment(id);
  if (!cur || cur.kind !== "ASSET") throw new Error("Activo no encontrado.");
  const next = { ...cur, updatedAt: nowIso() };
  if (patch.lastPrice !== undefined) {
    const p = num(patch.lastPrice);
    if (p == null || Number.isNaN(p) || p <= 0) throw new Error("Precio inválido.");
    next.lastPrice = p; next.lastPriceAt = patch.lastPriceAt || nowIso(); next.lastPriceSource = patch.source || "manual";
  }
  if (patch.targetPct !== undefined) {
    const t = num(patch.targetPct);
    if (t != null && (Number.isNaN(t) || t < 0 || t > 100)) throw new Error("El objetivo va de 0 a 100 %.");
    next.targetPct = t;
  }
  if (patch.name !== undefined) next.name = String(patch.name || cur.symbol).trim();
  await putInvestment(next);
  return next;
}

/** side: BUY | SELL */
export async function saveTx(input, id = null) {
  const asset = await getInvestment(input.assetId);
  if (!asset || asset.kind !== "ASSET") throw new Error("Elegí el activo.");
  if (!["BUY", "SELL"].includes(input.side)) throw new Error("Compra o venta.");
  if (!validDay(input.date)) throw new Error("Fecha inválida.");
  const qty = num(input.qty), price = num(input.price), fee = num(input.fee) ?? 0;
  if (qty == null || Number.isNaN(qty) || qty <= 0) throw new Error("Cantidad inválida.");
  if (price == null || Number.isNaN(price) || price <= 0) throw new Error("Precio inválido.");
  if (Number.isNaN(fee) || fee < 0) throw new Error("Comisión inválida.");
  const prev = id ? await getInvestment(id) : null;
  const now = nowIso();
  const rec = { ...(prev || {}), id: id || createId(), kind: "TX", assetId: asset.id, side: input.side, date: input.date,
    qty, price, fee, note: String(input.note || "").trim() || null, createdAt: prev?.createdAt || now, updatedAt: now };
  if (input.side === "SELL") {
    const others = (await listInvestments()).filter((r) => r.kind === "TX" && r.assetId === asset.id && r.id !== rec.id);
    const held = others.reduce((s, t) => s + (t.side === "BUY" ? t.qty : -t.qty), 0);
    if (qty > held + 1e-12) throw new Error(`No podés vender más de lo que tenés (${held.toLocaleString("es-AR", { maximumFractionDigits: 8 })}).`);
  }
  await putInvestment(rec);
  return rec;
}

export async function savePlan(input, id = null) {
  const asset = await getInvestment(input.assetId);
  if (!asset || asset.kind !== "ASSET") throw new Error("Elegí el activo.");
  const amount = num(input.amount), target = num(input.targetPrice);
  if (amount != null && (Number.isNaN(amount) || amount <= 0)) throw new Error("Monto inválido.");
  if (target != null && (Number.isNaN(target) || target <= 0)) throw new Error("Precio objetivo inválido.");
  if (amount == null && target == null && !String(input.note || "").trim()) throw new Error("Poné un monto, un precio objetivo o una nota.");
  const prev = id ? await getInvestment(id) : null;
  const now = nowIso();
  const rec = { ...(prev || {}), id: id || createId(), kind: "PLAN", assetId: asset.id, amount, targetPrice: target,
    note: String(input.note || "").trim() || null, createdAt: prev?.createdAt || now, updatedAt: now };
  await putInvestment(rec);
  return rec;
}

/** Borra y devuelve el registro para poder deshacer. Borrar un activo borra sus compras y planes. */
export async function removeRecord(id) {
  const rec = await getInvestment(id);
  if (!rec) return [];
  const all = await listInvestments();
  const removed = rec.kind === "ASSET" ? [rec, ...all.filter((r) => r.assetId === rec.id)] : [rec];
  for (const r of removed) await deleteInvestment(r.id);
  return removed;
}

export async function restoreRecords(records) {
  for (const r of records) await putInvestment(r);
}

/** Calcula la cartera con costo promedio. Precios en USD. */
export async function loadPortfolio() {
  const all = await listInvestments();
  const assets = all.filter((r) => r.kind === "ASSET").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const rows = assets.map((a) => {
    const txs = all.filter((r) => r.kind === "TX" && r.assetId === a.id).sort((x, y) => x.date.localeCompare(y.date) || x.createdAt.localeCompare(y.createdAt));
    const plans = all.filter((r) => r.kind === "PLAN" && r.assetId === a.id).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    let qty = 0, cost = 0, realized = 0, invested = 0;
    for (const t of txs) {
      if (t.side === "BUY") { qty += t.qty; cost += t.qty * t.price + (t.fee || 0); invested += t.qty * t.price + (t.fee || 0); }
      else { const avg = qty ? cost / qty : 0; cost -= avg * t.qty; realized += t.qty * t.price - (t.fee || 0) - avg * t.qty; qty -= t.qty; }
    }
    if (Math.abs(qty) < 1e-12) { qty = 0; cost = 0; }
    const price = a.lastPrice;
    const value = price != null ? qty * price : null;
    const pnl = value != null ? value - cost : null;
    const pnlPct = value != null && cost > 0 ? (value / cost - 1) * 100 : null;
    const buys = txs.map((t) => ({ ...t, changePct: price != null && t.side === "BUY" ? (price / t.price - 1) * 100 : null }));
    return { asset: a, txs: buys, plans, qty, cost, avg: qty ? cost / qty : null, price, value, pnl, pnlPct, realized, invested };
  });
  const priced = rows.filter((r) => r.value != null);
  const totalValue = priced.reduce((s, r) => s + r.value, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalRealized = rows.reduce((s, r) => s + r.realized, 0);
  for (const r of rows) r.weight = totalValue > 0 && r.value != null ? (r.value / totalValue) * 100 : null;
  return {
    rows,
    totalValue: priced.length ? totalValue : null,
    totalCost,
    pnl: priced.length ? totalValue - rows.filter((r) => r.value != null).reduce((s, r) => s + r.cost, 0) : null,
    pnlPct: priced.length && totalCost > 0 ? (totalValue / rows.filter((r) => r.value != null).reduce((s, r) => s + r.cost, 0) - 1) * 100 : null,
    realized: totalRealized,
    missingPrice: rows.filter((r) => r.qty > 0 && r.price == null).map((r) => r.asset.symbol),
  };
}

/** Precio automático para cripto (CoinGecko, gratis, sin clave). Las acciones se cargan a mano. */
export async function fetchAutoPrice(asset) {
  const src = String(asset.priceSource || "");
  if (!src.startsWith("coingecko:")) return null;
  const id = src.slice("coingecko:".length);
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`, { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo traer el precio.");
  const data = await res.json();
  const price = Number(data?.[id]?.usd);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Precio no disponible.");
  return updateAsset(asset.id, { lastPrice: price, source: "auto" });
}
