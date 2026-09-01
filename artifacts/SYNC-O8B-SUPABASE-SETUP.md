# SYNC O8B — Supabase + Auth foundation

Fecha: 2026-09-01  
Branch: `journal-v2-office`  
Código base auditado: `815089fe38d1b252fd27da6769588e6a5629547e`  
Contrato: `artifacts/SYNC-O8-CONTRACT.md`

O8B **no sincroniza datos**. Login ≠ sync. Schema local sigue en 2.

---

## 1. Qué hace Maca a mano en el Dashboard

1. Crear un proyecto Supabase (región cercana a IT/AR, da igual).
2. **Authentication → Providers → Email**
   - Enable Email: ON
   - Confirm email: OFF para MVP (una sola usuaria; si lo dejás ON, confirmá el mail a mano)
   - **Disable public signup** / “Allow new users to sign up”: OFF
3. **Authentication → Users → Add user**
   - Email + password de Maca
   - Auto-confirm
4. **Authentication → URL Configuration**
   - Site URL (producción): `https://macarenagalvan.github.io/miempresa/`
   - Redirect URLs adicionales:
     - `https://macarenagalvan.github.io/miempresa/`
     - `https://macarenagalvan.github.io/miempresa/index.html`
     - `http://127.0.0.1:8808/`
     - `http://localhost:8808/`
   Email+password no usa magic-link. Las URLs quedan listas para recover / O8C.
5. **SQL Editor** → pegar y correr `supabase/o8b.sql` (copiado abajo).
6. **Project Settings → API**
   - Copiar **Project URL**
   - Copiar **anon / publishable** key
   - No copiar la key de rol de servicio. No va al repo ni al browser.

---

## 2. Configuración cliente (GitHub Pages, sin bundler, sin .env)

Orden de lectura (`v2/js/services/auth.js`):

1. `window.__JOURNAL_SUPABASE__ = { url, publishableKey }`
2. `localStorage.journalV2.supabaseUrl` / `journalV2.supabasePublishableKey`
3. constantes en `v2/js/supabase-config.js` (hoy vacías a propósito)

Cómo cargarlas:

- Opción A — pegar URL + key en Sistema → Sincronización → “Conexión de este dispositivo”. Queda en ese browser.
- Opción B — editar `v2/js/supabase-config.js` y commitear solo URL + publishable. Son valores públicos de cliente. Igual no commitear la key de administración.

Cliente JS oficial, ESM, sin bundler:

```
https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm
```

Session key de Auth (no es Journal): `journalV2.supabase.auth` en localStorage. Se restaura al recargar.

---

## 3. Auth implementado en la app

- Iniciar sesión: email + contraseña
- Cerrar sesión
- Restaurar sesión al recargar (`restoreAuthSession` en `boot.js`, después del seed)
- Estados: `missing_config` | `signed_out` | `signed_in` | `error`
- UI: Sistema → Sincronización
  - No conectado
  - Conectado como `<email>`
  - error de conexión/auth
- Botón “Sincronizar ahora” visible y **disabled**: “Disponible después de activar la sincronización.”
- No hay registro público en la UI
- Login no escribe stores del Journal

---

## 4. SQL exacto

Archivo de repo: `supabase/o8b.sql`

```sql
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
```

---

## 5. RLS

```sql
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
```

Sin policy de DELETE. Sin policy para `anon`. Usuario no autenticado: cero filas.

---

## 6. RPC optimistic concurrency

`public.journal_sync_push(entity_type, entity_id, payload, expected_revision, tombstone, device_id)`

- `auth.uid()` null → exception `not_authenticated`
- fila inexistente + expected 0 → insert revision 1
- fila inexistente + expected ≠ 0 → `{ ok:false, kind:"missing" }`
- `revision !== expected` → no update; abre conflicto; `{ ok:false, kind:"conflict", cloud_revision, cloud_payload }`
- coincide → `revision + 1` y payload nuevo
- Prohibido last-write-wins por `updated_at`

Grant: `authenticated` only. El browser no llama esta RPC en O8B.

---

## 7. Checklist: ningún secreto admin en el frontend

- [ ] `v2/js/supabase-config.js` no tiene key de rol de servicio
- [ ] no hay `.env` commiteado
- [ ] no hay `service_role` en `v2/js/**` ni `index.html`
- [ ] Sistema → Sincronización rechaza una key que contenga ese rol
- [ ] slice19 barre fuentes de cliente
- [ ] Session de Auth ≠ IndexedDB JournalV2

---

## 8. Bloqueantes O8A — sin resolver

1. pull-first vs `ensureJournalSeed()`
2. proyección sincronizable de `meta` (`rgmSync` / `mt5Sync` / `lastBackupAt` device-local)
3. identidad estable / dedup RGM + MT5 + ASR

Pasan a O8C. O8B no los toca.

---

## 9. Qué todavía NO existe

- schema 3
- syncState / syncLedger / syncConflicts locales
- pull / push
- tombstones locales
- botón Sincronizar ahora funcional
- Realtime
- merge / Pages
