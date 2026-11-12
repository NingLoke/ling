// Tests for scripts/apply-overrides.mjs — the week-scoped room corrections.
// The override must apply to the listed week only: the SWS `rooms` list and
// every other week stay exactly as they were.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateOverrides, applyOverridesToData, OverridesError } from "./apply-overrides.mjs";
import { roomsForWeek } from "../assets/timetable-core.js";

const lecture = () => ({
  id: "CMFP0051/CSM/1/3/LEC/1",
  unit: "CMFP0051",
  type: "Lecture",
  day: 0,
  start: 600,
  end: 720,
  weeks: [45, 46, 47],
  rooms: ["SK3 102 Lecture 1"],
  staff: ["Lukman Mohd Najib"],
});
const workshop = () => ({
  id: "CMFP0051/CSM/1/3/WS/06",
  unit: "CMFP0051",
  type: "Workshop",
  day: 1,
  start: 840,
  end: 1020,
  weeks: [45, 46, 47],
  rooms: ["SK2 101 (ME 101) Physic Lab", "SK3 206 Collaborative Room 2"],
  staff: ["John Wong Sze Yong"],
});
const timetable = () => ({ schema: 1, class: "2E3", weeks: [{ week: 45 }, { week: 46 }, { week: 47 }], events: [lecture(), workshop()] });
const week46 = () => ([
  { class: "2E3", event: "CMFP0051/CSM/1/3/LEC/1", week: 46, rooms: ["LT201"] },
  { class: "2E3", event: "CMFP0051/CSM/1/3/WS/06", week: 46, rooms: ["SK2-102"] },
]);

test("week-46 override applies to week 46 only, SWS rooms untouched", () => {
  const data = timetable();
  const { applied, warnings } = applyOverridesToData(data, week46());
  assert.deepEqual(warnings, []);
  assert.equal(applied.length, 2);

  const lec = data.events[0];
  const ws = data.events[1];
  // The override is stored per week; the base rooms list is never rewritten.
  assert.deepEqual(lec.rooms, ["SK3 102 Lecture 1"]);
  assert.deepEqual(ws.rooms, ["SK2 101 (ME 101) Physic Lab", "SK3 206 Collaborative Room 2"]);
  assert.deepEqual(lec.roomsByWeek, { 46: ["LT201"] });
  assert.deepEqual(ws.roomsByWeek, { 46: ["SK2-102"] });

  // What the site renders, per week:
  assert.deepEqual(roomsForWeek(lec, 46), ["LT201"]);
  assert.deepEqual(roomsForWeek(ws, 46), ["SK2-102"]);
  assert.deepEqual(roomsForWeek(lec, 45), ["SK3 102 Lecture 1"]);
  assert.deepEqual(roomsForWeek(lec, 47), ["SK3 102 Lecture 1"]);
  assert.deepEqual(roomsForWeek(ws, 45), ["SK2 101 (ME 101) Physic Lab", "SK3 206 Collaborative Room 2"]);
  assert.deepEqual(roomsForWeek(ws, 47), ["SK2 101 (ME 101) Physic Lab", "SK3 206 Collaborative Room 2"]);
});

test("no change when the override week differs or the event does not run that week", () => {
  const data = timetable();
  const { applied, warnings } = applyOverridesToData(data, [
    { class: "2E3", event: "CMFP0051/CSM/1/3/LEC/1", week: 47, rooms: ["LT201"] },
  ]);
  // Week 47 is a real week for this event, so it applies there — and only there.
  assert.equal(applied.length, 1);
  assert.deepEqual(roomsForWeek(data.events[0], 47), ["LT201"]);
  assert.deepEqual(roomsForWeek(data.events[0], 46), ["SK3 102 Lecture 1"]);

  const data2 = timetable();
  const res2 = applyOverridesToData(data2, [
    { class: "2E3", event: "CMFP0051/CSM/1/3/LEC/1", week: 52, rooms: ["LT201"] },
  ]);
  assert.equal(res2.applied.length, 0);
  assert.equal(res2.warnings.length, 1);
  assert.match(res2.warnings[0], /does not run in week 52/);
  assert.equal(data2.events[0].roomsByWeek, undefined);
});

test("unknown event id warns and changes nothing", () => {
  const data = timetable();
  const before = JSON.stringify(data);
  const { applied, warnings } = applyOverridesToData(data, [
    { class: "2E3", event: "CMFP0051/CSM/1/3/LEC/99", week: 46, rooms: ["LT201"] },
  ]);
  assert.equal(applied.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /event not found/);
  assert.equal(JSON.stringify(data), before);
});

test("applying twice is a no-op the second time, and other weeks' overrides survive", () => {
  const data = timetable();
  applyOverridesToData(data, [{ class: "2E3", event: "CMFP0051/CSM/1/3/LEC/1", week: 45, rooms: ["LT201"] }]);
  const { applied } = applyOverridesToData(data, week46());
  assert.equal(applied.length, 2);
  assert.deepEqual(data.events[0].roomsByWeek, { 45: ["LT201"], 46: ["LT201"] });

  const snapshot = JSON.stringify(data);
  const second = applyOverridesToData(data, week46());
  assert.equal(second.applied.length, 0);
  assert.equal(JSON.stringify(data), snapshot);
});

test("malformed overrides fail clearly", () => {
  assert.throws(() => validateOverrides(null), OverridesError);
  assert.throws(() => validateOverrides({ overrides: "nope" }), OverridesError);
  assert.throws(() => validateOverrides({ version: 2, overrides: [] }), OverridesError);
  assert.throws(() => validateOverrides({ overrides: [{ class: "2E3", event: "X", week: "46", rooms: ["LT201"] }] }), OverridesError);
  assert.throws(() => validateOverrides({ overrides: [{ class: "2E3", event: "X", week: 46, rooms: [] }] }), OverridesError);
  assert.throws(() => validateOverrides({ overrides: [{ class: "2E3", event: "X", week: 46, rooms: ["  "] }] }), OverridesError);
  assert.throws(() => validateOverrides({ overrides: [{ event: "X", week: 46, rooms: ["LT201"] }] }), OverridesError);
  // A well-formed document passes through unchanged (apart from trimming).
  assert.deepEqual(validateOverrides({ version: 1, overrides: [{ class: " 2E3 ", event: " X ", week: 46, rooms: [" LT201 "] }] }), [
    { class: "2E3", event: "X", week: 46, rooms: ["LT201"], source: "" },
  ]);
});
