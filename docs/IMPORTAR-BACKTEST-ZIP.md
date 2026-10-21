# Importar un backtest con sus capturas

En **Backtesting → Importar backtest**, elegí un `.zip`, revisá los datos y las miniaturas y pulsá **Confirmar y guardar**. Si falta información, queda como **BORRADOR**, con sus capturas adjuntas. Abrí el registro para completar el análisis, ampliar las imágenes o agregar otras capturas con las funciones habituales.

Elegir un archivo o cerrar la importación no guarda nada. Al confirmar se guarda todo junto. Si falta espacio, hay archivos inválidos o el backtest ya existe, no se crea ningún registro ni se adjuntan imágenes a uno existente.

La importación de un `.json` solo sigue funcionando igual que antes. Su [contrato versión 1](IMPORTAR-BACKTEST.md) no cambia.

## Formato exacto del ZIP

Un ZIP contiene **un solo backtest**. Todos los archivos deben estar directamente en la raíz, sin carpeta contenedora:

```text
backtest.zip
├── backtest.json
├── before-chart.png
├── after-chart.jpg
└── detail-chart.webp
```

- **Exactamente un `backtest.json`**, con ese nombre en minúsculas, UTF-8, conforme al formato `maca-backtest`, versión `1`. Usá un `importId` estable para el mismo análisis. Los datos desconocidos se omiten o se escriben como `null`, sin inventarlos.
- **Entre 1 y 8 imágenes** PNG, JPG/JPEG o WEBP estáticas. Se adjuntan todas; el JSON no lleva lista de capturas, rutas, URLs ni campos adicionales.
- Nombres simples de archivo: primera letra o número, después letras ASCII, números, guiones o guiones bajos; base de hasta 71 caracteres más la extensión. Ejemplos: `before-01.png`, `after-02.jpg`, `detalle_03.webp`. Los nombres deben ser únicos incluso ignorando mayúsculas.
- El prefijo `before-` o `before_` clasifica la captura como **ANTES**; `after-` o `after_`, como **DESPUÉS**. Las demás capturas quedan sin fase. No se deduce la fase del orden del archivo.
- No incluir carpetas, archivos ocultos como `.DS_Store`, `__MACOSX`, otros JSON, SVG, GIF, HTML, ejecutables, ZIP anidados ni enlaces. Tampoco archivos cifrados o con contraseña.
- ZIP estándar de un solo volumen, **sin compresión (STORED) o DEFLATE**, sin ZIP64. Con Python, usar `zipfile.ZipFile(..., compression=zipfile.ZIP_DEFLATED)` y escribir los archivos con los nombres de la raíz. No empaquetar un directorio entero ni usar `force_zip64`.

El [ejemplo ZIP descargable](backtest-example.zip) contiene únicamente datos e imágenes ficticias. No reutilices su identificador para otro trade.

## Límites

| Contenido | Límite |
| --- | --- |
| ZIP seleccionado | 25 MiB (26.214.400 bytes) |
| JSON, ya descomprimido | 64 KiB (65.536 bytes) |
| Cantidad de capturas | 1 a 8 |
| Cada imagen, ya descomprimida | 8 MiB (8.388.608 bytes) |
| Suma de imágenes descomprimidas | 24 MiB (25.165.824 bytes) |
| Dimensiones de cada imagen | Máximo 8192 px por lado y 12 millones de píxeles |
| Suma de píxeles de las imágenes | 24 millones |
| Expansión de cada archivo del ZIP | Máximo 200 veces su tamaño comprimido |

La aplicación comprueba la estructura del ZIP, tamaños reales, CRC de integridad, firmas de imágenes, dimensiones y decodificación. Las extensiones por sí solas no bastan. Un ZIP dañado se rechaza completo. En navegadores sin descompresión DEFLATE nativa se muestra un aviso: se puede actualizar el navegador o generar el ZIP sin compresión; el JSON sigue disponible.

## Duplicados, persistencia y privacidad

Se usan las mismas reglas del JSON: identificador estable y combinación de datos originales del trade, comprobados contra los backtests locales. Un JSON y un ZIP del mismo backtest no crean dos registros. Cambiar solo imágenes, notas o el nombre del ZIP no permite reimportarlo. Para agregar capturas a un backtest ya importado, abrilo y usá **Añadir imagen**; no se actualiza automáticamente al reimportar.

El backtest y las capturas se insertan en una sola transacción local usando las estructuras existentes de trades, attachments y ledger, sin modificar el esquema de la base. Las imágenes conservan sus bytes, nombre, tipo y fase y son compatibles con el detalle y el backup actual. La sincronización existente puede recogerlas como cualquier otra captura si ya estaba configurada; no se crea ninguna conexión nueva ni se cambia Supabase.

Todo queda exclusivamente en Backtesting, sin cuenta ni movimientos de dinero. Las estadísticas y saldos reales permanecen separados. La prevención de duplicados depende de los registros locales disponibles; no puede detectar otro dispositivo todavía sin sincronizar.

## Pedido para ChatGPT

“Generá un ZIP descargable para Maca Trading Office con exactamente `backtest.json` en la raíz y entre 1 y 8 capturas PNG/JPG/WEBP estáticas, también en la raíz. El JSON debe cumplir maca-backtest versión 1, con importId estable; usar null para datos desconocidos, sin inventar precios, fechas ni PnL monetario. Conservá las notas. No agregues campos de imágenes al JSON. Nombrá las capturas before-01.png, after-02.jpg o detalle-03.webp según corresponda. Usá ZIP estándar STORED o DEFLATE, sin carpetas, archivos extra, contraseña ni ZIP64, respetando los límites de este documento. No generes ni sustituyas capturas reales por gráficos inventados.”
