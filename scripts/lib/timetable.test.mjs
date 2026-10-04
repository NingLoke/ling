import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseGroupField, groupMatches, parseWeeks, parseWeekOption, parseStartDate, parseTime,
  parseStaff, parseRooms, buildClassTimetable, findClashes, canonical,
} from "./timetable.mjs";
import { CLASSES } from "../timetables.config.mjs";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/sws-2026-sem2.json", import.meta.url), "utf8"));
const build = (name) => buildClassTimetable({
  className: name, ...CLASSES[name], rows: fixture.rows, weekOptions: fixture.weekOptions, semester: fixture.semester.label,
});
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const summary = (events) => events.map((e) => `${e.day} ${hhmm(e.start)}-${hhmm(e.end)} ${e.unit} ${e.type} @ ${e.rooms.join(" + ")}`);

test("group ranges, lists and wildcards", () => {
  const ids = (s) => [...parseGroupField(s).ids].sort();
  assert.deepEqual(ids("3E1-4"), ["3E1", "3E2", "3E3", "3E4"]);
  assert.deepEqual(ids("2E1-2E3"), ["2E1", "2E2", "2E3"]);
  assert.deepEqual(ids("K-Q;V-W"), ["K", "L", "M", "N", "O", "P", "Q", "V", "W"]);
  assert.deepEqual(ids("1C2/1A1"), ["1A1", "1C2"]);
  assert.deepEqual(ids("EB 1"), ["EB1"]);
  assert.deepEqual(ids("1E3 (Reserve)"), ["1E3"]);
  assert.equal(parseGroupField("All").any, true);
  assert.equal(parseGroupField("F (Venue: PA3 105)").venue, "PA3 105");
  assert.deepEqual(ids("F (Venue: PA3 105)"), ["F"]);

  assert.ok(groupMatches("2E1-7; 2F1-3; 3E4", ["3E4"]));
  assert.ok(groupMatches("2E1-7; 2F1-3; 3E4", ["2E3"]));
  assert.ok(!groupMatches("3E1-3; 2E1-7", ["3E4"]));
  assert.ok(groupMatches("3E1-3; 2E1-7", ["2E3"]));
  assert.ok(groupMatches("3E4; 3E1; 3E2", ["3E4"]));
  assert.ok(groupMatches("K-Q;V-W", ["K"]));
  assert.ok(!groupMatches("A-F", ["K"]));
  assert.ok(groupMatches("All", ["3E4"]));
  assert.ok(groupMatches("Group 1 & 2", ["*"]));
  assert.ok(!groupMatches("2E3", ["2E"]));
  assert.ok(!groupMatches("12E3", ["2E3"]));
  assert.ok(!groupMatches("2E31", ["2E3"]));
});

test("weeks, dates, times", () => {
  assert.deepEqual(parseWeeks("41-44"), [41, 42, 43, 44]);
  assert.deepEqual(parseWeeks("41-42, 45, 47-48"), [41, 42, 45, 47, 48]);
  assert.throws(() => parseWeeks("soon"));
  assert.deepEqual(parseWeekOption("week  39 w/c 21 Sep 2026"), { week: 39, start: "2026-09-21" });
  assert.deepEqual(parseWeekOption(" 52 | week  52 w/c 21 Dec 2026"), { week: 52, start: "2026-12-21" });
  assert.equal(parseWeekOption("Semester Two"), null);
  assert.deepEqual(parseStartDate("5/10/26"), { iso: "2026-10-05", day: 0 });
  assert.deepEqual(parseStartDate("9/10/26"), { iso: "2026-10-09", day: 4 });
  assert.deepEqual(parseStartDate("11/10/26"), { iso: "2026-10-11", day: 6 });
  assert.throws(() => parseStartDate("31/02/26"));
  assert.equal(parseTime("8:00"), 480);
  assert.equal(parseTime("17:30"), 1050);
});

test("staff and rooms cleanup", () => {
  assert.deepEqual(parseStaff("Space_New It Staff"), []);
  assert.deepEqual(parseStaff("New Space Staff - Audrey Serani"), ["Audrey Serani"]);
  assert.deepEqual(parseStaff("Grace Abigail;Harith Firajudeen Bin Jeferie"), ["Grace Abigail", "Harith Firajudeen Bin Jeferie"]);
  assert.deepEqual(parseRooms("SK2 101 (ME 101) Physic Lab,SK3 206 Collaborative Room 2"), ["SK2 101 (ME 101) Physic Lab", "SK3 206 Collaborative Room 2"]);
  assert.deepEqual(parseRooms("", "PA3 105"), ["PA3 105"]);
});

test("week options cover semester two", () => {
  const { data } = build("3E4");
  assert.equal(data.weeks.length, 14);
  assert.deepEqual(data.weeks[0], { week: 39, start: "2026-09-21" });
  assert.deepEqual(data.weeks.at(-1), { week: 52, start: "2026-12-21" });
});

test("3E4 timetable matches SWS exactly", () => {
  const { data, warnings } = build("3E4");
  assert.deepEqual(warnings, []);
  assert.deepEqual(summary(data.events), [
    "0 08:00-10:00 CMFP0043 Lecture @ SK3 103 Lecture 2",
    "0 13:00-15:00 CMFP0061 Lecture @ Auditorium",
    "0 15:30-17:00 CMFP0023 Seminar @ PA3 211",
    "1 10:00-12:00 CMFP0032 Lecture @ Harry Perkins LT",
    "1 15:30-17:00 CMFP0043 Tutorial @ PA3 207",
    "2 10:00-12:00 CMFP0032 Tutorial @ Harry Perkins LT",
    "2 15:30-17:00 CMFP0023 Seminar @ PA3 202",
    "2 17:00-18:30 CMFP0043 Clinic @ SK3 206 Collaborative Room 2",
    "3 09:30-11:00 CMFP0043 Tutorial @ PA3 206",
    "4 08:00-11:00 CMFP0061 Lab @ PA2 103 (Computer Lab)",
  ]);
  assert.deepEqual(Object.keys(data.units).sort(), ["CMFP0023", "CMFP0032", "CMFP0043", "CMFP0061"]);
  assert.equal(data.units.CMFP0043.short, "Maths 3");
  assert.ok(data.events.every((e) => e.weeks.join() === "41,42,43,44,45,46,47,48,49,50,51,52"));
});

test("2E3 timetable matches SWS exactly (Maths group K, English with Grace)", () => {
  const { data, warnings } = build("2E3");
  assert.deepEqual(warnings, []);
  assert.deepEqual(summary(data.events), [
    "0 08:00-10:00 CMFP0042 Lecture @ Auditorium",
    "0 10:00-12:00 CMFP0051 Lecture @ SK3 102 Lecture 1",
    "0 13:00-15:00 CMFP0061 Lecture @ Auditorium",
    "0 17:00-20:00 FP-070 Seminar @ SK3 206 Collaborative Room 2",
    "1 08:00-09:30 CMFP0021 Seminar @ LTCL 9 (HL2-109)",
    "1 14:00-17:00 CMFP0051 Workshop @ SK2 101 (ME 101) Physic Lab + SK3 206 Collaborative Room 2",
    "1 17:00-18:30 CMFP0042 Clinic @ SK3 205 Collaborative Room 1",
    "2 11:00-14:00 CMFP0061 Lab @ PA3 106 (Computer Lab)",
    "3 11:00-13:00 CMFP0051 Clinic @ Auditorium",
    "3 15:30-17:00 CMFP0042 Tutorial @ PA3 209",
    "3 17:00-18:30 CMFP0021 Seminar @ PA3 203",
    "4 10:00-11:30 CMFP0042 Tutorial @ PA3 210",
    "4 16:00-19:00 FP-070 Seminar @ LTBS LT II (HL2-111)",
  ]);
  assert.equal(findClashes(data.events).length, 0);
});

test("staff filter drops other teachers but keeps unlisted staff", () => {
  const rows = [
    ["FP-070/X/1", "Group 1", "FP-070 Academic English 060", "Seminar", "5/10/26", "17:00", "20:00", "3:00", "41-52", "R1", "Grace Abigail"],
    ["FP-070/X/2", "Group 2", "FP-070 Academic English 060", "Seminar", "5/10/26", "17:00", "20:00", "3:00", "41-52", "R2", "Harith Firajudeen Bin Jeferie"],
    ["FP-070/X/3", "Group 2", "FP-070 Academic English 060", "Seminar", "6/10/26", "17:00", "20:00", "3:00", "41-52", "R3", ""],
  ];
  const { data } = buildClassTimetable({
    className: "T", selections: [{ unit: "FP-070", groups: ["*"], staff: "grace" }], rows, weekOptions: fixture.weekOptions, semester: "S",
  });
  assert.deepEqual(data.events.map((e) => e.id), ["FP-070/X/1", "FP-070/X/3"]);
});

test("missing unit is reported, not silently empty", () => {
  const { data, warnings } = buildClassTimetable({
    className: "T", selections: [{ unit: "CMFP9999", groups: ["3E4"] }], rows: fixture.rows, weekOptions: fixture.weekOptions, semester: "S",
  });
  assert.equal(data.events.length, 0);
  assert.equal(warnings.length, 1);
});

test("canonical ignores updatedAt only", () => {
  const { data } = build("3E4");
  assert.equal(canonical({ ...data, updatedAt: "a" }), canonical({ ...data, updatedAt: "b" }));
  assert.notEqual(canonical(data), canonical({ ...data, events: data.events.slice(1) }));
});
