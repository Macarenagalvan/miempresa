import { setMain } from "./render.js";
import { renderHoy } from "./screens/hoy.js";
import { renderSenales } from "./screens/senales.js";
import { renderSignalDetail } from "./screens/signal-detail.js";
import { renderNuevo } from "./screens/nuevo.js";
import { renderEstudio } from "./screens/estudio.js";
import { renderObservationDetail } from "./screens/observation-detail.js";
import { renderSetupDetail } from "./screens/setup-detail.js";
import { renderHistorial } from "./screens/historial.js";
import { renderTradeDetail } from "./screens/trade-detail.js";
import { renderNumeros } from "./screens/numeros.js";
import { renderCuentas } from "./screens/cuentas.js";
import { renderCuentaDetail } from "./screens/cuenta-detail.js";
import { renderFondeo } from "./screens/fondeo.js";
import { renderChallengeDetail } from "./screens/challenge-detail.js";
import { renderSistema } from "./screens/sistema.js";

export function parseHash() {
  const raw = (location.hash || "#/hoy").replace(/^#\/?/, "");
  const qIndex = raw.indexOf("?");
  const path = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const search = qIndex >= 0 ? raw.slice(qIndex + 1) : "";
  const [name, ...restParts] = path.split("/");
  const query = {};
  if (search) {
    for (const part of search.split("&")) {
      if (!part) continue;
      const eq = part.indexOf("=");
      const key = decodeURIComponent(eq >= 0 ? part.slice(0, eq) : part);
      const value = decodeURIComponent(eq >= 0 ? part.slice(eq + 1) : "");
      if (key) query[key] = value;
    }
  }
  return { name: name || "hoy", rest: restParts.join("/"), query };
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
    sistema: true,
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
    nodes = await renderHoy(viewCtx);
  } else if (parsed.name === "trade") {
    title = "Trade";
    nav = "historial";
    nodes = await renderTradeDetail(viewCtx);
  } else if (parsed.name === "historial") {
    title = "Historial";
    nodes = await renderHistorial(viewCtx);
  } else if (parsed.name === "numeros") {
    title = "Números";
    nodes = await renderNumeros(viewCtx);
  } else if (parsed.name === "senales") {
    title = "Señales";
    nodes = await renderSenales(viewCtx);
  } else if (parsed.name === "senal") {
    title = "Señal";
    nav = "senales";
    nodes = await renderSignalDetail(viewCtx);
  } else if (parsed.name === "cuentas") {
    title = "Cuentas";
    nodes = await renderCuentas(viewCtx);
  } else if (parsed.name === "cuenta") {
    title = "Cuenta";
    nav = "cuentas";
    nodes = await renderCuentaDetail(viewCtx);
  } else if (parsed.name === "fondeo") {
    title = "Fondeo";
    nodes = await renderFondeo(viewCtx);
  } else if (parsed.name === "challenge") {
    title = "Challenge";
    nav = "fondeo";
    nodes = await renderChallengeDetail(viewCtx);
  } else if (parsed.name === "sistema") {
    title = "Sistema";
    nav = "sistema";
    nodes = await renderSistema(viewCtx);
  } else {
    title = "Hoy";
    nav = "hoy";
    nodes = await renderHoy(viewCtx);
  }

  document.title = `Journal V2 · ${title}`;
  setMain(nodes);
  document.querySelectorAll("[data-route]").forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("data-route") === nav);
  });
}
