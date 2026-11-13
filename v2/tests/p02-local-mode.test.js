import './test-safety.js';
import { DB_NAME } from '../js/config.js';
import { closeDb, resetOpenCache } from '../js/storage/db.js';
import { repoFor } from '../js/storage/repos/collections.js';
import { getSyncStateRow, putSyncStateRow } from '../js/storage/repos/sync-state.js';
import { getLedgerEntry, listLedger } from '../js/storage/repos/sync-ledger.js';
import { putConflict, getConflict } from '../js/storage/repos/sync-conflicts.js';
import { getAuthState, setAuthClient } from '../js/services/auth.js';
import { assertSyncOwner } from '../js/services/sync-owner.js';
import { PAUSED_LABEL, dispatchSyncRequest } from '../js/services/sync-mode.js';
import { acknowledgePush, applyCloudVersion } from '../js/storage/sync-version.js';
import { testIdentity } from './sync-test-identity.js';
import { createMemoryCloud, setSyncCloud, resetSyncCloud } from '../js/services/sync-cloud.js';
import { ensureDeviceState, resetSyncEngine, pauseSync, prepareSyncResume, resumeSync, pushDirty, pullNow, syncNow, setSyncEnabled, bootstrapFromCloudIfEmpty, patchSyncState, bindNetworkSync, syncStatusLabel } from '../js/services/sync-engine.js';
import { resolveConflictKeepLocal, resolveConflictUseCloud } from '../js/services/sync-resolve.js';
import { buildSincronizacionPanel } from '../js/ui/screens/sistema-sync.js';

const note = text => ({ id: 'p02-note', text });
function gate() {
  let release, entered;
  const wait = new Promise(r => { release = r; }), started = new Promise(r => { entered = r; });
  return { release, started, async hold() { entered(); await wait; } };
}
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
async function fresh(active = true) {
  resetSyncEngine(); resetSyncCloud(); await closeDb(); resetOpenCache();
  await new Promise((resolve, reject) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = resolve; r.onerror = () => reject(r.error); r.onblocked = () => reject(new Error('QA blocked')); });
  await ensureDeviceState();
  if (active) await testIdentity();
}
export async function run() {
  let n = 0;
  const check = (ok, name) => { if (!ok) throw new Error('P0.2: ' + name); n++; document.getElementById('out').textContent += '\nOK P0.2 ' + name; };
  const rejects = async (fn, name) => check(Boolean((await outcome(fn())).error), name);
  const notes = repoFor('officeNotes'), images = repoFor('attachments');
  await fresh(false);
  localStorage.setItem('journalV2.supabaseUrl', 'https://example.supabase.co');
  localStorage.setItem('journalV2.supabasePublishableKey', 'pub-test-key');
  setAuthClient({ auth: { getSession: async () => ({ data: { session: { user: { id: '11111111-1111-4111-8111-111111111111', email: 'synthetic@example.test' }, access_token: 'synthetic' } } }) } });
  let calls = 0;
  const cloud = createMemoryCloud();
  setSyncCloud({ pullRecords: async () => { calls++; return cloud.pullRecords(); }, pushRecord: async x => { calls++; return cloud.pushRecord(x); } });
  check((await ensureDeviceState()).paused && !(await ensureDeviceState()).enabled, 'fresh installation starts paused');
  check((await bootstrapFromCloudIfEmpty()).reason === 'paused', 'empty-device bootstrap cannot enable cloud automatically');
  check((await syncNow()).reason === 'paused' && calls === 0, 'startup makes no Journal cloud requests');
  await testIdentity();
  await notes.put(note('before'));
  await images.put({ id: 'p02-image', blob: new Blob(['synthetic image bytes']), name: 'qa.png' });
  await pushDirty();
  await notes.put(note('pending'));
  const beforeState = await ensureDeviceState(), beforeLedger = JSON.stringify(await listLedger());
  const cloudBefore = JSON.stringify(await cloud.pullRecords());
  await pauseSync();
  check(JSON.stringify(await listLedger()) === beforeLedger, 'pause preserves pending markers byte for byte');
  const paused = await ensureDeviceState();
  check(paused.ownerUserId === beforeState.ownerUserId && paused.ownerProject === beforeState.ownerProject && paused.deviceId === beforeState.deviceId, 'pause retains owner project and device');
  check((await getAuthState()).status === 'signed_in', 'pause keeps session');
  check((await notes.get('p02-note')).text === 'pending' && await (await images.get('p02-image')).blob.text() === 'synthetic image bytes', 'pause preserves records and image bytes');
  check(JSON.stringify(await cloud.pullRecords()) === cloudBefore, 'pause does not mutate cloud');
  const afterPauseCalls = calls;
  await rejects(() => pushDirty(), 'manual upload blocked while paused');
  await rejects(() => pullNow(), 'manual download blocked while paused');
  await rejects(() => resolveConflictKeepLocal('officeNotes', 'p02-note'), 'keep-local resolution blocked while paused');
  await rejects(() => resolveConflictUseCloud('officeNotes', 'p02-note'), 'use-cloud resolution blocked while paused');
  await notes.put(note('edited locally'));
  bindNetworkSync(); window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('offline'));
  await new Promise(r => setTimeout(r, 1400));
  check(calls === afterPauseCalls, 'local edits debounce and network events make no cloud requests while paused');
  check((await getLedgerEntry('officeNotes', 'p02-note')).dirty && (await notes.get('p02-note')).text === 'edited locally', 'local editing preserves new pending version');
  check(syncStatusLabel({ state: await ensureDeviceState(), conflicts: [{}] }, null, false) === PAUSED_LABEL, 'paused label has priority over offline and conflicts');
  let panel = await buildSincronizacionPanel();
  check(panel.textContent.includes(PAUSED_LABEL) && panel.querySelector('.sync-toggle-mode').textContent === 'Reactivar sincronización', 'settings expose local mode and resume button');
  check(calls === afterPauseCalls && panel.querySelector('.sync-now').disabled, 'opening settings does not query cloud');
  await rejects(() => setSyncEnabled(true), 'legacy enable cannot bypass review');
  await patchSyncState({ enabled: true, paused: false, modeEpoch: 'forged' });
  check((await ensureDeviceState()).paused && !(await ensureDeviceState()).enabled, 'generic state patch cannot bypass pause');
  let review = await prepareSyncResume();
  check(review.pending === 1 && review.owner.project === beforeState.ownerProject, 'resume review includes identity project and pending changes');
  await notes.put(note('edited after review'));
  await rejects(() => resumeSync(review), 'editing after review invalidates confirmation');
  review = await prepareSyncResume();
  const originalUrl = localStorage.getItem('journalV2.supabaseUrl');
  localStorage.setItem('journalV2.supabaseUrl', 'https://other.supabase.co');
  await rejects(() => resumeSync(review), 'different project cannot resume');
  localStorage.setItem('journalV2.supabaseUrl', originalUrl);
  setAuthClient({ auth: { getSession: async () => ({ data: { session: { user: { id: 'other-user', email: 'other@example.test' } } } }) } });
  await rejects(() => resumeSync(review), 'different identity cannot resume');
  await testIdentity(); // explicit same-owner review through the production API
  check(calls === afterPauseCalls && (await getLedgerEntry('officeNotes', 'p02-note')).dirty, 'reactivation alone does not send or clear pending changes');
  panel = await buildSincronizacionPanel();
  check(panel.querySelector('.sync-toggle-mode').textContent === 'Pausar sincronización', 'active settings expose pause button');
  await syncNow();
  check(cloud.rows.get('officeNotes::p02-note').payload.text === 'edited after review' && !(await getLedgerEntry('officeNotes', 'p02-note')).dirty, 'explicit sync after resume sends preserved pending edit');

  // An RPC already received by the server may finish. Its late ACK must not touch local state.
  for (const reactivateBeforeReply of [false, true]) {
    await fresh(); await notes.put(note('inflight'));
    const memory = createMemoryCloud(), flight = gate();
    setSyncCloud({ pushRecord: async input => { const reply = await memory.pushRecord(input); await flight.hold(); return reply; } });
    const job = outcome(pushDirty()); await flight.started;
    const before = JSON.stringify(await listLedger());
    await pauseSync();
    if (reactivateBeforeReply) await resumeSync(await prepareSyncResume());
    flight.release();
    check(Boolean((await job).error), 'late ACK rejected; reactivated=' + reactivateBeforeReply);
    check(JSON.stringify(await listLedger()) === before && (await notes.get('p02-note')).text === 'inflight', 'late ACK preserves local state; reactivated=' + reactivateBeforeReply);
    check(memory.rows.size === 1, 'already accepted RPC is not falsely claimed cancelled');
  }
  await fresh();
  const flight = gate();
  setSyncCloud({ pullRecords: async () => { await flight.hold(); return [{ entityType: 'officeNotes', entityId: 'p02-note', revision: 1, payload: note('remote') }]; } });
  const download = outcome(pullNow()); await flight.started; await pauseSync(); await resumeSync(await prepareSyncResume()); flight.release();
  check(Boolean((await download).error) && !await notes.get('p02-note'), 'late download rejected even after reactivation');
  await notes.put(note('atomic'));
  const owner = await assertSyncOwner(), entry = await getLedgerEntry('officeNotes', 'p02-note');
  await pauseSync();
  await rejects(() => acknowledgePush(entry, 4, owner), 'ACK transaction itself checks persisted pause');
  await rejects(() => applyCloudVersion('officeNotes', 'p02-note', null, true, entry, 4, owner), 'tombstone transaction itself checks persisted pause');
  await rejects(() => putConflict({ entityType: 'officeNotes', entityId: 'p02-note' }, owner), 'conflict transaction itself checks persisted pause');
  await resumeSync(await prepareSyncResume());
  await rejects(() => acknowledgePush(entry, 4, owner), 'stale transaction epoch rejected after resume');
  let staleRequests = 0;
  await rejects(() => dispatchSyncRequest(owner, () => { staleRequests++; }), 'request dispatch transaction rejects obsolete epoch');
  check(staleRequests === 0, 'no old request starts after pause and resume');

  await putConflict({ entityType: 'officeNotes', entityId: 'p02-note', cloudRevision: 2, cloudPayload: note('cloud'), localPayload: note('atomic'), resolvedAt: null });
  await pauseSync(); review = await prepareSyncResume(); await resumeSync(review);
  check(review.conflicts === 1 && !(await getConflict('officeNotes', 'p02-note')).resolvedAt, 'resume reports but never resolves existing conflict');
  setSyncCloud(createMemoryCloud([{ entityType: 'officeNotes', entityId: 'p02-note', payload: note('cloud'), revision: 2 }]));
  await syncNow();
  check(!(await getConflict('officeNotes', 'p02-note')).resolvedAt && (await notes.get('p02-note')).text === 'atomic', 'subsequent sync does not resolve conflict automatically');
  const resolveFlight = gate();
  setSyncCloud({ pullRecords: async () => { await resolveFlight.hold(); return [{ entityType: 'officeNotes', entityId: 'p02-note', payload: note('cloud'), revision: 2 }]; } });
  const resolution = outcome(resolveConflictUseCloud('officeNotes', 'p02-note')); await resolveFlight.started; await pauseSync(); resolveFlight.release();
  check(Boolean((await resolution).error) && !(await getConflict('officeNotes', 'p02-note')).resolvedAt, 'pause during conflict resolution leaves conflict open');

  // Exercise the actual HTTP path with a local intercepted response.
  await fresh(); await notes.put(note('http pending')); resetSyncCloud();
  const originalFetch = globalThis.fetch, http = gate(); let httpCalls = 0;
  globalThis.fetch = async () => { httpCalls++; await http.hold(); return new Response(JSON.stringify({ ok: true, revision: 1 }), { status: 200 }); };
  try {
    const job = outcome(pushDirty()); await http.started; await pauseSync(); http.release();
    check(Boolean((await job).error) && (await getLedgerEntry('officeNotes', 'p02-note')).dirty, 'real HTTP adapter discards ACK after pause');
    await rejects(() => pushDirty(), 'real HTTP adapter blocks a second upload while paused');
    check(httpCalls === 1, 'paused HTTP path makes no additional requests');
  } finally { globalThis.fetch = originalFetch; }

  // Deduplication must never delete the old record separately from applying its replacement.
  await resumeSync(await prepareSyncResume());
  const token = await assertSyncOwner();
  const { withApplyLock } = await import('../js/services/sync-apply.js');
  await withApplyLock(() => notes.put({ id: 'alias', text: 'original alias' }));
  await pauseSync();
  await rejects(() => applyCloudVersion('officeNotes', 'replacement', { id: 'replacement' }, false, null, 1, token, 'alias'), 'paused replacement cannot delete original alias');
  check(Boolean(await notes.get('alias')) && !await notes.get('replacement'), 'paused alias replacement preserves original');
  await resumeSync(await prepareSyncResume());
  await applyCloudVersion('officeNotes', 'replacement', { id: 'replacement' }, false, null, 1, await assertSyncOwner(), 'alias');
  check(!await notes.get('alias') && Boolean(await notes.get('replacement')), 'active alias replacement remains atomic');

  // Simulate the persisted state written by P0.1: upgrade must never auto-enable it.
  const state = await ensureDeviceState();
  const { modeVersion, paused: ignored, modeEpoch, ...legacy } = state;
  const records = JSON.stringify(await notes.getAll()), ledger = JSON.stringify(await listLedger());
  await putSyncStateRow({ ...legacy, enabled: true });
  const upgraded = await ensureDeviceState();
  check(upgraded.paused && !upgraded.enabled && upgraded.ownerUserId === legacy.ownerUserId, 'upgrade from enabled P0.1 starts paused and retains owner');
  check(records === JSON.stringify(await notes.getAll()) && ledger === JSON.stringify(await listLedger()), 'upgrade does not rewrite records or pending ledger');
  await closeDb(); resetOpenCache();
  check((await ensureDeviceState()).paused, 'pause survives database reopening');
  resetSyncEngine(); resetSyncCloud();
  document.getElementById('out').textContent += `\nP0.2 local mode: ${n} tests OK\n`;
}
