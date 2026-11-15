import { el } from "../render.js";
import { field } from "../forms/observation.js";
import { choiceButtons } from "../forms/choice-buttons.js";
import { createClosedTrade } from "../../domain/trade-journal.js";
import { saveStudy } from "../../domain/observation.js";
import { go } from "../router.js";

export function quickBacktest(ctx) {
  const date = el("input", { className: "input", type: "date", name: "sessionDate", required: true });
  const asset = el("input", { className: "input", name: "asset", placeholder: "NAS100 / MNQ…", required: true });
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
  const status = el("p", { role: "status", text: ctx.route?.query?.saved === "1" ? "Guardado. Ya está en tu historial." : "" });
  const save = el("button", { type: "submit", text: "Guardar backtest" });
  const controls = el("fieldset", { className: "quick-bt-fields" }, [
    el("div", { className: "trade-fields-grid" }, [field("Fecha de sesión histórica", date), field("Activo", asset)]),
    field("Dirección (opcional en NO TRADE)", choiceButtons(direction, "Dirección")),
    field("Resultado", choiceButtons(outcome, "Resultado")), rField,
    el("details", {}, [el("summary", { text: "Notas y capturas (opcional)" }), field("Notas", note), field("Capturas · hasta 6, máximo 8 MB cada una", files)]),
    save,
  ]);
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
      if (outcome.value === "NO_TRADE") {
        await saveStudy({ date: date.value, asset: asset.value, bias: direction.value, studyOutcome: "NO_TRADE", note: note.value }, ctx.stage.id, [...files.files]);
      } else {
        await createClosedTrade({ context: "BACKTEST", sessionDate: date.value, asset: asset.value, direction: direction.value, result: outcome.value, rrRealized: r.value, note: note.value }, ctx.stage.id, [...files.files]);
      }
      controls.disabled = true;
      go("backtesting?saved=1");
    } catch (error) { err.textContent = error.message; save.disabled = false; busy = false; }
  } }, [status, controls, err]);
  return el("section", { className: "panel" }, [el("h2", { text: "Carga rápida de backtesting" }),
    el("p", { className: "hint", text: "WIN / LOSS / BE registra una operación histórica. NO TRADE guarda un estudio, fuera del winrate. R vacío no cuenta como cero." }), form]);
}

