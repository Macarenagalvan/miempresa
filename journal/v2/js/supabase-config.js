/**
 * Valores públicos de cliente. Nunca una key de administración.
 *
 * Cómo cargarlos (primera que exista gana):
 * 1. window.__JOURNAL_SUPABASE__ = { url, publishableKey }
 * 2. localStorage journalV2.supabaseUrl / journalV2.supabasePublishableKey
 * 3. las constantes de abajo
 *
 * En GitHub Pages no hay .env ni bundler. Editá este archivo
 * o pegá URL+key en Sistema → Sincronización (queda en localStorage).
 */
export const SUPABASE_URL = "";
export const SUPABASE_PUBLISHABLE_KEY = "";

export const SUPABASE_LS_URL = "journalV2.supabaseUrl";
export const SUPABASE_LS_KEY = "journalV2.supabasePublishableKey";
export const SUPABASE_JS_ESM = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";
