// Tests for the browser-side logic in assets/timetable-core.js.
// Built from the saved SWS fixture (not data/*.json) so live timetable changes can't break CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  malaysiaNow, addDays, dayIndexOf, weekOf, eventsOn, eventsInWeek, teachingWeeks, classDateRange,
  nextClass, currentStatus, defaultWeek, defaultDay, fmtTime, fmtDurationZh, fmtCountdownZh,
  relativeDayZh, shortRoom, validateTimetable, pickNewer, gapsBetween, timeBounds, startTimetable,
  codeVersion, updateAction,
} from "../../assets/timetable-core.js";
import { buildClassTimetable } from "./timetable.mjs";
import { CLASSES } from "../timetables.config.mjs";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/sws-2026-sem2.json", import.meta.url), "utf8"));
const load = (name) => ({
  ...buildClassTimetable({ className: name, ...CLASSES[name], rows: fixture.rows, weekOptions: fixture.weekOptions, semester: fixture.semester.label }).data,
  updatedAt: "2026-10-04T08:00:00.000Z",
});
const t3e4 = load("3E4");
const t2e3 = load("2E3");
// Malaysia wall-clock time -> the `now` object the core expects
const at = (iso, hhmm) => malaysiaNow(new Date(`${iso}T${hhmm}:00+08:00`));

test("Malaysia time ignores the device timezone", () => {
  const now = malaysiaNow(new Date("2026-10-04T16:30:00Z")); // 00:30 next day in Malaysia
  assert.equal(now.iso, "2026-10-05");
  assert.equal(now.day, 0);
  assert.equal(Math.floor(now.minutes), 30);
  assert.equal(dayIndexOf("2026-10-11"), 6);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("data files are valid", () => {
  assert.ok(validateTimetable(t3e4));
  assert.ok(validateTimetable(t2e3));
  assert.ok(!validateTimetable({ schema: 2, events: [], weeks: [] }));
  assert.ok(!validateTimetable(null));
});

test("weeks and teaching range", () => {
  assert.equal(weekOf(t3e4, "2026-10-05").week, 41);
  assert.equal(weekOf(t3e4, "2026-10-11").week, 41);
  assert.equal(weekOf(t3e4, "2026-10-12").week, 42);
  assert.equal(weekOf(t3e4, "2027-01-04"), null);
  assert.deepEqual(teachingWeeks(t3e4), [41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52]);
  assert.deepEqual(classDateRange(t3e4), { first: "2026-10-05", last: "2026-12-25" });
});

test("classes on a date", () => {
  assert.deepEqual(eventsOn(t3e4, "2026-10-05").map((e) => fmtTime(e.start)), ["08:00", "13:00", "15:30"]);
  assert.deepEqual(eventsOn(t3e4, "2026-10-09").map((e) => e.unit), ["CMFP0061"]);
  assert.equal(eventsOn(t3e4, "2026-10-10").length, 0); // Saturday
  assert.equal(eventsOn(t3e4, "2026-09-28").length, 0); // week 40: no classes yet
  const week = eventsInWeek(t2e3, 41);
  assert.deepEqual(week.map((d) => d.length), [4, 3, 1, 3, 2, 0, 0]);
});

test("status: before semester (today, Sunday 4 Oct)", () => {
  const s = currentStatus(t3e4, at("2026-10-04", "16:00"));
  assert.equal(s.kind, "before");
  assert.equal(s.next.iso, "2026-10-05");
  assert.equal(fmtTime(s.next.event.start), "08:00");
});

test("status: live, next, done, free, ended", () => {
  let s = currentStatus(t3e4, at("2026-10-05", "08:30"));
  assert.equal(s.kind, "live");
  assert.equal(s.event.unit, "CMFP0043");
  assert.equal(Math.round(s.remaining), 90);
  assert.equal(Math.round(s.progress * 100), 25);
  assert.equal(s.after.unit, "CMFP0061");

  s = currentStatus(t3e4, at("2026-10-05", "10:00")); // class ends exactly at 10:00
  assert.equal(s.kind, "next");
  assert.equal(s.event.unit, "CMFP0061");
  assert.equal(Math.round(s.minutesUntil), 180);

  s = currentStatus(t3e4, at("2026-10-05", "17:00"));
  assert.equal(s.kind, "done");
  assert.equal(s.next.iso, "2026-10-06");

  s = currentStatus(t3e4, at("2026-10-10", "09:00")); // Saturday
  assert.equal(s.kind, "free");
  assert.equal(s.next.iso, "2026-10-12");

  s = currentStatus(t3e4, at("2026-12-25", "12:00")); // after the last class (Fri 08:00-11:00)
  assert.equal(s.kind, "ended");
});

test("next class across a weekend", () => {
  const n = nextClass(t2e3, at("2026-10-09", "19:30"));
  assert.equal(n.iso, "2026-10-12");
  assert.equal(n.event.unit, "CMFP0042");
});

test("default week/day", () => {
  assert.equal(defaultWeek(t3e4, at("2026-10-04", "12:00")), 41); // before semester -> first teaching week
  assert.equal(defaultWeek(t3e4, at("2026-10-14", "12:00")), 42);
  assert.equal(defaultWeek(t3e4, at("2027-02-01", "12:00")), 52);
  assert.equal(defaultDay(t3e4, 41, at("2026-10-04", "12:00")), 0);
  assert.equal(defaultDay(t3e4, 42, at("2026-10-14", "12:00")), 2);
});

test("formatting", () => {
  assert.equal(fmtTime(570), "09:30");
  assert.equal(fmtDurationZh(90), "1.5 小时");
  assert.equal(fmtDurationZh(120), "2 小时");
  assert.equal(fmtDurationZh(45), "45 分钟");
  assert.equal(fmtCountdownZh(0.3), "不到 1 分钟");
  assert.equal(fmtCountdownZh(25), "25 分钟");
  assert.equal(fmtCountdownZh(95), "1 小时 35 分");
  assert.equal(fmtCountdownZh(120), "2 小时");
  assert.equal(relativeDayZh("2026-10-05", "2026-10-04"), "明天");
  assert.equal(relativeDayZh("2026-10-08", "2026-10-04"), "周四");
  assert.equal(relativeDayZh("2026-10-20", "2026-10-04"), "10月20日 周二");
  assert.equal(shortRoom("SK2 101 (ME 101) Physic Lab"), "SK2 101");
  assert.equal(shortRoom("LTCL 9 (HL2-109)"), "LTCL 9");
  assert.equal(shortRoom("PA3 106 (Computer Lab)"), "PA3 106");
  assert.equal(shortRoom("Harry Perkins LT"), "Harry Perkins LT");
  assert.equal(shortRoom("Auditorium"), "Auditorium");
  assert.equal(shortRoom("LTBS LT II (HL2-111)"), "LTBS LT II");
});

test("gaps and grid bounds", () => {
  const mon = eventsOn(t3e4, "2026-10-05");
  assert.deepEqual(gapsBetween(mon).map((g) => g.minutes), [180, 30]);
  assert.deepEqual(timeBounds(t2e3), { start: 480, end: 1200 });
});

test("pickNewer prefers the most recently updated copy", () => {
  const older = { ...t3e4, updatedAt: "2026-10-01T00:00:00.000Z" };
  const newer = { ...t3e4, updatedAt: "2026-10-04T00:00:00.000Z" };
  assert.equal(pickNewer(older, newer), newer);
  assert.equal(pickNewer(newer, older), newer);
  assert.equal(pickNewer(null, older), older);
  assert.equal(pickNewer({ bad: true }, null), null);
});

test("startTimetable: embedded first, then network; falls back when offline", async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const embedded = { ...t3e4, updatedAt: "2026-10-01T00:00:00.000Z" };
  const fresh = { ...t3e4, updatedAt: "2026-10-04T08:00:00.000Z" };

  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => (url.includes("status") ? { checkedAt: "2026-10-04T09:00:00.000Z" } : fresh),
  });
  const calls = [];
  await startTimetable({ embedded, urls: ["https://x/3E4.json"], statusUrls: ["https://x/status.json"], cacheKey: "k", onData: (d, i) => calls.push([d.updatedAt, i.source, i.checkedAt]) }).ready;
  assert.deepEqual(calls, [
    ["2026-10-01T00:00:00.000Z", "embedded", null],
    ["2026-10-04T08:00:00.000Z", "network", "2026-10-04T09:00:00.000Z"],
  ]);

  // Offline on the next visit: the cached newer copy wins over the embedded one.
  globalThis.fetch = async () => { throw new Error("offline"); };
  const offline = [];
  await startTimetable({ embedded, urls: ["https://x/3E4.json"], cacheKey: "k", onData: (d, i) => offline.push([d?.updatedAt, i.source, Boolean(i.error)]) }).ready;
  assert.deepEqual(offline, [
    ["2026-10-04T08:00:00.000Z", "cache", false],
    ["2026-10-04T08:00:00.000Z", "cache", true],
  ]);

  // Nothing at all: reports null so the page can show an error.
  store.clear();
  const nothing = [];
  await startTimetable({ embedded: null, urls: ["https://x/3E4.json"], cacheKey: "k", onData: (d, i) => nothing.push([d, i.source]) }).ready;
  assert.deepEqual(nothing, [[null, "none"]]);
});

test("codeVersion reads the version stamp-assets writes into the page", () => {
  assert.equal(codeVersion('<head>\n<meta charset="UTF-8">\n<meta name="code-version" content="4b47ecee86d6">\n'), "4b47ecee86d6");
  assert.equal(codeVersion("<h1>Wi-Fi login</h1>"), "", "an error page or captive portal is never a new version");
  assert.equal(codeVersion(null), "");
  const page = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  assert.match(codeVersion(page), /^[0-9a-f]{12}$/, "index.html carries one (run scripts/stamp-assets.mjs)");
});

test("updateAction: reload when the page comes back untouched and nothing is open, otherwise offer it", () => {
  const now = 1_000_000_000;
  const base = { current: "v1", live: "v2", shown: true, busy: false, tried: null, now, canRemember: true };
  assert.equal(updateAction(base), "reload");
  assert.equal(updateAction({ ...base, live: "v1" }), "none");
  assert.equal(updateAction({ ...base, live: "" }), "none", "could not read the live page");
  assert.equal(updateAction({ ...base, current: "" }), "none");
  assert.equal(updateAction({ ...base, busy: true }), "bar", "the map or a game is open");
  assert.equal(updateAction({ ...base, shown: false }), "bar", "the user is looking at it: don't yank the page away");
  assert.equal(updateAction({ ...base, tried: { version: "v2", at: now - 60_000 } }), "bar", "just reloaded for v2 and still old: stop");
  assert.equal(updateAction({ ...base, tried: { version: "v2", at: now - 16 * 60_000 } }), "reload", "a CDN that lagged has caught up by now");
  assert.equal(updateAction({ ...base, tried: { version: "v1", at: now - 60_000 } }), "bar", "any automatic reload in the last 15 min: CDN copies may disagree");
  assert.equal(updateAction({ ...base, canRemember: false }), "bar", "no sessionStorage: never reload on our own");
});
