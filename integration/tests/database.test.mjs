import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile, writeFile, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHandler} from '../../supabase/functions/maca-backtesting/handler.mjs';

const u='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const client='33333333-3333-4333-8333-333333333333', directSession='44444444-4444-4444-8444-444444444444', oauthSession='55555555-5555-4555-8555-555555555555';
const complete={asset:'EURUSD',direction:'LONG',openedAt:'2020-01-01T10:00:00Z',closedAt:'2020-01-01T11:00:00Z',entry:100,initialSL:95,tp:110,exit:110,netPnl:20,result:'WIN',strategy:'MACA',note:'Análisis histórico'};

test('PostgreSQL: approval, isolation, persistence, permissions and duplicate safety',async t=>{
  const path=await mkdtemp(join(tmpdir(),'maca-integration-'));let db=new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz,oauth_client_id uuid);
    create table auth.oauth_authorizations(authorization_id text,client_id uuid,user_id uuid,scope text,redirect_uri text,expires_at timestamptz);
    create function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims',true)::jsonb$$;
    create function auth.uid() returns uuid language sql as $$select (auth.jwt()->>'sub')::uuid$$;
    grant usage on schema auth to authenticated,anon;
    insert into auth.users values('${u}'),('${other}');
    insert into auth.sessions values('${directSession}','${u}',null,null),('${oauthSession}','${u}',null,'${client}');`);
  const baseline=await readFile(new URL('../../supabase/o8b.sql',import.meta.url),'utf8');
  await db.exec(baseline.replace('create extension if not exists "pgcrypto";',''));
  await db.exec(`grant select,insert,update on public.journal_sync_records,public.journal_sync_conflicts to authenticated;`);
  await db.exec(await readFile(new URL('../../supabase/backtesting-integration.sql',import.meta.url),'utf8'));
  await db.query(`insert into maca_integration.clients values($1)`,[client]);
  await db.query(`insert into public.journal_sync_records values($1,'stages','stage', $2,1,false,now(),'app')`,[u,{id:'stage',status:'ACTIVE'}]);
  await db.query(`insert into public.journal_sync_records values($1,'accounts','real', $2,1,false,now(),'app')`,[u,{id:'real',initialAmount:1000}]);
  await db.query(`insert into public.journal_sync_records values($1,'trades','real-trade', $2,1,false,now(),'app')`,[u,{id:'real-trade',context:'LIVE',accountId:'real',netPnl:100}]);
  const snapshot=(await db.query(`select * from public.journal_sync_records order by entity_id`)).rows;
  async function session(oauth=true,user=u,overrides={}) {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims',$1,false)`,[JSON.stringify({sub:user,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,session_id:oauth?oauthSession:directSession,...(oauth?{client_id:client}:{}),...overrides})]);
    await db.exec('set role authenticated');
  }
  async function rpc(name,args=[]) {
    const r=await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);return r.rows[0].result;
  }
  let proposal;
  await t.test('direct owner enables only an owned active cloud stage',async()=>{
    await session(false);await assert.rejects(rpc('maca_connection',[client,'missing',true]),/sync_active_stage_first/);
    await rpc('maca_connection',[client,'stage',true]);
  });
  await t.test('OAuth consent request is bound to its owner and the allowlisted client',async()=>{
    await db.exec('reset role');
    await db.query(`insert into auth.oauth_authorizations values('owned',$1,$2,'email','https://chatgpt.com/callback',now()+interval '10 minutes'),('foreign',$1,$3,'email','https://chatgpt.com/callback',now()+interval '10 minutes')`,[client,u,other]);
    await session(false);
    assert.equal((await rpc('maca_oauth_request',['owned'])).clientId,client);
    await assert.rejects(rpc('maca_oauth_request',['foreign']),/oauth_request_not_allowed/);
    await session();await assert.rejects(rpc('maca_oauth_request',['owned']),/direct_session_required/);
  });
  await t.test('OAuth cannot read accounts/trades or invoke general sync',async()=>{
    await session();assert.deepEqual((await db.query('select * from public.journal_sync_records')).rows,[]);
    await assert.rejects(rpc('journal_sync_push',['trades','attack',{context:'LIVE'},0,false,'attack']),/oauth_not_allowed/);
    await assert.rejects(db.query(`insert into public.journal_sync_records values($1,'trades','attack','{}',1,false,now(),'attack')`,[u]),/row-level security/);
    await assert.rejects(db.query('select * from maca_integration.proposals'),/permission denied/);
    await assert.rejects(rpc('maca_connection',[client,'stage',false]),/direct_session_required/);
  });
  await t.test('anonymous and revoked/expired/wrong-client sessions fail closed',async()=>{
    await db.exec('reset role; set role anon');await assert.rejects(rpc('maca_prepare',['request-1',complete]),/permission denied/);
    await session(true,u,{exp:1});await assert.rejects(rpc('maca_prepare',['request-1',complete]),/invalid_session/);
    await session(true,other);await assert.rejects(rpc('maca_prepare',['request-1',complete]),/invalid_session/);
    await session(true,u,{client_id:other});await assert.rejects(rpc('maca_prepare',['request-1',complete]),/invalid_session|client_not_allowed/);
    await session();
  });
  await t.test('prepare never inserts trades and cannot set account/context/lifecycle',async()=>{
    for(const field of ['context','accountId','user_id','id','lifecycle','isDraft','approved_at','sourceRef','stageId'])
      await assert.rejects(rpc('maca_prepare',['attack-'+field,{...complete,[field]:'LIVE'}]),/field_not_allowed/);
    proposal=await rpc('maca_prepare',['request-1',complete]);
    assert.equal(proposal.trade.context,'BACKTEST');assert.equal(proposal.trade.accountId,null);
    assert.equal(proposal.trade.isDraft,false);assert.deepEqual(proposal.missing,[]);
    assert.equal((await rpc('maca_prepare',['request-1',complete])).proposalId,proposal.proposalId);
    await assert.rejects(rpc('maca_prepare',['request-1',{...complete,note:'cambiado'}]),/idempotency_conflict/);
  });
  await t.test('AI cannot self-approve or save without an explicit browser approval',async()=>{
    await assert.rejects(rpc('maca_review',[proposal.proposalId,true]),/direct_session_required/);
    await assert.rejects(rpc('maca_commit',[proposal.proposalId]),/explicit_approval_required/);
    await db.exec('reset role');assert.deepEqual((await db.query('select * from public.journal_sync_records order by entity_id')).rows,snapshot);
  });
  await t.test('valid second user cannot review, approve or choose the first user stage',async()=>{
    const secondSession='66666666-6666-4666-8666-666666666666';
    await db.query('insert into auth.sessions values($1,$2,null,null)',[secondSession,other]);
    await session(false,other,{session_id:secondSession});
    await assert.rejects(rpc('maca_review',[proposal.proposalId,true]),/proposal_unavailable/);
    await assert.rejects(rpc('maca_connection',[client,'stage',true]),/sync_active_stage_first/);
  });
  await t.test('approval survives process restart; only one durable new trade is inserted',async()=>{
    await session(false);await rpc('maca_review',[proposal.proposalId,true]);
    const archive=await db.dumpDataDir();await writeFile(join(path,'pg.tar.gz'),Buffer.from(await archive.arrayBuffer()));
    await db.close();db=new PGlite({loadDataDir:new Blob([await readFile(join(path,'pg.tar.gz'))])});await session();
    const saved=await rpc('maca_commit',[proposal.proposalId]);assert.equal(saved.duplicate,false);
    assert.equal((await rpc('maca_commit',[proposal.proposalId])).tradeId,saved.tradeId);
    await db.exec('reset role');
    const row=(await db.query(`select * from public.journal_sync_records where entity_id=$1`,[saved.tradeId])).rows[0];
    assert.equal(row.revision,1);assert.equal(row.payload.context,'BACKTEST');assert.equal(row.payload.accountId,null);
    assert.equal(row.payload.note,complete.note);assert.equal(row.payload.strategy,'MACA');
    assert.deepEqual((await db.query(`select * from public.journal_sync_records where entity_id in ('stage','real','real-trade') order by entity_id`)).rows,snapshot);
  });
  await t.test('semantic duplicate, different key/notes: returns existing, never overwrites',async()=>{
    await session();const second=await rpc('maca_prepare',['another-request',{...complete,strategy:'BLUE',note:'segunda conversación'}]);
    await session(false);await rpc('maca_review',[second.proposalId,true]);await session();
    assert.equal((await rpc('maca_commit',[second.proposalId])).duplicate,true);
    await db.exec('reset role');assert.equal((await db.query(`select count(*)::int n from public.journal_sync_records where entity_type='trades'`)).rows[0].n,2);
  });
  await t.test('missing data persists as a draft, with no invented identity or realized PnL',async()=>{
    await session();const draft=await rpc('maca_prepare',['draft-request',{note:'Sin gráfico todavía',result:'WIN'}]);
    assert.equal(draft.trade.isDraft,true);assert.equal(draft.trade.asset,null);assert.equal(draft.trade.direction,undefined);
    assert.equal(draft.trade.result,null);assert.equal(draft.trade.draftResult,'WIN');assert.equal(draft.trade.openedAt,undefined);
    assert.ok(draft.missing.includes('entry'));assert.ok(draft.missing.includes('asset'));
    await session(false);await rpc('maca_review',[draft.proposalId,true]);await session();await rpc('maca_commit',[draft.proposalId]);
  });
  await t.test('malformed numbers, ambiguous dates, impossible SL/TP, result conflicts fail',async()=>{
    for(const patch of [{entry:'100'},{entry:-1},{direction:'BUY'},{openedAt:'2020-01-01T10:00'},
      {closedAt:'2019-01-01T10:00:00Z'},{netPnl:-10},{initialSL:105},{tp:90},{strategy:'OTHER'}])
      await assert.rejects(rpc('maca_prepare',['invalid-request',{...complete,...patch}]));
  });
  await t.test('RPC privileges and private tables have no anonymous or direct table access',async()=>{
    await db.exec('reset role');
    const functions=(await db.query(`select p.oid::regprocedure::text name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='maca_integration' or (n.nspname='public' and p.proname like 'maca_%')`)).rows;
    for(const {name} of functions) assert.equal((await db.query(`select has_function_privilege('anon',$1,'execute') allowed`,[name])).rows[0].allowed,false);
    const tables=(await db.query(`select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='maca_integration' and c.relkind='r'`)).rows;
    assert.equal(tables.length,3);assert.ok(tables.every(t=>t.relrowsecurity));
    await session();
  });
  await t.test('MCP handler and actual SQL: prepare → rejected save → human approval → durable save',async()=>{
    const config={supabaseUrl:'https://fixture.supabase.co',publishableKey:'sb_publishable_fixture',clientId:client,resourceUrl:'https://fixture.supabase.co/functions/v1/maca-backtesting/mcp',appUrl:'https://example.com/miempresa'};
    const jwt={sub:u,client_id:client,iss:config.supabaseUrl+'/auth/v1',aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,session_id:oauthSession};
    const token='e30.'+Buffer.from(JSON.stringify(jwt)).toString('base64url')+'.fixture';
    const handler=createHandler(config,async(url,init)=>{
      if(url.endsWith('/user'))return Response.json({id:u}); // Only external Auth is simulated.
      const fn=url.split('/').at(-1),args=JSON.parse(init.body);
      await session();
      try{return Response.json(await rpc(fn,fn==='maca_prepare'?[args.p_request_key,args.p_input]:[args.p_id]));}
      catch(error){return Response.json({message:error.message},{status:403});}
    });
    async function call(name,args){return (await (await handler(new Request(config.resourceUrl,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}))).json()).result;}
    const prepared=await call('prepare_backtest',{requestKey:'end-to-end-request',trade:{asset:'NZDUSD',note:'Datos parciales'}});
    assert.equal(prepared.structuredContent.trade.isDraft,true);
    const id=prepared.structuredContent.proposalId;
    assert.equal((await call('save_confirmed_backtest',{proposalId:id})).isError,true);
    await session(false);await rpc('maca_review',[id,true]);
    const saved=await call('save_confirmed_backtest',{proposalId:id});assert.ok(!saved.isError);
    await db.exec('reset role');
    const row=(await db.query('select payload from public.journal_sync_records where entity_id=$1',[saved.structuredContent.tradeId])).rows[0].payload;
    assert.equal(row.context,'BACKTEST');assert.equal(row.accountId,null);assert.equal(row.asset,'NZDUSD');assert.equal(row.note,'Datos parciales');
    assert.equal(row.isDraft,true);assert.equal(row.rrRealized,null);await session();
  });
  await t.test('revoke immediately blocks pending approvals, new prepares and old commits',async()=>{
    const pending=await rpc('maca_prepare',['revoke-request',{...complete,openedAt:'2021-01-01T10:00:00Z',closedAt:'2021-01-01T11:00:00Z'}]);
    await session(false);await rpc('maca_review',[pending.proposalId,true]);await rpc('maca_connection',[client,'',false]);
    await session();await assert.rejects(rpc('maca_commit',[pending.proposalId]),/integration_revoked/);
    await assert.rejects(rpc('maca_prepare',['new-request',complete]),/integration_revoked/);
    await session(false);await rpc('maca_connection',[client,'stage',true]);await session();
    await assert.rejects(rpc('maca_commit',[pending.proposalId]),/proposal_unavailable/);
  });
  await t.test('expired proposals and deleted OAuth sessions cannot save',async()=>{
    const p=await rpc('maca_prepare',['expired-request',complete]);await db.exec('reset role');
    await db.query(`update maca_integration.proposals set expires_at=now()-interval '1 second',approved_at=now() where id=$1`,[p.proposalId]);
    await session();await assert.rejects(rpc('maca_commit',[p.proposalId]),/explicit_approval_required/);
    await db.exec('reset role');await db.query(`delete from auth.sessions where id=$1`,[oauthSession]);
    await session();await assert.rejects(rpc('maca_prepare',['deleted-session',complete]),/invalid_session/);
  });
  await db.close();
});
