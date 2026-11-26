import { setMain } from "./render.js";
import { enhanceFileInputs } from "./file-picker.js";
import { renderHoy, renderEscritorio } from "./screens/hoy.js";
import { renderSenales } from "./screens/senales.js";
import { renderSignalDetail } from "./screens/signal-detail.js";
import { renderNuevo } from "./screens/nuevo.js";
import { renderEstudio } from "./screens/estudio.js";
import { renderBacktesting } from "./screens/backtesting.js";
import { renderObservationDetail } from "./screens/observation-detail.js";
import { renderSetupDetail } from "./screens/setup-detail.js";
import { renderHistorial } from "./screens/historial.js";
import { renderTradeDetail } from "./screens/trade-detail.js";
import { renderNumeros } from "./screens/numeros.js";
import { renderPatrones } from "./screens/patrones.js";
import { renderCuentas } from "./screens/cuentas.js";
import { renderCuentaDetail } from "./screens/cuenta-detail.js";
import { renderFondeo } from "./screens/fondeo.js";
import { renderChallengeDetail } from "./screens/challenge-detail.js";
import { renderSistema } from "./screens/sistema.js";
import { getTrade } from "../storage/repos/trades.js";

import { renderImportar } from "./screens/importar.js";
import { renderPractice } from "./screens/practice.js";
import { renderInversiones } from "./screens/inversiones.js";

let paintedPath = "";

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
  const next = `#/${path}`;
  if (location.hash === next) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    location.hash = next;
  }
}

export function currentRoute() {
  return parseHash().name;
}

export function routeList() {
  return {
    hoy: true, escritorio: true, importar: true, practica: true, inversiones: true,
    nuevo: true,
    historial: true,
    backtesting: true,
    numeros: true,
    patrones: true,
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

  if (parsed.name === "inversiones") {
    title = "Inversiones"; nodes = await renderInversiones(viewCtx);
  } else if (parsed.name === "importar") {
    title = "Importar operaciones"; nav = "historial"; nodes = await renderImportar(viewCtx);
  } else if (parsed.name === "practica") {
    title = "Mi plan y rutina"; nodes = await renderPractice(viewCtx);
  } else if (parsed.name === "nuevo") {
    title = parsed.rest === "trade" && parsed.query.context === "BACKTEST" ? "Nuevo backtest" : "Registrar";
    if (parsed.rest === "trade" && parsed.query.context === "BACKTEST") nav = "backtesting";
    nodes = await renderNuevo(viewCtx);
  } else if (parsed.name === "setup") {
    title = "Idea";
    nav = "estudio";
    nodes = await renderSetupDetail(viewCtx);
  } else if (parsed.name === "estudio") {
    title = "Estudio";
    nodes = await renderEstudio(viewCtx);
  } else if (parsed.name === "observacion") {
    title = "Nota";
    nav = "estudio";
    nodes = await renderObservationDetail(viewCtx);
  } else if (parsed.name === "hoy") {
    title = "Hoy";
    nodes = await renderHoy(viewCtx);
  } else if (parsed.name === "escritorio") {
    title = "Mi escritorio";
    nodes = await renderEscritorio(viewCtx);
  } else if (parsed.name === "trade") {
    title = "Operación";
    const trade = await getTrade(parsed.rest.split("/")[0]);
    nav = trade && trade.context === "BACKTEST" ? "backtesting" : "historial";
    nodes = await renderTradeDetail(viewCtx);
  } else if (parsed.name === "historial") {
    title = "Historial";
    nodes = await renderHistorial(viewCtx);
  } else if (parsed.name === "backtesting") {
    title = "Backtesting";
    nodes = await renderBacktesting(viewCtx);
  } else if (parsed.name === "numeros") {
    title = "Estadísticas";
    nodes = await renderNumeros(viewCtx);
  } else if (parsed.name === "patrones") {
    title = "Patrones";
    nodes = await renderPatrones(viewCtx);
  } else if (parsed.name === "senales") {
    title = "Señales";
    nodes = await renderSenales(viewCtx);
  } else if (parsed.name === "senal") {
    title = "Señal";
    nav = "senales";
    nodes = await renderSignalDetail(viewCtx);
  } else if (parsed.name === "cuentas") {
    title = "Cuentas y fondeo";
    nodes = await renderCuentas(viewCtx);
  } else if (parsed.name === "cuenta") {
    title = "Cuenta";
    nav = "cuentas";
    nodes = await renderCuentaDetail(viewCtx);
  } else if (parsed.name === "fondeo") {
    title = "Fondeo";
    nav = "cuentas";
    nodes = await renderFondeo(viewCtx);
  } else if (parsed.name === "challenge") {
    title = "Challenge";
    nav = "cuentas";
    nodes = await renderChallengeDetail(viewCtx);
  } else if (parsed.name === "sistema") {
    title = "Configuración";
    nav = "sistema";
    nodes = await renderSistema(viewCtx);
  } else {
    title = "Hoy";
    nav = "hoy";
    nodes = await renderHoy(viewCtx);
  }

  document.title = `Maca · ${title}`;
  const heading = document.getElementById("page-title");
  if (heading) heading.textContent = title;
  const topNew = document.getElementById("top-new-trade");
  if (topNew) {
    const isBacktest = parsed.name === "backtesting" ||
      (parsed.name === "trade" && nav === "backtesting") ||
      (parsed.name === "nuevo" && parsed.rest === "trade" && parsed.query.context === "BACKTEST");
    topNew.href = isBacktest ? "#/nuevo/trade?context=BACKTEST" : "#/nuevo/trade";
    topNew.textContent = isBacktest ? "+ Nuevo backtest" : "+ Nueva operación";
    topNew.setAttribute("aria-label", isBacktest ? "Registrar nuevo backtest" : "Registrar nueva operación");
  }
  setMain(nodes);
  enhanceFileInputs(document.getElementById("app"));
  const nextPath = parsed.name + "/" + parsed.rest;
  if (paintedPath !== nextPath) window.scrollTo({ top: 0, behavior: "instant" });
  paintedPath = nextPath;
  document.body.dataset.route = parsed.name;
  document.querySelectorAll("[data-route]").forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("data-route") === nav);
  });
}
