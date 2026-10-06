// Timetable logic shared by the 2E3 and 3E4 pages. No DOM code in here.
// All "now" maths happens in Malaysia time (UTC+8, no daylight saving),
// whatever timezone the phone is set to.

export const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const DAY_NAMES_ZH = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
export const DAY_SHORT_ZH = ["一", "二", "三", "四", "五", "六", "日"];
export const DAY_NAMES_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const TYPE_LABELS_ZH = {
  Lecture: "讲课",
  Tutorial: "辅导",
  Lab: "实验",
  Seminar: "研讨",
  Workshop: "工作坊",
  Clinic: "答疑",
  Practical: "实践",
};

const pad = (n) => String(n).padStart(2, "0");

// ---------- dates (ISO "YYYY-MM-DD", treated as Malaysia calendar dates) ----------

const isoToUtcMs = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const utcMsToIso = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (iso, n) => utcMsToIso(isoToUtcMs(iso) + n * DAY_MS);
export const daysBetween = (fromIso, toIso) => Math.round((isoToUtcMs(toIso) - isoToUtcMs(fromIso)) / DAY_MS);
export const dayIndexOf = (iso) => (new Date(isoToUtcMs(iso)).getUTCDay() + 6) % 7; // 0 = Monday

/** Current Malaysia date/time. minutes is fractional (includes seconds). */
export function malaysiaNow(date = new Date()) {
  const shifted = new Date(date.getTime() + MYT_OFFSET_MS);
  const iso = shifted.toISOString().slice(0, 10);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes() + shifted.getUTCSeconds() / 60;
  return { iso, day: dayIndexOf(iso), minutes, epoch: date.getTime() };
}

export function formatDateZh(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}月${d}日`;
}

/** "今天" / "明天" / "后天" / "周四" (same or next week) / "10月20日 周二" */
export function relativeDayZh(iso, todayIso) {
  const diff = daysBetween(todayIso, iso);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === 2) return "后天";
  if (diff > 2 && diff < 7) return DAY_NAMES_ZH[dayIndexOf(iso)];
  return `${formatDateZh(iso)} ${DAY_NAMES_ZH[dayIndexOf(iso)]}`;
}

// ---------- formatting ----------

export const fmtTime = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(Math.floor(minutes % 60))}`;

/** 90 -> "1.5 小时", 45 -> "45 分钟", 120 -> "2 小时" */
export function fmtDurationZh(minutes) {
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1).replace(/\.0$/, "")} 小时`;
}

/** Countdown text: 0.4 -> "不到 1 分钟", 25 -> "25 分钟", 95 -> "1 小时 35 分" */
export function fmtCountdownZh(minutes) {
  const whole = Math.ceil(minutes);
  if (minutes < 1) return "不到 1 分钟";
  if (whole < 60) return `${whole} 分钟`;
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

// ---------- timetable queries ----------

export function validateTimetable(data) {
  if (!data || typeof data !== "object") return false;
  if (data.schema !== 1 || !Array.isArray(data.events) || !Array.isArray(data.weeks)) return false;
  if (!data.weeks.every((w) => Number.isInteger(w.week) && /^\d{4}-\d{2}-\d{2}$/.test(w.start))) return false;
  return data.events.every((e) =>
    e && typeof e.unit === "string" && Number.isInteger(e.day) && e.day >= 0 && e.day <= 6 &&
    Number.isFinite(e.start) && Number.isFinite(e.end) && e.end > e.start && Array.isArray(e.weeks) && Array.isArray(e.rooms)
  );
}

/** The SWS teaching week containing this date, or null. */
export function weekOf(data, iso) {
  for (const w of data.weeks) {
    const diff = daysBetween(w.start, iso);
    if (diff >= 0 && diff < 7) return w;
  }
  return null;
}

export const weekStart = (data, weekNo) => data.weeks.find((w) => w.week === weekNo)?.start ?? null;

/** Week numbers that have at least one class, ascending. */
export function teachingWeeks(data) {
  const known = new Set(data.weeks.map((w) => w.week));
  const used = new Set();
  for (const e of data.events) for (const w of e.weeks) if (known.has(w)) used.add(w);
  return [...used].sort((a, b) => a - b);
}

const byTime = (a, b) => a.start - b.start || a.end - b.end || a.unit.localeCompare(b.unit);

/** Classes that actually happen on this calendar date. */
export function eventsOn(data, iso) {
  const week = weekOf(data, iso);
  if (!week) return [];
  const day = dayIndexOf(iso);
  return data.events.filter((e) => e.day === day && e.weeks.includes(week.week)).sort(byTime);
}

/** Seven arrays (Mon..Sun) of the classes in a given week. */
export function eventsInWeek(data, weekNo) {
  const days = Array.from({ length: 7 }, () => []);
  for (const e of data.events) if (e.weeks.includes(weekNo)) days[e.day].push(e);
  for (const list of days) list.sort(byTime);
  return days;
}

/** Date of a weekday (0=Mon) inside an SWS week. */
export const dateInWeek = (data, weekNo, day) => {
  const start = weekStart(data, weekNo);
  return start ? addDays(start, day) : null;
};

/** Gaps between back-to-back classes on one day: [{after, before, minutes}] */
export function gapsBetween(events) {
  const gaps = [];
  for (let i = 0; i < events.length - 1; i++) {
    const minutes = events[i + 1].start - events[i].end;
    if (minutes > 0) gaps.push({ after: events[i], before: events[i + 1], minutes });
  }
  return gaps;
}

/** First and last calendar dates that have a class. */
export function classDateRange(data) {
  const weeks = teachingWeeks(data);
  if (weeks.length === 0) return null;
  const firstDays = eventsInWeek(data, weeks[0]);
  const lastDays = eventsInWeek(data, weeks.at(-1));
  const firstDay = firstDays.findIndex((d) => d.length);
  const lastDay = 6 - [...lastDays].reverse().findIndex((d) => d.length);
  return { first: dateInWeek(data, weeks[0], firstDay), last: dateInWeek(data, weeks.at(-1), lastDay) };
}

/** Next class starting strictly after `now` (Malaysia time). */
export function nextClass(data, now = malaysiaNow()) {
  const range = classDateRange(data);
  if (!range) return null;
  let iso = daysBetween(now.iso, range.first) > 0 ? range.first : now.iso;
  for (let guard = 0; guard < 400 && daysBetween(iso, range.last) >= 0; guard++, iso = addDays(iso, 1)) {
    const list = eventsOn(data, iso);
    const candidate = iso === now.iso ? list.find((e) => e.start > now.minutes) : list[0];
    if (candidate) return { iso, event: candidate };
  }
  return null;
}

/**
 * What is happening right now.
 *   live   - in class: { event, elapsed, remaining, progress, after: next class today|null }
 *   next   - another class later today: { event, minutesUntil, iso }
 *   done   - today had classes, all finished: { next: {iso,event}|null }
 *   free   - no class today: { next }
 *   before - semester hasn't started: { next }
 *   ended  - no more classes this semester
 */
export function currentStatus(data, now = malaysiaNow()) {
  const today = eventsOn(data, now.iso);
  const live = today.find((e) => now.minutes >= e.start && now.minutes < e.end);
  if (live) {
    const elapsed = now.minutes - live.start;
    const total = live.end - live.start;
    return {
      kind: "live",
      event: live,
      elapsed,
      remaining: live.end - now.minutes,
      progress: Math.min(1, Math.max(0, elapsed / total)),
      after: today.find((e) => e.start >= live.end) ?? null,
      today,
    };
  }
  const laterToday = today.find((e) => e.start > now.minutes);
  if (laterToday) {
    return { kind: "next", event: laterToday, minutesUntil: laterToday.start - now.minutes, iso: now.iso, today };
  }
  const next = nextClass(data, now);
  const range = classDateRange(data);
  if (range && daysBetween(now.iso, range.first) > 0) return { kind: "before", next, today };
  if (!next) return { kind: "ended", next: null, today };
  return { kind: today.length ? "done" : "free", next, today };
}

/** Which week to show by default: this week, else the nearest teaching week. */
export function defaultWeek(data, now = malaysiaNow()) {
  const weeks = teachingWeeks(data);
  if (weeks.length === 0) return data.weeks[0]?.week ?? null;
  const current = weekOf(data, now.iso);
  if (current && weeks.includes(current.week)) return current.week;
  const upcoming = weeks.find((w) => daysBetween(now.iso, weekStart(data, w)) >= 0);
  return upcoming ?? weeks.at(-1);
}

/** Which day to select by default: today, or the next weekday with classes in the shown week. */
export function defaultDay(data, weekNo, now = malaysiaNow()) {
  const days = eventsInWeek(data, weekNo);
  const current = weekOf(data, now.iso);
  if (current && current.week === weekNo) return now.day;
  const first = days.findIndex((d) => d.length);
  return first >= 0 ? first : 0;
}

/** Earliest start and latest end across the whole timetable (for week grids). */
export function timeBounds(data) {
  if (!data.events.length) return { start: 8 * 60, end: 18 * 60 };
  const start = Math.min(...data.events.map((e) => e.start));
  const end = Math.max(...data.events.map((e) => e.end));
  return { start: Math.floor(start / 60) * 60, end: Math.ceil(end / 60) * 60 };
}

/** Short room for tight spaces: "SK2 101 (ME 101) Physic Lab" -> "SK2 101", "LTCL 9 (HL2-109)" -> "LTCL 9" */
export function shortRoom(room) {
  const value = String(room ?? "").trim();
  const code = value.match(/^([A-Z]{2,4}\d?\s?\d{2,3})\b/);
  if (code) return code[1];
  return value.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

// ---------- loading with fallback ----------

/** Prefer whichever copy was updated most recently. */
export function pickNewer(a, b) {
  if (!validateTimetable(a)) return validateTimetable(b) ? b : null;
  if (!validateTimetable(b)) return a;
  return String(b.updatedAt ?? "") > String(a.updatedAt ?? "") ? b : a;
}

export function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? JSON.parse(raw) : null;
    return validateTimetable(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    /* private mode / storage full: the page still works */
  }
}

/** GET the first URL that answers with valid JSON. Resolves {data, url} or throws. */
export async function fetchFirst(urls, { timeoutMs = 8000, validate = () => true } = {}) {
  let lastError = new Error("no URLs");
  for (const url of urls) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const sep = url.includes("?") ? "&" : "?";
      const response = await fetch(`${url}${sep}t=${Math.floor(Date.now() / 60000)}`, {
        cache: "no-store",
        signal: controller?.signal,
      });
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      const data = await response.json();
      if (!validate(data)) throw new Error(`${url}: unexpected data`);
      return { data, url };
    } catch (error) {
      lastError = error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastError;
}

/**
 * Show something immediately, then refresh from the network.
 *   embedded:   timetable baked into the page
 *   urls:       timetable JSON URLs, tried in order
 *   statusUrls: status.json URLs (for "last checked" time)
 *   onData(data, info): called once right away and again whenever newer data arrives
 *       info = { source: "embedded"|"cache"|"network", checkedAt, error }
 * Returns a function that triggers another refresh; its .ready promise settles after the first one.
 */
export function startTimetable({ embedded, urls, statusUrls = [], cacheKey, onData, timeoutMs }) {
  let current = pickNewer(embedded, readCache(cacheKey));
  let checkedAt = null;
  const initialSource = current && current !== embedded ? "cache" : "embedded";
  if (current) onData(current, { source: initialSource, checkedAt, error: null });

  let inFlight = null;
  const refresh = () => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const [timetable, status] = await Promise.allSettled([
        fetchFirst(urls, { timeoutMs, validate: validateTimetable }),
        statusUrls.length ? fetchFirst(statusUrls, { timeoutMs, validate: (s) => s && typeof s.checkedAt === "string" }) : Promise.reject(new Error("no status")),
      ]);
      if (status.status === "fulfilled") checkedAt = status.value.data.checkedAt;
      if (timetable.status === "fulfilled") {
        const fresh = timetable.value.data;
        const chosen = pickNewer(current, fresh) ?? fresh;
        const changed = JSON.stringify(chosen) !== JSON.stringify(current);
        current = chosen;
        writeCache(cacheKey, current);
        onData(current, { source: "network", checkedAt, error: null, changed });
      } else {
        // current may be null here (nothing embedded, nothing cached, offline): the page shows an error state.
        onData(current, { source: current ? (current === embedded ? "embedded" : "cache") : "none", checkedAt, error: timetable.reason });
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
  refresh.ready = refresh();
  return refresh;
}

/**
 * The version of a page's code, as scripts/stamp-assets.mjs writes it into the page:
 * <meta name="code-version" content="<hash of the page without its timetable data>">. The hash covers the
 * page's own script and CSS and the ?v= stamps of every module it loads, so any code change changes it and a
 * new timetable snapshot does not. "" when there is none (an error page, a captive portal): never "new".
 */
export function codeVersion(html) {
  return /<meta name="code-version" content="([0-9a-f]+)">/.exec(String(html ?? ""))?.[1] ?? "";
}

/**
 * What to do about the live page's code version:
 *   "none"    same code (or the live page could not be read)
 *   "reload"  new code, the page has just come back to the screen, the user hasn't touched it since, and
 *             nothing is open: reload now. At most once per retryAfter ms (tried = { version, at } of the
 *             last automatic reload), so CDN copies that disagree for a few minutes after a deploy can't make
 *             it reload over and over; never when that can't be remembered.
 *   "bar"     new code otherwise: offer it ("网站更新了 · 点这里刷新").
 */
export function updateAction({ current, live, shown = false, busy = false, tried = null, now = 0, canRemember = true, retryAfter = 15 * 60_000 }) {
  if (!current || !live || live === current) return "none";
  // whatever version it was for: two CDN copies that disagree mustn't bounce the page between them
  const triedRecently = tried != null && now - (tried.at ?? 0) < retryAfter;
  return shown && !busy && canRemember && !triedRecently ? "reload" : "bar";
}

/**
 * Keeps a page that stays open for days (a home-screen app) on the latest code. The timetable data refreshes
 * itself, but the code only changes when the page loads again, so a fix never reached a page left open.
 * Whenever the page comes back to the screen (and every `every` ms while it is up) this asks the server for
 * the page (revalidating, so it sees what a reload would get) and compares codeVersion, then reloads or shows
 * a bar (updateAction). Before reloading it downloads the new modules, so a connection that drops then leaves
 * the working page alone. isBusy() says whether reloading would throw away something the user is doing; the
 * bar waits while an element matching `overlays` (full-screen map, game) is open, since it would cover their
 * controls. Returns a function that stops it.
 */
export function watchForUpdates({ isBusy = () => false, overlays = "", every = 10 * 60_000, minGap = 60_000, firstCheck = 4_000, timeoutMs = 8_000 } = {}) {
  const current = document.querySelector('meta[name="code-version"]')?.content || "";
  if (!current || typeof fetch !== "function") return () => {};
  const KEY = "tt:reloaded-for";
  const store = (() => {
    try {
      sessionStorage.setItem(`${KEY}:probe`, "1");
      const ok = sessionStorage.getItem(`${KEY}:probe`) === "1";
      sessionStorage.removeItem(`${KEY}:probe`);
      return ok ? sessionStorage : null;
    } catch {
      return null;
    }
  })();
  let lastCheck = 0;
  let checking = false;
  let lastInput = 0;
  let shownAt = Date.now(); // when the page last appeared (loaded, or came back to the screen)
  let bar = null;
  let pending = null; // the newer version the bar offers
  let dismissed = null; // ✕ on the bar: quiet for that version until the page is next hidden

  // fetch and read the body within timeoutMs (fetch alone settles at the headers; a stalled body would hang)
  const withTimeout = async (url, init, read) => {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      return await read(await fetch(url, { ...init, signal: controller?.signal }));
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  async function livePage() {
    const url = new URL(location.href);
    url.hash = "";
    try {
      return await withTimeout(url, { cache: "no-cache" }, (r) => (r.ok ? r.text() : ""));
    } catch {
      return "";
    }
  }
  // download the page's modules at their new URLs, so the reload finds them in the cache
  async function prefetchModules(html) {
    const refs = [...new Set(html.match(/\.\/(?:assets\/)?[\w-]+\.js\?v=[0-9a-f]+/g) || [])];
    try {
      const done = await Promise.all(refs.map((ref) => withTimeout(new URL(ref, location.href), {}, async (r) => r.ok && (await r.arrayBuffer(), true))));
      return done.every(Boolean);
    } catch {
      return false;
    }
  }
  // a reload that is sure to land: the new page and its modules are here (else the bar goes until next time)
  async function reloadIfReachable() {
    const html = await livePage();
    if (!codeVersion(html) || !(await prefetchModules(html))) return false;
    location.reload();
    return true;
  }

  const covered = () => Boolean(overlays && document.querySelector(overlays));
  function syncBar() {
    if (!bar) return;
    bar.hidden = !pending || pending === dismissed || covered();
    if (!bar.hidden) bar.inert = false; // an overlay that opened over it may have made it inert
  }
  function offer(live) {
    pending = live;
    if (!bar) {
      const style = document.createElement("style");
      style.textContent = `.tt-update{position:fixed;left:50%;top:calc(10px + env(safe-area-inset-top));transform:translateX(-50%);z-index:2147483600;display:flex;align-items:center;gap:2px;max-width:calc(100vw - 32px);padding:4px;border-radius:999px;background:rgba(24,24,27,.94);color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.28);font:inherit;font-size:14px}
.tt-update[hidden]{display:none}
.tt-update button{font:inherit;color:inherit;background:none;border:0;border-radius:999px;padding:8px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent}
.tt-update .tt-update-go{font-weight:600;white-space:nowrap}
.tt-update .tt-update-x{padding:8px 12px;opacity:.7}
.tt-update button:focus-visible{outline:2px solid #fff;outline-offset:-2px}`;
      const go = document.createElement("button");
      go.type = "button";
      go.className = "tt-update-go";
      go.textContent = "网站更新了 · 点这里刷新";
      go.addEventListener("click", async () => {
        if (go.disabled) return;
        go.disabled = true;
        go.textContent = "正在更新…";
        if (await reloadIfReachable()) return;
        go.textContent = "现在连不上网，等下再试";
        setTimeout(() => {
          go.disabled = false;
          go.textContent = "网站更新了 · 点这里刷新";
          pending = null; // the next check offers it again
          syncBar();
        }, 2500);
      });
      const close = document.createElement("button");
      close.type = "button";
      close.className = "tt-update-x";
      close.setAttribute("aria-label", "先不刷新");
      close.textContent = "✕";
      close.addEventListener("click", () => {
        dismissed = pending;
        syncBar();
      });
      bar = document.createElement("div");
      bar.className = "tt-update";
      bar.setAttribute("role", "status");
      bar.append(style, go, close);
      document.body.append(bar);
    }
    syncBar();
  }
  // the map and the game come and go as children of <body>: hide the bar under them, bring it back after
  const observer = overlays && typeof MutationObserver === "function" ? new MutationObserver(syncBar) : null;
  observer?.observe(document.body, { childList: true });

  async function check(shown) {
    if (checking || document.hidden || Date.now() - lastCheck < minGap) return;
    checking = true;
    lastCheck = Date.now();
    const untouched = () => lastInput < shownAt;
    try {
      const html = await livePage();
      const live = codeVersion(html);
      let tried = null;
      try {
        tried = JSON.parse(store?.getItem(KEY) || "null");
      } catch {
        tried = null;
      }
      const action = updateAction({
        current, live, shown: shown && untouched(), busy: Boolean(isBusy()), tried, now: Date.now(), canRemember: Boolean(store),
      });
      if (action === "none") {
        pending = null;
        syncBar();
        return;
      }
      if (action === "reload" && (await prefetchModules(html)) && untouched() && !isBusy()) {
        try {
          store.setItem(KEY, JSON.stringify({ version: live, at: Date.now() }));
          location.reload();
          return;
        } catch {
          // can't remember the attempt: don't risk reloading in a loop
        }
      }
      offer(live);
    } finally {
      checking = false;
    }
  }

  const onInput = () => {
    lastInput = Date.now();
  };
  const onVisible = () => {
    if (document.hidden) {
      dismissed = null;
      return;
    }
    shownAt = Date.now();
    check(true);
  };
  const onPageShow = (event) => {
    if (!event.persisted) return;
    shownAt = Date.now();
    check(true);
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pageshow", onPageShow);
  for (const type of ["pointerdown", "keydown", "wheel"]) window.addEventListener(type, onInput, { capture: true, passive: true });
  const first = setTimeout(() => check(true), firstCheck);
  const timer = setInterval(() => check(false), every);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    observer?.disconnect();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pageshow", onPageShow);
    for (const type of ["pointerdown", "keydown", "wheel"]) window.removeEventListener(type, onInput, { capture: true });
    bar?.remove();
  };
}
