const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../..');
const outputDir = process.env.QA_OUTPUT || fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'maca-qa-'));
fs.mkdirSync(outputDir,{recursive:true});
const server = http.createServer((req,res)=>{
  let p=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!p.startsWith(root+path.sep)) return res.writeHead(403).end();
  if(fs.existsSync(p)&&fs.statSync(p).isDirectory()) p=path.join(p,'index.html');
  fs.readFile(p,(err,data)=>{
    if(err) return res.writeHead(404).end();
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(p)]||'application/octet-stream');
    res.end(data);
  });
});
(async()=>{
 await new Promise(r=>server.listen(8097,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH ? {executablePath:process.env.BROWSER_PATH} : {})});
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Europe/Rome'});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const page=await context.newPage();
  const logs=[];
  page.on('console',m=>logs.push(m.text()));
  page.on('pageerror',e=>logs.push('PAGEERROR '+e.message));
  await page.goto('http://127.0.0.1:8097/v2/tests/');
  await page.waitForFunction(()=>document.body.dataset.testStatus,{},{timeout:60000});
  const output=await page.locator('#out').innerText();
  fs.writeFileSync(path.join(outputDir,'maca-test-results.txt'),output+'\n'+logs.join('\n'));
  console.log(output.split('\n').filter(x=>/FAIL|ERROR|tests OK|fallos/.test(x)).join('\n'));
  console.log(logs.filter(x=>!x.includes('\n')&&/ERROR|UX Back|preview|backup-images/.test(x)).join('\n'));
  if(await page.getAttribute('body','data-test-status')!=='passed') process.exitCode=1;
  if(process.exitCode) return;
  const evidence=path.join(outputDir,'maca-evidence');fs.mkdirSync(evidence,{recursive:true});
  for(const [device,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
    const isolated=await browser.newContext({viewport,timezoneId:'Europe/Rome',isMobile:device==='mobile',hasTouch:device==='mobile'});
    await isolated.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const ui=await isolated.newPage();
    const errors=[];ui.on('pageerror',e=>errors.push(e.message));
    await ui.goto('http://127.0.0.1:8097/index.html#/nuevo/trade?context=BACKTEST');
    await ui.locator('[name="asset"]').fill('EURUSD');
    await ui.locator('[name="openedAt"]').fill('2026-09-10T10:00');
    await ui.locator('[name="closedAt"]').fill('2026-09-10T11:00');
    for(const [name,value] of Object.entries({entry:'100',initialSL:'95',tp:'110',exit:'110',netPnl:'9'})) await ui.locator(`[name="${name}"]`).fill(value);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
    await ui.locator('[name="capture-before"]').setInputFiles({name:'TEST-before.png',mimeType:'image/png',buffer:png});
    await ui.locator('[name="capture-after"]').setInputFiles({name:'TEST-after.png',mimeType:'image/png',buffer:png});
    await ui.screenshot({path:path.join(evidence,device+'-alta.png'),fullPage:true});
    await ui.getByRole('button',{name:'Guardar backtest',exact:true}).click();
    await ui.locator('.trade-detail').waitFor();
    if(await ui.locator('.thumb-card').count()!==2) throw new Error(device+' capturas no persistidas');
    await ui.reload(); await ui.locator('.trade-detail').waitFor();
    if(await ui.locator('.thumb-card').count()!==2) throw new Error(device+' capturas no sobreviven recarga');
    await ui.screenshot({path:path.join(evidence,device+'-detalle.png'),fullPage:true});
    await ui.getByRole('button',{name:'Editar operación',exact:true}).click();
    await ui.locator('[name="strategy"]').selectOption('MACA');
    await ui.screenshot({path:path.join(evidence,device+'-edicion.png'),fullPage:true});
    const cols=await ui.locator('.trade-fields-grid').first().evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length);
    if(cols!==(device==='mobile'?1:2)) throw new Error('Columnas incorrectas '+device);
    await ui.getByRole('button',{name:'Guardar cambios',exact:true}).click();
    await ui.locator('.trade-detail').waitFor();
    if(!(await ui.locator('.trade-detail').innerText()).includes('MACA')) throw new Error('Clasificación no persistida');
    if(await ui.locator('[data-route="backtesting"]').getAttribute('class')!=='is-active') throw new Error('Navegación pierde Backtesting');
    for(const route of ['backtesting','historial','numeros?universe=BACKTEST','hoy','cuentas','fondeo','estudio','sistema']) {
      await ui.goto('http://127.0.0.1:8097/index.html#/'+route);
      await ui.locator('#app > *').first().waitFor();
      await ui.waitForTimeout(80);
      const overflow=await ui.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
      if(overflow) throw new Error(device+' overflow '+route);
      if(route==='backtesting'||route==='hoy') await ui.screenshot({path:path.join(evidence,device+'-'+route+'.png'),fullPage:true});
    }
    if(errors.length) throw new Error(device+' errores '+errors.join(';'));
    console.log(device+': alta, imágenes, recarga, edición MACA, navegación, columnas y 8 pantallas sin desbordamiento OK');
    await isolated.close();
  }
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
