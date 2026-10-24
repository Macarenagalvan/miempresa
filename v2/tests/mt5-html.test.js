import {parseMt5Html,decodeMt5File} from '../js/adapters/mt5-html.js';
import {parseMt5Csv} from '../js/adapters/mt5.js';

export async function run(){
 const check=(ok,message)=>{if(!ok)throw new Error('MT5 HTML: '+message);};
 const header=['Fecha / Hora','Posición','Símbolo','Tipo','Volumen','Precio','S / L','T / P','Fecha / Hora','Precio','Comisión','Swap','Beneficio'];
 const cells=['2026.10.13 16:00:24','123456','NDXUSD','sell','0.10','100.00','110.00','90.00','2026.10.13 17:00:31','90.00','-0.20','0.00','10.00'];
 const tr=row=>'<tr>'+row.map(c=>'<td>'+c+'</td>').join('')+'</tr>';
 const report=(row=cells,h=header)=>'<html><table>'+tr(['Cuenta de trading: 12345 (USD)'])+tr(['Posiciones'])+tr(h)+tr(row)+tr(['Órdenes'])+'</table><script>window.reportExecuted=true</script></html>';
 const parsed=parseMt5Html(report());
 check(parsed.login==='12345'&&parsed.currency==='USD','identificación');
 check(parsed.net===9.8&&parsed.details['123456'].commission===-.2,'neto con comisión');
 check(parsed.details['123456'].openedOriginal.endsWith(':24'),'segundos originales conservados');
 check(parsed.records[0]['Stop Loss']==null,'SL observado no se convierte en riesgo inicial');
 check(parseMt5Csv(parsed.csv).rows.length===1,'CSV compatible');
 check(!window.reportExecuted,'el informe nunca ejecuta scripts');
 const rejected=html=>{try{parseMt5Html(html);return false;}catch{return true;}};
 check(rejected(report().replace(tr(['Órdenes']),tr(cells)+tr(['Órdenes']))),'posición duplicada rechazada');
 check(rejected(report(cells.slice(0,-1))),'fila incompleta rechazada');
 check(rejected(report(cells.map((c,i)=>i===10?'':c))),'comisión ausente rechazada');
 check(rejected(report(cells.map((c,i)=>i===3?'balance':c))),'tipo no operable rechazado');
 const hidden=report().replaceAll('</tr>','<td class="hidden">ignorar</td></tr>');
 check(parseMt5Html(hidden).net===9.8,'celdas auxiliares ocultas ignoradas');
 const utf16=new Uint8Array([255,254,65,0,66,0]);check(decodeMt5File(utf16.buffer)==='AB','UTF16 de MT5');
 document.getElementById('out').textContent+='\nMT5 HTML: 12 tests OK';
}
