// Runs sync: keeps the bookkeeping from ./sync.js up to date, pushes pending changes, applies what other devices
// wrote. Talks to the cloud through an adapter with the same functions as ./cloud.js, so tests can swap in a fake.
// No DOM code in here.

import * as Y from "./sync.js";

const RETRY_MS = [3_000, 10_000, 30_000, 60_000];
// navigator.onLine is only trustworthy when it says false
const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * createSyncer({ cloud, storage, getState, setState, onStatus, now })
 *   getState()        the current planner state
 *   setState(state)   called with a new state when another device changed something
 *   onStatus(status)  { mode: "off"|"signed-out"|"syncing"|"synced"|"offline"|"error", user, pending, error, lastSync }
 */
export function createSyncer({ cloud, storage, getState, setState, onStatus = () => {}, now = () => Date.now() }) {
  let meta = Y.loadMeta(storage);
  let user = null;
  let unlisten = null;
  let flushing = false;
  let again = false;
  let retryTimer = null;
  let flushTimer = null;
  let retries = 0;
  let status = { mode: "off", user: null, pending: Y.pendingCount(meta), error: "", lastSync: 0 };
  let lastLocal = 0;

  const setStatus = (patch) => {
    status = { ...status, ...patch, user, pending: Y.pendingCount(meta) };
    onStatus(status);
  };
  const saveMeta = () => Y.saveMeta(storage, meta);
  // updatedAt must grow even if the clock doesn't between two quick changes
  const stamp = () => (lastLocal = Math.max(now(), lastLocal + 1));

  function applyRemote(records) {
    const result = Y.applyRemote(getState(), meta, records);
    meta = result.meta;
    saveMeta();
    if (result.changed) setState(result.state);
  }

  function startListening() {
    stopListening();
    if (!user) return;
    unlisten = cloud.listen(
      user.uid,
      meta.cursor,
      (records) => {
        applyRemote(records);
        if (!Y.pendingCount(meta) && !flushing) setStatus({ mode: "synced", error: "", lastSync: now() });
        else setStatus({});
      },
      (error) => {
        unlisten = null;
        setStatus({ mode: "error", error: cloud.explainError(error) });
        scheduleRetry();
      },
    );
  }

  function stopListening() {
    if (unlisten) unlisten();
    unlisten = null;
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    const wait = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)];
    retries++;
    retryTimer = setTimeout(() => {
      if (!user) return;
      if (!unlisten) startListening();
      flush();
    }, wait);
  }

  async function flush() {
    if (!user) return;
    if (flushing) {
      again = true;
      return;
    }
    if (isOffline()) {
      // don't wait for a transaction to time out: say so now, try again later (or on the "online" event)
      if (Y.pendingCount(meta)) setStatus({ mode: "offline", error: "" });
      scheduleRetry();
      return;
    }
    flushing = true;
    try {
      do {
        again = false;
        const batches = Y.pushBatches(meta);
        if (batches.length) setStatus({ mode: "syncing" });
        for (const batch of batches) {
          const uid = user?.uid;
          if (!uid || uid !== meta.uid) return; // signed out (or switched) meanwhile
          const { pushed, newer } = await cloud.push(uid, batch);
          if (user?.uid !== uid) return;
          meta = Y.ackPushed(meta, pushed);
          saveMeta();
          if (newer.length) applyRemote(newer);
        }
      } while (again);
      retries = 0;
      setStatus({ mode: unlisten ? "synced" : "syncing", error: "", lastSync: now() });
    } catch (error) {
      setStatus({ mode: isOffline() || /unavailable|network/.test(String(error?.code)) ? "offline" : "error", error: cloud.explainError(error) });
      scheduleRetry();
    } finally {
      flushing = false;
    }
  }

  return {
    get status() {
      return status;
    },
    get meta() {
      return meta;
    },

    /** Call with every local change, before or after setting the new state. */
    localChange(prev, next) {
      const changes = Y.diffStates(prev, next);
      if (!changes.length) return;
      meta = Y.recordLocalChanges(meta, changes, stamp());
      saveMeta();
      if (!user) return setStatus({});
      setStatus({ mode: isOffline() ? "offline" : "syncing" });
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 400);
    },

    /** Signed-in user changed (null = signed out). */
    setUser(next) {
      // the first answer may well be "nobody" (user is already null), which still has to leave the "off" status
      if (next?.uid === user?.uid && status.mode !== "off") return;
      stopListening();
      clearTimeout(retryTimer);
      user = next;
      retries = 0;
      if (!user) return setStatus({ mode: "signed-out", error: "" });
      if (meta.uid !== user.uid) meta = Y.adoptLocal(getState(), meta, user.uid);
      saveMeta();
      setStatus({ mode: "syncing", error: "" });
      startListening();
      flush();
    },

    /** Try again now (back online, page shown again, "sync now" tapped). */
    retry() {
      if (!user) return;
      retries = 0;
      clearTimeout(retryTimer);
      if (!unlisten) startListening();
      flush();
    },

    /** Another tab saved new bookkeeping. */
    reloadMeta() {
      meta = Y.loadMeta(storage);
      setStatus({});
    },

    /** Forget this device's sync bookkeeping (after signing out and clearing local data). */
    reset() {
      stopListening();
      clearTimeout(retryTimer);
      clearTimeout(flushTimer);
      user = null;
      meta = Y.emptyMeta();
      saveMeta();
      setStatus({ mode: "signed-out", error: "" });
    },

    /** Resolves when nothing is being pushed (for tests). */
    async idle() {
      clearTimeout(flushTimer);
      await flush();
      while (flushing) await new Promise((r) => setTimeout(r, 5));
    },

    stop() {
      stopListening();
      clearTimeout(retryTimer);
      clearTimeout(flushTimer);
    },
  };
}
