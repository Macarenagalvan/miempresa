import { MT5_CSV_COLUMNS } from './mt5.js';

export function decodeMt5File(buffer) {
 const bytes=new Uint8Array(buffer);
 return new TextDecoder(bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8').decode(bytes);
}
const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s/g,'');
function amount(s) {
 const v=String(s).replace(/[\s\u00a0]/g,'').replace(',','.');
 if(!/^[+-]?\d+(\.\d+)?$/.test(v))throw new Error('Importe ausente o inválido: '+s);
 return Number(v);
}
function stamp(s){const m=String(s).match(/^(\d{4})[.-](\d{2})[.-](\d{2})\s+(\d{2}:\d{2})(?::\d{2})?$/);if(!m)throw new Error('Fecha de operación inválida: '+s);return [m[1]+'-'+m[2]+'-'+m[3],m[4]];}
const cell=s=>{s=String(s??'');return /[;"\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};

// Detached document: never inject the report's markup or scripts into the app.
export function parseMt5Html(html) {
 const doc=new DOMParser().parseFromString(html,'text/html');
 const rows=[...doc.querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll(':scope > td, :scope > th')].filter(td=>!td.classList.contains('hidden')&&!/display\s*:\s*none/i.test(td.getAttribute('style')||'')).map(td=>td.textContent.trim().replace(/\u00a0/g,' ')));
 const accountRow=rows.find(r=>r.some(c=>/cuenta de trading|trading account|account:/i.test(c)));
 const accountText=accountRow?.join(' ')||'';
 const login=accountText.match(/(?:cuenta de trading|trading account|account)\s*:\s*(\d+)/i)?.[1]||null;
 const currency=accountText.match(/\b(USD|EUR|GBP|JPY|CHF)\b/)?.[1]||null;
 let start=rows.findIndex(r=>r.length<=2&&r.some(c=>/^(posiciones|positions)$/i.test(c)));
 if(start<0)throw new Error('No encontré la sección Posiciones. Exportá el historial de MT5 como informe HTML.');
 let header=null;const records=[],details={};const seen=new Set();
 for(const row of rows.slice(start+1)){
  if(row.length<=2&&row.some(c=>/^(ordenes|órdenes|orders|transacciones|deals)$/i.test(c)))break;
  if(!header){if(row.some(c=>/^(posicion|position)$/i.test(norm(c))))header=row.map(norm);continue;}
  if(!/^\d{4}[.-]/.test(row[0]||''))continue;
  if(row.length!==header.length)throw new Error('Una posición tiene columnas incompletas. No se importó nada.');
  const get=(...names)=>{const i=header.findIndex(h=>names.map(norm).includes(h));return i<0?null:row[i];};
  const id=get('posición','position');if(!/^\d+$/.test(id||''))throw new Error('ID de posición inválido.');
  if(seen.has(id))throw new Error('El informe repite la posición '+id+'. Revisá el archivo.');seen.add(id);
  const dateIndexes=header.map((h,i)=>/^(fechahora|fecha\/hora|time|opentime|closetime|datetime)$/.test(h)?i:-1).filter(i=>i>=0);
  const prices=header.map((h,i)=>h==='precio'||h==='price'?i:-1).filter(i=>i>=0);
  if(dateIndexes.length!==2||prices.length!==2)throw new Error('Formato de fechas o precios de MT5 no reconocido.');
  const [date,time]=stamp(row[dateIndexes[0]]),[closedDate,closedTime]=stamp(row[dateIndexes[1]]);
  const side=get('tipo','type')||'';if(!['buy','sell'].includes(side.toLowerCase()))throw new Error('Tipo de posición no reconocido: '+side);
  const gross=amount(get('beneficio','profit')),commission=amount(get('comisión','commission')),swap=amount(get('swap'));
  const feeIndex=header.findIndex(h=>['tasa','fee'].includes(h)),fee=feeIndex<0?0:amount(row[feeIndex]);
  const net=(Math.round(gross*100)+Math.round(commission*100)+Math.round(swap*100)+Math.round(fee*100))/100;
  const rec={ID:id,Fecha:date,Hora:time,'Fecha salida':closedDate,'Hora salida':closedTime,Cuenta:login||'',Modo:'Operado',Direccion:side.toLowerCase()==='buy'?'Long':'Short',Activo:get('símbolo','symbol'),Entrada:amount(row[prices[0]]),Salida:amount(row[prices[1]]),'B/P Bruto':gross,Comisiones:commission+swap+fee,'B/P Neto':net,Resultado:net>0?'Win':net<0?'Loss':'BE',Lotaje:amount(get('volumen','volume')),Notas:'Informe HTML MT5. Horarios de servidor. SL/TP históricos no tratados como niveles iniciales.'};
  details[id]={commission,swap,fee,sourceLogin:login,openedOriginal:row[dateIndexes[0]],closedOriginal:row[dateIndexes[1]],slObserved:get('S / L','S/L'),tpObserved:get('T / P','T/P')};records.push(rec);
 }
 if(!records.length)throw new Error('El informe no contiene posiciones cerradas reconocibles.');
 return {login,currency,details,records,net:records.reduce((s,r)=>s+Math.round(r['B/P Neto']*100),0)/100,csv:'sep=;\r\n'+MT5_CSV_COLUMNS.join(';')+'\r\n'+records.map(r=>MT5_CSV_COLUMNS.map(k=>cell(r[k])).join(';')).join('\r\n')+'\r\n'};
}
