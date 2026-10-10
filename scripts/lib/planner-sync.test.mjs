// Tests for planner cloud sync: the pure bookkeeping in assets/planner-sync.js, and assets/planner-syncer.js running on several
// simulated devices against an in-memory fake of the Firestore adapter (assets/planner-cloud.js).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as S from "../../assets/planner-store.js";
import * as Y from "../../assets/planner-sync.js";
import { createSyncer } from "../../assets/planner-syncer.js";

const DAY = "2026-10-10";
const DAY2 = "2026-10-11";
const SLACK = 10 * 60 * 1000; // same as CURSOR_SLACK_MS in assets/planner-cloud.js
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const clone = (x) => (x == null ? null : JSON.parse(JSON.stringify(x)));
const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

const todo = (id, title, extra = {}) => ({ id, title, due: null, star: false, created: 1, ...extra });
const event = (id, title, extra = {}) => ({ id, title, date: DAY, start: 540, end: 600, place: "", created: 1, ...extra });
const habit = (id, title, extra = {}) => ({ id, title, days: [0, 1, 2, 3, 4, 5, 6], from: "2026-10-01", created: 1, ...extra });
const add = (kind, item) => (s) => S.upsert(s, kind, item);
const rename = (kind, id, title) => (s) => S.upsert(s, kind, { id, title });
const del = (kind, id) => (s) => S.remove(s, kind, id);
const tick = (id, iso = DAY) => (s) => S.toggleHabit(s, id, iso);
const setClass = (value) => (s) => ({ ...s, settings: { ...s.settings, classSource: value } });

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
}

function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
  return v;
}

/** One string per planner state, independent of list order, key order and empty tick dates. */
function canonical(state) {
  const s = S.normalize(state);
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const habitDone = {};
  for (const d of Object.keys(s.habitDone).sort()) {
    const ids = [...new Set(s.habitDone[d])].sort();
    if (ids.length) habitDone[d] = ids;
  }
  return JSON.stringify(
    sortDeep({ events: [...s.events].sort(byId), habits: [...s.habits].sort(byId), todos: [...s.todos].sort(byId), habitDone, settings: s.settings }),
  );
}

const titleOf = (state, kind, id) => state[kind].find((x) => x.id === id)?.title;
const ids = (list) => list.map((x) => x.id).sort();

// ---------------------------------------------------------------------------------------------------------------
// Fake cloud: one shared server, several devices. Mirrors assets/planner-cloud.js:
//   - push(uid, batch): one atomic transaction; each record is written only if shouldWrite(serverDoc, rec);
//     all writes in it get the same commit time (serverAt = request.time). Returns { pushed: batch, newer }.
//     Throws { code: "unavailable" } when the device is offline (before the commit, or "response lost" after it).
//   - listen(uid, cursor, onRecords, onError): first delivers every doc with serverAt > cursor - SLACK, then every
//     later commit. Deliveries are async (like onSnapshot), held while the device is offline and caught up when it
//     comes back online. A device's own writes come back too (transactions are not latency-compensated).
// ---------------------------------------------------------------------------------------------------------------

class World {
  constructor() {
    this.t = Date.UTC(2026, 9, 10, 1, 0, 0); // true time; the server's clock follows it
    this.lastServerAt = 0;
    this.users = new Map();
    this.listeners = new Set();
    this.devices = [];
  }

  advance(ms) {
    this.t += ms;
  }

  serverNow() {
    return (this.lastServerAt = Math.max(this.t, this.lastServerAt + 1));
  }

  col(uid) {
    if (!this.users.has(uid)) this.users.set(uid, new Map());
    return this.users.get(uid);
  }

  toRecord(docId, doc) {
    return { docId, kind: doc.kind, id: doc.id, data: clone(doc.data), deleted: !!doc.deleted, updatedAt: doc.updatedAt, serverAt: doc.serverAt };
  }

  commit(uid, batch) {
    const col = this.col(uid);
    const at = this.serverNow();
    const newer = [];
    const written = [];
    for (const rec of batch) {
      const server = col.get(rec.docId) || null;
      if (Y.shouldWrite(server, rec)) {
        col.set(rec.docId, { kind: rec.kind, id: rec.id, data: rec.deleted ? null : clone(rec.data), deleted: !!rec.deleted, updatedAt: rec.updatedAt, serverAt: at });
        written.push(rec.docId);
      } else {
        newer.push(this.toRecord(rec.docId, server));
      }
    }
    for (const l of this.listeners) {
      if (l.uid !== uid) continue;
      for (const d of written) l.dirty.add(d);
      this.schedule(l);
    }
    return newer;
  }

  listen(dev, uid, cursor, onRecords, onError) {
    const since = Math.max(0, cursor - SLACK);
    const l = { dev, uid, since, onRecords, onError, dirty: new Set(), active: true, scheduled: false };
    for (const [docId, doc] of this.col(uid)) if (doc.serverAt > since) l.dirty.add(docId);
    this.listeners.add(l);
    dev.listens.push({ cursor, since });
    this.schedule(l);
    return () => {
      l.active = false;
      this.listeners.delete(l);
    };
  }

  schedule(l) {
    if (!l.active || l.scheduled) return;
    l.scheduled = true;
    setTimeout(() => {
      l.scheduled = false;
      this.deliver(l);
    }, 0);
  }

  deliver(l) {
    if (!l.active || !l.dev.online || l.dev.holdListen || !l.dirty.size) return;
    const col = this.col(l.uid);
    const list = [...l.dirty]
      .map((d) => [d, col.get(d)])
      .filter(([, doc]) => doc && doc.serverAt > l.since)
      .sort((a, b) => a[1].serverAt - b[1].serverAt || (a[0] < b[0] ? -1 : 1))
      .map(([d, doc]) => this.toRecord(d, doc));
    l.dirty.clear();
    l.dev.delivered += list.length;
    if (list.length) l.onRecords(list);
  }

  wake(dev) {
    for (const l of this.listeners) if (l.dev === dev) this.schedule(l);
  }

  failListeners(dev, error = { code: "unavailable" }) {
    for (const l of [...this.listeners]) {
      if (l.dev !== dev) continue;
      l.active = false;
      this.listeners.delete(l);
      l.onError(error);
    }
  }

  listenersOf(dev) {
    return [...this.listeners].filter((l) => l.dev === dev).length;
  }

  quiet() {
    return [...this.listeners].every((l) => !l.scheduled && (!l.dirty.size || !l.dev.online || l.dev.holdListen));
  }

  /** The planner state the server's records add up to. */
  stateOf(uid = "u1") {
    let s = S.emptyState();
    const docs = [...this.col(uid)].sort((a, b) => a[1].serverAt - b[1].serverAt);
    for (const [docId, doc] of docs) s = Y.applyRecord(s, { docId, ...doc });
    return S.normalize(s);
  }

  device(name, { skew = 0, pushDelay = 0, state = S.emptyState() } = {}) {
    const world = this;
    const dev = {
      name,
      skew,
      pushDelay,
      state,
      online: true,
      holdListen: false,
      pushGate: null,
      storage: memStorage(),
      uid: null,
      listens: [],
      delivered: 0,
      pushCalls: 0,
      maxBatch: 0,
      statuses: [],
      now: () => world.t + dev.skew,
    };
    dev.cloud = {
      listen: (uid, cursor, onRecords, onError) => world.listen(dev, uid, cursor, onRecords, onError),
      async push(uid, batch) {
        dev.pushCalls++;
        dev.maxBatch = Math.max(dev.maxBatch, batch.length);
        if (!dev.online) throw { code: "unavailable", message: "offline" };
        const newer = world.commit(uid, batch);
        if (dev.pushGate) await dev.pushGate.promise;
        else if (dev.pushDelay) await sleep(dev.pushDelay);
        else await null;
        if (!dev.online) throw { code: "unavailable", message: "response lost" };
        return { pushed: batch, newer };
      },
      explainError: (e) => String(e?.code || e?.message || e),
    };
    dev.boot = () => {
      dev.syncer = createSyncer({
        cloud: dev.cloud,
        storage: dev.storage,
        getState: () => dev.state,
        setState: (s) => (dev.state = s),
        onStatus: (s) => dev.statuses.push(s),
        now: dev.now,
      });
      return dev.syncer;
    };
    // a change made on this device (like app.js commit())
    dev.edit = (fn) => {
      world.advance(1000);
      const prev = dev.state;
      const next = fn(prev);
      dev.state = next;
      dev.syncer.localChange(prev, next);
      return next;
    };
    dev.signIn = (uid = "u1") => {
      dev.uid = uid;
      dev.syncer.setUser({ uid, email: `${uid}@example.com`, name: "" });
    };
    // like the sign-out button in app.js: reset sync, sign out, clear local data but keep the class
    dev.signOut = () => {
      dev.syncer.reset();
      dev.syncer.setUser(null);
      dev.uid = null;
      const classSource = dev.state.settings.classSource;
      dev.state = { ...S.emptyState(), settings: { ...S.emptyState().settings, classSource } };
    };
    dev.goOffline = () => {
      dev.online = false;
    };
    dev.goOnline = () => {
      dev.online = true;
      world.wake(dev);
      dev.syncer.retry(); // app.js does this on the "online" event
    };
    // app closed and opened again: same storage and saved state, new syncer
    dev.restart = () => {
      dev.syncer.stop();
      dev.boot();
      if (dev.uid) dev.syncer.setUser({ uid: dev.uid, email: "", name: "" });
    };
    dev.boot();
    this.devices.push(dev);
    return dev;
  }

  /** Let every device push and every listener deliver until nothing moves. */
  async settle(devs = this.devices) {
    for (let round = 0; round < 60; round++) {
      for (const d of devs) if (!d.pushGate) await d.syncer.idle();
      await sleep(1);
      const done = devs.every((d) => !d.online || d.pushGate || !d.syncer.status.user || !Y.pendingCount(d.syncer.meta));
      if (done && this.quiet()) return;
    }
    throw new Error(`did not settle: ${devs.map((d) => `${d.name} pending=${Y.pendingCount(d.syncer.meta)}`).join(", ")}`);
  }

  close() {
    for (const d of this.devices) d.syncer.stop();
  }
}

/** Run fn with a fresh world, always stopping the syncers' timers afterwards. */
const inWorld = (fn) => async () => {
  const w = new World();
  try {
    await fn(w);
  } finally {
    w.close();
  }
};

function assertSame(w, devs, uid = "u1") {
  const [first, ...rest] = devs;
  for (const d of rest) assert.equal(canonical(d.state), canonical(first.state), `${d.name} differs from ${first.name}`);
  assert.equal(canonical(w.stateOf(uid)), canonical(first.state), `server differs from ${first.name}`);
  for (const d of devs) assert.equal(Y.pendingCount(d.syncer.meta), 0, `${d.name} still has pending records`);
}

async function twoDevices(w, opts = {}) {
  const A = w.device("A", opts.A);
  const B = w.device("B", { skew: 3, ...opts.B });
  A.signIn();
  B.signIn();
  await w.settle();
  return [A, B];
}

// ===============================================================================================================
// sync.js: pure functions
// ===============================================================================================================

describe("sync.js: bookkeeping storage", () => {
  test("loadMeta falls back to empty meta on missing or broken data; saveMeta round-trips", () => {
    assert.deepEqual(Y.loadMeta(null), Y.emptyMeta());
    assert.deepEqual(Y.loadMeta({ getItem: () => "{oops" }), Y.emptyMeta());
    assert.deepEqual(Y.loadMeta({ getItem: () => '"text"' }), Y.emptyMeta());
    assert.deepEqual(Y.loadMeta({ getItem: () => '{"uid":5,"cursor":"x","versions":3}' }), Y.emptyMeta());
    assert.deepEqual(Y.loadMeta({ getItem: () => { throw new Error("denied"); } }), Y.emptyMeta());
    const st = memStorage();
    const meta = { uid: "u1", cursor: 42, versions: { "todos~a": 7 }, pending: { "todos~a": { docId: "todos~a", updatedAt: 7 } } };
    assert.equal(Y.saveMeta(st, meta), true);
    assert.deepEqual(Y.loadMeta(st), meta);
    assert.equal(Y.saveMeta({ setItem: () => { throw new Error("full"); } }, meta), false);
  });
});

describe("sync.js: state <-> records", () => {
  test("toRecords cuts the state into one record per item, tick and setting", () => {
    let s = S.emptyState();
    s = S.upsert(s, "todos", todo("t1", "milk"));
    s = S.upsert(s, "events", event("e1", "lunch"));
    s = S.upsert(s, "habits", habit("h1", "run"));
    s = S.toggleHabit(s, "h1", DAY);
    s = S.toggleHabit(s, "h1", DAY2);
    s = S.toggleHabit(s, "h1", DAY2); // off again: an empty date has no records
    const recs = Y.toRecords(s);
    assert.deepEqual([...recs.keys()].sort(), ["events~e1", "habits~h1", "setting~classSource", `tick~${DAY}~h1`, "todos~t1"]);
    assert.deepEqual(recs.get(`tick~${DAY}~h1`), { kind: "tick", id: `${DAY}~h1`, data: { date: DAY, habit: "h1" } });
    assert.deepEqual(recs.get("setting~classSource"), { kind: "setting", id: "classSource", data: { value: "2E3" } });
    assert.deepEqual(recs.get("todos~t1"), { kind: "todos", id: "t1", data: s.todos[0] });
    assert.equal(Y.docIdOf("events", "e1"), "events~e1");
  });

  test("diffStates: adds, edits, deletes, ticks and settings; nothing for an unchanged state", () => {
    let a = S.emptyState();
    a = S.upsert(a, "todos", todo("t1", "milk"));
    a = S.upsert(a, "habits", habit("h1", "run"));
    a = S.toggleHabit(a, "h1", DAY);
    assert.deepEqual(Y.diffStates(a, a), []);
    assert.deepEqual(Y.diffStates(a, JSON.parse(JSON.stringify(a))), [], "an equal copy is not a change");

    let b = S.upsert(a, "todos", { id: "t1", title: "oat milk" });
    b = S.upsert(b, "events", event("e1", "lunch"));
    b = S.toggleHabit(b, "h1", DAY); // tick off
    b = S.toggleHabit(b, "h1", DAY2); // tick on
    b = setClass("2E5")(b);
    const changes = Object.fromEntries(Y.diffStates(a, b).map((c) => [c.docId, c]));
    assert.deepEqual(Object.keys(changes).sort(), ["events~e1", "setting~classSource", `tick~${DAY}~h1`, `tick~${DAY2}~h1`, "todos~t1"]);
    assert.equal(changes["todos~t1"].data.title, "oat milk");
    assert.equal(changes[`tick~${DAY}~h1`].data, null);
    assert.deepEqual(changes[`tick~${DAY2}~h1`].data, { date: DAY2, habit: "h1" });
    assert.deepEqual(changes["setting~classSource"].data, { value: "2E5" });
    assert.deepEqual({ kind: changes["events~e1"].kind, id: changes["events~e1"].id }, { kind: "events", id: "e1" });

    // removing a habit deletes it and all of its ticks
    const c = Y.diffStates(b, S.remove(b, "habits", "h1"));
    assert.deepEqual(c.map((x) => [x.docId, x.data]).sort(), [["habits~h1", null], [`tick~${DAY2}~h1`, null]]);
  });

  test("applyRecord keeps list order on update, appends new items, drops empty tick dates, ignores unknown kinds", () => {
    let s = S.emptyState();
    for (const id of ["a", "b", "c"]) s = S.upsert(s, "todos", todo(id, id));
    s = Y.applyRecord(s, { kind: "todos", id: "b", data: todo("b", "B!"), deleted: false });
    assert.deepEqual(s.todos.map((t) => t.title), ["a", "B!", "c"]);
    s = Y.applyRecord(s, { kind: "todos", id: "d", data: todo("d", "d"), deleted: false });
    assert.deepEqual(s.todos.map((t) => t.id), ["a", "b", "c", "d"]);
    s = Y.applyRecord(s, { kind: "todos", id: "a", data: null, deleted: true });
    assert.deepEqual(s.todos.map((t) => t.id), ["b", "c", "d"]);
    // record data without an id still lands under the record's id
    s = Y.applyRecord(s, { kind: "events", id: "e9", data: { title: "x", date: DAY, start: 1, end: 2 }, deleted: false });
    assert.equal(s.events[0].id, "e9");

    s = Y.applyRecord(s, { kind: "tick", id: `${DAY}~h1`, data: { date: DAY, habit: "h1" }, deleted: false });
    s = Y.applyRecord(s, { kind: "tick", id: `${DAY}~h1`, data: { date: DAY, habit: "h1" }, deleted: false });
    assert.deepEqual(s.habitDone, { [DAY]: ["h1"] }, "applying a tick twice keeps one tick");
    s = Y.applyRecord(s, { kind: "tick", id: `${DAY}~h1`, data: null, deleted: true });
    assert.deepEqual(s.habitDone, {});

    s = Y.applyRecord(s, { kind: "setting", id: "classSource", data: { value: "2E9" }, deleted: false });
    assert.equal(s.settings.classSource, "2E9");
    assert.equal(Y.applyRecord(s, { kind: "nope", id: "x", data: {} }), s);
  });

  test("round trip: replaying each diffStates() onto a replica keeps it equal (300 random edits)", () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const dates = [DAY, DAY2, "2026-10-12"];
    let cur = S.emptyState();
    let replica = { state: S.emptyState(), meta: Y.emptyMeta() };
    let n = 0;
    for (let step = 0; step < 300; step++) {
      const kind = pick(["todos", "events", "habits"]);
      const existing = cur[kind];
      const r = rand();
      let next;
      if (r < 0.3 || !existing.length) {
        const id = `${kind[0]}${n++}`;
        next = S.upsert(cur, kind, kind === "todos" ? todo(id, `t${id}`) : kind === "events" ? event(id, `e${id}`) : habit(id, `h${id}`));
      } else if (r < 0.5) next = S.upsert(cur, kind, { id: pick(existing).id, title: `edit${step}` });
      else if (r < 0.6) next = S.remove(cur, kind, pick(existing).id);
      else if (r < 0.8 && cur.habits.length) next = S.toggleHabit(cur, pick(cur.habits).id, pick(dates));
      else if (r < 0.9 && cur.todos.length) next = S.toggleTodo(cur, pick(cur.todos).id, DAY);
      else next = setClass(pick(["2E3", "2E5", "2E7", ""]))(cur);
      const records = Y.diffStates(cur, next).map((c) => ({ ...c, deleted: c.data == null, updatedAt: step + 1, serverAt: step + 1 }));
      replica = Y.applyRemote(replica.state, replica.meta, records);
      assert.equal(canonical(replica.state), canonical(next), `step ${step}`);
      cur = next;
    }
  });

  test("round trip: removing a setting key removes it on the other device too", () => {
    // e.g. importing a backup with an extra setting, then importing one without it
    const a = S.normalize({ settings: { classSource: "2E3", theme: "dark" } });
    const b = S.normalize({ settings: { classSource: "2E3" } });
    const changes = Y.diffStates(a, b);
    assert.deepEqual(changes.map((c) => [c.docId, c.data]), [["setting~theme", null]]);
    const records = changes.map((c) => ({ ...c, deleted: true, updatedAt: 5, serverAt: 5 }));
    const out = Y.applyRemote(a, Y.emptyMeta(), records);
    assert.equal(canonical(out.state), canonical(b));
  });
});

describe("sync.js: local changes", () => {
  const change = (docId, data = { id: docId.split("~")[1], title: "x" }) => ({ docId, kind: docId.split("~")[0], id: docId.split("~")[1], data });

  test("recordLocalChanges stamps grow per record even when the clock stalls or goes back", () => {
    const start = Y.emptyMeta();
    assert.equal(Y.recordLocalChanges(start, [], 1000), start, "no changes, same meta");
    let meta = Y.recordLocalChanges(start, [change("todos~a")], 1000);
    assert.equal(meta.pending["todos~a"].updatedAt, 1000);
    meta = Y.recordLocalChanges(meta, [change("todos~a")], 1000); // same ms
    assert.equal(meta.pending["todos~a"].updatedAt, 1001);
    meta = Y.recordLocalChanges(meta, [change("todos~a")], 400); // clock went back
    assert.equal(meta.pending["todos~a"].updatedAt, 1002);
    assert.equal(meta.versions["todos~a"], 1002);
    meta = Y.recordLocalChanges(meta, [change("todos~b")], 400);
    assert.equal(meta.pending["todos~b"].updatedAt, 400);
    // a version that came from a device with a fast clock: the next local edit still stamps above it
    meta = { ...meta, versions: { ...meta.versions, "todos~c": 9_000_000 } };
    meta = Y.recordLocalChanges(meta, [change("todos~c")], 5000);
    assert.equal(meta.pending["todos~c"].updatedAt, 9_000_001);
    // a delete is a tombstone
    meta = Y.recordLocalChanges(meta, [{ docId: "todos~a", kind: "todos", id: "a", data: null }], 2000);
    assert.deepEqual(meta.pending["todos~a"], { docId: "todos~a", kind: "todos", id: "a", data: null, deleted: true, updatedAt: 2000 });
    assert.equal(start.pending["todos~a"], undefined, "input meta is not changed");
  });

  test("syncer: two quick local changes in the same ms get growing stamps", inWorld(async (w) => {
    const A = w.device("A");
    const frozen = w.t;
    A.now = () => frozen;
    A.boot();
    A.state = S.upsert(A.state, "todos", todo("t", "0"));
    for (let i = 1; i <= 3; i++) {
      const prev = A.state;
      A.state = S.upsert(prev, "todos", { id: "t", title: String(i) });
      A.syncer.localChange(prev, A.state);
    }
    const prev = A.state;
    A.state = S.upsert(prev, "todos", todo("u", "other"));
    A.syncer.localChange(prev, A.state);
    assert.equal(A.syncer.meta.pending["todos~t"].updatedAt, frozen + 2);
    assert.equal(A.syncer.meta.pending["todos~u"].updatedAt, frozen + 3);
  }));

  test("adoptLocal: everything on the device becomes pending, keeps known versions and unsent deletes", () => {
    let s = S.emptyState();
    s = S.upsert(s, "todos", todo("t1", "milk"));
    s = S.upsert(s, "habits", habit("h1", "run"));
    s = S.toggleHabit(s, "h1", DAY);
    const old = {
      uid: null,
      cursor: 123,
      versions: { "todos~t1": 5000, "todos~gone": 4000 },
      pending: {
        "todos~t1": { docId: "todos~t1", kind: "todos", id: "t1", data: s.todos[0], deleted: false, updatedAt: 5000 },
        "todos~gone": { docId: "todos~gone", kind: "todos", id: "gone", data: null, deleted: true, updatedAt: 4000 },
      },
    };
    const m = Y.adoptLocal(s, old, "u1");
    assert.equal(m.uid, "u1");
    assert.equal(m.cursor, 0);
    assert.deepEqual(Object.keys(m.pending).sort(), ["habits~h1", "setting~classSource", `tick~${DAY}~h1`, "todos~gone", "todos~t1"]);
    assert.equal(m.pending["todos~t1"].updatedAt, 5000);
    assert.equal(m.pending["habits~h1"].updatedAt, 1);
    assert.equal(m.pending["todos~gone"].deleted, true);
    for (const [docId, rec] of Object.entries(m.pending)) {
      assert.equal(m.versions[docId], rec.updatedAt);
      if (docId !== "todos~gone") assert.equal(rec.deleted, false);
    }
  });
});

describe("sync.js: remote records", () => {
  const rec = (docId, data, updatedAt, serverAt = updatedAt, deleted = data == null) => {
    const [kind, ...rest] = docId.split("~");
    return { docId, kind, id: rest.join("~"), data, deleted, updatedAt, serverAt };
  };
  const base = () => S.upsert(S.emptyState(), "todos", todo("t", "local"));

  test("a new remote record is applied; cursor follows the newest serverAt; state is normalized", () => {
    const out = Y.applyRemote(S.emptyState(), Y.emptyMeta(), [rec("todos~t", todo("t", "remote"), 10, 100), rec("habits~h", { title: "run" }, 11, 90)]);
    assert.equal(out.changed, true);
    assert.equal(titleOf(out.state, "todos", "t"), "remote");
    assert.deepEqual(out.state.habits[0].days, [0, 1, 2, 3, 4, 5, 6], "normalized");
    assert.equal(out.meta.cursor, 100);
    assert.deepEqual(out.meta.versions, { "todos~t": 10, "habits~h": 11 });
  });

  test("a newer local pending change beats an older remote record (and is kept to be pushed)", () => {
    const meta = Y.recordLocalChanges(Y.emptyMeta(), [{ docId: "todos~t", kind: "todos", id: "t", data: todo("t", "local") }], 50);
    const s = base();
    const out = Y.applyRemote(s, meta, [rec("todos~t", todo("t", "remote"), 40, 200)]);
    assert.equal(out.changed, false);
    assert.equal(out.state, s);
    assert.equal(out.meta.pending["todos~t"].updatedAt, 50);
    assert.equal(out.meta.cursor, 200, "cursor still moves");
  });

  test("a newer remote record beats a local pending change (pending dropped)", () => {
    const meta = Y.recordLocalChanges(Y.emptyMeta(), [{ docId: "todos~t", kind: "todos", id: "t", data: todo("t", "local") }], 50);
    const out = Y.applyRemote(base(), meta, [rec("todos~t", todo("t", "remote"), 60)]);
    assert.equal(titleOf(out.state, "todos", "t"), "remote");
    assert.equal(out.meta.pending["todos~t"], undefined);
    assert.equal(out.meta.versions["todos~t"], 60);
  });

  test("a remote tombstone deletes; a newer local edit survives an older tombstone", () => {
    let out = Y.applyRemote(base(), Y.emptyMeta(), [rec("todos~t", null, 60)]);
    assert.deepEqual(out.state.todos, []);
    const meta = Y.recordLocalChanges(Y.emptyMeta(), [{ docId: "todos~t", kind: "todos", id: "t", data: todo("t", "local") }], 70);
    out = Y.applyRemote(base(), meta, [rec("todos~t", null, 60)]);
    assert.equal(titleOf(out.state, "todos", "t"), "local");
  });

  test("tie (same updatedAt): the remote record wins, like the server's shouldWrite keeps its own", () => {
    const meta = Y.recordLocalChanges(Y.emptyMeta(), [{ docId: "todos~t", kind: "todos", id: "t", data: todo("t", "local") }], 50);
    const out = Y.applyRemote(base(), meta, [rec("todos~t", todo("t", "remote"), 50)]);
    assert.equal(titleOf(out.state, "todos", "t"), "remote");
    assert.equal(out.meta.pending["todos~t"], undefined);
    assert.equal(Y.shouldWrite({ updatedAt: 50 }, { updatedAt: 50 }), false, "server keeps its copy on a tie");
  });

  test("re-delivery of the version already here changes nothing", () => {
    const first = Y.applyRemote(S.emptyState(), Y.emptyMeta(), [rec("todos~t", todo("t", "remote"), 10, 100)]);
    const again = Y.applyRemote(first.state, first.meta, [rec("todos~t", todo("t", "remote"), 10, 100)]);
    assert.equal(again.changed, false);
    assert.equal(again.state, first.state);
  });

  test("stale re-delivery: an older record does not overwrite a newer version already here", () => {
    const first = Y.applyRemote(S.emptyState(), Y.emptyMeta(), [rec("todos~t", todo("t", "v2"), 20, 200)]);
    const stale = Y.applyRemote(first.state, first.meta, [rec("todos~t", todo("t", "v1"), 10, 100)]);
    assert.equal(titleOf(stale.state, "todos", "t"), "v2");
    assert.equal(stale.meta.versions["todos~t"], 20);
  });

  test("malformed records are skipped", () => {
    const s = S.emptyState();
    const out = Y.applyRemote(s, Y.emptyMeta(), [null, { docId: 5, updatedAt: 1 }, { docId: "todos~x", kind: "todos", id: "x", data: todo("x", "x") }]);
    assert.equal(out.changed, false);
    assert.equal(out.state, s);
  });

  test("shouldWrite: only when the server has nothing, or something older", () => {
    assert.equal(Y.shouldWrite(null, { updatedAt: 5 }), true);
    assert.equal(Y.shouldWrite(undefined, { updatedAt: 5 }), true);
    assert.equal(Y.shouldWrite({ updatedAt: 4 }, { updatedAt: 5 }), true);
    assert.equal(Y.shouldWrite({ updatedAt: 5 }, { updatedAt: 5 }), false);
    assert.equal(Y.shouldWrite({ updatedAt: 6 }, { updatedAt: 5 }), false);
    assert.equal(Y.shouldWrite({}, { updatedAt: 5 }), true, "a server doc without updatedAt is overwritten");
  });

  test("ackPushed drops only what went up unchanged; a record changed again mid-push stays pending", () => {
    const c = (docId) => ({ docId, kind: "todos", id: docId.slice(6), data: todo(docId.slice(6), "x") });
    let meta = Y.recordLocalChanges(Y.emptyMeta(), [c("todos~a"), c("todos~b")], 100);
    const pushed = Object.values(meta.pending);
    meta = Y.recordLocalChanges(meta, [c("todos~b")], 100); // b changed while the push was in flight
    const after = Y.ackPushed(meta, pushed);
    assert.deepEqual(Object.keys(after.pending), ["todos~b"]);
    assert.equal(after.pending["todos~b"].updatedAt, 101);
  });

  test("pushBatches: oldest change first, chunks of at most `size`", () => {
    assert.deepEqual(Y.pushBatches(Y.emptyMeta()), []);
    let meta = Y.emptyMeta();
    for (let i = 0; i < 250; i++) meta = Y.recordLocalChanges(meta, [{ docId: `todos~n${i}`, kind: "todos", id: `n${i}`, data: todo(`n${i}`, "x") }], 10_000 - i);
    const batches = Y.pushBatches(meta);
    assert.deepEqual(batches.map((b) => b.length), [100, 100, 50]);
    const flat = batches.flat().map((r) => r.updatedAt);
    assert.deepEqual(flat, [...flat].sort((a, b) => a - b));
    assert.equal(batches[0][0].docId, "todos~n249");
    assert.deepEqual(Y.pushBatches(meta, 120).map((b) => b.length), [120, 120, 10]);
  });
});

// ===============================================================================================================
// syncer.js on several devices
// ===============================================================================================================

describe("devices: basic sync", () => {
  test("a change on A shows up on B (todos, events, habits, ticks, settings)", inWorld(async (w) => {
    const [A, B] = await twoDevices(w);
    A.edit(add("todos", todo("t1", "buy milk")));
    A.edit(add("events", event("e1", "lunch")));
    A.edit(add("habits", habit("h1", "run")));
    A.edit(tick("h1"));
    A.edit(setClass("2E5"));
    await w.settle();
    assert.equal(titleOf(B.state, "todos", "t1"), "buy milk");
    assert.equal(titleOf(B.state, "events", "e1"), "lunch");
    assert.deepEqual(B.state.habitDone[DAY], ["h1"]);
    assert.equal(B.state.settings.classSource, "2E5");
    assertSame(w, [A, B]);
    assert.equal(A.syncer.status.mode, "synced");
    assert.equal(B.syncer.status.mode, "synced");

    // and back the other way, including deletes
    B.edit(del("todos", "t1"));
    B.edit(del("habits", "h1"));
    await w.settle();
    assert.deepEqual(A.state.todos, []);
    assert.deepEqual(A.state.habits, []);
    assert.equal(canonical(A.state).includes("h1"), false, "the habit's ticks went too");
    assertSame(w, [A, B]);
  }));

  test("changes made before signing in are kept and uploaded on sign-in", inWorld(async (w) => {
    const A = w.device("A");
    A.edit(add("todos", todo("t1", "offline note")));
    assert.equal(A.syncer.status.pending, 1);
    A.signIn();
    await w.settle();
    assert.equal(titleOf(w.stateOf(), "todos", "t1"), "offline note");
    assert.equal(A.syncer.status.mode, "synced");
  }));

  test("going offline: changes wait, status says offline, everything goes up on reconnect", inWorld(async (w) => {
    const [A, B] = await twoDevices(w);
    A.goOffline();
    A.edit(add("todos", todo("t1", "while offline")));
    await w.settle();
    assert.equal(A.syncer.status.mode, "offline");
    assert.equal(A.syncer.status.pending, 1);
    assert.deepEqual(B.state.todos, []);
    A.goOnline();
    await w.settle();
    assertSame(w, [A, B]);
    assert.equal(A.syncer.status.mode, "synced");
  }));

  test("a listener that dies is restarted by retry() and catches up", inWorld(async (w) => {
    const [A, B] = await twoDevices(w);
    w.failListeners(B, { code: "permission-denied" });
    assert.equal(B.syncer.status.mode, "error");
    A.edit(add("todos", todo("t1", "x")));
    await w.settle();
    assert.deepEqual(B.state.todos, []);
    B.syncer.retry();
    await w.settle();
    assertSame(w, [A, B]);
  }));

  test("restart: only records newer than cursor - slack are downloaded again", inWorld(async (w) => {
    const [A, B] = await twoDevices(w);
    for (let i = 0; i < 5; i++) A.edit(add("todos", todo(`t${i}`, `t${i}`)));
    await w.settle();
    w.advance(HOUR);
    A.edit(add("todos", todo("late", "late")));
    await w.settle([A]);
    B.goOffline(); // closed before it heard about "late"
    B.restart();
    B.online = true;
    const before = B.delivered;
    await w.settle();
    assert.equal(B.delivered - before, 1, "only the one new record");
    assertSame(w, [A, B]);
  }));

  test("a push whose response is lost is retried and settles", inWorld(async (w) => {
    const [A, B] = await twoDevices(w);
    A.edit(add("todos", todo("t1", "v1")));
    A.pushGate = deferred();
    A.syncer.retry(); // push starts, server commits ...
    A.goOffline(); // ... and the connection drops before the response (or the echo) comes back
    await sleep(2);
    A.pushGate.resolve(); // response lost
    A.pushGate = null;
    await sleep(2);
    assert.equal(A.syncer.status.mode, "offline");
    assert.equal(A.syncer.status.pending, 1);
    A.goOnline();
    await w.settle();
    assertSame(w, [A, B]);
  }));

  test("a record edited again while its push is in flight ends with the newest version everywhere", inWorld(async (w) => {
    const [A, B] = await twoDevices(w);
    A.edit(add("todos", todo("t1", "v1")));
    A.pushGate = deferred();
    A.syncer.retry();
    await sleep(2); // A's own write comes back from the listener while the push is still in flight
    A.edit(rename("todos", "t1", "v2"));
    A.pushGate.resolve();
    A.pushGate = null;
    await w.settle();
    assert.equal(titleOf(B.state, "todos", "t1"), "v2");
    assertSame(w, [A, B]);
  }));

  test("a push that fails half-way through its batches resumes and settles", inWorld(async (w) => {
    const [A, B] = await twoDevices(w);
    const prev = A.state;
    let next = prev;
    for (let i = 0; i < 230; i++) next = S.upsert(next, "todos", todo(`n${i}`, `n${i}`));
    A.state = next;
    A.syncer.localChange(prev, next);
    const push = A.cloud.push;
    let calls = 0;
    A.cloud.push = async (uid, batch) => {
      if (++calls === 2) A.goOffline();
      return push(uid, batch);
    };
    await A.syncer.idle();
    assert.equal(A.syncer.status.mode, "offline");
    assert.equal(A.syncer.status.pending, 130);
    A.goOnline();
    await w.settle();
    assert.equal(B.state.todos.length, 230);
    assertSame(w, [A, B]);
  }));
});

describe("devices: conflicts", () => {
  for (const first of ["A", "B"]) {
    for (const pushDelay of [0, 5]) {
      const order = pushDelay ? "listener before push response" : "push response before listener";
      test(`same todo edited on A and B offline: newest wins on both (${first} reconnects first, ${order})`, inWorld(async (w) => {
        const [A, B] = await twoDevices(w, { A: { pushDelay }, B: { pushDelay } });
        A.edit(add("todos", todo("x", "v0")));
        await w.settle();
        A.goOffline();
        B.goOffline();
        A.edit(rename("todos", "x", "from A"));
        A.edit(add("todos", todo("a", "only A")));
        B.edit(rename("todos", "x", "from B")); // later: wins
        B.edit(add("todos", todo("b", "only B")));
        const [p, q] = first === "A" ? [A, B] : [B, A];
        p.goOnline();
        await w.settle();
        q.goOnline();
        await w.settle();
        assert.equal(titleOf(A.state, "todos", "x"), "from B");
        assert.deepEqual(ids(A.state.todos), ["a", "b", "x"]);
        assertSame(w, [A, B]);
      }));

      test(`delete on A while B edits offline (${first} reconnects first, ${order})`, inWorld(async (w) => {
        const [A, B] = await twoDevices(w, { A: { pushDelay }, B: { pushDelay } });
        A.edit(add("todos", todo("old", "edited before the delete")));
        A.edit(add("todos", todo("new", "edited after the delete")));
        await w.settle();
        A.goOffline();
        B.goOffline();
        B.edit(rename("todos", "old", "B edit 1"));
        A.edit(del("todos", "old"));
        A.edit(del("todos", "new"));
        B.edit(rename("todos", "new", "B edit 2")); // newer than the delete: comes back
        const [p, q] = first === "A" ? [A, B] : [B, A];
        p.goOnline();
        await w.settle();
        q.goOnline();
        await w.settle();
        assert.deepEqual(ids(A.state.todos), ["new"]);
        assert.equal(titleOf(A.state, "todos", "new"), "B edit 2");
        assertSame(w, [A, B]);
      }));
    }
  }

  test("habit ticks toggled on both devices on the same day merge per habit", inWorld(async (w) => {
    const [A, B] = await twoDevices(w);
    for (const h of ["h1", "h2", "h3", "h4"]) A.edit(add("habits", habit(h, h)));
    A.edit(tick("h4"));
    await w.settle();
    assert.deepEqual(B.state.habitDone[DAY], ["h4"]);
    A.goOffline();
    B.goOffline();
    A.edit(tick("h1"));
    A.edit(tick("h3"));
    B.edit(tick("h2"));
    B.edit(tick("h3"));
    B.edit(tick("h4")); // B unticks h4 ...
    A.edit(tick("h3")); // A unticks h3 last: wins over B's tick
    B.edit(tick("h4")); // ... and ticks it again (newest)
    B.edit(tick("h1", DAY2));
    A.goOnline();
    B.goOnline();
    await w.settle();
    assert.deepEqual([...A.state.habitDone[DAY]].sort(), ["h1", "h2", "h4"]);
    assert.deepEqual(A.state.habitDone[DAY2], ["h1"]);
    assertSame(w, [A, B]);
  }));

  test("a habit deleted on A while B ticks it offline: habit is gone on both", inWorld(async (w) => {
    const [A, B] = await twoDevices(w);
    A.edit(add("habits", habit("h", "run")));
    A.edit(tick("h"));
    await w.settle();
    B.goOffline();
    B.edit(tick("h", DAY2));
    A.edit(del("habits", "h"));
    await w.settle();
    B.goOnline();
    await w.settle();
    assert.deepEqual(A.state.habits, []);
    assert.deepEqual(S.habitsOn(B.state, DAY2), []);
    assertSame(w, [A, B]);
  }));
});

describe("devices: accounts", () => {
  test("first sign-in on a device with local data merges it with the cloud's", inWorld(async (w) => {
    const A = w.device("A");
    A.signIn();
    A.edit(add("todos", todo("a1", "from A")));
    A.edit(add("habits", habit("ha", "A habit")));
    A.edit(tick("ha"));
    A.edit(setClass("2E5"));
    await w.settle();

    const B = w.device("B", { skew: 5 });
    B.edit(add("todos", todo("b1", "from B")));
    B.edit(add("events", event("be", "B event")));
    B.edit(add("habits", habit("hb", "B habit")));
    B.edit(tick("hb"));
    B.signIn();
    await w.settle();
    assert.deepEqual(ids(A.state.todos), ["a1", "b1"]);
    assert.deepEqual(ids(B.state.habits), ["ha", "hb"]);
    assert.deepEqual([...B.state.habitDone[DAY]].sort(), ["ha", "hb"]);
    assert.equal(B.state.settings.classSource, "2E5", "B never chose a class, so the cloud's choice wins");
    assertSame(w, [A, B]);
  }));

  test("first sign-in: a class chosen on the device after the cloud's choice wins", inWorld(async (w) => {
    const A = w.device("A");
    A.signIn();
    A.edit(setClass("2E5"));
    await w.settle();
    const B = w.device("B");
    B.edit(setClass("2E9")); // later
    B.signIn();
    await w.settle();
    assert.equal(A.state.settings.classSource, "2E9");
    assertSame(w, [A, B]);
  }));

  test("sign out clears the device and stops sync; signing in again brings everything back", inWorld(async (w) => {
    const [A, B] = await twoDevices(w);
    A.edit(add("todos", todo("x", "x")));
    A.edit(setClass("2E5"));
    await w.settle();
    B.signOut();
    assert.equal(B.syncer.status.mode, "signed-out");
    assert.deepEqual(B.syncer.meta, Y.emptyMeta());
    assert.deepEqual(Y.loadMeta(B.storage), Y.emptyMeta());
    assert.equal(w.listenersOf(B), 0);
    A.edit(add("todos", todo("y", "y")));
    A.edit(del("todos", "x"));
    await w.settle();
    assert.deepEqual(B.state.todos, [], "signed out: hears nothing");
    B.edit(add("todos", todo("z", "made while signed out")));
    B.signIn();
    await w.settle();
    assert.deepEqual(ids(A.state.todos), ["y", "z"]);
    assert.equal(B.state.settings.classSource, "2E5");
    assertSame(w, [A, B]);
  }));

  test("another account's data stays apart", inWorld(async (w) => {
    const A = w.device("A");
    const B = w.device("B");
    A.signIn("u1");
    B.signIn("u2");
    A.edit(add("todos", todo("t1", "u1 only")));
    await w.settle();
    assert.deepEqual(B.state.todos, []);
    assert.equal(w.col("u2").has("todos~t1"), false);
  }));
});

describe("devices: volume and clocks", () => {
  test("many changes (>100) go up in several batches and arrive complete", inWorld(async (w) => {
    const [A, B] = await twoDevices(w);
    // one big change, like importing a backup
    const prev = A.state;
    let next = prev;
    for (let i = 0; i < 250; i++) next = S.upsert(next, "todos", todo(`n${i}`, `item ${i}`));
    A.state = next;
    A.syncer.localChange(prev, next);
    // plus many separate edits
    for (let i = 0; i < 120; i++) A.edit(rename("todos", `n${i}`, `edited ${i}`));
    await w.settle();
    assert.ok(A.pushCalls >= 3, `pushCalls=${A.pushCalls}`);
    assert.ok(A.maxBatch <= 100, `maxBatch=${A.maxBatch}`);
    assert.equal(B.state.todos.length, 250);
    assert.equal(titleOf(B.state, "todos", "n119"), "edited 119");
    assertSame(w, [A, B]);

    // B was offline while A deleted most of them
    B.goOffline();
    A.edit((s) => ({ ...s, todos: s.todos.slice(0, 10) }));
    await w.settle();
    B.goOnline();
    await w.settle();
    assert.equal(B.state.todos.length, 10);
    assertSame(w, [A, B]);
  }));

  test("clock skew: an edit made after seeing a fast clock's version still wins", inWorld(async (w) => {
    const C = w.device("C", { skew: +HOUR });
    const A = w.device("A");
    const B = w.device("B", { skew: -HOUR });
    for (const d of [C, A, B]) d.signIn();
    await w.settle();
    C.edit(add("todos", todo("x", "by C (clock +1h)")));
    await w.settle();
    A.edit(rename("todos", "x", "by A after C"));
    await w.settle();
    assert.equal(titleOf(C.state, "todos", "x"), "by A after C");
    B.edit(del("todos", "x")); // clock -1h, but made after seeing A's edit
    await w.settle();
    assert.deepEqual(C.state.todos, []);
    B.edit(add("todos", todo("y", "by B (clock -1h)")));
    await w.settle();
    C.edit(rename("todos", "y", "by C after B"));
    await w.settle();
    assert.equal(titleOf(B.state, "todos", "y"), "by C after B");
    assertSame(w, [A, B, C]);
  }));

  test("clock skew: concurrent offline edits resolve the same way on every device (by device clock)", inWorld(async (w) => {
    const C = w.device("C", { skew: +HOUR });
    const A = w.device("A");
    for (const d of [C, A]) d.signIn();
    C.edit(add("todos", todo("z", "v0")));
    await w.settle();
    w.advance(HOUR + MIN); // both have caught up with C's clock
    C.goOffline();
    A.goOffline();
    C.edit(rename("todos", "z", "C at real t"));
    w.advance(5 * MIN);
    A.edit(rename("todos", "z", "A five minutes later")); // later in real time, earlier by the clocks
    A.goOnline();
    await w.settle();
    C.goOnline();
    await w.settle();
    assert.equal(titleOf(A.state, "todos", "z"), "C at real t");
    assertSame(w, [A, C]);
  }));

  test("clock skew tie, listener first: two devices stamping the same updatedAt agree", inWorld(async (w) => {
    const C = w.device("C", { skew: +HOUR });
    const A = w.device("A", { pushDelay: 5 });
    const B = w.device("B", { pushDelay: 5, skew: 1 });
    for (const d of [C, A, B]) d.signIn();
    C.edit(add("todos", todo("x", "v0")));
    await w.settle();
    A.goOffline();
    B.goOffline();
    A.edit(rename("todos", "x", "A"));
    B.edit(rename("todos", "x", "B"));
    assert.equal(A.syncer.meta.pending["todos~x"].updatedAt, B.syncer.meta.pending["todos~x"].updatedAt, "same stamp: version + 1");
    A.goOnline();
    await w.settle();
    B.goOnline();
    await w.settle();
    assertSame(w, [A, B, C]);
  }));
});

// ===============================================================================================================
// Bugs found (marked todo so the suite stays green)
// ===============================================================================================================

describe("devices: regressions found in review", () => {
  test("clock skew tie, push response first: both devices end with the same todo", inWorld(async (w) => {
    const C = w.device("C", { skew: +HOUR }); // e.g. a phone whose clock is an hour fast
    const A = w.device("A");
    const B = w.device("B", { skew: 1 });
    for (const d of [C, A, B]) d.signIn();
    C.edit(add("todos", todo("x", "v0")));
    await w.settle();
    A.goOffline();
    B.goOffline();
    A.edit(rename("todos", "x", "A")); // both stamp C's version + 1
    B.edit(rename("todos", "x", "B"));
    A.goOnline();
    await w.settle();
    B.goOnline(); // B's push is rejected (tie); its response arrives before the listener catches up
    await w.settle();
    assert.equal(titleOf(w.stateOf(), "todos", "x"), "A");
    assert.equal(titleOf(B.state, "todos", "x"), "A", "B keeps its own losing edit");
    assertSame(w, [A, B, C]);
  }));

  test("switching account: a class kept from the old account does not hide the new account's class", inWorld(async (w) => {
    const A = w.device("A");
    A.signIn("u2"); // u2's first device never chose a class: server has setting~classSource = 2E3 @ 1
    await w.settle();
    assert.equal(w.col("u2").get("setting~classSource").updatedAt, 1);
    const B = w.device("B");
    B.signIn("u1");
    B.edit(setClass("2E7"));
    await w.settle();
    B.signOut(); // keeps classSource 2E7, forgets its version
    B.signIn("u2");
    await w.settle();
    assert.equal(B.state.settings.classSource, "2E3");
    assertSame(w, [A, B], "u2");
  }));

  test("a slow push response carrying an old `newer` record does not undo a newer one the listener already applied", inWorld(async (w) => {
    const [A, B] = await twoDevices(w);
    A.edit(add("todos", todo("x", "v1")));
    await w.settle();
    B.goOffline();
    B.edit(rename("todos", "x", "B offline"));
    A.edit(rename("todos", "x", "A-1")); // newer than B's edit
    await w.settle();
    B.pushGate = deferred();
    B.goOnline(); // B's push of x is rejected by A-1 at the server; the response is slow
    await sleep(3); // meanwhile B's listener delivers A-1 ...
    assert.equal(titleOf(B.state, "todos", "x"), "A-1");
    A.edit(rename("todos", "x", "A-2")); // ... and then A-2
    await A.syncer.idle();
    await sleep(3);
    assert.equal(titleOf(B.state, "todos", "x"), "A-2");
    B.pushGate.resolve(); // the push response finally arrives with newer = [A-1]
    B.pushGate = null;
    await w.settle();
    assert.equal(titleOf(B.state, "todos", "x"), "A-2", "B went back to A-1");
    assertSame(w, [A, B]);
  }));

  test("records the listener had not delivered yet are not skipped after a restart", inWorld(async (w) => {
    const [A, B] = await twoDevices(w);
    A.edit(add("todos", todo("x", "v1")));
    await w.settle();
    B.goOffline();
    B.edit(rename("todos", "x", "B offline"));
    A.edit(add("todos", todo("y", "made while B was away")));
    await w.settle();
    w.advance(30 * MIN);
    A.edit(rename("todos", "x", "A later")); // beats B's offline edit
    await w.settle();
    B.holdListen = true; // B comes back; its listener is slow to catch up ...
    B.goOnline();
    await B.syncer.idle(); // ... but the push finishes: rejected, newer = [x @ A later]
    assert.equal(titleOf(B.state, "todos", "x"), "A later");
    B.restart(); // app closed before the listener delivered anything
    B.holdListen = false;
    await w.settle();
    assert.deepEqual(ids(B.state.todos), ["x", "y"], "B never gets todo y");
    assertSame(w, [A, B]);
  }));

  test("signing into another account while a push is in flight still uploads the new account's records", inWorld(async (w) => {
    const B = w.device("B");
    B.signIn("u1");
    await w.settle();
    B.edit(add("todos", todo("t1", "x")));
    B.pushGate = deferred();
    B.syncer.retry(); // push for u1 in flight (slow network)
    await sleep(1);
    B.signOut();
    B.signIn("u2"); // flush() for u2 only sets `again`
    B.pushGate.resolve();
    B.pushGate = null;
    await sleep(20);
    assert.equal(Y.pendingCount(B.syncer.meta), 0, `still pending: ${Object.keys(B.syncer.meta.pending)}`);
    assert.equal(w.col("u2").has("setting~classSource"), true);
    assert.equal(B.syncer.status.mode, "synced");
  }));

  test("signing out while a push is in flight that then fails leaves the status signed-out", inWorld(async (w) => {
    const B = w.device("B");
    B.signIn("u1");
    await w.settle();
    B.edit(add("todos", todo("t1", "x")));
    B.pushGate = deferred();
    B.syncer.retry();
    await sleep(1);
    B.signOut();
    assert.equal(B.syncer.status.mode, "signed-out");
    B.goOffline();
    B.pushGate.resolve();
    B.pushGate = null;
    await sleep(5);
    assert.equal(B.syncer.status.user, null);
    assert.equal(B.syncer.status.mode, "signed-out");
  }));

  test("a setting removed on one device is removed on the other", inWorld(async (w) => {
    const [A, B] = await twoDevices(w);
    A.edit(() => S.normalize({ todos: [], settings: { classSource: "2E3", theme: "dark" } })); // import a backup
    await w.settle();
    assert.equal(B.state.settings.theme, "dark");
    A.edit(() => S.normalize({ todos: [], settings: { classSource: "2E3" } })); // import another one
    await w.settle();
    assert.equal(B.state.settings.theme, undefined);
    assertSame(w, [A, B]);
  }));
});
