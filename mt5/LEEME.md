# MACA: exportación periódica desde MetaTrader 5

Este programa solo lee el historial y genera un CSV. No abre, modifica ni cierra operaciones; no utiliza contraseñas, DLL ni conexiones de red propias.

## Instalación una sola vez

1. En MT5: Archivo → Abrir carpeta de datos → MQL5 → Experts. Copiá allí `MacaAutoExport.ex5` del ZIP. El `.mq5` es el código fuente, opcional.
2. En el Navegador de MT5, actualizá Asesores Expertos y arrastrá **MacaAutoExport** a un gráfico aparte. No reemplaces un asesor que ya uses para operar. No necesita permisos de negociación ni DLL.
3. En el gráfico aparece la ruta del CSV: carpeta común de MetaTrader → Files → MACA. El nombre contiene servidor y número de cuenta. Abrí esa carpeta y arrastrá el CSV a **Importar MT5** del journal; revisá y confirmá.

Con MT5 abierto y conectado, el archivo se actualiza cada 60 segundos si cambia el historial. El journal NO se actualiza solo: todavía hay que arrastrar el archivo y confirmar. La cuenta y el horario se recuerdan en el journal. El horario es el del servidor del broker; el exportador no adivina la zona ni sus cambios estacionales.

## Alcance y comprobación inicial

- Exporta posiciones totalmente cerradas del historial que el broker entrega al terminal. Usa el ID estable de posición para deduplicar.
- Suma beneficio, comisión, swap y tasas asociadas a sus ejecuciones. Si hay varias entradas/salidas, calcula precios medios ponderados y marca los parciales. No inventa un SL inicial ni riesgo.
- No importa posiciones abiertas, depósitos ni retiros. Las reversiones netting, posiciones incompletas o no compatibles se omiten y se cuentan en el gráfico. Los cargos sin posición se indican por separado: pueden explicar diferencias con el saldo.
- Un CSV de cuenta distinta se bloquea si el origen guardado tiene número MT5. Los ajustes posteriores del broker sobre posiciones ya importadas no sobrescriben automáticamente el journal.
- Antes de usarlo habitualmente, compará el primer CSV con el informe HTML de MT5: cantidad de posiciones y neto. Si hay omisiones o diferencias, usá el HTML y revisalas.

Estado de validación: compilado con MetaEditor, sin errores ni advertencias. El formato y la marca de parciales se prueban contra el importador. La lectura del historial en una sesión real de MT5 debe comprobarse al instalarlo; la compilación por sí sola no verifica esa lectura.

Referencias oficiales: https://www.mql5.com/en/docs/trading/historyselect · https://www.mql5.com/en/docs/constants/tradingconstants/dealproperties · https://www.mql5.com/en/docs/eventfunctions/eventsettimer
