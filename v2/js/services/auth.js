import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_LS_URL,
  SUPABASE_LS_KEY,
  SUPABASE_JS_ESM,
} from "../supabase-config.js";

const FORBIDDEN_KEY_RE = new RegExp("service" + "_" + "role|secret[_-]?key", "i");

let injectedClient = null;
let cachedClient = null;
let lastError = null;

export function setAuthClient(client) {
  injectedClient = client;
  cachedClient = null;
}

export function resetAuthRuntime() {
  injectedClient = null;
  cachedClient = null;
  lastError = null;
}

export function readSupabaseConfig() {
  const win = typeof window !== "undefined" ? window.__JOURNAL_SUPABASE__ : null;
  let lsUrl = "";
  let lsKey = "";
  try {
    lsUrl = String(localStorage.getItem(SUPABASE_LS_URL) || "").trim();
    lsKey = String(localStorage.getItem(SUPABASE_LS_KEY) || "").trim();
  } catch (_) {
    /* localStorage bloqueado */
  }
  const url = String((win && win.url) || lsUrl || SUPABASE_URL || "").trim();
  const publishableKey = String(
    (win && (win.publishableKey || win.anonKey)) || lsKey || SUPABASE_PUBLISHABLE_KEY || "",
  ).trim();
  return { url, publishableKey };
}

export function saveSupabaseConfig({ url, publishableKey }) {
  const nextUrl = String(url || "").trim();
  const nextKey = String(publishableKey || "").trim();
  assertClientKeySafe(nextKey);
  localStorage.setItem(SUPABASE_LS_URL, nextUrl);
  localStorage.setItem(SUPABASE_LS_KEY, nextKey);
  cachedClient = null;
}

export function clearSavedSupabaseConfig() {
  localStorage.removeItem(SUPABASE_LS_URL);
  localStorage.removeItem(SUPABASE_LS_KEY);
  cachedClient = null;
}

export function assertClientKeySafe(key) {
  const value = String(key || "");
  if (FORBIDDEN_KEY_RE.test(value)) {
    throw new Error("esa key no puede usarse en el browser");
  }
  return true;
}

export function configReady(cfg = readSupabaseConfig()) {
  return Boolean(cfg.url && cfg.publishableKey);
}

async function loadOfficialClient(cfg) {
  assertClientKeySafe(cfg.publishableKey);
  const mod = await import(SUPABASE_JS_ESM);
  const createClient = mod.createClient;
  if (typeof createClient !== "function") {
    throw new Error("no se pudo cargar el cliente de Supabase");
  }
  return createClient(cfg.url, cfg.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "journalV2.supabase.auth",
    },
  });
}

export async function getAuthClient() {
  if (injectedClient) return injectedClient;
  if (cachedClient) return cachedClient;
  const cfg = readSupabaseConfig();
  if (!configReady(cfg)) return null;
  cachedClient = await loadOfficialClient(cfg);
  return cachedClient;
}

function sessionEmail(session) {
  return session && session.user && session.user.email
    ? String(session.user.email)
    : null;
}

function sessionUserId(session) {
  return session && session.user && session.user.id
    ? String(session.user.id)
    : null;
}

export async function getAuthState() {
  const cfg = readSupabaseConfig();
  if (!configReady(cfg)) {
    return { status: "missing_config", email: null, userId: null, error: null };
  }
  try {
    const client = await getAuthClient();
    if (!client || !client.auth || typeof client.auth.getSession !== "function") {
      return { status: "error", email: null, userId: null, error: lastError || "cliente de Auth no disponible" };
    }
    const { data, error } = await client.auth.getSession();
    if (error) {
      lastError = error.message || String(error);
      return { status: "error", email: null, userId: null, error: lastError };
    }
    const email = sessionEmail(data && data.session);
    const userId = sessionUserId(data && data.session);
    if (email) return { status: "signed_in", email, userId, error: null };
    return { status: "signed_out", email: null, userId: null, error: null };
  } catch (err) {
    lastError = err && err.message ? err.message : String(err);
    return { status: "error", email: null, userId: null, error: lastError };
  }
}

export async function restoreAuthSession() {
  return getAuthState();
}

export async function signInWithPassword(email, password) {
  const cfg = readSupabaseConfig();
  if (!configReady(cfg)) {
    return { ok: false, state: await getAuthState() };
  }
  const client = await getAuthClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: String(email || "").trim(),
    password: String(password || ""),
  });
  if (error) {
    lastError = error.message || String(error);
    return {
      ok: false,
      state: { status: "error", email: null, userId: null, error: lastError },
    };
  }
  lastError = null;
  return {
    ok: true,
    state: {
      status: "signed_in",
      email: sessionEmail(data && data.session),
      userId: sessionUserId(data && data.session),
      error: null,
    },
  };
}

export async function signOut() {
  const client = await getAuthClient();
  if (client && client.auth && typeof client.auth.signOut === "function") {
    await client.auth.signOut();
  }
  lastError = null;
  return getAuthState();
}

export function authLabel(state) {
  if (!state) return "No conectado";
  if (state.status === "signed_in" && state.email) return "Conectado como " + state.email;
  if (state.status === "error") return state.error || "error de conexión/auth";
  return "No conectado";
}
