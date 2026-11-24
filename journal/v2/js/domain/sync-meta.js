import { META_ID, META_DEVICE_FIELDS, META_SYNC_FIELDS, SCHEMA_VERSION } from "../config.js";

export function projectMetaForSync(meta) {
  const src = meta && typeof meta === "object" ? meta : {};
  const out = { id: META_ID };
  for (const key of META_SYNC_FIELDS) {
    if (key === "id") continue;
    out[key] = src[key] === undefined ? null : src[key];
  }
  out.schemaVersion = SCHEMA_VERSION;
  return out;
}

export function applyRemoteMeta(local, remote) {
  const projected = projectMetaForSync(remote);
  const next = { ...projected, id: META_ID };
  const base = local && typeof local === "object" ? local : {};
  for (const key of META_DEVICE_FIELDS) {
    next[key] = Object.prototype.hasOwnProperty.call(base, key) ? base[key] : null;
  }
  next.schemaVersion = SCHEMA_VERSION;
  return next;
}

export function isDeviceOnlyMetaField(key) {
  return META_DEVICE_FIELDS.includes(key);
}
