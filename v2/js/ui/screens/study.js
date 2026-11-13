import { el } from "../render.js";
import { field } from "../forms/observation.js";
import { choiceButtons } from "../forms/choice-buttons.js";
import { quickRegister } from "../quick-register.js";
import { saveStudy } from "../../domain/observation.js";
import { listStudyImages } from "../../storage/repos/attachments.js";
import { reverseHistoricalStudy, studyOutcomeLabel } from '../../domain/historical-study.js';
import { historicalCaptures } from './historical-recovery.js';
import { SESSIONS } from "../../config.js";
import { go } from "../router.js";

function pick(name, options, value) {
  const control = el("select", { name }, options.map(([v, text]) => el("option", { value: v, text })));
  control.value = value;
  return control;
}

export async function renderStudy(ctx, current = null) {
  if (current?.recovery && current.archived) return [el('section', { className: 'panel' }, [
    el('h1', { text: current.asset + ' · estudio conservado' }),
    el('p', { text: 'Conversión revertida. Este estudio permanece como historial y no cuenta en las estadísticas.' }),
    el('p', { text: (current.date || 'Fecha desconocida') + ' · ' + studyOutcomeLabel(current.studyOutcome) }),
    el('p', { text: current.note || 'Sin notas.' }), historicalCaptures(await listStudyImages(current)),
    el('a', { href: '#/trade/' + current.recovery.tradeId, text: 'Abrir original recuperado' }),
  ])];
  const asset = el("input", { className: "input", name: "asset", value: current?.asset || "", placeholder: "NAS100 / MNQ…" });
  const date = el("input", { className: "input", type: "date", name: "studyDate", value: current?.date || "" });
  const note = el("textarea", { className: "input", name: "note", rows: 4 });
  note.value = current?.note || "";
  const outcome = pick("studyOutcome", [["NO_TRADE", "NO TRADE"], ["TRADE_TAKEN", "Hubo entrada (estudio)"], ["UNREVIEWED", "SIN EVALUAR"]], current?.studyOutcome || "NO_TRADE");
  const bias = pick("bias", [["", "Sin definir"], ["LONG", "LONG"], ["SHORT", "SHORT"], ["NEUTRAL", "NEUTRAL"]], current?.bias || "");
  const session = pick("session", [["", "Sin definir"], ...SESSIONS.map(s => [s, s])], current?.session || "");
  const file = el("input", { className: "input", type: "file", name: "study-images", multiple: true, accept: "image/png,image/jpeg,image/webp" });
  const err = el("p", { className: "err", role: "alert" });
  const save = el("button", { type: "button", text: current ? "Guardar cambios" : "Guardar estudio" });
  save.addEventListener("click", async () => {
    if (save.disabled) return;
    save.disabled = true; err.textContent = "";
    try {
      const record = await saveStudy({ asset: asset.value, date: date.value, note: note.value,
        expectedUpdatedAt: current?.updatedAt,
        studyOutcome: outcome.value, bias: bias.value, session: session.value }, ctx.stage.id, [...file.files], current?.id);
      go("observacion/" + record.id);
    } catch (error) { err.textContent = error.message; save.disabled = false; }
  });
  const images = current ? await listStudyImages(current) : [];
  const recoveryNodes = [];
  if (current?.recovery) {
    const recovery = current.recovery;
    const reverse = el('button', { type: 'button', className: 'ghost', text: 'Revertir conversión' });
    reverse.onclick = async () => {
      if (!window.confirm('Recuperar el original como registro pendiente de clasificar? El estudio y sus notas nuevas se conservarán como historial.')) return;
      reverse.disabled = true;
      try { go('trade/' + await reverseHistoricalStudy(current.id, current.updatedAt)); }
      catch (e) { err.textContent = e.message; reverse.disabled = false; }
    };
    recoveryNodes.push(el('p', { className: 'hint', text: 'Estudio histórico recuperado. El original y sus capturas permanecen protegidos. Fecha original: ' + (recovery.dateProvenance.date || 'desconocida') + '. Procedencia: ' + (recovery.originalTrade.sourceRef?.importId || recovery.originalTrade.recordSource) }),
      el('button', { type: 'button', className: 'ghost', text: 'Ver original vinculado', onclick: () => go('trade/' + recovery.tradeId) }), reverse);
  }
  const thumbs = images.map(image => {
    if (!(image.blob instanceof Blob) || !image.blob.size) return el('p', { className: 'err', text: 'Captura no disponible: ' + (image.name || image.id) });
    const src = URL.createObjectURL(image.blob);
    const img = el("img", { className: "thumb", src, alt: image.name || "Captura del estudio" });
    img.addEventListener("load", () => URL.revokeObjectURL(src), { once: true });
    return el("div", { className: "thumb-card" }, [img, el("p", { text: image.name || "Captura" })]);
  });
  return [el("section", { className: "panel form" }, [
    quickRegister(), el("h1", { text: "Estudio / NO TRADE" }),
    ...recoveryNodes,
    el("p", { className: "hint", text: "Un estudio no suma al winrate. Si hubo ejecución, registrá el trade por separado. No se crean fechas ni operaciones automáticamente." }),
    field("Activo", asset), field("Fecha de sesión histórica", date),
    field("Resultado del estudio", choiceButtons(outcome, "Resultado del estudio")),
    field("Sesgo", choiceButtons(bias, "Sesgo")), field("Sesión", choiceButtons(session, "Sesión")),
    field("Notas y aprendizaje", note), el("div", { className: "thumb-row" }, thumbs),
    field("Capturas (hasta 6 por guardado, 8 MB cada una)", file), err, save,
    el("button", { type: "button", className: "ghost", text: "Volver a Backtesting", onclick: () => go("backtesting") }),
  ])];
}
