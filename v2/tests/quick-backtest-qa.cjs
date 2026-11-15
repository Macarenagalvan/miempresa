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
 await fs.mkdir(output,{recursive:true});
 const browser = await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
 const report={devices:[],suite:null};
 try {
  for(const [device,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
   const context=await isolated(browser,{viewport,timezoneId:'Europe/Rome'});
   const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+'/index.html#/backtesting');
   await page.locator('.quick-bt').waitFor();
   const baseline=await page.evaluate(async()=>{
    const {createTrade}=await import('/v2/js/domain/trade.js');
    const {ensureJournalSeed}=await import('/v2/js/domain/stage.js');
    const {stage}=await ensureJournalSeed();
    const t=await createTrade({asset:'LEGACY',direction:'LONG',context:'BACKTEST',isDraft:true,note:'Preservar intacto'},stage.id);
    return t;
   });
   await page.reload(); await page.locator('.quick-bt').waitFor();
   assert.equal(await page.getByRole('button',{name:/Abrir backtest LEGACY/}).count(),0);
   const form=page.locator('.quick-bt');
   await form.locator('[name=sessionDate]').fill('2024-05-17');await form.locator('[name=asset]').fill('NAS100');
   await form.getByRole('button',{name:'LONG',exact:true}).click();await form.getByRole('button',{name:'WIN',exact:true}).click();
   await form.locator('[name=rrRealized]').fill('2');
   await page.screenshot({path:path.join(output,device+'-carga.png'),fullPage:true});
   await page.locator('.quick-bt').locator('..').screenshot({path:path.join(output,device+'-formulario.png')});
   await form.locator('summary').click();await form.locator('[name=note]').fill('Ejemplo sintético: ruptura y retroceso.');
   await form.locator('[name=captures]').setInputFiles({name:'demo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')});
   await form.evaluate(f=>{f.dispatchEvent(new Event('submit',{cancelable:true}));f.dispatchEvent(new Event('submit',{cancelable:true}));});
   await page.getByRole('status').filter({hasText:'Guardado'}).waitFor();
   await page.screenshot({path:path.join(output,device+'-guardado.png'),fullPage:true});
   await page.reload();await page.locator('.quick-bt').waitFor();
   const data=await page.evaluate(async baseline=>{
    const {listTrades,getTrade}=await import('/v2/js/storage/repos/trades.js');
    const rows=await listTrades(); const t=rows.find(t=>t.asset==='NAS100');
    const images=await (await import('/v2/js/storage/repos/attachments.js')).listTradeImages(t.id);
    const stats=(await import('/v2/js/domain/stats.js')).compute(rows,{universe:'BACKTEST'});
    return {t,count:rows.length,legacy:await getTrade(baseline.id),images:images.length,stats,paused:(await (await import('/v2/js/services/sync-engine.js')).ensureDeviceState()).paused,db:(await import('/v2/js/config.js')).DB_NAME};
   },baseline);
   assert.equal(data.count,2);assert.deepEqual(data.legacy,baseline);assert.equal(data.images,1);assert.equal(data.paused,true);assert.match(data.db,/^JournalV2-QA-/);
   for(const key of ['entry','exit','netPnl','openedAt','closedAt']) assert.equal(data.t[key],null);
   assert.equal(data.t.sourceRef.sessionDate,'2024-05-17'); assert.equal(data.stats.nClosed,1);assert.equal(data.stats.nMoney,0);assert.equal(data.stats.nR,1);assert.equal(data.stats.expectancyR,2);
   await page.getByRole('button',{name:/Abrir backtest NAS100/}).click();await page.locator('.trade-detail').waitFor();
   assert.match(await page.locator('.trade-detail').innerText(),/2024-05-17/);
   await page.screenshot({path:path.join(output,device+'-lectura.png'),fullPage:true});
   await page.goto(origin+'/index.html#/backtesting');await page.locator('.quick-bt').waitFor();
   await form.locator('[name=sessionDate]').fill('2024-05-18');await form.locator('[name=asset]').fill('MNQ');
   await form.getByRole('button',{name:'NO TRADE',exact:true}).click();assert.equal(await form.locator('[name=rrRealized]').isVisible(),false);
   await form.getByRole('button',{name:'Guardar estudio',exact:true}).click();await page.getByRole('status').filter({hasText:'Guardado'}).waitFor();
   const extra=await page.evaluate(async()=>{
    const {ensureJournalSeed}=await import('/v2/js/domain/stage.js');const {stage}=await ensureJournalSeed();
    const {createClosedTrade,enrichTrade}=await import('/v2/js/domain/trade-journal.js');
    const {listTrades}=await import('/v2/js/storage/repos/trades.js');
    const {listObservations}=await import('/v2/js/storage/repos/observations.js');
    const {compute,computeStudies}=await import('/v2/js/domain/stats.js');
    const base={context:'BACKTEST',sessionDate:'2024-05-19',asset:'MNQ',direction:'SHORT'};
    const loss=await createClosedTrade({...base,result:'LOSS'},stage.id);
    await createClosedTrade({...base,result:'BE',rrRealized:0},stage.id);
    await enrichTrade(loss.id,{note:'Nota editada'});
    let rejected=0;
    for(const patch of [{result:'WIN',rrRealized:-1},{result:'LOSS',rrRealized:1},{result:'BE',rrRealized:2},{result:'WIN',sessionDate:'2024-02-30'},{result:'NO_TRADE'},{result:'WIN',context:'DEMO'},{result:'WIN',context:'LIVE'},{result:'WIN',direction:''},{result:'WIN',entry:10}]) {
      try {await createClosedTrade({...base,...patch},stage.id);}catch{rejected++;}
    }
    const before=(await listTrades()).length;
    try {await createClosedTrade({...base,result:'WIN'},stage.id,[new Blob(['bad'],{type:'text/plain'})]);}catch{rejected++;}
    const originalPut=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args) { if(this.name==='attachments') throw new Error('Synthetic attachment failure'); return originalPut.apply(this,args); };
    try {await createClosedTrade({...base,result:'WIN'},stage.id,[new Blob(['image'],{type:'image/png'})]);}catch{rejected++;}
    finally {IDBObjectStore.prototype.put=originalPut;}
    const rows=await listTrades();const studies=await listObservations();
    return {before,after:rows.length,rejected,stats:compute(rows,{universe:'BACKTEST'}),filtered:compute(rows,{universe:'BACKTEST',from:'2024-05-19',to:'2024-05-19'}),real:compute(rows,{universe:'REAL'}),demo:compute(rows,{context:'DEMO'}),studies:computeStudies(studies),study:studies[0]};
   });
   assert.equal(extra.rejected,11);assert.equal(extra.before,extra.after);assert.equal(extra.stats.nClosed,3);assert.equal(extra.stats.nMoney,0);assert.equal(extra.stats.netPnl,null);assert.equal(extra.stats.nR,2);assert.equal(extra.stats.expectancyR,1);assert.equal(extra.stats.winRate,.5);assert.equal(extra.stats.maxConsecWins,null);assert.equal(extra.stats.maxConsecLosses,null);assert.equal(extra.filtered.nClosed,2);assert.equal(extra.real.nClosed,0);assert.equal(extra.demo.nClosed,0);assert.equal(extra.studies.noTrade,1);assert.equal(extra.study.bias,null);
   const restored=await page.evaluate(async()=>{
    const {buildExportPayload,validateBackup,applyRestoreTransaction}=await import('/v2/js/services/backup.js');
    const {listTrades}=await import('/v2/js/storage/repos/trades.js');
    const before=await listTrades();const payload=JSON.parse(JSON.stringify(await buildExportPayload()));
    if(!validateBackup(payload).ok) throw new Error('Backup de carga rápida inválido');
    await applyRestoreTransaction(payload);return {before,after:await listTrades()};
   });
   assert.deepEqual(restored.after,restored.before);
   await page.reload();await page.locator('.quick-bt').waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);
   report.devices.push({device,saveReload:true,doubleSubmitOneRecord:true,legacyUnchanged:true,attachment:true,paused:true,statistics:extra});
   await context.close();
  }
  const context=await isolated(browser);const page=await context.newPage();const logs=[];page.on('console',m=>logs.push(m.text()));page.on('pageerror',e=>logs.push(e.message));
  await page.goto(origin+'/v2/tests/');await page.waitForFunction(()=>document.body.dataset.testStatus,null,{timeout:60000});
  report.suite=await page.getAttribute('body','data-test-status');await fs.writeFile(path.join(output,'suite.txt'),logs.join('\n')+'\n'+await page.locator('#out').innerText());
  assert.equal(report.suite,'passed');await context.close();
 }finally{await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
