const assert = require('node:assert/strict');
module.exports = async function run({browser, isolated, output, fs, path}) {
  const results=[];
  for(const [device,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
    const context=await isolated(browser,{viewport,isMobile:device==='mobile',hasTouch:device==='mobile'});
    try {
      const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto('https://journal.test/index.html#/backtesting');
      const original=await page.evaluate(async()=>{
        const {ensureJournalSeed}=await import('/v2/js/domain/stage.js');const seed=await ensureJournalSeed();
        const {importBacktest}=await import('/v2/js/domain/backtest-import.js');
        const canvas=document.createElement('canvas');canvas.width=640;canvas.height=320;
        const c=canvas.getContext('2d');c.fillStyle='#14202b';c.fillRect(0,0,640,320);c.fillStyle='#d9e4ec';c.font='20px sans-serif';c.fillText('NAS100 · gráfico sintético de prueba',20,30);
        c.strokeStyle='#334554';for(let y=70;y<300;y+=45){c.beginPath();c.moveTo(20,y);c.lineTo(620,y);c.stroke();}
        c.strokeStyle='#64e0ac';c.lineWidth=4;c.beginPath();[220,190,215,160,175,120,135,80,110,70].forEach((y,i)=>i?c.lineTo(25+i*65,y):c.moveTo(25,y));c.stroke();
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        const t=await importBacktest(JSON.stringify({format:'maca-backtest',version:1,importId:'nas100-browser-history',backtest:{asset:'NAS100',note:'Análisis retrospectivo NAS100. No hubo ejecución registrada.'}}),seed.stage.id,false,[{name:'NAS100 gráfico original.png',mime:'image/png',blob}]);
        return {id:t.id,note:t.note};
      });
      await page.reload();
      await page.locator('.bt-pending .bt-row').click();
      await page.getByRole('button',{name:'Convertir en estudio',exact:true}).waitFor();
      assert.equal(await page.locator('input[name=entry]').count(),0);
      await page.locator('.thumb').waitFor();
      await page.locator('[name=recoveryReviewed]').check();
      await page.locator('[name=recoveryUnknownDate]').check();
      await page.getByRole('button',{name:'Convertir en estudio',exact:true}).click();
      await page.waitForURL(url=>url.hash.startsWith('#/observacion/'));
      const studyUrl=page.url();
      await page.getByRole('button',{name:'Revertir conversión',exact:true}).waitFor();
      assert.equal(await page.locator('[name=studyDate]').inputValue(),'');
      assert.equal(await page.locator('[name=note]').inputValue(),original.note);
      assert.equal(await page.locator('.thumb').count(),1);
      await page.getByRole('button',{name:'SIN EVALUAR',exact:true}).waitFor();
      await page.screenshot({path:path.join(output,device+'-historical-study.png'),fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'historical study overflow');
      await page.locator('[name=note]').fill(original.note+' Aprendizaje añadido al estudio.');
      await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();
      // Persisted record is the assertion; routing to the same URL may not navigate.
      await page.waitForFunction(async()=>{
        const {listObservations}=await import('/v2/js/storage/repos/observations.js');return (await listObservations()).some(o=>o.note.endsWith('Aprendizaje añadido al estudio.'));
      });
      await page.reload();
      page.once('dialog',dialog=>dialog.accept());
      await page.getByRole('button',{name:'Revertir conversión',exact:true}).click();
      await page.waitForURL(url=>url.hash==='#/trade/'+original.id);
      await page.locator('.thumb').waitFor();
      const state=await page.evaluate(async id=>{
        const {getTrade}=await import('/v2/js/storage/repos/trades.js');const {listObservations}=await import('/v2/js/storage/repos/observations.js');
        const {buildExportPayload,validateBackup}=await import('/v2/js/services/backup.js');
        const {ensureDeviceState}=await import('/v2/js/services/sync-engine.js');
        const t=await getTrade(id),obs=(await listObservations()).find(o=>o.recovery?.tradeId===id);
        return {originalNote:t.note,sourceLinked:Boolean(t.studyConversion),historyPreserved:obs.archived&&obs.note.endsWith('Aprendizaje añadido al estudio.'),backupValid:validateBackup(await buildExportPayload()).ok,paused:(await ensureDeviceState()).paused};
      },original.id);
      assert.deepEqual(state,{originalNote:original.note,sourceLinked:false,historyPreserved:true,backupValid:true,paused:true});
      await page.goto(studyUrl);await page.getByText('Conversión revertida. Este estudio permanece como historial y no cuenta en las estadísticas.',{exact:true}).waitFor();
      assert.equal(await page.locator('.thumb').count(),1);assert.deepEqual(errors,[]);
      results.push({device,passed:true,conversion:true,unknownDatePreserved:true,captureVisible:true,editedStudyPreserved:true,reversal:true,backup:true,paused:true});
    } finally {await context.close();}
  }
  await fs.writeFile(path.join(output,'p03-browser.json'),JSON.stringify(results,null,2));return results;
};
