import { withStores, requestToPromise } from '../storage/db.js';
import { SYNC_STATE_ID } from '../config.js';
import { createId } from '../domain/ids.js';

export const PAUSED_LABEL = 'Modo local — sincronización pausada';
// Missing consent (including an upgrade from P0/P0.1) always means local mode.
export function localModeState(state) {
  if (state.modeVersion === 2) return state;
  return { ...state, modeVersion: 2, paused: true, enabled: false, modeEpoch: createId(), status: 'paused' };
}
export function isSyncPaused(state) { return state?.modeVersion !== 2 || state.paused !== false; }
export async function assertModeInTransaction(tx, expected) {
  const state = await requestToPromise(tx.objectStore('syncState').get(SYNC_STATE_ID));
  if (isSyncPaused(state)) throw new Error(PAUSED_LABEL);
  if (expected && state.modeEpoch !== expected.modeEpoch) throw new Error('La sincronización cambió durante la operación. Volvé a revisar los pendientes.');
  return state;
}
// The pause transaction serializes with every cloud-derived local write.
export function withSyncStores(stores, expected, fn) {
  return withStores([...new Set([...stores, 'syncState'])], 'readwrite', async tx => {
    await assertModeInTransaction(tx, expected);
    return fn(tx);
  });
}
// Start the request while holding the same state store that pause locks.
// No new request with an old epoch can be dispatched after pause commits.
export async function dispatchSyncRequest(expected, start) {
  let result;
  await withStores(['syncState'], 'readonly', async tx => {
    await assertModeInTransaction(tx, expected);
    result = Promise.resolve(start()).then(value => ({ value }), error => ({ error }));
  });
  const settled = await result;
  if (settled.error) throw settled.error;
  return settled.value;
}
