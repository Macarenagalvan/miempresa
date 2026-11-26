import { el } from "../render.js";
import { field } from "../forms/observation.js";
import { choiceButtons } from "../forms/choice-buttons.js";
import { createClosedTrade } from "../../domain/trade-journal.js";
import { saveStudy } from "../../domain/observation.js";
import { go } from "../router.js";
import { confirmDialog, toast } from "../feedback.js";
import { findSimilarQuickBacktest, findSimilarStudy, describeRecord } from "../../domain/duplicates.js";
import { deleteTrades } from "../../domain/trade-delete.js";
import { archiveObservation } from "../../domain/observation.js";
import { captureDrop } from "../capture-drop.js";
import { processFields } from "../forms/process-fields.js";
import { setTradeProcess, normalizeProcess } from "../../domain/process.js";

const LAST_KEY = "rgm.quickBacktest.last";
function readLast() {
  try { return JSON.parse(localStorage.getItem(LAST_KEY) || "{}") || {}; } catch (_) { return {}; }
}
function writeLast(value) {
  try { localStorage.setItem(LAST_KEY, JSON.stringify(value)); } catch (_) { /* almacenamiento no disponible */ }
}

export function quickBacktest(ctx) {
  const last = readLast();
  const date = el("input", { className: "input", type: "date", name: "sessionDate", required: true, value: last.date || "" });
  const asset = el("input", { className: "input", name: "asset", placeholder: "NAS100 / MNQ…", required: true, value: last.asset || "" });
  const pick = (name, values) => el("select", { name }, values.map(v => el("option", { value: v, text: v === "NO_TRADE" ? "NO TRADE" : v })));
  const direction = pick("direction", ["LONG", "SHORT"]);
  direction.selectedIndex = -1;
  const outcome = pick("result", ["WIN", "LOSS", "BE", "NO_TRADE"]);
  outcome.selectedIndex = -1;
  const r = el("input", { className: "input", name: "rrRealized", type: "number", step: "any", placeholder: "Ej.: 2 o -1" });
  const rField = field("Resultado en R (opcional)", r);
  const note = el("textarea", { className: "input", name: "note", rows: 2 });
  const files = el("input", { type: "file", name: "captures", multiple: true, accept: "image/png,image/jpeg,image/webp" });
  const err = el("p", { className: "err", role: "alert" });
  const status = el("p", { role: "status", text: "" });
  const save = el("button", { type: "submit", text: "Guardar backtest" });
  const proc = processFields(null, { emotion: false, errors: true });
  const procBox = el("details", { className: "quick-process" }, [el("summary", { text: "Setup, confluencias y plan (opcional)" }), proc.node]);
  const controls = el("fieldset", { className: "quick-bt-fields" }, [
    el("div", { className: "trade-fields-grid" }, [field("Fecha de sesión histórica", date), field("Activo", asset)]),
    field("Dirección (opcional en NO TRADE)", choiceButtons(direction, "Dirección")),
    field("Resultado", choiceButtons(outcome, "Resultado")), rField,
    field("Captura (opcional) · hasta 6", captureDrop(files, { label: "Captura del backtest" })),
    procBox,
    el("details", {}, [el("summary", { text: "Notas (opcional)" }), field("Notas", note)]),
    save,
  ]);
  const quickMode = ctx.route?.query?.quick;
  if (quickMode === "nt") outcome.value = "NO_TRADE";
  if (quickMode) {
    setTimeout(() => {
      const form = document.querySelector("form.quick-bt");
      if (!form) return;
      form.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      (date.value ? (asset.value ? (quickMode === "nt" ? note : null) : asset) : date)?.focus?.();
      outcome.dispatchEvent(new Event("change"));
    }, 60);
  }
  outcome.addEventListener("change", () => {
    rField.hidden = outcome.value === "NO_TRADE";
    save.textContent = outcome.value === "NO_TRADE" ? "Guardar estudio" : "Guardar backtest";
  });
  let busy = false;
  const form = el("form", { className: "quick-bt", onsubmit: async event => {
    event.preventDefault();
    if (busy) return;
    busy = true; save.disabled = true; err.textContent = ""; status.textContent = "";
    try {
      if (!outcome.value) throw new Error("Elegí WIN, LOSS, BE o NO TRADE.");
      if (outcome.value !== "NO_TRADE" && !direction.value) throw new Error("Elegí LONG o SHORT.");
      if (!date.value) throw new Error("Elegí la fecha de la sesión.");
      if (!asset.value.trim()) throw new Error("Completá el activo.");
      if (outcome.value === "LOSS" && Number(r.value) > 0) r.value = String(-Number(r.value));
      const similar = outcome.value === "NO_TRADE"
        ? await findSimilarStudy(ctx.stage.id, { date: date.value, asset: asset.value })
        : await findSimilarQuickBacktest({ sessionDate: date.value, asset: asset.value, direction: direction.value, result: outcome.value, rrRealized: r.value });
      if (similar) {
        const ok = await confirmDialog({
          title: "Parece repetido",
          body: ["Ya tenés un registro igual:", el("p", { className: "rgm-dialog-target", text: describeRecord(similar) }), "¿Lo guardo igual?"],
          confirmText: "Guardar igual",
          cancelText: "No, revisar",
        });
        if (!ok) { save.disabled = false; busy = false; return; }
      }
      let undo;
      if (outcome.value === "NO_TRADE") {
        const study = await saveStudy({ date: date.value, asset: asset.value, bias: direction.value, studyOutcome: "NO_TRADE", note: note.value }, ctx.stage.id, [...files.files]);
        undo = () => archiveObservation(study.id);
      } else {
        const trade = await createClosedTrade({ context: "BACKTEST", sessionDate: date.value, asset: asset.value, direction: direction.value, result: outcome.value, rrRealized: r.value, note: note.value }, ctx.stage.id, [...files.files]);
        if (normalizeProcess(proc.read())) await setTradeProcess(trade.id, proc.read());
        undo = async () => { await deleteTrades(trade.id); };
      }
      writeLast({ date: date.value, asset: asset.value.trim().toUpperCase() });
      controls.disabled = true;
      go("backtesting" + (outcome.value === "NO_TRADE" ? "?quick=nt" : ""));
      toast(outcome.value === "NO_TRADE" ? "NO TRADE guardado." : `Backtest guardado · ${outcome.value}${r.value ? " · R " + r.value : ""}.`, {
        tone: "ok", actionText: "Deshacer", timeout: 7000,
        onAction: async () => { await undo(); window.dispatchEvent(new HashChangeEvent("hashchange")); toast("Deshecho.", { timeout: 2000 }); },
      });
    } catch (error) { err.textContent = error.message; save.disabled = false; busy = false; }
  } }, [status, controls, err]);
  return el("section", { className: "panel" }, [el("h2", { text: "Carga rápida de backtesting" }),
    form]);
}

