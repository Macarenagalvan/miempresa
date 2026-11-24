// Capturas: pegar con Ctrl+V, arrastrar o elegir archivo. Muestra miniaturas antes de guardar.
import { el } from "./render.js";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
let lastActive = null;

function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function addFiles(input, files) {
  const dt = new DataTransfer();
  for (const f of input.files || []) dt.items.add(f);
  let n = 0;
  for (const f of files) {
    if (!IMAGE_TYPES.includes(f.type)) continue;
    const named = f.name && f.name !== "image.png" ? f : new File([f], `captura-${stamp()}-${++n}.${f.type.split("/")[1]}`, { type: f.type });
    if (!input.multiple) dt.items.clear();
    dt.items.add(named);
  }
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Envuelve un <input type=file> existente. onAdded: opcional, se llama tras pegar/arrastrar. */
export function captureDrop(input, { label = "Capturas", onAdded = null } = {}) {
  input.classList.add("capture-input");
  const thumbs = el("div", { className: "capture-thumbs" });
  const zone = el("div", { className: "capture-drop", tabindex: "0", role: "button", "aria-label": label + ": pegá con Ctrl+V, arrastrá o hacé clic para elegir" }, [
    el("strong", { text: "Pegá la captura con Ctrl+V" }),
    el("span", { text: "o arrastrala acá · o hacé clic para elegir" }),
    thumbs,
  ]);
  const urls = [];
  function paint() {
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    thumbs.replaceChildren(...[...(input.files || [])].map((f, i) => {
      const u = URL.createObjectURL(f); urls.push(u);
      const remove = el("button", { type: "button", className: "capture-remove", "aria-label": "Quitar " + f.name, text: "×" });
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        const dt = new DataTransfer();
        [...input.files].forEach((x, j) => { if (j !== i) dt.items.add(x); });
        input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      return el("figure", { className: "capture-thumb" }, [el("img", { src: u, alt: f.name }), remove]);
    }));
    zone.classList.toggle("has-files", Boolean(input.files?.length));
  }
  input.addEventListener("change", paint);
  const activate = () => { lastActive = { input, zone, onAdded }; document.querySelectorAll(".capture-drop.is-target").forEach((z) => z.classList.remove("is-target")); zone.classList.add("is-target"); };
  zone.addEventListener("click", () => { activate(); input.click(); });
  zone.addEventListener("focus", activate);
  zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("is-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault(); zone.classList.remove("is-over"); activate();
    addFiles(input, [...(e.dataTransfer?.files || [])]); onAdded?.();
  });
  zone._capture = { input, zone, onAdded };
  return el("div", { className: "capture-wrap" }, [zone, input]);
}

// Un único escucha de pegado para toda la app.
document.addEventListener("paste", (event) => {
  const files = [...(event.clipboardData?.files || [])].filter((f) => IMAGE_TYPES.includes(f.type));
  if (!files.length) return;
  const target = lastActive && lastActive.zone.isConnected ? lastActive : document.querySelector(".capture-drop")?._capture;
  if (!target) return;
  event.preventDefault();
  addFiles(target.input, files);
  target.zone.classList.add("is-pasted");
  setTimeout(() => target.zone.classList.remove("is-pasted"), 600);
  target.onAdded?.();
});
