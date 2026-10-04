// Turns rows from Curtin's SWS "List" report into the timetable JSON the sites read.
// Pure functions only: no network, no filesystem.

export const SCHEMA_VERSION = 1;

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export const normalise = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const pad = (n) => String(n).padStart(2, "0");
const isoDate = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// "8:00" -> 480
export function parseTime(text) {
  const match = normalise(text).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`Unrecognised time: "${text}"`);
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (minutes < 0 || minutes > 24 * 60) throw new Error(`Time out of range: "${text}"`);
  return minutes;
}

// "5/10/26" (d/m/yy) -> { iso: "2026-10-05", day: 0 } where day 0 = Monday
export function parseStartDate(text) {
  const match = normalise(text).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) throw new Error(`Unrecognised SWS date: "${text}"`);
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const month = Number(match[2]);
  const dayOfMonth = Number(match[1]);
  const utc = new Date(Date.UTC(year, month - 1, dayOfMonth));
  if (utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== dayOfMonth) {
    throw new Error(`Invalid SWS date: "${text}"`);
  }
  return { iso: isoDate(year, month, dayOfMonth), day: (utc.getUTCDay() + 6) % 7 };
}

// "41-52" | "41-46, 48-52" | "41,43" -> [41, 42, ...]
export function parseWeeks(text) {
  const weeks = new Set();
  for (const part of normalise(text).split(/[,;]/)) {
    const piece = part.trim();
    if (!piece) continue;
    const range = piece.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to < from || to - from > 60) throw new Error(`Bad week range: "${text}"`);
      for (let w = from; w <= to; w++) weeks.add(w);
    } else if (/^\d+$/.test(piece)) {
      weeks.add(Number(piece));
    } else {
      throw new Error(`Unrecognised weeks: "${text}"`);
    }
  }
  if (weeks.size === 0) throw new Error(`No weeks in: "${text}"`);
  return [...weeks].sort((a, b) => a - b);
}

// "week  39 w/c 21 Sep 2026" -> { week: 39, start: "2026-09-21" }
export function parseWeekOption(label) {
  const match = normalise(label).match(/week\s+(\d+)\s+w\/c\s+(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})/i);
  if (!match) return null;
  const month = MONTHS[match[3].toLowerCase()];
  if (!month) return null;
  return { week: Number(match[1]), start: isoDate(Number(match[4]), month, Number(match[2])) };
}

const compact = (token) => token.replace(/\s+/g, "").toUpperCase();

// Expands an SWS "Group Name" cell into the set of group ids it covers.
//   "3E1-4"              -> 3E1 3E2 3E3 3E4
//   "2E1-7; 2F1-3; 3E4"  -> 2E1..2E7 2F1..2F3 3E4
//   "K-Q;V-W"            -> K L M N O P Q V W
//   "1C2/1A1"            -> 1C2 1A1
//   "EB 1"               -> EB1
//   "All"                -> any group
//   "F (Venue: PA3 105)" -> F, with venue "PA3 105"
export function parseGroupField(text) {
  let raw = normalise(text);
  let venue = null;
  raw = raw.replace(/\(\s*venue\s*:\s*([^)]*)\)/gi, (_, v) => {
    venue = normalise(v) || venue;
    return " ";
  });
  raw = raw.replace(/\(\s*reserve\s*\)/gi, " ");

  const ids = new Set();
  let any = false;
  for (const part of raw.split(/[;,/&]/)) {
    const token = compact(part);
    if (!token) continue;
    if (token === "ALL") {
      any = true;
      continue;
    }
    // Letter range: "A-F"
    let m = token.match(/^([A-Z])-([A-Z])$/);
    if (m) {
      const from = m[1].charCodeAt(0);
      const to = m[2].charCodeAt(0);
      if (to >= from) for (let c = from; c <= to; c++) ids.add(String.fromCharCode(c));
      continue;
    }
    // Numbered range with the prefix repeated: "2E1-2E7"
    m = token.match(/^([0-9]*[A-Z]+)(\d+)-\1(\d+)$/);
    // Numbered range: "2E1-7", "EB1-2"
    if (!m) m = token.match(/^([0-9]*[A-Z]+)(\d+)-(\d+)$/);
    if (m) {
      const from = Number(m[2]);
      const to = Number(m[3]);
      if (to >= from && to - from <= 50) for (let n = from; n <= to; n++) ids.add(`${m[1]}${n}`);
      continue;
    }
    ids.add(token);
  }
  return { any, ids, venue };
}

// wanted: ["3E4"] / ["K"] / ["*"]
export function groupMatches(field, wanted) {
  const list = (Array.isArray(wanted) ? wanted : [wanted]).map((w) => compact(String(w)));
  if (list.includes("*")) return true;
  const parsed = parseGroupField(field);
  if (parsed.any) return true;
  return list.some((w) => parsed.ids.has(w));
}

// "Space_New It Staff" / "New Space Staff - Audrey Serani" / "A;B"
export function parseStaff(text) {
  return normalise(text)
    .split(";")
    .map((name) => normalise(name).replace(/^new space staff\s*-\s*/i, ""))
    .filter((name) => name && !/^space[_ ]/i.test(name) && !/^tba$/i.test(name));
}

// "SK2 101 (ME 101) Physic Lab,SK3 206 Collaborative Room 2" -> two rooms
export function parseRooms(text, venue) {
  const rooms = normalise(text)
    .split(",")
    .map((room) => normalise(room))
    .filter(Boolean);
  if (rooms.length === 0 && venue) rooms.push(venue);
  return rooms;
}

// "CMFP0043 Mathematics 3" -> { code: "CMFP0043", name: "Mathematics 3" }
export function parseDescription(text) {
  const value = normalise(text);
  const match = value.match(/^(\S+)\s+(.*)$/);
  return match ? { code: match[1], name: match[2] } : { code: value, name: value };
}

const TYPE_ALIASES = { laboratory: "Lab", lab: "Lab", lecture: "Lecture", tutorial: "Tutorial", seminar: "Seminar", workshop: "Workshop", clinic: "Clinic", practical: "Practical" };
export const normaliseType = (text) => {
  const value = normalise(text);
  return TYPE_ALIASES[value.toLowerCase()] ?? value;
};

export const isListRow = (cells) =>
  Array.isArray(cells) && cells.length === 11 && normalise(cells[0]) !== "Units" && /\d{1,2}:\d{2}/.test(cells[5] ?? "");

// One SWS row -> one event (all fields cleaned)
export function rowToEvent(cells) {
  const [activity, group, description, type, startDate, start, end, , weeks, room, staff] = cells.map(normalise);
  const { code, name } = parseDescription(description);
  const date = parseStartDate(startDate);
  const { venue } = parseGroupField(group);
  const event = {
    id: activity,
    unit: code,
    unitName: name,
    type: normaliseType(type),
    day: date.day,
    firstDate: date.iso,
    start: parseTime(start),
    end: parseTime(end),
    weeks: parseWeeks(weeks),
    rooms: parseRooms(room, venue),
    staff: parseStaff(staff),
    group,
  };
  if (event.end <= event.start) throw new Error(`Event ends before it starts: ${activity}`);
  return event;
}

const staffMatches = (event, wanted) => {
  if (!wanted) return true;
  if (event.staff.length === 0) return true; // no staff listed: keep rather than silently drop a class
  const needles = (Array.isArray(wanted) ? wanted : [wanted]).map((w) => w.toLowerCase());
  return event.staff.some((name) => needles.some((needle) => name.toLowerCase().includes(needle)));
};

export const eventSort = (a, b) =>
  a.day - b.day || a.start - b.start || a.end - b.end || a.unit.localeCompare(b.unit) || a.id.localeCompare(b.id);

/**
 * Build one class timetable.
 * @param {object} opts
 * @param {string} opts.className   e.g. "3E4"
 * @param {Array<{unit:string, groups:string[], staff?:string|string[], short?:string}>} opts.selections
 * @param {string[][]} opts.rows      raw SWS list rows (11 cells each)
 * @param {string[]} opts.weekOptions raw "week NN w/c ..." labels
 * @param {string} opts.semester      e.g. "Semester Two"
 * @returns {{data: object, warnings: string[]}}
 */
export function buildClassTimetable({ className, title, selections, rows, weekOptions, semester }) {
  const warnings = [];
  const events = [];
  const units = {};

  const parsedRows = [];
  for (const cells of rows) {
    if (!isListRow(cells)) continue;
    parsedRows.push(rowToEvent(cells));
  }

  for (const selection of selections) {
    const matches = parsedRows.filter(
      (event) => event.unit === selection.unit && groupMatches(event.group, selection.groups) && staffMatches(event, selection.staff)
    );
    if (matches.length === 0) {
      warnings.push(`${className}: no classes found for ${selection.unit} (groups ${selection.groups.join(", ")})`);
      continue;
    }
    units[selection.unit] = {
      code: selection.unit,
      name: matches[0].unitName,
      short: selection.short ?? matches[0].unitName,
      group: selection.groups.join(", "),
    };
    for (const event of matches) {
      const { unitName, ...rest } = event;
      events.push(rest);
    }
  }

  // The same activity can match twice if two selections overlap; keep one.
  const seen = new Set();
  const unique = events.filter((event) => (seen.has(event.id) ? false : (seen.add(event.id), true)));
  unique.sort(eventSort);

  for (const clash of findClashes(unique)) {
    warnings.push(`${className}: clash between ${clash[0].id} and ${clash[1].id}`);
  }

  const weeks = weekOptions.map(parseWeekOption).filter(Boolean).sort((a, b) => a.week - b.week);
  const weekSet = new Set(weeks.map((w) => w.week));
  for (const event of unique) {
    const missing = event.weeks.filter((w) => !weekSet.has(w));
    if (missing.length) warnings.push(`${className}: ${event.id} runs in weeks with no date (${missing.join(", ")})`);
  }

  return {
    data: {
      schema: SCHEMA_VERSION,
      class: className,
      title: title ?? className,
      semester: normalise(semester),
      timezone: "Asia/Kuching",
      source: "http://sws.curtin.edu.my",
      weeks,
      units,
      events: unique,
    },
    warnings,
  };
}

// Pairs of events that overlap on the same weekday in at least one shared week.
export function findClashes(events) {
  const clashes = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i];
      const b = events[j];
      if (a.day !== b.day) continue;
      if (a.start >= b.end || b.start >= a.end) continue;
      if (!a.weeks.some((w) => b.weeks.includes(w))) continue;
      clashes.push([a, b]);
    }
  }
  return clashes;
}

// Stable string for "did the timetable actually change?" (ignores updatedAt)
export function canonical(data) {
  if (!data) return "";
  const { updatedAt, ...rest } = data;
  return JSON.stringify(rest);
}
