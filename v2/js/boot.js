import { ensureJournalSeed } from "./domain/stage.js";
import { downloadExport } from "./services/backup.js";
import { paint, currentRoute, routeList } from "./ui/router.js";

function warnFileProtocol() {
  if (location.protocol === "file:") {
    const bar = document.getElementById("file-warning");
    if (bar) bar.hidden = false;
  }
}

function closeNav() {
  document.body.classList.remove("nav-open");
  const backdrop = document.getElementById("nav-backdrop");
  if (backdrop) backdrop.hidden = true;
}

function openNav() {
  document.body.classList.add("nav-open");
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

export async function boot() {
  warnFileProtocol();
  bindNav();
  const ctx = await ensureJournalSeed();
  const stageLabel = document.getElementById("stage-label");
  if (stageLabel) stageLabel.textContent = ctx.stage.name;
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
