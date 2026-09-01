import { SCHEMA_VERSION, STORES, DB_VERSION } from "../js/config.js";
import { listStoreNames } from "../js/storage/db.js";
import { ensureJournalSeed } from "../js/domain/stage.js";
import { getMeta } from "../js/storage/repos/meta.js";
import { countCollection } from "../js/storage/repos/collections.js";
import { renderSistema } from "../js/ui/screens/sistema.js";
import {
  setAuthClient,
  resetAuthRuntime,
  getAuthState,
  signInWithPassword,
  signOut,
  restoreAuthSession,
  assertClientKeySafe,
  authLabel,
  saveSupabaseConfig,
  readSupabaseConfig,
} from "../js/services/auth.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../js/supabase-config.js";

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, ok: Boolean(cond), detail });
  if (!cond) console.error("FAIL", name, detail);
}

function createMemoryAuthClient(initial = null) {
  let session = initial;
  return {
    auth: {
      async getSession() {
        return { data: { session }, error: null };
      },
      async signInWithPassword({ email, password }) {
        if (!email || !password) {
          return { data: { session: null }, error: { message: "Invalid login credentials" } };
        }
        session = { user: { id: "00000000-0000-4000-8000-000000000001", email }, access_token: "mock" };
        return { data: { session }, error: null };
      },
      async signOut() {
        session = null;
        return { error: null };
      },
    },
  };
}

async function scanClientSources() {
  const paths = [
    "../js/services/auth.js",
    "../js/supabase-config.js",
    "../js/boot.js",
    "../js/config.js",
    "../js/ui/screens/sistema.js",
    "../../index.html",
  ];
  const blobs = [];
  for (const path of paths) {
    const res = await fetch(path);
    blobs.push(await res.text());
  }
  return blobs.join("\n");
}

async function run() {
  resetAuthRuntime();
  const seed = await ensureJournalSeed();
  const names = await listStoreNames();

  assert("schema local sigue 2", SCHEMA_VERSION === 2 && DB_VERSION === 2);
  assert("meta.schemaVersion 2", seed.meta.schemaVersion === 2);
  assert("no store syncState", !names.includes("syncState") && STORES.syncState == null);
  assert("no store syncLedger", !names.includes("syncLedger") && STORES.syncLedger == null);
  assert("no store syncConflicts", !names.includes("syncConflicts") && STORES.syncConflicts == null);
  assert("stores = schema 2", JSON.stringify([...names].sort()) === JSON.stringify(Object.values(STORES).sort()));

  assert("config committed vacía", SUPABASE_URL === "" && SUPABASE_PUBLISHABLE_KEY === "");
  let banned = false;
  try {
    assertClientKeySafe("eyJhbGciOi.service_role.xxx");
  } catch (e) {
    banned = /no puede usarse/.test(e.message);
  }
  assert("rechaza key privilegiada en cliente", banned);

  const src = await scanClientSources();
  const privileged = ["serv", "ice_", "role"].join("");
  assert("cliente sin rol de servicio", src.indexOf(privileged) === -1);
  assert("cliente sin secret key", !/secret[_-]?key/i.test(src));

  const unsigned = createMemoryAuthClient(null);
  setAuthClient(unsigned);
  try {
    localStorage.setItem("journalV2.supabaseUrl", "https://example.supabase.co");
    localStorage.setItem("journalV2.supabasePublishableKey", "pub-test-key");
  } catch (_) { /* ignore */ }

  const signedOut = await getAuthState();
  assert("estado signed_out", signedOut.status === "signed_out");
  assert("label no conectado", authLabel(signedOut) === "No conectado");

  const hostOutUi = document.createElement("div");
  hostOutUi.append(...[].concat(await renderSistema(seed)).filter(Boolean));
  const panel = hostOutUi.querySelector("#sincronizacion");
  assert("UI no autenticada panel", Boolean(panel));
  assert("UI no autenticada copy", Boolean(panel && panel.textContent.includes("No conectado")));
  assert("UI login email", Boolean(panel && panel.querySelector(".sync-email")));
  assert("UI login password", Boolean(panel && panel.querySelector(".sync-password")));
  assert("UI sin sync real", Boolean(panel && panel.querySelector(".sync-now") && panel.querySelector(".sync-now").disabled));
  assert("UI explica sync pendiente", Boolean(panel && panel.textContent.includes("Disponible después de activar la sincronización.")));

  const beforeMeta = JSON.stringify(await getMeta());
  const beforeTrades = await countCollection("trades");
  const beforeTasks = await countCollection("officeTasks");
  const login = await signInWithPassword("maca@example.com", "pass-test");
  assert("login mock ok", login.ok === true && login.state.status === "signed_in");
  assert("login email", login.state.email === "maca@example.com");
  const afterMeta = JSON.stringify(await getMeta());
  assert("login no muta meta", beforeMeta === afterMeta);
  assert("login no muta trades", (await countCollection("trades")) === beforeTrades);
  assert("login no muta officeTasks", (await countCollection("officeTasks")) === beforeTasks);

  const restored = await restoreAuthSession();
  assert("sesión restaurable", restored.status === "signed_in" && restored.email === "maca@example.com");

  const hostIn = document.createElement("div");
  hostIn.append(...[].concat(await renderSistema(seed)).filter(Boolean));
  const panelIn = hostIn.querySelector("#sincronizacion");
  assert("UI autenticada copy", Boolean(panelIn && panelIn.textContent.includes("Conectado como maca@example.com")));
  assert("UI logout", Boolean(panelIn && panelIn.querySelector(".sync-logout")));
  assert("UI autenticada sin password", !panelIn.querySelector(".sync-password"));
  assert("sync now sigue disabled", Boolean(panelIn.querySelector(".sync-now") && panelIn.querySelector(".sync-now").disabled));

  const out = await signOut();
  assert("logout signed_out", out.status === "signed_out" || out.status === "missing_config");
  const afterOut = await getAuthState();
  assert("logout limpia sesión", afterOut.status !== "signed_in");

  resetAuthRuntime();
  try {
    localStorage.removeItem("journalV2.supabaseUrl");
    localStorage.removeItem("journalV2.supabasePublishableKey");
  } catch (_) { /* ignore */ }
  const missing = await getAuthState();
  assert("sin config = missing_config", missing.status === "missing_config");

  const cfgRound = { url: "https://proj.supabase.co", publishableKey: "anon-public" };
  saveSupabaseConfig(cfgRound);
  const readBack = readSupabaseConfig();
  assert("config localStorage redonda", readBack.url === cfgRound.url && readBack.publishableKey === cfgRound.publishableKey);
  try {
    localStorage.removeItem("journalV2.supabaseUrl");
    localStorage.removeItem("journalV2.supabasePublishableKey");
  } catch (_) { /* ignore */ }

  const failed = results.filter((r) => !r.ok);
  const hostOut = document.getElementById("out");
  if (hostOut) {
    const prev = hostOut.textContent ? hostOut.textContent + "\n" : "";
    const lines = results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
    lines.push("");
    lines.push(failed.length ? `slice19 ${failed.length} fallos` : `slice19 ${results.length} tests OK`);
    hostOut.textContent = prev + lines.join("\n");
    if (failed.length) hostOut.className = "fail";
  }
  console.log(results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.name}`).join("\n"));
  if (failed.length) throw new Error(`${failed.length} tests slice19 fallaron`);
}

export { run };
