// Bakes a timetable snapshot into a page so it renders instantly (and offline):
//   node scripts/embed-data.mjs index.html data/2E3.json
// The page must contain <script type="application/json" id="embedded-timetable">...</script>.
// Prints "changed" or "unchanged".
import { readFile, writeFile } from "node:fs/promises";

const [htmlPath, jsonPath] = process.argv.slice(2);
if (!htmlPath || !jsonPath) {
  console.error("usage: node scripts/embed-data.mjs <page.html> <timetable.json>");
  process.exit(2);
}

const html = await readFile(htmlPath, "utf8");
const data = JSON.parse(await readFile(jsonPath, "utf8"));
// Escape "<" so the JSON can never close the script tag early.
const json = JSON.stringify(data).replace(/</g, "\\u003c");
const pattern = /(<script\b[^>]*\bid="embedded-timetable"[^>]*>)[\s\S]*?(<\/script>)/;
if (!pattern.test(html)) {
  console.error(`${htmlPath}: no <script id="embedded-timetable"> found`);
  process.exit(1);
}
const next = html.replace(pattern, (_, open, close) => `${open}${json}${close}`);
if (next !== html) await writeFile(htmlPath, next);
console.log(next === html ? "unchanged" : "changed");
