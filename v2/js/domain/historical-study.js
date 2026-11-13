import { withStores, requestToPromise } from '../storage/db.js';
import { assertObservation } from './integrity.js';
import { validDay, validInstant } from './execution.js';
import { nowIso } from './ids.js';
import { dirtyVersion } from '../storage/sync-version.js';
import { ensureDeviceState } from '../services/sync-engine.js';
import { isSyncPaused } from '../services/sync-mode.js';

const stores = ['trades', 'observations', 'attachments', 'setups', 'signals', 'asrs', 'syncLedger', 'syncConflicts', 'syncState'];
const present = value => value != null && value !== '' && value !== false;
export const isHistoricalPending = t => t?.context === 'BACKTEST' && t.isDraft === true && t.lifecycle === 'OPEN' && t.sourceRef?.kind === 'BACKTEST_JSON' && !t.studyConversion;
export const studyOutcomeLabel = value => ({ NO_TRADE: 'NO TRADE', TRADE_TAKEN: 'HUBO ENTRADA', UNREVIEWED: 'SIN EVALUAR' })[value] || 'SIN EVALUAR';
export function historicalDate(trade) {
  const sources = ['historicalDate', 'date', 'openedAt', 'draftClosedAt', 'closedAt']
    .filter(field => present(trade[field])).map(field => ({ field, value: trade[field] }));
  const days = sources.filter(s => validDay(s.value) || validInstant(s.value)).map(s => s.value.slice(0, 10));
  const unique = [...new Set(days)];
  return { date: unique.length === 1 && days.length === sources.length ? unique[0] : null, sources,
    uncertain: unique.length !== 1 || days.length !== sources.length };
}
async function read(tx) {
  return Object.fromEntries(await Promise.all(stores.map(async name => [name, await requestToPromise(tx.objectStore(name).getAll())])));
}
function inspect(data, id) {
  const trade = data.trades.find(t => t.id === id);
  if (!trade) throw new Error('Registro no encontrado.');
  const images = data.attachments.filter(a => a.entityType === 'trade' && a.entityId === id);
  const existing = data.observations.find(o => o.recovery?.tradeId === id);
  const blockers = [];
  if (!isHistoricalPending(trade)) blockers.push('Solo se convierten históricos importados BACKTEST pendientes de clasificar.');
  const execution = ['entry', 'initialSL', 'currentSL', 'tp', 'exit', 'draftExit', 'netPnl', 'draftNetPnl', 'lots', 'riskMoney', 'riskPercent', 'commission', 'draftCommission', 'swap', 'draftSwap', 'result', 'hasPartials', 'management']
    .filter(k => present(trade[k]));
  if (present(trade.sourceRef?.declaredResult)) execution.push('resultado declarado en la importación');
  if (execution.length) blockers.push('Hay datos de ejecución o gestión parciales: ' + execution.join(', ') + '. Revisalos como operación; no se convertirán ni descartarán.');
  if (!trade.asset?.trim()) blockers.push('Falta el activo. Revisá el registro original.');
  if (trade.accountId || trade.setupId || trade.deskSignalId || data.asrs.some(a => a.tradeId === id) || data.signals.some(s => s.tradeId === id) || data.setups.some(s => s.tradeId === id)) blockers.push('Hay referencias operativas vinculadas. Requieren revisión antes de convertir.');
  const relevant = new Set(['trades::' + id, 'observations::' + existing?.id, ...images.map(a => 'attachments::' + a.id)]);
  if (data.syncConflicts.some(c => !c.resolvedAt && relevant.has(c.entityType + '::' + c.entityId))) blockers.push('Hay conflictos de sincronización pendientes. No se puede convertir.');
  if (images.some(a => !(a.blob instanceof Blob) || !a.blob.size)) blockers.push('Alguna captura no tiene contenido recuperable.');
  if (existing && (!existing.archived || JSON.stringify(existing.recovery.originalTrade) !== JSON.stringify(trade))) blockers.push('Existe una recuperación anterior o el original cambió desde la reversión. Revisá el estudio conservado.');
  const date = historicalDate(trade);
  const signature = JSON.stringify({ trade, images: images.map(({ blob, ...metadata }) => ({ ...metadata, bytes: blob?.size, type: blob?.type })),
    existing, ledger: data.syncLedger.filter(l => relevant.has(l.id)), blockers, date });
  return { trade, images, existing, blockers, date, signature, eligible: blockers.length === 0 };
}
export async function reviewHistoricalStudy(id) {
  await ensureDeviceState();
  return withStores(stores, 'readonly', async tx => inspect(await read(tx), id));
}
async function track(tx, type, record) {
  const ledger = tx.objectStore('syncLedger');
  const old = await requestToPromise(ledger.get(type + '::' + record.id));
  tx.objectStore(type).put(record);
  ledger.put(dirtyVersion(type, record.id, old));
}
function requireLocal(data) {
  if (!isSyncPaused(data.syncState[0])) throw new Error('Pausá la sincronización antes de recuperar históricos.');
}
export async function convertHistoricalStudy(id, input) {
  await ensureDeviceState();
  return withStores(stores, 'readwrite', async tx => {
    const data = await read(tx); requireLocal(data);
    const p = inspect(data, id);
    if (!p.eligible) throw new Error(p.blockers.join(' '));
    if (!input?.reviewed || input.signature !== p.signature) throw new Error('Revisá el original, la fecha y las capturas de nuevo antes de convertir.');
    if (!['NO_TRADE', 'TRADE_TAKEN', 'UNREVIEWED'].includes(input.outcome)) throw new Error('Elegí NO TRADE, HUBO ENTRADA o SIN EVALUAR.');
    if (p.date.uncertain && !input.acceptUnknownDate) throw new Error('La fecha es incierta. Confirmá conservarla como desconocida, sin inventar una.');
    const observationId = 'historical-study:' + id, now = nowIso();
    if (data.observations.some(o => o.id === observationId && o.recovery?.tradeId !== id)) throw new Error('El ID del estudio ya está ocupado. No se sobrescribió nada.');
    const observation = { asset: p.trade.asset, context: 'BACKTEST', stageId: p.trade.stageId, recordSource: p.trade.recordSource,
      date: p.date.date, note: p.trade.note ?? '', bias: ['LONG', 'SHORT'].includes(p.trade.direction) ? p.trade.direction : null,
      session: p.trade.session || null, tags: [], createdAt: now, ...p.existing,
      id: observationId, studyOutcome: input.outcome, archived: false, archivedAt: null, updatedAt: now,
      recovery: { version: 1, tradeId: id, originalTrade: p.trade, attachmentIds: p.images.map(a => a.id),
        dateProvenance: p.date, convertedAt: now, reversedAt: null,
        history: [...(p.existing?.recovery.history || []), { action: 'convert', at: now }] } };
    assertObservation(observation);
    await track(tx, 'observations', observation);
    await track(tx, 'trades', { ...p.trade, studyConversion: { observationId, convertedAt: now } });
    tx.objectStore('syncState').put({ ...data.syncState[0], localOnlyRecovery: true });
    return observation;
  });
}
export async function reverseHistoricalStudy(observationId, expectedUpdatedAt) {
  await ensureDeviceState();
  return withStores(stores, 'readwrite', async tx => {
    const data = await read(tx); requireLocal(data);
    const obs = data.observations.find(o => o.id === observationId);
    if (!obs?.recovery || obs.archived || obs.updatedAt !== expectedUpdatedAt) throw new Error('El estudio cambió. Volvé a abrirlo antes de revertir.');
    const trade = data.trades.find(t => t.id === obs.recovery.tradeId);
    const { studyConversion, ...original } = trade || {};
    if (studyConversion?.observationId !== obs.id || JSON.stringify(original) !== JSON.stringify(obs.recovery.originalTrade)) throw new Error('El original cambió o perdió su vínculo. No se sobrescribió nada.');
    if (data.syncConflicts.some(c => !c.resolvedAt && (c.entityId === trade.id || c.entityId === obs.id || obs.recovery.attachmentIds.includes(c.entityId)))) throw new Error('Hay conflictos pendientes. Revisalos antes de revertir.');
    for (const id of obs.recovery.attachmentIds) if (!data.attachments.some(a => a.id === id && a.entityType === 'trade' && a.entityId === trade.id && a.blob?.size)) throw new Error('Falta una captura original. No se puede confirmar una reversión segura.');
    const now = nowIso();
    await track(tx, 'trades', obs.recovery.originalTrade);
    await track(tx, 'observations', { ...obs, archived: true, archivedAt: now, updatedAt: now,
      recovery: { ...obs.recovery, reversedAt: now, history: [...obs.recovery.history, { action: 'reverse', at: now }] } });
    return trade.id;
  });
}
