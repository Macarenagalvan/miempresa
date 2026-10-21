import { el } from "./render.js";
import { go } from "./router.js";
import { readBacktestFile, saveBacktestFile } from "../services/backtest-zip.js";

const labels = { asset: "Activo", direction: "Dirección", openedAt: "Entrada: fecha", closedAt: "Cierre: fecha", entry: "Precio de entrada", initialSL: "SL", tp: "TP", exit: "Precio de salida", netPnl: "PnL monetario", strategy: "Estrategia", result: "Resultado", note: "Notas" };
export function backtestImporter(stageId) {
  const file = el("input", { type: "file", accept: ".json,.zip,application/json,application/zip", style: "max-width:100%", "aria-label": "Archivo JSON o ZIP de backtest" });
  const error = el("p", { className: "err", role: "alert" });
  const preview = el("div", { "aria-live": "polite" });
  const panel = el("section", { className: "panel", hidden: true, "aria-label": "Importar backtest" }, [
    el("h2", { text: "Importar backtest" }),
    el("p", { className: "hint", text: "Elegí un JSON (máximo 64 KB) o un ZIP (máximo 25 MB) con el JSON y hasta 8 capturas PNG, JPG o WEBP. Revisá los datos y las imágenes antes de confirmar. Seleccionar el archivo no guarda nada." }),
    el("p", {}, [el("a", { href: new URL("../../../docs/backtest-example.json", import.meta.url).href, download: "backtest-example.json", text: "Descargar ejemplo JSON" })]),
    el("p", {}, [el("a", { href: new URL("../../../docs/IMPORTAR-BACKTEST-ZIP.md", import.meta.url).href, target: "_blank", rel: "noopener", text: "Formato del ZIP y límites" })]),
    el("p", {}, [el("a", { href: new URL("../../../docs/backtest-example.zip", import.meta.url).href, download: "backtest-example.zip", text: "Descargar ejemplo ZIP ficticio" })]),
    file, error, preview,
  ]);
  let selection = 0;
  let saving = false;
  const urls = new Set();
  const clearImages = () => { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); };
  const observer = new MutationObserver(() => { if (!panel.isConnected) { clearImages(); observer.disconnect(); } });
  file.addEventListener("change", async () => {
    const current = ++selection;
    clearImages(); preview.replaceChildren(); error.textContent = "";
    const selected = file.files?.[0];
    if (!selected) return;
    file.disabled = true;
    try {
      const bundle = await readBacktestFile(selected);
      if (current !== selection) return;
      const parsed = bundle.parsed;
      if (panel.isConnected) observer.observe(document.documentElement, { childList: true, subtree: true });
      const b = parsed.backtest;
      const draft = el("input", { type: "checkbox", checked: parsed.missing.length > 0, disabled: parsed.missing.length > 0 });
      const save = el("button", { type: "button", text: "Confirmar y guardar" });
      save.addEventListener("click", async () => {
        if (saving || current !== selection) return;
        saving = true; save.disabled = true; file.disabled = true; error.textContent = "";
        try {
          const trade = await saveBacktestFile(bundle, stageId, draft.checked);
          clearImages();
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
        ...(bundle.images.length ? [
          el("h3", { text: `Capturas incluidas (${bundle.images.length})` }),
          el("div", { className: "thumb-row" }, bundle.images.map(image => {
            const url = URL.createObjectURL(image.blob); urls.add(url);
            const release = () => { URL.revokeObjectURL(url); urls.delete(url); };
            return el("figure", { className: "thumb-card", style: "max-width:100%;margin:0" }, [
              el("img", { className: "thumb", src: url, alt: image.name, onload: release, onerror: release }),
              el("figcaption", { className: "meta", text: `${image.phase === "BEFORE" ? "ANTES · " : image.phase === "AFTER" ? "DESPUÉS · " : ""}${image.name} · ${image.width} × ${image.height}`, style: "overflow-wrap:anywhere" }),
            ]);
          })),
          el("p", { className: "hint", text: "Al confirmar se guardarán el backtest y todas estas capturas juntos. Si algo falla, no se guardará ninguno." }),
        ] : []),
        save,
      );
    } catch (e) { if (current === selection) error.textContent = e.message; }
    finally { file.disabled = false; }
  });
  const button = el("button", { type: "button", className: "ghost", text: "Importar backtest", onclick: () => { panel.hidden = false; file.focus(); } });
  panel.append(el("button", { type: "button", className: "ghost", text: "Cerrar importación", onclick: () => {
    if (saving) return;
    ++selection; clearImages(); observer.disconnect(); file.value = ""; preview.replaceChildren(); error.textContent = ""; panel.hidden = true;
  } }));
  return { button, panel };
}
