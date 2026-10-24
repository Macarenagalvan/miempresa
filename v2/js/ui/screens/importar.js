import { el } from '../render.js';
import { field } from '../forms/observation.js';
import { decodeMt5File, parseMt5Html } from '../../adapters/mt5-html.js';
import { parseMt5Csv } from '../../adapters/mt5.js';
import { listStageAccounts, getActiveAccount, setActiveAccount } from '../../domain/account.js';
import { previewMt5Csv, syncMt5Csv } from '../../domain/trade.js';
import { getMeta, putMeta } from '../../storage/repos/meta.js';
import { MT5_SOURCE_TIMEZONES } from '../../config.js';
import { money, link, label } from '../journal-insights.js';
import { go } from '../router.js';

export async function renderImportar(ctx){
 const accounts=await listStageAccounts(ctx.stage.id),active=await getActiveAccount(),meta=await getMeta();
 const account=el('select',{className:'input',name:'import-account'},[el('option',{value:'',text:'Elegí la cuenta destino'}),...accounts.map(a=>el('option',{value:a.id,text:a.name+' · '+label(a.context)}))]);
 account.value=ctx.route.query.account||active?.id||meta.mt5Sync?.accountId|| (accounts.length===1?accounts[0].id:'');
 const zone=el('select',{className:'input',name:'import-zone'},[el('option',{value:'',text:'Elegí la zona horaria del servidor'}),...MT5_SOURCE_TIMEZONES.map(z=>el('option',{value:z,text:z}))]);
 // Remember a zone only for the same destination account, never across brokers.
 if(account.value===meta.mt5Sync?.accountId)zone.value=meta.mt5Sync.timeZone||'';
 const file=el('input',{type:'file',className:'input',name:'mt5-report',accept:'.html,.htm,.csv,.txt'});
 const preview=el('div',{'aria-live':'polite'}),err=el('p',{className:'err',role:'alert'});
 const confirm=el('button',{type:'button',text:'Importar operaciones',disabled:true});confirm.disabled=true;
 let pending=null,version=0,busy=false;
 function invalidate(){version++;pending=null;confirm.disabled=true;preview.replaceChildren();err.textContent='';}
 account.addEventListener('change',()=>{invalidate();zone.value=account.value===meta.mt5Sync?.accountId?meta.mt5Sync.timeZone||'':'';file.value='';});
 zone.addEventListener('change',()=>{invalidate();file.value='';});
 file.addEventListener('change',async()=>{
  invalidate();const chosen=file.files[0];if(!chosen)return;
  const v=version,acc=accounts.find(a=>a.id===account.value);
  try{
   if(!acc||!zone.value)throw new Error('Primero elegí la cuenta y la zona horaria. Después seleccioná el informe.');
   if(chosen.size>20*1024*1024)throw new Error('El archivo supera 20 MB. Exportá un período más corto.');
   const text=decodeMt5File(await chosen.arrayBuffer()),html=/\.html?$/i.test(chosen.name)||/^\s*(?:<!doctype|<html)/i.test(text);
   const report=html?parseMt5Html(text):null,csv=report?report.csv:text;
   const login=acc.mt5Login||acc.name.match(/\b\d{5,}\b/)?.[0];
   if(report?.login&&login&&report.login!==login)throw new Error('El informe es de la cuenta '+report.login+', pero elegiste '+acc.name+'. Cambiá la cuenta destino.');
   if(report?.currency&&report.currency!==acc.currency)throw new Error('La moneda del informe ('+report.currency+') no coincide con la cuenta ('+acc.currency+').');
   const parsed=parseMt5Csv(csv),ids=parsed.rows.map(r=>r.rec.ID);
   if(new Set(ids).size!==ids.length)throw new Error('El archivo repite IDs. Revisalo antes de importar.');
   const options={accountId:acc.id,context:acc.context,timeZone:zone.value};
   const result=await previewMt5Csv(csv,options);if(v!==version)return;
   const net=result.drafts.reduce((s,t)=>s+Math.round(t.netPnl*100),0)/100;
   const known=Boolean(login&&report?.login);
   const acknowledge=el('input',{type:'checkbox','aria-label':'Confirmo que el informe pertenece a esta cuenta'});
   const ready=()=>result.invalid===0&&result.unknownSymbols===0&&result.created>0&&(!report||known||acknowledge.checked);
   acknowledge.addEventListener('change',()=>confirm.disabled=!ready());
   const table=el('table',{className:'journal-table'});
   table.append(el('tr',{},['Posición','Activo','Apertura (servidor)','Neto'].map(text=>el('th',{text}))));
   for(const {rec} of parsed.rows.slice(0,100)) table.append(el('tr',{},[rec.ID,rec.Activo,rec.Fecha+' '+rec.Hora,money(rec['B/P Neto'],acc.currency)].map(text=>el('td',{text}))));
   preview.replaceChildren(...[el('h2',{text:'Revisá antes de guardar'}),el('p',{text:acc.name+' · '+zone.value+(report?.login?' · MT5 '+report.login:'')}),
    el('div',{className:'journal-kpis'},[el('strong',{text:result.created+' nuevas'}),el('strong',{text:result.duplicates+' ya cargadas'}),el('strong',{text:result.invalid+' inválidas'}),el('strong',{text:'Neto nuevo: '+money(net,acc.currency)})]),
    report&&!known?el('label',{className:'journal-confirm'},[acknowledge,el('span',{text:'Confirmo que el informe MT5 '+(report.login||'sin número identificado')+' pertenece a '+acc.name})]):null,
    ...result.errors.map(e=>el('p',{className:'err',text:'Posición '+(e.id||'—')+': '+e.error})),
    el('div',{className:'table-wrap'},[table]),
    el('p',{className:'hint',text:'Las posiciones ya cargadas se omiten. El depósito inicial del informe no se suma otra vez. Si cargaste operaciones a mano, revisá el historial para evitar duplicarlas.'})].filter(Boolean));
   pending={csv,options,name:chosen.name,details:report?.details};confirm.disabled=!ready();
  }catch(e){if(v===version){pending=null;err.textContent=e.message;}}
 });
 confirm.addEventListener('click',async()=>{
  if(!pending||busy||confirm.disabled)return;busy=true;confirm.disabled=true;account.disabled=zone.disabled=file.disabled=true;
  try{
   const result=await syncMt5Csv(pending.csv,ctx.stage.id,{...pending.options,htmlDetails:pending.details});
   const current=await getMeta();await putMeta({...current,mt5Sync:{...pending.options,fileName:pending.name,lastSyncAt:new Date().toISOString(),report:result}});
   await setActiveAccount(pending.options.accountId);
   preview.replaceChildren(el('h2',{text:result.created+' operaciones importadas'}),el('p',{text:result.duplicates+' ya estaban cargadas. Tus resultados y el saldo ya están actualizados.'}),el('div',{className:'journal-actions'},[link('Ver operaciones','historial?account='+pending.options.accountId),link('Ver estadísticas','numeros?account='+pending.options.accountId+'&universe='+(pending.options.context==='DEMO'?'DEMO':'REAL')),link('Ver saldo','cuentas?account='+pending.options.accountId)]));
   pending=null;file.value='';
  }catch(e){err.textContent='No se completó la importación: '+e.message+'. Revisá el historial antes de repetir; las posiciones MT5 ya guardadas se omitirán.';pending=null;file.value='';}
  finally{busy=false;account.disabled=zone.disabled=file.disabled=false;}
 });
 return [el('section',{className:'panel form'},[el('p',{className:'kicker',text:'MT5 → Journal → Resultados'}),el('h1',{text:'Importar operaciones'}),el('p',{className:'meta',text:'Subí el informe HTML de MT5 directamente. También podés usar el CSV del exportador MACA.'}),
  el('ol',{className:'journal-guide'},[el('li',{text:'En MT5: Historial → Todo el historial → Informe HTML.'}),el('li',{text:'Elegí aquí la cuenta y el horario del servidor del broker.'}),el('li',{text:'Seleccioná el archivo, revisá las posiciones y confirmá.'})]),
  !accounts.length?el('p',{},[el('span',{text:'Todavía no tenés una cuenta. '}),link('Crear cuenta','cuentas/nueva')]):null,
  field('1. Cuenta destino',account),field('2. Zona horaria de MT5',zone),el('p',{className:'hint',text:'Es el horario del servidor, no el de tu computadora. Queda recordado para la última cuenta importada.'}),field('3. Informe HTML o archivo CSV',file),err,preview,confirm,
  link('Respaldos y exportación','sistema')])];
}
