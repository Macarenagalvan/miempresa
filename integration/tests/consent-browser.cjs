const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const server=http.createServer((req,res)=>{
  const target=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!target.startsWith(root+path.sep))return res.writeHead(403).end();
  fs.readFile(target,(err,bytes)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':'text/html');res.end(bytes);});
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
  try {
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
      const context=await browser.newContext({viewport});
      const errors=[];
      await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      await context.route('**/v2/js/ui/integration-page.js',route=>{
        const prefix=`import {setAuthClient as inject} from '../services/auth.js';
          window.approvals=0;inject({auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}}),getUser:async()=>({data:{user:{id:'fixture',email:'fixture@example.test'}}})},
          rpc:async(name,args)=>{if(name!=='maca_review')throw Error('Unexpected RPC');if(args.p_approve)window.approvals++;
          return {data:{proposalId:'fixture',trade:{asset:'EURUSD',direction:'LONG',isDraft:true,entry:100,note:'<img src=x onerror="window.xss=true">'},missing:['openedAt','initialSL','tp']}};}});\n`;
        return route.fulfill({contentType:'text/javascript',body:prefix+fs.readFileSync(path.join(root,'v2/js/ui/integration-page.js'),'utf8')});
      });
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin+'/v2/integration.html?proposal=fixture');
      await page.getByRole('heading',{name:'Guardar como BORRADOR'}).waitFor();
      if(await page.evaluate(()=>window.approvals)!==0)throw Error('Loading must not approve');
      if(await page.evaluate(()=>window.xss)||await page.locator('#content img').count())throw Error('Summary contains executable HTML');
      if(!(await page.locator('#content').innerText()).includes('Sin completar'))throw Error('Missing data was invented');
      await page.getByRole('button',{name:'Confirmo estos datos y autorizo guardarlos'}).click();
      await page.getByText('Aprobado. Volvé a ChatGPT',{exact:false}).waitFor();
      if(await page.evaluate(()=>window.approvals)!==1)throw Error('Expected exactly one explicit approval');
      if(errors.length)throw Error(errors.join('\n'));
      console.log('Consent UI '+viewport.width+': no auto-approval, escaped summary, missing fields and explicit click OK');
      await context.close();
    }
    for(const cached of [false,true]) {
      const context=await browser.newContext();let connections=0,callback=false;
      await context.exposeFunction('recordConnection',()=>{connections++;});
      await context.route('**/*',route=>{
        const url=new URL(route.request().url());
        if(url.origin===origin)return route.continue();
        if(url.origin==='https://chatgpt.com'&&url.pathname==='/callback') {callback=true;return route.fulfill({contentType:'text/html',body:'Callback de prueba'});}
        return route.abort();
      });
      await context.route('**/v2/js/integration-config.js',route=>route.fulfill({contentType:'text/javascript',body:"export const MACA_OAUTH_CLIENT_ID='33333333-3333-4333-8333-333333333333';"}));
      await context.route('**/v2/js/ui/integration-page.js',route=>{
        const prefix=`import {setAuthClient as inject} from '../services/auth.js';
          const cid='33333333-3333-4333-8333-333333333333';
          inject({auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}}),getUser:async()=>({data:{user:{id:'fixture',email:'fixture@example.test'}}})},rpc:async(name,args)=>{
            if(name==='maca_oauth_request')return {data:{clientId:cid,scope:'email',redirectUri:'https://chatgpt.com/callback'}};
            if(name==='maca_connection'){await window.recordConnection();return {data:{enabled:args.p_enabled}};}
            throw Error('Unexpected RPC');}});
          window.fetch=async(url,options)=>Response.json(options?.method==='POST'||${cached} ? {redirect_url:'https://chatgpt.com/callback?code=fixture'} : {client:{id:cid,name:'Maca Backtesting'},scope:'email'});\n`;
        return route.fulfill({contentType:'text/javascript',body:prefix+fs.readFileSync(path.join(root,'v2/js/ui/integration-page.js'),'utf8')});
      });
      const page=await context.newPage();
      await page.goto(origin+'/v2/integration.html?authorization_id=fixture');
      const approve=page.getByRole('button',{name:'Autorizar integración de Backtesting'});await approve.waitFor();
      if(connections||callback)throw Error('OAuth must not connect or redirect before consent');
      await approve.click();await page.waitForURL('https://chatgpt.com/callback?code=fixture');
      if(connections!==1||!callback)throw Error('OAuth connection was not explicitly approved');
      console.log('OAuth UI '+(cached?'cached consent':'new consent')+': explicit approval and bound redirect OK');
      await context.close();
    }
  } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
