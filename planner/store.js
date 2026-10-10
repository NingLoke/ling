// Planner data and rules. No DOM code in here, so it can be tested with node.
// Three kinds of things:
//   events  行程 - something at a time on one date (plus the classes from the timetable, read-only)
//   habits  每日任务 - a checklist that comes back on chosen weekdays; ticks are kept per date
//   todos   待办 - a one-off thing to do, with or without a due date
// Dates are ISO "YYYY-MM-DD" strings, times are minutes after midnight.

import { addDays, daysBetween, dayIndexOf } from "../assets/timetable-core.js";

export const STORAGE_KEY = "planner:v1";

export const emptyState = () => ({
  schema: 1,
  events: [],
  habits: [],
  habitDone: {}, // { "2026-10-10": ["habitId", ...] }
  todos: [],
  settings: { classSource: "2E3" },
});

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Read saved state; anything missing or broken falls back to defaults. */
export function load(storage) {
  let raw = null;
  try {
    raw = storage?.getItem(STORAGE_KEY);
  } catch {}
  return normalize(raw ? safeParse(raw) : null);
}

export function save(storage, state) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

const safeParse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export function normalize(data) {
  const base = emptyState();
  if (!data || typeof data !== "object") return base;
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object" && x.id && x.title) : []);
  return {
    schema: 1,
    events: list(data.events),
    habits: list(data.habits).map((h) => ({ ...h, days: Array.isArray(h.days) && h.days.length ? h.days : [0, 1, 2, 3, 4, 5, 6] })),
    habitDone: data.habitDone && typeof data.habitDone === "object" ? data.habitDone : {},
    todos: list(data.todos),
    settings: { ...base.settings, ...(data.settings || {}) },
  };
}

// ---------- reading a day ----------

const byTime = (a, b) => a.start - b.start || a.end - b.end || a.title.localeCompare(b.title);

/** Own events plus timetable classes on a date, merged and sorted. */
export function eventsOn(state, iso, classes = []) {
  const own = state.events.filter((e) => e.date === iso).map((e) => ({ ...e, kind: "event" }));
  return [...own, ...classes].sort(byTime);
}

export const habitDueOn = (habit, iso) => habit.days.includes(dayIndexOf(iso)) && (!habit.from || daysBetween(habit.from, iso) >= 0);

export function habitsOn(state, iso) {
  const done = new Set(state.habitDone[iso] || []);
  return state.habits.filter((h) => habitDueOn(h, iso)).map((h) => ({ ...h, done: done.has(h.id) }));
}

/** Consecutive due days (ending today, or yesterday if today isn't ticked yet) that were ticked. */
export function streak(state, habit, todayIso) {
  let count = 0;
  let iso = todayIso;
  const ticked = (d) => (state.habitDone[d] || []).includes(habit.id);
  if (habitDueOn(habit, iso) && !ticked(iso)) iso = addDays(iso, -1);
  for (let guard = 0; guard < 1000; guard++, iso = addDays(iso, -1)) {
    if (habit.from && daysBetween(habit.from, iso) < 0) break;
    if (!habitDueOn(habit, iso)) continue;
    if (!ticked(iso)) break;
    count++;
  }
  return count;
}

/**
 * To-dos to show for a date, in groups:
 *   overdue - not done, due before today (only when looking at today)
 *   due     - due on this date (done or not)
 *   anytime - no due date and not done, or done on this date (only when looking at today)
 */
export function todosOn(state, iso, todayIso) {
  const isToday = iso === todayIso;
  const overdue = [];
  const due = [];
  const anytime = [];
  for (const t of state.todos) {
    if (t.due === iso) due.push(t);
    else if (!isToday) continue;
    else if (t.due && !t.done && daysBetween(t.due, todayIso) > 0) overdue.push(t);
    else if (!t.due && (!t.done || t.doneOn === todayIso)) anytime.push(t);
  }
  const order = (a, b) => Number(a.done) - Number(b.done) || Number(!!b.star) - Number(!!a.star) || (a.created || 0) - (b.created || 0);
  return { overdue: overdue.sort((a, b) => a.due.localeCompare(b.due)), due: due.sort(order), anytime: anytime.sort(order) };
}

/** Done / total for the day's checklist items (habits + to-dos shown for it). */
export function progress(state, iso, todayIso) {
  const habits = habitsOn(state, iso);
  const { overdue, due, anytime } = todosOn(state, iso, todayIso);
  const todos = [...overdue, ...due, ...anytime];
  const total = habits.length + todos.length;
  const done = habits.filter((h) => h.done).length + todos.filter((t) => t.done).length;
  return { done, total };
}

/** Whether a date has anything on it (for the dots in the week strip). */
export function hasItems(state, iso, classes = []) {
  return classes.length > 0 || state.events.some((e) => e.date === iso) || state.todos.some((t) => t.due === iso && !t.done);
}

// ---------- changes (each returns a new state) ----------

export function upsert(state, kind, item) {
  const list = state[kind];
  const exists = list.some((x) => x.id === item.id);
  return { ...state, [kind]: exists ? list.map((x) => (x.id === item.id ? { ...x, ...item } : x)) : [...list, item] };
}

export function remove(state, kind, id) {
  const next = { ...state, [kind]: state[kind].filter((x) => x.id !== id) };
  if (kind === "habits") {
    next.habitDone = Object.fromEntries(Object.entries(state.habitDone).map(([d, ids]) => [d, ids.filter((x) => x !== id)]));
  }
  return next;
}

export function toggleHabit(state, id, iso) {
  const ids = state.habitDone[iso] || [];
  const nextIds = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  return { ...state, habitDone: { ...state.habitDone, [iso]: nextIds } };
}

export function toggleTodo(state, id, todayIso) {
  return {
    ...state,
    todos: state.todos.map((t) => (t.id === id ? { ...t, done: !t.done, doneOn: t.done ? null : todayIso } : t)),
  };
}

/** "08:30" -> 510 */
export const parseTime = (text) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
