import { setMain } from "./render.js";
import { renderHoy } from "./screens/hoy.js";
import { renderPlaceholder } from "./screens/placeholder.js";
import { renderNuevo } from "./screens/nuevo.js";
import { renderEstudio } from "./screens/estudio.js";
import { renderObservationDetail } from "./screens/observation-detail.js";
import { renderSetupDetail } from "./screens/setup-detail.js";
import { renderHistorial } from "./screens/historial.js";
import { renderTradeDetail } from "./screens/trade-detail.js";

export function parseHash() {
  const raw = (location.hash || "#/hoy").replace(/^#\/?/, "");
  const [name, ...restParts] = raw.split("/");
  return { name: name || "hoy", rest: restParts.join("/") };
}

export function go(path) {
  location.hash = `#/${path}`;
}

export function currentRoute() {
  return parseHash().name;
}

export function routeList() {
  return {
    hoy: true,
    nuevo: true,
    historial: true,
    numeros: true,
    estudio: true,
    senales: true,
    cuentas: true,
    fondeo: true,
  };
}

export async function paint(ctx) {
  const parsed = parseHash();
  const viewCtx = { ...ctx, route: parsed };
  let title = "Hoy";
  let nodes;
  let nav = parsed.name;

  if (parsed.name === "nuevo") {
    title = "Nuevo";
    nodes = await renderNuevo(viewCtx);
  } else if (parsed.name === "setup") {
    title = "Setup";
    nav = "estudio";
    nodes = await renderSetupDetail(viewCtx);
  } else if (parsed.name === "estudio") {
    title = "Estudio";
    nodes = await renderEstudio(viewCtx);
  } else if (parsed.name === "observacion") {
    title = "Observación";
    nav = "estudio";
    nodes = await renderObservationDetail(viewCtx);
  } else if (parsed.name === "hoy") {
    title = "Hoy";
    nodes = renderHoy(viewCtx);
  } else if (parsed.name === "trade") {
    title = "Trade";
    nav = "historial";
    nodes = await renderTradeDetail(viewCtx);
  } else if (parsed.name === "historial") {
    title = "Historial";
    nodes = await renderHistorial(viewCtx);
  } else if (parsed.name === "numeros") {
    title = "Números";
    nodes = renderPlaceholder("Números");
  } else if (parsed.name === "senales") {
    title = "Señales";
    nodes = renderPlaceholder("Señales");
  } else if (parsed.name === "cuentas") {
    title = "Cuentas";
    nodes = renderPlaceholder("Cuentas");
  } else if (parsed.name === "fondeo") {
    title = "Fondeo";
    nodes = renderPlaceholder("Fondeo");
  } else {
    title = "Hoy";
    nav = "hoy";
    nodes = renderHoy(viewCtx);
  }

  document.title = `Journal V2 · ${title}`;
  setMain(nodes);
  document.querySelectorAll("[data-route]").forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("data-route") === nav);
  });
}
