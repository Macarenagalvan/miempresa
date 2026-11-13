# P0.3 — recuperación manual de estudios históricos

Base publicada comprobada: P0.2 `fcb282b053737fa9a55210f7c8a955850cc87bac` (main y ejecución satisfactoria de Pages). La implementación P0.3 pertenece a una rama independiente; no publica ni convierte datos al cargar la aplicación.

## Decisión de preservación

Se inspeccionaron Trade, Observation, adjuntos, importador, estadísticas, backup y sincronización antes de implementar. Trade puede tener referencias operativas; las capturas tienen ID y propietario propios. El respaldo conserva campos adicionales y codifica los bytes de imágenes. La sincronización sube registros individualmente, sin una transacción que abarque trade y estudio.

Por eso la conversión conserva el Trade completo y sus capturas en sus ubicaciones originales. Crea una Observation con snapshot de todos los campos originales, IDs de capturas, procedencia de fechas y un historial de conversión/reversión. El Trade recibe únicamente un vínculo al estudio; no se cambia su lifecycle ni se inventan datos de ejecución. Los listados operativos y estadísticas omiten ese original vinculado.

Conversión y reversión usan una sola transacción IndexedDB que incluye ambos registros, referencias, conflictos y marcadores pendientes. El ID del estudio es estable por Trade; una segunda acción simultánea no crea otro estudio. Se mantienen las identidades de importación para impedir reimportaciones duplicadas.

La reversión devuelve exactamente el Trade original. La Observation queda archivada como historial, conservando sus ediciones y capturas nuevas; no se elimina. Si el original no cambió desde la reversión, una nueva conversión reutiliza el mismo estudio y sus notas. Si cambió, se bloquea para no sobrescribir el historial anterior.

## Procedimiento uno por uno

1. Cerrar las pestañas con versiones anteriores, incluida P0.2. Mantener la sincronización pausada y guardar un respaldo actualizado.
2. Abrir Backtesting → **Registros antiguos pendientes de clasificar** → el análisis, por ejemplo NAS100.
3. Revisar notas, gráficos y fechas originales. Los registros elegibles muestran **Convertir en estudio**.
4. Elegir **SIN EVALUAR**, **NO TRADE** o **HUBO ENTRADA** y confirmar la revisión. SIN EVALUAR es el valor inicial; no se contabiliza como NO TRADE.
5. Si la fecha falta, es inválida o las fuentes discrepan, confirmar mantenerla desconocida. Se conserva la información original sin usar createdAt/importación como fecha histórica.
6. Convertir. El estudio muestra sus gráficos originales y acciones de estudio. **Ver original vinculado** permite consultar el origen; **Revertir conversión** recupera el Trade sin perder las notas nuevas del estudio.

No se extraen automáticamente fechas de nombres de archivos ni texto de notas. Una fecha conocida conserva el campo y valor de origen; una fecha que el usuario introduzca después es una edición explícita del estudio y no altera la procedencia original guardada.

## Elegibilidad y bloqueos

Esta versión cubre los borradores OPEN de contexto BACKTEST provenientes del importador BACKTEST_JSON. Los registros REAL/DEMO, operaciones ejecutadas, fuentes distintas, registros sin activo o con referencias operativas no se convierten.

Los precios, PnL (incluido cero), resultados declarados, gestión y otros datos de ejecución parciales bloquean la conversión y se muestran para revisión como operación simulada. Tampoco se permite convertir con conflictos pendientes o imágenes sin bytes recuperables. No existe un botón para ignorar esas protecciones.

La pantalla no reclasifica ni modifica automáticamente el registro almacenado. Mientras espera revisión, lo presenta como **Pendiente de clasificar**, en lugar de BORRADOR. Los borradores manuales de operaciones siguen siendo borradores y los formularios reales permanecen intactos.

## Respaldo y estadísticas

No hay cambios de versión de esquema ni nuevos stores. Los campos de recuperación viajan en las colecciones existentes. La validación del respaldo comprueba los vínculos y las capturas originales; rechaza originales ausentes y snapshots incoherentes. Los respaldos anteriores siguen siendo admitidos por P0.3.

Los respaldos que contienen estudios recuperados deben restaurarse con P0.3 o una versión posterior compatible: P0.2 no conoce la fecha nula ni SIN EVALUAR. No usar una versión antigua para revertir; usar la acción de reversión de P0.3.

Los estudios no entran al winrate; el original convertido tampoco se cuenta como operación. Solo NO TRADE y HUBO ENTRADA forman el denominador de estudios clasificados. SIN EVALUAR queda aparte. REAL, DEMO y BACKTEST mantienen sus filtros independientes.

## Modo local obligatorio y límites

La recuperación exige sincronización pausada. Mientras existan estudios con historial de recuperación, la reactivación queda bloqueada, también después de restaurar un respaldo o revertir una conversión. Esto evita enviar vínculos dependientes mediante RPCs independientes. Su sincronización futura requiere implementación y pruebas específicas; no se declara soportada en P0.3.

Las capturas originales quedan protegidas frente a edición/borrado desde los repositorios de P0.3, incluso tras revertir, para preservar el historial. Pestañas antiguas no conocen estas protecciones: cerrarlas antes de trabajar. No se modifican sesiones ni propietarios de cuentas y no se accede a Supabase para convertir.

## Reproducción segura

Ejecutar `node v2/tests/p0-ui-qa.cjs` con PLAYWRIGHT_MODULE, BROWSER_PATH (opcional) y QA_OUTPUT como se indica en P02-LOCAL-MODE.md. El checkout debe incluir P0.1 para el ensayo heredado de pestaña antigua; P01_TEST_REF puede señalar una copia Git comprobada del mismo código. No definir BACKUP_PATH para reproducir esta entrega: P0.3 se verificó únicamente con datos sintéticos.

La batería incluye todos los módulos anteriores, p03-historical-study.test.js y recorridos reales de interfaz en escritorio/móvil emulado. Se comprueban conversión, reversión, rollback en ambas direcciones, concurrencia, IDs, duplicados, edición, gráficos, fechas, clasificación, estadísticas, respaldo/restauración y rechazo de sincronización. Los módulos destructivos permanecen limitados a JournalV2-QA-* en perfiles efímeros y origen reservado; el tráfico externo se bloquea.

## Veredicto

GO técnico para revisión y uso local de los casos elegibles después de cerrar clientes anteriores y disponer de respaldo. NO-GO para sincronizar estos vínculos o convertir registros bloqueados mediante excepciones. La revisión de un NAS100 personal y del dispositivo físico habitual queda a cargo de una futura sesión autorizada; no se tocaron datos personales en estas pruebas. No fusionar ni publicar sin autorización expresa.
