import { el } from "../render.js";
import { field } from "../forms/observation.js";
import { getSetup } from "../../storage/repos/setups.js";
import { createTrade, createClosedTrade, enrichTrade } from "../../domain/trade.js";
import { getActiveAccount, listStageAccounts, visibleActiveAccount } from "../../domain/account.js";
import { go } from "../router.js";
import { Context, Direction, Strategy, Style, CloseType, BlueVariant, Lifecycle, strategyLabel } from "../../domain/enums.js";
import { ROADMAP_ASSETS, SESSIONS } from "../../config.js";
import { normalizeAsset } from "../../domain/integrity.js";
import { previewTradeR } from "../../domain/trade-rr-preview.js";
import { addTradeImage, ATTACHMENT_MAX_BYTES, IMAGE_MIMES } from "../../storage/repos/attachments.js";

function select(values, current) {
  const node = el("select", { className: "input" }, values.map(([v, l]) => el("option", { value: v, text: l })));
  node.value = current || values[0][0];
  return node;
}

function contextLabel(ctx) {
  return ctx === Context.PROP_CHALLENGE ? "PROP" : ctx;
}

function localDateTimeValue(date = new Date()) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formSection(title, description, children, extra = "") {
  return el("section", { className: ("trade-form-section " + extra).trim() }, [
    el("div", { className: "trade-section-heading" }, [
      el("h2", { text: title }),
      description ? el("p", { className: "hint", text: description }) : null,
    ]),
    el("div", { className: "trade-fields-grid" }, children),
  ]);
}

export async function renderNuevoTrade(ctx) {
  const setupId = ctx.route.rest.startsWith("trade/") ? ctx.route.rest.slice("trade/".length) : "";
  const dedicatedBacktest = !setupId && ctx.route.query && ctx.route.query.context === Context.BACKTEST;
  const setup = setupId ? await getSetup(setupId) : null;
  const accounts = await listStageAccounts(ctx.stage.id);
  const active = await getActiveAccount();
  const initialContext = setup ? setup.context : Context.BACKTEST;
  const suggest = [];
  const seen = new Set();
  for (const a of ROADMAP_ASSETS) {
    if (!seen.has(a.id)) { seen.add(a.id); suggest.push(a.id); }
  }
  for (const extra of ["NZDJPY", "GBPUSD", "USDJPY", "GER40", "NAS100"]) {
    if (!seen.has(extra)) { seen.add(extra); suggest.push(extra); }
  }
  const asset = el("input", {
    className: "input",
    name: "asset",
    list: "nuevo-asset-suggest",
    value: setup ? setup.asset : "",
    autocomplete: "off",
  });
  const assetList = el("datalist", { id: "nuevo-asset-suggest" }, suggest.map((s) => el("option", { value: s })));
  const lifecycle = select([[Lifecycle.OPEN, "OPEN"], [Lifecycle.CLOSED, "CLOSED"]], Lifecycle.OPEN);
  lifecycle.setAttribute("name", "lifecycle");
  if (dedicatedBacktest) lifecycle.value = Lifecycle.CLOSED;
  const context = select(Object.values(Context).map((c) => [c, contextLabel(c)]), initialContext);
  const contextField = field("Contexto", context);
  contextField.hidden = dedicatedBacktest;
  if (dedicatedBacktest) {
    context.value = Context.BACKTEST;
    context.disabled = true;
  }
  const direction = select(Object.values(Direction).map((d) => [d, d]), setup ? setup.direction : Direction.LONG);
  direction.setAttribute("name", "direction");
  const strategy = select(Object.values(Strategy).map((s) => [s, strategyLabel(s)]), setup ? setup.strategy : Strategy.UNCLASSIFIED);
  strategy.setAttribute("name", "strategy");
  const style = select([["", "—"]].concat(Object.values(Style).map((s) => [s, s])), setup && setup.style ? setup.style : "");
  style.setAttribute("name", "style");
  const variant = select([["", "—"]].concat(Object.values(BlueVariant).map((s) => [s, s])), "");
  variant.setAttribute("name", "variant");
  const session = select([["", "—"]].concat(SESSIONS.map((s) => [s, s])), "");
  session.setAttribute("name", "session");
  const openedAt = el("input", { className: "input", type: "datetime-local", name: "openedAt", value: dedicatedBacktest ? "" : localDateTimeValue() });
  const closedAt = el("input", { className: "input", type: "datetime-local", name: "closedAt", value: dedicatedBacktest ? "" : localDateTimeValue() });
  const entry = el("input", { className: "input", name: "entry", value: "" });
  const sl = el("input", { className: "input", name: "initialSL", value: "" });
  const tp = el("input", { className: "input", name: "tp", value: "" });
  const rr = el("input", { className: "input", name: "rrPlanned", value: "" });
  const riskPct = el("input", { className: "input", name: "riskPercent", value: "" });
  const riskMoney = el("input", { className: "input", name: "riskMoney", value: "" });
  const lots = el("input", { className: "input", name: "lots", value: "" });
  const exit = el("input", { className: "input", name: "exit", value: "" });
  const net = el("input", { className: "input", name: "netPnl", value: "" });
  const comm = el("input", { className: "input", name: "commission", value: "" });
  const swap = el("input", { className: "input", name: "swap", value: "" });
  const closeType = select(Object.values(CloseType).map((c) => [c, c]), CloseType.UNKNOWN);
  closeType.setAttribute("name", "closeType");
  const broker = el("input", { className: "input", value: "" });
  const mgmt = el("textarea", { className: "input", name: "management", rows: "2" });
  const note = el("textarea", { className: "input", name: "note", rows: "2" });
  const partials = select([["false", "No"], ["true", "Sí"]], "false");
  partials.setAttribute("name", "hasPartials");
  const accountPick = el("select", { className: "input" });
  const accountField = field("Cuenta", accountPick);
  const hint = el("p", { className: "hint", text: "" });
  const err = el("p", { className: "err", text: "", role: "alert" });
  const recovery = el("button", { type: "button", className: "ghost", text: "Abrir registro guardado" });
  recovery.hidden = true;
  const closedBlock = el("div", { className: "closed-only" });

  function paintAccounts() {
    const ctxVal = context.value;
    accountField.hidden = ctxVal === Context.BACKTEST;
    accountPick.replaceChildren();
    if (ctxVal === Context.BACKTEST) {
      accountPick.append(el("option", { value: "", text: "sin account (BACKTEST)" }));
      accountPick.disabled = true;
      hint.textContent = "Modo histórico: esta prueba no afecta el balance de ninguna cuenta.";
      return;
    }
    accountPick.disabled = false;
    const compatible = accounts.filter((a) => a.context === ctxVal);
    accountPick.append(el("option", { value: "", text: compatible.length ? "elegí account" : "no hay account compatible" }));
    for (const a of compatible) {
      accountPick.append(el("option", { value: a.id, text: `${a.name} · ${contextLabel(a.context)}` }));
    }
    const pre = visibleActiveAccount(active, ctxVal);
    if (pre && compatible.some((a) => a.id === pre.id)) {
      accountPick.value = pre.id;
      hint.textContent = `Account activa preseleccionada (${pre.name}). Podés cambiarla.`;
    } else if (!compatible.length) {
      hint.textContent = `Falta una Account ${contextLabel(ctxVal)} activa. Creala en Cuentas.`;
    } else {
      hint.textContent = "Elegí Account. No se asigna en silencio.";
    }
  }
  context.addEventListener("change", paintAccounts);
  paintAccounts();

  const rrPreview = el("div", { className: "trade-rr-preview", "aria-live": "polite", role: "status" }, [
    el("div", { className: "trade-rr-item" }, [
      el("span", { text: "RR planificado" }),
      el("strong", { className: "trade-rr-planned", text: "—" }),
    ]),
    el("div", { className: "trade-rr-item" }, [
      el("span", { text: "R realizado (precio)" }),
      el("strong", { className: "trade-rr-realized", text: "—" }),
    ]),
    el("p", { className: "hint", text: "Relación precio / stop. No incluye comisiones, spread ni el resultado monetario." }),
  ]);
  const plannedOut = rrPreview.querySelector(".trade-rr-planned");
  const realizedOut = rrPreview.querySelector(".trade-rr-realized");
  const readR = () => previewTradeR({
    direction: direction.value, entry: entry.value, sl: sl.value, tp: tp.value,
    exit: exit.value, lifecycle: lifecycle.value, hasPartials: partials.value === "true",
  });
  function refreshRR() {
    const current = readR();
    plannedOut.textContent = current.planned == null ? "—" : current.planned.toFixed(2) + "R";
    realizedOut.textContent = current.realized == null ? "—" : current.realized.toFixed(2) + "R";
  }
  [entry, sl, tp, exit, direction, lifecycle, partials].forEach((control) => {
    control.addEventListener("input", refreshRR);
    control.addEventListener("change", refreshRR);
  });
  refreshRR();

  closedBlock.className = "trade-form-section trade-result";
  closedBlock.append(
    el("div", { className: "trade-section-heading" }, [
      el("h2", { text: "3. Resultado de la operación" }),
      el("p", { className: "hint", text: "El R realizado se calcula con los precios. El resultado monetario se ingresa manualmente hasta contar con las especificaciones del instrumento." }),
    ]),
    el("div", { className: "trade-fields-grid" }, [
      field("Fecha y hora de cierre", closedAt),
      field("Precio de salida", exit),
      field("Resultado neto (moneda de la cuenta o simulado)", net),
      field("Tipo de cierre", closeType),
    ]),
  );

  function paintLifecycle() {
    const closed = lifecycle.value === Lifecycle.CLOSED;
    closedBlock.hidden = !closed;
    save.textContent = dedicatedBacktest ? "Guardar backtest" : "Guardar operación";
    refreshRR();
  }
  lifecycle.addEventListener("change", paintLifecycle);

  const capturesBefore = el("input", {
    type: "file", className: "input", name: "capture-before",
    accept: IMAGE_MIMES.join(","), multiple: true,
  });
  const capturesAfter = el("input", {
    type: "file", className: "input", name: "capture-after",
    accept: IMAGE_MIMES.join(","), multiple: true,
  });
  const captureCount = el("p", { className: "hint", text: "Elegí hasta 6 imágenes PNG, JPEG o WEBP de un máximo de 8 MB cada una." });
  function selectedCaptures() {
    return [
      ...Array.from(capturesBefore.files || []).map((file) => ({ file, phase: "BEFORE" })),
      ...Array.from(capturesAfter.files || []).map((file) => ({ file, phase: "AFTER" })),
    ];
  }
  function updateCaptureCount() {
    const chosen = selectedCaptures();
    captureCount.textContent = chosen.length
      ? chosen.length + " imagen(es) seleccionada(s), que se guardarán con el backtest."
      : "Elegí hasta 6 imágenes PNG, JPEG o WEBP de un máximo de 8 MB cada una.";
  }
  [capturesBefore, capturesAfter].forEach((control) => control.addEventListener("change", updateCaptureCount));

  function validateCaptures(chosen) {
    if (chosen.length > 6) throw new Error("Elegí como máximo 6 capturas por backtest.");
    for (const { file } of chosen) {
      if (!IMAGE_MIMES.includes(file.type)) throw new Error("Las capturas deben ser PNG, JPEG o WEBP.");
      if (!file.size || file.size > ATTACHMENT_MAX_BYTES) {
        throw new Error("Cada captura debe pesar entre 1 byte y 8 MB.");
      }
    }
  }
  async function persistCaptures(trade, chosen) {
    for (const { file, phase } of chosen) {
      await addTradeImage(trade.id, {
        blob: file, name: file.name, mime: file.type, size: file.size, phase,
      });
    }
  }

  const evidence = dedicatedBacktest ? formSection(
    "4. Capturas del gráfico",
    "Podés seleccionar varias imágenes. Se guardarán con el registro y podrás consultarlas desde su ficha.",
    [
      field("Antes / contexto", capturesBefore),
      field("Después / resultado", capturesAfter),
      el("div", { className: "trade-field-wide" }, [captureCount]),
    ],
    "trade-evidence"
  ) : null;

  const save = el("button", { type: "button", text: "Guardar operación", className: "trade-form-submit" });
  paintLifecycle();
  save.addEventListener("click", async () => {
    if (save.disabled) return;
    save.disabled = true;
    err.textContent = "";
    let persistedTrade = null;
    try {
      const chosen = dedicatedBacktest ? selectedCaptures() : [];
      validateCaptures(chosen);
      if (dedicatedBacktest && !openedAt.value) throw new Error("Elegí la fecha y hora histórica de entrada.");
      const assetVal = normalizeAsset(asset.value);
      if (!assetVal) throw new Error("asset requerido");
      if (context.value !== Context.BACKTEST && !accountPick.value) {
        throw new Error("elegí una Account compatible o creá una en Cuentas");
      }
      const openedIso = openedAt.value ? new Date(openedAt.value).toISOString() : undefined;
      if (lifecycle.value === Lifecycle.CLOSED) {
        if (!closedAt.value) throw new Error("Ingresá la fecha y hora de cierre.");
        if (!exit.value) throw new Error("exit requerido");
        if (net.value === "") throw new Error("netPnl requerido");
        const closedIso = new Date(closedAt.value).toISOString();
        if (openedIso && closedIso < openedIso) throw new Error("closedAt no puede ser anterior a openedAt");
        const trade = await createClosedTrade({
          asset: assetVal,
          brokerSymbol: broker.value,
          context: context.value,
          direction: direction.value,
          strategy: strategy.value,
          style: style.value || null,
          variant: variant.value || null,
          session: session.value || null,
          accountId: context.value === Context.BACKTEST ? null : accountPick.value,
          openedAt: openedIso,
          closedAt: closedIso,
          entry: entry.value,
          initialSL: sl.value,
          tp: tp.value,
          rrPlanned: dedicatedBacktest && readR().planned != null ? readR().planned : rr.value,
          exit: exit.value,
          netPnl: net.value,
          commission: comm.value,
          swap: swap.value,
          closeType: closeType.value,
          management: mgmt.value || null,
          note: note.value || null,
          setupId: setup ? setup.id : null,
          hasPartials: partials.value === "true",
          riskPercent: riskPct.value,
          riskMoney: riskMoney.value,
          lots: lots.value,
        }, ctx.stage.id);
        persistedTrade = trade;
        await persistCaptures(trade, chosen);
        go("trade/" + trade.id + (dedicatedBacktest ? "?from=backtesting" : ""));
        return;
      }
      const trade = await createTrade({
        asset: assetVal,
        brokerSymbol: broker.value,
        context: context.value,
        direction: direction.value,
        accountId: context.value === Context.BACKTEST ? null : accountPick.value,
        openedAt: openedIso,
        entry: entry.value,
        initialSL: sl.value,
        setupId: setup ? setup.id : null,
        hasPartials: partials.value === "true",
        riskPercent: riskPct.value,
        riskMoney: riskMoney.value,
        lots: lots.value,
      }, ctx.stage.id);
      persistedTrade = trade;
      const journal = {
        strategy: strategy.value,
        style: style.value || null,
        variant: variant.value || null,
        session: session.value || null,
        tp: tp.value,
        rrPlanned: dedicatedBacktest && readR().planned != null ? readR().planned : rr.value,
        management: mgmt.value || null,
        note: note.value || null,
        riskPercent: riskPct.value,
        riskMoney: riskMoney.value,
      };
      const enriched = await enrichTrade(trade.id, journal);
      await persistCaptures(enriched, chosen);
      go("trade/" + enriched.id + (dedicatedBacktest ? "?from=backtesting" : ""));
    } catch (e) {
      if (persistedTrade) {
        err.textContent = "El registro ya se guardó. No lo vuelvas a crear. Hubo un problema con los datos adicionales o capturas: " + e.message;
        recovery.hidden = false;
        recovery.addEventListener("click", () => go("trade/" + persistedTrade.id), { once: true });
      } else {
        err.textContent = e.message;
        save.disabled = false;
      }
    }
  });

  const refs = [];
  if (setup) {
    refs.push(el("p", { className: "hint", text: "Referencia del Setup. plannedEntry no se copia al entry." }));
    refs.push(el("p", { className: "meta", text: `plannedEntry ${setup.plannedEntry ?? "—"} · plannedSL ${setup.plannedSl ?? "—"} · plannedTP ${setup.plannedTp ?? "—"}` }));
  }

  const extra = el("details", { className: "trade-extra" }, [
    el("summary", { text: "Detalles adicionales · estrategia, sesión, costes y notas" }),
    el("p", { className: "hint", text: "Estos campos son opcionales. Usalos para documentar el contexto y mejorar tus estadísticas." }),
    el("div", { className: "trade-fields-grid" }, [
      field("Estrategia", strategy),
      field("Estilo", style),
      field("Variante", variant),
      field("Sesión", session),
      field("Símbolo del broker", broker),
      field("Riesgo (%)", riskPct),
      field("RR planificado", rr),
      field("Comisiones", comm),
      field("Swap", swap),
      field("Cierres parciales", partials),
      el("div", { className: "trade-field-wide" }, [field("Gestión de la operación", mgmt)]),
      el("div", { className: "trade-field-wide" }, [field("Notas y aprendizaje", note)]),
    ]),
  ]);

  return [
    el("section", { className: "panel form trade-form" }, [
      el("div", { className: "trade-form-intro" }, [
        el("p", { className: "kicker", text: dedicatedBacktest ? "Backtesting / Registro histórico" : "Journal / Registro" }),
        el("h1", { text: dedicatedBacktest ? "Registrar backtest" : (setup ? "Operación desde idea" : "Registrar operación") }),
        el("p", { className: "hint", text: dedicatedBacktest
          ? "Guardá una operación simulada del pasado. No modifica cuentas ni saldos reales."
          : "Registrá los datos básicos ahora. Podés completar el análisis en detalles adicionales." }),
        ...refs,
      ]),
      formSection("1. Identificación", "Seleccioná el mercado, la dirección y el estado de la operación.", [
        field("Activo / símbolo", asset),
        field("Dirección", direction),
        field("Estado", lifecycle),
        contextField,
        accountField,
        field("Fecha y hora de entrada", openedAt),
      ]),
      assetList,
      formSection("2. Plan y niveles", "Primero los precios y el stop técnico; después, el tamaño y el riesgo.", [
        field("Entrada", entry),
        field("Stop Loss (SL)", sl),
        field("Take Profit (TP)", tp),
        field("Lotaje / cantidad", lots),
        field("Riesgo monetario", riskMoney),
        dedicatedBacktest ? el("div", { className: "trade-field-wide" }, [rrPreview]) : null,
      ]),
      closedBlock,
      evidence,
      extra,
      hint,
      err,
      recovery,
      el("div", { className: "trade-form-footer" }, [
        el("button", {
          type: "button", className: "ghost",
          text: dedicatedBacktest ? "Volver a Backtesting" : "Volver a Operaciones",
          onclick: () => go(dedicatedBacktest ? "backtesting" : "historial"),
        }),
        save,
      ]),
    ]),
  ];
}
