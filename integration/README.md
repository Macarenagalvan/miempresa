# ChatGPT → Maca Trading Office

Estado: implementación en rama independiente; no desplegada. La prueba con una cuenta
real de ChatGPT y el OAuth alojado sigue pendiente. No conectar antes de aplicar las
restricciones de base de datos y validar el despliegue.

## Flujo

1. ChatGPT llama `prepare_backtest` con los datos conocidos y una `requestKey` estable.
2. Recibe el resumen normalizado, los faltantes y `confirmationUrl`. No se crea un trade.
3. Muestra el resumen y pide confirmación. La usuaria abre el enlace, revisa los datos
   desde su sesión de Maca y pulsa **Confirmo estos datos y autorizo guardarlos**.
4. Al volver a ChatGPT, `save_confirmed_backtest` registra esa propuesta exacta.
5. La sincronización existente recibe el registro; se abre desde Backtesting y permite
   editarlo y añadir capturas. Al volver a la lista o al detalle desde ChatGPT, Maca
   sincroniza y actualiza la vista sin reemplazar formularios en edición. También
   permanece disponible Sincronizar ahora en Sistema.

La aprobación vence 30 minutos después de preparar la propuesta. Cambiar datos exige
otra propuesta y otra aprobación. Un `confirmed: true` enviado por el modelo no sirve.
Esta versión exige un clic en Maca por registro; no ofrece confirmación exclusivamente
textual dentro del chat. No requiere transcribir datos ni copiar JSON.

Se guardan como borrador los registros sin activo, dirección, fecha, entrada, SL, TP,
estrategia, resultado, salida, fecha de cierre o PnL. No se inventan fechas ni ganancias
para satisfacer los requisitos actuales del cierre. El resultado observado de un
borrador se conserva como `draftResult`, separado del resultado realizado.

Las estrategias admitidas son las existentes en Maca. Si una estrategia todavía no
existe, usar UNCLASSIFIED y conservar su descripción en observaciones.

## Conexión a la cuenta de ChatGPT, después de aprobar el despliegue

1. En Supabase Authentication → OAuth Server, registrar un cliente dedicado a Maca
   Backtesting. Usar un cliente público con PKCE S256, sin secreto de cliente, y
   registro manual. Mantener desactivado el registro dinámico. Registrar exactamente
   el callback que muestre la configuración de conexión de ChatGPT; sin comodines.
2. Configurar la pantalla de consentimiento OAuth para que la URL final sea
   `https://macarenagalvan.github.io/miempresa/v2/integration.html`. Comprobar cómo se
   combina el campo Authorization path con el Site URL existente antes de cambiarlo.
   No alterar el login actual para corregir una ruta sin revisar su efecto.
3. Aplicar **una sola vez** `supabase/backtesting-integration.sql`, después de `o8b.sql`,
   desde el SQL Editor administrativo. Es transaccional, no borra ni actualiza datos
   de trading. No es un script de instalación repetible. Registrar el UUID público del
   cliente en `maca_integration.clients` desde el SQL Editor:

   ```sql
   insert into maca_integration.clients(client_id) values ('UUID-DEL-CLIENTE');
   ```

4. Poner ese mismo identificador público en `v2/js/integration-config.js`. No poner
   contraseñas, JWT, secretos OAuth ni claves administrativas en ese archivo.
5. Configurar la Edge Function `maca-backtesting` con las variables del ejemplo y
   desplegarla con `verify_jwt=false` según `supabase/config.toml`. Ese ajuste permite
   el descubrimiento OAuth: el handler verifica el token con Supabase Auth y comprueba
   emisor, audiencia, usuario, expiración, rol y cliente. Cada RPC vuelve a comprobar
   la sesión vigente y la autorización. No se utiliza `service_role`.
6. Publicar la página de confirmación y el código de Maca aprobado. Iniciar sesión y
   sincronizar la etapa activa antes de conectar. Una etapa local que nunca llegó a la
   nube no puede ser destino de la integración.
7. En ChatGPT Plugins, botón **+ → Add custom MCP server**, indicar el nombre
   **Maca Backtesting** y la URL HTTPS terminada en `/mcp`. Seleccionar OAuth y el
   cliente previamente registrado; solicitar solo `email`. La interfaz y el permiso
   de añadir servidores personalizados dependen de la cuenta y del workspace.
   Instalar la conexión y autorizarla desde la sesión de Maca. Si la cuenta no ofrece
   esta opción, falta habilitación del producto; no sustituirla por un token pegado
   en el chat. Los tokens OAuth se gestionan en el flujo de autenticación, nunca en
   mensajes, archivos de frontend ni el repositorio.
8. Abrir una conversación con la conexión seleccionada mediante `@`. Probar primero
   una propuesta sin aprobación: debe fallar el guardado. Luego confirmar el resumen
   en Maca y pedir guardarlo. Verificar aparición, edición, capturas y recarga. Repetir
   la misma solicitud y comprobar que devuelve el mismo ID sin duplicar.
9. Desconectar en **Backtesting → Integración con ChatGPT → Desconectar ChatGPT** y
   quitar la conexión en ChatGPT. Maca bloquea inmediatamente nuevos guardados y
   aprobaciones pendientes, aunque el JWT aún no haya vencido. Los trades permanecen.

URL prevista para el proyecto existente, **no activada por este PR**:
`https://vrqlnzpeqohsynfnmqxp.supabase.co/functions/v1/maca-backtesting/mcp`.
La metadata está bajo el mismo prefijo en `/.well-known/oauth-protected-resource`;
el desafío `WWW-Authenticate` indica la URL completa. Supabase sirve su propio
descubrimiento del servidor de autorización. Verificar ambos en el despliegue.

## Variables de la función

Ver `.env.example`. `MACA_PUBLISHABLE_KEY` es una clave pública de cliente, usada aquí
solo en servidor. También existe la configuración pública de Supabase que ya usa
Maca en el navegador; la seguridad depende de Auth y RLS. No requiere una clave de
OpenAI ni da al conector acceso administrativo a Supabase.

## Pruebas

```text
cd integration
npm ci --ignore-scripts
npm test
```

Usa PostgreSQL embebido PGlite para ejecutar el SQL real, con esquemas Auth simulados,
usuarios y roles de prueba. Guarda un archivo de la base y lo vuelve a abrir para
probar persistencia. El cliente MCP oficial prueba Streamable HTTP sobre localhost.
Estas pruebas no reemplazan el OAuth real, el gateway de Edge Functions ni una prueba
de concurrencia entre varios servidores Postgres en el entorno alojado.

La suite del navegador se ejecuta con `node v2/tests/browser-qa.cjs` desde la raíz.
La confirmación se prueba con `node integration/tests/consent-browser.cjs`.
Ambas aceptan `PLAYWRIGHT_MODULE` y `BROWSER_PATH` para reutilizar un navegador instalado.
El segundo script simula la sesión y las RPC: verifica la pantalla y el clic explícito,
no una autenticación real. Las pruebas nunca usan la sesión ni los datos del navegador
personal. GitHub Actions ejecuta únicamente las pruebas de seguridad/MCP, sin despliegue.

## Criterios antes de habilitarla

En un entorno de prueba alojado: ejecutar advisors, probar login y refresh OAuth,
consentimiento nuevo y repetido, revocación desde Maca y Supabase, y llamadas REST
directas con token OAuth contra tablas/RPC generales. Deben fallar. Probar guardados
concurrentes, verificar que no hay duplicados y comparar saldos y estadísticas reales.
Después realizar con la usuaria una prueba completa desde ChatGPT. No afirmar que esa
prueba ya pasó mientras no se haya hecho.

Para deshabilitar el servicio, desactivar las conexiones o la función. Conservar las
restricciones de OAuth y los datos; no revertirlas mientras puedan existir tokens.

Referencias verificadas el 21 de octubre de 2026:
- [OpenAI: autenticación MCP](https://developers.openai.com/plugins/build/auth)
- [OpenAI: conectar y probar un servidor](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Supabase: OAuth y MCP](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)
- [Supabase: scopes y RLS](https://supabase.com/docs/guides/auth/oauth-server/token-security)
