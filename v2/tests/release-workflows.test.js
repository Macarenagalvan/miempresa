import { ensureJournalSeed } from "../js/domain/stage.js";
import { createTrade, updateDraftTrade, activateDraftTrade, closeTrade, voidTrade, createClosedTrade } from "../js/domain/trade.js";
import { getTrade, listTrades } from "../js/storage/repos/trades.js";
import { createAccount, accountBalance } from "../js/domain/account.js";
import { compute } from "../js/domain/stats.js";
import { renderNuevoTrade } from "../js/ui/screens/trade-new.js";
import { renderTradeDetail } from "../js/ui/screens/trade-detail.js";
import { renderHistorial } from "../js/ui/screens/historial.js";
import { localDateTimeValue, stateBadge } from "../js/ui/trade-presentation.js";
import { buildExportPayload, applyRestoreTransaction, validateBackup } from "../js/services/backup.js";
import { addTradeImage, listTradeImages } from "../js/storage/repos/attachments.js";

export async function run() {
  let count = 0;
  function check(ok, message) { if (!ok) throw new Error(message); count++; }
  async function rejects(fn, message) { let failed = false; try { await fn(); } catch { failed = true; } check(failed, message); }
  function host(nodes) { const div=document.createElement("div"); div.append(...nodes); return div; }
  async function settled(fn) { for(let i=0;i<100;i++) { if(await fn()) return; await new Promise(r=>setTimeout(r,10)); } throw new Error("Guardado no completado"); }
  const seed = await ensureJournalSeed();
  const openedAt = "2026-09-10T08:00:37.000Z";
  const closedAt = "2026-09-10T09:00:00.000Z";
  const common = { asset:"EURUSD", direction:"LONG", entry:100, initialSL:95, tp:110, openedAt };
  const draft = await createTrade({ asset:"EURUSD", direction:"LONG", isDraft:true }, seed.stage.id);
  check(draft.isDraft && draft.entry === null && draft.openedAt === null, "Borrador incompleto conservado");
  await rejects(()=>activateDraftTrade(draft.id), "No activar sin ejecución");
  await rejects(()=>closeTrade(draft.id,{exit:110,netPnl:10,closeType:"TP"}), "No cerrar borrador sin ejecución");
  await updateDraftTrade(draft.id,{entry:100,openedAt,initialSL:95,exit:110,netPnl:10,closedAt});
  const editor=host(await renderTradeDetail({...seed,route:{rest:draft.id+"/editar"}}));
  check(editor.querySelector('[name="openedAt"]').value === localDateTimeValue(openedAt), "Editor muestra hora local");
  [...editor.querySelectorAll("button")].find(b=>b.textContent==="Guardar cambios").click();
  await settled(()=>location.hash.includes(draft.id));
  check((await getTrade(draft.id)).openedAt===openedAt, "Guardar sin editar conserva instante y segundos");
  const active=await activateDraftTrade(draft.id);
  check(!active.isDraft && active.lifecycle==="OPEN", "Borrador pasa a OPEN");
  await rejects(()=>closeTrade(draft.id,{exit:110,netPnl:10,closedAt:"2026-09-09T09:00:00Z"}), "Rechaza cierre anterior");
  const closed=await closeTrade(draft.id,{exit:110,netPnl:9,closedAt,commission:1,swap:0,closeType:"TP"});
  check(closed.lifecycle==="CLOSED" && !closed.isDraft && closed.rrRealized===2, "Cierre y R");
  check(closed.netPnl===9 && closed.costComplete, "Neto no descuenta costes otra vez");
  await rejects(()=>closeTrade(draft.id,{exit:110,netPnl:9}), "No cerrar dos veces");
  await voidTrade(draft.id,"TEST");
  check((await getTrade(draft.id)).lifecycle==="VOID", "CLOSED pasa a VOID");
  const cancelled=await createTrade({asset:"XAUUSD",direction:"LONG",isDraft:true},seed.stage.id);
  const voided=await voidTrade(cancelled.id,"TEST");
  check(voided.lifecycle==="VOID" && stateBadge(voided).textContent.includes("VOID"), "Borrador anulado muestra VOID");

  const live=await createAccount({name:"TEST release LIVE",context:"LIVE",currency:"USD",initialAmount:1000},seed.stage.id);
  const demo=await createAccount({name:"TEST release DEMO",context:"DEMO",currency:"USD",initialAmount:2000},seed.stage.id);
  const realTrade=await createClosedTrade({...common,context:"LIVE",accountId:live.id,exit:110,netPnl:9,closedAt,commission:1,swap:0},seed.stage.id);
  const demoTrade=await createClosedTrade({...common,context:"DEMO",accountId:demo.id,exit:95,netPnl:-6,closedAt},seed.stage.id);
  const btTrade=await createClosedTrade({...common,context:"BACKTEST",exit:110,netPnl:20,closedAt},seed.stage.id);
  const dataset=[realTrade,demoTrade,btTrade,voided,await getTrade(draft.id)];
  for(const [universe,net] of [["REAL",9],["DEMO",-6],["BACKTEST",20]]) {
    const stats=compute(dataset,{universe});
    check(stats.nClosed===1 && stats.netPnl===net, universe+" separado sin VOID");
  }
  check(accountBalance(live,[],dataset)===1009, "Balance real excluye demo/backtest");
  check(btTrade.accountId===null, "Backtest no tiene cuenta");
  const history=host(await renderHistorial({...seed,route:{query:{}}}));
  check(![...history.querySelectorAll(".row.hist")].some(n=>n.textContent.includes("BACKTEST")), "Historial normal sin backtests");

  async function saveForm(query, values) {
    const form=host(await renderNuevoTrade({...seed,route:{rest:"trade",query}}));
    for(const [name,value] of Object.entries(values)) {
      const input=form.querySelector(`[name="${name}"]`);
      input.value=value; input.dispatchEvent(new Event("change")); input.dispatchEvent(new Event("input"));
    }
    const before=new Set((await listTrades()).map(t=>t.id));
    form.querySelector(".trade-form-submit").click();
    let result;
    await settled(async()=>{result=(await listTrades()).find(t=>!before.has(t.id));return result;});
    await settled(()=>location.hash.includes(result.id));
    return {form,trade:await getTrade(result.id)};
  }
  const incomplete=await saveForm({context:"BACKTEST"},{asset:"NAS100"});
  check(incomplete.trade.isDraft && incomplete.trade.openedAt===null, "UI histórico incompleto no inventa fecha");
  const open=await saveForm({}, {context:"LIVE",accountId:live.id,asset:"EURUSD",entry:"100",lifecycle:"OPEN"});
  check(!open.trade.isDraft && open.trade.lifecycle==="OPEN", "UI OPEN completo no es borrador");
  const explicit=await saveForm({context:"BACKTEST"},{asset:"EURUSD",entry:"100",openedAt:"2026-09-10T10:00",lifecycle:"DRAFT"});
  check(explicit.trade.isDraft, "UI borrador explícito conserva estado");

  const bytes=new Uint8Array([137,80,78,71,0,1,2,255]);
  await addTradeImage(btTrade.id,{name:"TEST-before.png",mime:"image/png",blob:new Blob([bytes],{type:"image/png"}),phase:"BEFORE"});
  await addTradeImage(btTrade.id,{name:"TEST-after.png",mime:"image/png",blob:new Blob([bytes],{type:"image/png"}),phase:"AFTER"});
  const backup=JSON.parse(JSON.stringify(await buildExportPayload()));
  check(validateBackup(backup).ok, "Backup con borradores y estados es válido");
  await applyRestoreTransaction(backup);
  check((await getTrade(incomplete.trade.id)).isDraft, "Restore conserva borrador");
  check((await getTrade(open.trade.id)).lifecycle==="OPEN", "Restore conserva OPEN");
  check((await getTrade(voided.id)).lifecycle==="VOID", "Restore conserva VOID");
  const images=await listTradeImages(btTrade.id);
  check(images.length===2 && images.some(x=>x.phase==="BEFORE") && images.some(x=>x.phase==="AFTER"), "Restore conserva fases de imágenes");
  check((new Uint8Array(await images[0].blob.arrayBuffer())).every((v,i)=>v===bytes[i]), "Restore conserva bytes exactos");
  const broken=structuredClone(backup); broken.attachments[0].dataBase64="not-base64";
  await rejects(()=>applyRestoreTransaction(broken), "Restore corrupto rechazado");
  check((await listTradeImages(btTrade.id)).length===2, "Restore fallido conserva imágenes");
  document.getElementById("out").textContent+=`\nRelease workflows: ${count} tests OK\n`;
}
