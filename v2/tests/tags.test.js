import './test-safety.js';
import { normalizeTags, tagsMatch, describeTags, TAG_DICTIONARY } from "../js/domain/tags.js";
import { parseBacktest, importBacktest } from "../js/domain/backtest-import.js";
import { listTrades, getTrade } from "../js/storage/repos/trades.js";
import { ensureJournalSeed } from "../js/domain/stage.js";
import { assertTrade } from "../js/domain/integrity.js";
import { compute, filterTrades } from "../js/domain/stats.js";

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const throws = (fn, message) => { let failed = false; try { fn(); } catch { failed = true; } assert(failed, message); };

const file = (importId, backtest) => JSON.stringify({ format: "maca-backtest", version: 1, importId, backtest: {
  asset: "MNQ", direction: "LONG", openedAt: "2026-02-02T09:35:00-05:00", closedAt: "2026-02-02T10:00:00-05:00",
  entry: 25665, initialSL: 25630, tp: 25790, exit: 25790, netPnl: 267.86, strategy: "MACA", result: "WIN", note: "tags test", ...backtest,
} });

export async function run() {
  // Diccionario: claves y valores cerrados.
  const keys = TAG_DICTIONARY.map((d) => d.key);
  assert(new Set(keys).size === keys.length, "Claves repetidas en el diccionario");
  assert(normalizeTags(null) === null && normalizeTags({}) === null && normalizeTags({ sweep: [] }) === null, "Vacío debería ser null");
  const tags = normalizeTags({ sweep: ["TF_LINE", "ASIA_H", "ASIA_H"], model: "A_REVERSAL", runAfterTpR: 1.5 });
  assert(JSON.stringify(Object.keys(tags)) === JSON.stringify(["model", "sweep", "runAfterTpR"]), "No ordena por diccionario");
  assert(JSON.stringify(tags.sweep) === JSON.stringify(["ASIA_H", "TF_LINE"]), "No deduplica ni ordena valores múltiples");
  throws(() => normalizeTags({ modelo: "A_REVERSAL" }), "Aceptó una etiqueta inexistente");
  throws(() => normalizeTags({ model: "C" }), "Aceptó un valor inexistente");
  throws(() => normalizeTags({ model: ["A_REVERSAL", "B_CONTINUATION"] }), "Aceptó dos valores en etiqueta simple");
  throws(() => normalizeTags({ runAfterTpR: -1 }), "Aceptó recorrido negativo");
  throws(() => normalizeTags({ runAfterTpR: "2" }), "Aceptó recorrido como texto");
  throws(() => normalizeTags([]), "Aceptó un array como etiquetas");
  assert(describeTags(tags).map((r) => r.text).join("|") === "A · Giro tras barrida|Asia H + Línea de temporalidad|1.5R", "Texto de etiquetas incorrecto");

  // Filtro.
  assert(tagsMatch(tags, { model: "A_REVERSAL", sweep: "TF_LINE" }), "No coincide filtro válido");
  assert(!tagsMatch(tags, { sweep: "NY_L" }), "Coincidió valor ausente");
  assert(!tagsMatch(null, { model: "A_REVERSAL" }), "Trade sin etiquetas coincidió");
  assert(tagsMatch(null, { model: "__NONE__" }) && !tagsMatch(tags, { model: "__NONE__" }), "Filtro sin etiqueta incorrecto");

  // Importación: tags y sesión viajan al trade; un valor inválido no escribe nada.
  const { stage } = await ensureJournalSeed();
  const before = (await listTrades()).length;
  throws(() => parseBacktest(file("tags-test-bad-01", { tags: { model: "X" } })), "Importación aceptó etiqueta inválida");
  throws(() => parseBacktest(file("tags-test-bad-02", { session: "LUNCH" })), "Importación aceptó sesión inválida");
  assert((await listTrades()).length === before, "Validación escribió datos");
  const stamp = Date.now().toString(36);
  const trade = await importBacktest(file("tags-test-ok-" + stamp, {
    openedAt: `2026-02-0${1 + (Date.now() % 8)}T09:35:${String(Date.now() % 60).padStart(2, "0")}-05:00`, closedAt: "2026-02-09T23:00:00-05:00",
    session: "NY_AM", tags: { model: "B_CONTINUATION", withDaily: "YES", sweep: ["NY_L", "ASIA_H"] },
  }), stage.id);
  const stored = await getTrade(trade.id);
  assert(stored.session === "NY_AM", "No guardó la sesión");
  assert(stored.tags.model === "B_CONTINUATION" && stored.tags.sweep.join() === "ASIA_H,NY_L", "No guardó las etiquetas");
  assertTrade(stored);
  throws(() => assertTrade({ ...stored, tags: { model: "Z" } }), "assertTrade aceptó etiqueta inválida");

  // Estadísticas filtradas por etiqueta.
  const all = await listTrades();
  const tagged = filterTrades(all, { context: "BACKTEST", tags: { model: "B_CONTINUATION" } });
  assert(tagged.some((t) => t.id === trade.id), "El filtro por etiqueta no encontró el trade");
  assert(tagged.every((t) => t.tags?.model === "B_CONTINUATION"), "El filtro por etiqueta dejó pasar otros trades");
  const stats = compute(all, { tags: { model: "B_CONTINUATION" } });
  assert(stats.filters.tags.model === "B_CONTINUATION" && stats.nClosed >= 1, "compute no aplicó el filtro de etiquetas");
  const untagged = compute(all, {});
  assert(untagged.nClosed >= stats.nClosed, "Sin filtro debería haber al menos los mismos trades");
  console.log("Etiquetas: diccionario cerrado, validación, importación con tags y sesión, filtro en estadísticas OK");
}
