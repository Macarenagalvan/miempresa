import { ensureJournalSeed } from "../js/domain/stage.js";
import { createTrade, closeTrade, voidTrade } from "../js/domain/trade.js";
import {
  createAsr,
  updateAsr,
  asrForTrade,
  isAsrPending,
  asrStatusLabel,
  summarizeAsrs,
  listStageAsrs,
} from "../js/domain/asr.js";
import { compute } from "../js/domain/stats.js";
import { Context } from "../js/domain/enums.js";
import { buildExportPayload } from "../js/services/backup.js";
import { getAsrByTradeId, listAsrs } from "../js/storage/repos/asrs.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
}

async function closedTrade(stageId, extra = {}) {
  const open = await createTrade({
    asset: extra.asset || "EURUSD",
    context: "BACKTEST",
    direction: extra.direction || "LONG",
    entry: extra.entry || 1.1,
    initialSL: extra.initialSL || 1.09,
  }, stageId);
  return closeTrade(open.id, {
    exit: extra.exit || 1.12,
    netPnl: extra.netPnl == null ? 20 : extra.netPnl,
    closeType: extra.closeType || "TP",
  });
}

async function run() {
  const { stage } = await ensureJournalSeed();

  const lonely = await closedTrade(stage.id, { netPnl: 8 });
  assert("Trade CLOSED puede existir sin ASR", (await asrForTrade(lonely.id)) == null);
  assert("CLOSED sin ASR es pendiente", isAsrPending(lonely, null) === true);
  assert("Historial indica pendiente", asrStatusLabel(lonely, null) === "ASR pendiente");

  const asr = await createAsr({
    tradeId: lonely.id,
    wouldDoSame: "YES",
    conclusion: "seguir el plan",
  }, stage.id);
  assert("crear ASR para Trade CLOSED", asr.tradeId === lonely.id && asr.wouldDoSame === "YES");
  assert("1:1 por tradeId", (await getAsrByTradeId(lonely.id)).id === asr.id);
  assert("setupId copiado o null", asr.setupId == null);
  assert("errorTag opcional", asr.errorTag == null);
  assert("ya no pendiente", isAsrPending(lonely, asr) === false);
  assert("Historial indica hecho", asrStatusLabel(lonely, asr) === "ASR hecho");

  try {
    await createAsr({ tradeId: lonely.id, wouldDoSame: "NO", conclusion: "otro" }, stage.id);
    assert("impedir segundo ASR", false);
  } catch (e) {
    assert("impedir segundo ASR", /ya existe ASR/.test(e.message), e.message);
  }
  assert("sigue habiendo uno", (await listAsrs()).filter((row) => row.tradeId === lonely.id).length === 1);

  const open = await createTrade({
    asset: "EURUSD", context: "BACKTEST", direction: "LONG", entry: 1.1,
  }, stage.id);
  try {
    await createAsr({ tradeId: open.id, wouldDoSame: "YES", conclusion: "no" }, stage.id);
    assert("OPEN no acepta ASR", false);
  } catch (e) {
    assert("OPEN no acepta ASR", /CLOSED/.test(e.message));
  }
  assert("OPEN no es pendiente", isAsrPending(open, null) === false);

  try {
    await createAsr({ tradeId: "00000000-0000-4000-8000-000000000404", wouldDoSame: "YES", conclusion: "x" }, stage.id);
    assert("no ASR huérfano", false);
  } catch (e) {
    assert("no ASR huérfano", /trade no existe/.test(e.message));
  }

  const other = await closedTrade(stage.id, { netPnl: -5, exit: 1.08, closeType: "SL" });
  try {
    await createAsr({ tradeId: other.id, conclusion: "falta would" }, stage.id);
    assert("wouldDoSame required", false);
  } catch (e) {
    assert("wouldDoSame required", /wouldDoSame/.test(e.message));
  }
  try {
    await createAsr({ tradeId: other.id, wouldDoSame: "MAYBE", conclusion: "no" }, stage.id);
    assert("wouldDoSame enum", false);
  } catch (e) {
    assert("wouldDoSame enum", /wouldDoSame/.test(e.message));
  }
  try {
    await createAsr({ tradeId: other.id, wouldDoSame: "NO", conclusion: "   " }, stage.id);
    assert("conclusion required", false);
  } catch (e) {
    assert("conclusion required", /conclusion/.test(e.message));
  }
  try {
    await createAsr({
      tradeId: other.id,
      wouldDoSame: "PARTLY",
      conclusion: "size",
      errorTag: "FOO",
    }, stage.id);
    assert("errorTag solo enum válido", false);
  } catch (e) {
    assert("errorTag solo enum válido", /errorTag/.test(e.message));
  }

  const tagged = await createAsr({
    tradeId: other.id,
    wouldDoSame: "PARTLY",
    conclusion: "size alto",
    errorTag: "RISK",
    processNote: "",
    riskNote: "2R de más",
  }, stage.id);
  assert("PARTLY + errorTag RISK", tagged.wouldDoSame === "PARTLY" && tagged.errorTag === "RISK");
  assert("nota vacía no se inventa", tagged.processNote == null && tagged.riskNote === "2R de más");

  const edited = await updateAsr(tagged.id, {
    wouldDoSame: "NO",
    conclusion: "no repetir size",
    psychologyNote: "apurada",
  });
  assert("editar ASR", edited.wouldDoSame === "NO" && edited.psychologyNote === "apurada");
  assert("edit no cambia tradeId", edited.tradeId === other.id && edited.id === tagged.id);

  const beforeStats = compute([lonely, other], { context: Context.BACKTEST, stageId: stage.id });
  const afterStats = compute([lonely, other], { context: Context.BACKTEST, stageId: stage.id });
  assert("ASR no bloquea stats",
    beforeStats.nClosed === afterStats.nClosed
    && beforeStats.netPnl === afterStats.netPnl
    && beforeStats.winRate === afterStats.winRate);

  const kept = await asrForTrade(lonely.id);
  const voided = await voidTrade(lonely.id, "TEST");
  const afterVoid = await asrForTrade(lonely.id);
  assert("VOID conserva ASR", afterVoid && afterVoid.id === kept.id && afterVoid.conclusion === "seguir el plan");
  assert("VOID no queda pendiente", isAsrPending(voided, afterVoid) === false);
  assert("VOID sin label pendiente", asrStatusLabel(voided, afterVoid) === "");

  const payload = await buildExportPayload();
  assert("export incluye ASR", Array.isArray(payload.asrs) && payload.asrs.some((row) => row.id === asr.id));
  assert("export conserva tradeId", payload.asrs.some((row) => row.id === asr.id && row.tradeId === lonely.id));
  assert("export 1:1", payload.asrs.filter((row) => row.tradeId === lonely.id).length === 1);

  const summary = summarizeAsrs(await listStageAsrs(stage.id));
  assert("prep wouldDoSame/errorTag",
    summary.total >= 2
    && summary.wouldDoSame.YES + summary.wouldDoSame.NO + summary.wouldDoSame.PARTLY === summary.total
    && summary.errorTag.RISK >= 1);

  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
  lines.push("");
  lines.push(failed.length ? `${failed.length} fallos` : `${results.length} tests OK`);
  const out = document.getElementById("out");
  out.textContent += "\n\nSLICE 4\n" + lines.join("\n");
  if (failed.length) out.className = "fail";
  if (failed.length) throw new Error("slice4 " + failed.length);
}

export { run };
