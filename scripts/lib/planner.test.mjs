import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../../planner/store.js";

const today = "2026-10-10"; // Saturday

test("to-dos: overdue and undated show on today only", () => {
  let s = S.emptyState();
  s = S.upsert(s, "todos", { id: "a", title: "late", due: "2026-10-08" });
  s = S.upsert(s, "todos", { id: "b", title: "today", due: today });
  s = S.upsert(s, "todos", { id: "c", title: "any" });
  const t = S.todosOn(s, today, today);
  assert.deepEqual([t.overdue, t.due, t.anytime].map((g) => g.map((x) => x.id)), [["a"], ["b"], ["c"]]);
  const other = S.todosOn(s, "2026-10-11", today);
  assert.equal(other.overdue.length + other.due.length + other.anytime.length, 0);
});

test("to-dos: an undated one ticked today stays visible today, then goes", () => {
  let s = S.upsert(S.emptyState(), "todos", { id: "c", title: "any" });
  s = S.toggleTodo(s, "c", today);
  assert.equal(S.todosOn(s, today, today).anytime.length, 1);
  assert.equal(S.todosOn(s, "2026-10-11", "2026-10-11").anytime.length, 0);
});

test("habits: weekdays, ticks per date, streak", () => {
  let s = S.upsert(S.emptyState(), "habits", { id: "h", title: "run", days: [0, 2, 4, 5] }); // Mon Wed Fri Sat
  assert.equal(S.habitsOn(s, today).length, 1);
  assert.equal(S.habitsOn(s, "2026-10-11").length, 0); // Sunday
  for (const d of ["2026-10-05", "2026-10-07", "2026-10-09"]) s = S.toggleHabit(s, "h", d);
  assert.equal(S.streak(s, s.habits[0], today), 3); // today not ticked yet: count up to yesterday
  s = S.toggleHabit(s, "h", today);
  assert.equal(S.streak(s, s.habits[0], today), 4);
  assert.deepEqual(S.progress(s, today, today), { done: 1, total: 1 });
});

test("removing a habit clears its ticks; load survives junk", () => {
  let s = S.upsert(S.emptyState(), "habits", { id: "h", title: "x", days: [5] });
  s = S.remove(S.toggleHabit(s, "h", today), "habits", "h");
  assert.deepEqual(s.habitDone[today], []);
  const store = { getItem: () => "{not json" };
  assert.deepEqual(S.load(store), S.emptyState());
});

test("events merge with classes in time order", () => {
  const s = S.upsert(S.emptyState(), "events", { id: "e", title: "lunch", date: today, start: 720, end: 780 });
  const list = S.eventsOn(s, today, [{ id: "k", kind: "class", title: "Maths", start: 480, end: 600 }]);
  assert.deepEqual(list.map((e) => e.id), ["k", "e"]);
  assert.equal(S.parseTime("8:05"), 485);
});

test("normalize cleans hand-made backups: ids, tick dates, settings", () => {
  const s = S.normalize({
    todos: [{ id: "a/b", title: "slash" }, { id: 7, title: "number" }, { id: "x", title: "dup" }, { id: "x", title: "dup2" }, { title: "" }],
    habitDone: { "2026-10-10": ["h1", "h1", "bad/id", null], "not-a-date": ["h1"], "2026-10-11": "h1" },
    settings: { classSource: "3E4", "a/b": "x", nested: { no: 1 } },
  });
  assert.equal(s.todos.length, 4);
  assert.ok(s.todos.every((t) => S.safeId(t.id)));
  assert.equal(new Set(s.todos.map((t) => t.id)).size, 4);
  assert.equal(s.todos[1].id, "7");
  assert.deepEqual(s.habitDone, { "2026-10-10": ["h1"] });
  assert.deepEqual(s.settings, { classSource: "3E4" });
});

test("merge adds a backup without removing anything", () => {
  let mine = S.upsert(S.emptyState(), "todos", { id: "a", title: "mine" });
  mine = S.toggleHabit(mine, "h", today);
  const file = S.normalize({ todos: [{ id: "b", title: "from file" }, { id: "a", title: "mine, edited" }], habitDone: { [today]: ["k"] } });
  const out = S.merge(mine, file);
  assert.deepEqual(out.todos.map((t) => [t.id, t.title]), [["a", "mine, edited"], ["b", "from file"]]);
  assert.deepEqual(out.habitDone[today].sort(), ["h", "k"]);
});
