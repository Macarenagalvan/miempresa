-- O8B — Journal V2 sync foundation
-- Ejecutar en Supabase → SQL Editor como el owner del proyecto.
-- NO pegar keys de administración en el browser.

create extension if not exists "pgcrypto";

create table if not exists public.journal_sync_records (
  user_id uuid not null references auth.users (id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  revision integer not null check (revision >= 1),
  tombstone boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by_device text not null,
  primary key (user_id, entity_type, entity_id)
);

create index if not exists journal_sync_records_user_updated
  on public.journal_sync_records (user_id, updated_at);

create table if not exists public.journal_sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  cloud_revision integer not null,
  cloud_payload jsonb not null,
  incoming_payload jsonb not null,
  incoming_device text not null,
  incoming_expected integer not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists journal_sync_conflicts_open
  on public.journal_sync_conflicts (user_id, entity_type, entity_id)
  where resolved_at is null;

alter table public.journal_sync_records enable row level security;
alter table public.journal_sync_conflicts enable row level security;

drop policy if exists journal_sync_records_select on public.journal_sync_records;
drop policy if exists journal_sync_records_insert on public.journal_sync_records;
drop policy if exists journal_sync_records_update on public.journal_sync_records;
drop policy if exists journal_sync_conflicts_select on public.journal_sync_conflicts;
drop policy if exists journal_sync_conflicts_insert on public.journal_sync_conflicts;
drop policy if exists journal_sync_conflicts_update on public.journal_sync_conflicts;

create policy journal_sync_records_select
  on public.journal_sync_records for select
  to authenticated
  using (auth.uid() = user_id);

create policy journal_sync_records_insert
  on public.journal_sync_records for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy journal_sync_records_update
  on public.journal_sync_records for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Sin DELETE de cliente. La baja es tombstone=true.
-- Sin policies para anon: cero acceso.

create policy journal_sync_conflicts_select
  on public.journal_sync_conflicts for select
  to authenticated
  using (auth.uid() = user_id);

create policy journal_sync_conflicts_insert
  on public.journal_sync_conflicts for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy journal_sync_conflicts_update
  on public.journal_sync_conflicts for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

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
