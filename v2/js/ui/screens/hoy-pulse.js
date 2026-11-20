// Portada de "Hoy": saludo RGM, registro en un toque, semana y racha.
import { el } from "../render.js";
import { go } from "../router.js";
import { greetingLine, longDate } from "../identity.js";
import { listStageTrades } from "../../domain/trade.js";
import { listActiveObservations } from "../../domain/observation.js";
import { realizedR } from "../../domain/stats.js";
import { isTestRecord } from "../../domain/test-record.js";
import { getMeta } from "../../storage/repos/meta.js";
import { downloadExport } from "../../services/backup.js";
import { buildWeeklyReview, mondayOf } from "../../services/weekly-review.js";
import { toast } from "../feedback.js";

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOf = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : ymd(d); };

function quickCard(title, line, route, tone) {
  return el("button", { type: "button", className: "pulse-action " + tone, onclick: () => go(route) }, [
    el("strong", { text: title }), el("span", { text: line }),
  ]);
}

export async function hoyPulse(ctx) {
  const trades = (await listStageTrades(ctx.stage.id, { includeVoid: false })).filter((t) => !isTestRecord(t));
  const studies = (await listActiveObservations(ctx.stage.id)).filter((o) => o.studyOutcome && !isTestRecord(o));
  const records = [
    ...trades.map((t) => ({ kind: t.context === "BACKTEST" ? "bt" : "trade", day: dayOf(t.context === "BACKTEST" ? t.createdAt : (t.openedAt || t.createdAt)), t })),
    ...studies.map((o) => ({ kind: "nt", day: dayOf(o.createdAt), o })),
  ].filter((r) => r.day);
  const byDay = new Map();
  for (const r of records) byDay.set(r.day, (byDay.get(r.day) || 0) + 1);

  // Racha: días seguidos con al menos un registro (si hoy todavía no, cuenta desde ayer).
  const today = new Date();
  let cursor = new Date(today);
  if (!byDay.has(ymd(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (byDay.has(ymd(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
  const doneToday = byDay.has(ymd(today));

  // Semana actual (lunes a domingo)
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
  const weekDays = new Set(week.map(ymd));
  const inWeek = records.filter((r) => weekDays.has(r.day));
  const count = (k) => inWeek.filter((r) => r.kind === k).length;
  const weekR = inWeek.filter((r) => r.kind === "bt").map((r) => realizedR(r.t)).filter((v) => v != null && Number.isFinite(Number(v)));
  const sumR = weekR.reduce((s, v) => s + Number(v), 0);
  const letters = ["L", "M", "M", "J", "V", "S", "D"];
  const strip = el("div", { className: "pulse-week", "aria-label": "Registros de esta semana" }, week.map((d, i) => {
    const n = byDay.get(ymd(d)) || 0;
    const isToday = ymd(d) === ymd(today);
    const future = d > today && !isToday;
    return el("div", { className: "pulse-day" + (n ? " is-done" : "") + (isToday ? " is-today" : "") + (future ? " is-future" : ""), title: n ? `${n} registro${n === 1 ? "" : "s"}` : "Sin registros" }, [
      el("span", { className: "pulse-day-letter", text: letters[i] }),
      el("span", { className: "pulse-dot", text: n ? String(n) : "" }),
    ]);
  }));

  const latest = records.slice().sort((a, b) => String((b.t || b.o).createdAt).localeCompare(String((a.t || a.o).createdAt))).slice(0, 5);
  const latestList = latest.length
    ? el("div", { className: "pulse-latest" }, latest.map((r) => {
      const item = r.t || r.o;
      const result = r.kind === "nt" ? "NO TRADE" : (item.result || (item.isDraft ? "Borrador" : item.lifecycle === "OPEN" ? "Abierta" : "—"));
      const rv = r.t && r.t.lifecycle === "CLOSED" ? realizedR(r.t) : null;
      const tone = result === "WIN" ? "is-win" : result === "LOSS" ? "is-loss" : result === "BE" ? "is-be" : "";
      return el("button", { type: "button", className: "pulse-row", onclick: () => go(r.t ? "trade/" + item.id : "observacion/" + item.id) }, [
        el("span", { className: "pulse-kind", text: r.kind === "bt" ? "Backtest" : r.kind === "nt" ? "Estudio" : "Trade" }),
        el("strong", { text: item.asset || "—" }),
        el("span", { text: item.direction || item.bias || "" }),
        el("span", { className: "pulse-res " + tone, text: result }),
        el("span", { className: "pulse-r num", text: rv == null ? "" : (rv > 0 ? "+" : "") + Number(rv).toFixed(2) + "R" }),
      ]);
    }))
    : el("p", { className: "empty", text: "Todavía no hay registros. El primero es el más importante." });

  const message = doneToday
    ? "Hoy ya registraste. Así se construye el sistema."
    : streak
      ? `Llevás ${streak} día${streak === 1 ? "" : "s"} seguidos. Registrá algo hoy para no cortar la racha.`
      : "Un registro hoy, aunque sea un NO TRADE, ya cuenta.";

  // Respaldo: los datos viven en este navegador. Recordatorio cada 7 días.
  const meta = await getMeta();
  const lastBackup = meta?.lastBackupAt ? Date.parse(meta.lastBackupAt) : NaN;
  const days = Number.isFinite(lastBackup) ? Math.floor((Date.now() - lastBackup) / 86400000) : null;
  const backupBanner = records.length && (days == null || days >= 7) ? el("div", { className: "pulse-backup", role: "status" }, [
    el("span", { text: days == null
      ? "Tus registros viven solo en este navegador y todavía no tenés un respaldo. Bajalo ahora: es un archivo y lo podés restaurar en Configuración."
      : `Hace ${days} días que no guardás un respaldo. Bajalo ahora para no arriesgar tus registros.` }),
    el("button", { type: "button", text: "Descargar respaldo", onclick: async (e) => {
      e.currentTarget.disabled = true;
      try { await downloadExport(); toast("Respaldo descargado. Guardalo en una carpeta segura (Drive, OneDrive…).", { tone: "ok", timeout: 5000 }); window.dispatchEvent(new HashChangeEvent("hashchange")); }
      catch (err) { toast("No se pudo descargar: " + err.message, { tone: "error" }); e.currentTarget.disabled = false; }
    } }),
  ]) : null;

  const reviewBtn = el("button", { type: "button", className: "pulse-review", onclick: () => openWeeklyReview(ctx) }, [
    el("strong", { text: "Revisión semanal" }),
    el("span", { text: today.getDay() === 0 || today.getDay() === 1 ? "Es buen momento: cerrá la semana" : "Resumen para que te lo explique la IA" }),
  ]);

  return el("section", { className: "panel pulse" }, [
    el("div", { className: "pulse-head" }, [
      el("div", {}, [
        el("p", { className: "pulse-date", text: longDate() }),
        el("h1", { className: "pulse-hello", text: greetingLine(ctx.meta) }),
      ]),
      el("div", { className: "pulse-streak" + (doneToday ? " is-lit" : "") }, [
        el("strong", { text: String(streak) }),
        el("span", { text: streak === 1 ? "día seguido" : "días seguidos" }),
      ]),
    ]),
    el("p", { className: "pulse-message", text: message }),
    backupBanner,
    el("div", { className: "pulse-actions" }, [
      quickCard("+ Trade", "Operación real o demo", "nuevo/trade", "is-gold"),
      quickCard("+ Backtest", "WIN / LOSS / BE en segundos", "backtesting?quick=bt", ""),
      quickCard("No trade", "Estudié y no había entrada", "backtesting?quick=nt", ""),
    ]),
    el("div", { className: "pulse-grid" }, [
      el("div", { className: "pulse-box" }, [
        el("h2", { text: "Esta semana" }),
        strip,
        el("div", { className: "pulse-counts" }, [
          el("div", {}, [el("strong", { text: String(count("trade")) }), el("span", { text: "trades" })]),
          el("div", {}, [el("strong", { text: String(count("bt")) }), el("span", { text: "backtests" })]),
          el("div", {}, [el("strong", { text: String(count("nt")) }), el("span", { text: "no trade" })]),
          el("div", {}, [el("strong", { className: sumR > 0 ? "is-win" : sumR < 0 ? "is-loss" : "", text: weekR.length ? (sumR > 0 ? "+" : "") + sumR.toFixed(1) + "R" : "—" }), el("span", { text: "R backtests" })]),
        ]),
      ]),
      el("div", { className: "pulse-box" }, [
        el("h2", { text: "Últimos registros" }),
        latestList,
        reviewBtn,
      ]),
    ]),
  ]);
}

async function openWeeklyReview(ctx) {
  let monday = mondayOf();
  const lastMonday = new Date(monday); lastMonday.setDate(lastMonday.getDate() - 7);
  const today = new Date();
  // Domingo o lunes: por defecto la semana que se cierra.
  if (today.getDay() === 1) monday = lastMonday;
  const body = el("div", { className: "review-body" });
  const pick = el("div", { className: "chips", role: "group", "aria-label": "Semana" });
  const options = [["Esta semana", mondayOf()], ["Semana pasada", lastMonday]];
  let current = null;
  const err = el("p", { className: "err", role: "alert" });
  async function load(m) {
    err.textContent = "";
    try {
      current = await buildWeeklyReview(ctx.stage.id, m);
      const s = current.summary;
      [...pick.children].forEach((b) => { const on = b.dataset.t === String(m.getTime()); b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on)); });
      body.replaceChildren(
        el("p", { className: "hint", text: s.range }),
        el("div", { className: "review-kpis" }, [
          kpi(s.real.n, "trades", s.real.n ? `${s.real.w}G / ${s.real.l}P · ${s.real.rTotal == null ? "—" : (s.real.rTotal > 0 ? "+" : "") + s.real.rTotal.toFixed(1) + "R"}` : ""),
          kpi(s.bt.n, "backtests", s.bt.n ? `winrate ${s.bt.winrate}` : ""),
          kpi(s.noTrade, "no trade", ""),
          kpi(`${s.withProcess}/${s.total}`, "con proceso", s.total && s.withProcess < s.total ? "Completalo para un mejor análisis" : ""),
        ]),
        el("p", { className: "hint", text: "El archivo trae tus datos y un pedido listo para la IA: explicación en criollo, breve, separando resultado de proceso. Descargalo y subilo a Claude o ChatGPT, o copialo y pegalo directo en el chat." }),
      );
    } catch (e) { err.textContent = e.message; }
  }
  for (const [label, m] of options) {
    const b = el("button", { type: "button", className: "chip", text: label });
    b.dataset.t = String(m.getTime());
    b.addEventListener("click", () => load(m));
    pick.append(b);
  }
  const download = el("button", { type: "button", text: "Descargar archivo" });
  download.addEventListener("click", () => {
    if (!current) return;
    const blob = new Blob([current.markdown], { type: "text/markdown;charset=utf-8" });
    const a = el("a", { href: URL.createObjectURL(blob), download: current.filename });
    document.body.append(a); a.click(); a.remove();
    toast("Revisión descargada. Subila a Claude o ChatGPT.", { tone: "ok", timeout: 4000 });
  });
  const copy = el("button", { type: "button", className: "ghost", text: "Copiar para pegar en la IA" });
  copy.addEventListener("click", async () => {
    if (!current) return;
    try { await navigator.clipboard.writeText(current.markdown); toast("Copiado. Pegalo en Claude o ChatGPT.", { tone: "ok" }); }
    catch (_) { toast("No se pudo copiar. Usá Descargar archivo.", { tone: "error" }); }
  });
  const close = el("button", { type: "button", className: "ghost", text: "Cerrar" });
  const dialog = el("dialog", { className: "rgm-dialog is-wide review-dialog", "aria-labelledby": "review-title" }, [
    el("h2", { id: "review-title", text: "Revisión semanal" }), pick, body, err,
    el("div", { className: "row-actions" }, [close, copy, download]),
  ]);
  close.addEventListener("click", () => { dialog.close(); dialog.remove(); });
  dialog.addEventListener("cancel", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  await load(monday);
}

function kpi(value, label, note) {
  return el("div", { className: "review-kpi" }, [el("strong", { text: String(value) }), el("span", { text: label }), note ? el("small", { text: note }) : null]);
}
