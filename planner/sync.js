// Sync rules between this device and the cloud. No DOM or Firebase code in here, so it can be tested with node.
//
// The planner state (see ./store.js) is cut into small records, one per thing that can change on its own:
//   events~<id>  habits~<id>  todos~<id>   one item each (data = the item)
//   tick~<date>~<habitId>                  one daily-task tick (data = {date, habit})
//   setting~<name>                         one setting (data = {value})
// Each record carries updatedAt (ms, the clock of the device that made the change). A deleted record stays on the
// server as a tombstone (deleted: true) so other devices learn about the delete.
//
// Rules:
//   - A local change becomes a pending record (and bumps versions[docId]) until the server has it.
//   - The server keeps the newest version of each record: a push only overwrites when its updatedAt is newer
//     (checked inside a transaction by the cloud adapter, using shouldWrite below).
//   - A record from the server replaces the local one unless this device has a newer pending change to it.
//   - cursor = the latest server time seen, so a device only downloads what changed since last time.

import { normalize } from "./store.js";

export const SYNC_KEY = "planner:sync";
const KINDS = ["events", "habits", "todos"];

export const emptyMeta = () => ({ uid: null, cursor: 0, versions: {}, pending: {} });

export function loadMeta(storage) {
  try {
    const raw = JSON.parse(storage?.getItem(SYNC_KEY) || "null");
    if (raw && typeof raw === "object") {
      return {
        uid: typeof raw.uid === "string" ? raw.uid : null,
        cursor: Number(raw.cursor) || 0,
        versions: raw.versions && typeof raw.versions === "object" ? raw.versions : {},
        pending: raw.pending && typeof raw.pending === "object" ? raw.pending : {},
      };
    }
  } catch {}
  return emptyMeta();
}

export function saveMeta(storage, meta) {
  try {
    storage?.setItem(SYNC_KEY, JSON.stringify(meta));
    return true;
  } catch {
    return false;
  }
}

export const pendingCount = (meta) => Object.keys(meta.pending).length;

// ---------- state <-> records ----------

// Document ids: "~" never appears in item ids (store.newId uses [a-z0-9]) or ISO dates.
export const docIdOf = (kind, id) => `${kind}~${id}`;

/** Every record the state is made of: Map docId -> {kind, id, data}. */
export function toRecords(state) {
  const out = new Map();
  for (const kind of KINDS) for (const item of state[kind]) out.set(docIdOf(kind, item.id), { kind, id: item.id, data: item });
  for (const [date, ids] of Object.entries(state.habitDone)) {
    for (const habit of ids) out.set(docIdOf("tick", `${date}~${habit}`), { kind: "tick", id: `${date}~${habit}`, data: { date, habit } });
  }
  for (const [name, value] of Object.entries(state.settings)) out.set(docIdOf("setting", name), { kind: "setting", id: name, data: { value } });
  return out;
}

/** What changed between two states: [{docId, kind, id, data}] where data null = deleted. */
export function diffStates(prev, next) {
  const before = toRecords(prev);
  const after = toRecords(next);
  const changes = [];
  for (const [docId, rec] of after) {
    const old = before.get(docId);
    if (!old || JSON.stringify(old.data) !== JSON.stringify(rec.data)) changes.push({ docId, ...rec });
  }
  for (const [docId, rec] of before) if (!after.has(docId)) changes.push({ docId, kind: rec.kind, id: rec.id, data: null });
  return changes;
}

/** Put one record (from the server) into the state. Returns a new state. */
export function applyRecord(state, rec) {
  const { kind, id, deleted } = rec;
  const data = deleted ? null : rec.data;
  if (KINDS.includes(kind)) {
    const list = state[kind].filter((x) => x.id !== id);
    if (data && typeof data === "object") {
      const index = state[kind].findIndex((x) => x.id === id);
      const item = { ...data, id };
      if (index === -1) list.push(item);
      else list.splice(index, 0, item); // keep the order the list had
    }
    return { ...state, [kind]: list };
  }
  if (kind === "tick") {
    const [date, habit] = id.split("~");
    const ids = (state.habitDone[date] || []).filter((x) => x !== habit);
    if (data) ids.push(habit);
    const habitDone = { ...state.habitDone };
    if (ids.length) habitDone[date] = ids;
    else delete habitDone[date];
    return { ...state, habitDone };
  }
  if (kind === "setting") {
    if (!data) return state;
    return { ...state, settings: { ...state.settings, [id]: data.value } };
  }
  return state;
}

// ---------- the sync bookkeeping ----------

/** Remember local changes as pending records. `now` must grow: a change in the same ms as the last one still wins. */
export function recordLocalChanges(meta, changes, now) {
  if (!changes.length) return meta;
  const versions = { ...meta.versions };
  const pending = { ...meta.pending };
  for (const c of changes) {
    const updatedAt = Math.max(now, (versions[c.docId] || 0) + 1);
    versions[c.docId] = updatedAt;
    pending[c.docId] = { docId: c.docId, kind: c.kind, id: c.id, data: c.data, deleted: c.data == null, updatedAt };
  }
  return { ...meta, versions, pending };
}

/**
 * First sign-in on this device (or a different account): everything already here becomes pending, so it gets
 * uploaded. Records the server already has with a newer version win when the first download arrives.
 */
export function adoptLocal(state, meta, uid) {
  const versions = {};
  const pending = {};
  for (const [docId, rec] of toRecords(state)) {
    const updatedAt = meta.versions[docId] || 1;
    versions[docId] = updatedAt;
    pending[docId] = { docId, kind: rec.kind, id: rec.id, data: rec.data, deleted: false, updatedAt };
  }
  // keep deletes that were never uploaded too
  for (const [docId, rec] of Object.entries(meta.pending)) {
    if (rec.deleted && !pending[docId]) {
      pending[docId] = rec;
      versions[docId] = rec.updatedAt;
    }
  }
  return { uid, cursor: 0, versions, pending };
}

/**
 * Records that arrived from the server. Returns the new state and meta.
 * Each remote record: {docId, kind, id, data, deleted, updatedAt, serverAt}.
 */
export function applyRemote(state, meta, records) {
  let next = state;
  const versions = { ...meta.versions };
  const pending = { ...meta.pending };
  let cursor = meta.cursor;
  let changed = false;
  for (const r of records) {
    if (!r || typeof r.docId !== "string" || !Number.isFinite(r.updatedAt)) continue;
    if (Number.isFinite(r.serverAt)) cursor = Math.max(cursor, r.serverAt);
    const mine = pending[r.docId];
    if (mine && mine.updatedAt > r.updatedAt) continue; // our change is newer; it will be pushed
    if (mine) delete pending[r.docId];
    if (!mine && versions[r.docId] === r.updatedAt) continue; // this version is already here
    versions[r.docId] = r.updatedAt;
    next = applyRecord(next, r);
    changed = true;
  }
  return { state: changed ? normalize(next) : state, meta: { ...meta, versions, pending, cursor }, changed };
}

/** Server-side rule (used inside the push transaction): write ours only if the server has nothing newer. */
export const shouldWrite = (serverDoc, rec) => !serverDoc || !(Number(serverDoc.updatedAt) >= rec.updatedAt);

/** After a push: drop the pending records that went up (unless they were changed again meanwhile). */
export function ackPushed(meta, pushed) {
  const pending = { ...meta.pending };
  for (const rec of pushed) if (pending[rec.docId]?.updatedAt === rec.updatedAt) delete pending[rec.docId];
  return { ...meta, pending };
}

/** Pending records in upload order (oldest change first), in chunks small enough for one transaction. */
export function pushBatches(meta, size = 100) {
  const list = Object.values(meta.pending).sort((a, b) => a.updatedAt - b.updatedAt);
  const batches = [];
  for (let i = 0; i < list.length; i += size) batches.push(list.slice(i, i + size));
  return batches;
}
