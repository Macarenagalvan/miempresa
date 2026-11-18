// Parte fundamental del Nasdaq: un JSON público con información de mercado (sin datos personales),
// generado por una tarea programada y guardado en la rama "partes" del repositorio.
export const PARTE_URL = "https://raw.githubusercontent.com/macarenagalvan/miempresa/partes/parte/latest.json";

const str = (v, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const url = (v) => { const s = str(v, 600); return /^https:\/\/[^\s"'<>]+$/.test(s) ? s : ""; };
const list = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const BIAS = { A_FAVOR: "Viento a favor", EN_CONTRA: "Viento en contra", NEUTRO: "Neutro" };

/** Valida y limpia el parte. Todo queda como texto; los links solo https. Devuelve null si no sirve. */
export function normalizeParte(raw) {
  if (!raw || typeof raw !== "object") return null;
  const date = str(raw.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    date,
    slot: raw.slot === "pm" ? "pm" : "am",
    createdAt: str(raw.createdAt, 40),
    bias: BIAS[raw.bias] ? raw.bias : "NEUTRO",
    biasLabel: BIAS[raw.bias] || BIAS.NEUTRO,
    biasNote: str(raw.biasNote, 500),
    events: list(raw.events, 12).map((e) => ({
      time: /^\d{1,2}:\d{2}$/.test(str(e?.time, 5)) ? str(e.time, 5) : "",
      title: str(e?.title, 160), impact: e?.impact === "high" ? "high" : "medium",
      confirmed: e?.confirmed !== false, url: url(e?.url),
    })).filter((e) => e.title),
    earnings: list(raw.earnings, 10).map((e) => ({ company: str(e?.company, 60), when: str(e?.when, 80), note: str(e?.note, 200), url: url(e?.url) })).filter((e) => e.company),
    overnight: list(raw.overnight, 6).map((s) => str(s, 300)).filter(Boolean),
    gauges: list(raw.gauges, 6).map((g) => ({ name: str(g?.name, 30), value: str(g?.value, 30), note: str(g?.note, 200) })).filter((g) => g.name),
    alerts: list(raw.alerts, 5).map((s) => str(s, 250)).filter(Boolean),
    sources: list(raw.sources, 12).map((s) => ({ title: str(s?.title, 120), url: url(s?.url) })).filter((s) => s.url),
  };
}

export async function fetchParte(fetchImpl = fetch) {
  const res = await fetchImpl(PARTE_URL + "?t=" + Math.floor(Date.now() / 300000), { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo leer el parte");
  return normalizeParte(await res.json());
}

/** Avisos que salen de cruzar el parte (mercado) con tus reglas y cuentas (locales). */
export function personalAlerts(parte, status) {
  const out = [];
  const high = parte.events.filter((e) => e.impact === "high");
  if (status?.closed) out.push("Día cerrado según tu plan: hoy el parte es solo para mirar.");
  if (high.length) {
    const when = high.map((e) => (e.time ? e.time + " " : "") + e.title).join(" · ");
    out.push(`Dato fuerte: ${when}. Esperá la reacción, no operes el dato.`);
    if (status?.accounts?.some((a) => a.account.context === "PROP_CHALLENGE")) out.push("Challenge: si el dato te da un día muy bueno, ojo con la consistencia (techo diario).");
    if (status?.accounts?.some((a) => a.account.context === "FUNDED" && a.day >= 100)) out.push("La fondeada ya hizo +$100 hoy: con el dato no hace falta arriesgarla.");
  }
  return out;
}
