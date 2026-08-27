import { ROADMAP_ASSETS, SESSIONS, OBSERVATION_TAG_SUGGESTIONS } from "../../config.js";
import { el } from "../render.js";

function field(label, control) {
  return el("label", { className: "field" }, [el("span", { text: label }), control]);
}

export function assetPicker(selected, onPick) {
  const wrap = el("div", { className: "chips" });
  const known = new Set(ROADMAP_ASSETS.map((a) => a.id));
  for (const asset of ROADMAP_ASSETS) {
    const btn = el("button", {
      type: "button",
      className: "chip" + (selected === asset.id ? " is-on" : ""),
      text: asset.label,
    });
    btn.addEventListener("click", () => onPick(asset.id));
    wrap.append(btn);
  }
  const other = el("input", {
    className: "input slim",
    placeholder: "otro asset",
    value: selected && !known.has(selected) ? selected : "",
  });
  other.addEventListener("change", () => {
    if (other.value.trim()) onPick(other.value.trim());
  });
  wrap.append(other);
  return wrap;
}

export function coreFields(values) {
  return {
    date: el("input", { className: "input", type: "date", value: values.date || "" }),
    note: el("textarea", { className: "input", rows: "4" }),
  };
}

export function optionalFields(values) {
  const timeframe = el("input", { className: "input", value: values.timeframe || "", placeholder: "D, 4H, 1H…" });
  const session = el("select", { className: "input" }, [
    el("option", { value: "", text: "—" }),
    ...SESSIONS.map((s) => el("option", { value: s, text: s })),
  ]);
  session.value = values.session || "";
  const priceBehavior = el("input", { className: "input", value: values.priceBehavior || "" });
  const pullback = el("input", { className: "input", value: values.pullback || "" });
  const emaReaction = el("input", { className: "input", value: values.emaReaction || "" });
  const fibReaction = el("input", { className: "input", value: values.fibReaction || "" });
  const pattern = el("input", { className: "input", value: values.pattern || "" });
  const srBehavior = el("input", { className: "input", value: values.srBehavior || "" });
  const tags = el("input", {
    className: "input",
    value: (values.tags || []).join(", "),
    placeholder: OBSERVATION_TAG_SUGGESTIONS.join(", "),
  });
  return {
    nodes: [
      field("Timeframe", timeframe),
      field("Sesión", session),
      field("Comportamiento", priceBehavior),
      field("Corrección / pullback", pullback),
      field("Reacción EMA", emaReaction),
      field("Reacción Fibonacci", fibReaction),
      field("Patrón", pattern),
      field("Soporte / resistencia", srBehavior),
      field("Tags", tags),
      el("p", { className: "hint", text: "Tags libres. Sugeridas: " + OBSERVATION_TAG_SUGGESTIONS.join(", ") }),
    ],
    read() {
      return {
        timeframe: timeframe.value.trim() || null,
        session: session.value || null,
        priceBehavior: priceBehavior.value.trim() || null,
        pullback: pullback.value.trim() || null,
        emaReaction: emaReaction.value.trim() || null,
        fibReaction: fibReaction.value.trim() || null,
        pattern: pattern.value.trim() || null,
        srBehavior: srBehavior.value.trim() || null,
        tags: tags.value.split(",").map((t) => t.trim()).filter(Boolean),
      };
    },
  };
}

export { field };
