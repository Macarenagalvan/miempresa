import './test-safety.js';
import { prepDay, savePrep, getPrep, getAllPrep } from "../js/domain/day-prep.js";
import { resultCharts } from "../js/ui/journal-insights.js";
import { buildExportPayload } from "../js/services/backup.js";
export async function run() {
  let n = 0; const check = (ok, m) => { if (!ok) throw new Error(m); n++; };
  check(prepDay(new Date(2026, 10, 18, 21, 0)) === "2026-11-19", "a la noche prepara mañana");
  check(prepDay(new Date(2026, 10, 19, 7, 30)) === "2026-11-19", "a la mañana es hoy");
  await savePrep("2026-11-19", { yoga: true, bias: "BULL" });
  await savePrep("2026-11-19", { meditation: true, bias: "NOPE" });
  const r = await getPrep("2026-11-19");
  check(r.yoga && r.meditation && r.bias === "", "guarda y limpia");
  await savePrep("2026-11-20", { yoga: false, meditation: false, levels: true });
  check(Object.keys(await getAllPrep()).length >= 2, "varios días");
  check((await buildExportPayload()).meta.dayPrep["2026-11-19"].yoga === true, "entra en el respaldo");
  const mk = (day, pnl, res) => ({ openedAt: new Date(`${day}T10:00:00`).toISOString(), closedAt: new Date(`${day}T10:30:00`).toISOString(), lifecycle: "CLOSED", netPnl: pnl, result: res, context: "PROP_CHALLENGE" });
  const node = resultCharts([mk("2026-11-19", 150, "WIN"), mk("2026-11-20", -75, "LOSS")], {}, "USD", await getAllPrep());
  check(node.textContent.includes("Días con yoga") && node.textContent.includes("Con yoga") && node.textContent.includes("Sin yoga"), "estadística por yoga");
  check(node.textContent.includes("Medité") && node.textContent.includes("No medité"), "estadística por meditación");
  await savePrep("2026-11-19", { yoga: false, meditation: false }); await savePrep("2026-11-20", { levels: false });
  check(!(await getAllPrep())["2026-11-20"], "día vacío se borra");
  document.getElementById("out").textContent += `\nRGM preparación: ${n} tests OK\n`;
}
