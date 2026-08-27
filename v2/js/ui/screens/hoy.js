import { el } from "../render.js";

export function renderHoy(ctx) {
  const stageName = ctx.stage ? ctx.stage.name : "—";
  return [
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: "Universo Real · stage activa" }),
      el("h1", { text: "Hoy" }),
      el("p", { className: "empty", text: "No hay operaciones Real en esta etapa." }),
      el("p", { className: "meta", text: `Stage: ${stageName}` }),
    ]),
  ];
}
