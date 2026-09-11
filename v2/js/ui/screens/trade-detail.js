import { el } from "../render.js";
import { field } from "../forms/observation.js";
import { getTrade } from "../../storage/repos/trades.js";
import { getSetup } from "../../storage/repos/setups.js";
import { updateOpenTrade, closeTrade, voidTrade, enrichTrade } from "../../domain/trade.js";
import { asrForTrade, asrStatusLabel, createAsr, updateAsr } from "../../domain/asr.js";
import { CloseType, VoidReason, Lifecycle, Strategy, Style, BlueVariant, strategyLabel } from "../../domain/enums.js";
import { SESSIONS } from "../../config.js";
import { asrFields } from "../forms/asr.js";
import { go } from "../router.js";
import { addTradeImage, listTradeImages, removeAttachment } from "../../storage/repos/attachments.js";

function partialsSelect(current) {
  const node = el("select", { className: "input" }, [
    el("option", { value: "false", text: "No" }),
    el("option", { value: "true", text: "Sí" }),
  ]);
  node.value = current === true ? "true" : "false";
  return node;
}

export async function renderTradeDetail(ctx) {
  const closeMode = ctx.route.rest.includes("/cerrar");
  const voidMode = ctx.route.rest.includes("/void");
  const asrMode = ctx.route.rest.includes("/asr");
  const editMode = ctx.route.rest.includes("/editar");
  const id = ctx.route.rest.replace(/\/(cerrar|void|asr|editar)$/, "");
  const trade = id ? await getTrade(id) : null;
  if (!trade) {
    return [el("section", { className: "panel" }, [el("p", { className: "empty", text: "Operación no encontrada." })])];
  }
  const setup = trade.setupId ? await getSetup(trade.setupId) : null;
  const asr = await asrForTrade(trade.id);
  if (closeMode) return renderClose(trade);
  if (voidMode) return renderVoid(trade);
  if (asrMode) return renderAsr(trade, asr);
  if (editMode) return renderEdit(trade);
  return await renderCard(trade, setup, asr);
}

function metaLine(label, value) {
  if (value == null || value === "") return null;
  return el("p", { className: "meta", text: `${label} ${value}` });
}

async function renderCard(trade, setup, asr) {
  const images = await listTradeImages(trade.id);
  const err = el("p", { className: "err", text: "" });
  const sl = el("input", { className: "input", value: trade.currentSL ?? "" });
  const mgmt = el("textarea", { className: "input", rows: "3" });
  mgmt.value = trade.management || "";
  const partials = partialsSelect(trade.hasPartials);
  const actions = [];
  const asrLabel = asrStatusLabel(trade, asr);

  if (trade.lifecycle === Lifecycle.OPEN || trade.lifecycle === Lifecycle.CLOSED) {
    actions.push(el("button", {
      type: "button",
      text: "Editar operación",
      onclick: () => go("trade/" + trade.id + "/editar"),
    }));
  }
  if (trade.lifecycle === Lifecycle.OPEN) {
    const save = el("button", { type: "button", text: "Guardar gestión" });
    save.addEventListener("click", async () => {
      try {
        await updateOpenTrade(trade.id, {
          currentSL: sl.value,
          management: mgmt.value,
          hasPartials: partials.value === "true",
        });
        go("trade/" + trade.id);
      } catch (e) { err.textContent = e.message; }
    });
    actions.push(save);
    actions.push(el("button", { type: "button", text: "Cerrar operación", onclick: () => go("trade/" + trade.id + "/cerrar") }));
  }
  if (trade.lifecycle !== Lifecycle.VOID) {
    actions.push(el("button", { type: "button", className: "ghost", text: "VOID", onclick: () => go("trade/" + trade.id + "/void") }));
  }
  if (trade.lifecycle === Lifecycle.CLOSED) {
    actions.push(el("button", {
      type: "button",
      text: asr ? "Ver / editar ASR" : "Hacer ASR",
      onclick: () => go("trade/" + trade.id + "/asr"),
    }));
  }
  if (setup) {
    actions.push(el("button", { type: "button", className: "ghost", text: "Ver idea", onclick: () => go("setup/" + setup.id) }));
  }

  let rLabel = "R al cierre";
  if (trade.lifecycle === Lifecycle.CLOSED) {
    if (trade.hasPartials) rLabel = "R n/a · parciales (exit no es media ponderada)";
    else if (trade.rrRealized == null) rLabel = "R n/a";
    else rLabel = `R ${trade.rrRealized.toFixed(2)}`;
  } else if (trade.incompleteForR) {
    rLabel = "INCOMPLETO PARA R / RISK";
  } else if (trade.hasPartials) {
    rLabel = "R n/a al cierre · parciales";
  }

  return [
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: `${trade.lifecycle} · ${trade.context}` }),
      el("h1", { text: `${trade.asset} ${trade.direction}` }),
      el("p", { className: "meta", text: `entry ${trade.entry} · strategy ${strategyLabel(trade.strategy)} · style ${trade.style || "—"}` }),
      metaLine("variant", trade.variant),
      metaLine("session", trade.session),
      trade.note ? el("p", { className: "meta", text: `note ${trade.note}` }) : null,
      trade.closeType ? el("p", { className: "meta", text: `closeType ${trade.closeType}` }) : null,
      el("p", { className: "meta", text: `account ${trade.accountId || "—"} · broker ${trade.brokerSymbol || "—"}` }),
      el("p", { className: "meta origen", text: origenLine(trade) }),
      setup ? el("p", { className: "meta", text: `plannedEntry ${setup.plannedEntry ?? "—"} ≠ actual ${trade.entry}` }) : null,
      el("p", { className: "meta", text: `initialSL ${trade.initialSL ?? "—"} · currentSL ${trade.currentSL ?? "—"}` }),
      metaLine("TP", trade.tp),
      metaLine("RR planned", trade.rrPlanned),
      metaLine("Risk %", trade.riskPercent),
      metaLine("Risk $", trade.riskMoney),
      el("p", { className: "meta", text: rLabel }),
      trade.result ? el("p", { className: "meta", text: `${trade.result} · netPnl ${trade.netPnl}` }) : null,
      asrLabel ? el("p", { className: "meta", text: asrLabel }) : null,
      trade.lifecycle === Lifecycle.OPEN ? field("currentSL", sl) : null,
      trade.lifecycle === Lifecycle.OPEN
        ? field("Hubo cierres parciales", partials)
        : el("p", { className: "meta", text: `Hubo cierres parciales: ${trade.hasPartials === true ? "Sí" : "No"}` }),
      trade.lifecycle === Lifecycle.OPEN ? field("Gestión (nota)", mgmt) : el("p", { className: "meta", text: trade.management || "" }),
      trade.voidReason ? el("p", { className: "hint", text: `VOID ${trade.voidReason} ${trade.voidedAt}` }) : null,
      err,
      el("div", { className: "row-actions" }, actions),
      renderCaptures(trade, images, err),
    ]),
  ];
}

function renderCaptures(trade, images, err) {
  const file = el("input", { className: "input", type: "file", accept: "image/png,image/jpeg,image/webp" });
  file.setAttribute("name", "trade-image");
  const add = el("button", { type: "button", text: "Añadir imagen" });
  add.addEventListener("click", async () => {
    err.textContent = "";
    const picked = file.files && file.files[0];
    if (!picked) {
      err.textContent = "elegí una imagen";
      return;
    }
    try {
      await addTradeImage(trade.id, picked);
      go("trade/" + trade.id);
    } catch (e) {
      err.textContent = e.message;
    }
  });
  const thumbs = images.map((att) => {
    const src = att.blob ? URL.createObjectURL(att.blob) : "";
    const img = el("img", { className: "thumb", alt: att.name || "captura" });
    if (src) img.src = src;
    img.addEventListener("click", () => {
      if (src) window.open(src, "_blank");
    });
    const del = el("button", { type: "button", className: "ghost", text: "Quitar" });
    del.addEventListener("click", async () => {
      err.textContent = "";
      try {
        await removeAttachment(att.id);
        go("trade/" + trade.id);
      } catch (e) {
        err.textContent = e.message;
      }
    });
    return el("div", { className: "thumb-card", "data-att": att.id }, [
      img,
      el("p", { className: "meta", text: att.name || "captura" }),
      del,
    ]);
  });
  return el("div", { className: "captures" }, [
    el("p", { className: "kicker", text: "Capturas / Imágenes" }),
    images.length ? el("div", { className: "thumb-row" }, thumbs) : el("p", { className: "meta", text: "Sin capturas." }),
    file,
    add,
    el("p", { className: "hint", text: "PNG, JPEG o WEBP. Máx 8 MB. Local en este dispositivo." }),
  ]);
}

function origenLine(trade) {
  const pos = trade.sourceRef && trade.sourceRef.mt5Position;
  if (trade.recordSource === "MT5_EA") {
    return `origen MT5_EA · position ${pos || "—"}`;
  }
  return `origen ${trade.recordSource || "—"}`;
}

function enumSelect(values, current, name, emptyLabel, labelFn) {
  const opts = [];
  if (emptyLabel != null) opts.push(el("option", { value: "", text: emptyLabel }));
  for (const v of values) opts.push(el("option", { value: v, text: labelFn ? labelFn(v) : v }));
  const node = el("select", { className: "input", name }, opts);
  node.value = current || (emptyLabel != null ? "" : values[0]);
  return node;
}

function renderEdit(trade) {
  const strategy = enumSelect(Object.values(Strategy), trade.strategy, "strategy", null, strategyLabel);
  const style = enumSelect(Object.values(Style), trade.style, "style", "—");
  const variant = enumSelect(Object.values(BlueVariant), trade.variant, "variant", "—");
  const session = enumSelect(SESSIONS, trade.session, "session", "—");
  const sl = el("input", { className: "input", name: "initialSL", value: trade.initialSL ?? "" });
  const tp = el("input", { className: "input", name: "tp", value: trade.tp ?? "" });
  const rr = el("input", { className: "input", name: "rrPlanned", value: trade.rrPlanned ?? "" });
  const riskPct = el("input", { className: "input", name: "riskPercent", value: trade.riskPercent ?? "" });
  const riskMoney = el("input", { className: "input", name: "riskMoney", value: trade.riskMoney ?? "" });
  const mgmt = el("textarea", { className: "input", name: "management", rows: "3" });
  mgmt.value = trade.management || "";
  const note = el("textarea", { className: "input", name: "note", rows: "3" });
  note.value = trade.note || "";
  const partials = partialsSelect(trade.hasPartials);
  partials.setAttribute("name", "hasPartials");
  const closeType = enumSelect(Object.values(CloseType), trade.closeType || CloseType.UNKNOWN, "closeType");
  const err = el("p", { className: "err", text: "" });
  const save = el("button", { type: "button", text: "Guardar cambios" });
  save.addEventListener("click", async () => {
    err.textContent = "";
    try {
      const patch = {
        strategy: strategy.value,
        style: style.value || null,
        variant: variant.value || null,
        session: session.value || null,
        initialSL: sl.value,
        tp: tp.value,
        rrPlanned: rr.value,
        riskPercent: riskPct.value,
        riskMoney: riskMoney.value,
        management: mgmt.value,
        note: note.value,
        hasPartials: partials.value === "true",
      };
      if (trade.lifecycle === Lifecycle.CLOSED) patch.closeType = closeType.value;
      const next = await enrichTrade(trade.id, patch);
      go("trade/" + next.id);
    } catch (e) {
      err.textContent = e.message;
    }
  });
  const cancel = el("button", {
    type: "button",
    className: "ghost",
    text: "Cancelar",
    onclick: () => go("trade/" + trade.id),
  });
  const nodes = [
    el("p", { className: "kicker", text: "Editar operación" }),
    el("h1", { text: `${trade.asset} ${trade.direction}` }),
    el("p", { className: "meta origen", text: origenLine(trade) }),
    el("p", { className: "hint", text: "Origen y cuenta no se editan acá." }),
    field("Strategy", strategy),
    field("Style", style),
    field("Variant", variant),
    field("Session", session),
    field("Initial SL", sl),
    field("TP", tp),
    field("RR planned", rr),
    field("Riesgo %", riskPct),
    field("Riesgo $ / €", riskMoney),
    field("Management", mgmt),
    field("Note", note),
    field("Hubo cierres parciales", partials),
  ];
  if (trade.lifecycle === Lifecycle.CLOSED) nodes.push(field("Close type", closeType));
  nodes.push(err);
  nodes.push(el("div", { className: "row-actions" }, [save, cancel]));
  return [el("section", { className: "panel form" }, nodes)];
}

function renderClose(trade) {
  const exit = el("input", { className: "input", value: "" });
  const closedAt = el("input", { className: "input", value: new Date().toISOString().slice(0, 16) });
  const net = el("input", { className: "input", value: "" });
  const comm = el("input", { className: "input", value: "" });
  const swap = el("input", { className: "input", value: "" });
  const closeType = el("select", { className: "input" }, Object.values(CloseType).map((c) => el("option", { value: c, text: c })));
  closeType.value = CloseType.MANUAL;
  const mgmt = el("textarea", { className: "input", rows: "2" });
  mgmt.value = trade.management || "";
  const partials = partialsSelect(trade.hasPartials);
  const err = el("p", { className: "err", text: "" });
  const save = el("button", { type: "button", text: "Cerrar" });
  save.addEventListener("click", async () => {
    err.textContent = "";
    try {
      await closeTrade(trade.id, {
        exit: exit.value,
        closedAt: closedAt.value ? new Date(closedAt.value).toISOString() : undefined,
        netPnl: net.value,
        commission: comm.value,
        swap: swap.value,
        closeType: closeType.value,
        declaredBe: closeType.value === CloseType.BE,
        management: mgmt.value,
        hasPartials: partials.value === "true",
      });
      go("trade/" + trade.id);
    } catch (e) { err.textContent = e.message; }
  });
  return [
    el("section", { className: "panel" }, [
      el("h1", { text: "Cerrar operación" }),
      field("exit", exit),
      field("closedAt", closedAt),
      field("netPnl", net),
      field("comisión", comm),
      field("swap", swap),
      field("motivo de cierre", closeType),
      field("Hubo cierres parciales", partials),
      field("gestión (nota)", mgmt),
      el("p", { className: "hint", text: "netPnl es el número de performance. commission/swap se guardan; no se vuelven a restar." }),
      err,
      save,
    ]),
  ];
}

function renderAsr(trade, asr) {
  const form = asrFields(asr);
  const err = el("p", { className: "err", text: "" });
  const save = el("button", { type: "button", text: "Guardar ASR" });
  save.addEventListener("click", async () => {
    err.textContent = "";
    try {
      const input = form.read();
      if (asr) await updateAsr(asr.id, input);
      else await createAsr({ ...input, tradeId: trade.id }, trade.stageId);
      go("trade/" + trade.id);
    } catch (e) {
      err.textContent = e.message;
    }
  });
  return [
    el("section", { className: "panel" }, [
      el("p", { className: "kicker", text: asr ? "Ver / editar ASR" : "Hacer ASR" }),
      el("h1", { text: `${trade.asset} ${trade.direction}` }),
      el("p", { className: "hint", text: "wouldDoSame + conclusion. El resto es opcional." }),
      ...form.nodes,
      err,
      el("div", { className: "row-actions" }, [
        save,
        el("button", { type: "button", className: "ghost", text: "Volver al Trade", onclick: () => go("trade/" + trade.id) }),
      ]),
    ]),
  ];
}

function renderVoid(trade) {
  const reason = el("select", { className: "input" }, Object.values(VoidReason).map((r) => el("option", { value: r, text: r })));
  const err = el("p", { className: "err", text: "" });
  const save = el("button", { type: "button", text: "Confirmar VOID" });
  save.addEventListener("click", async () => {
    try {
      await voidTrade(trade.id, reason.value);
      go("trade/" + trade.id);
    } catch (e) { err.textContent = e.message; }
  });
  return [
    el("section", { className: "panel" }, [
      el("h1", { text: "VOID" }),
      el("p", { className: "hint", text: "Solo duplicado, fantasma, prueba, accidente o inválido. No para esconder un LOSS." }),
      field("voidReason", reason),
      err,
      save,
    ]),
  ];
}
