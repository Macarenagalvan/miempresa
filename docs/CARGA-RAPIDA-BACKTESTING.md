# Carga rápida de backtesting

Base: main/P0.2, fcb282b053737fa9a55210f7c8a955850cc87bac.
Rama local: codex/backtesting-quick-entry-20261115.

Una pantalla: fecha histórica, activo, LONG/SHORT, WIN/LOSS/BE/NO TRADE; R, notas y capturas opcionales. Guardar crea el registro y actualiza el historial en un clic. NO TRADE no requiere dirección ni datos de ejecución. La ruta dedicada anterior también abre esta carga. Los borradores se conservan y quedan fuera de los listados por defecto; siguen accesibles por el filtro existente.

Se reutilizan createClosedTrade, saveStudy, choiceButtons, adjuntos y transacciones IndexedDB de P0.2. La fecha de sesión se guarda en sourceRef.sessionDate, el resultado en result y R en rrRealized. No hay tablas, estados, migraciones ni dependencias nuevas. OPEN/CLOSED, estudios, REAL, DEMO y BACKTEST mantienen su separación.

No se inventan horas de entrada/cierre, precios, PNL ni R. WIN/LOSS participan del winrate; BE no entra en su denominador; NO TRADE queda en estudios. R vacío no entra en el promedio. Sin PNL no se calculan importes, profit factor ni drawdown monetario. Cuando el conjunto incluye sesiones sin hora, las rachas se muestran sin valor: no conocemos el orden de ejecución dentro de un día.

## Validación aislada

Ejecutar `node v2/tests/quick-backtest-qa.cjs`, con PLAYWRIGHT_MODULE apuntando a Playwright ya instalado, BROWSER_PATH al navegador y QA_OUTPUT a una carpeta de evidencias. No se añade Playwright al producto.

El runner utiliza perfiles nuevos y el origen reservado https://journal.test. Sirve el código desde disco, bloquea tráfico externo y abre exclusivamente JournalV2-QA-<UUID>. Nunca utiliza perfiles ni bases personales.

Resultados en escritorio (1440x1000) y móvil (390x844):
- Guardado y lectura después de recarga; una captura conserva su vínculo.
- Doble envío crea exactamente una operación.
- Borrador sintético previo idéntico antes/después y oculto del flujo principal.
- NO TRADE sin dirección, notas, R ni ejecución.
- Rechazo de R incompatible, fechas inválidas, dirección ausente y contextos REAL/DEMO en carga histórica.
- Captura inválida y fallo inyectado durante la transacción no dejan operaciones parciales.
- Backup/restauración local conserva exactamente las operaciones nuevas y previas.
- Sincronización pausada; sin desbordamiento horizontal ni errores de navegador.
- Suite completa existente de P0.2: passed. Pruebas antiguas del formulario avanzado se mantienen sobre su ruta genérica; las pruebas de la ruta dedicada verifican ahora los campos mínimos.

Caso de control: WIN +2R, LOSS sin R, BE 0R y un estudio NO TRADE. Resultado: 3 operaciones, winrate 50%, 2 R válidos, promedio +1R, 0 PNL conocidos, 1 estudio NO TRADE. REAL y DEMO: 0 operaciones en este conjunto. Las rachas son desconocidas.

## Decisión

GO para revisión funcional de esta mejora acotada.
NO-GO para publicar sin autorización explícita. No se hizo push, merge, despliegue ni modificación de main. P0.3 no fue descargada ni integrada. No se consultó ni modificó Supabase, y no se tocaron datos personales.

Límite deliberado: la ficha de una carga rápida permite leer el resultado y sus capturas; no expone el editor avanzado de ejecución, que exigiría datos que esta carga no solicita. No se añade un nuevo flujo de edición/conversión. La prevención de duplicados cubre doble clic/envío concurrente; dos cargas deliberadas separadas pueden representar operaciones legítimamente distintas.
