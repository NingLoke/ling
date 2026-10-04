// Fetches the Curtin Malaysia timetable (sws.curtin.edu.my) and writes data/<class>.json.
//
//   node scripts/update-timetables.mjs                    live (needs Playwright + Chromium)
//   node scripts/update-timetables.mjs --fixture <file>   rebuild from saved rows (no network)
//
// A class file is only rewritten when its timetable actually changed.
// data/status.json records the last successful check, rewritten at most once per
// Malaysia day unless something changed, so the repo doesn't get a commit every run.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { buildClassTimetable, canonical, isListRow, normalise } from "./lib/timetable.mjs";
import { CLASSES, ALL_UNITS } from "./timetables.config.mjs";

const DATA_DIR = path.resolve("data");
const SWS = "http://sws.curtin.edu.my/login.aspx";

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
const malaysiaDay = (iso) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10);

async function scrapeLive() {
  // PLAYWRIGHT_MODULE lets a local run point at an existing Playwright install.
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60_000);
    await page.goto(SWS, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Student - Click here", exact: true }).click();
    await page.getByRole("link", { name: "Units", exact: true }).click();
    await page.locator("select[name=dlObject]").waitFor();

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

    // Read every option list before changing anything.
    const unitOptions = await options("dlObject");
    const unitValues = ALL_UNITS.map((code) => {
      const match = unitOptions.find((o) => o.label.split(" ")[0] === code || o.label.startsWith(`${code} `));
      if (!match) throw new Error(`Unit ${code} is not in the SWS Units list (${unitOptions.length} units listed).`);
      return match.value;
    });
    const weekOptions = await options("lbWeeks");
    const semester = weekOptions.find((o) => /semester/i.test(o.label)) ?? weekOptions[0];
    if (!semester) throw new Error("SWS shows no week options.");
    const periods = await options("dlPeriod");
    const allDay = periods.find((o) => /day and evening/i.test(o.label)) ?? periods[0];
    const list = (await options("dlType")).find((o) => o.label === "List");
    if (!list) throw new Error('SWS has no "List" report type.');

    await choose("dlObject", unitValues);
    await choose("lbWeeks", semester.value);
    await choose("lbDays", "1-7");
    if (allDay) await choose("dlPeriod", allDay.value);
    await choose("dlType", list.value);

    // Postbacks can drop a selection; check them all before asking for the report.
    const units = await selected("dlObject");
    if (unitValues.some((v) => !units.includes(v))) throw new Error("SWS lost the unit selection.");
    if ((await selected("lbWeeks"))[0] !== semester.value) throw new Error("SWS lost the week selection.");
    if ((await selected("dlType"))[0] !== list.value) throw new Error("SWS lost the report type.");

    await Promise.all([
      page.waitForURL(/showtimetable/i, { waitUntil: "domcontentloaded" }),
      page.getByRole("button", { name: "View Timetable", exact: true }).click(),
    ]);
    await page.locator("tr").first().waitFor();

    const rows = await page.locator("tr").evaluateAll((elements) =>
      elements.map((row) => [...row.cells].map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim()))
    );
    return {
      rows: rows.filter(isListRow),
      weekOptions: weekOptions.map((o) => o.label).filter((l) => /w\/c/i.test(l)),
      semester: semester.label,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const source = fixturePath ? JSON.parse(await readFile(fixturePath, "utf8")) : await scrapeLive();
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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
