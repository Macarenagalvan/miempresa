import { setMain } from "./render.js";
import { renderHoy } from "./screens/hoy.js";
import { renderPlaceholder } from "./screens/placeholder.js";

const ROUTES = {
  hoy: { title: "Hoy", primary: true, render: renderHoy },
  nuevo: { title: "Nuevo", primary: true, render: () => renderPlaceholder("Nuevo") },
  historial: { title: "Historial", primary: true, render: () => renderPlaceholder("Historial") },
  numeros: { title: "Números", primary: true, render: () => renderPlaceholder("Números") },
  estudio: { title: "Estudio", primary: false, render: () => renderPlaceholder("Estudio") },
  senales: { title: "Señales", primary: false, render: () => renderPlaceholder("Señales") },
  cuentas: { title: "Cuentas", primary: false, render: () => renderPlaceholder("Cuentas") },
  fondeo: { title: "Fondeo", primary: false, render: () => renderPlaceholder("Fondeo") },
};

export function currentRoute() {
  const hash = (location.hash || "#/hoy").replace(/^#\/?/, "");
  return ROUTES[hash] ? hash : "hoy";
}

export function routeList() {
  return ROUTES;
}

export function paint(ctx) {
  const name = currentRoute();
  const route = ROUTES[name];
  document.title = `Journal V2 · ${route.title}`;
  setMain(route.render(ctx));
  document.querySelectorAll("[data-route]").forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("data-route") === name);
  });
}
