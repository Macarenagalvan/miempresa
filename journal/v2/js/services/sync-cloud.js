import { assertSyncOwner } from './sync-owner.js';
import { dispatchSyncRequest } from './sync-mode.js';
import { getAuthClient, readSupabaseConfig } from "./auth.js";

let injected = null;

export function setSyncCloud(adapter) {
  injected = adapter || null;
}

export function resetSyncCloud() {
  injected = null;
}

function mapRow(row) {
  return {
    entityType: row.entity_type || row.entityType,
    entityId: row.entity_id || row.entityId,
    payload: row.payload == null ? {} : row.payload,
    revision: Number(row.revision),
    tombstone: Boolean(row.tombstone),
    updatedAt: row.updated_at || row.updatedAt || null,
    updatedByDevice: row.updated_by_device || row.updatedByDevice || null,
  };
}

// Capture a token and URL for this request. A session switch cannot retarget it.
async function requestCloud(owner, endpoint, body) {
  const cfg = readSupabaseConfig();
  const client = await getAuthClient();
  const { data, error } = await client.auth.getSession();
  const session = data?.session;
  if (error || !session?.access_token || session.user?.id !== owner.userId || new URL(cfg.url).origin !== owner.project) throw new Error('La sesión cambió antes de sincronizar.');
  await assertSyncOwner(owner);
  const response = await dispatchSyncRequest(owner, () => fetch(owner.project + '/rest/v1/' + endpoint, {
    method: body ? 'POST' : 'GET',
    headers: { apikey: cfg.publishableKey, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  if (!response.ok) throw new Error('Supabase rechazó la sincronización (' + response.status + ').');
  return response.json();
}
export async function pullCloudRecords(expected) {
  const owner = await assertSyncOwner(expected);
  const rows = injected && typeof injected.pullRecords === 'function'
    ? await dispatchSyncRequest(owner, () => injected.pullRecords())
    : await requestCloud(owner, 'journal_sync_records?select=entity_type,entity_id,payload,revision,tombstone,updated_at,updated_by_device');
  await assertSyncOwner(owner);
  return (rows || []).map(mapRow);
}
export async function pushCloudRecord(input, expected) {
  const owner = await assertSyncOwner(expected);
  const result = injected && typeof injected.pushRecord === 'function'
    ? await dispatchSyncRequest(owner, () => injected.pushRecord(input))
    : await requestCloud(owner, 'rpc/journal_sync_push', {
      p_entity_type: input.entityType, p_entity_id: input.entityId, p_payload: input.payload,
      p_expected_revision: input.expectedRevision, p_tombstone: Boolean(input.tombstone), p_device_id: input.deviceId,
    });
  await assertSyncOwner(owner);
  return result;
}

export function createMemoryCloud(initial = []) {
  const rows = new Map();
  for (const row of initial) {
    const mapped = mapRow(row);
    rows.set(mapped.entityType + "::" + mapped.entityId, mapped);
  }
  const conflicts = [];
  return {
    rows,
    conflicts,
    async pullRecords() {
      return Array.from(rows.values()).map((row) => ({ ...row }));
    },
    async pushRecord(input) {
      const key = input.entityType + "::" + input.entityId;
      const current = rows.get(key);
      if (!current) {
        if (Number(input.expectedRevision) !== 0) return { ok: false, kind: "missing" };
        const next = {
          entityType: input.entityType,
          entityId: input.entityId,
          payload: input.payload,
          revision: 1,
          tombstone: Boolean(input.tombstone),
          updatedByDevice: input.deviceId,
        };
        rows.set(key, next);
        return { ok: true, revision: 1 };
      }
      if (current.revision !== Number(input.expectedRevision)) {
        conflicts.push({
          entityType: input.entityType,
          entityId: input.entityId,
          cloudRevision: current.revision,
          cloudPayload: current.payload,
          incomingPayload: input.payload,
        });
        return {
          ok: false,
          kind: "conflict",
          cloud_revision: current.revision,
          cloud_payload: current.payload,
        };
      }
      const revision = current.revision + 1;
      rows.set(key, {
        ...current,
        payload: input.payload,
        revision,
        tombstone: Boolean(input.tombstone),
        updatedByDevice: input.deviceId,
      });
      return { ok: true, revision };
    },
  };
}
