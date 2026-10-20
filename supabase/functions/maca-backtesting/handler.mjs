// Fetch-compatible, stateless Streamable HTTP MCP subset. No admin credentials.
export const tools = [
  { name: 'prepare_backtest', description: 'Prepara un backtest histórico. Mostrá el resumen y los campos faltantes. Pedí confirmación explícita abriendo confirmationUrl. No guarda un trade. No inventes datos. Fechas ISO con zona horaria; omití datos desconocidos. Reutilizá requestKey para reintentos del mismo análisis.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['requestKey', 'trade'], properties: {
      requestKey: { type: 'string', minLength: 8, maxLength: 160 },
      trade: { type: 'object', additionalProperties: false, properties: Object.fromEntries(
        ['asset','direction','openedAt','strategy','result','closedAt','note'].map(k => [k,{type:'string'}])
          .concat(['entry','initialSL','tp','exit','netPnl'].map(k => [k,{type:'number'}]))) }
    } }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: [{type:'oauth2',scopes:['email']}] },
  { name: 'save_confirmed_backtest', description: 'Guarda únicamente una propuesta aprobada personalmente en Maca. Llamá después de la confirmación explícita. No puede aprobar propuestas, modificar registros ni acceder a operaciones reales.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['proposalId'], properties: { proposalId: { type: 'string', format: 'uuid' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    securitySchemes: [{type:'oauth2',scopes:['email']}] }
];

export function createHandler(config, fetcher = fetch) {
  const {supabaseUrl, publishableKey, clientId, resourceUrl, appUrl} = config;
  for (const value of [supabaseUrl,resourceUrl,appUrl]) {
    const url=new URL(value);
    if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash) throw Error('HTTPS configuration required');
  }
  let publicKey = typeof publishableKey==='string' && publishableKey.startsWith('sb_publishable_');
  if(!publicKey && typeof publishableKey==='string') {
    try {publicKey=JSON.parse(atob(publishableKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='anon';}catch{}
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId) || !publicKey) throw Error('Invalid configuration');
  const resource = new URL(resourceUrl), issuer = supabaseUrl+'/auth/v1';
  const metadata = resource.origin+resource.pathname.replace(/\/mcp$/,'')+'/.well-known/oauth-protected-resource';
  const headers={'Cache-Control':'no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff'};
  const json=(status,body,extra={})=>new Response(JSON.stringify(body),{status,headers:{...headers,...extra}});
  const challenge=`Bearer resource_metadata="${metadata}"`;
  async function limitedJson(req) {
    const reader=req.body?.getReader(); if(!reader) throw Error('invalid_request');
    const chunks=[]; let size=0;
    for (;;) {const {done,value}=await reader.read(); if(done) break; size+=value.length;
      if(size>20000) {await reader.cancel(); throw Error('request_too_large');} chunks.push(value);}
    const bytes=new Uint8Array(size); let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  return async req => {
    const url=new URL(req.url);
    if (url.pathname===new URL(metadata).pathname && req.method==='GET') return json(200,{
      resource:resourceUrl,authorization_servers:[issuer],scopes_supported:['email'],bearer_methods_supported:['header']});
    if(url.pathname!==resource.pathname) return json(404,{error:'not_found'});
    if(req.method!=='POST') return json(405,{error:'method_not_allowed'},{Allow:'POST'});
    // MCP Origin validation, independent of bearer authentication.
    const origin=req.headers.get('Origin');
    if(origin && !['https://chatgpt.com',resource.origin].includes(origin)) return json(403,{error:'origin_not_allowed'});
    const token=req.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if(!token || token.length>12000) return json(401,{error:'unauthorized'},{'WWW-Authenticate':challenge});
    try {
      // getUser validates the JWT signature remotely. Never authorize decoded claims alone.
      const auth=await fetcher(supabaseUrl+'/auth/v1/user',{headers:{Authorization:'Bearer '+token,apikey:publishableKey},signal:AbortSignal.timeout(10000)});
      if(!auth.ok) throw Error('unauthorized');
      const user=await auth.json();
      const claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      if(claims.sub!==user.id || claims.client_id!==clientId || claims.iss!==issuer || claims.aud!=='authenticated'
        || claims.role!=='authenticated' || !Number.isFinite(claims.exp) || claims.exp<=Date.now()/1000 || !claims.session_id) throw Error('unauthorized');
    } catch {return json(401,{error:'unauthorized'},{'WWW-Authenticate':challenge});}
    if(!req.headers.get('Content-Type')?.startsWith('application/json')) return json(415,{error:'json_required'});
    let message;
    try { message=await limitedJson(req); } catch {return json(400,{error:'invalid_request'});}
    if (!message || Array.isArray(message) || message.jsonrpc!=='2.0' || typeof message.method!=='string') return json(400,{error:'invalid_request'});
    const rpc=(result)=>json(200,{jsonrpc:'2.0',id:message.id,result});
    const error=(code,msg)=>json(200,{jsonrpc:'2.0',id:message.id??null,error:{code,message:msg}});
    if(message.id===undefined) return message.method==='notifications/initialized' ? new Response(null,{status:202,headers}) : error(-32600,'Invalid notification');
    if(message.method==='initialize') {
      const versions=['2025-03-26','2025-06-18','2025-11-25'];
      return rpc({protocolVersion:versions.includes(message.params?.protocolVersion)?message.params.protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'maca-backtesting',version:'1.0.0'}});
    }
    if(message.method==='ping') return rpc({});
    if(message.method==='tools/list') return rpc({tools});
    if(message.method!=='tools/call') return error(-32601,'Method not found');
    const {name,arguments:args}=message.params||{};
    if(!args || typeof args!=='object' || Array.isArray(args)) return error(-32602,'Invalid arguments');
    let fn,body;
    if(name==='prepare_backtest' && Object.keys(args).every(k=>['requestKey','trade'].includes(k)) && typeof args.requestKey==='string' && args.trade && typeof args.trade==='object' && !Array.isArray(args.trade)) {
      fn='maca_prepare';body={p_request_key:args.requestKey,p_input:args.trade};
    } else if(name==='save_confirmed_backtest' && Object.keys(args).length===1 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.proposalId)) {
      fn='maca_commit';body={p_id:args.proposalId};
    } else return error(-32602,'Invalid tool or arguments');
    try {
      const response=await fetcher(supabaseUrl+'/rest/v1/rpc/'+fn,{method:'POST',headers:{Authorization:'Bearer '+token,apikey:publishableKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
      const data=await response.json();
      if(!response.ok) {
        const known=['explicit_approval_required','integration_revoked','invalid_session','client_not_allowed','proposal_unavailable','idempotency_conflict','stage_no_longer_active'];
        const reason=known.find(v=>data.message===v)||'invalid_backtest_or_permission';
        return rpc({isError:true,content:[{type:'text',text:reason}]});
      }
      if(fn==='maca_prepare') data.confirmationUrl=appUrl+'/v2/integration.html?proposal='+encodeURIComponent(data.proposalId);
      else data.viewUrl=appUrl+'/index.html#/trade/'+encodeURIComponent(data.tradeId)+'?from=backtesting';
      return rpc({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data});
    } catch {return rpc({isError:true,content:[{type:'text',text:'service_unavailable_retry_same_request'}]});}
  };
}
