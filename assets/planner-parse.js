// Understands short planner commands typed into the bottom bar ("明天三点健身", "周五交报告", "每天背单词",
// "删掉周三的小组讨论") and the add-links ChatGPT puts in its answers (?add=event&title=…).
// Anything it isn't sure about returns null and goes to ChatGPT instead. Every result is shown on a
// confirm card first, so a wrong guess costs one tap. No DOM code in here, so node can test it.
import { addDays, daysBetween, dayIndexOf, fmtTime } from "./timetable-core.js?v=484ad6369e";

const DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const WEEKDAY = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6 };
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const NUM = "\\d{1,2}|[零〇一二两三四五六七八九十]{1,3}";
const PERIOD = "凌晨|早上|早晨|清早|上午|中午|下午|傍晚|晚上|夜里|夜晚|晚";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** "3" / "三" / "十一" / "二十三" -> number (up to 99), else null */
export function cnNumber(text) {
  if (/^\d{1,4}$/.test(text || "")) return Number(text);
  const m = /^([零〇一二两三四五六七八九])?(十)?([零〇一二三四五六七八九])?$/.exec(text || "");
  if (!m || !text) return null;
  const [, a, ten, b] = m;
  if (!ten) return b ? null : DIGIT[a];
  return (a ? DIGIT[a] : 1) * 10 + (b ? DIGIT[b] : 0);
}

const pad = (n) => String(n).padStart(2, "0");
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
/** A real calendar date? (2026-02-30 is not) */
export function validIso(iso) {
  if (!ISO.test(iso || "")) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Pulls the first match of `re` out of `text`; returns [match, rest] or [null, text]. */
function take(text, re) {
  const m = re.exec(text);
  if (!m) return [null, text];
  return [m, `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`];
}

function findDate(text, today) {
  let m;
  const [y0] = today.split("-").map(Number);
  // 2026-10-13, 2026/10/13, 2026年10月13日
  [m, text] = take(text, /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*[日号]?/);
  if (m) return [isoOf(m[1], m[2], m[3]), text];
  // 10月13日, 十月十三号, 10/13
  [m, text] = take(text, new RegExp(`(${NUM})\\s*月\\s*(${NUM})\\s*[日号]?|(\\d{1,2})/(\\d{1,2})(?![\\d:])`));
  if (m) {
    const month = cnNumber(m[1] ?? m[3]);
    const date = cnNumber(m[2] ?? m[4]);
    let iso = isoOf(y0, month, date);
    if (validIso(iso) && daysBetween(today, iso) < -60) iso = isoOf(y0 + 1, month, date); // "1月5日" said in December
    return [iso, text];
  }
  for (const [re, days] of [[/大后天/, 3], [/后天/, 2], [/明天|明日/, 1], [/今天|今日/, 0]]) {
    [m, text] = take(text, re);
    if (m) return [addDays(today, days), text];
  }
  // 周三, 星期五, 礼拜天, 下周一, 下下周二
  [m, text] = take(text, /(下下|下|这|本)?\s*(?:个)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/);
  if (m) {
    const monday = addDays(today, -dayIndexOf(today));
    let iso = addDays(monday, WEEKDAY[m[2]] + (m[1] === "下下" ? 14 : m[1] === "下" ? 7 : 0));
    if (!m[1] && daysBetween(today, iso) < 0) iso = addDays(iso, 7); // "周一" on a Wednesday: the coming one
    return [iso, text];
  }
  // 15号, 十五日 (this month, or next month if that day has passed)
  [m, text] = take(text, new RegExp(`(${NUM})\\s*[号日]`));
  if (m) {
    const [, mo] = today.split("-").map(Number);
    const date = cnNumber(m[1]);
    let iso = isoOf(y0, mo, date);
    if (validIso(iso) && daysBetween(today, iso) < 0) iso = mo === 12 ? isoOf(y0 + 1, 1, date) : isoOf(y0, mo + 1, date);
    return [iso, text];
  }
  return [null, text];
}

/** hour in a period ("下午3点" -> 15); with no period, 1–6 o'clock means the afternoon */
function adjustHour(hour, period) {
  if (!period) return hour >= 1 && hour <= 6 ? hour + 12 : hour;
  if (/下午|傍晚|晚|夜/.test(period)) return hour < 12 ? hour + 12 : hour;
  if (period === "中午") return hour <= 2 ? hour + 12 : hour;
  if (period === "凌晨" && hour === 12) return 0;
  return hour;
}
const minutesPart = (text) => (text === "半" ? 30 : text === "一刻" ? 15 : text === "三刻" ? 45 : text ? cnNumber(text.replace(/分$/, "")) ?? 0 : 0);
const TIME = `(?:(${PERIOD})\\s*)?(${NUM})\\s*(?:点钟?|:|：|时)\\s*(半|一刻|三刻|(?:${NUM})\\s*分?)?`;

function findTime(text) {
  let m;
  [m, text] = take(text, new RegExp(TIME));
  if (!m) {
    // just a part of the day: 明天下午开会 -> 14:00
    let p;
    [p, text] = take(text, new RegExp(PERIOD));
    if (!p) return [null, null, text];
    const start = { 凌晨: 6, 早上: 8, 早晨: 8, 清早: 7, 上午: 9, 中午: 12, 下午: 14, 傍晚: 18, 晚上: 19, 夜里: 21, 夜晚: 21, 晚: 19 }[p[0]] * 60;
    return [start, null, text];
  }
  const hour = cnNumber(m[2]);
  const mins = minutesPart(m[3]?.trim());
  if (hour == null || hour > 24 || mins > 59) return [null, null, text];
  const start = (adjustHour(hour, m[1]) % 24) * 60 + mins;
  // an end: 到5点, -17:00, 至晚上八点
  let end = null;
  let e;
  [e, text] = take(text, new RegExp(`^\\s*(?:到|至|-|~|～|—|–)\\s*${TIME}`));
  if (e) {
    let endHour = cnNumber(e[2]);
    if (endHour != null && endHour <= 24) {
      endHour = e[1] ? adjustHour(endHour, e[1]) : endHour;
      if (!e[1] && endHour < 12 && start >= 12 * 60 && (endHour + 12) * 60 > start) endHour += 12;
      end = endHour * 60 + minutesPart(e[3]?.trim());
    }
  } else {
    // a length: 两个小时, 1.5小时, 半小时, 45分钟
    let d;
    [d, text] = take(text, new RegExp(`(半|\\d+(?:\\.\\d+)?|${NUM})\\s*(?:个)?\\s*(?:半)?\\s*(小时|钟头|分钟)`));
    if (d) {
      const n = d[1] === "半" ? 0.5 : /^[\d.]+$/.test(d[1]) ? Number(d[1]) : cnNumber(d[1]) ?? 1;
      const extra = /个\s*半/.test(d[0]) ? 0.5 : 0;
      end = start + Math.round(d[2] === "分钟" ? n : (n + extra) * 60);
    }
  }
  return [start, end, text];
}

function findDays(text) {
  let m;
  [m, text] = take(text, /^\s*(?:每天|每日|天天)/);
  if (m) return [ALL_DAYS, text];
  [m, text] = take(text, /^\s*每(?:个)?工作日|^\s*工作日每天/);
  if (m) return [[0, 1, 2, 3, 4], text];
  [m, text] = take(text, /^\s*每(?:个)?周末/);
  if (m) return [[5, 6], text];
  [m, text] = take(text, /^\s*每(?:个)?(?:周|星期|礼拜)\s*([一二三四五六日天1-7、和与,，\s]+)/);
  if (m) {
    const days = [...new Set([...m[1]].filter((c) => c in WEEKDAY).map((c) => WEEKDAY[c]))].sort();
    return days.length ? [days, text] : [null, text];
  }
  return [null, text];
}

/** What's left once the dates and times are gone, tidied into a title. */
function tidy(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[\s，,、。:：]+|[\s，,、。.!！~～]+$/g, "")
    .replace(/^(?:帮我|请|给我)?\s*(?:添加|新建|加(?:个|一个|上)?|安排(?:一下)?|记(?:一下)?|设(?:个|一个)?)\s*(?:行程|日程|待办|任务)?\s*[:：]?\s*/, "")
    .replace(/^(?:要|得|在|的)\s*/, "")
    .replace(/^[\s，,、]+|[\s，,、]+$/g, "")
    .replace(/\s*[，,、]\s*/g, "，")
    .trim();
}

/**
 * parseCommand("明天三点健身", "2026-10-12") ->
 *   { action: "add", kind: "events", item: { title: "健身", date: "2026-10-13", start: 900, end: 960, place: "" } }
 * Also kind "todos" ({ title, due, star }), kind "habits" ({ title, days }), and
 * { action: "delete", query, date } for 删掉…; null for anything else (a question for ChatGPT).
 */
export function parseCommand(input, today) {
  let text = String(input || "").trim().slice(0, 200);
  if (!text || /[?？]\s*$/.test(text)) return null;
  if (/吗|呢|什么|怎么|为什么|如何|多少|哪|谁|几|是否|能不能|可不可以|可以吗|是不是|帮我(?:写|想|查|解释|翻译|算|看|改|画|生成|总结)|解释|翻译|总结|https?:/.test(text)) return null;
  text = text
    .replace(/今晚/g, "今天晚上").replace(/明晚/g, "明天晚上").replace(/今早/g, "今天早上").replace(/明早/g, "明天早上")
    .replace(/(\d{1,2})[:：](\d{2})/g, "$1点$2");

  // 删掉周三的小组讨论
  let m;
  [m, text] = take(text, /^\s*(?:帮我)?\s*(?:删掉|删除|删了|去掉|取消掉?)\s*/);
  if (m) {
    let date;
    [date, text] = findDate(text, today);
    const query = tidy(text.replace(/^\s*的/, ""));
    return query ? { action: "delete", query, date } : null;
  }

  // 每天背单词 / 每周一三五跑步
  let days;
  [days, text] = findDays(text);
  if (days) {
    const title = tidy(text);
    return title ? { action: "add", kind: "habits", item: { title, days } } : null;
  }

  let todoMark;
  [todoMark, text] = take(text, /^\s*(?:提醒我|记得|别忘了|别忘记|待办|todo)\s*[:：]?\s*/i);
  let star;
  [star, text] = take(text, /重要|紧急|[!！]{2,}/);
  let date;
  [date, text] = findDate(text, today);
  let start, end;
  [start, end, text] = findTime(text);
  if (date === null && start === null && !todoMark) return null;
  if (date && !validIso(date)) return null;
  const deadline = /之前|以前|前交|截止|deadline|due/i.test(text);
  let place = "";
  [m, text] = take(text, /[@＠]\s*([^\s，,。]+)/);
  if (m) place = m[1];
  const title = tidy(text.replace(/之前|以前|截止(?:日期)?/g, "").replace(/^\s*前\s*/, ""));
  if (!title) return null;

  if (todoMark || deadline || start === null) {
    return { action: "add", kind: "todos", item: { title, due: date, star: !!star } };
  }
  const day = date || today;
  if (end == null || end <= start) end = Math.min(start + 60, 24 * 60 - 1);
  if (end > 24 * 60 - 1) end = 24 * 60 - 1;
  if (end <= start) return null;
  return { action: "add", kind: "events", item: { title, date: day, start, end, place } };
}

/**
 * The add-links ChatGPT is asked to write (see the settings sheet):
 *   ?add=event&title=健身&date=2026-10-13&start=15:00&end=16:00&place=健身房
 *   ?add=todo&title=交报告&due=2026-10-16&star=1
 *   ?add=habit&title=背单词&days=0123456   (0 = 周一 … 6 = 周日)
 * -> { kind, item } or { error } (shown to the user), or null when there is no add link.
 */
export function parseAddLink(params) {
  const type = params.get("add");
  if (type == null) return null;
  const kind = { event: "events", events: "events", 行程: "events", todo: "todos", todos: "todos", 待办: "todos", habit: "habits", habits: "habits", 每日任务: "habits" }[type.trim()];
  const title = (params.get("title") || "").trim().slice(0, 200);
  if (!kind) return { error: "这个链接的类型看不懂（add= 后面要是 event、todo 或 habit）" };
  if (!title) return { error: "这个链接没有写标题（title=）" };
  const time = (name) => {
    const t = /^(\d{1,2}):(\d{2})$/.exec((params.get(name) || "").trim());
    return t && Number(t[1]) < 24 && Number(t[2]) < 60 ? Number(t[1]) * 60 + Number(t[2]) : null;
  };
  if (kind === "events") {
    const date = (params.get("date") || "").trim();
    const start = time("start");
    if (!validIso(date)) return { error: "这个行程链接的日期不对（date=YYYY-MM-DD）" };
    if (start == null) return { error: "这个行程链接没有开始时间（start=HH:MM）" };
    let end = time("end");
    if (end == null || end <= start) end = Math.min(start + 60, 24 * 60 - 1);
    return { kind, item: { title, date, start, end, place: (params.get("place") || "").trim().slice(0, 200) } };
  }
  if (kind === "todos") {
    const due = (params.get("due") || params.get("date") || "").trim();
    if (due && !validIso(due)) return { error: "这个待办链接的日期不对（due=YYYY-MM-DD）" };
    return { kind, item: { title, due: due || null, star: /^(1|true|yes)$/i.test(params.get("star") || "") } };
  }
  const days = [...new Set([...(params.get("days") || "0123456")].filter((c) => /[0-6]/.test(c)).map(Number))].sort();
  return { kind, item: { title, days: days.length ? days : ALL_DAYS } };
}

/** One line for the confirm card: "10月13日 周二 15:00–16:00 · 健身房" */
export function describe(kind, item) {
  const day = (iso) => {
    const [, m, d] = iso.split("-").map(Number);
    return `${m}月${d}日 ${["周一", "周二", "周三", "周四", "周五", "周六", "周日"][dayIndexOf(iso)]}`;
  };
  if (kind === "events") return [`${day(item.date)} ${fmtTime(item.start)}–${fmtTime(item.end)}`, item.place].filter(Boolean).join(" · ");
  if (kind === "todos") return [item.due ? `${day(item.due)} 到期` : "随时做", item.star ? "★ 重要" : ""].filter(Boolean).join(" · ");
  const names = ["一", "二", "三", "四", "五", "六", "日"];
  if (item.days.length === 7) return "每天";
  if (item.days.join() === "0,1,2,3,4") return "每个工作日";
  if (item.days.join() === "5,6") return "每个周末";
  return `每周${item.days.map((d) => names[d]).join("、")}`;
}
