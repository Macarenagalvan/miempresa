import './test-safety.js';
import { ensureJournalSeed } from '../js/domain/stage.js';
import { renderBacktesting } from '../js/ui/screens/backtesting.js';
import { renderNuevoTrade } from '../js/ui/screens/trade-new.js';
export async function run() {
  const seed = await ensureJournalSeed();
  for (const nodes of [await renderBacktesting(seed), await renderNuevoTrade({ ...seed, route: { rest: 'trade', query: {context:'BACKTEST'} } })]) {
    const host = document.createElement('div'); host.append(...nodes);
    if (!host.querySelector('.quick-bt')) throw new Error('Falta carga rápida');
    for (const name of ['sessionDate','asset','direction','result','rrRealized','note','captures']) if (!host.querySelector(`[name=${name}]`)) throw new Error('Falta '+name);
    for (const name of ['entry','exit','netPnl','openedAt','closedAt','lifecycle','accountId']) if (host.querySelector(`[name=${name}]`)) throw new Error('Campo innecesario '+name);
    if (host.querySelector('[name=sessionDate]').value) throw new Error('Fecha inventada');
    if (host.querySelector('[name=direction]').value || host.querySelector('[name=result]').value) throw new Error('Resultado/dirección preseleccionados');
  }
  console.log('Carga rápida: una pantalla, sin ejecución obligatoria ni valores inventados OK');
}
