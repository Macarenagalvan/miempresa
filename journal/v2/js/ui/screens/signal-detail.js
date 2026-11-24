import { el } from "../render.js";
import { field } from "../forms/observation.js";
import { getSignal } from "../../storage/repos/signals.js";
import { updateSignalFollowup } from "../../domain/signal.js";
import { Disposition, Resolution } from "../../domain/enums.js";
import { go } from "../router.js";

function dump(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export async function renderSignalDetail(ctx) {
  const id = ctx.route.rest;
  const sig = id ? await getSignal(id) : null;
  if (!sig) {
    return [el("section", { className: "panel" }, [el("p", { className: "empty", text: "Señal no encontrada." })])];
  }
  const err = el("p", { className: "err", text: "" });
  const disposition = el("select", { className: "input" }, Object.values(Disposition).map((d) => el("option", { value: d, text: d })));
  disposition.value = sig.disposition;
  const resolution = el("select", { className: "input" }, Object.values(Resolution).map((d) => el("option", { value: d, text: d })));
  resolution.value = sig.resolution;
  const resolvedAt = el("input", { className: "input", value: sig.resolvedAt ? String(sig.resolvedAt).slice(0, 16) : "" });
  const setupId = el("input", { className: "input", value: sig.setupId || "" });
  const tradeId = el("input", { className: "input", value: sig.tradeId || "" });
  const note = el("textarea", { className: "input", rows: "3" });
  note.value = sig.note || "";
  const save = el("button", { type: "button", text: "Guardar seguimiento" });
  save.addEventListener("click", async () => {
    err.textContent = "";
    try {
      await updateSignalFollowup(sig.id, {
        disposition: disposition.value,
        resolution: resolution.value,
        resolvedAt: resolvedAt.value ? new Date(resolvedAt.value).toISOString() : null,
        setupId: setupId.value.trim(),
        tradeId: tradeId.value.trim(),
        note: note.value,
      });
      go("senal/" + sig.id);
    } catch (e) {
      err.textContent = e.message;
    }
  });
  const snap = sig.snapshot || {};
  return [
    el("section", { className: "panel print-panel" }, [
      el("p", { className: "kicker", text: "PRINT ORIGINAL · inmutable" }),
      el("h1", { text: `${sig.asset} ${sig.direction}` }),
      el("p", { className: "meta", text: `printedAt ${sig.printedAt}` }),
      el("p", { className: "meta", text: `broker ${sig.brokerSymbol || "—"} · context ${sig.context} · recordSource ${sig.recordSource}` }),
      el("p", { className: "meta", text: `rgmSignalId ${dump(sig.sourceRef && sig.sourceRef.rgmSignalId)}` }),
      el("p", { className: "meta", text: `rgmPrintAt ${dump(sig.sourceRef && sig.sourceRef.rgmPrintAt)}` }),
      el("p", { className: "meta", text: `score ${dump(snap.score)} · rrProposed ${dump(snap.rrProposed)} · session ${dump(snap.session)}` }),
      snap.entry != null ? el("p", { className: "meta", text: `entry ${snap.entry} · sl ${dump(snap.sl)} · tp ${dump(snap.tp)}` }) : null,
      snap.kind != null || snap.rgmResolvedRaw != null
        ? el("p", { className: "meta", text: `kind ${dump(snap.kind)} · rgmResolvedRaw ${dump(snap.rgmResolvedRaw)}` })
        : null,
      el("p", { className: "hint", text: "El print no se edita." }),
    ]),
    el("section", { className: "panel form" }, [
      el("p", { className: "kicker", text: "SEGUIMIENTO" }),
      el("h2", { text: "Qué hizo Maca / cómo cerró el aviso" }),
      field("disposition", disposition),
      field("resolution", resolution),
      field("resolvedAt", resolvedAt),
      field("setupId (opcional)", setupId),
      field("tradeId (opcional)", tradeId),
      field("nota", note),
      el("p", { className: "hint", text: "TAKEN no crea Setup ni Trade. TP Desk ≠ WIN del Trade." }),
      err,
      el("div", { className: "row-actions" }, [
        save,
        el("button", { type: "button", className: "ghost", text: "Volver", onclick: () => go("senales") }),
      ]),
    ]),
  ];
}
