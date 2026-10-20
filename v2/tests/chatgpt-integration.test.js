import { closeDb, resetOpenCache } from '../js/storage/db.js';
import { DB_NAME } from '../js/config.js';
import { ensureJournalSeed } from '../js/domain/stage.js';
import { createMemoryCloud, setSyncCloud, resetSyncCloud } from '../js/services/sync-cloud.js';
import { pullNow, resetSyncEngine, setOnlineOverride, patchSyncState } from '../js/services/sync-engine.js';
import { bindBacktestingSync } from '../js/ui/backtesting-sync.js';
import { getTrade, listTrades } from '../js/storage/repos/trades.js';
import { updateDraftTrade, activateDraftTrade, enrichTrade } from '../js/domain/trade.js';
import { assertTrade, accountBalance } from '../js/domain/integrity.js';
import { compute } from '../js/domain/stats.js';
import { addTradeImage, listTradeImages } from '../js/storage/repos/attachments.js';
import { renderTradeDetail } from '../js/ui/screens/trade-detail.js';
import { renderBacktesting } from '../js/ui/screens/backtesting.js';
import { assertClientKeySafe } from '../js/services/auth.js';

export async function run() {
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  await closeDb();resetOpenCache();resetSyncEngine();setOnlineOverride(true);
  await new Promise((resolve,reject)=>{const req=indexedDB.deleteDatabase(DB_NAME);req.onsuccess=resolve;req.onerror=()=>reject(req.error);req.onblocked=()=>reject(Error('DB bloqueada'));});
  const seed=await ensureJournalSeed();
  const historical={id:'chatgpt-closed',stageId:seed.stage.id,asset:'EURUSD',direction:'LONG',
    context:'BACKTEST',accountId:null,recordSource:'MANUAL',sourceRef:{integration:'CHATGPT'},
    lifecycle:'CLOSED',isDraft:false,openedAt:'2020-01-01T10:00:00.000Z',closedAt:'2020-01-01T11:00:00.000Z',
    entry:100,initialSL:95,currentSL:95,tp:110,exit:110,netPnl:20,result:'WIN',strategy:'MACA',rrRealized:null,
    note:'Análisis histórico',hasPartials:false};
  const draft={...historical,id:'chatgpt-draft',asset:null,direction:null,isDraft:true,lifecycle:'OPEN',
    entry:null,openedAt:null,closedAt:null,result:null,exit:null,netPnl:null,strategy:'UNCLASSIFIED',
    draftResult:'WIN',draftExit:110,draftNetPnl:20,draftClosedAt:'2020-01-01T11:00:00.000Z'};
  assertTrade(historical);assertTrade(draft);
  let rejected=false;try{assertTrade({...draft,isDraft:false});}catch{rejected=true;}
  check(rejected,'Un borrador incompleto no se activa sin datos');
  const cloud=createMemoryCloud([historical,draft].map(payload=>({entityType:'trades',entityId:payload.id,payload,revision:1})));
  setSyncCloud(cloud);
  try {
    await pullNow();await pullNow();
    check((await listTrades()).length===2,'Repetir sincronización no duplica');
    const loaded=await getTrade(historical.id);check(loaded.note===historical.note,'Notas persistidas');
    const real={...historical,id:'real',context:'LIVE',accountId:'account',netPnl:100};
    check(accountBalance({id:'account',initialAmount:1000},[],[real,historical,draft])===1100,'Backtests no alteran saldo real');
    check(compute([real,historical,draft],{universe:'REAL'}).nClosed===1,'Estadísticas reales aisladas');
    check(compute([real,historical,draft],{universe:'BACKTEST'}).nClosed===1,'Borrador excluido de resultados');
    const nodes=await renderTradeDetail({...seed,route:{rest:historical.id,query:{}}});
    const host=document.createElement('div');host.append(...nodes);
    check(host.textContent.includes('Análisis histórico'),'Registro importado abre detalle sin fallar');
    const editor=await renderTradeDetail({...seed,route:{rest:draft.id+'/editar',query:{}}});
    const form=document.createElement('div');form.append(...editor);
    check(form.querySelector('[name="asset"]')?.value==='','Activo desconocido editable');
    check(form.querySelector('[name="direction"]')?.value==='','Dirección desconocida sin valor inventado');
    await updateDraftTrade(draft.id,{asset:'SPX',direction:'SHORT',entry:100,initialSL:105,tp:90,openedAt:historical.openedAt});
    await enrichTrade(draft.id,{strategy:'BLUE',note:'Completado en Maca'});
    const edited=await getTrade(draft.id);check(edited.asset==='SP500'&&edited.direction==='SHORT'&&edited.strategy==='BLUE','Borrador completado y normalizado');
    await activateDraftTrade(draft.id);
    await addTradeImage(historical.id,{name:'TEST-captura.png',mime:'image/png',blob:new Blob([new Uint8Array([1,2,3])],{type:'image/png'}),phase:'AFTER'});
    await closeDb();resetOpenCache();
    check((await listTradeImages(historical.id)).length===1,'Captura persiste al reabrir almacenamiento');
    check((await getTrade(draft.id)).note==='Completado en Maca','Edición persiste');
    const back=document.createElement('div');back.append(...await renderBacktesting({...seed,route:{query:{}}}));
    check(back.querySelector('a[href$="/v2/integration.html"]'),'Enlace de integración disponible');
    let paints=0,route={name:'backtesting',rest:'',query:{}};
    const stop=bindBacktestingSync(()=>route,async()=>{paints++;});
    const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
    await patchSyncState({status:'idle',lastSyncAt:'2026-01-01T00:00:00Z'});await settle();
    check(paints===1,'Backtesting se actualiza después de sincronizar');
    route={name:'trade',rest:'chatgpt-draft/editar',query:{from:'backtesting'}};
    await patchSyncState({lastSyncAt:'2026-01-01T00:01:00Z'});await settle();
    check(paints===1,'Sincronizar no reemplaza un formulario en edición');stop();
    for(const key of ['sb_secret_fixture','e30.'+btoa(JSON.stringify({role:'service_role'}))+'.signature']) {
      let denied=false;try{assertClientKeySafe(key);}catch{denied=true;}check(denied,'Clave privada rechazada');
    }
    console.log('ChatGPT integration: sync, persistence, editing, captures, draft completion and REAL isolation OK');
  } finally {resetSyncCloud();resetSyncEngine();}
}
