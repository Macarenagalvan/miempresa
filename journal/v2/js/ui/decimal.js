// Acepta números con coma decimal (26333,25 o 26.333,25) y los pasa al formato con punto.
const COMMA_NUM = /^-?\s*(\d{1,3}(\.\d{3})+|\d+),\d+$/;
export function normalizeDecimal(value) {
  const v = String(value ?? "").trim();
  if (!COMMA_NUM.test(v)) return v;
  return v.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
}
/** Al salir de cualquier campo de texto, corrige el número si usa coma decimal. */
export function bindDecimalFix(root = document) {
  root.addEventListener("focusout", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !["text", "", "number", "search"].includes(t.type)) return;
    const fixed = normalizeDecimal(t.value);
    if (fixed !== t.value.trim() && fixed !== t.value) { t.value = fixed; t.dispatchEvent(new Event("input", { bubbles: true })); }
  }, true);
}
