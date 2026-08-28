import { el } from "../render.js";
import { listStageSignals, syncRgmJsonl } from "../../domain/signal.js";
import { Disposition, Resolution, Direction } from "../../domain/enums.js";
import { ROADMAP_ASSETS, RGM_SOURCE_ASSET, RGM_SOURCE_CONTEXT } from "../../config.js";
import { getMeta, putMeta } from "../../storage/repos/meta.js";
import { nowIso } from "../../domain/ids.js";
import { go } from "../router.js";

function qs(query) {
  const parts = [];
  for (const [k, v] of Object.entries(query)) {
    if (v) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  }
  return parts.length ? "?" + parts.join("&") : "";
}

function select(current, options) {
  const node = el("select", { className: "input slim" }, options.map(([v, l]) => el("option", { value: v, text: l })));
  node.value = current || "";
  return node;
}

function labelDisposition(v) {
  if (v === Disposition.SKIPPED_OPEN_POSITION) return "SKIPPED";
  return v;
}

export async function renderSenales(ctx) {
  const q = ctx.route.query || {};
  const filters = {
    asset: q.asset || "",
    direction: q.direction || "",
    disposition: q.disposition || "",
    resolution: q.resolution || "",
    from: q.from || "",
    to: q.to || "",
  };
  const meta = await getMeta();
  const rows = await listStageSignals(ctx.stage.id, filters);
  const asset = select(filters.asset, [["", "asset"], ...ROADMAP_ASSETS.map((a) => [a.id, a.label])]);
  const direction = select(filters.direction, [["", "dir"], ...Object.values(Direction).map((d) => [d, d])]);
  const disposition = select(filters.disposition, [["", "disposition"], ...Object.values(Disposition).map((d) => [d, labelDisposition(d)])]);
  const resolution = select(filters.resolution, [["", "resolution"], ...Object.values(Resolution).map((d) => [d, d])]);
  const from = el("input", { className: "input slim", type: "date", value: filters.from });
  const to = el("input", { className: "input slim", type: "date", value: filters.to });
  function apply() {
    go("senales" + qs({
      asset: asset.value,
      direction: direction.value,
      disposition: disposition.value,
      resolution: resolution.value,
      from: from.value,
      to: to.value,
    }));
  }
  [asset, direction, disposition, resolution, from, to].forEach((n) => n.addEventListener("change", apply));
  const list = rows.length
    ? rows.map((s) => {
      const resClass = s.resolution ? " res-" + String(s.resolution).toLowerCase() : "";
      const item = el("button", { type: "button", className: "row hist" + resClass }, [
        el("span", { text: String(s.printedAt || "").slice(0, 16).replace("T", " ") }),
        el("strong", { text: s.asset }),
        el("span", { text: s.direction }),
        el("span", { text: labelDisposition(s.disposition) }),
        el("span", { text: s.resolution }),
      ]);
      if (s.resolution === Resolution.OPEN) item.className += " is-open";
      item.addEventListener("click", () => go("senal/" + s.id));
      return item;
    })
    : [el("p", { className: "empty", text: "No hay señales en esta etapa." })];
  const rgm = meta && meta.rgmSync ? meta.rgmSync : {};
  const syncFrom = el("input", { className: "input slim", type: "datetime-local", value: rgm.syncFromLocal || "" });
  const file = el("input", { className: "input", type: "file", accept: ".jsonl,.json,.txt,application/json" });
  file.style.display = "none";
  const syncErr = el("p", { className: "err", text: "" });
  const syncBtn = el("button", { type: "button", text: "Sincronizar RGM" });
  syncBtn.addEventListener("click", () => {
    syncErr.textContent = "";
    if (!syncFrom.value) {
      syncErr.textContent = "Definí syncFrom antes de sincronizar.";
      return;
    }
    file.click();
  });
  file.addEventListener("change", async () => {
    const chosen = file.files && file.files[0];
    file.value = "";
    if (!chosen) return;
    if (!syncFrom.value) {
      syncErr.textContent = "Definí syncFrom antes de sincronizar.";
      return;
    }
    try {
      const text = await chosen.text();
      const report = await syncRgmJsonl(text, ctx.stage.id, {
        sourceAsset: RGM_SOURCE_ASSET,
        sourceContext: RGM_SOURCE_CONTEXT,
        syncFrom: new Date(syncFrom.value).toISOString(),
      });
      await putMeta({
        ...meta,
        rgmSync: {
          sourceAsset: RGM_SOURCE_ASSET,
          sourceContext: RGM_SOURCE_CONTEXT,
          fileName: chosen.name,
          syncFrom: report.syncFrom,
          syncFromLocal: syncFrom.value,
          lastSyncAt: nowIso(),
          report,
        },
      });
      go("senales" + qs(filters));
    } catch (e) {
      syncErr.textContent = e.message;
    }
  });
  const report = rgm.report;
  const syncMeta = [
    el("p", { className: "meta", text: `sourceAsset ${RGM_SOURCE_ASSET}` }),
    el("p", { className: "meta", text: `sourceContext ${RGM_SOURCE_CONTEXT}` }),
    el("p", { className: "meta", text: `archivo ${rgm.fileName || "—"}` }),
    el("p", { className: "meta", text: `syncFrom ${rgm.syncFrom || "—"}` }),
    el("p", { className: "meta", text: `última sync ${rgm.lastSyncAt || "—"}` }),
  ];
  if (report) {
    syncMeta.push(el("p", { className: "meta", text: `leídas ${report.read} · nuevas ${report.created} · actualizadas ${report.updated} · duplicadas ${report.duplicates} · inválidas ${report.invalid} · conflictos ${report.conflicts} · excluidas ${report.excluded}` }));
  }
  return [
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: "Universo Desk · stage activa" }),
      el("h1", { text: "Señales" }),
      el("p", { className: "meta", text: "Registro del print. No es el motor RGM. Sin alta manual de producto." }),
      el("div", { className: "chips filters" }, [asset, direction, disposition, resolution, from, to]),
      el("p", { className: "meta", text: `${rows.length} señales` }),
      el("div", { className: "list table-wrap" }, list),
    ]),
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: "RGM · lectura local" }),
      el("h2", { text: "Sincronizar RGM" }),
      el("p", { className: "hint", text: "Elegí shadow-live.jsonl. El Journal solo lee. No escribe ese archivo." }),
      el("label", { className: "field" }, [el("span", { text: "syncFrom" }), syncFrom]),
      file,
      el("div", { className: "row-actions" }, [syncBtn]),
      syncErr,
      ...syncMeta,
    ]),
  ];
}
