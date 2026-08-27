export const StageStatus = Object.freeze({
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED",
});

export const Context = Object.freeze({
  BACKTEST: "BACKTEST",
  LIVE: "LIVE",
  PROP_CHALLENGE: "PROP_CHALLENGE",
  FUNDED: "FUNDED",
});

export const Direction = Object.freeze({
  LONG: "LONG",
  SHORT: "SHORT",
});

export const Strategy = Object.freeze({
  UNCLASSIFIED: "UNCLASSIFIED",
  BLUE: "BLUE",
  RED: "RED",
  PINK: "PINK",
  WHITE: "WHITE",
  BLACK: "BLACK",
  GREEN: "GREEN",
});

export const SetupStatus = Object.freeze({
  WATCHING: "WATCHING",
  WAITING_CONFIRMATION: "WAITING_CONFIRMATION",
  VALIDATED: "VALIDATED",
  DISCARDED: "DISCARDED",
  TAKEN: "TAKEN",
  EXPIRED: "EXPIRED",
});

export const BlueVariant = Object.freeze({
  BLUE_A: "BLUE_A",
  BLUE_B: "BLUE_B",
  BLUE_C: "BLUE_C",
});

export const Style = Object.freeze({
  DAY: "DAY",
  SWING: "SWING",
  SCALP: "SCALP",
});

export const ValidationMethod = Object.freeze({
  SELF: "SELF",
  GROK_VALIDATOR: "GROK_VALIDATOR",
  OTHER: "OTHER",
});

export const Verdict = Object.freeze({
  VALID: "VALID",
  INCOMPLETE: "INCOMPLETE",
  INVALID: "INVALID",
});

export const SetupQuality = Object.freeze({
  A: "A",
  B: "B",
  C: "C",
});
