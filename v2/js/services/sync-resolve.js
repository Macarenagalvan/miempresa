import { nowIso } from "../domain/ids.js";
import { projectMetaForSync, applyRemoteMeta } from "../domain/sync-meta.js";
import { getMeta, putMeta } from "../storage/repos/meta.js";
import { repoFor } from "../storage/repos/collections.js";
import { getLedgerEntry, putLedgerEntry } from "../storage/repos/sync-ledger.js";
import { getConflict, putConflict, listConflicts } from "../storage/repos/sync-conflicts.js";
import { withApplyLock } from "./sync-apply.js";
import { pullCloudRecords, pushCloudRecord } from "./sync-cloud.js";
import { ensureDeviceState, isOnline, patchSyncState } from "./sync-engine.js";

function payloadFor(entityType, record) {
  return entityType === "meta" ? projectMetaForSync(record) : record;
}

async function readLocalRecord(entityType, entityId) {
  if (entityType === "meta") return getMeta();
  const repo = repoFor(entityType);
  return repo ? repo.get(entityId) : null;
}

async function writeLocalRecord(entityType, payload) {
  if (entityType === "meta") {
    const local = await getMeta();
    return putMeta(applyRemoteMeta(local, payload));
  }
  const repo = repoFor(entityType);
  if (!repo) throw new Error("store desconocido: " + entityType);
  return repo.put(payload);
}

async function deleteLocalRecord(entityType, entityId) {
  if (entityType === "meta") return;
  const repo = repoFor(entityType);
  if (repo) await repo.delete(entityId);
}

async function findCloudRow(entityType, entityId) {
  const rows = await pullCloudRecords();
  return rows.find((row) => row.entityType === entityType && row.entityId === entityId) || null;
}

async function closeConflict(conflict, resolution, extra = {}) {
  await putConflict({
    ...conflict,
    ...extra,
    resolvedAt: nowIso(),
    resolution,
  });
  const open = (await listConflicts()).filter((row) => !row.resolvedAt);
  await patchSyncState({
    status: open.length ? "conflict" : "idle",
    lastError: null,
    lastSyncAt: nowIso(),
  });
}

function localTombstoneIntent(ledger, local, conflict) {
  if (ledger && ledger.tombstone) return true;
  if (local) return false;
  const snap = conflict && conflict.localPayload;
  return !snap || Object.keys(snap).length === 0;
}

export async function resolveConflictKeepLocal(entityType, entityId) {
  const conflict = await getConflict(entityType, entityId);
  if (!conflict) return { ok: false, reason: "missing" };
  if (conflict.resolvedAt) return { ok: false, reason: "already_resolved" };
  if (!isOnline()) return { ok: false, reason: "offline" };
  const state = await ensureDeviceState();
  const ledger = await getLedgerEntry(entityType, entityId);
  const local = await readLocalRecord(entityType, entityId);
  const tombstone = localTombstoneIntent(ledger, local, conflict);
  const payload = tombstone ? {} : payloadFor(entityType, local || conflict.localPayload || {});
  const cloud = await findCloudRow(entityType, entityId);
  const expected = cloud ? Number(cloud.revision) : 0;
  if (cloud) {
    await putConflict({
      ...conflict,
      cloudRevision: Number(cloud.revision),
      cloudPayload: cloud.payload,
      resolvedAt: null,
      resolution: null,
    });
  }
  const response = await pushCloudRecord({
    entityType,
    entityId,
    payload,
    expectedRevision: expected,
    tombstone,
    deviceId: state.deviceId,
  });
  if (response && response.ok) {
    await withApplyLock(async () => {
      if (tombstone) await deleteLocalRecord(entityType, entityId);
      else if (local || conflict.localPayload) {
        await writeLocalRecord(entityType, local || conflict.localPayload);
      }
    });
    await putLedgerEntry({
      entityType,
      entityId,
      cloudRevision: Number(response.revision),
      dirty: false,
      tombstone,
      localChangedAt: nowIso(),
    });
    await closeConflict(conflict, "keep_local", {
      cloudRevision: Number(response.revision),
      cloudPayload: payload,
      localPayload: payload,
    });
    return { ok: true, revision: Number(response.revision), resolution: "keep_local" };
  }
  const kind = response && response.kind;
  if (kind === "conflict" || kind === "missing") {
    const next = await getConflict(entityType, entityId) || conflict;
    await putConflict({
      ...next,
      cloudRevision: response.cloud_revision != null ? Number(response.cloud_revision) : next.cloudRevision,
      cloudPayload: response.cloud_payload != null ? response.cloud_payload : next.cloudPayload,
      localPayload: local || next.localPayload || {},
      incomingExpected: expected,
      resolvedAt: null,
      resolution: null,
    });
    await patchSyncState({ status: "conflict", lastError: null });
    return { ok: false, reason: "stale", kind };
  }
  return { ok: false, reason: "push_rejected" };
}

export async function resolveConflictUseCloud(entityType, entityId) {
  const conflict = await getConflict(entityType, entityId);
  if (!conflict) return { ok: false, reason: "missing" };
  if (conflict.resolvedAt) return { ok: false, reason: "already_resolved" };
  let cloud = {
    revision: Number(conflict.cloudRevision),
    payload: conflict.cloudPayload || {},
    tombstone: false,
  };
  if (isOnline()) {
    const live = await findCloudRow(entityType, entityId);
    if (live) cloud = live;
  }
  const tombstone = Boolean(cloud.tombstone);
  await withApplyLock(async () => {
    if (tombstone) await deleteLocalRecord(entityType, entityId);
    else if (cloud.payload) await writeLocalRecord(entityType, cloud.payload);
  });
  await putLedgerEntry({
    entityType,
    entityId,
    cloudRevision: Number(cloud.revision || conflict.cloudRevision || 0),
    dirty: false,
    tombstone,
    localChangedAt: nowIso(),
  });
  await closeConflict(conflict, "use_cloud", {
    cloudRevision: Number(cloud.revision || conflict.cloudRevision || 0),
    cloudPayload: tombstone ? {} : (cloud.payload || {}),
  });
  return { ok: true, resolution: "use_cloud", revision: Number(cloud.revision || 0) };
}
