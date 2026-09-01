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

export function iconBtn(label, className, path, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = ("ghost task-mini icon-btn " + className).trim();
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.append(icon(path));
  if (onClick) btn.addEventListener("click", onClick);
  return btn;
}

export const ICONS = {
  note: "M5 5h10l4 4v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm10 0v4h4M8 13h8M8 17h5",
  idea: "M12 3a6 6 0 0 1 4 10.5V16H8v-2.5A6 6 0 0 1 12 3zm-2 15h4M10 19h4",
  trade: "M4 19V5m0 14h16M8 15l3-4 3 2 5-7",
  task: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  pin: "M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  cal: "M7 3v3M17 3v3M4 8h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  link: "M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0-7.07-7.07L10 5.93M14 11a5 5 0 0 0-7.07 0L5.52 12.4a5 5 0 0 0 7.07 7.07L14 18.07",
  edit: "M4 20h4L18 10l-4-4L4 16v4zm10-14 4 4",
  archive: "M4 6h16l-1.2 13H5.2L4 6zm4-3h8l1 3H7l1-3",
  up: "M12 19V6M6 11l6-6 6 6",
  down: "M12 5v13M6 13l6 6 6-6",
};
