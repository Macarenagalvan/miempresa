import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createHandler} from '../../supabase/functions/maca-backtesting/handler.mjs';

const config={supabaseUrl:'https://project.supabase.co',publishableKey:'sb_publishable_fixture',clientId:'33333333-3333-4333-8333-333333333333',resourceUrl:'https://project.supabase.co/functions/v1/maca-backtesting/mcp',appUrl:'https://example.com/miempresa'};
const claims={sub:'user',client_id:config.clientId,iss:config.supabaseUrl+'/auth/v1',aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,session_id:'session'};
const token=(patch={})=>'e30.'+Buffer.from(JSON.stringify({...claims,...patch})).toString('base64url')+'.fixture';
const proposal='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function mockAuthAndRpc(calls,options={}) {
  return async(url,init)=>{
    calls.push({url,init});
    if(url.endsWith('/user')) return Response.json({id:'user'},{status:options.rejectAuth?401:200});
    return Response.json(options.rpcError?{message:options.rpcError}:url.endsWith('maca_prepare')?
      {proposalId:proposal,trade:{context:'BACKTEST',isDraft:true},missing:['entry']}:
      {tradeId:'trade',duplicate:false},{status:options.rpcError?403:200});
  };
}
function request(body,options={}) {
  return new Request(config.resourceUrl,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token(),...options.headers},body:JSON.stringify({jsonrpc:'2.0',id:1,...body})});
}
test('OAuth metadata and HTTP boundaries',async()=>{
  const calls=[],handle=createHandler(config,mockAuthAndRpc(calls));
  const metadata=await handle(new Request(config.resourceUrl.replace('/mcp','/.well-known/oauth-protected-resource')));
  assert.equal(metadata.status,200);assert.equal((await metadata.json()).resource,config.resourceUrl);
  const noAuth=await handle(new Request(config.resourceUrl,{method:'POST'}));assert.equal(noAuth.status,401);assert.match(noAuth.headers.get('WWW-Authenticate'),/resource_metadata/);
  assert.equal((await handle(new Request(config.resourceUrl))).status,405);
  assert.equal((await handle(request({method:'tools/list'},{headers:{Origin:'https://evil.example'}}))).status,403);
  assert.equal(calls.length,0);
});
test('rejects unverified, expired, wrong issuer/audience/client, direct and admin tokens',async()=>{
  for(const patch of [{exp:1},{exp:null},{iss:'https://evil.example'},{aud:'elsewhere'},{client_id:'other'},{client_id:null},{role:'service_role'},{sub:'other'},{session_id:null}]) {
    const calls=[],handle=createHandler(config,mockAuthAndRpc(calls));
    assert.equal((await handle(request({method:'tools/list'},{headers:{Authorization:'Bearer '+token(patch)}}))).status,401);
    assert.equal(calls.length,1); // No data API call.
  }
  const handle=createHandler(config,mockAuthAndRpc([],{rejectAuth:true}));
  assert.equal((await handle(request({method:'tools/list'}))).status,401);
});
test('only narrow RPCs are exposed; summaries contain no credentials',async()=>{
  const calls=[],handle=createHandler(config,mockAuthAndRpc(calls));
  const listed=await (await handle(request({method:'tools/list'}))).json();
  assert.deepEqual(listed.result.tools.map(t=>t.name),['prepare_backtest','save_confirmed_backtest']);
  const prepared=await (await handle(request({method:'tools/call',params:{name:'prepare_backtest',arguments:{requestKey:'request-1',trade:{asset:'EURUSD'}}}}))).json();
  assert.equal(prepared.result.structuredContent.confirmationUrl,config.appUrl+'/v2/integration.html?proposal='+proposal);
  assert.ok(!JSON.stringify(prepared).includes(config.publishableKey));
  assert.ok(!JSON.stringify(prepared).includes(token()));
  assert.deepEqual(JSON.parse(calls.at(-1).init.body),{p_request_key:'request-1',p_input:{asset:'EURUSD'}});
  const denied=await (await createHandler(config,mockAuthAndRpc([],{rpcError:'explicit_approval_required'}))(request({method:'tools/call',params:{name:'save_confirmed_backtest',arguments:{proposalId:proposal}}}))).json();
  assert.equal(denied.result.isError,true);assert.equal(denied.result.content[0].text,'explicit_approval_required');
  const invalid=await (await handle(request({method:'tools/call',params:{name:'delete_trade',arguments:{proposalId:proposal}}}))).json();
  assert.equal(invalid.error.code,-32602);
  const extra=await (await handle(request({method:'tools/call',params:{name:'save_confirmed_backtest',arguments:{proposalId:proposal,confirmed:true}}}))).json();
  assert.equal(extra.error.code,-32602);
});
test('body size and malformed protocol requests are rejected',async()=>{
  const handle=createHandler(config,mockAuthAndRpc([]));
  assert.equal((await handle(request({method:'tools/call',params:'x'.repeat(25000)}))).status,400);
  assert.equal((await handle(request({jsonrpc:'1.0',method:'tools/list'}))).status,400);
  assert.equal((await handle(request({method:'tools/list'},{headers:{'Content-Type':'text/plain'}}))).status,415);
});
test('official MCP client: initialize, list tools, prepare, save and disconnect',async()=>{
  const handle=createHandler(config,mockAuthAndRpc([]));
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const response=await handle(new Request(config.resourceUrl,{method:req.method,headers:req.headers,
      ...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}));
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const client=new Client({name:'maca-test',version:'1.0.0'});
  try {
    const transport=new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+server.address().port+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token()}}});
    await client.connect(transport);assert.equal((await client.listTools()).tools.length,2);
    const p=await client.callTool({name:'prepare_backtest',arguments:{requestKey:'sdk-request',trade:{asset:'EURUSD'}}});
    assert.equal(p.structuredContent.proposalId,proposal);
    const saved=await client.callTool({name:'save_confirmed_backtest',arguments:{proposalId:proposal}});
    assert.equal(saved.structuredContent.tradeId,'trade');
  } finally {await client.close();await new Promise(r=>server.close(r));}
});
