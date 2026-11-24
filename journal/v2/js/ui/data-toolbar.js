// Barra de datos siempre visible: exportar (Excel / CSV) e importar (CSV / Excel).
import { el } from "./render.js";
import { toast } from "./feedback.js";
import { exportRecords, downloadBacktestTemplate, readBacktestTable } from "../services/table-io.js";
import { classifyBacktestItems, countItems, importBacktestItems } from "../domain/backtest-table-import.js";

function icon(paths) {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) s.setAttribute(k, v);
  for (const d of paths) { const p = document.createElementNS(ns, "path"); p.setAttribute("d", d); s.append(p); }
  return s;
}
const ICON_DOWN = ["M12 4v11", "M7 10l5 5 5-5", "M5 20h14"];
const ICON_UP = ["M12 20V9", "M7 14l5-5 5 5", "M5 4h14"];
const ICON_SHEET = ["M5 3h10l4 4v14H5z", "M9 12h6M9 16h6M9 8h2"];

function toolButton(text, paths, onclick, extra = "") {
  return el("button", { type: "button", className: "tool-btn " + extra, onclick }, [icon(paths), el("span", { text })]);
}

/**
 * getData: async () => ({ trades, studies, accounts })
 * kind: "operaciones" | "backtests"
 * stageId: necesario para importar backtests
 */
export function dataToolbar({ getData, kind, stageId = null, extra = [] }) {
  const run = (format) => async () => {
    try {
      const data = await getData();
      const total = data.trades.length + (data.studies?.length || 0);
      if (!total) { toast("No hay registros para exportar con este filtro."); return; }
      const n = exportRecords({ ...data, kind, format });
      toast(`${format === "xlsx" ? "Excel" : "CSV"} descargado · ${n} registro${n === 1 ? "" : "s"}.`, { tone: "ok" });
    } catch (e) { toast("No se pudo exportar: " + e.message, { tone: "error", timeout: 6000 }); }
  };
  const buttons = [
    ...extra,
    toolButton("Descargar Excel", ICON_DOWN, run("xlsx")),
    toolButton("Descargar CSV", ICON_DOWN, run("csv")),
  ];
  if (kind === "backtests" && stageId) {
    const file = el("input", { type: "file", accept: ".csv,.xlsx,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", hidden: true });
    file.addEventListener("change", () => { const f = file.files?.[0]; file.value = ""; if (f) openImportDialog(f, stageId); });
    buttons.push(
      toolButton("Importar CSV / Excel", ICON_UP, () => file.click()),
      toolButton("Plantilla", ICON_SHEET, () => downloadBacktestTemplate(), "is-quiet"),
      file,
    );
  }
  return el("div", { className: "data-toolbar", role: "toolbar", "aria-label": "Exportar e importar" }, buttons);
}

const STATUS = {
  new: ["Nuevo", "is-new"],
  dup: ["Repetido", "is-dup"],
  error: ["Con error", "is-error"],
  skip: ["Omitido", "is-skip"],
};

async function openImportDialog(file, stageId) {
  let items;
  try {
    items = await classifyBacktestItems(await readBacktestTable(file), stageId);
  } catch (e) {
    toast(e.message, { tone: "error", timeout: 7000 });
    return;
  }
  const counts = countItems(items);
  const includeDup = el("input", { type: "checkbox" });
  const confirm = el("button", { type: "button", text: "" });
  const cancel = el("button", { type: "button", className: "ghost", text: "Cancelar" });
  const err = el("p", { className: "err", role: "alert" });
  const paint = () => {
    const n = counts.new + (includeDup.checked ? counts.dup : 0);
    confirm.textContent = n ? `Importar ${n} registro${n === 1 ? "" : "s"}` : "Nada para importar";
    confirm.disabled = n === 0;
  };
  includeDup.addEventListener("change", paint);
  paint();
  const table = el("div", { className: "import-table" }, [
    el("div", { className: "import-tr is-head" }, ["Fila", "Fecha", "Activo", "Dir.", "Resultado", "R", "Estado"].map((t) => el("span", { text: t }))),
    ...items.slice(0, 300).map((i) => el("div", { className: "import-tr " + STATUS[i.status][1] }, [
      el("span", { text: String(i.line) }),
      el("span", { text: i.data.date || "—" }),
      el("strong", { text: i.data.asset || "—" }),
      el("span", { text: i.data.direction || "—" }),
      el("span", { text: i.data.result === "NO_TRADE" ? "NO TRADE" : (i.data.result || "—") }),
      el("span", { className: "num", text: i.data.r == null ? "—" : String(i.data.r) }),
      el("span", { className: "import-status", title: [...(i.issues || []), ...(i.notes || [])].join(" · ") }, [
        el("b", { text: STATUS[i.status][0] }),
        (i.issues?.length || i.notes?.length) ? el("small", { text: [...(i.issues || []), ...(i.notes || [])].join(" · ") }) : null,
      ]),
    ])),
  ]);
  const dialog = el("dialog", { className: "rgm-dialog is-wide", "aria-labelledby": "imp-title" }, [
    el("h2", { id: "imp-title", text: "Revisá antes de importar" }),
    el("p", { className: "hint", text: file.name }),
    el("div", { className: "import-kpis" }, [
      el("span", { className: "is-new", text: `${counts.new} nuevos` }),
      el("span", { className: "is-dup", text: `${counts.dup} repetidos` }),
      el("span", { className: "is-error", text: `${counts.error} con error` }),
      counts.skip ? el("span", { className: "is-skip", text: `${counts.skip} omitidos` }) : null,
    ]),
    counts.dup ? el("label", { className: "import-dup-opt" }, [includeDup, el("span", { text: "Importar también los repetidos (no recomendado)" })]) : null,
    counts.error ? el("p", { className: "hint", text: "Las filas con error no se importan. Corregilas en el archivo y volvé a importarlo: lo ya cargado se detecta como repetido." }) : null,
    table,
    items.length > 300 ? el("p", { className: "hint", text: `Mostrando 300 de ${items.length} filas.` }) : null,
    err,
    el("div", { className: "row-actions" }, [cancel, confirm]),
  ]);
  const close = () => { try { dialog.close(); } catch (_) { /* */ } dialog.remove(); };
  let busy = false;
  cancel.addEventListener("click", () => { if (!busy) close(); });
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); if (!busy) close(); });
  confirm.addEventListener("click", async () => {
    if (busy) return;
    busy = true; confirm.disabled = cancel.disabled = true; confirm.textContent = "Importando…"; err.textContent = "";
    try {
      const report = await importBacktestItems(items, stageId, { includeDuplicates: includeDup.checked });
      close();
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      const parts = [`${report.created} backtest${report.created === 1 ? "" : "s"}`];
      if (report.studies) parts.push(`${report.studies} NO TRADE`);
      toast(`Importado: ${parts.join(" y ")}.` + (report.failed.length ? ` ${report.failed.length} fallaron (fila ${report.failed.map((f) => f.line).join(", ")}).` : ""), { tone: report.failed.length ? "error" : "ok", timeout: 6000 });
    } catch (e) {
      err.textContent = e.message; busy = false; cancel.disabled = false; paint();
    }
  });
  document.body.append(dialog);
  dialog.showModal();
}
