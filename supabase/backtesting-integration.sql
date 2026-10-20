-- Deployment script, reviewed and tested in an isolated PostgreSQL instance.
-- Prerequisite: o8b.sql. Do NOT apply to production before deployment approval.
begin;
create schema if not exists maca_integration;
revoke all on schema maca_integration from public, anon, authenticated;

create table maca_integration.clients (client_id uuid primary key);
create table maca_integration.connections (
  user_id uuid not null references auth.users(id),
  client_id uuid not null references maca_integration.clients,
  stage_id text not null,
  generation uuid not null default gen_random_uuid(),
  enabled boolean not null default true,
  primary key (user_id, client_id)
);
create table maca_integration.proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  client_id uuid not null,
  generation uuid not null,
  request_key text not null,
  input jsonb not null,
  trade jsonb not null,
  fingerprint text not null,
  missing jsonb not null,
  expires_at timestamptz not null default now() + interval '30 minutes',
  approved_at timestamptz,
  committed_id text,
  unique(user_id, client_id, generation, request_key)
);
alter table maca_integration.clients enable row level security;
alter table maca_integration.connections enable row level security;
alter table maca_integration.proposals enable row level security;

-- OAuth tokens must never inherit access to the general journal APIs.
create policy integration_deny_oauth_records on public.journal_sync_records
  as restrictive for all to authenticated
  using ((auth.jwt()->>'client_id') is null)
  with check ((auth.jwt()->>'client_id') is null);
create policy integration_deny_oauth_conflicts on public.journal_sync_conflicts
  as restrictive for all to authenticated
  using ((auth.jwt()->>'client_id') is null)
  with check ((auth.jwt()->>'client_id') is null);

create function maca_integration.check_session(p_direct boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); c text := auth.jwt()->>'client_id';
begin
  if u is null or coalesce((auth.jwt()->>'exp')::numeric,0) <= extract(epoch from now())
     or auth.jwt()->>'role' is distinct from 'authenticated'
     or not exists (select 1 from auth.sessions s
         where s.id = (auth.jwt()->>'session_id')::uuid and s.user_id = u
         and (s.not_after is null or s.not_after > now())
         and coalesce(s.oauth_client_id::text, '') = coalesce(c, '')) then
    raise exception 'invalid_session' using errcode = '42501';
  end if;
  if p_direct then
    if c is not null then raise exception 'direct_session_required' using errcode = '42501'; end if;
  elsif c is null or not exists(select 1 from maca_integration.clients where client_id::text = c) then
    raise exception 'client_not_allowed' using errcode = '42501';
  end if;
  return u;
end $$;

create function public.maca_connection(p_client_id uuid, p_stage_id text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := maca_integration.check_session(true);
begin
  if p_enabled then
    if not exists(select 1 from public.journal_sync_records where user_id=u
      and entity_type='stages' and entity_id=p_stage_id and not tombstone
      and payload->>'status'='ACTIVE') then raise exception 'sync_active_stage_first'; end if;
    insert into maca_integration.connections(user_id,client_id,stage_id)
      values(u,p_client_id,p_stage_id)
      on conflict(user_id,client_id) do update set stage_id=excluded.stage_id,
        enabled=true,generation=gen_random_uuid();
  else
    update maca_integration.connections set enabled=false,generation=gen_random_uuid()
      where user_id=u and client_id=p_client_id;
  end if;
  return jsonb_build_object('enabled',p_enabled);
end $$;

-- Bind even cached OAuth consent responses to this user and the allowlisted client.
create function public.maca_oauth_request(p_authorization_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := maca_integration.check_session(true); result jsonb;
begin
  select jsonb_build_object('clientId',a.client_id,'scope',a.scope,'redirectUri',a.redirect_uri)
    into result from auth.oauth_authorizations a join maca_integration.clients c on c.client_id=a.client_id
    where a.authorization_id=p_authorization_id and a.user_id=u and a.expires_at>now();
  if result is null then raise exception 'oauth_request_not_allowed' using errcode='42501'; end if;
  return result;
end $$;

create function maca_integration.connection() returns maca_integration.connections
language plpgsql security definer set search_path = '' as $$
declare u uuid := maca_integration.check_session(false); c maca_integration.connections;
begin
  select * into c from maca_integration.connections where user_id=u
    and client_id::text=auth.jwt()->>'client_id' and enabled for update;
  if not found then raise exception 'integration_revoked' using errcode='42501'; end if;
  if not exists(select 1 from public.journal_sync_records where user_id=u and
    entity_type='stages' and entity_id=c.stage_id and not tombstone and payload->>'status'='ACTIVE')
    then raise exception 'stage_no_longer_active'; end if;
  return c;
end $$;

create function public.maca_prepare(p_request_key text, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c maca_integration.connections := maca_integration.connection();
  r maca_integration.proposals; t jsonb; missing jsonb := '[]'; k text;
  v jsonb; n numeric; draft boolean; result text; stamp text := to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_request_key is null or length(p_request_key) not between 8 and 160
    or p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>16000 then
    raise exception 'invalid_request'; end if;
  for k in select jsonb_object_keys(p_input) loop
    if k not in ('asset','direction','openedAt','entry','initialSL','tp','strategy','result','exit','closedAt','netPnl','note')
      then raise exception 'field_not_allowed: %',k; end if;
  end loop;
  select * into r from maca_integration.proposals where user_id=c.user_id and client_id=c.client_id
    and generation=c.generation and request_key=p_request_key;
  if found then
    if r.input <> p_input then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('proposalId',r.id,'trade',r.trade,'missing',r.missing,'expiresAt',r.expires_at);
  end if;
  if (select count(*) from maca_integration.proposals where user_id=c.user_id and client_id=c.client_id
    and generation=c.generation and expires_at>now()) >= 30 then raise exception 'proposal_limit_reached'; end if;
  t := jsonb_build_object('id',gen_random_uuid()::text,'stageId',c.stage_id,
    'context','BACKTEST','accountId',null,'recordSource','MANUAL','setupId',null,
    'strategy','UNCLASSIFIED','hasPartials',false,'createdAt',stamp,'updatedAt',stamp,
    'result',null,'closedAt',null,'exit',null,'netPnl',null,'voidedAt',null,'voidReason',null,
    'rrRealized',null,'costComplete',false);
  foreach k in array array['asset','direction','openedAt','strategy','result','closedAt','note'] loop
    v := p_input->k;
    if v is not null and v <> 'null'::jsonb then
      if jsonb_typeof(v)<>'string' or length(p_input->>k)>8000 then raise exception 'invalid_text: %',k; end if;
      t := t || jsonb_build_object(k,nullif(btrim(p_input->>k),''));
    end if;
  end loop;
  k:=regexp_replace(upper(p_input->>'asset'),'\s','','g');
  if k in ('S&P500','SPX','US500') then k:='SP500'; end if;
  t := t || jsonb_build_object('asset',nullif(k,''));
  if t->>'direction' is not null and t->>'direction' not in ('LONG','SHORT') then raise exception 'invalid_direction'; end if;
  if t->>'strategy' is null then t:=t||'{"strategy":"UNCLASSIFIED"}'; end if;
  if t->>'strategy' not in ('UNCLASSIFIED','MACA','BLUE','RED','PINK','WHITE','BLACK','GREEN','GREEN_CRYPTO') then raise exception 'invalid_strategy'; end if;
  foreach k in array array['entry','initialSL','tp','exit','netPnl'] loop
    v:=p_input->k;
    if v is not null and v<>'null'::jsonb then
      if jsonb_typeof(v)<>'number' then raise exception 'invalid_number: %',k; end if;
      n:=(v::text)::numeric;
      if abs(n)>1e15 or (k<>'netPnl' and n<=0) then raise exception 'number_out_of_range: %',k; end if;
      t:=t||jsonb_build_object(k,n);
    end if;
  end loop;
  foreach k in array array['openedAt','closedAt'] loop
    if t->>k is not null then
      if t->>k !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$' then raise exception 'timezone_required: %',k; end if;
      t:=t||jsonb_build_object(k,to_char((t->>k)::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    end if;
  end loop;
  if t->>'closedAt' < t->>'openedAt' then raise exception 'close_before_entry'; end if;
  result:=t->>'result';
  if result is not null and result not in ('WIN','LOSS','BE') then raise exception 'invalid_result'; end if;
  if result is not null and t->>'netPnl' is not null and
    ((result='WIN' and (t->>'netPnl')::numeric<=0) or (result='LOSS' and (t->>'netPnl')::numeric>=0)
    or (result='BE' and (t->>'netPnl')::numeric<>0)) then raise exception 'result_pnl_mismatch'; end if;
  if t->>'entry' is not null and t->>'initialSL' is not null and
    ((t->>'direction'='LONG' and (t->>'initialSL')::numeric >= (t->>'entry')::numeric)
     or (t->>'direction'='SHORT' and (t->>'initialSL')::numeric <= (t->>'entry')::numeric)) then raise exception 'invalid_sl'; end if;
  if t->>'entry' is not null and t->>'tp' is not null and
    ((t->>'direction'='LONG' and (t->>'tp')::numeric <= (t->>'entry')::numeric)
     or (t->>'direction'='SHORT' and (t->>'tp')::numeric >= (t->>'entry')::numeric)) then raise exception 'invalid_tp'; end if;
  foreach k in array array['asset','direction','openedAt','entry','initialSL','tp','result','exit','closedAt','netPnl'] loop
    if t->>k is null then missing:=missing||jsonb_build_array(k); end if;
  end loop;
  if t->>'strategy'='UNCLASSIFIED' then missing:=missing||'["strategy"]'; end if;
  draft:=jsonb_array_length(missing)>0;
  t:=t||jsonb_build_object('isDraft',draft,'lifecycle',case when draft then 'OPEN' else 'CLOSED' end,
    'currentSL',t->'initialSL','incompleteForR',t->>'entry' is null or t->>'initialSL' is null,
    'sourceRef',jsonb_build_object('integration','CHATGPT'),
    'draftExit',case when draft then t->'exit' else 'null'::jsonb end,
    'draftNetPnl',case when draft then t->'netPnl' else 'null'::jsonb end,
    'draftClosedAt',case when draft then t->'closedAt' else 'null'::jsonb end,
    'draftResult',case when draft then to_jsonb(result) else 'null'::jsonb end,
    'closeType',case when draft then null else 'UNKNOWN' end);
  if draft then t:=t||'{"result":null,"exit":null,"netPnl":null,"closedAt":null}'; end if;
  insert into maca_integration.proposals(user_id,client_id,generation,request_key,input,trade,fingerprint,missing)
    values(c.user_id,c.client_id,c.generation,p_request_key,p_input,t,
      encode(sha256(convert_to((t - array['id','createdAt','updatedAt','note'])::text,'UTF8')),'hex'),missing) returning * into r;
  return jsonb_build_object('proposalId',r.id,'trade',t,'missing',missing,'expiresAt',r.expires_at);
end $$;

-- Only a direct, authenticated browser session can inspect/approve a proposal.
create function public.maca_review(p_id uuid, p_approve boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := maca_integration.check_session(true); r maca_integration.proposals;
begin
  select p.* into r from maca_integration.proposals p join maca_integration.connections c
    on c.user_id=p.user_id and c.client_id=p.client_id and c.generation=p.generation and c.enabled
    where p.id=p_id and p.user_id=u for update of c,p;
  if not found or r.expires_at<=now() then raise exception 'proposal_unavailable'; end if;
  if p_approve then update maca_integration.proposals set approved_at=coalesce(approved_at,now()) where id=p_id; end if;
  return jsonb_build_object('proposalId',r.id,'trade',r.trade,'missing',r.missing,'approved',p_approve or r.approved_at is not null);
end $$;

create function public.maca_commit(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c maca_integration.connections := maca_integration.connection(); r maca_integration.proposals; duplicate_id text;
begin
  select * into r from maca_integration.proposals where id=p_id and user_id=c.user_id
    and client_id=c.client_id and generation=c.generation for update;
  if not found then raise exception 'proposal_unavailable'; end if;
  if r.committed_id is not null then return jsonb_build_object('tradeId',r.committed_id,'duplicate',true); end if;
  if r.expires_at<=now() or r.approved_at is null then raise exception 'explicit_approval_required'; end if;
  if r.trade->>'stageId'<>c.stage_id then raise exception 'stage_changed'; end if;
  -- Serialize semantic duplicates even if notes or classification differ.
  perform pg_advisory_xact_lock(hashtextextended(c.user_id::text||c.stage_id||
    coalesce(r.trade->>'asset','')||coalesce(r.trade->>'direction','')||
    coalesce(r.trade->>'openedAt','')||coalesce(r.trade->>'entry',''),0));
  select entity_id into duplicate_id from public.journal_sync_records
    where user_id=c.user_id and entity_type='trades' and payload->>'context'='BACKTEST'
    and payload->>'stageId'=c.stage_id and (
      (payload->'sourceRef'->>'fingerprint')=r.fingerprint or
      (r.trade->>'openedAt' is not null and r.trade->>'asset' is not null
        and r.trade->>'direction' is not null and r.trade->>'entry' is not null
        and payload->>'asset'=r.trade->>'asset' and payload->>'direction'=r.trade->>'direction'
        and (payload->>'openedAt')::timestamptz=(r.trade->>'openedAt')::timestamptz
        and (payload->>'entry')::numeric=(r.trade->>'entry')::numeric)
    ) limit 1;
  if duplicate_id is null then
    duplicate_id:=r.trade->>'id';
    insert into public.journal_sync_records(user_id,entity_type,entity_id,payload,revision,tombstone,updated_by_device)
      values(c.user_id,'trades',duplicate_id,
        jsonb_set(r.trade,'{sourceRef}',jsonb_build_object('integration','CHATGPT','proposalId',r.id,'fingerprint',r.fingerprint)),
        1,false,'chatgpt-backtesting');
  end if;
  update maca_integration.proposals set committed_id=duplicate_id where id=p_id;
  return jsonb_build_object('tradeId',duplicate_id,'duplicate',duplicate_id<>r.trade->>'id');
end $$;

revoke all on all functions in schema maca_integration from public, anon, authenticated;
revoke all on function public.maca_connection(uuid,text,boolean), public.maca_prepare(text,jsonb),
  public.maca_review(uuid,boolean),public.maca_commit(uuid),public.maca_oauth_request(text) from public, anon;
grant execute on function public.maca_connection(uuid,text,boolean),public.maca_prepare(text,jsonb),
  public.maca_review(uuid,boolean),public.maca_commit(uuid),public.maca_oauth_request(text) to authenticated;
-- Existing event trigger is not an application RPC. This does not disable it.
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public,anon,authenticated;
  end if;
end $$;

-- Preserve the existing sync implementation; reject OAuth before privileged access.
create or replace function public.journal_sync_push(
  p_entity_type text,
  p_entity_id text,
  p_payload jsonb,
  p_expected_revision integer,
  p_tombstone boolean,
  p_device_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.journal_sync_records;
  v_new integer;
begin
  if (auth.jwt()->>'client_id') is not null then
    raise exception 'oauth_not_allowed' using errcode = '42501';
  end if;
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_row
    from public.journal_sync_records
   where user_id = v_uid
     and entity_type = p_entity_type
     and entity_id = p_entity_id
   for update;

  if not found then
    if p_expected_revision <> 0 then
      return jsonb_build_object('ok', false, 'kind', 'missing');
    end if;
    insert into public.journal_sync_records
      (user_id, entity_type, entity_id, payload, revision, tombstone, updated_by_device)
    values
      (v_uid, p_entity_type, p_entity_id, p_payload, 1, p_tombstone, p_device_id)
    returning revision into v_new;
    return jsonb_build_object('ok', true, 'revision', v_new);
  end if;

  if v_row.revision is distinct from p_expected_revision then
    insert into public.journal_sync_conflicts
      (user_id, entity_type, entity_id, cloud_revision, cloud_payload,
       incoming_payload, incoming_device, incoming_expected)
    values
      (v_uid, p_entity_type, p_entity_id, v_row.revision, v_row.payload,
       p_payload, p_device_id, p_expected_revision)
    on conflict (user_id, entity_type, entity_id) where resolved_at is null
    do nothing;
    return jsonb_build_object(
      'ok', false,
      'kind', 'conflict',
      'cloud_revision', v_row.revision,
      'cloud_payload', v_row.payload
    );
  end if;

  v_new := v_row.revision + 1;
  update public.journal_sync_records
     set payload = p_payload,
         revision = v_new,
         tombstone = p_tombstone,
         updated_at = now(),
         updated_by_device = p_device_id
   where user_id = v_uid
     and entity_type = p_entity_type
     and entity_id = p_entity_id;

  return jsonb_build_object('ok', true, 'revision', v_new);
end;
$$;

revoke all on function public.journal_sync_push(text, text, jsonb, integer, boolean, text) from public;
grant execute on function public.journal_sync_push(text, text, jsonb, integer, boolean, text) to authenticated;

commit;
