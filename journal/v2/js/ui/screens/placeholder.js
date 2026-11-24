import { el } from "../render.js";

export function renderPlaceholder(title) {
  return [
    el("section", { className: "panel" }, [
      el("h1", { text: title }),
      el("p", { className: "empty", text: "Este módulo llega en un slice posterior." }),
    ]),
  ];
}
