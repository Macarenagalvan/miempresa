import { ROADMAP_ASSETS } from "../../config.js";
import {
  Context,
  Direction,
  Strategy,
  SetupStatus,
  BlueVariant,
  Style,
  ValidationMethod,
  Verdict,
  SetupQuality,
} from "../../domain/enums.js";
import { SESSIONS } from "../../config.js";
import { CHECKLIST_FIXTURE_ITEMS } from "../../fixtures/checklist-slice2.js";
import { el } from "../render.js";
import { field } from "./observation.js";

function select(values, current) {
  const node = el("select", { className: "input" }, values.map(([v, label]) => el("option", { value: v, text: label })));
  node.value = current || values[0][0];
  return node;
}

export function setupCoreFields(values) {
  const asset = select(ROADMAP_ASSETS.map((a) => [a.id, a.label]).concat([["OTHER", "otro"]]), values.asset || "EURUSD");
  const other = el("input", { className: "input slim", value: ROADMAP_ASSETS.some((a) => a.id === values.asset) ? "" : (values.asset || "") });
  const context = select(Object.values(Context).map((c) => [c, c]), values.context || Context.BACKTEST);
  const direction = select([["", "elegí"], ...Object.values(Direction).map((d) => [d, d])], values.direction || "");
  return { asset, other, context, direction };
}

export function readCore(fields) {
  const asset = fields.asset.value === "OTHER" ? fields.other.value : fields.asset.value;
  return {
    asset,
    context: fields.context.value,
    direction: fields.direction.value,
  };
}

export function evaluateFields(setup) {
  const strategy = select(Object.values(Strategy).map((s) => [s, s]), setup.strategy || Strategy.UNCLASSIFIED);
  const variant = select([["", "—"], ...Object.values(BlueVariant).map((v) => [v, v])], setup.variant || "");
  const style = select([["", "—"], ...Object.values(Style).map((s) => [s, s])], setup.style || "");
  const session = select([["", "—"], ...SESSIONS.map((s) => [s, s])], setup.session || "");
  const status = select(
    [SetupStatus.WATCHING, SetupStatus.WAITING_CONFIRMATION, SetupStatus.VALIDATED].map((s) => [s, s]),
    setup.status,
  );
  const structure = el("input", { className: "input", value: setup.structure || "" });
  const pattern = el("input", { className: "input", value: setup.pattern || "" });
  const pullbackDepth = el("input", { className: "input", value: setup.pullbackDepth ?? "", placeholder: "0.38" });
  const emaNote = el("input", { className: "input", value: setup.emaNote || "" });
  const fibNote = el("input", { className: "input", value: setup.fibNote || "" });
  const zone = el("input", { className: "input", value: setup.zone || "" });
  const timeframes = el("input", { className: "input", value: setup.timeframes || "", placeholder: "D + 4H" });
  const plannedEntry = el("input", { className: "input", value: setup.plannedEntry ?? "" });
  const plannedSl = el("input", { className: "input", value: setup.plannedSl ?? "" });
  const plannedTp = el("input", { className: "input", value: setup.plannedTp ?? "" });
  const comment = el("textarea", { className: "input", rows: "3" });
  comment.value = setup.comment || "";
  const quality = select([["", "—"], ...Object.values(SetupQuality).map((q) => [q, q])], setup.setupQuality || "");
  const method = select([["", "—"], ...Object.values(ValidationMethod).map((m) => [m, m])], setup.validationMethod || "");
  const version = el("input", { className: "input", value: setup.validatorVersion || "", placeholder: "solo GROK_VALIDATOR" });
  const verdict = select([["", "sin juzgar"], ...Object.values(Verdict).map((v) => [v, v])], setup.verdict || "");

  const checks = CHECKLIST_FIXTURE_ITEMS.map((item) => {
    const saved = (setup.checklist || []).find((c) => c.id === item.id);
    const box = el("input", { type: "checkbox" });
    box.checked = Boolean(saved && saved.done);
    return { item, box };
  });
  const checkNodes = checks.map(({ item, box }) => {
    const lab = el("label", { className: "check" }, [box, el("span", { text: item.label })]);
    return lab;
  });

  return {
    nodes: [
      field("Status cola", status),
      field("Strategy", strategy),
      field("Variant (solo BLUE)", variant),
      field("Style", style),
      field("Sesión", session),
      field("Timeframes", timeframes),
      field("Estructura", structure),
      field("Patrón", pattern),
      field("Pullback 0–1", pullbackDepth),
      field("EMA", emaNote),
      field("Fibonacci", fibNote),
      field("Zona", zone),
      field("plannedEntry", plannedEntry),
      field("plannedSL", plannedSl),
      field("plannedTP", plannedTp),
      el("p", { className: "hint", text: "plannedRR se calcula. No se tipea." }),
      field("Checklist (fixture Slice 2, no es el Validator)", el("div", { className: "stack" }, checkNodes)),
      field("validationMethod", method),
      field("validatorVersion", version),
      field("verdict", verdict),
      field("Calidad A/B/C", quality),
      field("Comentario", comment),
    ],
    read() {
      const pb = pullbackDepth.value.trim();
      const num = (node) => {
        const v = node.value.trim();
        return v === "" ? null : Number(v);
      };
      return {
        status: status.value,
        strategy: strategy.value,
        variant: variant.value || null,
        style: style.value || null,
        session: session.value || null,
        timeframes: timeframes.value.trim() || null,
        structure: structure.value.trim() || null,
        pattern: pattern.value.trim() || null,
        pullbackDepth: pb === "" ? null : Number(pb),
        emaNote: emaNote.value.trim() || null,
        fibNote: fibNote.value.trim() || null,
        zone: zone.value.trim() || null,
        plannedEntry: num(plannedEntry),
        plannedSl: num(plannedSl),
        plannedTp: num(plannedTp),
        comment: comment.value.trim() || null,
        setupQuality: quality.value || null,
        validationMethod: method.value || null,
        validatorVersion: version.value.trim() || null,
        verdict: verdict.value || null,
        checklist: checks.map(({ item, box }) => ({
          id: item.id,
          label: item.label,
          done: box.checked,
          source: "fixture-slice2",
        })),
      };
    },
  };
}
