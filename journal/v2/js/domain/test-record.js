// Explicit QA fixtures are useful for testing but must not contaminate performance summaries.
export function isTestRecord(trade) {
  const asset = String(trade && trade.asset || "").toUpperCase();
  const note = String(trade && trade.note || "").toUpperCase();
  return asset.startsWith("TEST/") || asset.startsWith("TEST ") ||
    note.includes("TEST / FICTICIO");
}
