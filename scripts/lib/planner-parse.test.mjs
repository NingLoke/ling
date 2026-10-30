import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, parseAddLink, cnNumber, describe } from "../../assets/planner-parse.js";

const today = "2026-10-12"; // Monday
const ev = (text) => parseCommand(text, today)?.item;

test("chinese numbers", () => {
  assert.deepEqual(["3", "三", "十", "十一", "二十", "二十三", "两", "三四"].map(cnNumber), [3, 3, 10, 11, 20, 23, 2, null]);
});

test("events: day words, bare afternoon hours, default one hour", () => {
  assert.deepEqual(parseCommand("明天三点健身", today), {
    action: "add", kind: "events", item: { title: "健身", date: "2026-10-13", start: 15 * 60, end: 16 * 60, place: "" },
  });
  assert.deepEqual(ev("后天上午10点半 小组讨论"), { title: "小组讨论", date: "2026-10-14", start: 630, end: 690, place: "" });
  assert.deepEqual(ev("今晚8点到10点 看电影 @GSC"), { title: "看电影", date: "2026-10-12", start: 20 * 60, end: 22 * 60, place: "GSC" });
  assert.deepEqual(ev("周三 15:30-17:00 讨论"), { title: "讨论", date: "2026-10-14", start: 930, end: 1020, place: "" });
  assert.deepEqual(ev("下周一中午12点 和小林吃饭"), { title: "和小林吃饭", date: "2026-10-19", start: 720, end: 780, place: "" });
  assert.deepEqual(ev("10月20日下午2点 开会两个小时"), { title: "开会", date: "2026-10-20", start: 840, end: 960, place: "" });
  assert.deepEqual(ev("下午3点到5点 自习"), { title: "自习", date: today, start: 900, end: 1020, place: "" });
  assert.deepEqual(ev("明天下午开会"), { title: "开会", date: "2026-10-13", start: 840, end: 900, place: "" });
});

test("weekday without 下 is the coming one", () => {
  assert.equal(parseCommand("周日下午3点 打球", "2026-10-14").item.date, "2026-10-18");
  assert.equal(parseCommand("周一 9点 早会", "2026-10-14").item.date, "2026-10-19");
  assert.equal(parseCommand("周三 9点 早会", "2026-10-14").item.date, "2026-10-14");
});

test("to-dos: a date without a time, or 提醒我 / 之前", () => {
  assert.deepEqual(parseCommand("周五交报告", today), { action: "add", kind: "todos", item: { title: "交报告", due: "2026-10-16", star: false } });
  assert.deepEqual(ev("提醒我买牛奶"), { title: "买牛奶", due: null, star: false });
  assert.deepEqual(ev("记得 明天 交作业 重要"), { title: "交作业", due: "2026-10-13", star: true });
  assert.deepEqual(ev("周五晚上12点前交报告"), { title: "交报告", due: "2026-10-16", star: false });
  assert.equal(ev("15号 交学费").due, "2026-10-15");
  assert.equal(ev("5号 交学费").due, "2026-11-05");
});

test("daily tasks", () => {
  assert.deepEqual(parseCommand("每天背单词", today), { action: "add", kind: "habits", item: { title: "背单词", days: [0, 1, 2, 3, 4, 5, 6] } });
  assert.deepEqual(ev("每周一三五 跑步"), { title: "跑步", days: [0, 2, 4] });
  assert.deepEqual(ev("每个工作日 复习"), { title: "复习", days: [0, 1, 2, 3, 4] });
});

test("delete", () => {
  assert.deepEqual(parseCommand("删掉周三的小组讨论", today), { action: "delete", query: "小组讨论", date: "2026-10-14" });
  assert.deepEqual(parseCommand("删除 健身", today), { action: "delete", query: "健身", date: null });
});

test("questions and plain chat go to ChatGPT", () => {
  for (const text of ["明天几点上课", "帮我写一首诗", "什么是傅里叶变换", "物理怎么复习？", "你好", "健身", ""]) {
    assert.equal(parseCommand(text, today), null, text);
  }
});

test("add links", () => {
  const p = (q) => parseAddLink(new URLSearchParams(q));
  assert.equal(p("now=2026-10-12T10:00"), null);
  assert.deepEqual(p("add=event&title=%E5%81%A5%E8%BA%AB&date=2026-10-13&start=15:00&end=16:00&place=Gym"), {
    kind: "events", item: { title: "健身", date: "2026-10-13", start: 900, end: 960, place: "Gym" },
  });
  assert.deepEqual(p("add=event&title=x&date=2026-10-13&start=15:00"), { kind: "events", item: { title: "x", date: "2026-10-13", start: 900, end: 960, place: "" } });
  assert.deepEqual(p("add=todo&title=x&due=2026-10-16&star=1"), { kind: "todos", item: { title: "x", due: "2026-10-16", star: true } });
  assert.deepEqual(p("add=habit&title=x&days=024"), { kind: "habits", item: { title: "x", days: [0, 2, 4] } });
  assert.ok(p("add=event&title=x&date=2026-02-30&start=15:00").error);
  assert.ok(p("add=party&title=x").error);
  assert.ok(p("add=todo").error);
});

test("confirm card lines", () => {
  assert.equal(describe("events", { date: "2026-10-13", start: 900, end: 960, place: "健身房" }), "10月13日 周二 15:00–16:00 · 健身房");
  assert.equal(describe("todos", { due: null, star: true }), "随时做 · ★ 重要");
  assert.equal(describe("habits", { days: [0, 2, 4] }), "每周一、三、五");
});
