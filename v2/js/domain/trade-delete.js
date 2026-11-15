// Borrado definitivo de operaciones/backtests con posibilidad de deshacer.
// Borra la operación, su revisión (ASR) y sus capturas en una sola transacción,
// desvincula señales enlazadas y deja todo marcado para sincronizar.
// Devuelve una "foto" exacta de lo borrado para poder restaurarlo (Deshacer).
import { createId } from "./ids.js";
import { withStores, requestToPromise } from "../storage/db.js";
import { PRODUCT_SYNC_STORES } from "../config.js";

const STORES = ["trades", "asrs", "attachments", "signals", "syncLedger"];

function scheduleSync() {
  import("../services/sync-engine.js").then((m) => m.scheduleSync()).catch(() => {});
}

function tracker(tx, ledgerRows, now) {
  return (entityType, record, tombstone) => {
    if (!PRODUCT_SYNC_STORES.includes(entityType)) return;
    const id = entityType + "::" + record.id;
    const old = ledgerRows.find((e) => e.id === id);
    tx.objectStore("syncLedger").put({
      id, entityType, entityId: String(record.id),
      cloudRevision: Number(old?.cloudRevision || 0),
      localVersion: createId(), dirty: true, tombstone, localChangedAt: now,
    });
  };
}

/** Qué se borraría (para el texto de confirmación). */
export async function previewTradeDeletion(ids) {
  const list = [].concat(ids);
  return withStores(["trades", "asrs", "attachments"], "readonly", async (tx) => {
    const [trades, asrs, attachments] = await Promise.all(["trades", "asrs", "attachments"].map((s) => requestToPromise(tx.objectStore(s).getAll())));
    const set = new Set(list);
    return {
      trades: trades.filter((t) => set.has(t.id)).length,
      asrs: asrs.filter((a) => set.has(a.tradeId)).length,
      attachments: attachments.filter((a) => a.entityType === "trade" && set.has(a.entityId)).length,
    };
  });
}

/** Borra una o varias operaciones. Devuelve { counts, snapshot } para deshacer. */
export async function deleteTrades(ids) {
  const set = new Set([].concat(ids).filter(Boolean));
  if (!set.size) throw new Error("No hay registros para borrar.");
  const result = await withStores(STORES, "readwrite", async (tx) => {
    const [trades, asrs, attachments, signals, ledger] = await Promise.all(STORES.map((s) => requestToPromise(tx.objectStore(s).getAll())));
    const now = new Date().toISOString();
    const track = tracker(tx, ledger, now);
    const deleted = {
      trades: trades.filter((t) => set.has(t.id)),
      asrs: asrs.filter((a) => set.has(a.tradeId)),
      attachments: attachments.filter((a) => a.entityType === "trade" && set.has(a.entityId)),
    };
    if (!deleted.trades.length) throw new Error("Este registro ya no existe. Actualizá la pantalla.");
    const linkedSignals = signals.filter((s) => set.has(s.tradeId));
    for (const [store, rows] of Object.entries(deleted)) {
      for (const row of rows) { tx.objectStore(store).delete(row.id); track(store, row, true); }
    }
    for (const sig of linkedSignals) {
      const next = { ...sig, tradeId: null, updatedAt: now };
      tx.objectStore("signals").put(next); track("signals", next, false);
    }
    return {
      counts: Object.fromEntries(Object.entries(deleted).map(([k, v]) => [k, v.length])),
      snapshot: { ...deleted, signals: linkedSignals },
    };
  });
  scheduleSync();
  return result;
}

/** Deshace un borrado: vuelve a guardar exactamente lo que había. */
export async function restoreDeletedTrades(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.trades)) throw new Error("No hay nada para deshacer.");
  await withStores(STORES, "readwrite", async (tx) => {
    const ledger = await requestToPromise(tx.objectStore("syncLedger").getAll());
    const now = new Date().toISOString();
    const track = tracker(tx, ledger, now);
    for (const store of ["trades", "asrs", "attachments", "signals"]) {
      for (const row of snapshot[store] || []) {
        const next = store === "signals" ? { ...row, updatedAt: now } : row;
        tx.objectStore(store).put(next); track(store, next, false);
      }
    }
  });
  scheduleSync();
}

// ---------- Estudios / NO TRADE ----------
const OBS_STORES = ["observations", "attachments", "setups", "syncLedger"];

/** Borra un estudio con sus capturas. Las ideas (setups) enlazadas se conservan, sin el vínculo. */
export async function deleteObservation(id) {
  const result = await withStores(OBS_STORES, "readwrite", async (tx) => {
    const [observations, attachments, setups, ledger] = await Promise.all(OBS_STORES.map((s) => requestToPromise(tx.objectStore(s).getAll())));
    const target = observations.find((o) => o.id === id);
    if (!target) throw new Error("Este estudio ya no existe. Actualizá la pantalla.");
    const now = new Date().toISOString();
    const track = tracker(tx, ledger, now);
    const images = attachments.filter((a) => a.entityType === "observation" && a.entityId === id);
    const linked = setups.filter((s) => s.observationId === id);
    tx.objectStore("observations").delete(id); track("observations", target, true);
    for (const img of images) { tx.objectStore("attachments").delete(img.id); track("attachments", img, true); }
    for (const s of linked) { const next = { ...s, observationId: null, updatedAt: now }; tx.objectStore("setups").put(next); track("setups", next, false); }
    return { snapshot: { observations: [target], attachments: images, setups: linked }, counts: { attachments: images.length, setups: linked.length } };
  });
  scheduleSync();
  return result;
}

export async function restoreDeletedObservation(snapshot) {
  await withStores(OBS_STORES, "readwrite", async (tx) => {
    const ledger = await requestToPromise(tx.objectStore("syncLedger").getAll());
    const now = new Date().toISOString();
    const track = tracker(tx, ledger, now);
    for (const store of ["observations", "attachments", "setups"]) {
      for (const row of snapshot[store] || []) {
        const next = store === "setups" ? { ...row, updatedAt: now } : row;
        tx.objectStore(store).put(next); track(store, next, false);
      }
    }
  });
  scheduleSync();
}
