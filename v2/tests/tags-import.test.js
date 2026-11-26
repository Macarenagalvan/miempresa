import './test-safety.js';
import { importBacktest } from "../js/domain/backtest-import.js";
import { listTrades, getTrade } from "../js/storage/repos/trades.js";
import { ensureJournalSeed } from "../js/domain/stage.js";
import { parseTagsFile, matchTags, applyTags } from "../js/domain/tags-import.js";

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const throws = (fn, message) => { let failed = false; try { fn(); } catch { failed = true; } assert(failed, message); };
const file = (items) => JSON.stringify({ format: "maca-tags", version: 1, items });

export async function run() {
  const ok = { asset: "nas 100", direction: "SHORT", openedAt: "2026-11-26T10:45:00-05:00", entry: 26251.55, session: "NY_AM", tags: { model: "A_REVERSAL", trigger: "CHOCH_FVG" } };
  const parsed = parseTagsFile(file([ok]));
  assert(parsed[0].asset === "NAS100" && parsed[0].tags.model === "A_REVERSAL", "No normalizó la ficha");
  throws(() => parseTagsFile("{"), "Aceptó JSON roto");
  throws(() => parseTagsFile(JSON.stringify({ format: "otro", version: 1, items: [ok] })), "Aceptó otro formato");
  throws(() => parseTagsFile(file([])), "Aceptó lista vacía");
  throws(() => parseTagsFile(file([{ ...ok, tags: { model: "X" } }])), "Aceptó etiqueta inválida");
  throws(() => parseTagsFile(file([{ ...ok, tags: {} }])), "Aceptó ficha sin etiquetas");
  throws(() => parseTagsFile(file([{ ...ok, openedAt: "2026-11-26T10:45:00" }])), "Aceptó hora sin zona");
  throws(() => parseTagsFile(file([{ ...ok, pnl: 5 }])), "Aceptó campo extra");
  throws(() => parseTagsFile(file([{ ...ok, direction: "UP" }])), "Aceptó dirección inválida");

  const { stage } = await ensureJournalSeed();
  const stamp = Date.now().toString(36);
  const asset = "TAGI" + stamp.slice(-5).toUpperCase();
  const base = { asset, direction: "SHORT", closedAt: "2026-11-26T12:00:00-05:00", initialSL: 110, tp: 90, exit: 110, netPnl: -50, strategy: "MACA", result: "LOSS", note: "tags import test" };
  const a = await importBacktest(JSON.stringify({ format: "maca-backtest", version: 1, importId: `ti-${stamp}-a`, backtest: { ...base, openedAt: "2026-11-26T10:45:30-05:00", entry: 100 } }), stage.id);
  // Dos trades a la misma hora: solo la entrada los separa.
  const b1 = await importBacktest(JSON.stringify({ format: "maca-backtest", version: 1, importId: `ti-${stamp}-b1`, backtest: { ...base, openedAt: "2026-11-26T11:30:00-05:00", entry: 100 } }), stage.id);
  await importBacktest(JSON.stringify({ format: "maca-backtest", version: 1, importId: `ti-${stamp}-b2`, backtest: { ...base, openedAt: "2026-11-26T11:31:00-05:00", entry: 101, initialSL: 111, exit: 111 } }), stage.id);

  const items = parseTagsFile(file([
    { ...ok, asset, openedAt: "2026-11-26T10:48:00-05:00", entry: undefined },
    { ...ok, asset, openedAt: "2026-11-26T11:30:00-05:00", entry: 100 },
    { ...ok, asset, openedAt: "2026-11-26T11:30:00-05:00", entry: undefined },
    { ...ok, asset, openedAt: "2026-11-26T10:52:00-05:00" },
    { ...ok, asset, direction: "LONG", openedAt: "2026-11-26T10:45:00-05:00" },
  ]));
  const rows = matchTags(await listTrades(), items);
  assert(rows[0].status === "MATCH" && rows[0].trade.id === a.id && !rows[0].replaces, "No encontró el trade a 2,5 min");
  assert(rows[1].status === "MATCH" && rows[1].trade.id === b1.id, "La entrada no desempató");
  assert(rows[2].status === "AMBIGUOUS" && rows[2].count === 2, "Sin entrada debería ser ambiguo");
  assert(rows[3].status === "NOT_FOUND", "Fuera de ±5 min no debería coincidir");
  assert(rows[4].status === "NOT_FOUND", "Otra dirección no debería coincidir");

  const saved = await applyTags(rows);
  assert(saved === 2, "Debería guardar 2, guardó " + saved);
  const stored = await getTrade(a.id);
  assert(stored.tags.model === "A_REVERSAL" && stored.tags.trigger === "CHOCH_FVG", "No guardó las etiquetas");
  assert(stored.session === "NY_AM", "No completó la sesión vacía");
  const again = matchTags(await listTrades(), items.slice(0, 1));
  assert(again[0].replaces === true, "No avisa que reemplaza etiquetas");
  console.log("Etiquetas para trades existentes: validación del archivo, emparejamiento ±5 min, desempate por entrada, ambiguos y guardado OK");
}
