import { WouldDoSame, ErrorTag } from "../../domain/enums.js";
import { el } from "../render.js";
import { field } from "./observation.js";

function select(current, options, placeholder) {
  const nodes = [];
  if (placeholder != null) nodes.push(el("option", { value: "", text: placeholder }));
  for (const [value, label] of options) nodes.push(el("option", { value, text: label }));
  const node = el("select", { className: "input" }, nodes);
  node.value = current || "";
  return node;
}

export function asrFields(asr) {
  const would = select(
    asr && asr.wouldDoSame,
    [
      [WouldDoSame.YES, "YES"],
      [WouldDoSame.NO, "NO"],
      [WouldDoSame.PARTLY, "PARTLY"],
    ],
    "elegir",
  );
  const conclusion = el("textarea", { className: "input", rows: "3" });
  conclusion.value = (asr && asr.conclusion) || "";
  const errorTag = select(
    asr && asr.errorTag,
    Object.values(ErrorTag).map((t) => [t, t]),
    "sin tag",
  );
  const processNote = el("textarea", { className: "input", rows: "2" });
  processNote.value = (asr && asr.processNote) || "";
  const executionNote = el("textarea", { className: "input", rows: "2" });
  executionNote.value = (asr && asr.executionNote) || "";
  const riskNote = el("textarea", { className: "input", rows: "2" });
  riskNote.value = (asr && asr.riskNote) || "";
  const psychologyNote = el("textarea", { className: "input", rows: "2" });
  psychologyNote.value = (asr && asr.psychologyNote) || "";
  return {
    nodes: [
      field("¿Lo haría igual?", would),
      field("Conclusión", conclusion),
      field("errorTag (opcional)", errorTag),
      field("Proceso", processNote),
      field("Ejecución", executionNote),
      field("Riesgo", riskNote),
      field("Psicología", psychologyNote),
    ],
    read() {
      return {
        wouldDoSame: would.value,
        conclusion: conclusion.value,
        errorTag: errorTag.value || null,
        processNote: processNote.value,
        executionNote: executionNote.value,
        riskNote: riskNote.value,
        psychologyNote: psychologyNote.value,
      };
    },
  };
}
