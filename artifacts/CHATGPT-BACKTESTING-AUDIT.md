# Auditoría e integración de Backtesting

21 de octubre de 2026. Base: `6717435`, main con el PR #6 fusionado.
Rama: `feat/chatgpt-backtesting`. Las otras copias locales no se modificaron.

## Almacenamiento y flujos existentes

- IndexedDB JournalV2, versión 3, conserva el journal local. Los repositorios y la
  bitácora de sincronización usan IDs estables y revisiones para los conflictos.
- Supabase almacena colecciones en `journal_sync_records`, separadas por usuario,
  tipo e ID. `journal_sync_push` crea o actualiza con revisión esperada; por eso no se
  entrega esa RPC general al conector. La nueva API solo inserta trades nuevos.
- Auth usa sesiones de Supabase y la librería existente, sin configuración privada
  embebida. La detección previa de claves inseguras solo buscaba texto; se añade el
  rechazo de claves `sb_secret_` y JWT cuyo rol no sea `anon`.
- Los borradores son `isDraft=true` con lifecycle OPEN, sin cierre ni resultado
  realizado. El modelo exigía activo/dirección incluso en borradores; se permite su
  ausencia únicamente en borradores BACKTEST de la integración, y se habilita su
  edición. La activación y el cierre siguen exigiendo los campos del dominio.
- Backtesting ya tiene pantalla propia, capturas, notas y edición. Se reutilizan.
- `accountBalance` excluye BACKTEST y los filtros REAL excluyen su contexto. Los
  registros nuevos fuerzan accountId nulo y no escriben cuentas ni movimientos.

## Revisión remota, de solo lectura

Se identificó el proyecto Supabase existente por nombre. Se revisaron tipos de
colección, políticas, funciones privilegiadas, estructura de sesiones y número de
clientes OAuth. No se exportaron registros personales ni credenciales.
Hay políticas de propietario sobre las dos tablas de sync y cero clientes OAuth
activos al momento de la revisión.

Hallazgo principal: los scopes de OAuth de Supabase no restringen por sí mismos la
base de datos. Las políticas existentes basadas solo en auth.uid() permitirían
acceso general a un token OAuth. Además, journal_sync_push usa SECURITY DEFINER y
necesita una denegación propia antes de acceder a las tablas.

El script añade políticas RESTRICTIVE para denegar OAuth sobre ambas tablas y
rechaza OAuth en journal_sync_push, preservando el flujo de sesiones directas.
La integración solo dispone de RPC específicas: preparar, guardar una propuesta
aprobada, y acciones de consentimiento/revocación reservadas a sesiones directas.
Las tablas internas tienen RLS y no conceden acceso a anon/authenticated.

Advisors remotos anteriores al despliegue reportaron:

- `rls_auto_enable`, un event_trigger, tiene EXECUTE concedido a clientes. Se incluye
  la revocación de esos permisos; no se desactiva el trigger.
- `journal_sync_push` es una función privilegiada accesible a authenticated. Es un
  diseño previo necesario para el sync; se mantiene su control de usuario y se añade
  el bloqueo específico a OAuth.
- La protección de contraseñas filtradas está desactivada. No se cambió la
  configuración de Auth; queda como acción de administración separada.

## Seguridad del diseño

La aprobación reside en Supabase y solo puede emitirla la sesión directa del usuario.
El modelo no recibe esa sesión. Una propuesta aprobada es inmutable, tiene propietario,
cliente, etapa, generación de conexión y vencimiento. Revocar invalida la generación;
reconectar no rehabilita aprobaciones anteriores. También se verifica auth.sessions
para impedir que un JWT sobreviviente a la revocación siga guardando.

Cada escritura es exclusivamente BACKTEST, con cuenta nula, origen identificable y
una revisión inicial. Se rechazan campos extra, números no válidos, fechas sin zona,
SL/TP incompatibles y contradicciones entre resultado y PnL. Los faltantes pasan a
borrador sin contaminar resultados. Las capturas se añaden desde la app existente.

La idempotencia vincula requestKey a los datos exactos. El guardado bloquea por
identidad semántica y busca un registro existente del mismo usuario/etapa, incluidas
las bajas lógicas, antes de insertar. Para trades con identidad suficiente considera
activo, dirección, fecha/hora y entrada; ante coincidencia devuelve el ID existente,
sin editarlo. Para borradores se usa la huella SHA-256 del contenido normalizado.
Es deliberadamente conservador: una operación distinta con idéntica identidad deberá
revisarse en Maca. No se garantiza detectar coincidencias con registros que todavía
solo existen sin sincronizar en otro dispositivo.

## Estado de validación

- SQL real ejecutado en PostgreSQL embebido, roles/RLS, aislamiento entre usuarios,
  consentimiento, rechazo sin aprobación, persistencia después de reabrir archivo,
  idempotencia, duplicados, revocación, expiración y permisos de RPC.
- Cliente MCP oficial 1.32.1: initialize, tools/list, prepare y save sobre HTTP local.
  Verificación remota de Auth simulada; las comprobaciones del handler sí se ejecutan.
- Suite existente del navegador aprobada. Casos nuevos: importación por sync,
  reimportación sin duplicación, detalle, edición de borrador, activación, capturas,
  persistencia y separación de saldo/estadísticas REAL/BACKTEST.
- Regresión de escritorio y móvil: alta, dos imágenes, recarga, edición de estrategia,
  navegación y ocho pantallas sin desbordamiento.
- Confirmación en escritorio/móvil: no se aprueba al cargar, texto escapado, faltantes
  visibles y una sola aprobación al pulsar el botón. También se probaron consentimiento
  OAuth nuevo y repetido. Usa sesión/RPC simuladas.
- Actualización de la lista/detalle al completar sync o volver a Maca, preservando
  los formularios en edición. La regresión completa se volvió a ejecutar y pasó.
- Resultado final de la suite de seguridad/MCP: 21 tests, 21 aprobados, cero fallos.

No se aplicó SQL ni se desplegaron funciones, clientes OAuth o frontend en producción.
No se modificó ni eliminó ningún registro existente. Sigue pendiente la validación
del gateway, OAuth alojado, concurrencia entre conexiones reales y el recorrido desde
la cuenta de ChatGPT de la usuaria. El PR debe permanecer borrador hasta completar esa
validación. La guía de conexión está en `integration/README.md`.
