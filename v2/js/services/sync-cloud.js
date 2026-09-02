import { getAuthClient } from "./auth.js";

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

export async function pullCloudRecords() {
  if (injected && typeof injected.pullRecords === "function") {
    const rows = await injected.pullRecords();
    return Array.isArray(rows) ? rows.map(mapRow) : [];
  }
  const client = await getAuthClient();
  if (!client || typeof client.from !== "function") {
    throw new Error("cliente de sync no disponible");
  }
  const { data, error } = await client
    .from("journal_sync_records")
    .select("entity_type, entity_id, payload, revision, tombstone, updated_at, updated_by_device");
  if (error) throw new Error(error.message || "no se pudo leer la nube");
  return (data || []).map(mapRow);
}

export async function pushCloudRecord(input) {
  if (injected && typeof injected.pushRecord === "function") {
    return injected.pushRecord(input);
  }
  const client = await getAuthClient();
  if (!client || typeof client.rpc !== "function") {
    throw new Error("cliente de sync no disponible");
  }
  const { data, error } = await client.rpc("journal_sync_push", {
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_payload: input.payload,
    p_expected_revision: input.expectedRevision,
    p_tombstone: Boolean(input.tombstone),
    p_device_id: input.deviceId,
  });
  if (error) throw new Error(error.message || "no se pudo empujar");
  return data;
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
