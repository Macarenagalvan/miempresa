import './test-safety.js';
import { ensureJournalSeed } from '../js/domain/stage.js';
import { createAccount, balanceFor } from '../js/domain/account.js';
import { listTrades, putTrade } from '../js/storage/repos/trades.js';
import { mapBrokerSymbolToAsset } from '../js/adapters/mt5.js';
import { parseVantageNumber, parseVantagePositionHistory, vantagePositionToDraft } from '../js/adapters/vantage-paste.js';
import { previewVantagePaste, syncVantagePaste, repairVantageDirections } from '../js/domain/vantage-import.js';
import { renderImportar } from '../js/ui/screens/importar.js';

// Texto sintético con la forma del «Historial de posiciones» del portal de Vantage.
const block = (side, sym, vol, close, open, pnl, net, from, to, id) => [side, sym, vol, close, open, pnl, net, '0.00/0.00', from + '\t' + to + '\t', '#' + id, 'Cerrado'].join('\n');
const A = block('Buy', 'NAS100', '0.1/0.1', '20,100.00', '20,000.00', '-10.00', '-10.00', '19/11/2026 18:02:15', '19/11/2026 18:51:43', '900000001');
const B = block('Sell', 'NAS100', '0.2/0.2', '20,050.50', '20,000.50', '+10.00', '+10.00', '19/11/2026 17:15:50', '19/11/2026 17:25:55', '900000002');
const C = block('Buy', 'GER40', '2/2', '20,010.00', '20,000.00', '-21.90', '-22.40', '18/11/2026 12:30:16', '18/11/2026 12:33:05', '900000003');

export async function run() {
  let n = 0; const check = (v, m) => { if (!v) throw Error('Vantage: ' + m); n++; };
  check(parseVantageNumber('27,228.28') === 27228.28 && parseVantageNumber('+30.09') === 30.09 && parseVantageNumber('-12.88') === -12.88 && parseVantageNumber('27.228,28') === 27228.28 && parseVantageNumber('1,000') === 1000, 'lee números con miles y signo');
  check(['NAS100', 'NAS100ft', 'US100'].every(s => mapBrokerSymbolToAsset(s) === 'NAS100') && mapBrokerSymbolToAsset('GER40') === 'GER40' && mapBrokerSymbolToAsset('DJ30') === 'DJ30' && mapBrokerSymbolToAsset('US30') === 'DJ30', 'reconoce índices de Vantage');
  const parsed = parseVantagePositionHistory([A, B, C, 'B'].join('\n'));
  check(parsed.positions.length === 3 && parsed.truncated === 1, 'lee 3 posiciones y detecta el final cortado');
  check(parseVantagePositionHistory([A, B].join('\n')).truncated === 0, 'texto completo no avisa corte');
  const opts = { accountId: 'x', context: 'LIVE', timeZone: 'Europe/Athens' };
  const a = vantagePositionToDraft(parsed.positions[0], opts).draft;
  check(a.direction === 'LONG' && a.entry === 20100 && a.exit === 20000 && a.netPnl === -10, 'Buy = LONG, primer precio = apertura');
  check(a.openedAt === '2026-11-19T16:02:00.000Z' && a.closedAt === '2026-11-19T16:51:00.000Z', 'hora de servidor GMT+2 a UTC');
  const b = vantagePositionToDraft(parsed.positions[1], opts).draft;
  check(b.direction === 'SHORT' && b.lots === 0.2 && b.result === 'WIN', 'Sell = SHORT');
  const c = vantagePositionToDraft(parsed.positions[2], opts).draft;
  check(c.asset === 'GER40' && c.netPnl === -22.4 && c.commission === -0.5, 'usa el neto y guarda costos');
  check(vantagePositionToDraft({ ...parsed.positions[0], symbol: 'FOOBAR99' }, opts).code === 'UNKNOWN_SYMBOL', 'símbolo desconocido se rechaza');
  // Casos reales (26/11/2026): cortos de GBPUSD y NAS100 tal como los muestra Vantage.
  const gbp = vantagePositionToDraft(parseVantagePositionHistory(block('Sell', 'GBPUSD+', '0.4/0.4', '1.31042', '1.30970', '+28.80', '+26.40', '26/11/2026 13:19:00', '26/11/2026 13:26:00', '900000020')).positions[0], opts).draft;
  check(gbp.direction === 'SHORT' && gbp.entry === 1.31042 && gbp.exit === 1.3097, 'GBPUSD real: venta en 1.31042, salida 1.3097');
  const nas = vantagePositionToDraft(parseVantagePositionHistory(block('Sell', 'NAS100', '0.7/0.7', '26,251.57', '26,266.87', '-10.71', '-10.71', '26/11/2026 17:40:00', '26/11/2026 17:54:00', '900000021')).positions[0], opts).draft;
  check(nas.direction === 'SHORT' && nas.entry === 26251.57 && nas.exit === 26266.87 && nas.sourceRef.vantageFormat === 2, 'NAS100 real: venta en 26251.57, stop 26266.87');

  const { stage } = await ensureJournalSeed();
  const acc = await createAccount({ name: 'TEST Vantage', context: 'LIVE', currency: 'USD', initialAmount: 500 }, stage.id);
  const src = { accountId: acc.id, context: 'LIVE', timeZone: 'Europe/Athens' };
  const pre = await previewVantagePaste([A, B, C].join('\n'), src);
  check(pre.created === 3 && pre.invalid === 0 && (await listTrades()).filter(t => t.accountId === acc.id).length === 0, 'preview no guarda');
  const first = await syncVantagePaste([A, B].join('\n'), stage.id, src);
  check(first.created === 2, 'importa 2');
  const again = await syncVantagePaste([A, B, C].join('\n'), stage.id, src);
  check(again.created === 1 && again.duplicates === 2, 'pegar todo otra vez solo agrega lo nuevo');
  check(Math.abs(await balanceFor(acc.id) - (500 - 10 + 10 - 22.4)) < 1e-9, 'saldo con neto');
  check((await listTrades()).filter(t => t.accountId === acc.id).every(t => t.sourceRef.kind === 'VANTAGE_POSITION_HISTORY'), 'marca origen Vantage');
  const before = (await listTrades()).filter(t => t.accountId === acc.id).length;
  const mixed = block('Buy', 'FOOBAR99', '1/1', '2', '1', '1', '1', '18/11/2026 10:00:00', '18/11/2026 10:05:00', '900000009') + '\n' + block('Sell', 'XAUUSD+', '0.1/0.1', '3,629.98', '3,629.75', '-2.30', '-2.90', '18/11/2026 11:00:00', '18/11/2026 11:05:00', '900000010');
  const res = await syncVantagePaste(mixed, stage.id, src);
  check(res.invalid === 1 && res.created === 1 && (await listTrades()).filter(t => t.accountId === acc.id).length === before + 1, 'símbolo desconocido se saltea y el resto se guarda');
  check((await listTrades()).some(t => t.accountId === acc.id && t.asset === 'XAUUSD' && t.netPnl === -2.9), 'XAUUSD+ se lee como XAUUSD');
  // Trades importados con la versión vieja (entrada/salida intercambiadas y dirección al revés) se corrigen una vez.
  const mine = (await listTrades()).filter(t => t.accountId === acc.id);
  const target = mine.find(t => t.entry === 20050.5);
  const { vantageFormat, ...oldRef } = target.sourceRef;
  await putTrade({ ...target, entry: 20000.5, exit: 20050.5, direction: 'LONG', sourceRef: oldRef });
  const fixed = await repairVantageDirections();
  const after = (await listTrades()).find(t => t.id === target.id);
  check(fixed === 1 && after.direction === 'SHORT' && after.entry === 20050.5 && after.exit === 20000.5 && after.netPnl === target.netPnl, 'corrige un Vantage viejo: intercambia precios y dirección, sin tocar el PnL');
  check(await repairVantageDirections() === 0, 'la corrección no vuelve a escribir');
  const nodes = await renderImportar({ stage, route: { query: {} } });
  check(nodes[1].id === 'importar-vantage' && nodes[1].querySelector('textarea[name="vt-text"]'), 'pantalla Importar muestra Vantage');
  document.getElementById('out').textContent += '\nVantage: ' + n + ' tests OK';
}
