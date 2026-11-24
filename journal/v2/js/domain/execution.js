// Shared rules for new execution data; legacy records are not rewritten on read/restore.
export function validDay(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + "T00:00:00Z"))
    && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}

export function validInstant(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && validDay(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24
    && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60 && Number.isFinite(Date.parse(value));
}

const labels = { asset: "activo", direction: "dirección", openedAt: "fecha de entrada", entry: "entrada", closedAt: "fecha de cierre", exit: "salida", netPnl: "PnL" };
export function missingExecution(input, closed = true) {
  const fields = ["asset", "direction", "openedAt", "entry", ...(closed ? ["closedAt", "exit", "netPnl"] : [])];
  return fields.filter(k => input[k] == null || String(input[k]).trim() === "").map(k => labels[k]);
}

export function assertExecution(input, { closed = true, draft = false } = {}) {
  const inspectClose = closed || draft;
  const missing = missingExecution(input, closed);
  if (!draft && missing.length) throw new Error("Completá: " + missing.join(", ") + ".");
  for (const k of (inspectClose ? ["openedAt", "closedAt"] : ["openedAt"])) {
    if (input[k] != null && input[k] !== "" && !validInstant(input[k])) throw new Error(labels[k] + ": fecha y hora inválidas, con zona horaria requerida.");
  }
  if (inspectClose && input.openedAt && input.closedAt && Date.parse(input.closedAt) < Date.parse(input.openedAt)) throw new Error("La fecha de cierre no puede ser anterior a la entrada.");
  for (const k of ["entry", "initialSL", "tp", ...(inspectClose ? ["exit", "netPnl"] : [])]) {
    if (input[k] == null || String(input[k]).trim() === "") continue;
    if (!Number.isFinite(Number(input[k])) || (k !== "netPnl" && Number(input[k]) <= 0)) throw new Error(k + ": número inválido" + (k === "netPnl" ? "." : " (debe ser mayor que cero)."));
  }
  if (input.entry != null && input.entry !== "" && input.initialSL != null && input.initialSL !== "" && ["LONG", "SHORT"].includes(input.direction)) {
    if (input.direction === "LONG" ? Number(input.initialSL) >= Number(input.entry) : Number(input.initialSL) <= Number(input.entry)) throw new Error("El SL debe estar del lado de riesgo de la entrada.");
  }
}
