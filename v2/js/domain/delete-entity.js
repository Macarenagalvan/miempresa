import { withStores, requestToPromise } from '../storage/db.js';
import { PRODUCT_SYNC_STORES } from '../config.js';

const stores=['accounts','challenges','trades','movements','payouts','asrs','attachments','signals','meta','syncLedger'];
async function snapshot(tx){return Object.fromEntries(await Promise.all(stores.map(async s=>[s,await requestToPromise(tx.objectStore(s).getAll())])));}
function plan(data,kind,id,linked){
 if(!['account','challenge'].includes(kind))throw new Error('Tipo de registro inválido.');
 const target=data[kind==='account'?'accounts':'challenges'].find(r=>r.id===id);
 if(!target)throw new Error('Este registro ya no existe. Actualizá la pantalla.');
 const related=kind==='challenge'?data.accounts.filter(a=>a.challengeId===id):[];
 const accounts=kind==='account'?[target]:linked?related:[];
 const accountIds=new Set(accounts.map(a=>a.id));
 const trades=data.trades.filter(t=>accountIds.has(t.accountId));const tradeIds=new Set(trades.map(t=>t.id));
 const deleted={accounts,challenges:kind==='challenge'?[target]:[],trades,movements:data.movements.filter(m=>accountIds.has(m.accountId)),payouts:kind==='challenge'?data.payouts.filter(p=>p.challengeId===id):[],asrs:data.asrs.filter(a=>tradeIds.has(a.tradeId)),attachments:data.attachments.filter(a=>(a.entityType==='trade'&&tradeIds.has(a.entityId))||(a.entityType==='account'&&accountIds.has(a.entityId))||(kind==='challenge'&&a.entityType==='challenge'&&a.entityId===id))};
 const updates={accounts:kind==='challenge'&&!linked?related.map(a=>({...a,challengeId:null})):[],signals:data.signals.filter(s=>tradeIds.has(s.tradeId)).map(s=>({...s,tradeId:null})),payouts:data.payouts.filter(p=>accountIds.has(p.accountId)&&!deleted.payouts.some(d=>d.id===p.id)).map(p=>({...p,accountId:null})),meta:[]};
 const meta=data.meta.find(m=>m.id==='singleton');
 if(meta&&(accountIds.has(meta.activeAccountId)||accountIds.has(meta.mt5Sync?.accountId))){const next={...meta};if(accountIds.has(next.activeAccountId))next.activeAccountId=null;if(accountIds.has(next.mt5Sync?.accountId))delete next.mt5Sync;updates.meta.push(next);}
 const counts=Object.fromEntries(Object.entries(deleted).map(([s,rs])=>[s,rs.length]));
 const signature=JSON.stringify({deleted:Object.fromEntries(Object.entries(deleted).map(([s,rs])=>[s,rs.map(r=>[r.id,r.updatedAt||r.createdAt||'',r.blob?.size]).sort()])),updates,related:related.map(a=>[a.id,a.updatedAt]).sort()});
 return {name:target.name||target.firm,related:related.length,counts,signature,deleted,updates};
}
export async function previewDeletion(kind,id,linked=false){return withStores(stores,'readonly',async tx=>{const p=plan(await snapshot(tx),kind,id,linked);return {name:p.name,related:p.related,counts:p.counts,signature:p.signature};});}
export async function deleteEntity(kind,id,linked,expectedSignature){
 const result=await withStores(stores,'readwrite',async tx=>{
  const data=await snapshot(tx),p=plan(data,kind,id,linked);
  if(!expectedSignature||p.signature!==expectedSignature)throw new Error('Los datos cambiaron. Cerrá la confirmación y volvé a pulsar Borrar para revisar el resumen actualizado.');
  const now=new Date().toISOString();
  function track(entityType,record,tombstone){if(!PRODUCT_SYNC_STORES.includes(entityType))return;const id=entityType+'::'+record.id,old=data.syncLedger.find(e=>e.id===id);tx.objectStore('syncLedger').put({id,entityType,entityId:String(record.id),cloudRevision:Number(old?.cloudRevision||0),dirty:true,tombstone,localChangedAt:now});}
  for(const [s,rows] of Object.entries(p.deleted))for(const row of rows){tx.objectStore(s).delete(row.id);track(s,row,true);}
  for(const [s,rows] of Object.entries(p.updates))for(const row of rows){const next=s==='meta'?row:{...row,updatedAt:now};tx.objectStore(s).put(next);track(s,next,false);}
  return p.counts;
 });
 // Deletions and their pending-sync markers commit together, even offline.
 import('../services/sync-engine.js').then(m=>m.scheduleSync()).catch(()=>{});
 return result;
}
