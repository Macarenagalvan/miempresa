import { prepareSyncResume, resumeSync } from '../js/services/sync-engine.js';
import './test-safety.js';
import { DB_NAME } from '../js/config.js';
import { closeDb, resetOpenCache } from '../js/storage/db.js';
import { repoFor } from '../js/storage/repos/collections.js';
import { getLedgerEntry, listLedger } from '../js/storage/repos/sync-ledger.js';
import { getSyncStateRow, putSyncStateRow } from '../js/storage/repos/sync-state.js';
import { getConflict } from '../js/storage/repos/sync-conflicts.js';
import { setAuthClient, signOut } from '../js/services/auth.js';
import { bindSyncOwner, assertSyncOwner } from '../js/services/sync-owner.js';
import { createMemoryCloud, setSyncCloud, resetSyncCloud } from '../js/services/sync-cloud.js';
import { resetSyncEngine, ensureDeviceState, pushDirty, pullNow, setSyncEnabled, setOnlineOverride, syncNow, enableAndUploadLocalJournal } from '../js/services/sync-engine.js';
import { resolveConflictKeepLocal, resolveConflictUseCloud } from '../js/services/sync-resolve.js';
import { saveStudy } from '../js/domain/observation.js';
import { ensureJournalSeed } from '../js/domain/stage.js';
import { createTrade, completeDraftTrade } from '../js/domain/trade.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const project = 'https://example.supabase.co';
let session;
function login(id = A, url = project) {
  localStorage.setItem('journalV2.supabaseUrl', url);
  localStorage.setItem('journalV2.supabasePublishableKey', 'pub-test-key');
  session = id ? { user: { id, email: 'synthetic@example.test' }, access_token: 'token-' + id } : null;
  setAuthClient({ auth: { getSession: async () => ({ data: { session }, error: null }), signOut: async () => { session = null; return { error: null }; } } });
}
async function fresh(userId = A) {
  resetSyncEngine(); await closeDb(); resetOpenCache();
  await new Promise((resolve, reject) => { const req = indexedDB.deleteDatabase(DB_NAME); req.onsuccess = resolve; req.onerror = () => reject(req.error); req.onblocked = () => reject(new Error('QA database blocked')); });
  login(userId); await ensureDeviceState(); await bindSyncOwner(); await resumeSync(await prepareSyncResume()); setOnlineOverride(true);
}
function gate() {
  let release, entered;
  const wait = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  return { release, started, async pause() { entered(); await wait; } };
}
const note = (text, id = 'p01-note') => ({ id, text, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archivedAt: null });

export async function run() {
  let n = 0;
  const check = (ok, name) => { if (!ok) throw new Error('P0.1: ' + name); n++; document.getElementById('out').textContent += '\nOK P0.1 ' + name; };
  const rejects = async (fn, name) => { let rejected = false; try { await fn(); } catch { rejected = true; } check(rejected, name); };
  const notes = repoFor('officeNotes');
  await fresh();
  const cloudA = createMemoryCloud(), cloudB = createMemoryCloud();
  const cloud = cloudA;
  setSyncCloud(cloud);
  await notes.put(note('v1'));
  const v1 = await getLedgerEntry('officeNotes', 'p01-note');
  const upload = gate();
  setSyncCloud({ pushRecord: async input => { await upload.pause(); return cloud.pushRecord(input); } });
  const pending = pushDirty(); await upload.started;
  await notes.put(note('v2'));
  const v2 = await getLedgerEntry('officeNotes', 'p01-note');
  check(v1.localVersion !== v2.localVersion, 'version changes even with identical record timestamps');
  upload.release(); await pending;
  let ledger = await getLedgerEntry('officeNotes', 'p01-note');
  check(ledger.dirty && ledger.cloudRevision === 1 && ledger.localVersion === v2.localVersion, 'ACK advances cloud revision but preserves newer pending version');
  check((await notes.get('p01-note')).text === 'v2' && cloud.rows.get('officeNotes::p01-note').payload.text === 'v1', 'newer local content survives ACK');
  setSyncCloud(cloud); await pushDirty();
  check(!((await getLedgerEntry('officeNotes', 'p01-note')).dirty) && cloud.rows.get('officeNotes::p01-note').payload.text === 'v2', 'retry sends newer content');

  await notes.put(note('v3'));
  const deletion = gate();
  setSyncCloud({ pushRecord: async input => { await deletion.pause(); return cloud.pushRecord(input); } });
  const deleting = pushDirty(); await deletion.started; await notes.delete('p01-note'); deletion.release(); await deleting;
  ledger = await getLedgerEntry('officeNotes', 'p01-note');
  check(ledger.dirty && ledger.tombstone && !await notes.get('p01-note'), 'delete during upload remains pending and never resurrects');
  const resurrection = gate();
  setSyncCloud({ pushRecord: async input => { await resurrection.pause(); return cloud.pushRecord(input); } });
  const restoring = pushDirty(); await resurrection.started; await notes.put(note('v4')); resurrection.release(); await restoring;
  ledger = await getLedgerEntry('officeNotes', 'p01-note');
  check(ledger.dirty && !ledger.tombstone && (await notes.get('p01-note')).text === 'v4', 'recreate during tombstone upload remains pending');
  setSyncCloud(cloud); await pushDirty();
  check(cloud.rows.get('officeNotes::p01-note').payload.text === 'v4', 'recreated row reaches cloud');
  const atomicBefore = JSON.stringify(await getLedgerEntry('officeNotes', 'p01-note'));
  await rejects(() => notes.put({ ...note('invalid'), cannotClone: () => {} }), 'invalid record aborts atomic write');
  check((await notes.get('p01-note')).text === 'v4' && JSON.stringify(await getLedgerEntry('officeNotes', 'p01-note')) === atomicBefore, 'failed record write rolls back pending marker too');

  await notes.put(note('offline'));
  await setSyncEnabled(true, await prepareSyncResume()); setOnlineOverride(false);
  let calls = 0;
  setSyncCloud({ pullRecords: async () => { calls++; return cloud.pullRecords(); }, pushRecord: async input => { calls++; return cloud.pushRecord(input); } });
  check((await syncNow()).reason === 'offline' && calls === 0, 'offline makes no cloud requests');
  check((await getLedgerEntry('officeNotes', 'p01-note')).dirty, 'offline preserves pending state');
  setOnlineOverride(true); await syncNow();
  check(cloud.rows.get('officeNotes::p01-note').payload.text === 'offline' && !(await getLedgerEntry('officeNotes', 'p01-note')).dirty, 'reconnection sends pending data');
  await setSyncEnabled(false);
  await resumeSync(await prepareSyncResume());
  await notes.put(note('network-failure'));
  setSyncCloud({ pushRecord: async () => { throw new Error('synthetic network failure'); } });
  await rejects(() => pushDirty(), 'network failure reported');
  check((await getLedgerEntry('officeNotes', 'p01-note')).dirty, 'failed upload never acknowledges');
  setSyncCloud(cloud); await pushDirty();

  const remote = cloud.rows.get('officeNotes::p01-note'); remote.revision++; remote.payload = note('remote');
  await notes.put(note('local-conflict')); await pushDirty();
  check(Boolean(await getConflict('officeNotes', 'p01-note')), 'stale revision opens conflict');
  const resolving = gate();
  setSyncCloud({ pullRecords: () => cloud.pullRecords(), pushRecord: async input => { await resolving.pause(); return cloud.pushRecord(input); } });
  const resolution = resolveConflictKeepLocal('officeNotes', 'p01-note'); await resolving.started;
  await notes.put(note('edited-during-resolution')); resolving.release(); await resolution;
  check((await notes.get('p01-note')).text === 'edited-during-resolution' && (await getLedgerEntry('officeNotes', 'p01-note')).dirty, 'keep-local resolution preserves concurrent edit');
  setSyncCloud(cloud); await pushDirty();
  cloud.rows.get('officeNotes::p01-note').revision++;
  await notes.put(note('another-conflict')); await pushDirty();
  const pulling = gate();
  setSyncCloud({ pullRecords: async () => { const rows = await cloud.pullRecords(); await pulling.pause(); return rows; } });
  const useCloud = resolveConflictUseCloud('officeNotes', 'p01-note'); await pulling.started;
  await notes.put(note('edit-during-use-cloud')); pulling.release();
  check((await useCloud).reason === 'stale_local' && (await notes.get('p01-note')).text === 'edit-during-use-cloud', 'cloud choice refuses to overwrite later edit');

  const recordsBefore = JSON.stringify(await notes.getAll());
  const ledgerBefore = JSON.stringify(await listLedger());
  calls = 0; login(B);
  setSyncCloud({ pullRecords: async () => { calls++; return cloudB.pullRecords(); }, pushRecord: async input => { calls++; return cloudB.pushRecord(input); } });
  await rejects(() => pullNow(), 'other account cannot pull');
  await rejects(() => pushDirty(), 'other account cannot push');
  await rejects(() => bindSyncOwner(), 'binding cannot transfer ownership');
  await rejects(() => enableAndUploadLocalJournal(), 'explicit upload cannot transfer ownership');
  await rejects(() => resolveConflictKeepLocal('officeNotes', 'p01-note'), 'other account cannot keep-local');
  await rejects(() => resolveConflictUseCloud('officeNotes', 'p01-note'), 'other account cannot use-cloud');
  check(calls === 0 && cloudB.rows.size === 0, 'no request reaches second identity');
  check(recordsBefore === JSON.stringify(await notes.getAll()) && ledgerBefore === JSON.stringify(await listLedger()), 'account switch preserves all local records and pending markers');
  login(A, 'https://other.supabase.co');
  await rejects(() => pushDirty(), 'same user on another project blocked');
  login(A); await assertSyncOwner(); check(true, 'original identity can resume');
  await signOut(); await rejects(() => pullNow(), 'signed-out cannot pull');
  check((await getSyncStateRow()).ownerUserId === A, 'logout retains ownership');

  await fresh(); await notes.put(note('inflight-A'));
  const flight = gate(); const isolatedA = createMemoryCloud();
  setSyncCloud({ pushRecord: async input => { await flight.pause(); return isolatedA.pushRecord(input); } });
  const oldRequest = pushDirty(); await flight.started; login(B); flight.release();
  await rejects(() => oldRequest, 'account switch during upload discards ACK');
  check((await getLedgerEntry('officeNotes', 'p01-note')).dirty && (await notes.get('p01-note')).text === 'inflight-A', 'discarded ACK preserves local version');
  login(A);
  const readFlight = gate();
  setSyncCloud({ pullRecords: async () => { await readFlight.pause(); return [{ entityType: 'officeNotes', entityId: 'remote-only', revision: 1, payload: note('remote', 'remote-only') }]; } });
  const oldPull = pullNow(); await readFlight.started; await signOut(); readFlight.release();
  await rejects(() => oldPull, 'logout during pull discards response');
  check(!await notes.get('remote-only'), 'late remote response not applied');

  await fresh();
  // Real HTTP adapter with intercepted fetch, never any external network.
  resetSyncCloud(); await notes.put(note('http'));
  const originalFetch = globalThis.fetch, http = gate(); let request;
  globalThis.fetch = async (url, options) => { request = { url, options }; await http.pause(); return new Response(JSON.stringify({ ok: true, revision: 1 }), { status: 200 }); };
  try {
    const job = pushDirty(); await http.started; login(B); http.release();
    await rejects(() => job, 'HTTP response after user switch not acknowledged');
    check(request.url === project + '/rest/v1/rpc/journal_sync_push' && request.options.headers.Authorization === 'Bearer token-' + A, 'HTTP request pinned to original project and access token');
    check((await getLedgerEntry('officeNotes', 'p01-note')).dirty, 'HTTP late ACK leaves pending flag');
  } finally { globalThis.fetch = originalFetch; }

  await fresh();
  const seed = await ensureJournalSeed(); const studies = createMemoryCloud(); setSyncCloud(studies); await pushDirty();
  const study = await saveStudy({ asset: 'MNQ', date: '2026-09-01', studyOutcome: 'NO_TRADE', note: 'first' }, seed.stage.id);
  const studyFlight = gate();
  setSyncCloud({ pushRecord: async input => { await studyFlight.pause(); return studies.pushRecord(input); } });
  const studyPush = pushDirty(); await studyFlight.started;
  await saveStudy({ ...study, note: 'second' }, seed.stage.id, [], study.id); studyFlight.release(); await studyPush;
  check((await getLedgerEntry('observations', study.id)).dirty, 'P0 atomic study writer generates new version');
  setSyncCloud(studies); await pushDirty();
  const draft = await createTrade({ asset: 'MNQ', direction: 'LONG', isDraft: true }, seed.stage.id);
  const draftFlight = gate();
  setSyncCloud({ pushRecord: async input => { await draftFlight.pause(); return studies.pushRecord(input); } });
  const draftPush = pushDirty(); await draftFlight.started;
  await completeDraftTrade(draft.id, { entry: 100, exit: 110, netPnl: 10, openedAt: '2026-09-01T10:00:00Z', closedAt: '2026-09-01T11:00:00Z' }, { note: 'closed' }, 'CLOSED');
  draftFlight.release(); await draftPush;
  check((await getLedgerEntry('trades', draft.id)).dirty && (await repoFor('trades').get(draft.id)).lifecycle === 'CLOSED', 'P0 draft completion survives old upload ACK');

  await fresh(B); setSyncCloud(cloudB); await notes.put(note('belongs-only-to-B', 'B-only')); await pushDirty();
  check(cloudB.rows.size === 1 && cloudB.rows.get('officeNotes::B-only').payload.text === 'belongs-only-to-B', 'second identity can sync its own fresh device');
  check(!cloudA.rows.has('officeNotes::B-only'), 'second identity never writes into first synthetic cloud');

  await fresh();
  const state = await getSyncStateRow();
  await putSyncStateRow({ ...state, ownerUserId: null, ownerProject: null, userId: A, enabled: true });
  login(B); await rejects(() => bindSyncOwner(), 'legacy user ownership cannot transfer');
  login(A); await rejects(() => syncNow(), 'legacy unconfirmed project blocks automatic sync');
  await bindSyncOwner(); check((await getSyncStateRow()).ownerProject === project, 'explicit same-user legacy confirmation binds project');
  await setSyncEnabled(false); resetSyncCloud(); resetSyncEngine(); login(null);
  document.getElementById('out').textContent += `\nP0.1 safety: ${n} tests OK\n`;
}
