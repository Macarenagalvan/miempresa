import { el } from "../render.js";
import { field } from "../forms/observation.js";
import { getTrade } from "../../storage/repos/trades.js";
import { getSetup } from "../../storage/repos/setups.js";
import { updateOpenTrade, completeDraftTrade, activateDraftTrade, closeTrade, voidTrade, enrichTrade } from "../../domain/trade.js";
import { choiceButtons } from "../forms/choice-buttons.js";
import { localDateTimeValue, localDateTimeIso, stateBadge, tradeSection } from "../trade-presentation.js";
import { getAccount } from "../../storage/repos/accounts.js";
import { asrForTrade, asrStatusLabel, createAsr, updateAsr } from "../../domain/asr.js";
import { CloseType, VoidReason, Lifecycle, Strategy, Style, BlueVariant, strategyLabel } from "../../domain/enums.js";
import { sessionOptions, sessionLabel } from "../../config.js";
import { asrFields } from "../forms/asr.js";
import { go } from "../router.js";
import { addTradeImage, listTradeImages, removeAttachment } from "../../storage/repos/attachments.js";
import { deleteTradeFlow } from "../trade-actions.js";
import { toast, confirmDialog } from "../feedback.js";
import { editQuickBacktest, editManualExecution, isQuickBacktest, isMt5Trade, executionEditable } from "../../domain/trade-edit.js";
import { findSimilarQuickBacktest, describeRecord } from "../../domain/duplicates.js";
import { captureDrop } from "../capture-drop.js";
import { processFields } from "../forms/process-fields.js";
import { setTradeProcess, FAMILIES, CONFLUENCES, EMOTIONS, PLAN, ERRORS, labelOf } from "../../domain/process.js";

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
  if (closeMode) return trade.isDraft ? renderEdit(trade, "CLOSED") : renderClose(trade);
  if (voidMode) return renderVoid(trade);
  if (asrMode) return renderAsr(trade, asr);
  if (editMode) return isQuickBacktest(trade) ? renderQuickEdit(trade) : renderEdit(trade);
  return await renderCard(trade, setup, asr);
}

function metaLine(label, value) {
  if (value == null || value === "") return null;
  return el("p", { className: "meta", text: `${label} ${value}` });
}

async function renderCard(trade, setup, asr) {
  const images = await listTradeImages(trade.id);
  const account = trade.accountId ? await getAccount(trade.accountId) : null;
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
      text: isQuickBacktest(trade) ? "Editar backtest" : "Editar operación",
      onclick: () => go("trade/" + trade.id + "/editar"),
    }));
  }
  if (trade.lifecycle === Lifecycle.OPEN) {
    if (trade.isDraft) actions.push(el("button", {
      type: "button", text: "Marcar como abierta",
      onclick: async () => {
        try { await activateDraftTrade(trade.id); go("trade/" + trade.id); }
        catch (e) { err.textContent = e.message; }
      },
    }));
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
    actions.push(el("button", { type: "button", className: "ghost", text: "Anular operación", onclick: () => go("trade/" + trade.id + "/void") }));
  }
  if (trade.lifecycle === Lifecycle.CLOSED) {
    actions.push(el("button", {
      type: "button",
      text: asr ? "Ver / editar revisión" : "Revisar operación",
      onclick: () => go("trade/" + trade.id + "/asr"),
    }));
  }
  if (setup) {
    actions.push(el("button", { type: "button", className: "ghost", text: "Ver idea", onclick: () => go("setup/" + setup.id) }));
  }
  actions.push(el("button", {
    type: "button", className: "btn-danger-ghost", text: "Borrar",
    onclick: () => deleteTradeFlow(trade, { after: trade.context === "BACKTEST" ? "backtesting" : "historial" }).catch((e) => toast(e.message, { tone: "error" })),
  }));

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
    el("section", { className: "panel trade-detail" }, [
      el("div", { className: "trade-detail-top" }, [
        stateBadge(trade),
        el("a", { href: trade.context === "BACKTEST" ? "#/backtesting" : "#/historial", text: trade.context === "BACKTEST" ? "← Backtesting" : "← Operaciones" }),
      ]),
      el("p", { className: "kicker", text: trade.context }),
      el("h1", { text: `${trade.asset} ${trade.direction}` }),
      trade.isDraft && trade.lifecycle !== Lifecycle.VOID ? el("p", { className: "draft-notice", text: "Este borrador no cuenta como operación abierta ni como resultado. Completá sus datos y marcá la apertura o registrá el cierre." }) : null,
      el("div", { className: "trade-facts" }, [
      metaLine("Fecha de sesión histórica", trade.sourceRef?.sessionDate),
      metaLine("Resultado en R", trade.rrRealized),
      metaLine("Entrada", trade.entry),
      trade.lifecycle === Lifecycle.CLOSED ? metaLine("Salida", trade.exit) : null,
      trade.strategy && trade.strategy !== "UNCLASSIFIED" ? metaLine("Estrategia", strategyLabel(trade.strategy)) : null,
      metaLine("Estilo", trade.style),
      metaLine("Variante", trade.variant),
      metaLine("Sesión", sessionLabel(trade.session)),
      metaLine("Cuenta", account ? account.name : "Sin cuenta · histórico"),
      metaLine("Símbolo broker", trade.brokerSymbol),
      metaLine("Apertura", localDateTimeValue(trade.openedAt).replace("T", " ")),
      trade.lifecycle === Lifecycle.CLOSED ? metaLine("Cierre", localDateTimeValue(trade.closedAt).replace("T", " ")) : null,
      metaLine("Cantidad / lotes", trade.lots),
      metaLine("SL inicial", trade.initialSL),
      metaLine("SL actual", trade.currentSL),
      metaLine("TP", trade.tp),
      metaLine("RR planificado", trade.rrPlanned),
      metaLine("Riesgo %", trade.riskPercent),
      metaLine("Riesgo monetario", trade.riskMoney),
      trade.lifecycle === Lifecycle.CLOSED ? metaLine("Comisiones", trade.commission) : null,
      trade.lifecycle === Lifecycle.CLOSED ? metaLine("Swap", trade.swap) : null,
      trade.closeType ? metaLine("Tipo de cierre", trade.closeType) : null,
      ]),
      processSummary(trade.process),
      trade.note ? el("p", { className: "meta", text: `Notas: ${trade.note}` }) : null,
      el("p", { className: "meta origen", text: origenLine(trade) }),
      setup ? el("p", { className: "meta", text: `plannedEntry ${setup.plannedEntry ?? "—"} ≠ actual ${trade.entry}` }) : null,
      el("p", { className: "meta", text: rLabel + " · basado en precios, sin costes" }),
      trade.result ? el("p", { className: "trade-result-summary", text: `${trade.result} · Resultado neto ${trade.netPnl}` }) : null,
      asrLabel ? el("p", { className: "meta", text: asrLabel }) : null,
      trade.lifecycle === Lifecycle.OPEN ? field("Stop Loss actual", sl) : null,
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
      el("p", { className: "meta", text: (att.phase === "BEFORE" ? "ANTES · " : att.phase === "AFTER" ? "DESPUÉS · " : "") + (att.name || "captura") }),
      del,
    ]);
  });
  return el("div", { className: "captures" }, [
    el("p", { className: "kicker", text: "Capturas / Imágenes" }),
    images.length ? el("div", { className: "thumb-row" }, thumbs) : el("p", { className: "meta", text: "Sin capturas." }),
    captureDrop(file, { label: "Agregar captura", onAdded: () => add.click() }),
    el("p", { className: "hint", text: "Pegá con Ctrl+V o arrastrá: se agrega sola. PNG, JPEG o WEBP, máx 8 MB. Local en este dispositivo." }),
  ]);
}

function origenLine(trade) {
  if (trade.sourceRef?.kind === "BACKTEST_JSON") {
    return `origen JSON · ${trade.sourceRef.importId} · resultado declarado: ${trade.sourceRef.declaredResult || "sin completar"}`;
  }
  const pos = trade.sourceRef && trade.sourceRef.mt5Position;
  if (trade.sourceRef?.kind === "TRADOVATE_PERFORMANCE") {
    const gross = trade.sourceRef.grossPnl;
    return `origen Tradovate · ejecuciones ${trade.sourceRef.buyFillId} / ${trade.sourceRef.sellFillId}` + (gross != null ? ` · P&L bruto ${gross}` : "");
  }
  if (trade.sourceRef?.kind === "VANTAGE_POSITION_HISTORY") {
    return `origen Vantage · posición ${pos || "—"}`;
  }
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

function renderEdit(trade, target = "DRAFT") {
  const entryActual = el("input", { className: "input", name: "entryActual", value: trade.entry ?? "", readonly: true });
  const exitActual = el("input", { className: "input", name: "exitActual", value: trade.exit ?? "", readonly: true });
  const draft = trade.isDraft === true;
  const completion = enumSelect(["DRAFT", "OPEN", "CLOSED"], target, "completion", null,
    value => ({ DRAFT: "Conservar borrador", OPEN: "Marcar abierta", CLOSED: "Completar y cerrar" })[value]);
  const importedDraft = draft && trade.context === "BACKTEST" && trade.sourceRef?.kind === "BACKTEST_JSON";
  const assetEdit = el("input", { className: "input", name: "asset", value: trade.asset || "" });
  const directionEdit = enumSelect(["LONG", "SHORT"], trade.direction, "direction", draft ? "Sin completar" : null);
  const execEditable = !draft && executionEditable(trade);
  const closedTrade = trade.lifecycle === Lifecycle.CLOSED;
  const entryEdit = el("input", { className: "input", name: "entry", inputmode: "decimal", value: trade.entry ?? "" });
  const exitEdit = el("input", { className: "input", name: "exit", inputmode: "decimal", value: (draft ? trade.draftExit : trade.exit) ?? "" });
  const netEdit = el("input", { className: "input", name: "netPnl", inputmode: "decimal", value: (draft ? trade.draftNetPnl : trade.netPnl) ?? "" });
  const openedEdit = el("input", { className: "input", name: "openedAt", type: "datetime-local", value: localDateTimeValue(trade.openedAt) });
  const closedEdit = el("input", { className: "input", name: "closedAt", type: "datetime-local", value: localDateTimeValue(draft ? trade.draftClosedAt : trade.closedAt) });
  const commEdit = el("input", { className: "input", name: "commission", inputmode: "decimal", value: trade.commission ?? "" });
  const swapEdit = el("input", { className: "input", name: "swap", inputmode: "decimal", value: trade.swap ?? "" });
  const lotsEdit = el("input", { className: "input", name: "lots", inputmode: "decimal", value: trade.lots ?? "" });
  const strategy = enumSelect(Object.values(Strategy), trade.strategy, "strategy", null, strategyLabel);
  const style = enumSelect(Object.values(Style), trade.style, "style", "—");
  const variant = enumSelect(Object.values(BlueVariant), trade.variant, "variant", "—");
  const session = enumSelect(sessionOptions(trade.session), trade.session, "session", "—", sessionLabel);
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
  const proc = processFields(trade.process);
  const err = el("p", { className: "err", text: "" });
  const save = el("button", { type: "button", text: "Guardar cambios" });
  save.addEventListener("click", async () => {
    if (save.disabled) return;
    save.disabled = true;
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
      if (draft) {
        const next = await completeDraftTrade(trade.id, {
        expectedUpdatedAt: trade.updatedAt,
        ...(importedDraft ? { asset: assetEdit.value, direction: directionEdit.value } : {}),
        entry: entryEdit.value, exit: exitEdit.value, netPnl: netEdit.value,
        openedAt: localDateTimeIso(openedEdit.value, trade.openedAt),
        closedAt: localDateTimeIso(closedEdit.value, trade.draftClosedAt),
        }, patch, completion.value);
        await setTradeProcess(next.id, proc.read());
        go("trade/" + next.id);
        return;
      }
      if (execEditable) {
        await editManualExecution(trade.id, {
          expectedUpdatedAt: trade.updatedAt,
          asset: assetEdit.value, direction: directionEdit.value,
          entry: entryEdit.value, openedAt: localDateTimeIso(openedEdit.value, trade.openedAt), lots: lotsEdit.value,
          ...(closedTrade ? { exit: exitEdit.value, netPnl: netEdit.value, closedAt: localDateTimeIso(closedEdit.value, trade.closedAt), commission: commEdit.value, swap: swapEdit.value } : {}),
        });
      }
      const next = await enrichTrade(trade.id, patch);
      await setTradeProcess(next.id, proc.read());
      go("trade/" + next.id);
      toast("Cambios guardados.", { tone: "ok", timeout: 2500 });
    } catch (e) {
      err.textContent = e.message;
      save.disabled = false;
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
    stateBadge(trade),
    draft ? field("Guardar como", choiceButtons(completion, "Estado del borrador")) : null,
    el("p", { className: "hint", text: "Las horas se interpretan en la zona del dispositivo: " + Intl.DateTimeFormat().resolvedOptions().timeZone }),
    el("p", { className: "hint", text: draft ? "Completá el borrador a tu ritmo. Guardar cambios no lo convierte en una operación ejecutada."
      : execEditable ? "Podés corregir cualquier dato. El resultado (WIN / LOSS / BE) se recalcula con el neto."
      : isMt5Trade(trade) ? "Importada de MT5: precios, fechas y neto vienen del broker y no se tocan. Podés completar el análisis y la gestión."
      : "Los precios y las fechas de ejecución se conservan. Podés completar el análisis y la gestión." }),
    execEditable ? tradeSection("1. Ejecución", [
      field("Activo", assetEdit),
      field("Dirección", choiceButtons(directionEdit, "Dirección")),
      field("Fecha y hora de entrada", openedEdit),
      field("Precio de entrada", entryEdit),
      field("Lotes", lotsEdit),
      closedTrade ? field("Fecha y hora de cierre", closedEdit) : null,
      closedTrade ? field("Precio de salida", exitEdit) : null,
      closedTrade ? field("Resultado neto", netEdit) : null,
      closedTrade ? field("Comisión", commEdit) : null,
      closedTrade ? field("Swap", swapEdit) : null,
    ]) : tradeSection("1. Ejecución", [
    importedDraft ? field("Activo", assetEdit) : null,
    importedDraft ? field("Dirección", choiceButtons(directionEdit, "Dirección")) : null,
    draft ? field("Entrada (borrador)", entryEdit) : field("Entrada (solo lectura)", entryActual),
    draft ? field("Fecha de entrada", openedEdit) : null,
    draft ? field("Salida prevista/observada (borrador)", exitEdit) : null,
    draft ? field("PnL (borrador)", netEdit) : null,
    draft ? field("Fecha de cierre (borrador)", closedEdit) : null,
    trade.lifecycle === Lifecycle.CLOSED ? field("Salida (solo lectura)", exitActual) : null,
    ]),
    tradeSection("2. Plan y riesgo", [
    field("SL inicial", sl),
    field("TP", tp),
    field("RR planificado", rr),
    field("Riesgo %", riskPct),
    field("Riesgo $ / €", riskMoney),
    field("Hubo cierres parciales", partials),
    ]),
    tradeSection("3. Clasificación", [
    field("Estilo", style),
    field("Sesión", choiceButtons(session, "Sesión")),
    el("details", { className: "legacy-filters trade-field-wide" }, [el("summary", { text: "Sistema de colores (anterior)" }), field("Estrategia", strategy), field("Variante", variant)]),
    ]),
    tradeSection("Proceso y emociones", [el("div", { className: "trade-field-wide" }, [proc.node])]),
    el("details", { className: "trade-extra" }, [
      el("summary", { text: "Gestión y notas" }),
      field("Gestión", mgmt), field("Notas y aprendizaje", note),
    ]),
  ];
  if (trade.lifecycle === Lifecycle.CLOSED) nodes.push(field("Tipo de cierre", closeType));
  nodes.push(err);
  nodes.push(el("div", { className: "row-actions" }, [save, cancel]));
  return [el("section", { className: "panel form trade-form" }, nodes)];
}

function renderQuickEdit(trade) {
  const date = el("input", { className: "input", type: "date", name: "sessionDate", value: trade.sourceRef?.sessionDate || "" });
  const asset = el("input", { className: "input", name: "asset", value: trade.asset || "" });
  const direction = enumSelect(["LONG", "SHORT"], trade.direction, "direction", null);
  const result = enumSelect(["WIN", "LOSS", "BE"], trade.result, "result", null);
  const r = el("input", { className: "input", name: "rrRealized", type: "number", step: "any", value: trade.rrRealized ?? "", placeholder: "Ej.: 2 o -1" });
  const strategy = enumSelect(Object.values(Strategy), trade.strategy || Strategy.UNCLASSIFIED, "strategy", null, strategyLabel);
  const style = enumSelect(Object.values(Style), trade.style, "style", "—");
  const session = enumSelect(sessionOptions(trade.session), trade.session, "session", "—", sessionLabel);
  const note = el("textarea", { className: "input", name: "note", rows: "3" });
  note.value = trade.note || "";
  const proc = processFields(trade.process, { emotion: false });
  const err = el("p", { className: "err", role: "alert" });
  const save = el("button", { type: "button", text: "Guardar cambios" });
  save.addEventListener("click", async () => {
    if (save.disabled) return;
    save.disabled = true; err.textContent = "";
    try {
      const input = { sessionDate: date.value, asset: asset.value, direction: direction.value, result: result.value, rrRealized: r.value };
      const similar = await findSimilarQuickBacktest(input, trade.id);
      if (similar && !(await confirmDialogLazy(similar))) { save.disabled = false; return; }
      await editQuickBacktest(trade.id, { ...input, expectedUpdatedAt: trade.updatedAt,
        strategy: strategy.value, style: style.value || null, session: session.value || null, note: note.value });
      await setTradeProcess(trade.id, proc.read());
      go("trade/" + trade.id);
      toast("Backtest actualizado.", { tone: "ok", timeout: 2500 });
    } catch (e) { err.textContent = e.message; save.disabled = false; }
  });
  return [el("section", { className: "panel form trade-form" }, [
    el("p", { className: "kicker", text: "Editar backtest" }),
    el("h1", { text: `${trade.asset} ${trade.direction}` }),
    tradeSection("Backtest", [
      field("Fecha de sesión", date), field("Activo", asset),
      field("Dirección", choiceButtons(direction, "Dirección")),
      field("Resultado", choiceButtons(result, "Resultado")),
      field("Resultado en R (opcional)", r),
    ]),
    tradeSection("Proceso", [el("div", { className: "trade-field-wide" }, [proc.node])]),
    tradeSection("Clasificación (opcional)", [
      field("Estilo", style), field("Sesión", choiceButtons(session, "Sesión")),
      el("details", { className: "legacy-filters trade-field-wide" }, [el("summary", { text: "Sistema de colores (anterior)" }), field("Estrategia", strategy)]),
    ]),
    field("Notas", note),
    err,
    el("div", { className: "row-actions" }, [
      el("button", { type: "button", className: "ghost", text: "Cancelar", onclick: () => go("trade/" + trade.id) }),
      save,
    ]),
  ])];
}

async function confirmDialogLazy(similar) {
  return confirmDialog({
    title: "Parece repetido",
    body: ["Con estos cambios queda igual a otro registro:", el("p", { className: "rgm-dialog-target", text: describeRecord(similar) }), "¿Guardar igual?"],
    confirmText: "Guardar igual", cancelText: "No, revisar",
  });
}

function renderClose(trade) {
  const exit = el("input", { className: "input", value: trade.draftExit ?? "" });
  const closedAt = el("input", { className: "input", type: "datetime-local", value: localDateTimeValue(trade.draftClosedAt) });
  const net = el("input", { className: "input", value: trade.draftNetPnl ?? "" });
  const comm = el("input", { className: "input", value: trade.draftCommission ?? "" });
  const swap = el("input", { className: "input", value: trade.draftSwap ?? "" });
  const closeType = el("select", { className: "input" }, Object.values(CloseType).map((c) => el("option", { value: c, text: c })));
  closeType.value = trade.draftCloseType || CloseType.MANUAL;
  const mgmt = el("textarea", { className: "input", rows: "2" });
  mgmt.value = trade.management || "";
  const partials = partialsSelect(trade.hasPartials);
  const err = el("p", { className: "err", text: "" });
  const save = el("button", { type: "button", text: "Cerrar" });
  save.addEventListener("click", async () => {
    if (save.disabled) return;
    save.disabled = true;
    err.textContent = "";
    try {
      await closeTrade(trade.id, {
        exit: exit.value,
        closedAt: localDateTimeIso(closedAt.value, trade.draftClosedAt),
        netPnl: net.value,
        commission: comm.value,
        swap: swap.value,
        closeType: closeType.value,
        declaredBe: closeType.value === CloseType.BE,
        management: mgmt.value,
        hasPartials: partials.value === "true",
      });
      go("trade/" + trade.id);
    } catch (e) { err.textContent = e.message; save.disabled = false; }
  });
  return [
    el("section", { className: "panel form trade-form" }, [
      el("h1", { text: "Cerrar operación" }),
      stateBadge(trade),
      tradeSection("Resultado y costes", [
      field("Precio de salida", exit),
      field("Fecha y hora de cierre", closedAt),
      field("Resultado neto", net),
      field("comisión", comm),
      field("swap", swap),
      field("motivo de cierre", choiceButtons(closeType, "Motivo de cierre")),
      field("Hubo cierres parciales", partials),
      field("gestión (nota)", mgmt),
      ]),
      el("p", { className: "hint", text: "netPnl es el número de performance. commission/swap se guardan; no se vuelven a restar." }),
      err,
      save,
      el("button", { type: "button", className: "ghost", text: "Cancelar", onclick: () => go("trade/" + trade.id) }),
    ]),
  ];
}

function renderAsr(trade, asr) {
  const form = asrFields(asr);
  const err = el("p", { className: "err", text: "" });
  const save = el("button", { type: "button", text: "Guardar revisión" });
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
      el("p", { className: "kicker", text: asr ? "Ver / editar revisión" : "Revisar operación" }),
      el("h1", { text: `${trade.asset} ${trade.direction}` }),
      el("p", { className: "hint", text: "Indicá si repetirías la operación y qué aprendiste. Los demás campos son opcionales." }),
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
  const save = el("button", { type: "button", text: "Anular operación" });
  save.addEventListener("click", async () => {
    try {
      await voidTrade(trade.id, reason.value);
      go("trade/" + trade.id);
    } catch (e) { err.textContent = e.message; }
  });
  return [
    el("section", { className: "panel" }, [
      el("h1", { text: "Anular operación" }),
      el("p", { className: "hint", text: "¿Seguro que querés anular esta operación? Quedará marcada como VOID y dejará de considerarse una operación válida del Journal." }),
      field("voidReason", reason),
      err,
      el("div", { className: "row-actions" }, [
        el("button", { type: "button", className: "ghost", text: "Cancelar", onclick: () => go("trade/" + trade.id) }),
        save,
      ]),
    ]),
  ];
}

function processSummary(p) {
  if (!p) return null;
  const chip = (text, tone = "") => el("span", { className: "proc-chip " + tone, text });
  const items = [];
  if (p.family) items.push(chip(labelOf(FAMILIES, p.family), "is-family"));
  if (p.plan) items.push(chip("Plan: " + labelOf(PLAN, p.plan), p.plan === "YES" ? "is-good" : p.plan === "NO" ? "is-bad" : "is-mid"));
  if (p.emotion) items.push(chip(labelOf(EMOTIONS, p.emotion)));
  for (const c of p.confluences || []) items.push(chip(labelOf(CONFLUENCES, c), "is-conf"));
  for (const e of p.errors || []) items.push(chip(labelOf(ERRORS, e), "is-bad"));
  return items.length ? el("div", { className: "proc-summary", "aria-label": "Proceso" }, items) : null;
}
