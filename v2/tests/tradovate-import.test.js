import './test-safety.js';
import { ensureJournalSeed } from '../js/domain/stage.js';
import { createAccount, balanceFor } from '../js/domain/account.js';
import { listTrades } from '../js/storage/repos/trades.js';
import { isTradovatePerformanceCsv, parseTradovateMoney, mapTradovateSymbol, parseTradovatePerformance, tradovateRowToDraft } from '../js/adapters/tradovate.js';
import { previewTradovateCsv, syncTradovateCsv } from '../js/domain/tradovate-import.js';
import { renderImportar } from '../js/ui/screens/importar.js';

// Datos sintéticos con la forma del CSV de Desempeño de Tradovate.
const HEADER = 'symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration';
const ROWS = [
  'MNQZ6,-2,0,0.25,100001,100002,1,20000.00,20010.00,$20.00,11/12/2026 15:20:10,11/12/2026 15:25:40,5min 30sec',
  'MNQZ6,-2,0,0.25,100004,100003,2,20020.00,20030.00,$40.00,11/12/2026 16:05:00,11/12/2026 16:01:00,4min',
  'MNQZ6,-2,0,0.25,100006,100005,1,20050.00,20040.00,$(20.00),11/12/2026 16:30:30,11/12/2026 16:20:00,10min 30sec',
  'MNQZ6,-2,0,0.25,100006,100007,1,20050.00,20050.00,$0.00,11/12/2026 16:30:30,11/12/2026 16:31:00,30sec',
  'MGCZ6,-1,0,0.1,100008,100009,1,"3,900.0",3898.5,$(15.00),11/13/2026 11:13:26,11/13/2026 11:15:33,2min 7sec',
];
const csv = (rows) => [HEADER, ...rows].join('\n') + '\n';

export async function run() {
  let n = 0; const check = (v, m) => { if (!v) throw Error('Tradovate: ' + m); n++; };
  check(isTradovatePerformanceCsv(csv(ROWS)), 'detecta el CSV de Desempeño');
  check(!isTradovatePerformanceCsv('orderId,Account,Order ID,B/S\n1,2,3,Buy'), 'no confunde el CSV de Órdenes');
  check(parseTradovateMoney('$(1,051.25)') === -1051.25 && parseTradovateMoney('$68.00') === 68, 'lee montos con paréntesis y miles');
  check(mapTradovateSymbol('MNQZ6') === 'MNQ' && mapTradovateSymbol('MGCZ6') === 'MGC' && mapTradovateSymbol('ESH27') === 'ES' && mapTradovateSymbol('ZZZ') === null, 'mapea raíz del contrato');

  const rows = parseTradovatePerformance(csv(ROWS)).rows;
  const opts = { accountId: 'x', context: 'LIVE', timeZone: 'Europe/Rome' };
  const long = tradovateRowToDraft(rows[0].rec, opts).draft;
  check(long.direction === 'LONG' && long.entry === 20000 && long.exit === 20010 && long.openedAt === '2026-11-12T14:20:00.000Z', 'compra primero = LONG, horario de Italia a UTC');
  const short = tradovateRowToDraft(rows[1].rec, opts).draft;
  check(short.direction === 'SHORT' && short.entry === 20030 && short.exit === 20020 && short.lots === 2 && short.openedAt < short.closedAt, 'venta primero = SHORT, entrada en la venta');
  const chicago = tradovateRowToDraft(rows[0].rec, { ...opts, timeZone: 'America/Chicago' }).draft;
  check(chicago.openedAt === '2026-11-12T21:20:00.000Z', 'acepta horario de Chicago');
  const fee = tradovateRowToDraft(rows[1].rec, { ...opts, feePerContract: 1.25 }).draft;
  check(fee.commission === -2.5 && fee.netPnl === 37.5 && fee.sourceRef.grossPnl === 40 && fee.swap === 0, 'descuenta comisión por contrato');
  check(tradovateRowToDraft(rows[0].rec, opts).draft.commission === null, 'sin comisión no inventa costos');
  check(tradovateRowToDraft(rows[3].rec, opts).draft.result === 'BE', 'P&L 0 = BE');
  check(tradovateRowToDraft(rows[2].rec, opts).draft.sourceRef.mt5Position !== tradovateRowToDraft(rows[3].rec, opts).draft.sourceRef.mt5Position, 'misma compra con dos ventas no colisiona');

  const { stage } = await ensureJournalSeed();
  const acc = await createAccount({ name: 'TEST Tradovate', context: 'LIVE', currency: 'USD', initialAmount: 25000 }, stage.id);
  const src = { accountId: acc.id, context: 'LIVE', timeZone: 'Europe/Rome', feePerContract: 1 };
  const pre = await previewTradovateCsv(csv(ROWS), src);
  check(pre.created === 5 && pre.invalid === 0 && pre.duplicates === 0, 'preview cuenta 5 nuevas');
  check((await listTrades()).filter(t => t.accountId === acc.id).length === 0, 'preview no guarda nada');
  const first = await syncTradovateCsv(csv(ROWS), stage.id, src);
  const saved = (await listTrades()).filter(t => t.accountId === acc.id);
  check(first.created === 5 && saved.length === 5, 'importa los 5 trades');
  const net = saved.reduce((s, t) => s + t.netPnl, 0);
  check(Math.abs(net - (25 - 6)) < 1e-9, 'neto total = bruto − comisiones');
  check(saved.every(t => t.sourceRef.kind === 'TRADOVATE_PERFORMANCE' && t.strategy === 'UNCLASSIFIED'), 'marca origen Tradovate y queda sin clasificar');
  const bal = await balanceFor(acc.id);
  check(Math.abs(Number(bal) - 25019) < 1e-6, 'saldo de la cuenta incluye el neto: ' + bal);
  const again = await syncTradovateCsv(csv([...ROWS, 'MNQZ6,-2,0,0.25,100010,100011,1,20000.00,20001.00,$2.00,11/14/2026 10:00:00,11/14/2026 10:01:00,1min']), stage.id, src);
  check(again.created === 1 && again.duplicates === 5, 'reimportar el mismo rango solo agrega lo nuevo');
  let blocked = false; try { await syncTradovateCsv(csv(['FOOZ6,-2,0,0.25,200001,200002,1,1,2,$1.00,11/14/2026 10:00:00,11/14/2026 10:01:00,1min']), stage.id, src); } catch { blocked = true; }
  check(blocked && (await listTrades()).filter(t => t.accountId === acc.id).length === 6, 'archivo con símbolo desconocido no guarda nada');
  let tz = false; try { await previewTradovateCsv(csv(ROWS), { ...src, timeZone: 'Asia/Tokyo' }); } catch { tz = true; }
  check(tz, 'rechaza horario no permitido');

  const nodes = await renderImportar({ stage, route: { query: {} } });
  check(nodes[0].id === 'importar-tradovate' && nodes[0].querySelector('input[name="tv-report"]'), 'pantalla Importar muestra Tradovate');
  document.getElementById('out').textContent += '\nTradovate: ' + n + ' tests OK';
}
