import { STORES } from "../../config.js";
import { createRepo } from "./base.js";
import { withStore, requestToPromise } from "../db.js";
import { createId, nowIso } from "../../domain/ids.js";
import { getTrade } from "./trades.js";

export const attachmentsRepo = createRepo(STORES.attachments);

export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_MIMES = Object.freeze(["image/png", "image/jpeg", "image/webp"]);

export async function listByEntity(entityType, entityId) {
  const rows = await withStore(STORES.attachments, "readonly", (store) => {
    const idx = store.index("entity");
    return requestToPromise(idx.getAll([entityType, entityId]));
  });
  return (rows || []).slice().sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

export async function listTradeImages(tradeId) {
  return listByEntity("trade", tradeId);
}

function readMime(input) {
  return String((input && (input.type || input.mime)) || "");
}

export async function addTradeImage(tradeId, input) {
  if (!tradeId) throw new Error("tradeId requerido");
  const trade = await getTrade(tradeId);
  if (!trade) throw new Error("trade no existe");
  if (!input) throw new Error("imagen requerida");
  const mime = readMime(input);
  if (!IMAGE_MIMES.includes(mime)) throw new Error("solo PNG, JPEG o WEBP");
  const blob = input.blob instanceof Blob
    ? input.blob
    : (input instanceof Blob ? input : new Blob([input.bytes || input], { type: mime }));
  const size = Number(input.size != null ? input.size : blob.size);
  if (!Number.isFinite(size) || size <= 0) throw new Error("imagen vacía");
  if (size > ATTACHMENT_MAX_BYTES) throw new Error("imagen demasiado grande (máx 8 MB)");
  const record = {
    id: createId(),
    entityType: "trade",
    entityId: tradeId,
    kind: "image",
    mime,
    name: String(input.name || "captura"),
    size,
    createdAt: nowIso(),
    blob,
  };
  await attachmentsRepo.put(record);
  return record;
}

export async function removeAttachment(id) {
  if (!id) throw new Error("attachment id requerido");
  await attachmentsRepo.delete(id);
}
