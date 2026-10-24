import { el } from './render.js';
import { listStageAccounts, accountBalance, getActiveAccount, setActiveAccount } from '../domain/account.js';
import { listTrades } from '../storage/repos/trades.js';
import { listMovements } from '../storage/repos/movements.js';
import { compute, filterTrades } from '../domain/stats.js';
import { isMovementLive, isTradePnlForBalance } from '../domain/integrity.js';
import { go } from './router.js';

export const money = (n, currency = '') => n == null ? '—' : Number(n).toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2}) + (currency ? ' '+currency : '');
export const label = value => ({PROP_CHALLENGE:'Challenge', LIVE:'Cuenta propia', FUNDED:'Fondeada', DEMO:'Demo', BACKTEST:'Backtest', LONG:'Compra', SHORT:'Venta', UNCLASSIFIED:'Sin clasificar', WIN:'Ganada', LOSS:'Perdida', BE:'En equilibrio'})[value] || value || 'Sin clasificar';
export const link = (text, path) => el('a', {href:'#/'+path, className:'journal-link', text});
export function kpi(title, value, note = '') {
 return el('div',{className:'metric'},[el('span',{className:'kicker',text:title}),el('strong',{className:'num',text:value}),el('small',{className:'meta',text:note})]);
}
export function curve(title, points, unit, caption) {
 const host=el('section',{className:'panel journal-chart'},[el('h2',{text:title}),el('p',{className:'hint',text:caption})]);
 if(points.length<2){host.append(el('p',{className:'empty',text:'La curva aparecerá cuando haya operaciones cerradas.'}));return host;}
 const values=points.map(p=>p.value), min=Math.min(...values), max=Math.max(...values), span=max-min||1;
 const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 760 210');svg.setAttribute('role','img');svg.setAttribute('aria-label',title+': '+money(values[0],unit)+' a '+money(values.at(-1),unit));
 const path=document.createElementNS(ns,'polyline');path.setAttribute('points',points.map((p,i)=>`${18+i/(points.length-1)*724},${175-(p.value-min)/span*145}`).join(' '));
 path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','3');svg.append(path);
 for(const [i,p] of points.entries()){
  const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',18+i/(points.length-1)*724);dot.setAttribute('cy',175-(p.value-min)/span*145);dot.setAttribute('r','4');dot.setAttribute('fill','currentColor');
  const tip=document.createElementNS(ns,'title');tip.textContent=p.date+' · '+money(p.value,unit);dot.append(tip);svg.append(dot);
 }
 host.append(svg,el('div',{className:'journal-chart-labels'},[el('span',{text:points[0].date+' · '+money(values[0],unit)}),el('strong',{text:points.at(-1).date+' · '+money(values.at(-1),unit)})]));
 return host;
}
export function resultCharts(trades, filters, currency = '') {
 const closed=filterTrades(trades,filters).filter(t=>t.lifecycle==='CLOSED'&&!t.isDraft&&t.netPnl!=null).sort((a,b)=>String(a.closedAt).localeCompare(String(b.closedAt)));
 let total=0;const points=[{date:'Inicio del período',value:0},...closed.map(t=>({date:t.closedAt.slice(0,10),value:(total+=Number(t.netPnl))}))];
 function bars(title,key){
  const groups=new Map();for(const t of closed){const k=label(t[key]);const a=groups.get(k)||[];a.push(t);groups.set(k,a);}
  return el('section',{className:'panel'},[el('h2',{text:title}),...Array.from(groups,([k,rows])=>{
   const wins=rows.filter(t=>t.result==='WIN').length,decided=rows.filter(t=>t.result==='WIN'||t.result==='LOSS').length,pct=decided?wins/decided*100:0;
   const progress=el('progress',{max:'100',value:String(pct),'aria-label':k+' porcentaje de acierto'});
   return el('div',{className:'journal-bar'},[el('strong',{text:k}),progress,el('span',{text:(decided?pct.toFixed(1)+'%':'—')+' · '+rows.length+' ops'})]);
  }),closed.length?null:el('p',{className:'empty',text:'Sin operaciones para estos filtros.'})]);
 }
 return el('div',{className:'journal-analysis'},[curve('Evolución del resultado neto',points,currency,'Resultado acumulado de las operaciones seleccionadas; no incluye depósitos ni retiros.'),el('div',{className:'journal-two'},[bars('Acierto por estrategia','strategy'),bars('Acierto por activo','asset'),bars('Acierto por dirección','direction'),bars('Acierto por sesión','session')])]);
}
export async function accountOverview(ctx, compact=false){
 const accounts=await listStageAccounts(ctx.stage.id), active=await getActiveAccount(), trades=await listTrades(),movements=await listMovements();
 const requested=ctx.route?.query?.account;
 const selected=accounts.find(a=>a.id===requested)||accounts.find(a=>a.id===active?.id)||accounts[0];
 const pick=el('select',{className:'input','aria-label':'Cuenta del resumen'},accounts.map(a=>el('option',{value:a.id,text:a.name+' · '+label(a.context)})));
 if(selected)pick.value=selected.id;
 pick.addEventListener('change',async()=>{await setActiveAccount(pick.value);go(ctx.route.name+'?account='+encodeURIComponent(pick.value));});
 const intro=el('section',{className:'panel journal-overview'},[
  el('div',{className:'journal-heading'},[el('div',{},[el('p',{className:'kicker',text:'Tu journal · de la operación al resultado'}),el('h1',{text:compact?'Tu trading, de un vistazo':'Cartera y evolución'})]),accounts.length?pick:link('Crear mi primera cuenta','cuentas/nueva')]),
  el('div',{className:'journal-actions'},[link('+ Nueva operación','nuevo/trade'),link('Importar informe de MT5','importar'),link('Ver historial','historial'+(selected?'?account='+selected.id:'')),link('Ver estadísticas','numeros'+(selected?'?account='+selected.id+'&universe='+(selected.context==='DEMO'?'DEMO':'REAL'):''))]),
 ]);
 if(!selected){intro.append(el('p',{className:'empty',text:'Creá tu cuenta con el capital inicial. Después podés registrar una operación o importar el informe HTML de MT5.'}));return intro;}
 const own=trades.filter(t=>t.accountId===selected.id&&t.stageId===ctx.stage.id&&!t.isDraft&&t.lifecycle!=='VOID');
 const stats=compute(own,{universe:selected.context==='DEMO'?'DEMO':'REAL',accountId:selected.id});
 intro.append(el('div',{className:'journal-kpis'},[kpi('Saldo actual',money(accountBalance(selected,movements,trades),selected.currency),'Inicial: '+money(selected.initialAmount,selected.currency)),kpi('Resultado neto',money(stats.netPnl,selected.currency),'Operaciones cerradas · todo el historial'),kpi('Operaciones cerradas',String(stats.nClosed),stats.nWins+' ganadas · '+stats.nLosses+' perdidas'),kpi('Porcentaje de acierto',stats.winRate==null?'—':(stats.winRate*100).toFixed(1)+'%','Ganadas / ganadas y perdidas')]));
 const events=[...trades.filter(t=>isTradePnlForBalance(t,selected.id)).map(t=>({date:t.closedAt,value:Number(t.netPnl)})),...movements.filter(m=>m.accountId===selected.id&&isMovementLive(m)).map(m=>({date:m.date,value:Number(m.amount)}))].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 let amount=Number(selected.initialAmount);
 const points=[{date:'Capital inicial',value:amount},...events.map(e=>({date:String(e.date).slice(0,10),value:(amount+=e.value)}))];
 // Only display a balance curve when it reconciles with the authoritative balance.
 if(Math.abs(amount-accountBalance(selected,movements,trades))<0.005)intro.append(curve('Evolución del saldo',points,selected.currency,'Operaciones cerradas y movimientos de esta cuenta.'));
 else intro.append(resultCharts(own,{universe:selected.context==='DEMO'?'DEMO':'REAL'},selected.currency));
 return intro;
}
