import { assertSyncOwner } from './sync-owner.js';
import { syncSnapshot, acknowledgePush, applyCloudVersion } from '../storage/sync-version.js';
import { nowIso } from "../domain/ids.js";
import { encodeSyncPayload, decodeSyncPayload } from "./sync-payload.js";
import { getConflict, putConflict, listConflicts } from "../storage/repos/sync-conflicts.js";
import { pullCloudRecords, pushCloudRecord } from "./sync-cloud.js";
import { ensureDeviceState, isOnline, patchSyncState } from "./sync-engine.js";

async function findCloudRow(entityType, entityId, owner) {
  const rows = await pullCloudRecords(owner);
  return rows.find((row) => row.entityType === entityType && row.entityId === entityId) || null;
}

async function closeConflict(conflict, resolution, extra = {}, owner) {
  await putConflict({
    ...conflict,
    ...extra,
    resolvedAt: nowIso(),
    resolution,
  }, owner);
  const open = (await listConflicts()).filter((row) => !row.resolvedAt);
  await patchSyncState({
    status: open.length ? "conflict" : "idle",
    lastError: null,
    lastSyncAt: nowIso(),
  }, owner);
}

function localTombstoneIntent(ledger, local, conflict) {
  if (ledger && ledger.tombstone) return true;
  if (local) return false;
  const snap = conflict && conflict.localPayload;
  return !snap || Object.keys(snap).length === 0;
}

export async function resolveConflictKeepLocal(entityType, entityId) {
  const owner = await assertSyncOwner();
  const conflict = await getConflict(entityType, entityId);
  if (!conflict) return { ok: false, reason: "missing" };
  if (conflict.resolvedAt) return { ok: false, reason: "already_resolved" };
  if (!isOnline()) return { ok: false, reason: "offline" };
  const state = await ensureDeviceState();
  const { entry: ledger, local } = await syncSnapshot(entityType, entityId);
  const tombstone = localTombstoneIntent(ledger, local, conflict);
  const payload = tombstone ? {} : await encodeSyncPayload(entityType, local || conflict.localPayload || {});
  const cloud = await findCloudRow(entityType, entityId, owner);
  const expected = cloud ? Number(cloud.revision) : 0;
  if (cloud) {
    await putConflict({
      ...conflict,
      cloudRevision: Number(cloud.revision),
      cloudPayload: cloud.payload,
      resolvedAt: null,
      resolution: null,
    }, owner);
  }
  const response = await pushCloudRecord({
    entityType,
    entityId,
    payload,
    expectedRevision: expected,
    tombstone,
    deviceId: state.deviceId,
  }, owner);
  if (response && response.ok) {
    await assertSyncOwner(owner);
    // The sent snapshot is already local. Never write it over a newer edit.
    if (ledger) await acknowledgePush(ledger, response.revision, owner);
    await closeConflict(conflict, "keep_local", {
      cloudRevision: Number(response.revision),
      cloudPayload: payload,
      localPayload: payload,
    }, owner);
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
    }, owner);
    await patchSyncState({ status: "conflict", lastError: null }, owner);
    return { ok: false, reason: "stale", kind };
  }
  return { ok: false, reason: "push_rejected" };
}

export async function resolveConflictUseCloud(entityType, entityId) {
  const owner = await assertSyncOwner();
  const { entry: expected } = await syncSnapshot(entityType, entityId);
  const conflict = await getConflict(entityType, entityId);
  if (!conflict) return { ok: false, reason: "missing" };
  if (conflict.resolvedAt) return { ok: false, reason: "already_resolved" };
  let cloud = {
    revision: Number(conflict.cloudRevision),
    payload: conflict.cloudPayload || {},
    tombstone: false,
  };
  if (isOnline()) {
    const live = await findCloudRow(entityType, entityId, owner);
    if (live) cloud = live;
  }
  const tombstone = Boolean(cloud.tombstone);
  await assertSyncOwner(owner);
  const applied = await applyCloudVersion(entityType, entityId, tombstone ? null : decodeSyncPayload(entityType, cloud.payload), tombstone, expected, cloud.revision || conflict.cloudRevision || 0, owner);
  if (!applied) return { ok: false, reason: 'stale_local' };
  await closeConflict(conflict, "use_cloud", {
    cloudRevision: Number(cloud.revision || conflict.cloudRevision || 0),
    cloudPayload: tombstone ? {} : (cloud.payload || {}),
  }, owner);
  return { ok: true, resolution: "use_cloud", revision: Number(cloud.revision || 0) };
}
