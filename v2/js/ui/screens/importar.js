import { el } from '../render.js';
import { deleteButton } from '../delete-button.js';
import { field } from '../forms/observation.js';
import { decodeMt5File, parseMt5Html } from '../../adapters/mt5-html.js';
import { parseMt5Csv } from '../../adapters/mt5.js';
import { listStageAccounts, getActiveAccount, setActiveAccount } from '../../domain/account.js';
import { previewMt5Csv, syncMt5Csv } from '../../domain/trade.js';
import { getMeta, putMeta } from '../../storage/repos/meta.js';
import { MT5_SOURCE_TIMEZONES } from '../../config.js';
import { money, link, label } from '../journal-insights.js';
import { go } from '../router.js';
import { importPreference,saveImportPreference } from '../../domain/import-preferences.js';
import { TRADOVATE_SOURCE_TIMEZONES } from '../../config.js';
import { isTradovatePerformanceCsv } from '../../adapters/tradovate.js';
import { previewVantagePaste, syncVantagePaste } from '../../domain/vantage-import.js';
import { previewTradovateCsv, syncTradovateCsv, tradovateCommissionSummary, applyTradovateCommissions } from '../../domain/tradovate-import.js';

export async function renderImportar(ctx){
 const accounts=await listStageAccounts(ctx.stage.id),active=await getActiveAccount();let meta=await getMeta();
 const account=el('select',{className:'input',name:'import-account'},[el('option',{value:'',text:'Elegí la cuenta destino'}),...accounts.map(a=>el('option',{value:a.id,text:a.name+' · '+label(a.context)}))]);
 account.value=ctx.route.query.account||(accounts.some(a=>a.id===meta.mt5LastAccountId)?meta.mt5LastAccountId:null)||active?.id||meta.mt5Sync?.accountId|| (accounts.length===1?accounts[0].id:'');
 const zone=el('select',{className:'input',name:'import-zone'},[el('option',{value:'',text:'Elegí la zona horaria del servidor'}),...MT5_SOURCE_TIMEZONES.map(z=>el('option',{value:z,text:z}))]);
 const broker=el('input',{className:'input',name:'import-broker',placeholder:'Ej.: Bullfy · servidor MT5'}),sourceLogin=el('input',{className:'input',name:'import-login',inputmode:'numeric',placeholder:'Ej.: 162724'});
 const saved=el('p',{role:'status',className:'hint'}),saveSettings=el('button',{type:'button',className:'ghost',text:'Guardar este origen'});
 function restoreSettings(){const pref=importPreference(meta,account.value);zone.value=pref?.timeZone||'';broker.value=pref?.broker||'';sourceLogin.value=pref?.login||accounts.find(a=>a.id===account.value)?.mt5Login||'';saved.textContent=pref?'Origen recordado para esta cuenta. Podés corregirlo aquí.':'';}
 restoreSettings();
 const file=el('input',{type:'file',className:'input',name:'mt5-report',accept:'.html,.htm,.csv,.txt'});
 const preview=el('div',{'aria-live':'polite'}),err=el('p',{className:'err',role:'alert'});
 const confirm=el('button',{type:'button',text:'Importar operaciones',disabled:true});confirm.disabled=true;
 let pending=null,version=0,busy=false;
 function invalidate(){version++;pending=null;confirm.disabled=true;preview.replaceChildren();err.textContent='';}
 account.addEventListener('change',()=>{invalidate();restoreSettings();file.value='';});
 zone.addEventListener('change',()=>{invalidate();file.value='';});
 for(const input of [broker,sourceLogin])input.addEventListener('input',()=>{invalidate();file.value='';});
 saveSettings.onclick=async()=>{saveSettings.disabled=true;try{await saveImportPreference(account.value,{timeZone:zone.value,broker:broker.value,login:sourceLogin.value});meta=await getMeta();saved.textContent='Guardado: esta cuenta recordará su broker, número MT5 y horario.';}catch(e){err.textContent=e.message;}finally{saveSettings.disabled=false;}};
 const drop=el('div',{className:'import-drop',tabindex:'0','aria-label':'Arrastrá aquí un informe HTML o CSV'},[el('strong',{text:'Arrastrá aquí tu informe HTML o CSV'}),el('p',{className:'hint',text:'O elegilo desde tu computadora. Primero indicá cuenta y horario.'}),file]);
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
   acknowledge.addEventListener('change',()=>confirm.disabled=!ready());
   const table=el('table',{className:'journal-table'});
   table.append(el('tr',{},['Posición','Activo','Apertura (servidor)','Neto'].map(text=>el('th',{text}))));
   for(const {rec} of parsed.rows.slice(0,100)) table.append(el('tr',{},[rec.ID,rec.Activo,rec.Fecha+' '+rec.Hora,money(rec['B/P Neto'],acc.currency)].map(text=>el('td',{text}))));
   preview.replaceChildren(...[el('h2',{text:'Revisá antes de guardar'}),el('p',{text:chosen.name}),el('p',{text:acc.name+' · '+zone.value+(report?.login?' · MT5 '+report.login:'')}),
    el('div',{className:'journal-kpis'},[el('strong',{text:result.created+' nuevas'}),el('strong',{text:result.duplicates+' ya cargadas'}),el('strong',{text:result.invalid+' inválidas'}),el('strong',{text:'Neto nuevo: '+money(net,acc.currency)})]),
    report&&!known?el('label',{className:'journal-confirm'},[acknowledge,el('span',{text:'Confirmo que el informe MT5 '+(report.login||'sin número identificado')+' pertenece a '+acc.name})]):null,
    ...result.errors.map(e=>el('p',{className:'err',text:'Posición '+(e.id||'—')+': '+e.error})),
    el('div',{className:'table-wrap'},[table]),
    el('p',{className:'hint',text:'Las posiciones ya cargadas se omiten. El depósito inicial del informe no se suma otra vez. Si cargaste operaciones a mano, revisá el historial para evitar duplicarlas.'})].filter(Boolean));
   pending={csv,options,name:chosen.name,details:report?.details,login:detectedLogin||login||'',broker:broker.value||exportNotes[0]?.match(/\|server=([^|]+)/)?.[1]||''};confirm.disabled=!ready();
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
   pending=null;file.value='';
  }catch(e){err.textContent='No se completó la importación: '+e.message+'. Revisá el historial antes de repetir; las posiciones MT5 ya guardadas se omitirán.';pending=null;file.value='';}
  finally{busy=false;account.disabled=zone.disabled=file.disabled=broker.disabled=sourceLogin.disabled=saveSettings.disabled=false;}
 });
 return [await tradovatePanel(ctx,accounts,active),await vantagePanel(ctx,accounts,active),el('section',{className:'panel form'},[el('p',{className:'kicker',text:'MT5 → Journal → Resultados'}),el('h1',{text:'Importar operaciones'}),el('p',{className:'meta',text:'Subí el informe HTML de MT5 directamente. También podés usar el CSV del exportador MACA.'}),
  el('ol',{className:'journal-guide'},[el('li',{text:'En MT5: Historial → Todo el historial → Informe HTML.'}),el('li',{text:'Elegí aquí la cuenta y el horario del servidor del broker.'}),el('li',{text:'Seleccioná el archivo, revisá las posiciones y confirmá.'})]),
  !accounts.length?el('p',{},[el('span',{text:'Todavía no tenés una cuenta. '}),link('Crear cuenta','cuentas/nueva')]):null,
  field('1. Cuenta destino',account),deleteButton('account',()=>accounts.find(a=>a.id===account.value),'importar'),field('Broker / servidor (opcional)',broker),field('Número de cuenta MT5 (opcional)',sourceLogin),field('2. Zona horaria de MT5',zone),el('p',{className:'hint',text:'Es el horario del servidor, no el de tu computadora. Se recuerda por cuenta y origen; no se copia a otros brokers.'}),saveSettings,saved,field('3. Informe HTML o archivo CSV',drop),err,preview,confirm,
  el('details',{},[el('summary',{text:'Exportador de MT5: generar el CSV cada minuto'}),el('p',{className:'hint',text:'Preparado y compilado. Requiere instalarlo y verificar el primer archivo en MT5. Genera el CSV con MT5 abierto; después lo arrastrás aquí y confirmás.'}),el('a',{className:'journal-link',href:'./mt5/MacaAutoExport.zip',download:'MacaAutoExport.zip',text:'Descargar exportador e instrucciones'}),el('p',{className:'hint',text:'No abre operaciones. La sincronización directa con el journal todavía no está habilitada.'})]),link('Respaldos y exportación','sistema')])];
}

// ---------- Tradovate (CSV de Informes de cuenta → Desempeño) ----------
async function tradovatePanel(ctx, accounts, active) {
 const meta = await getMeta();
 const pref = meta?.tradovateImport || {};
 const account = el('select', { className: 'input', name: 'tv-account' }, [el('option', { value: '', text: 'Elegí la cuenta destino' }), ...accounts.map(a => el('option', { value: a.id, text: a.name + ' · ' + label(a.context) }))]);
 account.value = ctx.route.query.account || active?.id || (accounts.length === 1 ? accounts[0].id : '');
 const zone = el('select', { className: 'input', name: 'tv-zone' }, TRADOVATE_SOURCE_TIMEZONES.map(z => el('option', { value: z, text: z === 'Europe/Rome' ? 'Europe/Rome (hora de Italia)' : z === 'America/Chicago' ? 'America/Chicago (CST)' : z })));
 zone.value = TRADOVATE_SOURCE_TIMEZONES.includes(pref.timeZone) ? pref.timeZone : 'Europe/Rome';
 const fee = el('input', { className: 'input', name: 'tv-fee', inputmode: 'decimal', placeholder: 'Ej.: 1.00 (vacío = sin descontar)', value: pref.fee ?? '' });
 const file = el('input', { type: 'file', className: 'input', name: 'tv-report', accept: '.csv,.txt' });
 const preview = el('div', { 'aria-live': 'polite' }), err = el('p', { className: 'err', role: 'alert' });
 const confirm = el('button', { type: 'button', text: 'Importar operaciones de Tradovate', disabled: true }); confirm.disabled = true;
 let pending = null, version = 0, busy = false;
 const invalidate = () => { version++; pending = null; confirm.disabled = true; preview.replaceChildren(); err.textContent = ''; };
 for (const c of [account, zone]) c.addEventListener('change', () => { invalidate(); file.value = ''; });
 account.addEventListener('change', () => refreshFees());
 fee.addEventListener('input', () => { invalidate(); file.value = ''; });
 const feeValue = () => { const raw = String(fee.value || '').trim().replace(',', '.'); if (!raw) return null; const n = Number(raw); if (!Number.isFinite(n) || n < 0) throw new Error('La comisión tiene que ser un número mayor o igual a 0.'); return n; };
 const drop = el('div', { className: 'import-drop', tabindex: '0', 'aria-label': 'Arrastrá aquí el CSV de Desempeño de Tradovate' }, [el('strong', { text: 'Arrastrá aquí el CSV de Desempeño' }), el('p', { className: 'hint', text: 'O elegilo desde tu computadora. Primero indicá la cuenta.' }), file]);
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
   const ready = () => result.invalid === 0 && result.created > 0 && acknowledge.checked;
   acknowledge.addEventListener('change', () => confirm.disabled = !ready());
   const table = el('table', { className: 'journal-table' });
   table.append(el('tr', {}, ['Apertura', 'Activo', 'Dirección', 'Contratos', 'Entrada', 'Salida', 'Neto'].map(text => el('th', { text }))));
   for (const t of result.drafts.slice(0, 200)) table.append(el('tr', {}, [t.sourceRef.openedWall.replace('T', ' '), t.asset, t.direction, String(t.lots), String(t.entry), String(t.exit), money(t.netPnl, acc.currency || 'USD')].map(text => el('td', { text }))));
   preview.replaceChildren(...[el('h2', { text: 'Revisá antes de guardar' }), el('p', { text: chosen.name + ' · ' + acc.name + ' · ' + zone.value }),
    el('div', { className: 'journal-kpis' }, [el('strong', { text: result.created + ' nuevas' }), el('strong', { text: result.duplicates + ' ya cargadas' }), el('strong', { text: result.invalid + ' inválidas' }), el('strong', { text: 'Neto nuevo: ' + money(cents, acc.currency || 'USD') })]),
    options.feePerContract == null ? el('p', { className: 'hint', text: 'Sin comisión: el neto es el P&L bruto de Tradovate. Si querés que coincida con el saldo, poné la comisión por contrato.' }) : el('p', { className: 'hint', text: 'Neto = P&L de Tradovate − ' + options.feePerContract + ' USD por contrato.' }),
    el('label', { className: 'journal-confirm' }, [acknowledge, el('span', { text: 'Confirmo que este CSV es de ' + acc.name + ' (el archivo de Tradovate no dice de qué cuenta es).' })]),
    ...result.errors.map(e => el('p', { className: 'err', text: 'Fila ' + e.index + (e.brokerSymbol ? ' (' + e.brokerSymbol + ')' : '') + ': ' + e.error })),
    el('div', { className: 'table-wrap' }, [table]),
    el('p', { className: 'hint', text: 'Los trades ya cargados se omiten, así que podés subir el mismo rango otra vez. Quedan sin estrategia: clasificalos desde el historial.' })]);
   pending = { text, options }; confirm.disabled = !ready();
  } catch (e) { if (v === version) { pending = null; err.textContent = e.message; } }
 }
 confirm.addEventListener('click', async () => {
  if (!pending || busy || confirm.disabled) return; busy = true; confirm.disabled = true; account.disabled = zone.disabled = fee.disabled = file.disabled = true;
  try {
   const result = await syncTradovateCsv(pending.text, ctx.stage.id, pending.options);
   const current = await getMeta(); await putMeta({ ...current, tradovateImport: { timeZone: pending.options.timeZone, fee: pending.options.feePerContract ?? '' } });
   await setActiveAccount(pending.options.accountId);
   preview.replaceChildren(el('h2', { text: result.created + ' operaciones importadas' }), el('p', { text: result.duplicates + ' ya estaban cargadas. Tus resultados y el saldo ya están actualizados.' }), el('div', { className: 'journal-actions' }, [link('Ver operaciones', 'historial?account=' + pending.options.accountId), link('Ver estadísticas', 'numeros?account=' + pending.options.accountId + '&universe=' + (pending.options.context === 'DEMO' ? 'DEMO' : 'REAL')), link('Ver saldo', 'cuentas?account=' + pending.options.accountId)]));
   pending = null; file.value = ''; refreshFees();
  } catch (e) { err.textContent = 'No se completó la importación: ' + e.message + '. Revisá el historial antes de repetir; los trades ya guardados se omitirán.'; pending = null; file.value = ''; }
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
  const apply = el('button', { type: 'button', text: 'Aplicar comisiones' });
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
  feesBox.replaceChildren(el('h2', { text: 'Comisiones de trades ya importados' }), el('p', { className: 'hint', text: 'Para ' + acc.name + '. El neto se recalcula desde el P&L bruto de Tradovate, así que podés corregirlo las veces que quieras. Dejá vacío un activo para no tocarlo.' }), el('div', { className: 'table-wrap' }, [table]), total, ferr, apply, msg);
 }
 await refreshFees();
 return el('section', { className: 'panel form', id: 'importar-tradovate' }, [el('p', { className: 'kicker', text: 'Tradovate → Journal → Resultados' }), el('h1', { text: 'Importar desde Tradovate' }), el('p', { className: 'meta', text: 'Para MNQ y demás futuros. Usá el CSV de Desempeño, que trae cada trade con entrada, salida, horario y P&L.' }),
  el('ol', { className: 'journal-guide' }, [el('li', { text: 'En Tradovate: Informes de cuenta → elegí la cuenta → pestaña Desempeño.' }), el('li', { text: 'En Fecha elegí el rango (De / Para), tocá Ir y después Descargar CSV.' }), el('li', { text: 'Aquí: elegí la misma cuenta, seleccioná el archivo, revisá y confirmá.' })]),
  !accounts.length ? el('p', {}, [el('span', { text: 'Todavía no tenés una cuenta. ' }), link('Crear cuenta', 'cuentas/nueva')]) : null,
  field('1. Cuenta destino', account), field('Horario del archivo', zone), el('p', { className: 'hint', text: 'Tradovate exporta con el horario de tu navegador; si operás desde Italia, dejá Europe/Rome.' }),
  field('Comisión por contrato, ida y vuelta (USD, opcional)', fee), field('2. CSV de Desempeño', drop), err, preview, confirm, feesBox].filter(Boolean));
}

// ---------- Vantage (texto copiado de «Historial de posiciones» del portal) ----------
async function vantagePanel(ctx, accounts, active) {
 const meta = await getMeta();
 const account = el('select', { className: 'input', name: 'vt-account' }, [el('option', { value: '', text: 'Elegí la cuenta destino' }), ...accounts.map(a => el('option', { value: a.id, text: a.name + ' · ' + label(a.context) }))]);
 account.value = ctx.route.query.account || active?.id || (accounts.length === 1 ? accounts[0].id : '');
 const zone = el('select', { className: 'input', name: 'vt-zone' }, MT5_SOURCE_TIMEZONES.map(z => el('option', { value: z, text: z === 'Europe/Athens' ? 'Europe/Athens (servidor de Vantage, GMT+2)' : z })));
 zone.value = MT5_SOURCE_TIMEZONES.includes(meta?.vantageImport?.timeZone) ? meta.vantageImport.timeZone : 'Europe/Athens';
 const text = el('textarea', { className: 'input', name: 'vt-text', rows: 10, placeholder: 'Pegá aquí lo que copiaste de Historial de posiciones (Buy / NAS100 / 0.1/0.1 / precios / P&L / fechas / #posición / Cerrado…)' });
 const review = el('button', { type: 'button', className: 'ghost', text: 'Revisar' });
 const preview = el('div', { 'aria-live': 'polite' }), err = el('p', { className: 'err', role: 'alert' });
 const confirm = el('button', { type: 'button', text: 'Importar operaciones de Vantage', disabled: true }); confirm.disabled = true;
 let pending = null, version = 0, busy = false;
 const invalidate = () => { version++; pending = null; confirm.disabled = true; preview.replaceChildren(); err.textContent = ''; };
 for (const c of [account, zone]) c.addEventListener('change', invalidate);
 text.addEventListener('input', invalidate);
 review.addEventListener('click', async () => {
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
   const ready = () => result.invalid === 0 && result.created > 0 && acknowledge.checked;
   acknowledge.addEventListener('change', () => confirm.disabled = !ready());
   const table = el('table', { className: 'journal-table' });
   table.append(el('tr', {}, ['Apertura (servidor)', 'Activo', 'Dirección', 'Lote', 'Entrada', 'Salida', 'Neto'].map(t => el('th', { text: t }))));
   for (const t of result.drafts.slice(0, 300)) table.append(el('tr', {}, [t.sourceRef.openedWall.replace('T', ' '), t.asset, t.direction, String(t.lots), String(t.entry), String(t.exit), money(t.netPnl, cur)].map(x => el('td', { text: x }))));
   preview.replaceChildren(...[el('h2', { text: 'Revisá antes de guardar' }), el('p', { text: acc.name + ' · ' + zone.value }),
    el('div', { className: 'journal-kpis' }, [el('strong', { text: result.created + ' nuevas' }), el('strong', { text: result.duplicates + ' ya cargadas' }), el('strong', { text: result.invalid + ' inválidas' }), el('strong', { text: 'Neto nuevo: ' + money(cents, cur) })]),
    result.truncated ? el('p', { className: 'err', text: 'El final del texto quedó cortado (' + result.truncated + ' posición incompleta). Esa no se importa: copiala de nuevo junto con las que falten.' }) : null,
    el('label', { className: 'journal-confirm' }, [acknowledge, el('span', { text: 'Confirmo que este historial es de ' + acc.name + '.' })]),
    ...result.errors.map(e => el('p', { className: 'err', text: 'Posición ' + (e.id || '—') + (e.brokerSymbol ? ' (' + e.brokerSymbol + ')' : '') + ': ' + e.error })),
    el('div', { className: 'table-wrap' }, [table]),
    el('p', { className: 'hint', text: 'La dirección se toma al revés del lado de cierre (Buy = cerró un short). Las ya cargadas se omiten, así que podés pegar el historial entero cada vez.' })].filter(Boolean));
   pending = { text: text.value, options }; confirm.disabled = !ready();
  } catch (e) { if (v === version) { pending = null; err.textContent = e.message; } }
 });
 confirm.addEventListener('click', async () => {
  if (!pending || busy || confirm.disabled) return; busy = true; confirm.disabled = true; account.disabled = zone.disabled = text.disabled = review.disabled = true;
  try {
   const result = await syncVantagePaste(pending.text, ctx.stage.id, pending.options);
   const current = await getMeta(); await putMeta({ ...current, vantageImport: { timeZone: pending.options.timeZone } });
   await setActiveAccount(pending.options.accountId);
   preview.replaceChildren(el('h2', { text: result.created + ' operaciones importadas' }), el('p', { text: result.duplicates + ' ya estaban cargadas. Tus resultados y el saldo ya están actualizados.' }), el('div', { className: 'journal-actions' }, [link('Ver operaciones', 'historial?account=' + pending.options.accountId), link('Ver saldo', 'cuentas?account=' + pending.options.accountId)]));
   pending = null; text.value = '';
  } catch (e) { err.textContent = 'No se completó la importación: ' + e.message; pending = null; }
  finally { busy = false; account.disabled = zone.disabled = text.disabled = review.disabled = false; }
 });
 return el('section', { className: 'panel form', id: 'importar-vantage' }, [el('p', { className: 'kicker', text: 'Vantage → Journal → Resultados' }), el('h1', { text: 'Pegar historial de Vantage' }), el('p', { className: 'meta', text: 'Para la cuenta de Vantage que no exporta archivo. Copiás el historial del portal y lo pegás acá.' }),
  el('ol', { className: 'journal-guide' }, [el('li', { text: 'En el portal de Vantage: Web Trader → elegí la cuenta → abajo, Historial de posiciones.' }), el('li', { text: 'Seleccioná desde el primer Buy/Sell hasta el último «Cerrado» y copiá (Ctrl+C).' }), el('li', { text: 'Aquí: elegí la cuenta, pegá, tocá Revisar y confirmá.' })]),
  field('1. Cuenta destino', account), field('Horario del servidor', zone), el('p', { className: 'hint', text: 'El portal muestra la hora del servidor (GMT+2 en invierno, GMT+3 en verano): Europe/Athens lo convierte bien.' }),
  field('2. Historial copiado', text), review, err, preview, confirm]);
}
