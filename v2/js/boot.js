import { ensureJournalSeed } from "./domain/stage.js";
import { downloadExport } from "./services/backup.js";
import { paint, currentRoute, routeList } from "./ui/router.js";

function warnFileProtocol() {
  if (location.protocol === "file:") {
    const bar = document.getElementById("file-warning");
    if (bar) bar.hidden = false;
  }
}

function bindNav() {
  document.querySelectorAll("[data-route]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      location.hash = `#/${link.getAttribute("data-route")}`;
    });
  });
}

export async function boot() {
  warnFileProtocol();
  bindNav();
  const ctx = await ensureJournalSeed();
  const stageLabel = document.getElementById("stage-label");
  if (stageLabel) stageLabel.textContent = ctx.stage.name;
  paint(ctx);
  window.addEventListener("hashchange", () => paint(ctx));
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
