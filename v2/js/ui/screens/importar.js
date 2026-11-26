import { el } from '../render.js';
import { field } from '../forms/observation.js';
import { decodeMt5File, parseMt5Html } from '../../adapters/mt5-html.js';
import { parseMt5Csv } from '../../adapters/mt5.js';
import { listStageAccounts, getActiveAccount, setActiveAccount } from '../../domain/account.js';
import { previewMt5Csv, syncMt5Csv } from '../../domain/trade.js';
import { importHistoryPanel } from '../import-history.js';
import { getMeta, putMeta } from '../../storage/repos/meta.js';
import { MT5_SOURCE_TIMEZONES } from '../../config.js';
import { money, link, label } from '../journal-insights.js';
import { go } from '../router.js';
import { importPreference,saveImportPreference } from '../../domain/import-preferences.js';
import { TRADOVATE_SOURCE_TIMEZONES } from '../../config.js';
import { isTradovatePerformanceCsv } from '../../adapters/tradovate.js';
import { previewVantagePaste, syncVantagePaste } from '../../domain/vantage-import.js';
import { previewTradovateCsv, syncTradovateCsv, tradovateCommissionSummary, applyTradovateCommissions } from '../../domain/tradovate-import.js';

// ---------- piezas visuales comunes (solo diseño) ----------
// Botón «Elegir archivo» en español en lugar del control del navegador.
function filePicker(input){
 input.classList.add('file-native');
 const name=el('span',{className:'file-name',text:'Ningún archivo seleccionado'});
 const sync=()=>{name.textContent=input.files&&input.files[0]?input.files[0].name:'Ningún archivo seleccionado';};
 input.addEventListener('change',sync);
 const node=el('label',{className:'file-pick'},[input,el('span',{className:'file-btn',text:'Elegir archivo'}),name]);
 return {node,clear(){input.value='';sync();}};
}
// Ayuda plegada detrás de un botón «?».
function help(title,items){return el('details',{className:'help-pop'},[el('summary',{'aria-label':'Cómo hacerlo',title:'Cómo hacerlo',text:'?'}),el('div',{className:'help-body'},[el('strong',{text:title}),el('ol',{},items.map(text=>el('li',{text})))])]);}
function panelHead(title,line,helpTitle,steps){return el('div',{className:'import-head'},[el('div',{},[el('h2',{text:title}),el('p',{className:'meta',text:line})]),help(helpTitle,steps)]);}
// Barra final: aviso de qué falta + botón principal a la derecha.
function actionBar(confirm,note){confirm.classList.add('btn-primary');return el('div',{className:'import-actionbar'},[note,confirm]);}
function setReady(confirm,note,base,{created,ready,why}){confirm.textContent=created>0?'Importar '+created+(created===1?' operación':' operaciones'):base;note.textContent=ready?'':why;}

export async function renderImportar(ctx){
 const accounts=await listStageAccounts(ctx.stage.id),active=await getActiveAccount();let meta=await getMeta();
 const account=el('select',{className:'input',name:'import-account'},[el('option',{value:'',text:'Elegí la cuenta destino'}),...accounts.map(a=>el('option',{value:a.id,text:a.name+' · '+label(a.context)}))]);
 account.value=ctx.route.query.account||(accounts.some(a=>a.id===meta.mt5LastAccountId)?meta.mt5LastAccountId:null)||active?.id||meta.mt5Sync?.accountId|| (accounts.length===1?accounts[0].id:'');
 const zone=el('select',{className:'input',name:'import-zone'},[el('option',{value:'',text:'Elegí la zona horaria del servidor'}),...MT5_SOURCE_TIMEZONES.map(z=>el('option',{value:z,text:z}))]);
 const broker=el('input',{className:'input',name:'import-broker',placeholder:'Ej.: Bullfy · servidor MT5'}),sourceLogin=el('input',{className:'input',name:'import-login',inputmode:'numeric',placeholder:'Ej.: 162724'});
 const saved=el('p',{role:'status',className:'hint'}),saveSettings=el('button',{type:'button',className:'ghost',text:'Guardar este origen'});
 function restoreSettings(){const pref=importPreference(meta,account.value);zone.value=pref?.timeZone||'';broker.value=pref?.broker||'';sourceLogin.value=pref?.login||accounts.find(a=>a.id===account.value)?.mt5Login||'';saved.textContent=pref?'Origen recordado para esta cuenta. Podés corregirlo aquí.':'';}
 restoreSettings();
 const file=el('input',{type:'file',className:'input',name:'mt5-report',accept:'.html,.htm,.csv,.txt'}),picker=filePicker(file);
 const preview=el('div',{'aria-live':'polite'}),err=el('p',{className:'err',role:'alert'});
 const BASE='Importar operaciones',confirm=el('button',{type:'button',text:BASE,disabled:true});confirm.disabled=true;const note=el('span',{className:'hint',text:'Elegí la cuenta, el horario y el informe.'});
 let pending=null,version=0,busy=false;
 function invalidate(){version++;pending=null;confirm.disabled=true;preview.replaceChildren();err.textContent='';setReady(confirm,note,BASE,{created:0,ready:false,why:'Elegí la cuenta, el horario y el informe.'});}
 account.addEventListener('change',()=>{invalidate();restoreSettings();picker.clear();});
 zone.addEventListener('change',()=>{invalidate();picker.clear();});
 for(const input of [broker,sourceLogin])input.addEventListener('input',()=>{invalidate();picker.clear();});
 saveSettings.onclick=async()=>{saveSettings.disabled=true;try{await saveImportPreference(account.value,{timeZone:zone.value,broker:broker.value,login:sourceLogin.value});meta=await getMeta();saved.textContent='Guardado: esta cuenta recordará su broker, número MT5 y horario.';}catch(e){err.textContent=e.message;}finally{saveSettings.disabled=false;}};
 const drop=el('div',{className:'import-drop',tabindex:'0','aria-label':'Arrastrá aquí un informe HTML o CSV'},[el('strong',{text:'Arrastrá aquí tu informe HTML o CSV'}),el('p',{className:'hint',text:'O elegilo desde tu computadora. Primero indicá cuenta y horario.'}),picker.node]);
 drop.addEventListener('dragover',e=>{e.preventDefault();if(!busy)drop.classList.add('is-dragging');});
 drop.addEventListener('dragleave',()=>drop.classList.remove('is-dragging'));
 drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('is-dragging');if(busy)return;const files=e.dataTransfer?.files;if(files?.length!==1){invalidate();err.textContent='Arrastrá un solo informe por vez.';return;}loadFile(files[0]);});
 file.addEventListener('change',()=>loadFile(file.files[0]));
 async function loadFile(chosen){
  if(busy)return;invalidate();if(!chosen)return;
  const v=version,acc=accounts.find(a=>a.id===account.value);
  try{
   if(!acc||!zone.value)throw new Error('Primero elegí la cuenta y la zona horaria. Después seleccioná el informe.');
   if(!/\.(html?|csv|txt)$/i.test(chosen.name))throw new Error('Elegí un informe HTML o un CSV compatible.');
   if(chosen.size>20*1024*1024)throw new Error('El archivo supera 20 MB. Exportá un período más corto.');
   const text=decodeMt5File(await chosen.arrayBuffer()),html=/\.html?$/i.test(chosen.name)||/^\s*(?:<!doctype|<html)/i.test(text);
   const report=html?parseMt5Html(text):null,csv=report?report.csv:text;
   const login=sourceLogin.value.trim()||acc.mt5Login||acc.name.match(/\b\d{5,}\b/)?.[0];
   if(report?.login&&login&&report.login!==login)throw new Error('El informe es de la cuenta '+report.login+', pero elegiste '+acc.name+'. Cambiá la cuenta destino.');
   if(report?.currency&&report.currency!==acc.currency)throw new Error('La moneda del informe ('+report.currency+') no coincide con la cuenta ('+acc.currency+').');
   const parsed=parseMt5Csv(csv),ids=parsed.rows.map(r=>r.rec.ID);
   const sourceIds=[...new Set(parsed.rows.map(r=>String(r.rec.Cuenta||'').trim()).filter(Boolean))];
   const exportNotes=parsed.rows.map(r=>r.rec.Notas||'').filter(n=>n.startsWith('MACA_AUTO_V1|'));
   const currencies=[...new Set(exportNotes.map(n=>n.match(/\|currency=([A-Z]{3})(?:\||$)/)?.[1]).filter(Boolean))];
   if(currencies.some(c=>c!==acc.currency))throw new Error('La moneda del exportador no coincide con la cuenta destino.');
   if(sourceIds.length>1)throw new Error('El archivo contiene más de una cuenta MT5. Separá los informes por cuenta.');
   const detectedLogin=report?.login||(/^\d+$/.test(sourceIds[0]||'')?sourceIds[0]:'');
   if(login&&detectedLogin&&String(login)!==detectedLogin)throw new Error('El informe es de la cuenta '+detectedLogin+', pero elegiste '+acc.name+'. Cambiá la cuenta destino.');
   if(new Set(ids).size!==ids.length)throw new Error('El archivo repite IDs. Revisalo antes de importar.');
   const options={accountId:acc.id,context:acc.context,timeZone:zone.value};
   const result=await previewMt5Csv(csv,options);if(v!==version)return;
   const net=result.drafts.reduce((s,t)=>s+Math.round(t.netPnl*100),0)/100;
   const known=Boolean(login&&detectedLogin);
   const acknowledge=el('input',{type:'checkbox','aria-label':'Confirmo que el informe pertenece a esta cuenta'});
   const ready=()=>result.invalid===0&&result.unknownSymbols===0&&result.created>0&&(!report||known||acknowledge.checked);
   const upd=()=>{confirm.disabled=!ready();setReady(confirm,note,BASE,{created:result.created,ready:ready(),why:result.created>0?'Marcá la casilla de confirmación de arriba.':'No hay operaciones nuevas para importar.'});};acknowledge.addEventListener('change',upd);
   const table=el('table',{className:'journal-table'});
   table.append(el('tr',{},['Posición','Activo','Apertura (servidor)','Neto'].map(text=>el('th',{text}))));
   for(const {rec} of parsed.rows.slice(0,100)) table.append(el('tr',{},[rec.ID,rec.Activo,rec.Fecha+' '+rec.Hora,money(rec['B/P Neto'],acc.currency)].map(text=>el('td',{text}))));
   preview.replaceChildren(...[el('h3',{text:'Vista previa'}),el('p',{className:'meta',text:chosen.name}),el('p',{className:'meta',text:acc.name+' · '+zone.value+(report?.login?' · MT5 '+report.login:'')}),
    el('div',{className:'journal-kpis'},[el('strong',{text:result.created+' nuevas'}),el('strong',{text:result.duplicates+' ya cargadas'}),el('strong',{text:result.invalid+' inválidas'}),el('strong',{text:'Neto nuevo: '+money(net,acc.currency)})]),
    report&&!known?el('label',{className:'journal-confirm'},[acknowledge,el('span',{text:'Confirmo que el informe MT5 '+(report.login||'sin número identificado')+' pertenece a '+acc.name})]):null,
    ...result.errors.map(e=>el('p',{className:'err',text:'Posición '+(e.id||'—')+': '+e.error})),
    el('div',{className:'table-wrap'},[table]),
    el('p',{className:'hint',text:'Las posiciones ya cargadas se omiten. El depósito inicial del informe no se suma otra vez. Si cargaste operaciones a mano, revisá el historial para evitar duplicarlas.'})].filter(Boolean));
   pending={csv,options,name:chosen.name,details:report?.details,login:detectedLogin||login||'',broker:broker.value||exportNotes[0]?.match(/\|server=([^|]+)/)?.[1]||''};upd();
  }catch(e){if(v===version){pending=null;err.textContent=e.message;}}
 }
 confirm.addEventListener('click',async()=>{
  if(!pending||busy||confirm.disabled)return;busy=true;confirm.disabled=true;account.disabled=zone.disabled=file.disabled=broker.disabled=sourceLogin.disabled=saveSettings.disabled=true;
  try{
   const result=await syncMt5Csv(pending.csv,ctx.stage.id,{...pending.options,htmlDetails:pending.details});
   const current=await getMeta();await putMeta({...current,mt5Sync:{...pending.options,fileName:pending.name,lastSyncAt:new Date().toISOString(),report:result}});
   await saveImportPreference(pending.options.accountId,{timeZone:pending.options.timeZone,broker:pending.broker,login:pending.login});meta=await getMeta();restoreSettings();
   await setActiveAccount(pending.options.accountId);
   preview.replaceChildren(el('h2',{text:result.created+' operaciones importadas'}),el('p',{text:result.duplicates+' ya estaban cargadas. Tus resultados y el saldo ya están actualizados.'}),el('div',{className:'journal-actions'},[link('Ver operaciones','historial?account='+pending.options.accountId),link('Ver estadísticas','numeros?account='+pending.options.accountId+'&universe='+(pending.options.context==='DEMO'?'DEMO':'REAL')),link('Ver saldo','cuentas?account='+pending.options.accountId)]));
   confirm.textContent=BASE;note.textContent='';pending=null;picker.clear();
  }catch(e){err.textContent='No se completó la importación: '+e.message+'. Revisá el historial antes de repetir; las posiciones MT5 ya guardadas se omitirán.';pending=null;picker.clear();}
  finally{busy=false;account.disabled=zone.disabled=file.disabled=broker.disabled=sourceLogin.disabled=saveSettings.disabled=false;}
 });
 const mt5=el('section',{className:'panel form import-panel',id:'importar-mt5'},[panelHead('Importar desde MT5','Informe HTML de MT5 o CSV del exportador MACA.','Cómo bajar el informe de MT5',['En MT5: Historial → Todo el historial → Informe HTML.','Acá: elegí la cuenta y el horario del servidor del broker.','Elegí el archivo, revisá la vista previa y tocá Importar.']),
  !accounts.length?el('p',{},[el('span',{text:'Todavía no tenés una cuenta. '}),link('Crear cuenta','cuentas/nueva')]):null,
  el('div',{className:'import-grid'},[field('Cuenta destino',account),field('Horario del servidor',zone),field('Broker / servidor (opcional)',broker),field('Número de cuenta MT5 (opcional)',sourceLogin)]),
  el('p',{className:'hint',text:'Es el horario del servidor, no el de tu computadora. Se recuerda por cuenta.'}),el('div',{className:'import-inline'},[saveSettings,saved]),field('Informe HTML o CSV',drop),err,preview,actionBar(confirm,note),
  el('details',{className:'import-more'},[el('summary',{text:'Exportador de MT5: generar el CSV cada minuto'}),el('p',{className:'hint',text:'Preparado y compilado. Requiere instalarlo y verificar el primer archivo en MT5. Genera el CSV con MT5 abierto; después lo arrastrás aquí y confirmás.'}),el('a',{className:'journal-link',href:'./mt5/MacaAutoExport.zip',download:'MacaAutoExport.zip',text:'Descargar exportador e instrucciones'}),el('p',{className:'hint',text:'No abre operaciones. La sincronización directa con el journal todavía no está habilitada.'})])].filter(Boolean));
 const panels={tradovate:await tradovatePanel(ctx,accounts,active),vantage:await vantagePanel(ctx,accounts,active),mt5};
 const tabs=el('div',{className:'broker-tabs',role:'tablist','aria-label':'Elegí de dónde importar'});
 const intro=el('p',{className:'meta broker-intro',text:'Elegí de dónde querés importar tus operaciones.'});
 const choose=(key)=>{for(const [k,node] of Object.entries(panels)){node.hidden=k!==key;}for(const b of tabs.children){const on=b.dataset.key===key;b.setAttribute('aria-selected',String(on));b.classList.toggle('is-on',on);}intro.hidden=Boolean(key);};
 for(const [key,text] of [['tradovate','Tradovate'],['vantage','Vantage'],['mt5','MT5']])tabs.append(el('button',{type:'button',className:'broker-tab',role:'tab','aria-selected':'false','data-key':key,text,onclick:()=>choose(key)}));
 const start=['tradovate','vantage','mt5'].includes(ctx.route.query.origen)?ctx.route.query.origen:'';
 choose(start);
 return [el('section',{className:'panel import-picker'},[tabs,intro]),panels.tradovate,panels.vantage,panels.mt5,await importHistoryPanel(ctx)];
}

// Cuenta propuesta para cada importador: la del link, la última usada, la que encaja con el broker, o la única.
function pickImportAccount(list, { queryId, lastId, prefer } = {}) {
 const has = (id) => id && list.some((a) => a.id === id);
 if (has(queryId)) return queryId;
 if (has(lastId)) return lastId;
 const p = prefer ? list.find(prefer) : null;
 if (p) return p.id;
 return list.length === 1 ? list[0].id : '';
}

// ---------- Tradovate (CSV de Informes de cuenta → Desempeño) ----------
async function tradovatePanel(ctx, accounts, active) {
 const meta = await getMeta();
 const pref = meta?.tradovateImport || {};
 const tvAccounts = accounts.filter(a => a.context !== 'LIVE' && !/vantage/i.test(a.name)).length ? accounts.filter(a => a.context !== 'LIVE' && !/vantage/i.test(a.name)) : accounts;
 const account = el('select', { className: 'input', name: 'tv-account' }, [el('option', { value: '', text: 'Elegí la cuenta destino' }), ...tvAccounts.map(a => el('option', { value: a.id, text: a.name + ' · ' + label(a.context) }))]);
 account.value = pickImportAccount(tvAccounts, { queryId: ctx.route.query.account, lastId: pref.accountId, prefer: a => a.id === active?.id });
 const zone = el('select', { className: 'input', name: 'tv-zone' }, TRADOVATE_SOURCE_TIMEZONES.map(z => el('option', { value: z, text: z === 'Europe/Rome' ? 'Europe/Rome (hora de Italia)' : z === 'America/Chicago' ? 'America/Chicago (CST)' : z })));
 zone.value = TRADOVATE_SOURCE_TIMEZONES.includes(pref.timeZone) ? pref.timeZone : 'Europe/Rome';
 const fee = el('input', { className: 'input', name: 'tv-fee', inputmode: 'decimal', placeholder: 'Ej.: 1.00 (vacío = sin descontar)', value: pref.fee ?? '' });
 const file = el('input', { type: 'file', className: 'input', name: 'tv-report', accept: '.csv,.txt' }), picker = filePicker(file);
 const preview = el('div', { 'aria-live': 'polite' }), err = el('p', { className: 'err', role: 'alert' });
 const BASE = 'Importar operaciones', WHY = 'Elegí la cuenta y el CSV de Desempeño.', confirm = el('button', { type: 'button', text: BASE, disabled: true }); confirm.disabled = true; const note = el('span', { className: 'hint', text: WHY });
 let pending = null, version = 0, busy = false;
 const invalidate = () => { version++; pending = null; confirm.disabled = true; preview.replaceChildren(); err.textContent = ''; setReady(confirm, note, BASE, { created: 0, ready: false, why: WHY }); };
 for (const c of [account, zone]) c.addEventListener('change', () => { invalidate(); picker.clear(); });
 account.addEventListener('change', () => refreshFees());
 fee.addEventListener('input', () => { invalidate(); picker.clear(); });
 const feeValue = () => { const raw = String(fee.value || '').trim().replace(',', '.'); if (!raw) return null; const n = Number(raw); if (!Number.isFinite(n) || n < 0) throw new Error('La comisión tiene que ser un número mayor o igual a 0.'); return n; };
 const drop = el('div', { className: 'import-drop', tabindex: '0', 'aria-label': 'Arrastrá aquí el CSV de Desempeño de Tradovate' }, [el('strong', { text: 'Arrastrá aquí el CSV de Desempeño' }), el('p', { className: 'hint', text: 'O elegilo desde tu computadora. Primero indicá la cuenta.' }), picker.node]);
 drop.addEventListener('dragover', e => { e.preventDefault(); if (!busy) drop.classList.add('is-dragging'); });
 drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
 drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('is-dragging'); if (busy) return; const files = e.dataTransfer?.files; if (files?.length !== 1) { invalidate(); err.textContent = 'Arrastrá un solo archivo por vez.'; return; } loadFile(files[0]); });
 file.addEventListener('change', () => loadFile(file.files[0]));
 async function loadFile(chosen) {
  if (busy) return; invalidate(); if (!chosen) return;
  const v = version, acc = accounts.find(a => a.id === account.value);
  try {
   if (!acc) throw new Error('Primero elegí la cuenta destino. Después seleccioná el archivo.');
   if (!/\.(csv|txt)$/i.test(chosen.name)) throw new Error('Elegí el CSV de Desempeño (Performance) de Tradovate.');
   if (chosen.size > 20 * 1024 * 1024) throw new Error('El archivo supera 20 MB. Exportá un período más corto.');
   if (acc.currency && acc.currency !== 'USD') throw new Error('Tradovate informa en USD y la cuenta ' + acc.name + ' está en ' + acc.currency + '.');
   const text = await chosen.text();
   if (!isTradovatePerformanceCsv(text)) throw new Error(/Account,Order ID|orderId/.test(text.slice(0, 300)) ? 'Este es el CSV de Órdenes. Bajá el de la pestaña «Desempeño», que trae cada trade con su P&L.' : 'No es el CSV de Desempeño de Tradovate.');
   const options = { accountId: acc.id, context: acc.context, timeZone: zone.value, feePerContract: feeValue() };
   const result = await previewTradovateCsv(text, options); if (v !== version) return;
   const cents = result.drafts.reduce((s, t) => s + Math.round(t.netPnl * 100), 0) / 100;
   const acknowledge = el('input', { type: 'checkbox', 'aria-label': 'Confirmo que el archivo es de esta cuenta' });
   const ready = () => result.created > 0 && acknowledge.checked;
   const upd = () => { confirm.disabled = !ready(); setReady(confirm, note, BASE, { created: result.created, ready: ready(), why: result.created > 0 ? 'Marcá la casilla de confirmación de arriba.' : 'No hay operaciones nuevas para importar.' }); }; acknowledge.addEventListener('change', upd);
   const table = el('table', { className: 'journal-table' });
   table.append(el('tr', {}, ['Apertura', 'Activo', 'Dirección', 'Contratos', 'Entrada', 'Salida', 'Neto'].map(text => el('th', { text }))));
   for (const t of result.drafts.slice(0, 200)) table.append(el('tr', {}, [t.sourceRef.openedWall.replace('T', ' '), t.asset, t.direction, String(t.lots), String(t.entry), String(t.exit), money(t.netPnl, acc.currency || 'USD')].map(text => el('td', { text }))));
   preview.replaceChildren(...[el('h3', { text: 'Vista previa' }), el('p', { className: 'meta', text: chosen.name + ' · ' + acc.name + ' · ' + zone.value }),
    el('div', { className: 'journal-kpis' }, [el('strong', { text: result.created + ' nuevas' }), el('strong', { text: result.duplicates + ' ya cargadas' }), el('strong', { text: result.invalid + ' inválidas' }), el('strong', { text: 'Neto nuevo: ' + money(cents, acc.currency || 'USD') })]),
    options.feePerContract == null ? el('p', { className: 'hint', text: 'Sin comisión: el neto es el P&L bruto de Tradovate. Si querés que coincida con el saldo, poné la comisión por contrato.' }) : el('p', { className: 'hint', text: 'Neto = P&L de Tradovate − ' + options.feePerContract + ' USD por contrato.' }),
    el('label', { className: 'journal-confirm' }, [acknowledge, el('span', { text: 'Confirmo que este CSV es de ' + acc.name + ' (el archivo de Tradovate no dice de qué cuenta es).' })]),
    result.errors.length ? el('p', { className: 'meta', text: result.errors.length === 1 ? 'Esta no se importa; las demás sí:' : 'Estas no se importan; las demás sí:' }) : '',
    ...result.errors.map(e => el('p', { className: 'err', text: 'Fila ' + e.index + (e.brokerSymbol ? ' (' + e.brokerSymbol + ')' : '') + ': ' + e.error })),
    el('div', { className: 'table-wrap' }, [table]),
    el('p', { className: 'hint', text: 'Los trades ya cargados se omiten, así que podés subir el mismo rango otra vez. Quedan sin estrategia: clasificalos desde el historial.' })]);
   pending = { text, options }; upd();
  } catch (e) { if (v === version) { pending = null; err.textContent = e.message; } }
 }
 confirm.addEventListener('click', async () => {
  if (!pending || busy || confirm.disabled) return; busy = true; confirm.disabled = true; account.disabled = zone.disabled = fee.disabled = file.disabled = true;
  try {
   const result = await syncTradovateCsv(pending.text, ctx.stage.id, pending.options);
   const current = await getMeta(); await putMeta({ ...current, tradovateImport: { timeZone: pending.options.timeZone, fee: pending.options.feePerContract ?? '', accountId: pending.options.accountId } });
   await setActiveAccount(pending.options.accountId);
   preview.replaceChildren(el('h2', { text: result.created + ' operaciones importadas' }), el('p', { text: result.duplicates + ' ya estaban cargadas. Tus resultados y el saldo ya están actualizados.' }), el('div', { className: 'journal-actions' }, [link('Ver operaciones', 'historial?account=' + pending.options.accountId), link('Ver estadísticas', 'numeros?account=' + pending.options.accountId + '&universe=' + (pending.options.context === 'DEMO' ? 'DEMO' : 'REAL')), link('Ver saldo', 'cuentas?account=' + pending.options.accountId)]));
   confirm.textContent = BASE; note.textContent = ''; pending = null; picker.clear(); refreshFees();
  } catch (e) { err.textContent = 'No se completó la importación: ' + e.message + '. Revisá el historial antes de repetir; los trades ya guardados se omitirán.'; pending = null; picker.clear(); }
  finally { busy = false; account.disabled = zone.disabled = fee.disabled = file.disabled = false; }
 });
 // Comisiones de trades ya importados: neto = P&L bruto de Tradovate − comisión × contratos.
 const feesBox = el('div', { className: 'tv-fees', id: 'tradovate-comisiones' });
 async function refreshFees() {
  const acc = accounts.find(a => a.id === account.value);
  if (!acc) { feesBox.replaceChildren(); return; }
  const rows = await tradovateCommissionSummary(acc.id);
  if (!rows.length) { feesBox.replaceChildren(); return; }
  const cur = acc.currency || 'USD', inputs = {}, msg = el('p', { role: 'status', className: 'hint' }), ferr = el('p', { className: 'err', role: 'alert' });
  const total = el('strong', {});
  const calc = () => { let net = 0; try { for (const r of rows) { const raw = String(inputs[r.asset].value || '').trim().replace(',', '.'); const f = raw === '' ? null : Number(raw); if (f != null && (!Number.isFinite(f) || f < 0)) throw new Error('Comisión inválida en ' + r.asset); net += f == null ? r.net : r.gross - f * r.contracts; } ferr.textContent = ''; total.textContent = 'Neto con estas comisiones: ' + money(Math.round(net * 100) / 100, cur); } catch (e) { ferr.textContent = e.message; total.textContent = ''; } };
  const table = el('table', { className: 'journal-table' });
  table.append(el('tr', {}, ['Activo', 'Trades', 'Contratos', 'Bruto', 'Comisión actual', 'Neto actual', 'Comisión por contrato (USD)'].map(text => el('th', { text }))));
  for (const r of rows) {
   inputs[r.asset] = el('input', { className: 'input', name: 'tv-fee-' + r.asset, inputmode: 'decimal', placeholder: 'Ej.: 1.00', value: r.commission && !r.mixed ? String(r.feePerContract) : '' });
   inputs[r.asset].addEventListener('input', calc);
   table.append(el('tr', {}, [el('td', { text: r.asset }), el('td', { text: String(r.trades) }), el('td', { text: String(r.contracts) }), el('td', { text: money(r.gross, cur) }), el('td', { text: r.mixed ? 'varía' : money(r.commission, cur) }), el('td', { text: money(r.net, cur) }), el('td', {}, [inputs[r.asset]])]));
  }
  const apply = el('button', { type: 'button', className: 'ghost', text: 'Aplicar comisiones' });
  apply.addEventListener('click', async () => {
   apply.disabled = true; msg.textContent = '';
   try {
    const fees = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
    const res = await applyTradovateCommissions(acc.id, fees);
    await refreshFees();
    feesBox.querySelector('[role=status]').textContent = res.updated + ' trades actualizados' + (res.unchanged ? ' · ' + res.unchanged + ' ya estaban así' : '') + '. El saldo y las estadísticas ya usan el neto.';
   } catch (e) { ferr.textContent = e.message; apply.disabled = false; }
  });
  calc();
  feesBox.replaceChildren(el('h3', { text: 'Comisiones de trades ya importados' }), el('p', { className: 'hint', text: 'Para ' + acc.name + '. El neto se recalcula desde el P&L bruto de Tradovate, así que podés corregirlo las veces que quieras. Dejá vacío un activo para no tocarlo.' }), el('div', { className: 'table-wrap' }, [table]), total, ferr, apply, msg);
 }
 await refreshFees();
 return el('section', { className: 'panel form import-panel', id: 'importar-tradovate' }, [panelHead('Importar desde Tradovate', 'Para MNQ y demás futuros: CSV de Desempeño.', 'Cómo bajar el CSV de Tradovate', ['En Tradovate: Informes de cuenta → elegí la cuenta → pestaña Desempeño.', 'En Fecha elegí el rango (De / Para), tocá Ir y después Descargar CSV.', 'Acá: elegí la misma cuenta, elegí el archivo, revisá la vista previa y tocá Importar.']),
  !accounts.length ? el('p', {}, [el('span', { text: 'Todavía no tenés una cuenta. ' }), link('Crear cuenta', 'cuentas/nueva')]) : null,
  el('div', { className: 'import-grid' }, [field('Cuenta destino', account), field('Horario del archivo', zone), field('Comisión por contrato, ida y vuelta (USD, opcional)', fee)]),
  el('p', { className: 'hint', text: 'Tradovate exporta con el horario de tu navegador; si operás desde Italia, dejá Europe/Rome.' }),
  field('CSV de Desempeño', drop), err, preview, actionBar(confirm, note), feesBox].filter(Boolean));
}

// ---------- Vantage (texto copiado de «Historial de posiciones» del portal) ----------
async function vantagePanel(ctx, accounts, active) {
 const meta = await getMeta();
 const isProp = a => a.context === 'PROP_CHALLENGE' || a.context === 'FUNDED';
 const vtAccounts = accounts.filter(a => !isProp(a)).length ? accounts.filter(a => !isProp(a)) : accounts;
 const account = el('select', { className: 'input', name: 'vt-account' }, [el('option', { value: '', text: 'Elegí la cuenta destino' }), ...vtAccounts.map(a => el('option', { value: a.id, text: a.name + ' · ' + label(a.context) }))]);
 account.value = pickImportAccount(vtAccounts, { queryId: ctx.route.query.account, lastId: meta?.vantageImport?.accountId, prefer: a => /vantage/i.test(a.name) });
 const zone = el('select', { className: 'input', name: 'vt-zone' }, MT5_SOURCE_TIMEZONES.map(z => el('option', { value: z, text: z === 'Europe/Athens' ? 'Europe/Athens (servidor de Vantage, GMT+2)' : z })));
 zone.value = MT5_SOURCE_TIMEZONES.includes(meta?.vantageImport?.timeZone) ? meta.vantageImport.timeZone : 'Europe/Athens';
 const text = el('textarea', { className: 'input', name: 'vt-text', rows: 10, placeholder: 'Pegá aquí lo que copiaste de Historial de posiciones (Buy / NAS100 / 0.1/0.1 / precios / P&L / fechas / #posición / Cerrado…)' });
  const preview = el('div', { 'aria-live': 'polite' }), err = el('p', { className: 'err', role: 'alert' });
 const BASE = 'Importar operaciones', WHY = 'Elegí la cuenta y pegá el historial.', confirm = el('button', { type: 'button', text: BASE, disabled: true }); confirm.disabled = true; const note = el('span', { className: 'hint', text: WHY });
 let pending = null, version = 0, busy = false;
 const invalidate = () => { version++; pending = null; confirm.disabled = true; preview.replaceChildren(); err.textContent = ''; setReady(confirm, note, BASE, { created: 0, ready: false, why: WHY }); };
 // Vista previa automática: al pegar o cambiar la cuenta/horario (sin botón «Revisar»).
 let timer = null;
 const schedule = (ms) => { invalidate(); clearTimeout(timer); if (!String(text.value || '').trim()) return; timer = setTimeout(review, ms); };
 for (const c of [account, zone]) c.addEventListener('change', () => schedule(0));
 text.addEventListener('input', () => schedule(400));
 async function review() {
  if (busy) return; invalidate();
  const v = version, acc = accounts.find(a => a.id === account.value);
  try {
   if (!acc) throw new Error('Primero elegí la cuenta destino.');
   if (!String(text.value || '').trim()) throw new Error('Pegá el historial de posiciones.');
   const options = { accountId: acc.id, context: acc.context, timeZone: zone.value };
   const result = await previewVantagePaste(text.value, options); if (v !== version) return;
   if (!result.read) throw new Error('No encontré posiciones en el texto. Copiá desde Historial de posiciones (desde el primer Buy/Sell hasta el último «Cerrado»).');
   const cur = acc.currency || 'USD';
   const cents = result.drafts.reduce((s, t) => s + Math.round(t.netPnl * 100), 0) / 100;
   const acknowledge = el('input', { type: 'checkbox', 'aria-label': 'Confirmo que el historial es de esta cuenta' });
   const ready = () => result.created > 0 && acknowledge.checked;
   const upd = () => { confirm.disabled = !ready(); setReady(confirm, note, BASE, { created: result.created, ready: ready(), why: result.created > 0 ? 'Marcá la casilla de confirmación de arriba.' : 'No hay operaciones nuevas para importar.' }); }; acknowledge.addEventListener('change', upd);
   const table = el('table', { className: 'journal-table' });
   table.append(el('tr', {}, ['Apertura (servidor)', 'Activo', 'Dirección', 'Lote', 'Entrada', 'Salida', 'Neto'].map(t => el('th', { text: t }))));
   for (const t of result.drafts.slice(0, 300)) table.append(el('tr', {}, [t.sourceRef.openedWall.replace('T', ' '), t.asset, t.direction, String(t.lots), String(t.entry), String(t.exit), money(t.netPnl, cur)].map(x => el('td', { text: x }))));
   preview.replaceChildren(...[el('h3', { text: 'Vista previa' }), el('p', { className: 'meta', text: acc.name + ' · ' + zone.value }),
    el('div', { className: 'journal-kpis' }, [el('strong', { text: result.created + ' nuevas' }), el('strong', { text: result.duplicates + ' ya cargadas' }), el('strong', { text: result.invalid + ' inválidas' }), el('strong', { text: 'Neto nuevo: ' + money(cents, cur) })]),
    result.truncated ? el('p', { className: 'err', text: 'El final del texto quedó cortado (' + result.truncated + ' posición incompleta). Esa no se importa: copiala de nuevo junto con las que falten.' }) : null,
    el('label', { className: 'journal-confirm' }, [acknowledge, el('span', { text: 'Confirmo que este historial es de ' + acc.name + '.' })]),
    result.errors.length ? el('p', { className: 'meta', text: result.errors.length === 1 ? 'Esta no se importa; las demás sí:' : 'Estas no se importan; las demás sí:' }) : '',
    ...result.errors.map(e => el('p', { className: 'err', text: 'Posición ' + (e.id || '—') + (e.brokerSymbol ? ' (' + e.brokerSymbol + ')' : '') + ': ' + e.error })),
    el('div', { className: 'table-wrap' }, [table]),
    el('p', { className: 'hint', text: 'Las ya cargadas se omiten, así que podés pegar el historial entero cada vez.' })].filter(Boolean));
   pending = { text: text.value, options }; upd();
  } catch (e) { if (v === version) { pending = null; err.textContent = e.message; } }
 }
 confirm.addEventListener('click', async () => {
  if (!pending || busy || confirm.disabled) return; busy = true; confirm.disabled = true; account.disabled = zone.disabled = text.disabled = true;
  try {
   const result = await syncVantagePaste(pending.text, ctx.stage.id, pending.options);
   const current = await getMeta(); await putMeta({ ...current, vantageImport: { timeZone: pending.options.timeZone, accountId: pending.options.accountId } });
   await setActiveAccount(pending.options.accountId);
   preview.replaceChildren(el('h2', { text: result.created + ' operaciones importadas' }), el('p', { text: result.duplicates + ' ya estaban cargadas. Tus resultados y el saldo ya están actualizados.' }), el('div', { className: 'journal-actions' }, [link('Ver operaciones', 'historial?account=' + pending.options.accountId), link('Ver saldo', 'cuentas?account=' + pending.options.accountId)]));
   confirm.textContent = BASE; note.textContent = ''; pending = null; text.value = '';
  } catch (e) { err.textContent = 'No se completó la importación: ' + e.message; pending = null; }
  finally { busy = false; account.disabled = zone.disabled = text.disabled = false; }
 });
 return el('section', { className: 'panel form import-panel', id: 'importar-vantage' }, [panelHead('Importar desde Vantage', 'Copiás el historial del portal y lo pegás acá. La vista previa aparece sola.', 'Cómo copiar el historial de Vantage', ['En el portal de Vantage: Web Trader → elegí la cuenta → abajo, Historial de posiciones.', 'Seleccioná desde el primer Buy/Sell hasta el último «Cerrado» y copiá (Ctrl+C).', 'Acá: elegí la cuenta, pegá, revisá la vista previa y tocá Importar.']),
  el('div', { className: 'import-grid' }, [field('Cuenta destino', account), field('Horario del servidor', zone)]),
  el('p', { className: 'hint', text: 'El portal muestra la hora del servidor (GMT+2 en invierno, GMT+3 en verano): Europe/Athens lo convierte bien.' }),
  field('Historial copiado', text), err, preview, actionBar(confirm, note)]);
}
