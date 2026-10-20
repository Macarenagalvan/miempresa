import { previewTradeR } from "../js/domain/trade-rr-preview.js";
import { Direction, Lifecycle } from "../js/domain/enums.js";

export async function run() {
  const check = (condition, text) => { if (!condition) throw new Error("RR preview: " + text); };
  const base = { direction: Direction.LONG, entry: 200, sl: 195, tp: 210, exit: 205, lifecycle: Lifecycle.CLOSED };
  const long = previewTradeR(base);
  check(Math.abs(long.planned - 2) < 1e-10 && Math.abs(long.realized - 1) < 1e-10, "LONG 2R plan, 1R realized");

  const short = previewTradeR({ ...base, direction: Direction.SHORT, sl: 205, tp: 190, exit: 210 });
  check(Math.abs(short.planned - 2) < 1e-10 && Math.abs(short.realized + 2) < 1e-10, "SHORT 2R plan, -2R realized");

  const invalid = previewTradeR({ ...base, sl: 205 });
  check(invalid.planned === null && invalid.realized === null, "stop wrong side");
  const missing = previewTradeR({ ...base, entry: "", sl: "" });
  check(missing.planned === null && missing.realized === null, "empty entry and stop");
  const pending = previewTradeR({ ...base, lifecycle: Lifecycle.OPEN });
  check(pending.realized === null, "open position has no realized R");
  const partial = previewTradeR({ ...base, hasPartials: true });
  check(partial.realized === null && partial.planned === 2, "partials suppress realized R");
  const breakeven = previewTradeR({ ...base, exit: 200 });
  check(breakeven.realized === 0, "price breakeven is zero R");
  const noTarget = previewTradeR({ ...base, tp: "" });
  check(noTarget.planned === null && noTarget.realized === 1, "missing TP does not affect actual price R");
  console.log("RR preview: 8 independent cases OK");
}
