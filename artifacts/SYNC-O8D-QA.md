# O8D — QA real controlada (Device A/B)

Fecha: 2026-09-04  
Branch: `journal-v2-office`  
Base O8C: `6cc5d01`  
Alcance de código en este cierre: resolución de conflictos (Conservar local / Usar versión de la nube) + tests slice20.

No merge. No Pages. No Journal real.

## Qué ya está verificado en mocks

- Suite 0–20 en origin limpio: resolución keep-local, use-cloud, stale durante resolución, tombstone, conflicto no se cierra si el push falla.
- Smoke `#/hoy` y `#/sistema`: panel Sincronización visible, login local, Sincronizar ahora disabled sin sync enabled, sin upload automático.
- `supabase-config.js` sigue con URL/key vacías. Este workspace no tiene credenciales del proyecto real.

## Qué NO se ejecutó desde este sandbox

Device A/B contra Supabase real, bidireccional, offline real, conflicto real en dos browsers, móvil LAN y cleanup de tablas. Faltan Project URL + publishable + usuario QA en este entorno. No se inventó un bootstrap real.

## Cómo abrir la build (PowerShell, origins nuevos)

```powershell
cd miempresa
git fetch origin journal-v2-office
git checkout journal-v2-office
git pull
python -m http.server 8891
```

Device A: `http://127.0.0.1:8891/index.html#/sistema`  
Device B (otra consola, otra IDB):

```powershell
python -m http.server 8892
```

`http://127.0.0.1:8892/index.html#/sistema`

Cada puerto = origin distinto = IndexedDB limpia. No uses el origin donde está el Journal real.

## Datos QA (reconocibles)

- Task: `QA O8D PC`
- Note: `QA O8D CLOUD`
- Event: `QA O8D MOBILE`
- Task extra A→B: `QA O8D A2B`
- Note extra B→A: `QA O8D B2A`

## Secuencia

1. Device A vacío → pegar URL+key pública → login → confirmar Solo local / sin filas cloud.
2. Crear el set QA chico en Hoy.
3. Apretar **Subir este Journal a la nube** (no antes).
4. Dashboard: `select entity_type, count(*) from journal_sync_records group by 1;`
5. Device B vacío, mismo user → pull-first → 1 Stage ACTIVE, Office QA visible.
6. Bidireccional Task A→B y Note B→A. Sin duplicados.
7. Editar un registro en A, sync, pull B sin tocar B.
8. B offline → crear/editar Task → chip `Sin conexión · cambios guardados localmente` → online → sync → ver en A.
9. Conflicto: misma fila, B offline, editar A+sync, editar B, B online+sync → UI Conflicto, ambas versiones.
10. Resolver en B: Conservar local **o** Usar versión de la nube. El conflicto no se cierra si el RPC falla.
11. Dedup QA: no hace falta MT5/RGM productivos.
12. Meta: traderName viaja; rgmSync / mt5Sync / lastBackupAt quedan por dispositivo.
13. Móvil solo después de A/B desktop. Misma build por LAN, no Pages.
14. Cleanup solo filas QA del user de prueba:

```sql
delete from journal_sync_conflicts where user_id = '<qa-user-id>';
delete from journal_sync_records where user_id = '<qa-user-id>';
```

Confirmar 0 filas de ese user. No borrar proyecto / SQL / RLS / RPC.

## Resolución implementada

- Conservar local: pull revision cloud actual → push con expected=revision viva → cierra solo si RPC `ok`.
- Usar nube: aplica payload/tombstone localmente, ledger `dirty=false`, cierra conflicto.
- Stale entre pull y push: conflicto sigue abierto; no se pisan las dos versiones.
