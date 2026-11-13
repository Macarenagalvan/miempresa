# Journal P0.1 — seguridad de sincronización

Base: `bea153fabb173c255a5f99973af763fce9af518d` (P0).
No cambia el esquema IndexedDB, los registros de trading, las estadísticas ni el SQL desplegado.

## Cambios

- Cada escritura local sincronizable guarda registro y marcador en una transacción. `localVersion` es un identificador independiente del reloj; los escritores atómicos de P0 también lo generan.
- `pushDirty` toma una instantánea consistente del registro y su marcador. La confirmación remota actualiza la revisión de nube, pero solo limpia `dirty` si sigue siendo la misma versión. No reescribe el registro. Los borrados y las recreaciones también se conservan.
- La resolución de conflictos usa la misma protección: conservar local no reescribe una instantánea vieja; usar nube compara la versión dentro de la transacción y rechaza una edición posterior.
- Se fija propietario por usuario y origen del proyecto en el estado local del dispositivo. Cerrar sesión o cambiar conexión no borra ni transfiere esa pertenencia. Pull, push y resolución verifican la identidad; cada petición HTTP conserva el token y destino capturados, y descarta respuestas si cambia la sesión.
- En dispositivos antiguos sin propietario/proyecto confirmado, la sincronización automática queda bloqueada. La pantalla de configuración permite confirmar pertenencia con la misma cuenta previamente registrada. Los datos solo locales sin identidad previa requieren confirmación explícita. Esto es una declaración del usuario, no una inferencia de propiedad de un respaldo antiguo.
- Un dispositivo realmente vacío puede vincularse al descargar su Journal. No se importa una nube existente al intentar subir un Journal local a una nube no vacía.
- Todos los módulos de pruebas exigen el origen reservado `https://journal.test` y la marca que inyecta el runner. Allí utilizan `JournalV2-QA-<identificador>`, nunca `JournalV2`. La marca no funciona en otro origen.

## Reproducción segura

Usar el runner canónico P0/P0.1; no abrir `/v2/tests/` en el sitio de uso cotidiano. Los antiguos runners de loopback no habilitan esta batería protegida.

```powershell
$env:PLAYWRIGHT_MODULE = '<ruta a Playwright instalado>'
$env:BROWSER_PATH = '<ruta a Chromium o Chrome>' # opcional
$env:QA_OUTPUT = '<directorio de evidencia fuera del repositorio>'
$env:BACKUP_PATH = '<respaldo local opcional>'
node v2/tests/p0-ui-qa.cjs
```

El runner crea perfiles efímeros, sirve archivos locales mediante interceptación y aborta solicitudes externas. Ejecuta 39 módulos: los 38 de P0 y `p01-security.test.js`. Incluye 56 controles P0 y 43 P0.1; los tests de sincronización siguen pasando por la protección de propietario, con identidades sintéticas explícitas. No hay excepciones de seguridad para el adaptador de prueba.

Los controles nuevos cubren edición durante push, borrado/recreación, rollback de registro y marcador, desconexión/reconexión, error de red, conflictos, cambio de usuario/proyecto, logout en vuelo, destino/token HTTP fijo, dos identidades sintéticas independientes y escritores P0. Los controles adicionales del runner intentan ejecutar cinco módulos destructivos en dos contextos no autorizados y comprueban cero aperturas/borrados y conservación de un registro centinela sintético.

La prueba antigua de `updatedAt` en slice16 espera cruzar un tick antes de editar; conserva la comprobación original y elimina su dependencia de la velocidad de ejecución.

## Verificación externa pendiente

El 12 de noviembre de 2026 solo se encontró el proyecto Supabase principal, sin ramas de desarrollo. No se crearon usuarios, registros o conflictos en él.

Se inspeccionó en solo lectura: ambas tablas de sync tienen RLS; SELECT/INSERT/UPDATE quedan limitados a `auth.uid() = user_id`, con USING y WITH CHECK en UPDATE. `journal_sync_push` valida `auth.uid()`, filtra por ese usuario y solo concede EXECUTE a authenticated y al propietario. Esto confirma configuración, no sustituye un ensayo autenticado con dos usuarios.

Pendiente: recorrido real con dos identidades y dos dispositivos en Supabase de prueba, incluyendo políticas, permisos efectivos, imágenes, conflictos y reconexión. Los adaptadores sintéticos y el transporte HTTP interceptado no certifican Supabase real.

## Publicación

GO técnico para los tres bloqueos locales cubiertos por las pruebas; NO-GO para publicación general con sincronización hasta completar la verificación externa y la revisión del dispositivo habitual. No fusionar ni desplegar sin autorización expresa.

Antes de cualquier publicación, obtener respaldo actualizado, cerrar pestañas con código anterior, confirmar cuenta/proyecto propietario, repetir la batería sobre el commit definitivo y preparar reversión sin borrar IndexedDB. No usar simultáneamente una pestaña P0 y otra P0.1: el cliente antiguo no conoce los nuevos marcadores. No hay migración de datos ni eliminación automática.
