# Importación JSON de backtests — validación

Base: main `671743523bb9274f83d0c3a748b45a0bfa9d4c63` (PR #6). Rama nueva `feat/import-backtest-json`. No se fusionó ni copió el desarrollo OAuth/MCP del PR #7. Sin cambios de infraestructura, configuración productiva ni diseño visual.

## Auditoría del recorrido existente

Backtesting lista trades de la etapa activa filtrados por `context=BACKTEST`. La aplicación usa IndexedDB JournalV2 versión 3 y un ledger de sincronización existente. Los borradores son OPEN con `isDraft=true`, sin resultado de cierre; conservan campos `draft*` para completar después. `assertTrade` impide asociar una cuenta a BACKTEST; los cálculos de saldo excluyen BACKTEST y las estadísticas REAL filtran sus propios contextos. Edición, notas y capturas ya existen en el detalle.

## Cambio

Un archivo, una vista previa, una confirmación. Contrato limitado con versión e identificador estable, validación de tipos, fechas con zona, orden cronológico, precios y coherencia resultado/PnL. Campos desconocidos, incluyendo cuentas/contexto/IDs internos, se rechazan. Se permite incompletitud como borrador, incluso sin activo/dirección, exclusivamente para este tipo de importación; la validación de operaciones reales conserva sus exigencias. Activo y dirección pendientes se completan desde la edición del borrador.

Inserción con `add` y detección de duplicados en una única transacción IndexedDB sobre trades y ledger. Se conserva la identidad del archivo y su combinación original aunque después se edite. Ningún camino del importador actualiza trades existentes. Las notas se muestran con textContent; el archivo nunca se ejecuta ni se interpreta como HTML. Se mantiene el ledger local habitual; no se añade ninguna llamada externa.

## Pruebas ejecutadas

- Suite completa de `v2/tests/index.html`, incluyendo las pruebas nuevas: aprobada en Chrome con perfil desechable y red externa bloqueada.
- Nuevas pruebas: JSON inválido/versiones/tamaño/campos prohibidos/tipos/fechas/SL/resultados; vista previa y cancelar sin escrituras; persistencia tras reabrir base; borrador sin datos inventados y finalización posterior; repetición por ID y por contenido; identificación tras editar; duplicados de registros manuales; transacciones concurrentes; conservación de registros previos; saldo y estadísticas REAL intactos; cuentas y movimientos sin cambios; ledger habitual; notas literales sin HTML.
- `v2/tests/browser-qa.cjs`: alta manual, capturas antes/después, recarga, edición y navegación existentes aprobadas en escritorio y móvil, sin desbordamientos.
- `v2/tests/backtest-import-qa.cjs`: recorrido real del selector de archivo en escritorio y móvil, vista previa sin guardar, confirmación, recarga, edición de notas, captura posterior persistente, rechazo de duplicado y borrador sin activo/dirección completado desde la interfaz. Sirve bajo `/miempresa/` para verificar la ruta del ejemplo en GitHub Pages. Aprobado sin errores de página.
- Revisión visual de la vista previa móvil y comprobación de ancho: aprobadas. Se limitó el selector al ancho disponible.
- `git diff --check`: aprobado.

La automatización usa solo servidor HTTP en loopback y perfiles nuevos; no usa las sesiones ni la base del navegador de la usuaria. No se ejecutaron migraciones ni consultas a Supabase, no se pidieron credenciales, no se publicó ni fusionó el cambio.

## Límites

La deduplicación conoce únicamente los registros locales disponibles. No impone unicidad global entre dispositivos desconectados. Un archivo completo exige PnL monetario conocido para usar el cierre existente; si solo hay WIN/LOSS o R, se guarda borrador conservando el resultado declarado y las notas. No convierte capturas ni importa múltiples backtests por archivo.

## Reproducir

Con Node, Playwright y un Chromium instalado, ejecutar `node v2/tests/browser-qa.cjs` y `node v2/tests/backtest-import-qa.cjs`. Se pueden especificar `PLAYWRIGHT_MODULE`, `BROWSER_PATH` y `QA_OUTPUT` sin instalar dependencias en la aplicación. Los runners sirven sus propias páginas locales, bloquean destinos externos y cierran navegador/servidor al terminar.

El formato de archivo y el pedido reutilizable para ChatGPT están en `docs/IMPORTAR-BACKTEST.md`; el ejemplo descargable, en `docs/backtest-example.json`.
