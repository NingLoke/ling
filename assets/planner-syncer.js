// Runs sync: keeps the bookkeeping from ./planner-sync.js up to date, pushes pending changes, applies what other devices
// wrote. Talks to the cloud through an adapter with the same functions as ./planner-cloud.js, so tests can swap in a fake.
// No DOM code in here.

import * as Y from "./planner-sync.js?v=8c0b4fd8da";

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
  let heard = false; // the listener has answered from the server since it (re)started
  let listenErrors = 0; // listener failures in a row; only a listener answer resets it
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
  // "synced" only when nothing is waiting and the listener is live
  const settledStatus = () =>
    !Y.pendingCount(meta) && heard && !flushing ? { mode: "synced", error: "", lastSync: now() } : { mode: "syncing", error: "" };

  /** fromPush: records read inside a push transaction. They must not move the cursor ("downloaded up to here"). */
  function applyRemote(records, { fromPush = false } = {}) {
    const list = fromPush ? records.map((r) => ({ ...r, serverAt: null })) : records;
    const result = Y.applyRemote(getState(), meta, list);
    meta = result.meta;
    saveMeta();
    if (result.changed) setState(result.state);
  }

  function startListening() {
    stopListening();
    if (!user) return;
    heard = false;
    unlisten = cloud.listen(
      user.uid,
      meta.cursor,
      (records, info = {}) => {
        if (records.length) applyRemote(records);
        if (info.fromCache) return; // not from the server yet: says nothing about being in sync
        heard = true;
        listenErrors = 0;
        if (status.mode !== "offline" || !Y.pendingCount(meta)) setStatus(settledStatus());
        else setStatus({});
      },
      (error) => {
        unlisten = null;
        heard = false;
        listenErrors++;
        setStatus({ mode: isOffline() ? "offline" : "error", error: cloud.explainError(error) });
        scheduleRetry();
      },
    );
  }

  function stopListening() {
    if (unlisten) unlisten();
    unlisten = null;
    heard = false;
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    const step = Math.max(retries, listenErrors - 1);
    retries++;
    retryTimer = setTimeout(() => {
      if (!user) return;
      if (!unlisten) startListening();
      flush();
    }, RETRY_MS[Math.min(step, RETRY_MS.length - 1)]);
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
    const uid = user.uid;
    flushing = true;
    let failed = null;
    try {
      rounds: do {
        again = false;
        const batches = Y.pushBatches(meta);
        if (batches.length) setStatus({ mode: "syncing" });
        for (const batch of batches) {
          if (user?.uid !== uid || meta.uid !== uid) break rounds; // signed out (or switched) meanwhile
          const { pushed, newer } = await cloud.push(uid, batch);
          if (user?.uid !== uid) break rounds;
          // apply the server's versions BEFORE acking: on a tie the still-pending record lets the server's win
          if (newer.length) applyRemote(newer, { fromPush: true });
          meta = Y.ackPushed(meta, pushed);
          saveMeta();
        }
      } while (again);
      retries = 0;
    } catch (error) {
      failed = error;
    } finally {
      flushing = false;
    }
    if (user?.uid !== uid) {
      // signed out or switched while pushing: the new account's own flush may have been queued meanwhile
      if (user && again) flush();
      return;
    }
    if (failed) {
      setStatus({ mode: isOffline() || /unavailable|network|deadline/.test(String(failed?.code)) ? "offline" : "error", error: cloud.explainError(failed) });
      scheduleRetry();
      return;
    }
    setStatus(settledStatus());
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
      listenErrors = 0;
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
      again = false;
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
