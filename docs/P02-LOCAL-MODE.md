# P0.2 — modo local seguro

Base: P0.1 `0695229eea5a8ac174387d87006c9646c00e97ba`.

## Uso

Al abrir P0.2 por primera vez, el Journal queda en **Modo local — sincronización pausada**, incluso si P0/P0.1 tenía sincronización activa. Se conserva la cuenta, el proyecto propietario, los registros, capturas y pendientes. No cambia la versión del esquema IndexedDB ni el SQL de Supabase.

En Configuración → Sincronización:

1. Si está activa, elegir **Pausar sincronización**. No cierra sesión ni elimina datos locales/remotos.
2. Confirmar que aparece **Modo local — sincronización pausada**. Se puede seguir trabajando y los cambios quedan pendientes.
3. Para volver a conectar, elegir **Reactivar sincronización**. Requiere la cuenta y proyecto propietarios. Revisar cuenta, proyecto, número de pendientes y conflictos en la confirmación. Si cambiaron desde la revisión, se rechaza la reactivación y hay que revisar de nuevo.
4. Reactivar no ejecuta una transferencia por sí mismo ni resuelve conflictos. Después se puede elegir **Sincronizar ahora**; las siguientes ediciones, arranques y reconexiones podrán sincronizar normalmente. Si hay conflictos, elegir su resolución explícitamente.

Si aún no hay propietario confirmado, confirmar primero la pertenencia con la cuenta correcta. Una confirmación de pertenencia por sí sola no reactiva la sincronización. La pausa se guarda en este navegador, no en todos los dispositivos de la cuenta. La sesión puede renovarse; modo local bloquea las transferencias del Journal, no equivale a desconectar Auth de Internet.

## Solicitudes en curso y pestañas

La pausa incrementa una generación persistida en syncState. Las peticiones, respuestas, confirmaciones de subida, descargas y resoluciones conservan la generación con la que empezaron. Las escrituras derivadas de nube comprueban esa generación dentro de la misma transacción IndexedDB que modifica los datos. Pausar y reactivar rápidamente no vuelve válida una respuesta vieja.

El inicio de una petición se serializa con la pausa mediante syncState. Una petición ya enviada puede haber sido aceptada por el servidor: **la pausa no deshace esa operación remota**. Su respuesta tardía no modifica el estado local P0.2; los pendientes conservados pueden producir un conflicto en el siguiente intento y requieren revisión.

Las pestañas P0.2 comparten la pausa persistida; BroadcastChannel actualiza el panel de las otras pestañas, con actualización adicional al recuperar el foco. La protección de datos no depende de ese aviso visual.

**Cerrar todas las pestañas P0/P0.1 antes de usar/publicar P0.2.** La prueba con el código P0.1 original demuestra que su sincronización automática ve enabled=false, pero una llamada manual antigua todavía puede enviar datos. No se puede modificar retroactivamente el JavaScript ya cargado. No usar una versión vieja para volver atrás sin revisar esta limitación. Pausar también los demás dispositivos si se pretende que ninguno sincronice.

## Pruebas reproducibles

Desde un checkout Git que contenga el commit P0.1:

```powershell
$env:PLAYWRIGHT_MODULE = '<ruta al módulo Playwright instalado>'
$env:BROWSER_PATH = '<ruta a Chrome/Chromium>' # opcional
$env:QA_OUTPUT = '<directorio de evidencia fuera del repositorio>'
$env:BACKUP_PATH = '<ruta del respaldo a verificar>' # opcional, se lee sin modificarlo
node v2/tests/p0-ui-qa.cjs
```

El runner incluye los 40 módulos P0/P0.1/P0.2, controles de interfaz en escritorio/móvil emulado, dos pestañas compartiendo datos sintéticos, el cliente P0.1 original y arranque desde un estado P0.1 activo. P01_TEST_REF permite indicar una copia Git local comprobada del mismo código P0.1; el valor por defecto es el commit remoto indicado arriba.

Los módulos destructivos solo funcionan en perfiles temporales con origen https://journal.test, marca QA y base JournalV2-QA-*; no se abren perfiles del usuario. Todo tráfico externo se aborta. Dos contextos no autorizados intentan importar seis módulos destructivos cada uno y exigen cero aperturas/borrados y un centinela intacto. No abrir los tests en el sitio cotidiano.

El respaldo se valida y restaura únicamente en un contexto temporal sin sincronización; se vuelve a exportar para comparar cada registro y cada captura. Su hash se comprueba antes/después. No se incorpora el respaldo al repositorio ni a los informes públicos.

## Veredicto y límites

**GO técnico condicionado para publicar y usar P0.2 en modo local**, después de cerrar clientes anteriores y comprobar el estado pausado en cada navegador de uso. La primera apertura no habilita Supabase automáticamente. Este veredicto no autoriza fusionar ni desplegar.

**NO-GO para habilitar sincronización en producción** hasta completar la verificación externa P0.1: dos identidades y dispositivos en Supabase de prueba, permisos RLS efectivos, imágenes, conflictos y reconexión. Los ensayos sintéticos y HTTP interceptados no sustituyen esa integración. La revisión del dispositivo físico habitual sigue pendiente; el móvil probado es emulado.

Antes de publicar: respaldo actualizado verificado, autorización expresa, cierre de pestañas antiguas y comprobación de versión/estado pausado. Si cambia el código, reejecutar la batería sobre el contenido definitivo. Reversión: conservar IndexedDB y respaldos; no ejecutar borrados ni abrir un cliente antiguo conectado para deshacer la actualización.
