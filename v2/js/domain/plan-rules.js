// Reglas del trading plan aplicadas al día: ideas, pérdidas, stop/techo diario, stop semanal y señales de "no apta".
// Las reglas viven en meta.planRules (se incluyen en el respaldo). Sin reglas cargadas, no se evalúa nada.
import { getMeta, putMeta } from "../storage/repos/meta.js";
import { listStageTrades } from "./trade.js";
import { listStageAccounts } from "./account.js";
import { isTestRecord } from "./test-record.js";
import { listChallengePayouts } from "./payout.js";

export const SIGNALS = [
  ["MOVED_SL", "Moví el stop"],
  ["REVENGE", "Quiero entrar para recuperar una pérdida"],
  ["SKIPPED_ROUTINE", "Me salteé la rutina por ansiedad"],
  ["PNL_WATCH", "Miro el P&L más que el gráfico"],
];
const SIGNAL_KEYS = new Set(SIGNALS.map(([k]) => k));
const IDEA_WINDOW_MS = 10 * 60 * 1000;

const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const num = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const pos = (v) => { const n = num(v); return n == null ? null : Math.abs(n); };

/** Limpia reglas: números positivos o null (regla apagada). */
export function normalizeRules(input = {}) {
  const prop = input.prop || {}, own = input.own || {}, funded = input.funded || {};
  const ladder = [].concat(funded.ladder || []).map(pos).filter((v) => v != null && v > 0).slice(0, 6);
  return {
    maxIdeas: pos(input.maxIdeas), maxLosses: pos(input.maxLosses), signalsLimit: pos(input.signalsLimit),
    prop: { risk: pos(prop.risk), dailyStop: pos(prop.dailyStop), dailyCap: pos(prop.dailyCap), weeklyStop: pos(prop.weeklyStop) },
    own: { risk: pos(own.risk), dailyStop: pos(own.dailyStop) },
    funded: { ladder, dropAfter: pos(funded.dropAfter) },
  };
}

export function hasRules(r) {
  if (!r) return false;
  const vals = [r.maxIdeas, r.maxLosses, r.signalsLimit, ...Object.values(r.prop), ...Object.values(r.own), r.funded.dropAfter];
  return vals.some((v) => v != null) || r.funded.ladder.length > 0;
}

export async function getPlanRules() {
  const meta = (await getMeta()) || {};
  return meta.planRules ? normalizeRules(meta.planRules) : null;
}

export async function savePlanRules(input) {
  const meta = (await getMeta()) || {};
  const rules = normalizeRules(input);
  await putMeta({ ...meta, planRules: hasRules(rules) ? rules : null });
  return rules;
}

export async function getDaySignals(day = ymd(new Date())) {
  const meta = (await getMeta()) || {};
  return ((meta.mindSignals || {})[day] || []).filter((k) => SIGNAL_KEYS.has(k));
}

export async function setDaySignal(key, on, day = ymd(new Date())) {
  if (!SIGNAL_KEYS.has(key)) throw new Error("Señal desconocida");
  const meta = (await getMeta()) || {};
  const all = { ...(meta.mindSignals || {}) };
  const set = new Set(all[day] || []);
  if (on) set.add(key); else set.delete(key);
  all[day] = [...set];
  // Guarda solo los últimos 90 días.
  const cutoff = ymd(new Date(Date.now() - 90 * 864e5));
  for (const d of Object.keys(all)) if (d < cutoff || !all[d].length) delete all[d];
  await putMeta({ ...meta, mindSignals: all });
  return all[day] || [];
}

/** Agrupa el activo: MNQ/NQ/NAS100/US100 = NASDAQ, GC/MGC/XAUUSD = ORO, etc. */
export function assetFamily(asset) {
  const a = String(asset || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^M?NQ|NAS|US100|USTEC|NDX/.test(a)) return "NASDAQ";
  if (/^M?GC|XAU|GOLD/.test(a)) return "ORO";
  if (/^M?ES|SPX|SP500|US500/.test(a)) return "SP500";
  if (/^M?CL|WTI|USOIL|OIL/.test(a)) return "PETROLEO";
  if (/DAX|GER|DE40|FDAX/.test(a)) return "DAX";
  return a || "?";
}

const tradeTime = (t) => new Date(t.openedAt || t.createdAt || 0).getTime();
const pnlOf = (t) => num(t.netPnl);

/** Junta en una "idea" las entradas del mismo mercado y dirección dentro de 10 minutos (aunque sean de distintas cuentas). */
export function groupIdeas(trades) {
  const sorted = trades.slice().sort((a, b) => tradeTime(a) - tradeTime(b));
  const ideas = [];
  for (const t of sorted) {
    const fam = assetFamily(t.asset), dir = t.direction || "";
    const idea = ideas.find((i) => i.family === fam && i.direction === dir && tradeTime(t) - i.lastAt <= IDEA_WINDOW_MS);
    if (idea) { idea.trades.push(t); idea.lastAt = tradeTime(t); } else ideas.push({ family: fam, direction: dir, lastAt: tradeTime(t), trades: [t] });
  }
  for (const i of ideas) {
    const pnls = i.trades.map(pnlOf).filter((v) => v != null);
    i.pnl = pnls.length ? pnls.reduce((s, v) => s + v, 0) : null;
    const closed = i.trades.every((t) => t.lifecycle === "CLOSED");
    const losses = i.trades.filter((t) => t.result === "LOSS").length, wins = i.trades.filter((t) => t.result === "WIN").length;
    i.isLoss = closed && (i.pnl != null ? i.pnl < 0 : losses > wins);
  }
  return ideas;
}

const isProp = (acc) => acc && (acc.context === "PROP_CHALLENGE" || acc.context === "FUNDED");
const isOwn = (acc) => acc && acc.context === "LIVE";

/**
 * Evalúa el día. Pura: recibe trades reales ya filtrados, cuentas, reglas y señales.
 * Devuelve { ideas, losses, accounts:[{account, day, week, checks}], checks, stops, closed }.
 */
export function evaluateDay({ trades, accounts, rules, signals = [], now = new Date(), payoutsByChallenge = {} }) {
  const today = ymd(now);
  const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const dayTrades = trades.filter((t) => ymd(new Date(tradeTime(t))) === today);
  const weekTrades = trades.filter((t) => tradeTime(t) >= monday.getTime() && tradeTime(t) <= now.getTime() + 864e5);
  const ideas = groupIdeas(dayTrades);
  const losses = ideas.filter((i) => i.isLoss).length;
  const checks = [];
  const add = (label, value, limit, state, why) => checks.push({ label, value, limit, state, why });
  const level = (v, lim) => (lim == null ? "off" : v >= lim ? "stop" : v >= lim - 1 && lim > 1 ? "warn" : "ok");

  if (rules.maxIdeas != null) add("Ideas", ideas.length, rules.maxIdeas, level(ideas.length, rules.maxIdeas), `Llegaste a ${rules.maxIdeas} ideas: por hoy no hay más trades.`);
  if (rules.maxLosses != null) add("Pérdidas", losses, rules.maxLosses, level(losses, rules.maxLosses), `${rules.maxLosses} ideas perdedoras: se cierra el gráfico.`);
  if (rules.signalsLimit != null) add("Señales", signals.length, rules.signalsLimit, level(signals.length, rules.signalsLimit), `${signals.length} señales de que no estás apta: cerrá el gráfico.`);

  const accRows = [];
  for (const acc of accounts) {
    const sum = (list) => list.filter((t) => t.accountId === acc.id).map(pnlOf).filter((v) => v != null).reduce((s, v) => s + v, 0);
    const day = sum(dayTrades), week = sum(weekTrades);
    const rows = [];
    let risk = null, riskNote = "";
    if (isProp(acc)) {
      const p = rules.prop;
      risk = p.risk;
      if (acc.context === "FUNDED" && rules.funded.ladder.length) {
        const paid = (payoutsByChallenge[acc.challengeId] || 0);
        const step = Math.min(paid, rules.funded.ladder.length - 1);
        risk = rules.funded.ladder[step];
        riskNote = `escalón ${step + 1}` + (rules.funded.dropAfter ? ` · si caés $${rules.funded.dropAfter} desde tu máximo, bajá uno` : "");
      }
      if (p.dailyStop != null) rows.push({ label: "Stop diario", value: day, limit: -p.dailyStop, state: day <= -p.dailyStop ? "stop" : day <= -p.dailyStop * 0.5 ? "warn" : "ok", why: `${acc.name}: tocaste el stop diario (−$${p.dailyStop}).` });
      if (p.dailyCap != null) rows.push({ label: "Techo diario", value: day, limit: p.dailyCap, state: day >= p.dailyCap ? "stop" : day >= p.dailyCap * 0.8 ? "warn" : "ok", why: `${acc.name}: llegaste al techo (+$${p.dailyCap}). Terminaste el día.` });
      if (p.weeklyStop != null) rows.push({ label: "Stop semanal", value: week, limit: -p.weeklyStop, state: week <= -p.weeklyStop ? "stop" : week <= -p.weeklyStop * 0.5 ? "warn" : "ok", why: `${acc.name}: stop semanal (−$${p.weeklyStop}). El resto de la semana, solo backtest.` });
    } else if (isOwn(acc)) {
      risk = rules.own.risk;
      if (rules.own.dailyStop != null) rows.push({ label: "Stop diario", value: day, limit: -rules.own.dailyStop, state: day <= -rules.own.dailyStop ? "stop" : day <= -rules.own.dailyStop * 0.5 ? "warn" : "ok", why: `${acc.name}: tocaste el stop diario (−$${rules.own.dailyStop}).` });
    } else continue;
    accRows.push({ account: acc, day, week, risk, riskNote, checks: rows });
  }
  const stops = [...checks, ...accRows.flatMap((a) => a.checks)].filter((c) => c.state === "stop").map((c) => c.why);
  return { today, ideas, losses, checks, accounts: accRows, stops, closed: stops.length > 0 };
}

/** Carga todo y evalúa el día de hoy para la etapa. Devuelve null si no hay reglas. */
export async function loadDayStatus(stageId, now = new Date()) {
  const rules = await getPlanRules();
  if (!rules) return null;
  const [all, accounts, manual] = await Promise.all([
    listStageTrades(stageId, { includeVoid: false }),
    listStageAccounts(stageId),
    getDaySignals(ymd(now)),
  ]);
  const trades = all.filter((t) => t.context !== "BACKTEST" && t.isDraft !== true && !isTestRecord(t));
  const today = ymd(now);
  // Señales que salen solas de lo cargado en los trades de hoy.
  const auto = new Set();
  for (const t of trades) {
    if (ymd(new Date(tradeTime(t))) !== today || !t.process) continue;
    if ((t.process.errors || []).includes("MOVED_SL")) auto.add("MOVED_SL");
    if (t.process.emotion === "REVENGE") auto.add("REVENGE");
  }
  const signals = [...new Set([...manual, ...auto])];
  const payoutsByChallenge = {};
  for (const acc of accounts) {
    if (acc.context === "FUNDED" && acc.challengeId && !(acc.challengeId in payoutsByChallenge)) {
      try { payoutsByChallenge[acc.challengeId] = (await listChallengePayouts(acc.challengeId)).filter((p) => !p.voidedAt).length; } catch { payoutsByChallenge[acc.challengeId] = 0; }
    }
  }
  return { rules, manual, auto: [...auto], signals, ...evaluateDay({ trades, accounts, rules, signals, now, payoutsByChallenge }) };
}
