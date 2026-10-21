# Importar un backtest de ChatGPT

En Backtesting, pulsá **Importar backtest**, seleccioná el JSON, revisá todos los datos y pulsá **Confirmar y guardar**. Seleccionar el archivo no guarda nada. Podés cerrar la importación sin guardar. Después abrí el registro para editar el análisis, completar el borrador y agregar capturas con las funciones existentes.

Un archivo contiene **un solo backtest**. JSON UTF-8, máximo 64 KiB, sin bloques Markdown, comentarios, cuentas, contexto, órdenes, imágenes ni identificadores internos de la aplicación. Ejemplo descargable: [backtest-example.json](backtest-example.json). Es ficticio; no lo confundas con una operación real.

## Contrato versión 1

La raíz contiene exactamente `format`, `version`, `importId` y `backtest`:

```json
{
  "format": "maca-backtest",
  "version": 1,
  "importId": "eurusd-20250910-long-01",
  "backtest": {
    "asset": "EURUSD",
    "direction": "LONG",
    "openedAt": "2025-09-10T10:00:00+02:00",
    "closedAt": "2025-09-10T11:00:00+02:00",
    "entry": 1.17,
    "initialSL": 1.169,
    "tp": 1.172,
    "exit": 1.172,
    "netPnl": 20,
    "strategy": "MACA",
    "result": "WIN",
    "note": "Ejemplo ficticio. Confirmación observada; capturas pendientes."
  }
}
```

`format` debe ser `maca-backtest`; `version` debe ser el número `1`. `importId` es obligatorio, estable y exclusivo de ese análisis: 8–100 caracteres, letras ASCII, números, guion o guion bajo. Al regenerar o corregir el mismo análisis conservá ese identificador. No reutilices el ID del ejemplo para otros trades.

Todos los campos de `backtest` pueden omitirse o tener `null` si se desconocen. No inventes datos para completar un registro. No se admiten campos adicionales.

| Campo | Valor |
| --- | --- |
| `asset` | Símbolo de hasta 40 caracteres, letras/números y `.`, `_`, `/`, `-`. Se normaliza a mayúsculas, sin espacios; SPX/US500/S&P500 se normalizan a SP500. |
| `direction` | `LONG` o `SHORT`. |
| `openedAt`, `closedAt` | Fecha/hora ISO con segundos y zona obligatoria: `2025-09-10T10:00:00+02:00` o `2025-09-10T08:00:00Z`. Milisegundos opcionales de tres cifras. Cierre igual o posterior a entrada. No adivinar zona u hora. |
| `entry`, `initialSL`, `tp`, `exit` | Número JSON finito mayor que cero, punto decimal, sin comillas ni símbolos de moneda. El SL debe estar por debajo de entrada en LONG y por encima en SHORT. |
| `netPnl` | PnL monetario neto conocido, número con signo; no es R ni porcentaje. Si solo conocemos R o WIN/LOSS, usar `null`, conservar ese dato en las notas y guardar borrador. Nunca calcular dinero sin datos suficientes. |
| `strategy` | `MACA`, `BLUE`, `RED`, `PINK`, `WHITE`, `BLACK`, `GREEN`, `GREEN_CRYPTO` o `UNCLASSIFIED`. Otras estrategias se describen en `note`, usando `UNCLASSIFIED`. |
| `result` | `WIN`, `LOSS`, `BE` o `null`. Debe coincidir con el signo de `netPnl` cuando ambos se conocen. En borradores se conserva como resultado declarado, visible en el origen del registro. |
| `note` | Texto de hasta 20.000 caracteres, conserva saltos de línea; no se interpreta como HTML ni ejecuta instrucciones. |

Si falta cualquiera de activo, dirección, ambas fechas, entrada, SL, TP, salida, PnL, estrategia clasificada o resultado, se guarda **BORRADOR**. Un archivo completo también puede guardarse como borrador marcando la opción. Los borradores no computan como operaciones cerradas; se completan y cierran desde el registro existente.

## Duplicados y almacenamiento

Se bloquea el mismo `importId`, incluso si se editó el registro, y también la misma combinación normalizada de activo, dirección, fechas, entrada, SL, TP, salida y PnL, aunque cambien las notas o el ID. Se comprueba contra todos los backtests locales, incluidos anulados y otras etapas. Los intentos simultáneos en pestañas del mismo navegador comparten una transacción; nunca se sobrescribe un registro existente. Si fue bloqueado por error, abrí y revisá el registro existente.

La protección depende de los registros presentes en este navegador; no puede detectar un archivo importado en otro dispositivo todavía no sincronizado. No es un servicio global de deduplicación.

Se usa la base local IndexedDB actual, sin nueva base, credenciales, infraestructura, migraciones ni cambios en Supabase. La entrada de sincronización habitual se conserva por compatibilidad con la sincronización que ya tenga configurada la usuaria; el importador no abre una nueva conexión ni llama servicios externos. Es siempre `BACKTEST`, sin cuenta, sin cambios en movimientos/saldos/operaciones reales. Hacé los respaldos habituales de la aplicación para proteger datos locales.

## Pedido reutilizable para ChatGPT

“Generá un archivo JSON UTF-8 descargable siguiendo el contrato maca-backtest versión 1 de este documento, con un solo backtest. Conservá un importId estable para el mismo análisis. Usá null en los datos desconocidos; no inventes fechas, zona horaria, precios ni PnL. Conservá el análisis y observaciones en note. No incluyas cuentas, contexto, credenciales, imágenes ni campos adicionales.”

## Capturas incluidas en un ZIP

También podés importar este mismo JSON junto con imágenes en un ZIP. El formato del JSON no cambia: seguí el [formato ZIP documentado](IMPORTAR-BACKTEST-ZIP.md).
