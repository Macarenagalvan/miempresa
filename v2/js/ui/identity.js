export function visibleName(meta) {
  return String(meta && meta.traderName != null ? meta.traderName : "").trim();
}

export function brandName(meta) {
  return visibleName(meta) || "Maca";
}

export function greetingLine(meta, now = new Date()) {
  const hour = now.getHours();
  const hello = hour < 12 ? "Buen día" : hour < 20 ? "Buenas tardes" : "Buenas noches";
  const name = visibleName(meta);
  return name ? `${hello}, ${name}` : hello;
}

export function longDate(now = new Date()) {
  return now.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

export function applyIdentity(meta, stage) {
  const brand = document.getElementById("brand-name");
  if (brand) brand.textContent = brandName(meta);
  const stageEl = document.getElementById("stage-label");
  if (stageEl) {
    stageEl.textContent = stage && stage.name ? `Etapa ${stage.name}` : "";
  }
}

export function icon(path) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ico");
  const node = document.createElementNS("http://www.w3.org/2000/svg", "path");
  node.setAttribute("d", path);
  node.setAttribute("fill", "none");
  node.setAttribute("stroke", "currentColor");
  node.setAttribute("stroke-width", "1.75");
  node.setAttribute("stroke-linecap", "round");
  node.setAttribute("stroke-linejoin", "round");
  svg.append(node);
  return svg;
}

export const ICONS = {
  note: "M5 5h10l4 4v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm10 0v4h4M8 13h8M8 17h5",
  idea: "M12 3a6 6 0 0 1 4 10.5V16H8v-2.5A6 6 0 0 1 12 3zm-2 15h4M10 19h4",
  trade: "M4 19V5m0 14h16M8 15l3-4 3 2 5-7",
};
