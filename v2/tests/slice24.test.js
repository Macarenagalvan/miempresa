import { ensureJournalSeed } from "../js/domain/stage.js";
import { createAccount } from "../js/domain/account.js";
import { createTrade, createClosedTrade, enrichTrade, syncMt5Csv, findTradeByMt5Position } from "../js/domain/trade.js";
import { getTrade } from "../js/storage/repos/trades.js";
import { assertTrade } from "../js/domain/integrity.js";
import { compute } from "../js/domain/stats.js";
import { addTradeImage, listTradeImages, removeAttachment } from "../js/storage/repos/attachments.js";
import { renderTradeDetail } from "../js/ui/screens/trade-detail.js";
import { MT5_SLICE11_ROWS, asMt5Csv } from "../js/fixtures/mt5-slice11.js";
import { TRADE_JOURNAL_FIELDS } from "../js/domain/trade-journal.js";
import {
  TradeRecordSource,
  Lifecycle,
  Strategy,
  Style,
  CloseType,
  Context,
} from "../js/domain/enums.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
}

function flatten(nodes) {
  const host = document.createElement("div");
  host.append(...[].concat(nodes).filter(Boolean));
  return host;
}

function pngBlob() {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  return new Blob([bytes], { type: "image/png" });
}

async function run() {
  const seed = await ensureJournalSeed();
  const { stage } = seed;

  const legacy = await createTrade({
    asset: "EURUSD",
    direction: "LONG",
    entry: 1.1,
  }, stage.id);
  assert("legacy sin risk válido", legacy.riskPercent == null && legacy.riskMoney == null);
  assertTrade(legacy);
  assert("assertTrade legacy OK", true);

  const openRisk = await createTrade({
    asset: "NZDJPY",
    direction: "SHORT",
    entry: 87.1,
    riskPercent: "0.5",
    riskMoney: "50",
  }, stage.id);
  assert("OPEN riskPercent", openRisk.riskPercent === 0.5);
  assert("OPEN riskMoney", openRisk.riskMoney === 50);
  assert("OPEN risk ≠ netPnl", openRisk.netPnl == null);

  const closedRisk = await createClosedTrade({
    asset: "NZDJPY",
    direction: "SHORT",
    strategy: Strategy.RED,
    style: Style.SCALP,
    entry: 87.15,
    exit: 87.42,
    openedAt: "2026-09-11T09:00:00.000Z",
    closedAt: "2026-09-11T10:00:00.000Z",
    netPnl: -31,
    closeType: CloseType.SL,
    riskPercent: 0.5,
    riskMoney: 50,
    management: "corte manual",
    note: "ficha operativa",
  }, stage.id);
  assert("CLOSED risk + netPnl coexisten", closedRisk.riskMoney === 50 && closedRisk.netPnl === -31);
  assert("CLOSED riskPercent", closedRisk.riskPercent === 0.5);

  const zeroed = await enrichTrade(closedRisk.id, { riskPercent: 0, riskMoney: 0 });
  assert("0 se conserva", zeroed.riskPercent === 0 && zeroed.riskMoney === 0);
  const cleared = await enrichTrade(closedRisk.id, { riskPercent: "", riskMoney: "" });
  assert("vacío → null", cleared.riskPercent == null && cleared.riskMoney == null);
  const restored = await enrichTrade(closedRisk.id, { riskPercent: 0.5, riskMoney: 50 });
  assert("enrich vuelve a setear", restored.riskPercent === 0.5 && restored.riskMoney === 50);

  let rejected = false;
  try {
    await enrichTrade(closedRisk.id, { riskPercent: "no-num" });
  } catch (e) {
    rejected = /riesgo inválido/.test(e.message);
  }
  assert("número inválido rechazado", rejected);

  let rejectedNeg = false;
  try {
    await enrichTrade(closedRisk.id, { riskMoney: -10 });
  } catch (e) {
    rejectedNeg = /negativo/.test(e.message);
  }
  assert("negativo rechazado", rejectedNeg);

  assert("whitelist incluye risk", TRADE_JOURNAL_FIELDS.includes("riskPercent") && TRADE_JOURNAL_FIELDS.includes("riskMoney"));

  const other = await createClosedTrade({
    asset: "EURUSD",
    direction: "LONG",
    strategy: Strategy.BLUE,
    entry: 1.1,
    exit: 1.12,
    openedAt: "2026-09-11T09:00:00.000Z",
    closedAt: "2026-09-11T10:00:00.000Z",
    netPnl: 12,
    closeType: CloseType.TP,
  }, stage.id);

  const imgA = await addTradeImage(closedRisk.id, { type: "image/png", name: "nzd.png", blob: pngBlob() });
  const imgA2 = await addTradeImage(closedRisk.id, { type: "image/jpeg", name: "nzd2.jpg", blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" }) });
  const listedA = await listTradeImages(closedRisk.id);
  assert("Trade A tiene 2 imágenes", listedA.length === 2 && listedA.every((a) => a.entityId === closedRisk.id));
  assert("imagen persistida", listedA.some((a) => a.id === imgA.id && a.blob instanceof Blob));

  const listedB = await listTradeImages(other.id);
  assert("Trade B no ve imágenes de A", listedB.length === 0);

  const card = flatten(await renderTradeDetail({
    ...seed,
    route: { name: "trade", rest: closedRisk.id, query: {} },
  }));
  assert("ficha muestra Risk %", /Risk % 0.5/.test(card.textContent));
  assert("ficha muestra Risk $", /Risk \$ 50/.test(card.textContent));
  assert("ficha muestra Capturas", /Capturas \/ Imágenes/.test(card.textContent));
  assert("ficha lista las 2", card.querySelectorAll(".thumb-card").length === 2);

  await removeAttachment(imgA.id);
  const afterDel = await listTradeImages(closedRisk.id);
  const stillTrade = await getTrade(closedRisk.id);
  assert("quitar imagen no borra trade", stillTrade && stillTrade.id === closedRisk.id && stillTrade.netPnl === -31);
  assert("queda 1 imagen", afterDel.length === 1 && afterDel[0].id === imgA2.id);

  let badMime = false;
  try {
    await addTradeImage(closedRisk.id, { type: "application/pdf", name: "x.pdf", blob: new Blob(["x"], { type: "application/pdf" }) });
  } catch (e) {
    badMime = /PNG/.test(e.message);
  }
  assert("MIME inválido rechazado", badMime);

  const bullfy = await createAccount(
    { name: "Bullfy PROP F5", context: Context.PROP_CHALLENGE, currency: "USD", initialAmount: 10000 },
    stage.id,
  );
  const src = { accountId: bullfy.id, context: bullfy.context, timeZone: "Europe/Athens" };
  const first = await syncMt5Csv(asMt5Csv([MT5_SLICE11_ROWS.nzdjpyShort]), stage.id, src);
  assert("MT5 import 1", first.created === 1);
  const raw = await findTradeByMt5Position(bullfy.id, "20021");
  const classified = await enrichTrade(raw.id, { strategy: Strategy.RED, style: Style.SCALP, riskPercent: 0.5, riskMoney: 50 });
  await addTradeImage(classified.id, { type: "image/webp", name: "mt5.webp", blob: new Blob([new Uint8Array([9, 8, 7])], { type: "image/webp" }) });
  const second = await syncMt5Csv(asMt5Csv([MT5_SLICE11_ROWS.nzdjpyShort]), stage.id, src);
  const again = await findTradeByMt5Position(bullfy.id, "20021");
  const shots = await listTradeImages(again.id);
  assert("reimport no duplica", second.created === 0 && second.duplicates === 1 && again.id === raw.id);
  assert("RED permanece", again.strategy === Strategy.RED);
  assert("risk permanece post reimport", again.riskPercent === 0.5 && again.riskMoney === 50);
  assert("screenshot permanece", shots.length === 1 && shots[0].name === "mt5.webp");
  assert("provenance MT5", again.recordSource === TradeRecordSource.MT5_EA && again.sourceRef.mt5Position === "20021");

  const stats = compute([closedRisk, other], { universe: "BACKTEST" });
  assert("stats no rompe con risk", stats.nClosed === 2 && stats.netPnl === -19);

  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  lines.push("");
  lines.push(failed.length ? `${failed.length} fallos` : `${results.length} tests OK`);
  const out = document.getElementById("out");
  out.textContent += "\n\nSLICE 24\n" + lines.join("\n");
  if (failed.length) out.className = "fail";
  if (failed.length) throw new Error("slice24 " + failed.length);
}

export { run };
