// Revisión semanal: arma un archivo con los datos de la semana y un pedido para que una IA
// (Claude, ChatGPT) lo explique en criollo y breve. Nada se envía a ningún lado: se descarga o se copia.
import { listStageTrades } from "../domain/trade.js";
import { listActiveObservations } from "../domain/observation.js";
import { listStageAccounts } from "../domain/account.js";
import { realizedR } from "../domain/stats.js";
import { isTestRecord } from "../domain/test-record.js";
import { FAMILIES, CONFLUENCES, EMOTIONS, PLAN, ERRORS, labelOf } from "../domain/process.js";

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dmy = (s) => { const [y, m, d] = String(s).split("-"); return `${d}/${m}/${y}`; };
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export function mondayOf(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function fmtR(v) { return v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(2) + "R"; }
function pct(a, b) { return b ? Math.round((a / b) * 100) + " %" : "—"; }

function groupStats(rows) {
  const closed = rows.filter((r) => r.result);
  const w = closed.filter((r) => r.result === "WIN").length, l = closed.filter((r) => r.result === "LOSS").length, be = closed.filter((r) => r.result === "BE").length;
  const rs = closed.map((r) => r.r).filter((v) => v != null);
  const total = rs.reduce((s, v) => s + v, 0);
  return { n: rows.length, w, l, be, winrate: pct(w, w + l), rTotal: rs.length ? total : null, rAvg: rs.length ? total / rs.length : null, nR: rs.length };
}

function maxLossStreak(rows) {
  let best = 0, cur = 0;
  for (const r of rows) { if (r.result === "LOSS") { cur++; best = Math.max(best, cur); } else if (r.result) cur = 0; }
  return best;
}

function breakdown(title, rows, keyFn, list) {
  const groups = new Map();
  for (const r of rows) for (const k of [].concat(keyFn(r) || [])) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  if (!groups.size) return "";
  const lines = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, g]) => {
    const s = groupStats(g);
    return `| ${list ? labelOf(list, k) : k} | ${s.n} | ${s.w}/${s.l}/${s.be} | ${s.winrate} | ${fmtR(s.rTotal)} | ${fmtR(s.rAvg)} |`;
  });
  return `\n### ${title}\n| | Registros | G/P/BE | Winrate | R total | R promedio |\n|---|---|---|---|---|---|\n${lines.join("\n")}\n`;
}

/** Devuelve { markdown, summary, filename } de la semana que empieza en `monday`. */
export async function buildWeeklyReview(stageId, monday = mondayOf()) {
  const start = new Date(monday), end = new Date(monday); end.setDate(end.getDate() + 7);
  const inWeek = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) && t >= start.getTime() && t < end.getTime(); };
  const accounts = Object.fromEntries((await listStageAccounts(stageId, { includeArchived: true })).map((a) => [a.id, a]));
  const trades = (await listStageTrades(stageId, { includeVoid: false })).filter((t) => !isTestRecord(t) && !t.isDraft);
  const studies = (await listActiveObservations(stageId)).filter((o) => o.studyOutcome === "NO_TRADE" && !isTestRecord(o) && inWeek(o.createdAt));

  const toRow = (t) => {
    const when = t.context === "BACKTEST" ? t.createdAt : (t.openedAt || t.closedAt || t.createdAt);
    const d = new Date(when);
    return {
      t, kind: t.context === "BACKTEST" ? "Backtest" : "Trade", when, d,
      day: t.sourceRef?.sessionDate || ymd(d), result: t.lifecycle === "CLOSED" ? t.result : null,
      r: t.lifecycle === "CLOSED" && realizedR(t) != null ? Number(realizedR(t)) : null,
      net: t.netPnl, currency: accounts[t.accountId]?.currency || "", account: accounts[t.accountId]?.name || "",
      p: t.process || {},
    };
  };
  const real = trades.filter((t) => t.context !== "BACKTEST" && inWeek(t.openedAt || t.closedAt || t.createdAt)).map(toRow).sort((a, b) => a.when.localeCompare(b.when));
  const bts = trades.filter((t) => t.context === "BACKTEST" && inWeek(t.createdAt)).map(toRow).sort((a, b) => a.when.localeCompare(b.when));
  const all = [...real, ...bts];

  const sReal = groupStats(real), sBt = groupStats(bts);
  const netBy = {};
  for (const r of real) if (r.net != null && r.result) netBy[r.currency || "?"] = (netBy[r.currency || "?"] || 0) + Number(r.net);
  const late = real.filter((r) => r.t.openedAt && new Date(r.t.openedAt).getHours() >= 20);
  const withProcess = all.filter((r) => r.p && (r.p.plan || r.p.family || r.p.emotion || r.p.confluences?.length || r.p.errors?.length));
  const errorsCount = {};
  for (const r of all) for (const e of r.p.errors || []) errorsCount[e] = (errorsCount[e] || 0) + 1;
  const perDay = {};
  for (const r of real) perDay[ymd(r.d)] = (perDay[ymd(r.d)] || 0) + 1;
  const overtradeDays = Object.entries(perDay).filter(([, n]) => n > 2);

  const endShown = new Date(end); endShown.setDate(endShown.getDate() - 1);
  const range = `${dmy(ymd(start))} al ${dmy(ymd(endShown))}`;
  const md = [];
  md.push(`# RGM · Revisión semanal · ${range}`);
  md.push("");
  md.push("## Pedido para la IA");
  md.push("Sos mi coach de trading. Abajo está mi semana sacada de mi journal (RGM). Explicámela en español rioplatense, en criollo y BREVE (máximo 12 líneas):");
  md.push("1. Qué pasó en una frase.");
  md.push("2. Resultado vs. proceso por separado: una ganadora fuera de plan NO es buena ejecución; una perdedora siguiendo el plan puede estar bien.");
  md.push("3. El patrón más claro que veas (emociones, errores, horarios, tipo de setup), solo si los datos lo muestran.");
  md.push("4. Cerrá con 1 cosa para mantener y 1 cosa concreta para corregir la semana que viene.");
  md.push("Reglas: no inventes datos ni niveles; si la muestra es chica, decilo y no saques conclusiones fuertes; no me felicites por compromiso. Si falta info para opinar, escribí NO CONFIRMADO.");
  md.push("");
  md.push("## Resumen");
  md.push(`- **Trades reales/demo:** ${sReal.n} · G/P/BE ${sReal.w}/${sReal.l}/${sReal.be} · winrate ${sReal.winrate} · R total ${fmtR(sReal.rTotal)} · R promedio ${fmtR(sReal.rAvg)}`);
  md.push(`- **Neto:** ${Object.keys(netBy).length ? Object.entries(netBy).map(([c, v]) => `${v.toFixed(2)} ${c}`).join(" · ") : "—"}`);
  md.push(`- **Backtests cargados esta semana:** ${sBt.n} · G/P/BE ${sBt.w}/${sBt.l}/${sBt.be} · winrate ${sBt.winrate} · R total ${fmtR(sBt.rTotal)} · expectativa ${fmtR(sBt.rAvg)}`);
  md.push(`- **NO TRADE registrados:** ${studies.length}`);
  md.push(`- **Peor racha de pérdidas (trades):** ${maxLossStreak(real)}`);
  md.push(`- **Trades abiertos después de las 20:00 (regla personal):** ${late.length}`);
  md.push(`- **Días con más de 2 trades:** ${overtradeDays.length ? overtradeDays.map(([d, n]) => `${dmy(d)} (${n})`).join(", ") : "ninguno"}`);
  md.push(`- **Registros con proceso completado:** ${withProcess.length} de ${all.length}`);
  md.push("");
  md.push("## Proceso");
  md.push(breakdown("¿Seguí el plan? (trades y backtests)", all.filter((r) => r.p.plan), (r) => r.p.plan, PLAN) || "\nSin datos de plan esta semana.\n");
  md.push(breakdown("Cómo estaba al entrar (solo trades)", real.filter((r) => r.p.emotion), (r) => r.p.emotion, EMOTIONS));
  md.push(breakdown("Tipo de setup", all.filter((r) => r.p.family), (r) => r.p.family, FAMILIES));
  md.push(breakdown("Confluencias presentes", all.filter((r) => r.p.confluences?.length), (r) => r.p.confluences, CONFLUENCES));
  md.push(Object.keys(errorsCount).length ? `\n### Errores marcados\n${Object.entries(errorsCount).sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${labelOf(ERRORS, k)}: ${n}`).join("\n")}\n` : "\n### Errores marcados\nNinguno.\n");
  md.push("## Horarios (trades, hora de Italia)");
  md.push(breakdown("Por día de la semana", real, (r) => WEEKDAYS[r.d.getDay()]));
  md.push(breakdown("Por hora de entrada", real.filter((r) => r.t.openedAt), (r) => pad(r.d.getHours()) + ":00"));
  md.push("## Detalle");
  md.push("| Fecha | Tipo | Cuenta | Activo | Dir. | Resultado | R | Neto | Plan | Emoción | Setup | Errores | Notas |");
  md.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of all) {
    const note = String([r.t.note, r.t.management].filter(Boolean).join(" · ")).replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 140);
    const hour = r.kind === "Trade" && r.t.openedAt ? " " + pad(r.d.getHours()) + ":" + pad(r.d.getMinutes()) : "";
    md.push(`| ${dmy(r.day)}${hour} | ${r.kind} | ${r.account || "—"} | ${r.t.asset || "—"} | ${r.t.direction || "—"} | ${r.result || "abierta"} | ${r.r == null ? "—" : r.r.toFixed(2)} | ${r.net == null ? "—" : r.net + " " + r.currency} | ${r.p.plan ? labelOf(PLAN, r.p.plan) : "—"} | ${r.p.emotion ? labelOf(EMOTIONS, r.p.emotion) : "—"} | ${r.p.family ? labelOf(FAMILIES, r.p.family) : "—"} | ${(r.p.errors || []).map((e) => labelOf(ERRORS, e)).join(", ") || "—"} | ${note || "—"} |`);
  }
  for (const o of studies) md.push(`| ${dmy(o.date)} | NO TRADE | — | ${o.asset} | ${o.bias || "—"} | NO TRADE | — | — | — | — | — | — | ${String(o.note || "—").replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 140)} |`);
  if (!all.length && !studies.length) md.push("| — | Sin registros esta semana | | | | | | | | | | | |");
  md.push("");
  md.push("_Generado por RGM Trading Journal. Los R se calculan con precios, sin costes. Los backtests cuentan por la fecha en que se cargaron._");

  return {
    markdown: md.join("\n"),
    filename: `RGM-revision-semanal-${ymd(start)}.md`,
    summary: { range, real: sReal, bt: sBt, noTrade: studies.length, late: late.length, withProcess: withProcess.length, total: all.length },
  };
}
