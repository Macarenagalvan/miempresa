import {ensureJournalSeed} from '../js/domain/stage.js';
import {createAccount} from '../js/domain/account.js';
import {getMeta} from '../js/storage/repos/meta.js';
import {importPreference,saveImportPreference} from '../js/domain/import-preferences.js';
import {previewDeletion,deleteEntity} from '../js/domain/delete-entity.js';
import {MT5_CSV_COLUMNS,parseMt5Csv,toTradeDraft} from '../js/adapters/mt5.js';
import {importClosedMt5Trade} from '../js/domain/trade.js';
export async function run(){
 let n=0;const check=(v,m)=>{if(!v)throw Error('Origen MT5: '+m);n++;};
 const {stage}=await ensureJournalSeed();
 const a=await createAccount({name:'TEST broker A',context:'LIVE',currency:'USD',initialAmount:1000},stage.id),b=await createAccount({name:'TEST broker B',context:'LIVE',currency:'USD',initialAmount:1000},stage.id);
 await saveImportPreference(a.id,{broker:'Broker A',login:'12345',timeZone:'Europe/Athens'});await saveImportPreference(b.id,{broker:'Broker B',login:'67890',timeZone:'UTC'});
 let meta=await getMeta();check(importPreference(meta,a.id).timeZone==='Europe/Athens','no mezcla horarios');check(importPreference(meta,b.id).broker==='Broker B','identifica broker');check(meta.mt5LastAccountId===b.id,'recuerda última cuenta');check(!importPreference(meta,'inexistente'),'no hereda otro origen');
 let rejected=false;try{await saveImportPreference(a.id,{timeZone:'unknown'});}catch{rejected=true;}check(rejected,'rechaza horario desconocido');
 const source=await(await fetch('../../mt5/MacaAutoExport.mq5')).text();
 check(source.match(/string columns="([^"]+)"/)?.[1]===MT5_CSV_COLUMNS.join(';'),'exportador usa contrato de 39 columnas');
 const rec={ID:'987654',Fecha:'2026-10-13',Hora:'10:00','Fecha salida':'2026-10-13','Hora salida':'11:00',Cuenta:'12345',Direccion:'Long',Activo:'EURUSD',Entrada:'100',Salida:'110','B/P Neto':'9.8',Resultado:'Win',Lotaje:'.1',Notas:'MACA_AUTO_V1|server=Broker_A|currency=USD|partials=1|horario=servidor'};
 const csv=MT5_CSV_COLUMNS.join(';')+'\n'+MT5_CSV_COLUMNS.map(k=>rec[k]??'').join(';');
 const mapped=toTradeDraft(parseMt5Csv(csv).rows[0].rec,{accountId:a.id,context:'LIVE',timeZone:'Europe/Athens'});check(mapped.ok&&mapped.draft.hasPartials,'reconoce parciales del exportador');
 const trade=await importClosedMt5Trade(mapped.draft,stage.id);check(trade.hasPartials&&trade.netPnl===9.8,'conserva neto y parciales sin inventar riesgo');
 const p=await previewDeletion('account',b.id);await deleteEntity('account',b.id,false,p.signature);meta=await getMeta();check(!meta.mt5Profiles[b.id]&&!meta.mt5LastAccountId,'borrado limpia perfil y última cuenta');check(meta.mt5Profiles[a.id].login==='12345','borrado conserva el otro perfil');
 document.getElementById('out').textContent+='\nOrigen MT5: '+n+' tests OK';
}
