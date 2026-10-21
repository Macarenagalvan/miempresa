// Uses only an isolated browser profile and loopback HTTP. All external traffic blocked.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const root = path.resolve(__dirname, '../..');
const output = process.env.QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'maca-json-qa-'));
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  // Serve under a subpath too, matching GitHub Pages.
  let p = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]).replace(/^\/miempresa/, ''));
  if (!p.startsWith(root + path.sep)) return res.writeHead(403).end();
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(p)] || 'application/octet-stream');
    res.end(data);
  });
});
(async () => {
  await new Promise(r => server.listen(8098, '127.0.0.1', r));
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
  try {
    for (const [device, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
      const context = await browser.newContext({ viewport, timezoneId: 'Europe/Rome' });
      await context.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://127.0.0.1:8098/miempresa/index.html#/backtesting');
      const panel = page.getByRole('region', { name: 'Importar backtest', exact: true });
      if (await panel.isVisible()) throw new Error('Formulario abierto al entrar en Backtesting');
      await page.getByRole('button', { name: 'Importar backtest', exact: true }).click();
      if (!await panel.isVisible()) throw new Error('El botón no abre el formulario');
      if (await panel.locator('a').count()) throw new Error('Enlaces de documentación visibles en el formulario');
      await panel.getByRole('button', { name: 'Cerrar importación', exact: true }).click();
      if (await panel.isVisible()) throw new Error('Cerrar importación no oculta el formulario');
      await page.reload();
      await page.getByRole('button', { name: 'Importar backtest', exact: true }).waitFor();
      if (await panel.isVisible()) throw new Error('Formulario abierto tras recargar');
      await page.getByRole('button', { name: 'Importar backtest', exact: true }).click();
      const useZip = process.env.QA_IMPORT_ZIP === '1';
      const source = fs.readFileSync(path.join(root, useZip ? 'docs/backtest-example.zip' : 'docs/backtest-example.json'));
      const upload = { name: useZip ? 'backtest.zip' : 'backtest.json', mimeType: useZip ? 'application/zip' : 'application/json', buffer: source };
      const count = () => page.evaluate(async () => (await import('./v2/js/storage/repos/trades.js')).countTrades());
      const initial = await count();
      const expectedImages = useZip ? 3 : 0;
      for (const name of ['backtest-example.json', 'backtest-example.zip', 'IMPORTAR-BACKTEST.md', 'IMPORTAR-BACKTEST-ZIP.md']) {
        if ((await context.request.get('http://127.0.0.1:8098/miempresa/docs/' + name)).status() !== 200) throw new Error('Documentación/ejemplo no conservado: ' + name);
      }
      await panel.locator('input[type=file]').setInputFiles(upload);
      await panel.getByRole('heading', { name: /Vista previa/ }).waitFor();
      if (await count() !== initial) throw new Error('Selección guardó datos');
      if (await panel.locator('img').count() !== expectedImages) throw new Error('Faltan capturas en vista previa');
      for (const img of await panel.locator('img').all()) if (!(await img.evaluate(n => n.complete && n.naturalWidth > 0))) throw new Error('Miniatura no decodificada');
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error(device + ' overflow preview ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#app *')].filter(n => n.getBoundingClientRect().right > innerWidth + 1).map(n => [n.tagName, n.className, n.getBoundingClientRect().width]).slice(0,10))));
      await page.screenshot({ path: path.join(output, device + '-preview.png'), fullPage: true });
      await panel.getByRole('button', { name: 'Confirmar y guardar', exact: true }).click();
      await panel.getByRole('status').waitFor();
      if (await count() !== initial + 1) throw new Error('Confirmación no creó exactamente uno');
      await panel.getByRole('button', { name: 'Abrir registro y agregar capturas' }).click();
      await page.locator('.trade-detail').waitFor();
      await page.reload(); await page.locator('.trade-detail').waitFor();
      if (await page.locator('.thumb-card').count() !== expectedImages) throw new Error('Capturas ZIP no persistieron');
      await page.getByRole('button', { name: 'Editar operación', exact: true }).click();
      await page.locator('details.trade-extra summary').click();
      await page.locator('[name=note]').fill('Notas editadas después de importar');
      await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
      await page.locator('.trade-detail').waitFor();
      const file = page.locator('.captures input[type=file]');
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
      await file.setInputFiles({ name: 'captura-test.png', mimeType: 'image/png', buffer: png });
      const add = page.locator('.captures button').filter({ hasText: /Añadir imagen/ });
      await add.click();
      await page.waitForFunction(expected => document.querySelectorAll('.thumb-card').length === expected, expectedImages + 1);
      await page.reload(); await page.locator('.thumb-card').first().waitFor();
      if (await page.locator('.thumb-card').count() !== expectedImages + 1) throw new Error('Captura posterior no persistió');
      if (!(await page.locator('.trade-detail').innerText()).includes('Notas editadas después de importar')) throw new Error('Notas no persistidas');
      await page.goto('http://127.0.0.1:8098/miempresa/index.html#/backtesting');
      await page.getByRole('button', { name: 'Importar backtest', exact: true }).click();
      await panel.locator('input[type=file]').setInputFiles(upload);
      await panel.getByRole('button', { name: 'Confirmar y guardar', exact: true }).click();
      await panel.getByRole('alert').filter({ hasText: /ya existe/ }).waitFor();
      if (await count() !== initial + 1) throw new Error('Duplicado creó un registro');
      const draft = { format: 'maca-backtest', version: 1, importId: 'e2e-draft-missing', backtest: { note: 'Completar luego' } };
      await panel.locator('input[type=file]').setInputFiles({ name: 'borrador.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) });
      await panel.getByRole('button', { name: 'Confirmar y guardar', exact: true }).click();
      await panel.getByRole('status').filter({ hasText: /borrador/ }).waitFor();
      await panel.getByRole('button', { name: 'Abrir registro y agregar capturas' }).click();
      await page.locator('.trade-detail').waitFor();
      await page.getByRole('button', { name: 'Editar operación', exact: true }).click();
      await page.locator('[name=asset]').fill('XAUUSD');
      await page.locator('[name=direction]').selectOption('SHORT');
      await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
      await page.locator('.trade-detail').waitFor();
      await page.reload(); await page.locator('.trade-detail').waitFor();
      if (!(await page.locator('.trade-detail h1').innerText()).includes('XAUUSD SHORT')) throw new Error('Identidad borrador no editable');
      await page.screenshot({ path: path.join(output, device + '-draft.png'), fullPage: true });
      if (errors.length) throw new Error(errors.join('; '));
      console.log(device + ': archivo → vista previa → confirmación → recarga → notas/captura → duplicado → borrador editable OK');
      await context.close();
    }
    console.log('Evidencia: ' + output);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e.message); server.close(); process.exitCode = 1; });
