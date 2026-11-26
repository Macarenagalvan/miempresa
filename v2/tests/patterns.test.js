import './test-safety.js';
import { importBacktest } from "../js/domain/backtest-import.js";
import { listTrades } from "../js/storage/repos/trades.js";
import { ensureJournalSeed } from "../js/domain/stage.js";
import { computePatterns, sampleLevel, NONE } from "../js/domain/patterns.js";

const assert = (ok, message) => { if (!ok) throw new Error(message); };

export async function run() {
  assert(sampleLevel(9) === "FEW" && sampleLevel(10) === "INDICATIVE" && sampleLevel(29) === "INDICATIVE" && sampleLevel(30) === "RELIABLE", "Niveles de muestra incorrectos");

  const { stage } = await ensureJournalSeed();
  const stamp = Date.now().toString(36);
  const asset = "PAT" + stamp.slice(-5).toUpperCase();
  // 12 trades Modelo A + CHOCH_FVG (9 ganadas a +2R, 3 perdidas a −1R) y 3 Modelo B (perdidas).
  const specs = [
    ...Array.from({ length: 9 }, () => ({ model: "A_REVERSAL", trigger: "CHOCH_FVG", win: true })),
    ...Array.from({ length: 3 }, () => ({ model: "A_REVERSAL", trigger: "CHOCH_FVG", win: false })),
    ...Array.from({ length: 3 }, () => ({ model: "B_CONTINUATION", trigger: "PULLBACK", win: false })),
  ];
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const entry = 100 + i;
    const exit = s.win ? entry + 2 : entry - 1;
    await importBacktest(JSON.stringify({ format: "maca-backtest", version: 1, importId: `pat-${stamp}-${i}`, backtest: {
      asset, direction: "LONG", openedAt: `2026-03-${String(i + 1).padStart(2, "0")}T10:00:00Z`, closedAt: `2026-03-${String(i + 1).padStart(2, "0")}T11:00:00Z`,
      entry, initialSL: entry - 1, tp: entry + 2, exit, netPnl: s.win ? 150 : -75, strategy: "MACA", result: s.win ? "WIN" : "LOSS",
      note: "patrones test", tags: { model: s.model, trigger: s.trigger },
    } }), stage.id);
  }
  // Uno sin etiquetas.
  await importBacktest(JSON.stringify({ format: "maca-backtest", version: 1, importId: `pat-${stamp}-none`, backtest: {
    asset, direction: "LONG", openedAt: "2026-03-20T10:00:00Z", closedAt: "2026-03-20T11:00:00Z",
    entry: 200, initialSL: 199, tp: 202, exit: 202, netPnl: 150, strategy: "MACA", result: "WIN", note: "patrones test sin etiquetas",
  } }), stage.id);

  const p = computePatterns(await listTrades(), { universe: "BACKTEST", stageId: stage.id, asset });
  assert(p.base.n === 16, "La base debería tener 16 trades, tiene " + p.base.n);
  assert(p.untagged === 1 && p.tagged === 15, "Conteo con/sin etiquetas incorrecto");
  const model = p.groups.find((g) => g.key === "model");
  const a = model.rows.find((x) => x.value === "A_REVERSAL");
  const b = model.rows.find((x) => x.value === "B_CONTINUATION");
  const none = model.rows.find((x) => x.value === NONE);
  assert(a.n === 12 && Math.abs(a.winRate - 0.75) < 1e-9 && a.sample === "INDICATIVE", "Fila Modelo A incorrecta");
  assert(Math.abs(a.expectancyR - 1.25) < 1e-9, "R promedio Modelo A incorrecto: " + a.expectancyR);
  assert(b.n === 3 && b.winRate === 0 && b.sample === "FEW", "Fila Modelo B incorrecta");
  assert(none && none.n === 1 && model.rows.at(-1) === none, "Falta la fila Sin dato al final");
  assert(model.rows.indexOf(a) < model.rows.indexOf(b), "Una muestra chica no debería ir arriba");
  assert(a.vsBaseR > 0 && b.vsBaseR < 0, "Comparación con el promedio incorrecta");
  assert(!p.groups.some((g) => g.key === "sweep"), "No debería mostrar etiquetas sin datos");
  assert(p.best.length === 1 && p.best[0].n === 12 && /Modelo: A/.test(p.best[0].label) && /CHOCH \+ FVG/.test(p.best[0].label), "Combinación con 10+ trades incorrecta");
  assert(p.worst.length === 0, "No debería repetir la misma combinación como peor");
  const empty = computePatterns(await listTrades(), { universe: "BACKTEST", stageId: stage.id, asset: "NOEXISTE" + stamp });
  assert(empty.base.n === 0 && empty.groups.length === 0 && empty.best.length === 0, "Alcance vacío debería quedar vacío");
  console.log("Patrones: muestras, agrupación por etiqueta, Sin dato, comparación con el promedio y combinaciones OK");
}
