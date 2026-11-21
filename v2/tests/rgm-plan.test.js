import './test-safety.js';
import { ensureJournalSeed } from "../js/domain/stage.js";
import { evaluateDay, groupIdeas, assetFamily, normalizeRules, savePlanRules, getPlanRules, setDaySignal, getDaySignals, loadDayStatus } from "../js/domain/plan-rules.js";
import { buildExportPayload } from "../js/services/backup.js";

export async function run() {
  let n = 0;
  const check = (ok, msg) => { if (!ok) throw new Error(msg); n++; };
  const now = new Date(2026, 10, 18, 16, 0); // miércoles
  const at = (h, m, d = 18) => new Date(2026, 10, d, h, m).toISOString();
  const rules = normalizeRules({ maxIdeas: 3, maxLosses: 2, signalsLimit: 2, prop: { risk: 100, dailyStop: 200, dailyCap: 500, weeklyStop: 400 }, own: { risk: 20, dailyStop: 40 }, funded: { ladder: ["75", 100, 125], dropAfter: 300 } });
  const accounts = [{ id: "a", name: "LFE2", context: "PROP_CHALLENGE" }, { id: "b", name: "LFE3", context: "PROP_CHALLENGE" }, { id: "v", name: "Vantage", context: "LIVE" }, { id: "f", name: "Fund", context: "FUNDED", challengeId: "c1" }];
  const tr = (accountId, asset, openedAt, netPnl, direction = "LONG") => ({ accountId, asset, openedAt, netPnl, direction, lifecycle: "CLOSED", result: netPnl > 0 ? "WIN" : netPnl < 0 ? "LOSS" : "BE" });

  check(assetFamily("MNQZ6") === "NASDAQ" && assetFamily("NAS100") === "NASDAQ" && assetFamily("MGCZ6") === "ORO" && assetFamily("XAUUSD") === "ORO", "familias de activos");
  // Mismo trade en 3 cuentas (MNQ y NAS100) dentro de 10 min = 1 idea
  const same = [tr("a", "MNQZ6", at(9, 30), -100), tr("b", "MNQZ6", at(9, 31), -100), tr("v", "NAS100", at(9, 38), -20)];
  check(groupIdeas(same).length === 1, "una idea en varias cuentas");
  let s = evaluateDay({ trades: same, accounts, rules, now });
  check(s.ideas.length === 1 && s.losses === 1 && !s.closed, "1 idea perdedora, día abierto");
  check(s.checks.find((c) => c.label === "Pérdidas").state === "warn", "aviso antes del límite");
  // Segunda idea perdedora → cierre
  const two = [...same, tr("a", "MNQZ6", at(11, 0), -100, "SHORT")];
  s = evaluateDay({ trades: two, accounts, rules, now });
  check(s.losses === 2 && s.closed, "2 pérdidas cierran el día");
  check(s.stops.some((w) => w.includes("LFE2") && w.includes("stop diario")), "stop diario de la cuenta (−200)");
  check(s.stops.some((w) => w.includes("Vantage")) === false, "Vantage −20 no toca su stop de −40");
  // Techo diario
  s = evaluateDay({ trades: [tr("a", "MNQZ6", at(9, 30), 520)], accounts, rules, now });
  check(s.closed && s.stops[0].includes("techo"), "techo +500 cierra el día");
  // Stop semanal con días anteriores; el lunes cuenta, la semana pasada no
  s = evaluateDay({ trades: [tr("b", "MNQZ6", at(10, 0, 16), -250), tr("b", "MNQZ6", at(10, 0, 17), -160), tr("b", "MNQZ6", at(10, 0, 13), -900)], accounts, rules, now });
  check(s.ideas.length === 0 && s.stops.length === 1 && s.stops[0].includes("semanal"), "stop semanal solo con esta semana");
  // Señales
  s = evaluateDay({ trades: [], accounts, rules, now, signals: ["MOVED_SL", "PNL_WATCH"] });
  check(s.closed && s.stops[0].includes("señales"), "2 señales cierran el día");
  // Escalera de fondeada
  s = evaluateDay({ trades: [], accounts, rules, now, payoutsByChallenge: { c1: 1 } });
  check(s.accounts.find((a) => a.account.id === "f").risk === 100, "escalón 2 tras 1 cobro");
  s = evaluateDay({ trades: [], accounts, rules, now, payoutsByChallenge: { c1: 5 } });
  check(s.accounts.find((a) => a.account.id === "f").risk === 125, "tope de la escalera");
  // Techos y stops semanales nuevos
  const r2 = normalizeRules({ prop: { weeklyStop: 400, weeklyCap: 750 }, funded: { weeklyStop: 300, weeklyCap: 500 }, own: { weeklyStopPct: 5, weeklyCapPct: 5 } });
  const acc2 = [{ id: "a", name: "CH", context: "PROP_CHALLENGE" }, { id: "f", name: "FD", context: "FUNDED" }, { id: "v", name: "VT", context: "LIVE", initialAmount: 600 }];
  s = evaluateDay({ trades: [tr("a", "MNQZ6", at(10, 0, 16), 760)], accounts: acc2, rules: r2, now });
  check(s.closed && s.stops[0].includes("techo semanal"), "techo semanal challenge +750");
  s = evaluateDay({ trades: [tr("f", "MNQZ6", at(10, 0, 16), 510)], accounts: acc2, rules: r2, now });
  check(s.closed && s.stops[0].includes("+$500"), "techo semanal de la fondeada");
  s = evaluateDay({ trades: [tr("f", "MNQZ6", at(10, 0, 16), -310)], accounts: acc2, rules: r2, now });
  check(s.closed && s.stops[0].includes("−$300"), "stop semanal de la fondeada");
  s = evaluateDay({ trades: [tr("v", "NAS100", at(10, 0, 16), 31)], accounts: acc2, rules: r2, now });
  check(s.closed && s.stops[0].includes("+5%"), "techo semanal Vantage en %");
  s = evaluateDay({ trades: [tr("v", "NAS100", at(10, 0, 16), -29)], accounts: acc2, rules: r2, now });
  check(!s.closed, "Vantage −29 no llega al −5% de 600");
  // Sin regla = apagada
  s = evaluateDay({ trades: two, accounts, rules: normalizeRules({}), now });
  check(!s.closed && s.checks.length === 0, "reglas vacías no evalúan");

  const seed = await ensureJournalSeed();
  await savePlanRules(rules);
  check((await getPlanRules()).prop.dailyCap === 500, "guarda reglas");
  await setDaySignal("REVENGE", true); await setDaySignal("PNL_WATCH", true); await setDaySignal("PNL_WATCH", false);
  check((await getDaySignals()).join() === "REVENGE", "señales del día");
  const live = await loadDayStatus(seed.stage.id);
  check(live && live.signals.includes("REVENGE"), "estado del día con señales");
  check((await buildExportPayload()).meta.planRules.maxIdeas === 3, "el respaldo incluye las reglas");
  await savePlanRules({});
  check((await getPlanRules()) === null, "vaciar reglas las apaga");
  await setDaySignal("REVENGE", false);
  document.getElementById("out").textContent += `\nRGM plan: ${n} tests OK\n`;
}
