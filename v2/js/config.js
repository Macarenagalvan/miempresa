export const DB_NAME = "JournalV2";
export const DB_VERSION = 1;
export const SCHEMA_VERSION = 1;
export const JOURNAL_EDITION = "v2";
export const V1_DB_NAME = "TradingJournalDB";
export const META_ID = "singleton";
export const INITIAL_STAGE_NAME = "V2 · inicio";

export const ROADMAP_ASSETS = [
  { id: "EURUSD", label: "EURUSD" },
  { id: "NZDUSD", label: "NZDUSD" },
  { id: "XAUUSD", label: "XAUUSD" },
  { id: "SP500", label: "S&P 500" },
];

export const SESSIONS = ["SYDNEY", "TOKYO", "LONDON", "NEW_YORK"];

export const RGM_SOURCE_ASSET = "SP500";

export const OBSERVATION_TAG_SUGGESTIONS = [
  "false-break",
  "wick",
  "news",
  "cash-open",
  "slow-pb",
  "impulsive",
];

export const STORES = {
  meta: "meta",
  stages: "stages",
  accounts: "accounts",
  movements: "movements",
  observations: "observations",
  setups: "setups",
  trades: "trades",
  asrs: "asrs",
  signals: "signals",
  challenges: "challenges",
  payouts: "payouts",
  attachments: "attachments",
};

export const STORE_INDEXES = {
  stages: [["status", "status", { unique: false }]],
  accounts: [
    ["stageId", "stageId", { unique: false }],
    ["context", "context", { unique: false }],
    ["challengeId", "challengeId", { unique: false }],
  ],
  movements: [
    ["stageId", "stageId", { unique: false }],
    ["accountId", "accountId", { unique: false }],
    ["date", "date", { unique: false }],
  ],
  observations: [
    ["stageId", "stageId", { unique: false }],
    ["asset", "asset", { unique: false }],
    ["date", "date", { unique: false }],
  ],
  setups: [
    ["stageId", "stageId", { unique: false }],
    ["asset", "asset", { unique: false }],
    ["context", "context", { unique: false }],
    ["strategy", "strategy", { unique: false }],
    ["status", "status", { unique: false }],
    ["observationId", "observationId", { unique: false }],
    ["deskSignalId", "deskSignalId", { unique: false }],
  ],
  trades: [
    ["stageId", "stageId", { unique: false }],
    ["asset", "asset", { unique: false }],
    ["context", "context", { unique: false }],
    ["accountId", "accountId", { unique: false }],
    ["setupId", "setupId", { unique: false }],
    ["deskSignalId", "deskSignalId", { unique: false }],
    ["lifecycle", "lifecycle", { unique: false }],
    ["closedAt", "closedAt", { unique: false }],
    ["openedAt", "openedAt", { unique: false }],
    ["importBatchId", "importBatchId", { unique: false }],
  ],
  asrs: [
    ["stageId", "stageId", { unique: false }],
    ["tradeId", "tradeId", { unique: true }],
  ],
  signals: [
    ["stageId", "stageId", { unique: false }],
    ["asset", "asset", { unique: false }],
    ["resolution", "resolution", { unique: false }],
    ["disposition", "disposition", { unique: false }],
    ["printedAt", "printedAt", { unique: false }],
  ],
  challenges: [
    ["stageId", "stageId", { unique: false }],
    ["status", "status", { unique: false }],
    ["accountId", "accountId", { unique: false }],
  ],
  payouts: [
    ["stageId", "stageId", { unique: false }],
    ["challengeId", "challengeId", { unique: false }],
    ["date", "date", { unique: false }],
  ],
  attachments: [["entity", ["entityType", "entityId"], { unique: false }]],
};

export const EXPORT_COLLECTIONS = [
  "stages",
  "accounts",
  "movements",
  "observations",
  "setups",
  "trades",
  "asrs",
  "signals",
  "challenges",
  "payouts",
];
