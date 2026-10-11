import { test } from "node:test";
import assert from "node:assert/strict";
import { commandsFromJson, commandsFromModel, commandsFromIcs, prepareCommands, alarmTime, sameItem, modelPrompt } from "../../assets/planner-admin.js";

const now = Date.parse("2026-10-11T12:00:00+08:00");
const event = { title: "健身", date: "2026-10-12", start: "15:00", end: "16:00", place: "健身房" };
const state = { events: [{ ...event, start: 900, end: 960, id: "gym" }], todos: [], habits: [] };
const add = { action: "add", kind: "events", item: event };
const json = (commands) => JSON.stringify({ version: 1, commands });

test("JSON and fenced model output go through the same command validation", () => {
  const raw = commandsFromJson("\uFEFF" + json([add]));
  assert.deepEqual(commandsFromModel(`<think>ignore {bad}</think>\n\`\`\`json\n${json([add])}\n\`\`\`<|im_end|>`), raw);
  assert.equal(prepareCommands(raw, state, now)[0].item.start, 900);
  assert.throws(() => commandsFromModel('{"version":1,"commands":['), /完整指令/);
  assert.throws(() => commandsFromJson('{"schema":1,"events":[]}'), /导入备份/);
});

test("reject unsafe actions, dates, times, huge batches and invalid item fields before writing", () => {
  for (const c of [
    { action: "eval", kind: "events", item: event },
    { ...add, kind: "settings" },
    { ...add, item: { ...event, date: "2026-02-30" } },
    { ...add, item: { ...event, start: "25:00" } },
    { ...add, item: { ...event, end: "14:59" } },
    { action: "add", kind: "habits", item: { title: "读书", days: [7] } },
    { action: "add", kind: "todos", item: { title: "报告", star: "false" } },
  ]) assert.throws(() => prepareCommands([add, c], state, now), /第 2 条/);
  assert.throws(() => prepareCommands(Array(101).fill(add), state, now), /100/);
  assert.equal(state.events.length, 1);
});

test("deletes require an exact unique item, never a substring or a timetable class", () => {
  const c = { action: "delete", kind: "events", query: "健身" };
  assert.equal(prepareCommands([c], state, now)[0].id, "gym");
  assert.throws(() => prepareCommands([{ ...c, query: "健" }], state, now), /没找到/);
  assert.throws(() => prepareCommands([c], { ...state, events: [...state.events, { ...state.events[0], id: "other" }] }, now), /多个/);
  assert.throws(() => prepareCommands([c, c], state, now), /修改两次/);
  assert.throws(() => prepareCommands([{ ...c, id: "course" }], state, now), /没找到/);
});

test("updates preserve unspecified fields and validate the full resulting item", () => {
  const c = { action: "update", kind: "events", id: "gym", item: { start: "15:30", end: "16:30" } };
  const out = prepareCommands([c], state, now)[0];
  assert.equal(out.item.place, "健身房");
  assert.equal(out.item.start, 930);
  assert.equal(out.old.start, 900);
  assert.throws(() => prepareCommands([{ ...c, item: { start: "17:00" } }], state, now), /结束时间/);
});

test("reimport comparison uses normalized data and alarms use UTC+8", () => {
  assert.ok(sameItem("events", state.events[0], event));
  assert.ok(!sameItem("events", { title: "broken" }, event));
  const out = prepareCommands([{ action: "alarm", title: "起床", date: "2026-10-12", time: "07:00", mode: "both" }], state, now)[0];
  assert.equal(alarmTime(out), Date.parse("2026-10-11T23:00:00Z"));
  assert.throws(() => prepareCommands([{ ...out, date: "2026-10-10" }], state, now), /已经过去/);
  assert.throws(() => prepareCommands([{ ...out, mode: "shell" }], state, now), /提醒方式/);
});

test("calendar times convert from UTC and escaped titles stay text; VALARM creates a notification", () => {
  const text = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:见面\\,讨论\r\nDTSTART:20261012T070000Z\r\nDTEND:20261012T080000Z\r\nLOCATION:Room\\; 2\r\nBEGIN:VALARM\r\nTRIGGER:-PT30M\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR";
  const out = prepareCommands(commandsFromIcs(text), state, now);
  assert.equal(out[0].item.start, 900);
  assert.equal(out[0].item.title, "见面,讨论");
  assert.equal(out[1].time, 870);
  assert.equal(out[1].mode, "notification");
});

test("unsupported recurrence, cross-day events, other timezones and incomplete calendars fail visibly", () => {
  const text = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Gym\nDTSTART:20261012T150000\nDTEND:20261012T160000\nEND:VEVENT\nEND:VCALENDAR";
  for (const bad of [text.replace("END:VEVENT", "RRULE:FREQ=WEEKLY\nEND:VEVENT"), text.replace("20261012T160000", "20261013T160000"), text.replace("DTSTART:", "DTSTART;TZID=America/New_York:"), text.replace("END:VEVENT", "")]) assert.throws(() => commandsFromIcs(bad));
  assert.equal(commandsFromIcs(text)[0].item.start, 900);
});

test("model prompt is bounded, uses today's date and includes complete target records", () => {
  const prompt = modelPrompt("把健身改到四点", "2026-10-11", state);
  assert.match(prompt, /今天 2026-10-11/);
  assert.match(prompt, /"id":"gym"/);
  assert.match(prompt, /\/no_think/);
  assert.throws(() => modelPrompt("x".repeat(1801), "2026-10-11", state), /1800/);
});
