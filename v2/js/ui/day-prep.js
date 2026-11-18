// Panel "Preparación de la sesión" en Hoy. Se guarda solo al tocar.
import { el } from "./render.js";
import { PREP_ITEMS, BIAS_OPTIONS, prepDay, getPrep, savePrep } from "../domain/day-prep.js";
import { ymd } from "../domain/plan-rules.js";

export async function dayPrepPanel() {
  const day = prepDay();
  const forTomorrow = day !== ymd(new Date());
  const rec = await getPrep(day);
  const count = el("span", { className: "meta" });
  const refresh = () => { const done = PREP_ITEMS.filter(([k]) => rec[k]).length + (rec.bias ? 1 : 0); count.textContent = `${done}/${PREP_ITEMS.length + 1}`; };
  const save = async (patch) => { Object.assign(rec, patch); refresh(); await savePrep(day, patch); };
  const bias = el("select", { className: "input", name: "prep-bias", "aria-label": "Sesgo de temporalidad alta" }, BIAS_OPTIONS.map(([v, t]) => el("option", { value: v, text: t })));
  bias.value = rec.bias;
  bias.addEventListener("change", () => save({ bias: bias.value }));
  const boxes = PREP_ITEMS.map(([k, text]) => {
    const box = el("input", { type: "checkbox", name: "prep-" + k });
    box.checked = rec[k];
    box.addEventListener("change", () => save({ [k]: box.checked }));
    return el("label", { className: "journal-confirm" }, [box, el("span", { text })]);
  });
  const note = el("textarea", { className: "input", rows: "2", name: "prep-note", placeholder: "Escenarios o niveles clave (opcional)" });
  note.value = rec.note;
  note.addEventListener("change", () => save({ note: note.value }));
  refresh();
  const label = forTomorrow ? `para mañana (${day.split("-").reverse().slice(0, 2).join("/")})` : "de hoy";
  return el("section", { className: "panel day-prep", "aria-label": "Preparación de la sesión" }, [
    el("div", { className: "plan-head" }, [el("h2", { text: `Preparación ${label}` }), count]),
    el("label", { className: "prep-bias" }, [el("span", { text: "Sesgo W / D / 4h" }), bias]),
    el("div", { className: "plan-signals" }, boxes),
    note,
  ]);
}
