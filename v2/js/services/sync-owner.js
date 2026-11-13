import { localModeState, assertModeInTransaction } from './sync-mode.js';
import { getAuthState, readSupabaseConfig, authGeneration } from './auth.js';
import { withStores, requestToPromise } from '../storage/db.js';
import { SYNC_STATE_ID } from '../config.js';

function denied(message) { throw new Error('Sincronización bloqueada: ' + message); }
export async function currentIdentity() {
  const generation = authGeneration();
  const project = new URL(readSupabaseConfig().url).origin;
  const auth = await getAuthState();
  if (auth.status !== 'signed_in' || !auth.userId || generation !== authGeneration()) denied('iniciá sesión con la cuenta propietaria.');
  return { userId: auth.userId, project, generation };
}
function checkOwner(state, identity) {
  if (!state?.ownerUserId || !state?.ownerProject) denied('confirmá la pertenencia de este Journal antes de conectarlo.');
  if (state.ownerUserId !== identity.userId || state.ownerProject !== identity.project) denied('este Journal pertenece a otra cuenta o proyecto. Los datos locales se conservan.');
}
export async function assertSyncOwner(expected = null, { allowPaused = false } = {}) {
  const identity = await currentIdentity();
  if (expected && (identity.userId !== expected.userId || identity.project !== expected.project || identity.generation !== expected.generation)) denied('la sesión cambió durante la operación.');
  await withStores(['syncState'], 'readwrite', async tx => {
    const store = tx.objectStore('syncState');
    const old = await requestToPromise(store.get(SYNC_STATE_ID));
    checkOwner(old, identity);
    const state = localModeState(old);
    if (state !== old) store.put(state);
    if (!allowPaused) await assertModeInTransaction(tx, expected);
    identity.modeEpoch = state.modeEpoch;
  });
  return identity;
}
// Only explicit initial upload/confirmation or a genuinely empty device may bind.
// Once bound, neither logout nor changing configuration can transfer ownership.
export async function bindSyncOwner() {
  const identity = await currentIdentity();
  await withStores(['syncState'], 'readwrite', async tx => {
    const store = tx.objectStore('syncState');
    const state = await requestToPromise(store.get(SYNC_STATE_ID));
    if (!state) denied('abrí la configuración y volvé a intentar.');
    if (state.ownerUserId || state.ownerProject) { checkOwner(state, identity); return; }
    if (state.userId && state.userId !== identity.userId) denied('la cuenta anterior no coincide. No se transfieren registros.');
    store.put({ ...state, ownerUserId: identity.userId, ownerProject: identity.project, userId: identity.userId });
  });
  return assertSyncOwner(identity, { allowPaused: true });
}
