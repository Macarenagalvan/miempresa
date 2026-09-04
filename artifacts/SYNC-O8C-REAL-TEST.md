# O8C — prueba controlada PC → cloud → segundo browser

Fecha: 2026-09-02  
Branch: `journal-v2-office`  
Estado: implementación local lista. **No subir el Journal real todavía.**

## Qué no hacer
- No merge.
- No Pages.
- No apretar “Subir este Journal a la nube” con el Journal real hasta que Maca lo autorice.
- No correr restore con sync activado.

## Cómo abrir este HEAD
```powershell
cd miempresa
git fetch origin journal-v2-office
git checkout journal-v2-office
git pull
python -m http.server 8808
```
URL: `http://127.0.0.1:8808/index.html#/sistema`

## Prueba 1 — mocks (ya es la suite)
`http://127.0.0.1:8808/v2/tests/index.html`  
Debe terminar slice20 OK. No toca el proyecto Supabase real.

## Prueba 2 — Auth sigue vivo (sin upload)
1. Pegar Project URL + publishable en Conexión de este dispositivo.
2. Login email/password.
3. Verificar: Conectado como … / Solo local.
4. “Sincronizar ahora” disabled hasta confirmar upload.
5. No debe crear filas en `journal_sync_records`.

## Prueba 3 — bootstrap PC → cloud (cuando Maca autorice)
Usar un **Journal de prueba**, no el real:
1. En PC, Sistema → Sincronización.
2. Debe mostrar cantidad de registros y “Subir este Journal a la nube”.
3. Confirmar.
4. En Dashboard: `select entity_type, entity_id, revision, tombstone from journal_sync_records;`.
5. Esperado: meta + stages + el resto del fixture. revision 1.

## Prueba 4 — segundo browser / móvil vacío
1. Chrome perfil nuevo o el teléfono. Origen distinto = IndexedDB vacío.
2. Misma URL localhost o un tunnel. Mismo user Auth.
3. Login.
4. Esperado: pull-first. Una sola Stage ACTIVE. No aparece otra “V2 · inicio” peleando.
5. traderName / office notes del PC visibles.

## Prueba 5 — offline
1. DevTools → Offline.
2. Editar una nota/tarea.
3. Chip/estado: Sin conexión · cambios guardados.
4. Volver online → sync. Sin conflicto si la nube no cambió.

## Si algo sale mal
- Logout no borra IndexedDB.
- Restore está bloqueado mientras sync enabled.
- Conflictos quedan listados; no se pisa cloud ni local.
