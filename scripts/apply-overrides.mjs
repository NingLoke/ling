// Applies Moodle-verified, week-scoped room corrections (data/overrides.json)
// on top of the SWS timetable data.
//
// Why this exists: the GitHub runner cannot reach sws.curtin.edu.my since
// 2026-10-22, so the SWS fetch exits gracefully and the site keeps showing
// the last SWS snapshot — including rooms SWS has since changed. An override
// is a single event in a single SWS week, e.g. "PHY2 lecture week 46 is in
// LT201, not SK3 102". The site reads it from the event's `roomsByWeek` map
// (see roomsForWeek in assets/timetable-core.js); every other week falls
// back to the SWS `rooms` list, so nothing else changes.
//
// Workflow order matters: this runs AFTER the SWS fetch (which rewrites
// data/*.json from scratch on success) and BEFORE the snapshot is baked into
// index.html. The overrides file itself is the source of truth — remove an
// entry (or the whole file) to revert.
//
//   node scripts/apply-overrides.mjs [dataDir]
//   - dataDir defaults to the repo's data/ directory.
//   - Exits 0 when there is no overrides file, and when nothing changed.
//   - Exits 1 on a malformed overrides file or a timetable that no longer
//     validates after applying. A missing class file or event id is a warning,
//     not a failure: SWS may have renamed an event, and that must not block
//     the daily timetable update.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateTimetable } from "../assets/timetable-core.js";

export class OverridesError extends Error {}

const isNonEmptyStringArray = (value) =>
  Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" && v.trim().length > 0);

/** Validate an overrides document; returns the normalised entry list. Throws OverridesError. */
export function validateOverrides(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new OverridesError("overrides file must be a JSON object");
  }
  if (doc.version !== undefined && doc.version !== 1) {
    throw new OverridesError(`unsupported overrides version: ${JSON.stringify(doc.version)} (expected 1)`);
  }
  if (!Array.isArray(doc.overrides)) {
    throw new OverridesError('overrides file must have an "overrides" array');
  }
  return doc.overrides.map((entry, i) => {
    const where = `overrides[${i}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new OverridesError(`${where} must be an object`);
    }
    if (typeof entry.class !== "string" || !entry.class.trim()) {
      throw new OverridesError(`${where}.class must be a non-empty string`);
    }
    if (typeof entry.event !== "string" || !entry.event.trim()) {
      throw new OverridesError(`${where}.event must be a non-empty string`);
    }
    if (!Number.isInteger(entry.week) || entry.week < 1) {
      throw new OverridesError(`${where}.week must be a positive integer, got ${JSON.stringify(entry.week)}`);
    }
    if (!isNonEmptyStringArray(entry.rooms)) {
      throw new OverridesError(`${where}.rooms must be a non-empty array of room names`);
    }
    return {
      class: entry.class.trim(),
      event: entry.event.trim(),
      week: entry.week,
      rooms: entry.rooms.map((r) => r.trim()),
      source: typeof entry.source === "string" ? entry.source : "",
    };
  });
}

/**
 * Apply validated overrides to one parsed timetable object (mutated in place).
 * Returns { applied: [...], warnings: [...] }.
 * An override is skipped with a warning when its event id is not in the file
 * or the event does not run in that week; it never invents a week.
 */
export function applyOverridesToData(timetable, overrides) {
  const applied = [];
  const warnings = [];
  const byId = new Map((timetable.events ?? []).map((e) => [e.id, e]));
  for (const o of overrides) {
    const event = byId.get(o.event);
    if (!event) {
      warnings.push(`${o.class} ${o.event}: event not found in timetable, skipping week ${o.week} override`);
      continue;
    }
    if (!Array.isArray(event.weeks) || !event.weeks.includes(o.week)) {
      warnings.push(`${o.class} ${o.event}: event does not run in week ${o.week}, skipping`);
      continue;
    }
    const before = event.roomsByWeek?.[String(o.week)];
    if (before && JSON.stringify(before) === JSON.stringify(o.rooms)) continue; // already applied
    event.roomsByWeek = { ...(event.roomsByWeek ?? {}), [String(o.week)]: o.rooms };
    applied.push({ class: o.class, event: o.event, week: o.week, rooms: o.rooms, source: o.source });
  }
  return { applied, warnings };
}

async function main() {
  const dataDir = path.resolve(process.argv[2] ?? new URL("../data/", import.meta.url).pathname);
  const overridesPath = path.join(dataDir, "overrides.json");
  let raw;
  try {
    raw = await readFile(overridesPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("apply-overrides: no data/overrides.json, nothing to apply");
      return;
    }
    throw error;
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (error) {
    throw new OverridesError(`data/overrides.json is not valid JSON: ${error.message}`);
  }
  const overrides = validateOverrides(doc);
  if (overrides.length === 0) {
    console.log("apply-overrides: overrides list is empty, nothing to apply");
    return;
  }
  const byClass = new Map();
  for (const o of overrides) {
    if (!byClass.has(o.class)) byClass.set(o.class, []);
    byClass.get(o.class).push(o);
  }
  for (const [className, entries] of byClass) {
    const file = path.join(dataDir, `${className}.json`);
    let timetable;
    try {
      timetable = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        console.warn(`apply-overrides: warning: data/${className}.json not found, skipping ${entries.length} override(s)`);
        continue;
      }
      throw error;
    }
    const before = JSON.stringify(timetable);
    const { applied, warnings } = applyOverridesToData(timetable, entries);
    for (const w of warnings) console.warn(`apply-overrides: warning: ${w}`);
    if (!validateTimetable(timetable)) {
      throw new OverridesError(`data/${className}.json no longer validates after applying overrides`);
    }
    if (JSON.stringify(timetable) === before) {
      console.log(`apply-overrides: ${className}: no change`);
      continue;
    }
    await writeFile(file, `${JSON.stringify(timetable, null, 2)}\n`);
    for (const a of applied) {
      console.log(`apply-overrides: ${a.class} ${a.event} week ${a.week} rooms -> ${a.rooms.join(" + ")}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`apply-overrides: ${error.message}`);
    process.exit(1);
  });
}
