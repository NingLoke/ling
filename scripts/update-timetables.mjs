// Fetches the Curtin Malaysia timetable (sws.curtin.edu.my) and writes data/<class>.json.
//
//   node scripts/update-timetables.mjs                    live (needs Playwright + Chromium)
//   node scripts/update-timetables.mjs --fixture <file>   rebuild from saved rows (no network)
//
// A class file is only rewritten when its timetable actually changed.
// data/status.json records the last successful check, rewritten at most once per
// Malaysia day unless something changed, so the repo doesn't get a commit every run.
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { buildClassTimetable, canonical, isListRow, normalise } from "./lib/timetable.mjs";
import { measureInPage, pngSize, rowsHash, shotEntry, SHOT_SCALE, SHOT_VIEWPORT } from "./lib/sws-archive.mjs";
import { CLASSES, ALL_UNITS } from "./timetables.config.mjs";

const DATA_DIR = path.resolve("data");
const SHOT_DIR = path.resolve("sws"); // screenshots of each unit's SWS list page
const SWS = process.env.SWS_URL || "http://sws.curtin.edu.my/login.aspx"; // SWS_URL: point a test run at a stand-in

const args = process.argv.slice(2);
const fixtureIndex = args.indexOf("--fixture");
const fixturePath = fixtureIndex >= 0 ? args[fixtureIndex + 1] : null;

const readJson = async (file) => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
};
const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
const exists = (file) => stat(file).then(() => true, () => false);
const malaysiaDay = (iso) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10);

// One browser session on SWS: a fresh context (cookies), so every run starts the same way.
async function openSession(browser, timeout) {
  // High-DPI page so the per-unit screenshots come out 3840 px wide.
  const context = await browser.newContext({ viewport: SHOT_VIEWPORT, deviceScaleFactor: SHOT_SCALE });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);

  const options = async (name) => page.locator(`select[name=${name}] option`).evaluateAll((elements) =>
    elements.map((o) => ({ value: o.value, label: (o.textContent || "").replace(/\s+/g, " ").trim(), selected: o.selected }))
  );
  const selected = async (name) => (await options(name)).filter((o) => o.selected).map((o) => o.value);
  // Every SWS dropdown posts the whole form back (page reload) when it changes,
  // so wait for that reload before touching the next one.
  const choose = async (name, values) => {
    const wanted = [values].flat();
    if ((await selected(name)).join("\n") === wanted.join("\n")) return;
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {}),
      page.locator(`select[name=${name}]`).selectOption(wanted),
    ]);
    await page.locator(`select[name=${name}]`).waitFor();
  };

  await page.goto(SWS, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Student - Click here", exact: true }).click();
  await page.getByRole("link", { name: "Units", exact: true }).click();
  await page.locator("select[name=dlObject]").waitFor();

  // Pick the units, the whole semester, every day, day + evening, "List"; open the report.
  const viewList = async (unitValues, { semester, allDay, list }) => {
    await choose("dlObject", unitValues);
    await choose("lbWeeks", semester.value);
    await choose("lbDays", "1-7");
    if (allDay) await choose("dlPeriod", allDay.value);
    await choose("dlType", list.value);

    // Postbacks can drop a selection; check them all before asking for the report.
    const chosen = await selected("dlObject");
    if (unitValues.some((v) => !chosen.includes(v)) || chosen.length !== unitValues.length) throw new Error("SWS lost the unit selection.");
    if ((await selected("lbWeeks"))[0] !== semester.value) throw new Error("SWS lost the week selection.");
    if ((await selected("dlType"))[0] !== list.value) throw new Error("SWS lost the report type.");

    await Promise.all([
      page.waitForURL(/showtimetable/i, { waitUntil: "domcontentloaded" }),
      page.getByRole("button", { name: "View Timetable", exact: true }).click(),
    ]);
    await page.locator("tr").first().waitFor();
    return page.locator("tr").evaluateAll((elements) =>
      elements.map((row) => [...row.cells].map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim()))
    );
  };

  return { page, options, viewList, close: () => context.close() };
}

async function scrapeLive({ previousShots } = {}) {
  // PLAYWRIGHT_MODULE lets a local run point at an existing Playwright install.
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const sws = await openSession(browser, 60_000);
    // Read every option list before changing anything.
    const unitOptions = await sws.options("dlObject");
    const units = ALL_UNITS.map((code) => {
      const match = unitOptions.find((o) => o.label.split(" ")[0] === code || o.label.startsWith(`${code} `));
      if (!match) throw new Error(`Unit ${code} is not in the SWS Units list (${unitOptions.length} units listed).`);
      return { code, value: match.value, label: match.label };
    });
    const weekOptions = await sws.options("lbWeeks");
    const semester = weekOptions.find((o) => /semester/i.test(o.label)) ?? weekOptions[0];
    if (!semester) throw new Error("SWS shows no week options.");
    const periods = await sws.options("dlPeriod");
    const allDay = periods.find((o) => /day and evening/i.test(o.label)) ?? periods[0];
    const list = (await sws.options("dlType")).find((o) => o.label === "List");
    if (!list) throw new Error('SWS has no "List" report type.');
    const choices = { semester, allDay, list };

    const rows = await sws.viewList(units.map((u) => u.value), choices);
    await sws.close();

    // One screenshot per unit, each in a fresh SWS session, best effort: a failure here never
    // blocks the timetable update. A unit is only re-shot when its rows changed (or its picture is missing).
    const shots = [];
    for (const unit of units) {
      let one = null;
      try {
        one = await openSession(browser, 30_000);
        await one.viewList([unit.value], choices);
        await one.page.waitForLoadState("load").catch(() => {});
        const measured = await one.page.evaluate(measureInPage);
        const listRows = measured.rows.filter((row) => isListRow(row.cells));
        if (listRows.length === 0) throw new Error("the SWS page has no timetable rows");
        if (listRows.some((row) => !row.cells[2].startsWith(unit.code))) throw new Error("the SWS page shows another unit");
        const hash = rowsHash(listRows.map((row) => row.cells));
        const same = previousShots?.units?.[unit.code]?.hash === hash && (await exists(path.join(SHOT_DIR, `${unit.code}.png`)));
        const png = same ? null : await one.page.screenshot({ fullPage: true, type: "png" });
        shots.push({ code: unit.code, label: unit.label, hash, listRows, png });
        console.log(`SWS page ${unit.code}: ${listRows.length} rows${same ? ", screenshot unchanged" : ", new screenshot"}`);
      } catch (error) {
        console.log(`::warning::No SWS screenshot for ${unit.code}: ${error.message}`);
      } finally {
        await one?.close().catch(() => {});
      }
    }

    return {
      rows: rows.filter(isListRow),
      weekOptions: weekOptions.map((o) => o.label).filter((l) => /w\/c/i.test(l)),
      semester: semester.label,
      shots,
    };
  } finally {
    await browser.close();
  }
}

/** Save new screenshots and their row boxes (sws/<UNIT>.png, sws/index.json). */
async function writeShots(shots, previous) {
  const fresh = (shots || []).filter((shot) => shot.png);
  if (fresh.length === 0) return;
  await mkdir(SHOT_DIR, { recursive: true });
  const index = { schema: 1, units: { ...(previous?.units || {}) } };
  const capturedAt = new Date().toISOString();
  for (const shot of fresh) {
    await writeFile(path.join(SHOT_DIR, `${shot.code}.png`), shot.png);
    index.units[shot.code] = shotEntry({ code: shot.code, label: shot.label, capturedAt, hash: shot.hash, listRows: shot.listRows, size: pngSize(shot.png) });
  }
  await writeJson(path.join(SHOT_DIR, "index.json"), index);
  console.log(`sws/: ${fresh.length} new screenshot(s)`);
}

async function main() {
  const previousShots = await readJson(path.join(SHOT_DIR, "index.json"));
  const source = fixturePath ? JSON.parse(await readFile(fixturePath, "utf8")) : await scrapeLive({ previousShots });
  const rows = source.rows.filter(isListRow);
  const semester = normalise(source.semester?.label ?? source.semester);
  if (rows.length === 0) throw new Error("SWS list report had 0 data rows; the page layout may have changed. Not touching data.");
  if (source.weekOptions.length === 0) throw new Error("SWS returned no week dates. Not touching data.");
  console.log(`SWS: ${rows.length} rows, ${source.weekOptions.length} weeks, ${semester}`);

  await mkdir(DATA_DIR, { recursive: true });
  const now = new Date().toISOString();
  const statusFile = path.join(DATA_DIR, "status.json");
  const previousStatus = await readJson(statusFile);
  const status = { checkedAt: now, semester, classes: {} };
  let changed = false;

  for (const [className, config] of Object.entries(CLASSES)) {
    const { data, warnings } = buildClassTimetable({
      className, title: config.title, selections: config.selections, rows, weekOptions: source.weekOptions, semester,
    });
    for (const warning of warnings) console.log(`::warning::${warning}`);

    const file = path.join(DATA_DIR, `${className}.json`);
    const current = await readJson(file);

    if (data.events.length === 0) {
      // Usually means SWS has moved on to another semester; keep the last good timetable.
      console.log(`::warning::${className}: no classes matched, keeping existing ${path.relative(".", file)}`);
      status.classes[className] = { events: current?.events?.length ?? 0, updatedAt: current?.updatedAt ?? null, stale: true };
      continue;
    }

    if (canonical(current) !== canonical(data)) {
      await writeJson(file, { ...data, updatedAt: now });
      changed = true;
      console.log(`${className}: timetable changed -> ${path.relative(".", file)} (${data.events.length} classes)`);
      status.classes[className] = { events: data.events.length, updatedAt: now };
    } else {
      console.log(`${className}: no change (${data.events.length} classes)`);
      status.classes[className] = { events: data.events.length, updatedAt: current.updatedAt };
    }
  }

  const sameDay = previousStatus?.checkedAt && malaysiaDay(previousStatus.checkedAt) === malaysiaDay(now);
  const sameShape = previousStatus && JSON.stringify(previousStatus.classes) === JSON.stringify(status.classes);
  if (changed || !sameDay || !sameShape) {
    await writeJson(statusFile, status);
    console.log(`status.json updated (checkedAt ${now})`);
  } else {
    console.log("status.json already records a check today; leaving it alone");
  }

  await writeShots(source.shots, previousShots);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
