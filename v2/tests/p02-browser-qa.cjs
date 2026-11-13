// Synthetic profiles only. The canonical runner supplies an isolated, offline context.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
module.exports = async function run({ browser, isolated, root, output, fs, path }) {
  const context = await isolated(browser);
  const a = await context.newPage(), b = await context.newPage();
  const origin = 'https://journal.test';
  try {
    await a.goto(origin + '/v2/README.md'); await b.goto(origin + '/v2/README.md');
    await a.evaluate(async () => {
      await (await import('/v2/tests/sync-test-identity.js')).testIdentity();
      const { repoFor } = await import('/v2/js/storage/repos/collections.js');
      await repoFor('officeNotes').put({ id: 'shared', text: 'before pause' });
      await repoFor('attachments').put({ id: 'shared-image', blob: new Blob(['synthetic bytes']) });
      const { buildSincronizacionPanel } = await import('/v2/js/ui/screens/sistema-sync.js');
      document.body.replaceChildren(await buildSincronizacionPanel());
      globalThis.entered = false;
      const gate = new Promise(r => { globalThis.release = r; });
      (await import('/v2/js/services/sync-cloud.js')).setSyncCloud({ pushRecord: async () => { globalThis.entered = true; await gate; return { ok: true, revision: 1 }; } });
      globalThis.job = (await import('/v2/js/services/sync-engine.js')).pushDirty().then(() => 'accepted', e => e.message);
    });
    await a.waitForFunction(() => globalThis.entered);
    await b.evaluate(async () => {
      await (await import('/v2/js/services/sync-engine.js')).pauseSync();
      await (await import('/v2/js/storage/repos/collections.js')).repoFor('officeNotes').put({ id: 'shared', text: 'edited in second tab' });
    });
    await a.waitForFunction(() => document.querySelector('.sync-engine-status')?.textContent === 'Modo local — sincronización pausada');
    const shared = await a.evaluate(async () => {
      globalThis.release(); const error = await globalThis.job;
      const { repoFor } = await import('/v2/js/storage/repos/collections.js');
      return { error, pending: (await (await import('/v2/js/storage/repos/sync-ledger.js')).getLedgerEntry('officeNotes', 'shared')).dirty,
        text: (await repoFor('officeNotes').get('shared')).text, image: await (await repoFor('attachments').get('shared-image')).blob.text() };
    });
    assert.match(shared.error, /pausada/); assert.equal(shared.pending, true);
    assert.equal(shared.text, 'edited in second tab'); assert.equal(shared.image, 'synthetic bytes');

    // Exercise the actual visible controls, including declining reactivation.
    const declined = new Promise(resolve => a.once('dialog', async dialog => { const message = dialog.message(); await dialog.dismiss(); resolve(message); }));
    await a.getByRole('button', { name: 'Reactivar sincronización', exact: true }).click();
    assert.match(await declined, /Cambios pendientes: 2/);
    assert.equal(await a.evaluate(async () => (await (await import('/v2/js/services/sync-engine.js')).ensureDeviceState()).paused), true);
    a.once('dialog', dialog => dialog.accept());
    await a.getByRole('button', { name: 'Reactivar sincronización', exact: true }).click();
    await a.getByRole('button', { name: 'Pausar sincronización', exact: true }).waitFor();
    await a.getByRole('button', { name: 'Pausar sincronización', exact: true }).click();
    await a.getByRole('button', { name: 'Reactivar sincronización', exact: true }).waitFor();
    await a.screenshot({ path: path.join(output, 'p02-local-mode.png'), fullPage: true });

    // A true P0.1 client cannot be retroactively patched. Read its exact sources
    // from Git, route them locally, and prove both the protection and its limit.
    const legacyRef = process.env.P01_TEST_REF || '0695229eea5a8ac174387d87006c9646c00e97ba';
    await context.route(origin + '/legacy/**', async route => {
      const relative = new URL(route.request().url()).pathname.slice('/legacy/'.length);
      if (!/^v2\/[\w./-]+\.js$/.test(relative) || relative.includes('..')) return route.abort();
      const source = execFileSync('git', ['show', legacyRef + ':' + relative], { cwd: root, encoding: 'utf8' });
      await route.fulfill({ body: source, contentType: 'text/javascript' });
    });
    const old = await context.newPage(); await old.goto(origin + '/v2/README.md');
    const legacy = await old.evaluate(async () => {
      const auth = await import('/legacy/v2/js/services/auth.js');
      auth.setAuthClient({ auth: { getSession: async () => ({ data: { session: { user: { id: '11111111-1111-4111-8111-111111111111', email: 'synthetic@example.test' }, access_token: 'synthetic' } } }) } });
      let calls = 0;
      const cloud = await import('/legacy/v2/js/services/sync-cloud.js');
      cloud.setSyncCloud({ pushRecord: async () => { calls++; return { ok: true, revision: 1 }; } });
      const engine = await import('/legacy/v2/js/services/sync-engine.js');
      const automatic = await engine.syncNow();
      const automaticCalls = calls;
      await engine.pushDirty();
      return { automatic: automatic.reason, automaticCalls, oldManualCalls: calls };
    });
    assert.equal(legacy.automatic, 'disabled'); assert.equal(legacy.automaticCalls, 0);
    assert.ok(legacy.oldManualCalls > 0, 'Record the old-client limitation, never claim it is protected');
    await old.close();
    // A new version can boot from legacy enabled state without Journal network traffic.
    await a.evaluate(async () => {
      const repo = await import('/v2/js/storage/repos/sync-state.js');
      const { modeVersion, paused, modeEpoch, ...state } = await repo.getSyncStateRow();
      await repo.putSyncStateRow({ ...state, enabled: true });
    });
    let journalRequests = 0;
    context.on('request', request => { if (request.url().includes('/rest/v1/')) journalRequests++; });
    // Fulfil the auth dependency locally: an existing signed-in session must not
    // weaken the default-local startup. No request reaches the CDN or Supabase.
    await context.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm', route => route.fulfill({
      contentType: 'text/javascript', body: `export function createClient() { return { auth: { getSession: async () => ({ data: { session: { user: { id: '11111111-1111-4111-8111-111111111111', email: 'synthetic@example.test' }, access_token: 'synthetic' } } }) } }; }`,
    }));
    await a.goto(origin + '/index.html#/sistema');
    await a.getByText('Modo local — sincronización pausada', { exact: true }).waitFor();
    await a.getByText('Conectado como synthetic@example.test', { exact: true }).waitFor();
    await a.waitForTimeout(1400);
    assert.equal(journalRequests, 0);
    const report = { passed: true, twoP02Tabs: shared, visibleControls: 'passed', legacyP01: legacy,
      upgradeBoot: { journalRequests, paused: true, authenticated: true }, requiredBeforeRelease: 'Close every P0/P0.1 tab on each device. Already accepted server requests cannot be undone.' };
    await fs.writeFile(path.join(output, 'p02-browser.json'), JSON.stringify(report, null, 2));
    return report;
  } finally { await context.close(); }
};
