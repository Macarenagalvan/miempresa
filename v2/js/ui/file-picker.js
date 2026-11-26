// «Elegir archivo» en español para todos los <input type=file> visibles (solo diseño).
// Envuelve el input existente: sus eventos y su lógica no cambian.
const EMPTY = "Ningún archivo seleccionado";

function nameOf(input) {
  const files = input.files ? [...input.files] : [];
  if (!files.length) return EMPTY;
  return files.length === 1 ? files[0].name : files.length + " archivos seleccionados";
}

export function enhanceFileInputs(root) {
  if (!root || typeof document === "undefined") return;
  for (const input of root.querySelectorAll('input[type="file"]')) {
    if (input.dataset.picker || input.hidden || input.classList.contains("capture-input") || input.classList.contains("file-native") || input.closest(".file-pick")) continue;
    input.dataset.picker = "1";
    const wrap = document.createElement("label");
    wrap.className = "file-pick";
    const btn = document.createElement("span");
    btn.className = "file-btn";
    btn.textContent = input.multiple ? "Elegir archivos" : "Elegir archivo";
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = nameOf(input);
    input.replaceWith(wrap);
    input.classList.add("file-native");
    wrap.append(input, btn, name);
    const sync = () => { name.textContent = nameOf(input); };
    input.addEventListener("change", sync);
    // Si el código vacía el input (input.value = ""), el nombre se actualiza al volver a mirar.
    wrap.addEventListener("mouseenter", sync);
    input.addEventListener("focus", sync);
  }
}
