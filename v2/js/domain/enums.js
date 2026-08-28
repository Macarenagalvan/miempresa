export const StageStatus = Object.freeze({
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED",
});

export const Context = Object.freeze({
  BACKTEST: "BACKTEST",
  LIVE: "LIVE",
  DEMO: "DEMO",
  PROP_CHALLENGE: "PROP_CHALLENGE",
  FUNDED: "FUNDED",
});

export const AccountContext = Object.freeze({
  DEMO: "DEMO",
  LIVE: "LIVE",
  PROP_CHALLENGE: "PROP_CHALLENGE",
  FUNDED: "FUNDED",
});

export const Currency = Object.freeze({
  EUR: "EUR",
  USD: "USD",
});

export const AccountStatus = Object.freeze({
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED",
});

export const MovementType = Object.freeze({
  DEPOSIT: "DEPOSIT",
  WITHDRAWAL: "WITHDRAWAL",
  FEE_EXTERNAL: "FEE_EXTERNAL",
  ADJUSTMENT: "ADJUSTMENT",
});

export const ChallengeStatus = Object.freeze({
  ACTIVE: "ACTIVE",
  PHASE1_PASSED: "PHASE1_PASSED",
  FUNDED: "FUNDED",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
  CANCELLED: "CANCELLED",
});

export const PayoutKind = Object.freeze({
  PAYOUT: "PAYOUT",
  REFUND: "REFUND",
});

export const Disposition = Object.freeze({
  NONE: "NONE",
  TAKEN: "TAKEN",
  IGNORED: "IGNORED",
  SKIPPED_OPEN_POSITION: "SKIPPED_OPEN_POSITION",
  STALE: "STALE",
});

export const Resolution = Object.freeze({
  OPEN: "OPEN",
  TP: "TP",
  SL: "SL",
  MISSED: "MISSED",
});

export const DeskRecordSource = Object.freeze({
  MANUAL: "MANUAL",
  RGM_ADAPTER: "RGM_ADAPTER",
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

export const Lifecycle = Object.freeze({
  DRAFT: "DRAFT",
  OPEN: "OPEN",
  CLOSED: "CLOSED",
  VOID: "VOID",
});

export const Result = Object.freeze({
  WIN: "WIN",
  LOSS: "LOSS",
  BE: "BE",
});

export const CloseType = Object.freeze({
  TP: "TP",
  SL: "SL",
  MANUAL: "MANUAL",
  BE: "BE",
  UNKNOWN: "UNKNOWN",
});

export const VoidReason = Object.freeze({
  DUPLICATE: "DUPLICATE",
  PHANTOM_IMPORT: "PHANTOM_IMPORT",
  TEST: "TEST",
  ACCIDENT: "ACCIDENT",
  INVALID: "INVALID",
});

export const ExecutionQuality = Object.freeze({
  A: "A",
  B: "B",
  C: "C",
});

export const WouldDoSame = Object.freeze({
  YES: "YES",
  NO: "NO",
  PARTLY: "PARTLY",
});

export const ErrorTag = Object.freeze({
  NO_ERROR: "NO_ERROR",
  PROCESS: "PROCESS",
  EXECUTION: "EXECUTION",
  RISK: "RISK",
  PSYCHOLOGY: "PSYCHOLOGY",
});
