# Journal P0: estudios y ejecución

Los estudios se guardan en `observations` con `date`, `studyOutcome` (`NO_TRADE` / `TRADE_TAKEN`) y `bias` opcional. No son trades CLOSED ni participan en winrate. Las observaciones anteriores siguen sin clasificar; no hay migración ni cambio de versión de IndexedDB.

Nuevo y Backtesting ofrecen tres accesos: Estudio / NO TRADE, Trade simulado (BACKTEST o DEMO) y Trade real (LIVE, PROP_CHALLENGE o FUNDED). Dirección, sesión y estado usan botones accesibles por teclado. Los datos secundarios de ejecución quedan plegados. Un guardado incompleto muestra el error; Guardar borrador es una acción explícita.

El cierre de un borrador abre un único editor de entrada, salida, fechas y análisis. `completeDraftTrade` valida antes de escribir y guarda trade + ledger en una transacción. Conserva ID, origen, fecha de creación y referencias a capturas; rechaza formularios obsoletos. `saveStudy` guarda observación, nuevas imágenes y ledger en una transacción.

## Reglas de ejecución

- Para BACKTEST no se asigna la hora actual en altas ni cierres. Los registros antiguos se conservan sin reescribirlos al leer o restaurar.
- Mínimo compartido para cierre manual/importado: activo, dirección, entrada, salida, fechas de entrada/cierre y PnL. SL, TP y estrategia clasificada no son obligatorios. Sin SL, R queda desconocido.
- Fechas ISO válidas con zona, cierre no anterior a entrada, precios positivos y SL del lado de riesgo cuando se suministra. La UI interpreta la hora en la zona del dispositivo, la indica y rechaza horas inexistentes durante el salto de verano. Guardar una fecha sin editar conserva segundos e instante original.
- El importador conserva su formato versión 1 y protección contra duplicados; si no se declara resultado y existe PnL, deriva WIN/LOSS/BE del signo. Los resultados declarados inconsistentes se rechazan. Se mantiene el BE explícito existente del formulario de ejecución.
- REAL, DEMO y BACKTEST siguen separados. Las estadísticas excluyen TEST/FICTICIO, borradores y anulados; winrate = WIN/(WIN+LOSS), sin BE. NO_TRADE usa como denominador solo estudios clasificados; las notas anteriores se muestran aparte.

## Pruebas reproducibles, sin producción

Se utiliza Playwright solo para QA, sin agregar dependencias a la aplicación. Con Playwright y un navegador ya disponibles:

```text
PLAYWRIGHT_MODULE=<ruta al módulo Playwright>
BROWSER_PATH=<ruta opcional al ejecutable del navegador>
QA_OUTPUT=<directorio de resultados fuera del repositorio>
BACKUP_PATH=<opcional: copia JSON local, nunca subirla al repositorio>
node v2/tests/p0-ui-qa.cjs
```

El runner intercepta todas las solicitudes: sirve los archivos locales en un origen ficticio y bloquea cualquier otro destino. Usa contextos de navegador nuevos, sin perfil de usuario ni sincronización. Ejecuta la batería completa, verifica opcionalmente restauración/exportación exacta del backup y recorre escritorio/Roma y móvil/Nueva York. Guarda logs, resumen y capturas con datos sintéticos.

Los tests históricos que dependían de la fecha actual ahora suministran fechas explícitas. Una fixture SHORT tenía el SL debajo de la entrada: se corrigió ese dato de prueba. No se eliminaron verificaciones anteriores. La nueva batería P0 cubre atomicidad, datos antiguos, fechas, estudios, capturas, paridad manual/importación y estadísticas.

## Límites y revisión manual antes de fusionar

- No se reclasifican borradores antiguos automáticamente. Un estudio antiguo guardado como trade permanece intacto; decidir su clasificación requiere revisión humana.
- Probar el selector nativo y el teclado en el dispositivo real. La emulación móvil de Chromium no certifica Safari/iOS.
- Se verifican payloads y marcadores locales de sync, no una cuenta Supabase real ni conflictos entre dispositivos reales.
- Las horas repetidas al finalizar el horario de verano siguen dependiendo de la interpretación del navegador; no se incorporó un selector de zona ni de desplazamiento UTC.
- No hay nueva exportación analítica, migración del modelo de borradores ni rediseño general.
- Antes de publicar, obtener un respaldo reciente: la verificación de una copia concreta no cubre registros posteriores.

La rama requiere autorización separada antes de fusionar o publicar.
