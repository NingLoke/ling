// Planner page: draws the day and handles taps. Rules live in ./store.js.
import { addDays, daysBetween, dayIndexOf, malaysiaNow, fmtTime, DAY_SHORT_ZH, DAY_NAMES_ZH, TYPE_LABELS_ZH, eventsOn as classesOnDate, shortRoom } from "../assets/timetable-core.js";
import * as S from "./store.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

let state = S.load(storage);
let now = malaysiaNow();
let selected = now.iso;
let timetable = null;

const commit = (next) => {
  state = next;
  S.save(storage, state);
  render();
};

// ---------- timetable classes ----------

async function loadTimetable() {
  const cls = state.settings.classSource;
  timetable = null;
  if (!cls) return render();
  const cacheKey = `planner:tt:${cls}`;
  try {
    const cached = storage?.getItem(cacheKey);
    if (cached) timetable = JSON.parse(cached);
  } catch {}
  render();
  try {
    const res = await fetch(`../data/${cls}.json`, { cache: "no-cache" });
    if (!res.ok) return;
    timetable = await res.json();
    try {
      storage?.setItem(cacheKey, JSON.stringify(timetable));
    } catch {}
    render();
  } catch {}
}

function classesOn(iso) {
  if (!timetable?.events) return [];
  return classesOnDate(timetable, iso).map((e) => ({
    id: e.id,
    kind: "class",
    title: timetable.units?.[e.unit]?.short || e.unit,
    tag: TYPE_LABELS_ZH[e.type] || e.type,
    start: e.start,
    end: e.end,
    place: e.rooms.map(shortRoom).join(" / "),
  }));
}

// ---------- drawing ----------

const CHECK = `<svg viewBox="0 0 16 16" fill="none" stroke="#f8f4ec" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>`;

function render() {
  now = malaysiaNow();
  const today = now.iso;
  const isToday = selected === today;
  const diff = daysBetween(today, selected);
  const [, m, d] = selected.split("-").map(Number);

  $("#eyebrow").textContent = isToday ? "今天" : diff === 1 ? "明天" : diff === -1 ? "昨天" : diff > 0 ? `${diff} 天后` : `${-diff} 天前`;
  $("#title").innerHTML = `<span class="num">${m}月${d}日</span><small>${DAY_NAMES_ZH[dayIndexOf(selected)]}</small>`;

  // progress ring
  const { done, total } = S.progress(state, selected, today);
  const C = 2 * Math.PI * 27;
  const bar = $("#ring-bar");
  bar.style.strokeDasharray = C;
  bar.style.strokeDashoffset = total ? C * (1 - done / total) : C;
  $("#ring-text").textContent = total ? `${done}/${total}` : "—";

  renderWeek(today);
  renderLine(today, isToday);
  renderHabits(today);
  renderTodos(today);
}

function renderWeek(today) {
  const monday = addDays(selected, -dayIndexOf(selected));
  $("#days").innerHTML = Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(monday, i);
    const cls = ["day", iso === today && "today", iso === selected && "sel", S.hasItems(state, iso, classesOn(iso)) && "has"].filter(Boolean).join(" ");
    return `<button class="${cls}" data-date="${iso}" aria-label="${iso}"><span class="dn">${DAY_SHORT_ZH[i]}</span><span class="dd num">${Number(iso.slice(8))}</span><span class="dot"></span></button>`;
  }).join("");
}

function renderLine(today, isToday) {
  const list = S.eventsOn(state, selected, classesOn(selected));
  const own = list.filter((e) => e.kind === "event").length;
  const cls = list.length - own;
  $("#line-meta").textContent = list.length ? [own && `${own} 项行程`, cls && `${cls} 节课`].filter(Boolean).join(" · ") : "";
  if (!list.length) {
    $("#line").innerHTML = `<li class="empty">这天没有行程</li>`;
    return;
  }
  const past = daysBetween(today, selected) < 0;
  let html = "";
  let nowDrawn = !isToday;
  for (const e of list) {
    if (!nowDrawn && e.start > now.minutes) {
      html += `<li class="now" aria-hidden="true"><span class="num">${fmtTime(now.minutes)}</span></li>`;
      nowDrawn = true;
    }
    const state_ = past || (isToday && e.end <= now.minutes) ? "past" : isToday && e.start <= now.minutes ? "live" : "";
    html += `<li class="ev ${e.kind === "class" ? "class" : ""} ${state_}" ${e.kind === "event" ? `data-edit="events" data-id="${e.id}"` : ""}>
      <div class="t num">${fmtTime(e.start)}<small>${fmtTime(e.end)}</small></div>
      <div class="body"><div class="title">${esc(e.title)}${e.tag ? `<span class="tag">${esc(e.tag)}</span>` : ""}</div>${e.place ? `<div class="sub">${esc(e.place)}</div>` : ""}</div>
    </li>`;
  }
  $("#line").innerHTML = html;
}

function checkRow({ id, title, done, sub, late, star }, kind) {
  return `<li class="check ${done ? "done" : ""}">
    <button class="box" data-toggle="${kind}" data-id="${id}" aria-label="${done ? "取消完成" : "完成"}：${esc(title)}" aria-pressed="${done}">${CHECK}</button>
    <div class="txt" data-edit="${kind}" data-id="${id}"><b>${esc(title)}</b>${star ? ` <span class="star">★</span>` : ""}${sub ? `<small class="${late ? "late" : ""}">${esc(sub)}</small>` : ""}</div>
  </li>`;
}

function renderHabits(today) {
  const list = S.habitsOn(state, selected);
  $("#habit-meta").textContent = list.length ? `${list.filter((h) => h.done).length}/${list.length}` : "";
  $("#habits").innerHTML = list.length
    ? list.map((h) => {
        const n = S.streak(state, h, today);
        return checkRow({ ...h, sub: daysBetween(today, selected) === 0 && n > 1 ? `连续 ${n} 天` : "" }, "habits");
      }).join("")
    : `<li class="empty">还没有每日任务，点 ＋ 加一个（比如：背单词、运动）</li>`;
}

function renderTodos(today) {
  const { overdue, due, anytime } = S.todosOn(state, selected, today);
  const groups = [
    ["已过期", overdue.map((t) => ({ ...t, sub: `${relative(t.due, today)}到期`, late: true }))],
    [overdue.length || anytime.length ? "今天到期" : "", due],
    [overdue.length || due.length ? "随时" : "", anytime],
  ].filter(([, items]) => items.length);
  const left = [...overdue, ...due, ...anytime].filter((t) => !t.done).length;
  $("#todo-meta").textContent = left ? `剩 ${left} 项` : "";
  if (selected !== today) groups.forEach((g) => (g[0] = ""));
  $("#todos").innerHTML = groups.length
    ? groups.map(([label, items]) => `${label ? `<div class="group-label">${label}</div>` : ""}<ul class="checks">${items.map((t) => checkRow(t, "todos")).join("")}</ul>`).join("")
    : `<p class="empty">${selected === today ? "没有待办，清爽 ✓" : "这天没有到期的待办"}</p>`;
}

function relative(iso, today) {
  const diff = daysBetween(iso, today);
  return diff === 1 ? "昨天" : `${diff} 天前`;
}

// ---------- editor ----------

const editor = $("#editor");
const form = $("#editor-form");
let editing = null; // { kind, id|null }

$("#day-chips").innerHTML = DAY_SHORT_ZH.map((d, i) => `<button type="button" data-day="${i}" aria-pressed="true">${d}</button>`).join("");

function setKind(kind) {
  editing.kind = kind;
  for (const b of $("#kind-seg").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.kind === kind));
  for (const el of form.querySelectorAll("[data-for]")) el.hidden = !el.dataset.for.split(" ").includes(kind);
}

function openEditor(kind, id = null) {
  editing = { kind, id };
  const item = id ? state[kind].find((x) => x.id === id) : null;
  form.reset();
  $("#editor-title").textContent = item ? "编辑" : "新建";
  $("#kind-seg").hidden = !!item;
  $("#editor-delete").hidden = !item;
  form.title.value = item?.title || "";
  form.date.value = item ? item.date || item.due || "" : kind === "todos" ? "" : selected;
  form.place.value = item?.place || "";
  form.star.value = item?.star ? "1" : "";
  if (item?.start != null) form.start.value = fmtTime(item.start);
  if (item?.end != null) form.end.value = fmtTime(item.end);
  const days = item?.days || [0, 1, 2, 3, 4, 5, 6];
  for (const b of $("#day-chips").children) b.setAttribute("aria-pressed", String(days.includes(Number(b.dataset.day))));
  setKind(kind);
  editor.showModal();
  if (!item) form.title.focus();
}

$("#kind-seg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-kind]");
  if (!b) return;
  setKind(b.dataset.kind);
  if (b.dataset.kind === "events" && !form.date.value) form.date.value = selected;
});
$("#day-chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-day]");
  if (b) b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const { kind, id } = editing;
  const title = form.title.value.trim();
  if (!title) return;
  const base = { id: id || S.newId(), title, ...(id ? {} : { created: Date.now() }) };
  let item;
  if (kind === "events") {
    const start = S.parseTime(form.start.value) ?? 540;
    const end = Math.max(start + 5, S.parseTime(form.end.value) ?? start + 60);
    item = { ...base, date: form.date.value || selected, start, end, place: form.place.value.trim() };
  } else if (kind === "todos") {
    item = { ...base, due: form.date.value || null, star: form.star.value === "1" };
  } else {
    const days = [...$("#day-chips").children].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => Number(b.dataset.day));
    item = { ...base, days: days.length ? days : [0, 1, 2, 3, 4, 5, 6], ...(id ? {} : { from: now.iso }) };
  }
  editor.close();
  commit(S.upsert(state, kind, item));
});

$("#editor-delete").addEventListener("click", () => {
  if (!editing?.id) return;
  editor.close();
  commit(S.remove(state, editing.kind, editing.id));
});
form.querySelector("[data-close]").addEventListener("click", () => editor.close());

// ---------- settings / backup ----------

const settings = $("#settings");
$("#class-source").addEventListener("change", (e) => {
  state = { ...state, settings: { ...state.settings, classSource: e.target.value } };
  S.save(storage, state);
  loadTimetable();
});
$("#export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `计划备份-${now.iso}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$("#import").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!confirm("导入会替换这台设备上现有的全部资料，确定吗？")) return;
    commit(S.normalize(data));
    loadTimetable();
    settings.close();
  } catch {
    alert("这个文件读不出来，确认是「导出备份」生成的 .json 吗？");
  } finally {
    e.target.value = "";
  }
});

// ---------- taps ----------

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-date],[data-week],[data-go-today],[data-add],[data-toggle],[data-edit],[data-open-settings]");
  if (!t) return;
  if (t.dataset.date) selected = t.dataset.date;
  else if (t.dataset.week) selected = addDays(selected, Number(t.dataset.week));
  else if (t.hasAttribute("data-go-today")) selected = malaysiaNow().iso;
  else if (t.hasAttribute("data-add")) return openEditor("todos");
  else if (t.dataset.toggle === "habits") return commit(S.toggleHabit(state, t.dataset.id, selected));
  else if (t.dataset.toggle === "todos") return commit(S.toggleTodo(state, t.dataset.id, now.iso));
  else if (t.dataset.edit) return openEditor(t.dataset.edit, t.dataset.id);
  else if (t.hasAttribute("data-open-settings")) {
    $("#class-source").value = state.settings.classSource || "";
    return settings.showModal();
  }
  render();
});

// another tab or window changed the data
window.addEventListener("storage", (e) => {
  if (e.key === S.STORAGE_KEY) {
    state = S.load(storage);
    render();
  }
});

// keep the "now" line and the date fresh
let lastDay = now.iso;
setInterval(() => {
  const n = malaysiaNow();
  if (n.iso !== lastDay && selected === lastDay) selected = n.iso;
  lastDay = n.iso;
  render();
}, 30_000);
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && render());

loadTimetable();
