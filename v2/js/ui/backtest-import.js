import { el } from "./render.js";
import { go } from "./router.js";
import { MAX_BACKTEST_BYTES, parseBacktest, importBacktest } from "../domain/backtest-import.js";

const labels = { asset: "Activo", direction: "Dirección", openedAt: "Entrada: fecha", closedAt: "Cierre: fecha", entry: "Precio de entrada", initialSL: "SL", tp: "TP", exit: "Precio de salida", netPnl: "PnL monetario", strategy: "Estrategia", result: "Resultado", note: "Notas" };
export function backtestImporter(stageId) {
  const file = el("input", { type: "file", accept: ".json,application/json", style: "max-width:100%", "aria-label": "Archivo JSON de backtest" });
  const error = el("p", { className: "err", role: "alert" });
  const preview = el("div", { "aria-live": "polite" });
  const panel = el("section", { className: "panel", hidden: true, "aria-label": "Importar backtest" }, [
    el("h2", { text: "Importar backtest" }),
    el("p", { className: "hint", text: "Elegí un JSON maca-backtest v1 (un backtest, máximo 64 KB). Revisá la vista previa y confirmá. No se guardará nada al seleccionar el archivo." }),
    el("a", { href: new URL("../../../docs/backtest-example.json", import.meta.url).href, download: "backtest-example.json", text: "Descargar ejemplo JSON" }),
    file, error, preview,
  ]);
  let selection = 0;
  let saving = false;
  file.addEventListener("change", async () => {
    const current = ++selection;
    preview.replaceChildren(); error.textContent = "";
    const selected = file.files?.[0];
    if (!selected) return;
    try {
      if (selected.size > MAX_BACKTEST_BYTES) throw new Error("El archivo supera 64 KB.");
      const text = await selected.text();
      if (current !== selection) return;
      const parsed = parseBacktest(text);
      const b = parsed.backtest;
      const draft = el("input", { type: "checkbox", checked: parsed.missing.length > 0, disabled: parsed.missing.length > 0 });
      const save = el("button", { type: "button", text: "Confirmar y guardar" });
      save.addEventListener("click", async () => {
        if (saving || current !== selection) return;
        saving = true; save.disabled = true; file.disabled = true; error.textContent = "";
        try {
          const trade = await importBacktest(text, stageId, draft.checked);
          preview.replaceChildren(
            el("p", { role: "status", text: trade.isDraft ? "Backtest guardado como borrador." : "Backtest guardado." }),
            el("button", { type: "button", text: "Abrir registro y agregar capturas", onclick: () => go("trade/" + trade.id + "?from=backtesting") }),
            el("button", { type: "button", className: "ghost", text: "Ver historial", onclick: () => go("backtesting") }),
          );
        } catch (e) { error.textContent = e.message; save.disabled = false; }
        finally { saving = false; file.disabled = false; }
      });
      preview.append(
        el("h3", { text: "Vista previa · solo Backtesting · sin cuenta" }),
        el("dl", {}, Object.entries(labels).flatMap(([key, label]) => [el("dt", { text: label }), el("dd", { text: b[key] ?? "Sin completar", style: "white-space:pre-wrap;overflow-wrap:anywhere" })])),
        el("p", { className: "hint", text: parsed.missing.length ? "Se guardará como BORRADOR. Falta completar: " + parsed.missing.join(", ") + ". Los datos desconocidos no se inventan." : "Datos completos. Se puede guardar como cerrado o conservar como borrador." }),
        el("label", {}, [draft, " Guardar como borrador"]),
        el("p", { className: "hint", text: "Después podrás editar el análisis, completar el borrador y adjuntar capturas desde el registro. El resultado declarado se conserva también en el origen del archivo." }),
        save,
      );
    } catch (e) { if (current === selection) error.textContent = e.message; }
  });
  const button = el("button", { type: "button", className: "ghost", text: "Importar backtest", onclick: () => { panel.hidden = false; file.focus(); } });
  panel.append(el("button", { type: "button", className: "ghost", text: "Cerrar importación", onclick: () => {
    if (saving) return;
    ++selection; file.value = ""; preview.replaceChildren(); error.textContent = ""; panel.hidden = true;
  } }));
  return { button, panel };
}
