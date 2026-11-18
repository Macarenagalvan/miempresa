import { quickBacktest } from "./backtest-quick.js";
import { label } from "../journal-insights.js";
import { choiceButtons } from "../forms/choice-buttons.js";
import { assertExecution } from "../../domain/execution.js";
import { localDateTimeIso } from "../trade-presentation.js";
import { el } from "../render.js";
import { field } from "../forms/observation.js";
import { getSetup } from "../../storage/repos/setups.js";
import { createTrade, createClosedTrade, enrichTrade } from "../../domain/trade.js";
import { findSimilarTrade, describeRecord } from "../../domain/duplicates.js";
import { confirmDialog } from "../feedback.js";
import { getActiveAccount, listStageAccounts, visibleActiveAccount, createAccount } from "../../domain/account.js";
import { toast } from "../feedback.js";
import { captureDrop } from "../capture-drop.js";
import { processFields } from "../forms/process-fields.js";
import { planWarning } from "../plan-status.js";
import { setTradeProcess, normalizeProcess } from "../../domain/process.js";

const LAST_TRADE = "rgm.trade.last";
function readLastTrade() { try { return JSON.parse(localStorage.getItem(LAST_TRADE) || "{}") || {}; } catch (_) { return {}; } }
function writeLastTrade(v) { try { localStorage.setItem(LAST_TRADE, JSON.stringify(v)); } catch (_) { /* sin almacenamiento */ } }
import { go } from "../router.js";
import { Context, Direction, Strategy, Style, CloseType, BlueVariant, Lifecycle, strategyLabel } from "../../domain/enums.js";
import { ROADMAP_ASSETS, SESSIONS, sessionLabel } from "../../config.js";
import { normalizeAsset } from "../../domain/integrity.js";
import { previewTradeR } from "../../domain/trade-rr-preview.js";
import { addTradeImage, ATTACHMENT_MAX_BYTES, IMAGE_MIMES } from "../../storage/repos/attachments.js";

function select(values, current) {
  const node = el("select", { className: "input" }, values.map(([v, l]) => el("option", { value: v, text: l })));
  node.value = current || values[0][0];
  return node;
}

function contextLabel(ctx) {
  return label(ctx);
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
  if (ctx.route.query?.context === "BACKTEST" && !ctx.route.rest.startsWith("trade/")) return [quickBacktest(ctx)];
  const setupId = ctx.route.rest.startsWith("trade/") ? ctx.route.rest.slice("trade/".length) : "";
  const mode = ctx.route.query?.mode;
  const dedicatedBacktest = !setupId && ctx.route.query && ctx.route.query.context === Context.BACKTEST && mode !== "simulated";
  const setup = setupId ? await getSetup(setupId) : null;
  const accounts = await listStageAccounts(ctx.stage.id);
  const active = await getActiveAccount();
  const planNote = dedicatedBacktest ? null : await planWarning(ctx);
  const last = setupId ? {} : readLastTrade();
  const initialContext = setup ? setup.context : (dedicatedBacktest || mode === "simulated" ? (ctx.route.query?.context === "DEMO" ? Context.DEMO : Context.BACKTEST) : mode === "real" ? (accounts.find(a => a.context !== "DEMO")?.context || Context.LIVE) : (last.context && last.context !== Context.BACKTEST ? last.context : (active?.context || accounts[0]?.context || Context.LIVE)));
  const historical = () => context.value === Context.BACKTEST;
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
    value: setup ? setup.asset : (last.asset || ""),
    autocomplete: "off",
  });
  const assetList = el("datalist", { id: "nuevo-asset-suggest" }, suggest.map((s) => el("option", { value: s })));
  const lifecycle = select([["DRAFT", "Borrador · completar después"], [Lifecycle.OPEN, "Abierta"], [Lifecycle.CLOSED, "Cerrada"]], Lifecycle.OPEN);
  lifecycle.setAttribute("name", "lifecycle");
  if (initialContext === Context.BACKTEST) lifecycle.value = Lifecycle.CLOSED;
  const contexts = mode === "simulated" ? [Context.BACKTEST, Context.DEMO] : mode === "real" ? [Context.LIVE, Context.PROP_CHALLENGE, Context.FUNDED] : Object.values(Context);
  const context = select(contexts.map((c) => [c, contextLabel(c)]), initialContext);
  context.name = "context";
  const contextField = field("Contexto", choiceButtons(context, "Contexto"));
  contextField.hidden = dedicatedBacktest;
  if (dedicatedBacktest) {
    context.value = Context.BACKTEST;
    context.disabled = true;
  }
  const direction = select(Object.values(Direction).map((d) => [d, label(d)]), setup ? setup.direction : Direction.LONG);
  direction.setAttribute("name", "direction");
  const strategy = select(Object.values(Strategy).map((s) => [s, strategyLabel(s)]), setup ? setup.strategy : Strategy.UNCLASSIFIED);
  strategy.setAttribute("name", "strategy");
  const style = select([["", "—"]].concat(Object.values(Style).map((s) => [s, s])), setup && setup.style ? setup.style : "");
  style.setAttribute("name", "style");
  const variant = select([["", "—"]].concat(Object.values(BlueVariant).map((s) => [s, s])), "");
  variant.setAttribute("name", "variant");
  const session = select([["", "—"]].concat(SESSIONS.map((s) => [s, sessionLabel(s)])), "");
  session.setAttribute("name", "session");
  const openedAt = el("input", { className: "input", type: "datetime-local", name: "openedAt", value: historical() ? "" : localDateTimeValue() });
  const closedAt = el("input", { className: "input", type: "datetime-local", name: "closedAt", value: historical() ? "" : localDateTimeValue() });
  context.addEventListener("change", () => { openedAt.value = ""; closedAt.value = ""; });
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
  accountPick.name = "accountId";
  const createAcc = el("button", { type: "button", className: "ghost account-create", text: "+ Crear cuenta" });
  createAcc.addEventListener("click", async () => {
    const made = await quickAccountDialog(context.value, ctx.stage.id);
    if (made) { accounts.push(made); paintAccounts(); accountPick.value = made.id; hint.textContent = `Cuenta «${made.name}» creada y elegida.`; }
  });
  const accountField = field("Cuenta", el("div", { className: "account-pick" }, [accountPick, createAcc]));
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
    accountPick.append(el("option", { value: "", text: compatible.length ? "Elegí una cuenta" : "No hay cuentas de este tipo" }));
    for (const a of compatible) {
      accountPick.append(el("option", { value: a.id, text: `${a.name} · ${contextLabel(a.context)}` }));
    }
    const pre = compatible.find((a) => a.id === last.accountId) || visibleActiveAccount(active, ctxVal) || (compatible.length === 1 ? compatible[0] : null);
    if (pre && compatible.some((a) => a.id === pre.id)) {
      accountPick.value = pre.id;
      hint.textContent = `Cuenta preseleccionada: ${pre.name}. Podés cambiarla.`;
    } else if (!compatible.length) {
      hint.textContent = `Todavía no tenés una cuenta ${contextLabel(ctxVal)}. Tocá «+ Crear cuenta» y seguís acá mismo.`;
    } else {
      hint.textContent = "Elegí la cuenta a la que pertenece esta operación.";
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
      field("Tipo de cierre", choiceButtons(closeType, "Tipo de cierre")),
    ]),
  );

  function paintLifecycle() {
    const closed = lifecycle.value === Lifecycle.CLOSED;
    closedBlock.hidden = !closed;
    save.textContent = lifecycle.value === "DRAFT" ? "Guardar borrador" : (historical() ? "Guardar backtest" : "Guardar operación");
    refreshRR();
  }
  lifecycle.addEventListener("change", paintLifecycle);
  context.addEventListener("change", paintLifecycle);

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
      ? chosen.length + " imagen(es) seleccionada(s), que se guardarán con la operación."
      : "Elegí hasta 6 imágenes PNG, JPEG o WEBP de un máximo de 8 MB cada una.";
  }
  [capturesBefore, capturesAfter].forEach((control) => control.addEventListener("change", updateCaptureCount));

  function validateCaptures(chosen) {
    if (chosen.length > 6) throw new Error("Elegí como máximo 6 capturas por operación.");
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

  const evidence = formSection(
    "4. Capturas del gráfico",
    "Podés seleccionar varias imágenes. Se guardarán con el registro y podrás consultarlas desde su ficha.",
    [
      field("Antes / contexto", captureDrop(capturesBefore, { label: "Captura antes" })),
      field("Después / resultado", captureDrop(capturesAfter, { label: "Captura después" })),
      el("div", { className: "trade-field-wide" }, [captureCount]),
    ],
    "trade-evidence"
  );

  const proc = processFields(null);
  const processSection = formSection(
    "5. Proceso y emociones",
    "Opcional, pero es lo que más enseña: con el tiempo vas a ver cuánto rendís cuando seguís el plan y cuánto cuando no.",
    [el("div", { className: "trade-field-wide" }, [proc.node])],
    "trade-process"
  );
  const saveProcess = async (trade) => { if (normalizeProcess(proc.read())) await setTradeProcess(trade.id, proc.read()); };

  const save = el("button", { type: "button", text: "Guardar operación", className: "trade-form-submit" });
  const draftSave = el("button", { type: "button", className: "ghost", text: "Guardar borrador", onclick: () => {
    lifecycle.value = "DRAFT"; lifecycle.dispatchEvent(new Event("change")); save.click();
  } });
  [entry, openedAt, exit, net, closedAt].forEach(control => control.addEventListener("input", paintLifecycle));
  paintLifecycle();
  save.addEventListener("click", async () => {
    if (save.disabled) return;
    save.disabled = true;
    err.textContent = "";
    let persistedTrade = null;
    try {
      const chosen = selectedCaptures();
      validateCaptures(chosen);

      const assetVal = normalizeAsset(asset.value);
      if (!assetVal) throw new Error("asset requerido");
      if (context.value !== Context.BACKTEST && !accountPick.value) {
        throw new Error("elegí una Account compatible o creá una en Cuentas");
      }
      const openedIso = localDateTimeIso(openedAt.value);
      assertExecution({ asset: assetVal, direction: direction.value, openedAt: openedIso,
        entry: entry.value, exit: exit.value, netPnl: net.value, initialSL: sl.value, tp: tp.value,
        closedAt: localDateTimeIso(closedAt.value) },
        { closed: lifecycle.value === Lifecycle.CLOSED, draft: lifecycle.value === "DRAFT" });
      if (lifecycle.value !== "DRAFT" && openedIso) {
        const similar = await findSimilarTrade({ context: context.value, accountId: context.value === Context.BACKTEST ? null : accountPick.value,
          asset: assetVal, direction: direction.value, openedAt: openedIso, entry: entry.value });
        if (similar) {
          const ok = await confirmDialog({
            title: "Parece repetida",
            body: ["Ya hay una operación muy parecida (misma cuenta, activo, dirección y hora o precio de entrada):",
              el("p", { className: "rgm-dialog-target", text: describeRecord(similar) }), "¿La guardo igual?"],
            confirmText: "Guardar igual", cancelText: "No, revisar",
          });
          if (!ok) { save.disabled = false; return; }
        }
      }
      const completeOpen = lifecycle.value === Lifecycle.OPEN && Boolean(entry.value.trim()) && Boolean(openedAt.value);
      const completeClose = lifecycle.value === Lifecycle.CLOSED && Boolean(openedAt.value) && Boolean(entry.value.trim()) && Boolean(exit.value.trim()) && Boolean(net.value.trim()) && Boolean(closedAt.value);
      if (completeClose) {
        if (!closedAt.value) throw new Error("Ingresá la fecha y hora de cierre.");
        if (!exit.value) throw new Error("exit requerido");
        if (net.value === "") throw new Error("netPnl requerido");
        const closedIso = localDateTimeIso(closedAt.value);
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
        await saveProcess(trade);
        writeLastTrade({ asset: assetVal, context: context.value, accountId: accountPick.value || null });
        go("trade/" + trade.id + (historical() ? "?from=backtesting" : ""));
        toast("Operación guardada.", { tone: "ok", timeout: 2500 });
        return;
      }
      const trade = await createTrade({
        isDraft: !completeOpen,
        exit: exit.value,
        netPnl: net.value,
        commission: comm.value,
        swap: swap.value,
        closeType: closeType.value,
        closedAt: localDateTimeIso(closedAt.value),
        asset: assetVal,
        brokerSymbol: broker.value,
        context: context.value,
        direction: direction.value,
        accountId: context.value === Context.BACKTEST ? null : accountPick.value,
        openedAt: openedIso,
        entry: entry.value,
        initialSL: sl.value,
        tp: tp.value,
        lots: lots.value,
        management: mgmt.value,
        note: note.value,
        setupId: setup ? setup.id : null,
        hasPartials: partials.value === "true",
        riskPercent: riskPct.value,
        riskMoney: riskMoney.value,
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
      await saveProcess(enriched);
      writeLastTrade({ asset: assetVal, context: context.value, accountId: accountPick.value || null });
      go("trade/" + enriched.id + (historical() ? "?from=backtesting" : ""));
      toast(enriched.isDraft ? "Borrador guardado." : "Operación guardada.", { tone: "ok", timeout: 2500 });
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
    el("summary", { text: "Detalles adicionales · estilo, riesgo, costes y notas" }),
    el("p", { className: "hint", text: "Estos campos son opcionales. Usalos para documentar el contexto y mejorar tus estadísticas." }),
    el("div", { className: "trade-fields-grid" }, [
      field("Estilo", style),
      el("details", { className: "legacy-filters trade-field-wide" }, [el("summary", { text: "Sistema de colores (anterior)" }), el("div", { className: "trade-fields-grid" }, [field("Estrategia", strategy), field("Variante", variant)])]),
      field("Símbolo del broker", broker),
      field("Riesgo (%)", riskPct),
      field("Lotaje / cantidad", lots),
      field("Riesgo monetario", riskMoney),
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
        planNote,
        el("p", { className: "hint", text: "Lo mínimo: activo, dirección, entrada y fecha. ¿Te falta algo? Guardá como borrador y completalo después." }),
        ...refs,
      ]),
      formSection("1. Identificación", "Seleccioná el mercado, la dirección y el estado de la operación.", [
        field("Activo / símbolo", asset),
        field("Dirección", choiceButtons(direction, "Dirección")),
        field("Estado", choiceButtons(lifecycle, "Estado")),
        field("Sesión", choiceButtons(session, "Sesión")),
        contextField,
        accountField,
        field("Fecha y hora de entrada", openedAt),
      ]),
      assetList,
      formSection("2. Plan y niveles", "Primero los precios y el stop técnico; después, el tamaño y el riesgo.", [
        field("Entrada", entry),
        field("Stop Loss (SL)", sl),
        field("Take Profit (TP)", tp),
        el("div", { className: "trade-field-wide" }, [rrPreview]),
      ]),
      closedBlock,
      evidence,
      el("details", { className: "trade-optional" }, [el("summary", { text: "Proceso y emociones (opcional): setup, plan, confluencias, cómo estabas, errores" }), processSection]),
      extra,
      hint,
      err,
      recovery,
      el("div", { className: "trade-form-footer" }, [
        el("button", {
          type: "button", className: "ghost",
          text: dedicatedBacktest ? "Volver a Backtesting" : "Volver a Operaciones",
          onclick: () => go(historical() ? "backtesting" : "historial"),
        }),
        save,
        draftSave,
      ]),
    ]),
  ];
}

/** Crear una cuenta sin salir del formulario. */
function quickAccountDialog(context, stageId) {
  return new Promise((resolve) => {
    const LABELS = { LIVE: "Cuenta propia", DEMO: "Demo", PROP_CHALLENGE: "Evaluación", FUNDED: "Fondeada" };
    const name = el("input", { className: "input", name: "accName", placeholder: "Ej.: Bullfy WSF 173126" });
    const currency = el("select", { className: "input", name: "accCurrency" }, ["USD", "EUR"].map((c) => el("option", { value: c, text: c })));
    const amount = el("input", { className: "input", name: "accAmount", inputmode: "decimal", placeholder: "Ej.: 10000" });
    const err = el("p", { className: "err", role: "alert" });
    const ok = el("button", { type: "button", text: "Crear y usar" });
    const cancel = el("button", { type: "button", className: "ghost", text: "Cancelar" });
    const dialog = el("dialog", { className: "rgm-dialog" }, [
      el("h2", { text: "Nueva cuenta · " + (LABELS[context] || context) }),
      field("Nombre", name), field("Moneda", currency), field("Capital inicial", amount), err,
      el("div", { className: "row-actions" }, [cancel, ok]),
    ]);
    const close = (v) => { try { dialog.close(); } catch (_) { /* */ } dialog.remove(); resolve(v); };
    cancel.addEventListener("click", () => close(null));
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(null); });
    ok.addEventListener("click", async () => {
      err.textContent = "";
      try {
        if (!name.value.trim()) throw new Error("Poné un nombre.");
        const value = Number(String(amount.value).replace(",", "."));
        if (!Number.isFinite(value) || value <= 0) throw new Error("Capital inicial inválido.");
        close(await createAccount({ name: name.value, currency: currency.value, context, initialAmount: value }, stageId));
      } catch (e) { err.textContent = e.message; }
    });
    document.body.append(dialog); dialog.showModal(); name.focus();
  });
}
