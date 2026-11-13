// Offline QA: fresh browser contexts, source files fulfilled from disk, no production requests.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const output = process.env.QA_OUTPUT || path.resolve(root, '../p0-qa');
const origin = 'https://journal.test';
async function isolated(browser, options = {}) {
  const context = await browser.newContext(options);
  await context.addInitScript(marker => { globalThis.__JOURNAL_QA__ = marker; }, require('node:crypto').randomUUID());
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep)) return route.abort();
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    try { await route.fulfill({ status: 200, body: await fs.readFile(file), contentType: ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.md':'text/plain' })[path.extname(file)] || 'application/octet-stream' }); }
    catch { await route.fulfill({status:404,body:'Not found'}); }
  });
  return context;
}
(async () => {
  await fs.mkdir(output, {recursive:true});
  const browser = await chromium.launch({headless:true,...(process.env.BROWSER_PATH ? {executablePath:process.env.BROWSER_PATH} : {})});
  const report = { suite: null, restore: null, isolation: [], devices: [] };
  try {
    // A production-shaped origin and even a forged marker must never run tests.
    // Both contexts are disposable; the sentinel is synthetic, not user data.
    for (const [host, marker] of [['production.example.test', true], ['journal.test', false]]) {
      const context = await browser.newContext();
      if (marker) await context.addInitScript(() => { globalThis.__JOURNAL_QA__ = 'forged-qa-marker-123456'; });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname !== host) return route.abort();
        let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        if (!file.startsWith(root + path.sep)) return route.abort();
        if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
        try { await route.fulfill({ status: 200, body: await fs.readFile(file), contentType: path.extname(file) === '.js' ? 'text/javascript' : 'text/html' }); }
        catch { await route.fulfill({ status: 404, body: '' }); }
      });
      const page = await context.newPage();
      await page.goto('https://' + host + '/v2/README.md');
      const result = await page.evaluate(async () => {
        const open = indexedDB.open.bind(indexedDB), remove = indexedDB.deleteDatabase.bind(indexedDB);
        const db = await new Promise((resolve, reject) => {
          const r = open('JournalV2', 3); r.onupgradeneeded = () => r.result.createObjectStore('sentinel'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
        });
        await new Promise((resolve, reject) => { const tx = db.transaction('sentinel', 'readwrite'); tx.objectStore('sentinel').put('synthetic-preserve', 'key'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
        db.close();
        let opens = 0, deletes = 0, blocked = 0;
        indexedDB.open = (...args) => { opens++; return open(...args); };
        indexedDB.deleteDatabase = (...args) => { deletes++; return remove(...args); };
        for (const name of ['slice0', 'slice13', 'slice20', 'p0-studies', 'p01-security', 'p02-local-mode', 'p03-historical-study']) {
          try { const mod = await import('/v2/tests/' + name + '.test.js'); await mod.run(); }
          catch (e) { if (e.message.includes('Pruebas bloqueadas')) blocked++; else throw e; }
        }
        const verify = await new Promise(resolve => { const r = open('JournalV2'); r.onsuccess = () => resolve(r.result); });
        const value = await new Promise(resolve => { const r = verify.transaction('sentinel').objectStore('sentinel').get('key'); r.onsuccess = () => resolve(r.result); });
        verify.close(); return { opens, deletes, blocked, value };
      });
      assert.deepEqual(result, { opens: 0, deletes: 0, blocked: 7, value: 'synthetic-preserve' });
      report.isolation.push({ host, passed: true, ...result });
      await context.close();
    }
    const suite = await isolated(browser, {timezoneId:'Europe/Rome'});
    const test = await suite.newPage();
    await test.goto(origin + '/v2/tests/');
    await test.waitForFunction(() => document.body.dataset.testStatus, {}, {timeout:120000});
    const log = await test.locator('#out').innerText();
    await fs.writeFile(path.join(output, 'tests.txt'), log);
    report.suite = await test.getAttribute('body', 'data-test-status');
    assert.equal(report.suite, 'passed', log.slice(-1500));
    await suite.close();
    report.localMode = await require('./p02-browser-qa.cjs')({ browser, isolated, root, output, fs, path });
    report.historicalRecovery = await require('./p03-browser-qa.cjs')({ browser, isolated, output, fs, path });

    if (process.env.BACKUP_PATH) {
      const bytes = await fs.readFile(process.env.BACKUP_PATH);
      const original = JSON.parse(bytes.toString('utf8'));
      const isolatedBackup = await isolated(browser, {timezoneId:'Europe/Rome'});
      const page = await isolatedBackup.newPage();
      // A static source resource provides an origin without booting the application.
      await page.goto(origin + '/v2/README.md');
      report.restore = await page.evaluate(async payload => {
        const backup = await import('/v2/js/services/backup.js');
        const sync = await import('/v2/js/services/sync-engine.js');
        const before = backup.validateBackup(payload);
        if (!before.ok) throw new Error(before.errors.join('; '));
        if ((await sync.ensureDeviceState()).enabled) throw new Error('Sync must be disabled');
        await backup.restoreBackup(payload, {confirmed:true,alreadyProtected:true});
        const result = JSON.parse(JSON.stringify(await backup.buildExportPayload()));
        const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
        for (const [key, value] of Object.entries(payload)) {
          if (!Array.isArray(value) && key !== 'meta') continue;
          const sorted = rows => Array.isArray(rows) ? [...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id))) : rows;
          if (JSON.stringify(canonical(sorted(value))) !== JSON.stringify(canonical(sorted(result[key])))) throw new Error('Roundtrip mismatch: ' + key);
        }
        return {passed:true,counts:before.counts,exactImages:true,exactRecords:true,syncEnabled:(await sync.ensureDeviceState()).enabled};
      }, original);
      const hash = data => createHash('sha256').update(data).digest('hex');
      assert.equal(hash(await fs.readFile(process.env.BACKUP_PATH)), hash(bytes));
      report.restore.sha256 = hash(bytes);
      await isolatedBackup.close();
    }

    for (const [device, timezoneId, viewport] of [['desktop','Europe/Rome',{width:1440,height:1000}],['mobile','America/New_York',{width:390,height:844}]]) {
      const context = await isolated(browser, {timezoneId,viewport,isMobile:device==='mobile',hasTouch:device==='mobile'});
      const page = await context.newPage();
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin + '/index.html#/nuevo');
      await page.getByRole('button',{name:'Estudio / NO TRADE',exact:true}).click();
      await page.locator('[name=asset]').fill('MNQ');
      await page.locator('[name=studyDate]').fill('2026-09-01');
      await page.locator('[name=note]').fill('Estudio QA: escenario descartado, sin ejecución.');
      await page.getByRole('group',{name:'Sesgo',exact:true}).getByRole('button',{name:'NEUTRAL',exact:true}).focus();
      await page.keyboard.press('Space');
      const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
      await page.locator('[name=study-images]').setInputFiles({name:'qa.png',mimeType:'image/png',buffer:png});
      await page.getByRole('button',{name:'Guardar estudio',exact:true}).evaluate(button=>{button.click();button.click();});
      await page.waitForURL(url=>url.hash.startsWith('#/observacion/'));
      const studyUrl=page.url();
      await page.locator('.thumb').waitFor();
      const studyState=await page.evaluate(async()=>{
        const {listObservations}=await import('/v2/js/storage/repos/observations.js');
        const {listTrades}=await import('/v2/js/storage/repos/trades.js');
        const rows=await listObservations();return {count:rows.length,bias:rows[0].bias,trades:(await listTrades()).length};
      });
      assert.deepEqual(studyState,{count:1,bias:'NEUTRAL',trades:0});
      await page.screenshot({path:path.join(output,device+'-study.png'),fullPage:true});
      await page.locator('[name=note]').fill('Estudio QA editado; captura conservada.');
      await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('button') && [...document.querySelectorAll('button')].some(b=>b.textContent==='Guardar cambios'&&!b.disabled));
      assert.equal(page.url(),studyUrl);
      assert.equal(await page.locator('.thumb').count(),1);
      await page.getByRole('button',{name:'Trade simulado',exact:true}).click();
      assert.equal(await page.locator('[name=openedAt]').inputValue(),'');
      assert.equal(await page.locator('[name=closedAt]').inputValue(),'');
      await page.locator('[name=asset]').fill('MNQ');
      await page.getByRole('button',{name:'Guardar backtest',exact:true}).click();
      await page.getByRole('alert').filter({hasText:'Completá'}).waitFor();
      await page.locator('summary').filter({hasText:'Detalles adicionales'}).click();
      await page.locator('[name=note]').fill('Nota QA del borrador histórico.');
      await page.locator('[name=capture-before]').setInputFiles({name:'qa-trade.png',mimeType:'image/png',buffer:png});
      await page.getByRole('button',{name:'Guardar borrador',exact:true}).click();
      await page.waitForURL(url=>url.hash.startsWith('#/trade/'));
      const tradeId=page.url().split('/trade/')[1].split('?')[0];
      await page.getByRole('button',{name:'Cerrar operación',exact:true}).click();
      await page.locator('[name=openedAt]').fill('2026-09-01T10:00');
      await page.locator('[name=closedAt]').fill('2026-09-01T11:00');
      await page.locator('[name=entry]').fill('100');
      await page.locator('[name=exit]').fill('110');
      await page.locator('[name=netPnl]').fill('20');
      await page.screenshot({path:path.join(output,device+'-draft.png'),fullPage:true});
      await page.getByRole('button',{name:'Guardar cambios',exact:true}).evaluate(button=>{button.click();button.click();});
      await page.waitForURL(url=>url.hash==='#/trade/'+tradeId);
      const tradeState=await page.evaluate(async id=>{
        const {getTrade,listTrades}=await import('/v2/js/storage/repos/trades.js');
        const {listTradeImages}=await import('/v2/js/storage/repos/attachments.js');
        const t=await getTrade(id);return {count:(await listTrades()).length,id:t.id,note:t.note,images:(await listTradeImages(id)).length,status:t.lifecycle,openedAt:t.openedAt};
      },tradeId);
      assert.equal(tradeState.count,1);assert.equal(tradeState.status,'CLOSED');assert.equal(tradeState.images,1);
      assert.equal(tradeState.note,'Nota QA del borrador histórico.');
      assert.equal(tradeState.openedAt,timezoneId==='Europe/Rome'?'2026-09-01T08:00:00.000Z':'2026-09-01T14:00:00.000Z');
      const gap=timezoneId==='Europe/Rome'?'2026-03-29T02:30':'2026-03-08T02:30';
      assert.equal(await page.evaluate(async value=>{const {localDateTimeIso}=await import('/v2/js/ui/trade-presentation.js');try{localDateTimeIso(value);return false;}catch{return true;}},gap),true);
      await page.goto(origin+'/index.html#/backtesting');
      await page.getByRole('heading',{name:'Backtesting',exact:true}).waitFor();
      await page.screenshot({path:path.join(output,device+'-backtesting.png'),fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'horizontal overflow');
      await page.goto(origin+'/index.html#/sistema');
      await page.getByText('Modo local — sincronización pausada', {exact:true}).waitFor();
      await page.getByRole('button', {name:'Reactivar sincronización',exact:true}).waitFor();
      await page.locator('#sincronizacion').screenshot({path:path.join(output,device+'-local-mode.png')});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'local-mode horizontal overflow');
      assert.deepEqual(errors,[]);
      report.devices.push({device,timezoneId,passed:true,keyboard:true,doubleClick:true,studyAndDraftImages:true,dates:true,dstGapRejected:true,localMode:true});
      await context.close();
    }
    console.log(JSON.stringify(report,null,2));
  } finally {await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
