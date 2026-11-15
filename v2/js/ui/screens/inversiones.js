// Inversiones: cartera a largo plazo, cuánto creció cada compra y la diversificación.
import { el } from "../render.js";
import { confirmDialog, toast } from "../feedback.js";
import { field } from "../forms/observation.js";
import {
  ensureDefaultAssets, loadPortfolio, saveTx, savePlan, addAsset, updateAsset, removeRecord, restoreRecords, fetchAutoPrice,
} from "../../domain/investments.js";
import { listInvestments } from "../../storage/repos/investments.js";
import { buildXlsx, XS } from "../../services/xlsx.js";

const PALETTE = ["#d9ac52", "#79c27c", "#9fb3c8", "#e3756b", "#b48fd8", "#e0c27a"];
const usd = (n, d = 2) => n == null ? "—" : "US$ " + Number(n).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
const qtyFmt = (n) => n == null ? "—" : Number(n).toLocaleString("es-AR", { maximumFractionDigits: 8 });
const pct = (n) => n == null ? "—" : (n > 0 ? "+" : "") + n.toFixed(1) + " %";
const tone = (n) => n == null ? "" : n > 0 ? "is-win" : n < 0 ? "is-loss" : "";
const today = () => { const d = new Date(), p = (x) => String(x).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const dmy = (s) => { const [y, m, d] = String(s).split("-"); return `${d}/${m}/${y}`; };
const refresh = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
const since = (iso) => {
  if (!iso) return "";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return mins < 2 ? "recién" : mins < 60 ? `hace ${mins} min` : mins < 1440 ? `hace ${Math.round(mins / 60)} h` : `hace ${Math.round(mins / 1440)} días`;
};

let autoTried = 0;

export async function renderInversiones() {
  await ensureDefaultAssets();
  // Precio automático de cripto una vez por apertura (como mucho cada 2 minutos).
  if (Date.now() - autoTried > 120000) {
    autoTried = Date.now();
    const p0 = await loadPortfolio();
    Promise.allSettled(p0.rows.filter((r) => String(r.asset.priceSource).startsWith("coingecko:")).map((r) => fetchAutoPrice(r.asset)))
      .then((res) => { if (res.some((x) => x.status === "fulfilled" && x.value) && location.hash.startsWith("#/inversiones")) refresh(); });
  }
  const p = await loadPortfolio();
  const held = p.rows.filter((r) => r.qty > 0 || r.txs.length);

  const header = el("section", { className: "panel inv-hero" }, [
    el("div", { className: "inv-head" }, [
      el("div", {}, [
        el("p", { className: "kicker", text: "Largo plazo · separado del trading" }),
        el("h1", { text: "Inversiones" }),
      ]),
      el("div", { className: "inv-actions" }, [
        el("button", { type: "button", className: "tq tq-main", onclick: () => txDialog(p, "BUY") }, [el("span", { text: "+ Compra" })]),
        el("button", { type: "button", className: "tq", onclick: () => txDialog(p, "SELL") }, [el("span", { text: "Venta" })]),
        el("button", { type: "button", className: "tq", onclick: () => planDialog(p) }, [el("span", { text: "+ Plan de compra" })]),
      ]),
    ]),
    el("div", { className: "inv-kpis" }, [
      kpi("Valor actual", usd(p.totalValue), p.missingPrice.length ? `Falta precio de ${p.missingPrice.join(", ")}` : ""),
      kpi("Invertido (costo)", usd(p.totalCost), "Incluye comisiones"),
      kpi("Ganancia / pérdida", usd(p.pnl), "", tone(p.pnl)),
      kpi("Rendimiento", pct(p.pnlPct), p.realized ? `Realizado por ventas: ${usd(p.realized)}` : "Desde que compraste", tone(p.pnlPct)),
    ]),
    diversification(p),
  ]);

  const cards = p.rows.map((r, i) => assetCard(r, p, PALETTE[i % PALETTE.length]));

  return [
    header,
    ...cards,
    el("section", { className: "panel" }, [
      el("div", { className: "data-toolbar" }, [
        el("button", { type: "button", className: "tool-btn", onclick: () => exportXlsx(p) }, [el("span", { text: "Descargar Excel" })]),
        el("button", { type: "button", className: "tool-btn is-quiet", onclick: () => assetDialog() }, [el("span", { text: "+ Agregar otro activo" })]),
      ]),
      el("p", { className: "hint", text: "Bitcoin se actualiza solo. Las acciones (SpaceX) se actualizan a mano: tocá el precio y escribí el del día. Todo en dólares. Estos datos entran en tu respaldo, pero no en las estadísticas de trading." }),
      held.length ? null : el("p", { className: "empty", text: "Cargá tu primera compra con «+ Compra»." }),
    ]),
  ];
}

function kpi(label, value, note = "", cls = "") {
  return el("div", { className: "inv-kpi" }, [el("span", { text: label }), el("strong", { className: cls, text: value }), note ? el("small", { text: note }) : null]);
}

function diversification(p) {
  const rows = p.rows.filter((r) => r.weight != null && r.weight > 0);
  if (!rows.length) return el("p", { className: "hint", text: "La diversificación aparece cuando tengas compras con precio actual." });
  const bar = el("div", { className: "inv-bar", role: "img", "aria-label": "Diversificación" }, rows.map((r) => {
    const i = p.rows.indexOf(r);
    const seg = el("span", { title: `${r.asset.symbol} ${r.weight.toFixed(1)} %` });
    seg.style.width = r.weight + "%"; seg.style.background = PALETTE[i % PALETTE.length];
    return seg;
  }));
  const legend = el("div", { className: "inv-legend" }, rows.map((r) => {
    const i = p.rows.indexOf(r);
    const dot = el("i"); dot.style.background = PALETTE[i % PALETTE.length];
    const target = r.asset.targetPct != null ? ` · objetivo ${r.asset.targetPct} % (${r.weight - r.asset.targetPct > 0 ? "+" : ""}${(r.weight - r.asset.targetPct).toFixed(1)})` : "";
    return el("span", {}, [dot, el("b", { text: r.asset.symbol }), ` ${r.weight.toFixed(1)} %${target}`]);
  }));
  return el("div", { className: "inv-div" }, [el("h2", { text: "Diversificación" }), bar, legend]);
}

function assetCard(r, p, color) {
  const a = r.asset;
  const auto = String(a.priceSource).startsWith("coingecko:");
  const priceBtn = el("button", { type: "button", className: "inv-price", title: auto ? "Actualizar ahora" : "Escribir el precio de hoy" }, [
    el("strong", { text: usd(r.price, r.price != null && r.price < 10 ? 4 : 2) }),
    el("small", { text: r.price == null ? "Tocá para cargar el precio" : `${auto && a.lastPriceSource === "auto" ? "automático" : "manual"} · ${since(a.lastPriceAt)}` }),
  ]);
  priceBtn.addEventListener("click", async () => {
    if (auto) {
      try { await fetchAutoPrice(a); refresh(); toast(`${a.symbol} actualizado.`, { tone: "ok", timeout: 2000 }); return; }
      catch (_) { toast("No se pudo traer el precio automático. Cargalo a mano.", { tone: "error" }); }
    }
    priceDialog(a);
  });
  const txRows = r.txs.slice().reverse().map((t) => el("div", { className: "inv-tx" }, [
    el("span", { text: dmy(t.date) }),
    el("span", { className: "inv-side " + (t.side === "BUY" ? "is-buy" : "is-sell"), text: t.side === "BUY" ? "Compra" : "Venta" }),
    el("span", { className: "num", text: qtyFmt(t.qty) }),
    el("span", { className: "num", text: "a " + usd(t.price) }),
    el("span", { className: "num", text: usd(t.qty * t.price + (t.side === "BUY" ? 1 : -1) * (t.fee || 0)) }),
    el("strong", { className: "num " + tone(t.changePct), text: t.side === "BUY" ? pct(t.changePct) : "" }),
    el("div", { className: "row-quick" }, [
      iconBtn("Editar", "M4 20h4L19 9l-4-4L4 16z", () => txDialog(p, t.side, t)),
      iconBtn("Borrar", "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13", () => removeFlow(t, "esta operación"), true),
    ]),
  ]));
  const planRows = r.plans.map((pl) => el("div", { className: "inv-plan" }, [
    el("span", { text: [pl.amount != null ? usd(pl.amount, 0) : null, pl.targetPrice != null ? "si llega a " + usd(pl.targetPrice) : null, pl.note].filter(Boolean).join(" · ") }),
    pl.targetPrice != null && r.price != null ? el("small", { className: r.price <= pl.targetPrice ? "is-win" : "", text: r.price <= pl.targetPrice ? "¡Llegó al precio!" : `falta ${(((r.price / pl.targetPrice) - 1) * 100).toFixed(1)} % de baja` }) : null,
    el("div", { className: "row-quick" }, [
      el("button", { type: "button", className: "ghost inv-mini", text: "La compré", onclick: () => txDialog(p, "BUY", null, { assetId: a.id, price: pl.targetPrice, qty: pl.amount && pl.targetPrice ? +(pl.amount / pl.targetPrice).toFixed(8) : "", fromPlan: pl }) }),
      iconBtn("Editar plan", "M4 20h4L19 9l-4-4L4 16z", () => planDialog(p, pl)),
      iconBtn("Borrar plan", "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13", () => removeFlow(pl, "este plan"), true),
    ]),
  ]));
  const swatch = el("i", { className: "inv-swatch" }); swatch.style.background = color;
  return el("section", { className: "panel inv-card" }, [
    el("div", { className: "inv-card-head" }, [
      el("div", { className: "inv-title" }, [swatch, el("h2", { text: a.name }), el("span", { className: "inv-sym", text: a.symbol })]),
      priceBtn,
    ]),
    el("div", { className: "inv-kpis is-small" }, [
      kpi("Tenés", qtyFmt(r.qty) + " " + a.symbol),
      kpi("Precio promedio", usd(r.avg)),
      kpi("Valor hoy", usd(r.value)),
      kpi("Ganancia", `${usd(r.pnl)}`, pct(r.pnlPct), tone(r.pnl)),
    ]),
    el("div", { className: "inv-target" }, [
      el("span", { text: "Objetivo en la cartera:" }),
      el("button", { type: "button", className: "ghost inv-mini", text: a.targetPct != null ? a.targetPct + " %" : "definir", onclick: () => targetDialog(a) }),
      r.weight != null ? el("span", { className: "hint", text: `hoy ${r.weight.toFixed(1)} %` }) : null,
    ]),
    el("h3", { text: "Compras y ventas" }),
    txRows.length ? el("div", { className: "inv-txs" }, [
      el("div", { className: "inv-tx is-head" }, ["Fecha", "", "Cantidad", "Precio", "Total", "Desde la compra", ""].map((t) => el("span", { text: t }))),
      ...txRows,
    ]) : el("p", { className: "empty", text: "Sin compras todavía." }),
    el("h3", { text: "Compras planeadas" }),
    planRows.length ? el("div", { className: "inv-plans" }, planRows) : el("p", { className: "hint", text: "Anotá acá lo que pensás comprar (monto y precio objetivo)." }),
    el("div", { className: "row-actions" }, [
      el("button", { type: "button", className: "ghost", text: "+ Compra de " + a.symbol, onclick: () => txDialog(p, "BUY", null, { assetId: a.id }) }),
      el("button", { type: "button", className: "ghost", text: "+ Plan", onclick: () => planDialog(p, null, a.id) }),
      el("button", { type: "button", className: "btn-danger-ghost", text: "Quitar activo", onclick: () => removeFlow(a, `${a.name} y todas sus compras`) }),
    ]),
  ]);
  function iconBtn(label, d, fn, danger = false) {
    const ns = "http://www.w3.org/2000/svg", s = document.createElementNS(ns, "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "1.8");
    const path = document.createElementNS(ns, "path"); path.setAttribute("d", d); s.append(path);
    return el("button", { type: "button", className: "icon-btn" + (danger ? " is-danger" : ""), title: label, "aria-label": label, onclick: fn }, [s]);
  }
}

// ---------- diálogos ----------
function dialog(title, nodes, onSave, saveText = "Guardar") {
  const err = el("p", { className: "err", role: "alert" });
  const save = el("button", { type: "button", text: saveText });
  const cancel = el("button", { type: "button", className: "ghost", text: "Cancelar" });
  const d = el("dialog", { className: "rgm-dialog" }, [el("h2", { text: title }), ...nodes, err, el("div", { className: "row-actions" }, [cancel, save])]);
  const close = () => { try { d.close(); } catch (_) { /* */ } d.remove(); };
  cancel.addEventListener("click", close);
  d.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  save.addEventListener("click", async () => {
    err.textContent = ""; save.disabled = true;
    try { await onSave(); close(); refresh(); } catch (e) { err.textContent = e.message; save.disabled = false; }
  });
  document.body.append(d); d.showModal();
  d.querySelector("input:not([type=hidden]), select")?.focus();
}

function assetSelect(p, value) {
  const s = el("select", { className: "input", name: "assetId" }, p.rows.map((r) => el("option", { value: r.asset.id, text: `${r.asset.name} (${r.asset.symbol})` })));
  if (value) s.value = value;
  return s;
}

function txDialog(p, side, current = null, prefill = {}) {
  if (side === "SELL" && !current && !p.rows.some((r) => r.qty > 0)) { toast("Todavía no tenés nada para vender."); return; }
  const asset = assetSelect(p, current?.assetId || prefill.assetId);
  const date = el("input", { className: "input", type: "date", name: "date", value: current?.date || today() });
  const qty = el("input", { className: "input", name: "qty", inputmode: "decimal", placeholder: "Ej.: 0,025 o 10", value: current?.qty ?? prefill.qty ?? "" });
  const price = el("input", { className: "input", name: "price", inputmode: "decimal", placeholder: "Precio por unidad en US$", value: current?.price ?? prefill.price ?? "" });
  const fee = el("input", { className: "input", name: "fee", inputmode: "decimal", placeholder: "0", value: current?.fee ?? "" });
  const note = el("input", { className: "input", name: "note", placeholder: "Exchange, broker, motivo…", value: current?.note || "" });
  const total = el("p", { className: "hint inv-total", text: "" });
  const paint = () => {
    const q = Number(String(qty.value).replace(",", ".")), pr = Number(String(price.value).replace(",", ".")), f = Number(String(fee.value || 0).replace(",", "."));
    total.textContent = q > 0 && pr > 0 ? `Total: ${usd(q * pr + (side === "BUY" ? f : -f))}` : "";
  };
  [qty, price, fee].forEach((i) => i.addEventListener("input", paint)); paint();
  dialog(side === "BUY" ? (current ? "Editar compra" : "Nueva compra") : (current ? "Editar venta" : "Nueva venta"), [
    field("Activo", asset), field("Fecha", date), field("Cantidad", qty), field("Precio por unidad (US$)", price),
    field("Comisión (US$, opcional)", fee), field("Nota (opcional)", note), total,
  ], async () => {
    await saveTx({ assetId: asset.value, side, date: date.value, qty: qty.value, price: price.value, fee: fee.value, note: note.value }, current?.id || null);
    if (prefill.fromPlan) await removeRecord(prefill.fromPlan.id);
    toast(side === "BUY" ? "Compra guardada." : "Venta guardada.", { tone: "ok", timeout: 2500 });
  });
}

function planDialog(p, current = null, assetId = null) {
  const asset = assetSelect(p, current?.assetId || assetId);
  const amount = el("input", { className: "input", name: "amount", inputmode: "decimal", placeholder: "Ej.: 500", value: current?.amount ?? "" });
  const target = el("input", { className: "input", name: "targetPrice", inputmode: "decimal", placeholder: "Ej.: 85000", value: current?.targetPrice ?? "" });
  const note = el("input", { className: "input", name: "note", placeholder: "Ej.: compra mensual, si hay corrección…", value: current?.note || "" });
  dialog(current ? "Editar plan" : "Plan de compra", [
    field("Activo", asset), field("Monto a invertir (US$, opcional)", amount), field("Comprar si llega a (US$, opcional)", target), field("Nota", note),
  ], async () => { await savePlan({ assetId: asset.value, amount: amount.value, targetPrice: target.value, note: note.value }, current?.id || null); toast("Plan guardado.", { tone: "ok", timeout: 2000 }); });
}

function priceDialog(a) {
  const price = el("input", { className: "input", name: "price", inputmode: "decimal", placeholder: "Precio actual en US$", value: a.lastPrice ?? "" });
  dialog(`Precio de ${a.name} hoy`, [
    el("p", { className: "hint", text: a.type === "STOCK" ? `Buscalo como ${a.symbol} en tu broker, TradingView o Google y escribilo acá.` : "Escribí el precio actual." }),
    field("Precio (US$)", price),
  ], async () => { await updateAsset(a.id, { lastPrice: price.value, source: "manual" }); });
}

function targetDialog(a) {
  const t = el("input", { className: "input", name: "target", inputmode: "decimal", placeholder: "Ej.: 60", value: a.targetPct ?? "" });
  dialog(`Objetivo de ${a.symbol} en la cartera`, [el("p", { className: "hint", text: "Qué % de tu cartera querés que sea este activo. Dejalo vacío para no usar objetivo." }), field("Objetivo (%)", t)],
    async () => { await updateAsset(a.id, { targetPct: t.value }); });
}

function assetDialog() {
  const symbol = el("input", { className: "input", name: "symbol", placeholder: "Ej.: ETH, NVDA, VOO" });
  const name = el("input", { className: "input", name: "name", placeholder: "Ej.: Ethereum" });
  const type = el("select", { className: "input", name: "type" }, [["STOCK", "Acción / ETF (precio a mano)"], ["CRYPTO", "Cripto"]].map(([v, t]) => el("option", { value: v, text: t })));
  const cg = el("input", { className: "input", name: "cg", placeholder: "Ej.: ethereum (opcional)" });
  dialog("Agregar activo", [field("Símbolo", symbol), field("Nombre", name), field("Tipo", type),
    field("Precio automático (id de CoinGecko, solo cripto)", cg)], async () => {
    await addAsset({ symbol: symbol.value, name: name.value, type: type.value, priceSource: type.value === "CRYPTO" && cg.value.trim() ? "coingecko:" + cg.value.trim().toLowerCase() : "manual" });
  }, "Agregar");
}

async function removeFlow(rec, what) {
  const ok = await confirmDialog({ title: "¿Borrar?", body: [`Vas a borrar ${what}. Tenés unos segundos para deshacerlo.`], confirmText: "Sí, borrar", danger: true });
  if (!ok) return;
  const removed = await removeRecord(rec.id);
  refresh();
  toast("Borrado.", { actionText: "Deshacer", timeout: 8000, onAction: async () => { await restoreRecords(removed); refresh(); } });
}

async function exportXlsx(p) {
  const all = await listInvestments();
  const bySym = Object.fromEntries(p.rows.map((r) => [r.asset.id, r]));
  const txs = all.filter((r) => r.kind === "TX").sort((a, b) => a.date.localeCompare(b.date));
  const [y, m, d] = today().split("-");
  const head = ["Fecha", "Activo", "Tipo", "Cantidad", "Precio (US$)", "Comisión", "Total (US$)", "Precio hoy", "Cambio desde la compra", "Nota"];
  const rows = [head.map((v) => ({ v, s: XS.HEADER }))];
  for (const t of txs) {
    const r = bySym[t.assetId]; if (!r) continue;
    const ch = r.price != null && t.side === "BUY" ? (r.price / t.price - 1) : null;
    const [ty, tm, td] = t.date.split("-").map(Number);
    rows.push([{ v: Date.UTC(ty, tm - 1, td) / 86400000 + 25569, s: XS.DATE }, r.asset.symbol, t.side === "BUY" ? "Compra" : "Venta",
      { v: t.qty, s: XS.DEFAULT }, { v: t.price, s: XS.MONEY }, { v: t.fee || 0, s: XS.MONEY }, { v: t.qty * t.price + (t.side === "BUY" ? 1 : -1) * (t.fee || 0), s: XS.MONEY },
      r.price != null ? { v: r.price, s: XS.MONEY } : null, ch != null ? { v: (ch * 100).toFixed(1) + " %", s: ch >= 0 ? XS.WIN : XS.LOSS } : null, t.note || ""]);
  }
  const summary = [[{ v: "RGM · Inversiones", s: XS.TITLE }], [`Al ${d}/${m}/${y} · en US$`], [],
    ["Activo", "Cantidad", "Precio promedio", "Precio hoy", "Valor", "Costo", "Ganancia", "Rendimiento", "% cartera"].map((v) => ({ v, s: XS.HEADER })),
    ...p.rows.map((r) => [r.asset.symbol, r.qty, r.avg != null ? { v: r.avg, s: XS.MONEY } : null, r.price != null ? { v: r.price, s: XS.MONEY } : null,
      r.value != null ? { v: r.value, s: XS.MONEY } : null, { v: r.cost, s: XS.MONEY }, r.pnl != null ? { v: r.pnl, s: XS.MONEY } : null,
      r.pnlPct != null ? { v: r.pnlPct.toFixed(1) + " %", s: r.pnlPct >= 0 ? XS.WIN : XS.LOSS } : null, r.weight != null ? r.weight.toFixed(1) + " %" : null]),
    [], [{ v: "Total", s: XS.LABEL }, null, null, null, p.totalValue != null ? { v: p.totalValue, s: XS.MONEY } : null, { v: p.totalCost, s: XS.MONEY }, p.pnl != null ? { v: p.pnl, s: XS.MONEY } : null, p.pnlPct != null ? p.pnlPct.toFixed(1) + " %" : null]];
  const blob = buildXlsx([{ name: "Resumen", rows: summary, widths: [16, 14, 16, 14, 16, 16, 16, 13, 11] }, { name: "Compras y ventas", rows, widths: [12, 9, 9, 13, 14, 11, 15, 14, 20, 30], freeze: 1, filter: true }]);
  const a = el("a", { href: URL.createObjectURL(blob), download: `RGM-inversiones-${today()}.xlsx` });
  document.body.append(a); a.click(); a.remove();
  toast("Excel descargado.", { tone: "ok", timeout: 2500 });
}
