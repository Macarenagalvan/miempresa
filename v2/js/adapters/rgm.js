import { Direction, Disposition, Resolution } from "../domain/enums.js";

export const DEFAULT_RGM_SOURCE_ASSET = "SP500";
export const DEFAULT_RGM_SOURCE_CONTEXT = "LIVE";

const SNAPSHOT_KEYS = [
  "entry",
  "sl",
  "tp",
  "score",
  "signal_close_t",
  "quote_at_alert",
  "samples",
  "pl",
  "done",
  "skipped",
  "first_sl",
  "first_tp",
  "ambiguous",
  "kind",
  "resolved",
  "fill_60",
  "R_B_60",
];

const PRINT_SNAPSHOT_KEYS = ["entry", "sl", "tp", "score", "quote_at_alert"];

export function parseRgmJsonl(text) {
  const rawLines = String(text || "").split(/\r?\n/);
  const rows = [];
  const invalid = [];
  rawLines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const payload = JSON.parse(trimmed);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        invalid.push({ index, line: trimmed, error: "línea no es objeto" });
        return;
      }
      rows.push({ index, payload });
    } catch (err) {
      invalid.push({ index, line: trimmed, error: "JSON inválido" });
    }
  });
  return { rows, invalid, read: rawLines.filter((l) => l.trim()).length };
}

export function toIsoTime(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return String(value);
}

export function mapRgmSide(side) {
  const raw = String(side || "").trim().toUpperCase();
  if (raw === "LONG" || raw === "BUY") return Direction.LONG;
  if (raw === "SHORT" || raw === "SELL") return Direction.SHORT;
  return null;
}

export function mapRgmResolved(resolved) {
  const raw = resolved == null || resolved === "" ? null : String(resolved);
  if (raw === "TP") return { resolution: Resolution.TP, disposition: null, raw };
  if (raw === "SL") return { resolution: Resolution.SL, disposition: null, raw };
  if (raw === "MISSED") return { resolution: Resolution.MISSED, disposition: null, raw };
  if (raw === "SKIPPED_OPEN_POSITION") {
    return { resolution: null, disposition: Disposition.SKIPPED_OPEN_POSITION, raw };
  }
  return { resolution: null, disposition: null, raw };
}

export function rgmApplicableAt(payload) {
  return toIsoTime(payload && payload.alert_t);
}

export function isOnOrAfterSyncFrom(isoTs, syncFrom) {
  if (!syncFrom) return false;
  const ts = Date.parse(isoTs);
  const from = Date.parse(syncFrom);
  if (!Number.isFinite(ts) || !Number.isFinite(from)) return false;
  return ts >= from;
}

function snapshotFromPayload(payload) {
  const snap = {};
  for (const key of SNAPSHOT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) snap[key] = payload[key];
  }
  if (payload && payload.resolved != null && payload.resolved !== "") {
    snap.rgmResolvedRaw = String(payload.resolved);
  }
  snap.raw = { ...payload };
  return snap;
}

export function ingestPrint(payload, opts = {}) {
  if (!payload || typeof payload !== "object") throw new Error("payload RGM requerido");
  const sourceAsset = opts.sourceAsset;
  const sourceContext = opts.sourceContext;
  if (!sourceAsset) throw new Error("sourceAsset requerido");
  if (!sourceContext) throw new Error("sourceContext requerido");
  const rgmSignalId = payload.id == null || payload.id === "" ? null : String(payload.id);
  if (!rgmSignalId) return { ok: false, error: "id ausente" };
  const direction = mapRgmSide(payload.side);
  if (!direction) return { ok: false, error: "side inválido" };
  const printedAt = rgmApplicableAt(payload);
  if (!printedAt) return { ok: false, error: "alert_t ausente" };
  const mapped = mapRgmResolved(payload.resolved);
  const snapshot = snapshotFromPayload(payload);
  return {
    ok: true,
    draft: {
      recordSource: "RGM_ADAPTER",
      asset: sourceAsset,
      context: sourceContext,
      brokerSymbol: null,
      direction,
      printedAt,
      disposition: mapped.disposition || "NONE",
      resolution: mapped.resolution || "OPEN",
      resolvedAt: mapped.resolution ? toIsoTime(payload.signal_close_t) || printedAt : null,
      setupId: null,
      tradeId: null,
      sourceRef: {
        rgmSignalId,
        rgmPrintAt: printedAt,
        manualNote: null,
      },
      snapshot,
      note: null,
    },
    followup: {
      disposition: mapped.disposition,
      resolution: mapped.resolution,
    },
  };
}

export function applyResolution(payload) {
  return mapRgmResolved(payload && payload.resolved);
}

export function printConflict(existing, draft) {
  if (!existing || !draft) return false;
  if (existing.asset !== draft.asset) return true;
  if (existing.context !== draft.context) return true;
  if (existing.direction !== draft.direction) return true;
  if (String(existing.printedAt) !== String(draft.printedAt)) return true;
  const prevId = existing.sourceRef && existing.sourceRef.rgmSignalId;
  const nextId = draft.sourceRef && draft.sourceRef.rgmSignalId;
  if (String(prevId) !== String(nextId)) return true;
  const prevSnap = existing.snapshot || {};
  const nextSnap = draft.snapshot || {};
  for (const key of PRINT_SNAPSHOT_KEYS) {
    if (JSON.stringify(prevSnap[key] ?? null) !== JSON.stringify(nextSnap[key] ?? null)) return true;
  }
  return false;
}

export { SNAPSHOT_KEYS, PRINT_SNAPSHOT_KEYS };
