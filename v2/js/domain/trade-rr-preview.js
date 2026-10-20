import { Direction, Lifecycle } from "./enums.js";
import { computePlannedRr, computeRrRealized } from "./integrity.js";

function validNumber(value) {
  return value != null && String(value).trim() !== "" && Number.isFinite(Number(value));
}

// RR is based on price movement, never on hypothetical cash PnL.
// Missing prices and a stop on the wrong side produce no preview.
export function previewTradeR({ direction, entry, sl, tp, exit, lifecycle, hasPartials = false }) {
  if (!validNumber(entry) || !validNumber(sl)) return { planned: null, realized: null };
  const e = Number(entry);
  const s = Number(sl);
  const validStop = direction === Direction.LONG ? s < e : direction === Direction.SHORT ? s > e : false;
  if (!validStop) return { planned: null, realized: null };

  const planned = validNumber(tp) ? computePlannedRr(direction, e, s, Number(tp)) : null;
  const realized = lifecycle === Lifecycle.CLOSED && !hasPartials && validNumber(exit)
    ? computeRrRealized({
      direction, entry: e, initialSL: s, exit: Number(exit),
      hasPartials: false, lifecycle: Lifecycle.CLOSED,
    })
    : null;
  return { planned, realized };
}
