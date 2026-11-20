import { ensureJournalSeed } from "./domain/stage.js";
import { downloadExport } from "./services/backup.js";
import { restoreAuthSession } from "./services/auth.js";
import {
  ensureDeviceState,
  bootstrapFromCloudIfEmpty,
  discardVirginSeedIfCloudHasJournal,
  bindNetworkSync,
  syncNow,
} from "./services/sync-engine.js";
import { paint, currentRoute, routeList, go } from "./ui/router.js";
import { applyIdentity } from "./ui/identity.js";
import { bindDecimalFix } from "./ui/decimal.js";

function retireLegacyWorkers() {
  if (navigator.serviceWorker) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => { reg.unregister(); });
    }).catch(() => {});
  }
  if (window.caches && caches.keys) {
    caches.keys().then((keys) => keys.forEach((key) => caches.delete(key))).catch(() => {});
  }
}

function warnFileProtocol() {
  if (location.protocol === "file:") {
    const bar = document.getElementById("file-warning");
    if (bar) bar.hidden = false;
  }
}

function closeNav() {
  document.body.classList.remove("nav-open");
  const toggle = document.getElementById("nav-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "false");
  const backdrop = document.getElementById("nav-backdrop");
  if (backdrop) backdrop.hidden = true;
}

function openNav() {
  document.body.classList.add("nav-open");
  const toggle = document.getElementById("nav-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "true");
  const backdrop = document.getElementById("nav-backdrop");
  if (backdrop) backdrop.hidden = false;
}

function bindNav() {
  document.querySelectorAll("[data-route]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      location.hash = `#/${link.getAttribute("data-route")}`;
      closeNav();
    });
  });
  const toggle = document.getElementById("nav-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      if (document.body.classList.contains("nav-open")) closeNav();
      else openNav();
    });
  }
  const backdrop = document.getElementById("nav-backdrop");
  if (backdrop) backdrop.addEventListener("click", closeNav);
}

bindDecimalFix();

function bindQuickActions() {
  document.querySelectorAll("[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => { closeNav(); go(btn.getAttribute("data-go")); });
  });
  const keys = { n: "nuevo/trade", b: "backtesting?quick=bt", t: "backtesting?quick=nt", h: "hoy" };
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const target = event.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (document.querySelector("dialog[open]")) return;
    const route = keys[event.key.toLowerCase()];
    if (!route) return;
    event.preventDefault();
    go(route);
  });
}

export async function boot() {
  warnFileProtocol();
  retireLegacyWorkers();
  bindNav();
  bindQuickActions();
  await ensureDeviceState();
  await restoreAuthSession().catch(() => {});
  const pulled = await bootstrapFromCloudIfEmpty().catch(() => ({ applied: false }));
  if (!pulled || !pulled.applied) {
    await discardVirginSeedIfCloudHasJournal().catch(() => {});
  }
  const ctx = await ensureJournalSeed();
  applyIdentity(ctx.meta, ctx.stage);
  bindNetworkSync();
  syncNow({ reason: "boot" }).catch(() => {});
  await paint(ctx);
  window.addEventListener("hashchange", () => {
    closeNav();
    paint(ctx).catch((err) => console.error(err));
  });
  const exportBtn = document.getElementById("export-backup");
  if (exportBtn) {
    exportBtn.addEventListener("click", async () => {
      exportBtn.disabled = true;
      try {
        await downloadExport();
      } finally {
        exportBtn.disabled = false;
      }
    });
  }
  return { ctx, route: currentRoute(), routes: Object.keys(routeList()) };
}

boot().catch((err) => {
  const main = document.getElementById("app");
  if (main) main.textContent = `Error de arranque: ${err.message}`;
  console.error(err);
});
