// The planner part of the timetable page: daily tasks (每日任务), to-dos (待办), my own events (行程) and
// cloud sync. index.html draws the timetable and calls into this; the rules live in planner-store.js and
// the sync in planner-sync.js / planner-syncer.js / planner-cloud.js.
import * as S from "./planner-store.js?v=82271e1095";
import * as cloud from "./planner-cloud.js?v=8c9ec97fb1";
import { SYNC_KEY } from "./planner-sync.js?v=8c0b4fd8da";
import { createSyncer } from "./planner-syncer.js?v=05657dfffe";
import { firebaseConfig } from "./firebase-config.js?v=c615ce6fe6";
import { daysBetween, dayIndexOf, fmtTime, formatDateZh, DAY_SHORT_ZH, DAY_NAMES_ZH } from "./timetable-core.js?v=484ad6369e";

const $ = (id) => document.getElementById(id);

/** Tiny DOM builder (same as the page's): strings become text nodes, so data never reaches innerHTML. */
function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) if (child != null && child !== false) node.append(child);
  return node;
}
function svg(markup) { // static, trusted icon markup only
  const template = document.createElement("template");
  template.innerHTML = markup;
  return template.content.firstElementChild;
}
const tickIcon = () => svg('<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>');

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * createPlanner({ getNow, openModal, toast, onChange })
 *   getNow()              Malaysia "now" ({ iso, minutes, ... }), the page's clock (honours ?now=)
 *   openModal(dialog, f)  the page's dialog opener (back button closes it)
 *   toast(text)           the page's toast
 *   onChange()            something in the planner changed: redraw the timetable (my events live there)
 */
export function createPlanner({ getNow, openModal, toast = () => {}, onChange = () => {} }) {
  const storage = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  let state = S.load(storage);
  let shownDate = getNow().iso; // the date the list section shows

  // ---------- state changes ----------

  // a change made here: save it, queue it for sync
  const commit = (next) => {
    const prev = state;
    state = next;
    S.save(storage, state);
    syncer.localChange(prev, next);
    changed();
  };
  // a change that came from another device (or another tab)
  const replace = (next) => {
    state = next;
    S.save(storage, state);
    changed();
  };
  const changed = () => {
    renderList();
    onChange();
  };

  // ---------- reading ----------

  const eventsOn = (iso) =>
    state.events.filter((e) => e.date === iso).sort((a, b) => a.start - b.start || a.end - b.end || a.title.localeCompare(b.title));

  // ---------- the list section (每日任务 + 待办) ----------

  function checkRow({ id, title, done, sub, late, star }, kind) {
    return h("li", { class: `check${done ? " done" : ""}` },
      h("button", {
        class: "box", type: "button", "aria-pressed": String(!!done), "aria-label": `${done ? "取消完成" : "完成"}：${title}`,
        onclick: () => commit(kind === "habits" ? S.toggleHabit(state, id, shownDate) : S.toggleTodo(state, id, getNow().iso)),
      }, tickIcon()),
      h("button", { class: "txt", type: "button", "aria-label": `编辑：${title}`, onclick: () => openEditor(kind, id) },
        h("b", null, title), star ? h("span", { class: "star", "aria-label": "重要" }, "★") : null,
        sub ? h("small", { class: late ? "late" : "" }, sub) : null));
  }

  function relativeLate(due, today) {
    const diff = daysBetween(due, today);
    return diff === 1 ? "昨天到期" : `${diff} 天前到期`;
  }

  function renderList() {
    const section = $("plan");
    if (!section) return;
    const today = getNow().iso;
    const iso = shownDate;
    const diff = daysBetween(today, iso);
    $("plan-date").textContent = diff === 0 ? "今天" : diff === 1 ? "明天" : diff === -1 ? "昨天" : `${formatDateZh(iso)} ${DAY_NAMES_ZH[dayIndexOf(iso)]}`;
    const { done, total } = S.progress(state, iso, today);
    $("plan-progress").textContent = total ? `${done}/${total}` : "";

    const habits = S.habitsOn(state, iso);
    $("plan-habits").replaceChildren(
      habits.length
        ? h("ul", { class: "checks" }, habits.map((x) => {
            const n = S.streak(state, x, today);
            return checkRow({ ...x, sub: diff === 0 && n > 1 ? `连续 ${n} 天` : "" }, "habits");
          }))
        : h("p", { class: "plan-empty" }, "还没有每日任务。", h("button", { class: "inline-add", type: "button", onclick: () => openEditor("habits") }, "＋ 加一个"), "（比如背单词、运动）"));

    const { overdue, due, anytime } = S.todosOn(state, iso, today);
    const isToday = diff === 0;
    const groups = [
      ["已过期", overdue.map((t) => ({ ...t, sub: relativeLate(t.due, today), late: true }))],
      [isToday && (overdue.length || anytime.length) ? "今天到期" : "", due],
      [isToday && (overdue.length || due.length) ? "随时" : "", anytime],
    ].filter(([, items]) => items.length);
    $("plan-todos").replaceChildren(
      ...(groups.length
        ? groups.map(([label, items]) => [label ? h("p", { class: "group-label" }, label) : null, h("ul", { class: "checks" }, items.map((t) => checkRow(t, "todos")))]).flat()
        : [h("p", { class: "plan-empty" }, isToday ? "没有待办，清爽。" : "这天没有到期的待办。", h("button", { class: "inline-add", type: "button", onclick: () => openEditor("todos") }, "＋ 加待办"))]));
  }

  /** Show the list for this date (the day picked in the timetable, or today). */
  function showDate(iso) {
    shownDate = iso;
    renderList();
  }

  // ---------- editor ----------

  const editor = $("plan-editor");
  const form = $("plan-form");
  let editing = null; // { kind, id|null }

  $("plan-days").replaceChildren(...DAY_SHORT_ZH.map((d, i) => h("button", { type: "button", dataset: { day: String(i) }, "aria-pressed": "true" }, d)));

  function setKind(kind) {
    editing.kind = kind;
    for (const b of $("plan-kind").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.kind === kind));
    for (const el of form.querySelectorAll("[data-for]")) el.hidden = !el.dataset.for.split(" ").includes(kind);
    if (kind === "events" && !form.date.value) form.date.value = shownDate;
  }

  const roundUp = (minutes) => Math.min(23 * 60, Math.ceil((minutes + 1) / 30) * 30);

  /** defaults: { date, start, end } for a new event */
  function openEditor(kind = "todos", id = null, defaults = {}) {
    const item = id ? state[kind].find((x) => x.id === id) : null;
    if (id && !item) return;
    editing = { kind, id: item ? id : null };
    form.reset();
    $("plan-editor-title").textContent = item ? "编辑" : "新建";
    $("plan-kind").hidden = !!item;
    $("plan-delete").hidden = !item;
    $("plan-form-error").textContent = "";
    form.title.value = item?.title || "";
    form.date.value = item ? item.date || item.due || "" : kind === "todos" ? "" : defaults.date || shownDate;
    form.place.value = item?.place || "";
    form.star.checked = !!item?.star;
    const now = getNow();
    const start = item?.start ?? defaults.start ?? (form.date.value === now.iso ? roundUp(now.minutes) : 9 * 60);
    const end = item?.end ?? defaults.end ?? Math.min(start + 60, 24 * 60 - 1);
    form.start.value = fmtTime(start);
    form.end.value = fmtTime(end);
    const days = item?.days || ALL_DAYS;
    for (const b of $("plan-days").children) b.setAttribute("aria-pressed", String(days.includes(Number(b.dataset.day))));
    setKind(kind);
    openModal(editor, "planEditor");
    if (!item) form.title.focus();
  }

  $("plan-kind").addEventListener("click", (e) => {
    const b = e.target.closest("[data-kind]");
    if (b) setKind(b.dataset.kind);
  });
  $("plan-days").addEventListener("click", (e) => {
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
      const start = S.parseTime(form.start.value);
      const end = S.parseTime(form.end.value);
      if (start == null || end == null) {
        $("plan-form-error").textContent = "请填好开始和结束时间";
        return;
      }
      if (end <= start) {
        $("plan-form-error").textContent = "结束时间要晚于开始时间";
        return;
      }
      item = { ...base, date: form.date.value || shownDate, start, end, place: form.place.value.trim() };
    } else if (kind === "todos") {
      item = { ...base, due: form.date.value || null, star: form.star.checked };
    } else {
      const days = [...$("plan-days").children].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => Number(b.dataset.day));
      item = { ...base, days: days.length ? days : ALL_DAYS, ...(id ? {} : { from: getNow().iso }) };
    }
    editor.close();
    commit(S.upsert(state, kind, item));
    if (!id) toast(kind === "events" ? "行程已加进课表" : kind === "habits" ? "每日任务已加上" : "待办已加上");
  });

  $("plan-delete").addEventListener("click", () => {
    if (!editing?.id) return;
    const { kind, id } = editing;
    editor.close();
    commit(S.remove(state, kind, id));
    toast("已删除");
  });
  for (const b of editor.querySelectorAll("[data-close]")) b.addEventListener("click", () => editor.close());

  // ---------- settings: sync + backup ----------

  const settings = $("plan-settings");
  for (const b of settings.querySelectorAll("[data-close]")) b.addEventListener("click", () => settings.close());
  function openSettings() {
    renderSync(syncer.status);
    openModal(settings, "planSettings");
  }

  $("plan-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: `计划备份-${getNow().iso}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("plan-import").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = S.normalize(JSON.parse(await file.text()));
      // signed in, a replace would delete everything missing from the file on every device; add instead
      if (syncer.status.user) {
        if (!confirm("把文件里的资料加进这个账号吗？（现有的项目不会被删除，所有登录这个账号的设备都会看到。）")) return;
        commit(S.merge(state, data));
      } else {
        if (!confirm("导入会替换这台设备上现有的每日任务、行程和待办，确定吗？")) return;
        commit(data);
      }
      settings.close();
      toast("备份已导入");
    } catch {
      alert("这个文件读不出来，确认是「导出备份」生成的 .json 吗？");
    } finally {
      e.target.value = "";
    }
  });

  // ---------- cloud sync ----------

  // ?emulator: talk to the local Firebase emulators instead (for testing; see SYNC-SETUP.md)
  const useEmulator = new URLSearchParams(location.search).has("emulator");
  const syncConfig = useEmulator ? { apiKey: "demo-key", authDomain: "demo-planner.firebaseapp.com", projectId: "demo-planner", appId: "demo" } : firebaseConfig;
  // Google sign-in only works in a real browser, not from a file or inside a packaged app's web view
  const inBrowser =
    /^https?:$/.test(location.protocol) && location.hostname !== "tauri.localhost" &&
    !window.Capacitor && !window.__TAURI__ && !window.__TAURI_INTERNALS__ && !window.cordova &&
    !/Electron|; wv\)/.test(navigator.userAgent);
  const syncer = createSyncer({ cloud, storage, getState: () => state, setState: replace, onStatus: renderSync });
  let connecting = null; // the connect attempt in progress; everyone who needs Firebase waits for the same one
  let connectFailed = false;

  /** Load Firebase and start following the signed-in account. Never rejects; check cloud.isConnected() after. */
  function startSync() {
    if (!syncConfig || cloud.isConnected()) return Promise.resolve();
    if (!connecting) {
      connecting = cloud
        .connect(syncConfig, { emulator: useEmulator })
        .then(() => {
          connectFailed = false;
          cloud.onUser((user) => syncer.setUser(user));
        })
        .catch(() => {
          // Firebase couldn't load (offline?): everything still works on this device, try again when back online
          connectFailed = true;
        })
        .finally(() => {
          connecting = null;
          renderSync(syncer.status);
        });
      renderSync(syncer.status);
    }
    return connecting;
  }

  const timeAgo = (ms) => {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return "刚刚";
    if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
    return `${Math.floor(s / 3600)} 小时前`;
  };

  function renderSync(status) {
    const mode = !syncConfig ? "local" : !cloud.isConnected() && status.mode === "off" ? (connectFailed ? "offline" : "connecting") : status.mode;
    const waiting = status.pending ? ` · ${status.pending} 项待上传` : "";
    const label = {
      local: "只存在这台设备",
      connecting: "连接中",
      off: "连接中",
      "signed-out": "未登录同步",
      syncing: "同步中",
      synced: "已同步",
      offline: `离线${waiting}`,
      error: "同步出错",
    }[mode] || "";
    const gear = $("plan-gear");
    gear.dataset.mode = mode;
    gear.setAttribute("aria-label", `设置 · 同步（${label}）`);
    gear.title = `同步：${label}`;
    const note = $("sync-note");
    if (note) note.textContent = syncConfig ? `同步：${label}` : "";

    $("sync-unconfigured").hidden = !!syncConfig;
    $("login-form").hidden = !syncConfig || !!status.user;
    $("sync-account").hidden = !status.user;
    $("google").hidden = !inBrowser;
    if (status.user) {
      $("account-email").textContent = status.user.email || status.user.name || "已登录";
      $("sync-detail").textContent = {
        syncing: `正在同步…${waiting}`,
        synced: `已同步${status.lastSync ? ` · ${timeAgo(status.lastSync)}` : ""}。手机和电脑登录同一个账号就会自动同步。`,
        offline: `现在离线${waiting}。改动先存在这台设备上，连上网会自动上传。`,
        error: `同步出错：${status.error}${waiting}`,
      }[status.mode] || "";
    }
  }

  const loginForm = $("login-form");
  const loginError = $("login-error");
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const mode = e.submitter?.dataset.auth || "signin";
    const email = loginForm.email.value.trim();
    const password = loginForm.password.value;
    loginError.textContent = "";
    for (const b of loginForm.querySelectorAll("button")) b.disabled = true;
    try {
      await startSync();
      if (!cloud.isConnected()) throw { code: "auth/network-request-failed" };
      await (mode === "signup" ? cloud.signUp(email, password) : cloud.signIn(email, password));
      loginForm.password.value = "";
    } catch (error) {
      loginError.textContent = cloud.explainError(error);
    } finally {
      for (const b of loginForm.querySelectorAll("button")) b.disabled = false;
    }
  });
  $("forgot").addEventListener("click", async () => {
    const email = loginForm.email.value.trim();
    if (!email) {
      loginError.textContent = "先在上面填好邮箱，再点「忘记密码」";
      return;
    }
    try {
      await startSync();
      if (!cloud.isConnected()) throw { code: "auth/network-request-failed" };
      await cloud.resetPassword(email);
      loginError.textContent = `重设密码的邮件已寄到 ${email}`;
    } catch (error) {
      loginError.textContent = cloud.explainError(error);
    }
  });
  $("google").addEventListener("click", async () => {
    loginError.textContent = "";
    try {
      await startSync();
      if (!cloud.isConnected()) throw { code: "auth/network-request-failed" };
      await cloud.signInGoogle();
    } catch (error) {
      loginError.textContent = cloud.explainError(error);
    }
  });
  $("sync-now").addEventListener("click", () => syncer.retry());
  $("sign-out").addEventListener("click", async () => {
    const n = syncer.status.pending;
    const message = n
      ? `还有 ${n} 项改动没上传到云端，退出后会丢失。确定退出吗？`
      : "退出后，这台设备上的每日任务、行程和待办会清空（云端的还在，再登录就会回来）。确定退出吗？";
    if (!confirm(message)) return;
    syncer.reset();
    await cloud.signOut().catch(() => {});
    replace(S.emptyState());
  });

  // another tab changed the data or the sync bookkeeping
  window.addEventListener("storage", (e) => {
    if (e.key === S.STORAGE_KEY) replace(S.load(storage));
    else if (e.key === SYNC_KEY) syncer.reloadMeta();
  });
  window.addEventListener("online", () => {
    startSync();
    syncer.retry();
  });
  window.addEventListener("offline", () => syncer.retry());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncer.retry();
  });

  for (const id of ["plan-add", "plan-fab"]) $(id)?.addEventListener("click", () => openEditor("todos"));
  $("plan-gear").addEventListener("click", openSettings);

  renderSync(syncer.status);
  startSync();

  return {
    eventsOn,
    showDate,
    openEditor,
    openSettings,
    get busy() {
      return editor.open || settings.open;
    },
  };
}
