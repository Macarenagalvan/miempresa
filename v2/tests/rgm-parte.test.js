import './test-safety.js';
import { normalizeParte, personalAlerts, fetchParte } from "../js/domain/parte.js";
import { parteNode } from "../js/ui/parte-panel.js";
export async function run() {
  let n = 0; const check = (ok, m) => { if (!ok) throw new Error(m); n++; };
  check(normalizeParte(null) === null && normalizeParte({ date: "ayer" }) === null, "rechaza partes inválidos");
  const raw = { date: "2026-11-19", slot: "am", bias: "EN_CONTRA", biasNote: "Rendimientos arriba",
    events: [{ time: "14:30", title: "CPI <img src=x onerror=alert(1)>", impact: "high", url: "javascript:alert(1)" }, { time: "16:00", title: "Discurso Fed", impact: "medium", confirmed: false, url: "https://www.federalreserve.gov/" }],
    earnings: [{ company: "NVIDIA", when: "después del cierre", url: "https://investor.nvidia.com/" }],
    gauges: [{ name: "US10Y", value: "4,4%", note: "sube" }], sources: [{ title: "BLS", url: "https://www.bls.gov/" }, { title: "malo", url: "http://x" }] };
  const p = normalizeParte(raw);
  check(p.events[0].url === "" && p.events[1].url.startsWith("https://"), "solo links https");
  check(p.sources.length === 1, "fuentes sin https se descartan");
  const status = { closed: false, accounts: [{ account: { context: "PROP_CHALLENGE" }, day: 0 }, { account: { context: "FUNDED" }, day: 150 }] };
  const al = personalAlerts(p, status);
  check(al.length === 3 && al[0].includes("14:30"), "avisos personales con dato fuerte");
  check(personalAlerts({ ...p, events: [] }, { closed: true, accounts: [] }).length === 1, "día cerrado sin datos");
  const node = parteNode(p, status, "2026-11-19");
  check(!node.querySelector("img") && node.textContent.includes("CPI <img"), "el parte se muestra como texto");
  check(node.textContent.includes("antes de Londres") && node.textContent.includes("(sin confirmar)"), "encabezado y sin confirmar");
  check(parteNode(p, null, "2026-11-20").textContent.includes("del 19/11/2026"), "parte viejo marcado");
  const fake = async () => ({ ok: true, json: async () => raw });
  check((await fetchParte(fake)).bias === "EN_CONTRA", "lee el parte");
  document.getElementById("out").textContent += `\nRGM parte: ${n} tests OK\n`;
}
