# Importación ZIP — alcance y validación

Base: `main` aec612c45a704a4cda8a7df0cfd82ff6af45cdce, que conserva PR #8. Rama independiente `feat/import-backtest-zip`. Sin fusión/publicación ni cambios en producción. No se utilizó la rama del PR #7.

## Implementación

Se amplía el selector existente a JSON o ZIP; el contrato y las reglas del JSON versión 1 permanecen iguales. El ZIP es un paquete acotado con `backtest.json` en la raíz y 1–8 capturas estáticas. El JSON se valida antes de decodificar imágenes. Se utilizan solamente APIs nativas del navegador, sin CDN, paquetes nuevos, OAuth, MCP ni solicitudes externas del importador.

El lector comprueba directorio y cabeceras locales, rangos no solapados, nombres y tipos de entrada, cantidad, tamaños acumulados, método STORED/DEFLATE, CRC y tamaño real al descomprimir. Rechaza cifrado, enlaces, carpetas/rutas, nombres repetidos, archivos extra, volúmenes y ZIP64. La expansión se lee por bloques con cancelación al superar el tamaño admitido; no se confía solo en el tamaño declarado. Las imágenes deben coincidir con su extensión y poder decodificarse; se inspeccionan dimensiones antes de crear el bitmap, se rechazan animaciones y se limitan bytes/píxeles por imagen y en conjunto. Los bitmaps temporales se cierran. Las URLs de miniaturas se revocan tras carga, cancelación, cambio de selección o salida del panel.

Se extrae `buildTradeImage` del repositorio existente para reutilizar exactamente la forma, nombres, blobs, fases, MIME y límites de las capturas. `addTradeImage` mantiene su comportamiento. El importador inserta trade, capturas y ledger en **una sola transacción IndexedDB**, usando `add` para nunca sustituir registros. Se mantienen las mismas reglas de deduplicación entre JSON/ZIP, incluso tras editar el trade. Un duplicado no agrega capturas al original. Un fallo aborta toda la transacción.

No hay migraciones de IndexedDB ni de Supabase; no se cambian las reglas de sincronización, autenticación, saldos o estadísticas. La sincronización ya configurada puede recoger los registros del ledger como cualquier captura habitual. Los importados siguen forzados a BACKTEST, sin accountId.

## Pruebas aprobadas

- Suite completa de `v2/tests/index.html`, incluidos los tests JSON del PR #8 y los nuevos ZIP, en perfil Chromium desechable con toda conexión externa bloqueada.
- Fixtures independientes generados con Python zipfile y Pillow: STORED, DEFLATE y descriptor de datos; PNG, JPEG y WEBP; límite de 8 imágenes; borrador con captura.
- Rechazo sin escrituras de JSON extra, rutas de escape, nombres repetidos ignorando mayúsculas, HTML disfrazado, extensión/MIME diferentes, demasiadas imágenes, ZIP truncado, cifrado, enlaces, ZIP64, cabeceras incoherentes, CRC incorrecto, expansión excesiva real/declarada, dimensiones abusivas, exceso de píxeles acumulados y PNG animado.
- Vector CRC32 estándar `123456789` verificado. Compatibilidad sin DEFLATE nativo: aviso y rechazo del comprimido; STORED y JSON siguen funcionando.
- Vista previa de datos/miniaturas y cancelación sin escrituras. La confirmación solamente acepta paquetes obtenidos por el lector validado.
- Fallo de cuota simulado después de encolar trade y una captura: rollback completo de trades, attachments y ledger.
- Dos confirmaciones concurrentes crean exactamente un trade con sus tres imágenes. Repetir JSON/ZIP no modifica el original ni añade capturas.
- Recarga y reapertura de IndexedDB: mismos bytes, tipos, nombres, fases y notas. Ledger de capturas presente y backup existente válido con imágenes codificadas.
- Cuentas, movimientos, registros previos, saldo y estadísticas REAL permanecen intactos en las pruebas aisladas.
- `browser-qa.cjs`: regresiones manuales existentes, capturas, recarga, edición y navegación aprobadas en escritorio y móvil.
- `backtest-import-qa.cjs` en modo JSON y en modo ZIP: selección real → vista previa → confirmación → recarga → edición de notas → captura adicional → rechazo de duplicado → borrador editable. Las tres miniaturas ZIP decodifican antes de confirmar y aparecen en el detalle tras recargar. Sin errores de página ni desbordamientos en móvil; revisión visual de la vista previa móvil aprobada.
- `git diff --check`: aprobado.

## Reproducción

Con Node, Playwright y Chromium disponibles, configurar opcionalmente `PLAYWRIGHT_MODULE` y `BROWSER_PATH` y ejecutar:

```text
node v2/tests/browser-qa.cjs
node v2/tests/backtest-import-qa.cjs
```

Para el recorrido ZIP, ejecutar el segundo comando con `QA_IMPORT_ZIP=1`. Los runners usan servidor en loopback, subruta `/miempresa/`, perfiles desechables y bloqueo de destinos externos. No se usaron las credenciales, las sesiones ni los datos del navegador habitual de la usuaria.

## Límites y referencias

ZIP: 25 MiB; JSON: 64 KiB; imágenes: 8 MiB cada una y 24 MiB en total, 8192 px por lado, 12 MP por imagen y 24 MP en conjunto; expansión máxima 200× por entrada. Navegadores sin `deflate-raw` nativo pueden usar STORED o JSON. No se admite ZIP64 ni carpetas de conveniencia del sistema operativo.

La deduplicación sigue siendo local: no asegura unicidad entre dispositivos aún sin sincronizar. El ZIP no sirve para enriquecer automáticamente un registro previo. El ejemplo descargable incluye exclusivamente datos e imágenes marcados como ficticios.

Formato para la usuaria y ChatGPT: `docs/IMPORTAR-BACKTEST-ZIP.md`. Referencias de implementación: [especificación ZIP de PKWARE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT) y [Compression Streams del navegador](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream). No se incorporaron librerías externas de compresión.
