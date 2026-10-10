// Builds the planner as a stand-alone folder: dist/timetable-ling/ (+ dist/timetable-ling.zip).
// Everything is inside one index.html (code, Firebase, a copy of the class timetables), so it opens by
// double-clicking the file, without a web server. The same folder is what a later APK / EXE wraps.
//   node scripts/build-planner-app.mjs
// Needs npx (it runs esbuild 0.25.10). Rebuild after changing anything in planner/ (e.g. firebase-config.js).
import { readFile, writeFile, mkdir, rm, copyFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "timetable-ling");
const CLASSES = ["2E3", "2E4", "3E2", "3E4"];

// 1. one script: planner/app.js and everything it imports, Firebase included (its dynamic import gets inlined)
const bundle = execFileSync(
  "npx",
  ["--yes", "esbuild@0.25.10", "planner/app.js", "--bundle", "--format=iife", "--minify", "--target=es2020", "--legal-comments=eof", "--log-level=error"],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

// 2. a copy of each class's timetable, used until (or unless) the live one can be fetched
const timetables = {};
for (const cls of CLASSES) timetables[cls] = JSON.parse(await readFile(path.join(root, "data", `${cls}.json`), "utf8"));

// inside <script>, "</script" would end the element early; "<\/script" means the same thing to JS
const inline = (js) => js.replace(/<\/script/gi, "<\\/script");

let html = await readFile(path.join(root, "planner", "index.html"), "utf8");
const entry = '<script type="module" src="./app.js"></script>';
if (!html.includes(entry)) throw new Error(`planner/index.html no longer has ${entry}`);
html = html
  .replace(entry, () => `<script>window.PLANNER_BUILTIN_TIMETABLES = ${inline(JSON.stringify(timetables))};</script>\n<script>\n${inline(bundle)}</script>`)
  .replaceAll("../assets/icon-", "./icon-");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await writeFile(path.join(out, "index.html"), html);
for (const size of [180, 192, 512]) await copyFile(path.join(root, "assets", `icon-${size}.png`), path.join(out, `icon-${size}.png`));
const manifest = (await readFile(path.join(root, "planner", "manifest.webmanifest"), "utf8")).replaceAll("../assets/icon-", "./icon-");
await writeFile(path.join(out, "manifest.webmanifest"), manifest);
await writeFile(
  path.join(out, "使用说明.txt"),
  `计划（timetable-ling）
====================

打开：双击 index.html，用 Chrome / Edge / Safari 打开就能用。

- 资料存在这台电脑的浏览器里（同一个浏览器、同一个文件位置打开才会看到同一份资料）。
- 课表：有网时自动读取最新的课表；没网时用这个文件里附带的课表（${new Date().toISOString().slice(0, 10)} 的版本）。
- 云同步：在「设置 · 同步」里登录后，手机和电脑会自动同步。要先把 Firebase 设置填进 planner/firebase-config.js
  再重新生成这个文件夹（步骤见仓库里的 planner/SETUP.md）。还没设置时，资料只存在这台电脑上。
- Google 登录只在网站版（网址打开）里有；这个文件版和以后的 APK / EXE 用邮箱密码登录。

以后打包成 APK / EXE：这个文件夹就是 App 的内容（例如 Capacitor 的 webDir、Electron 载入的页面）。

重新生成（在仓库根目录）：node scripts/build-planner-app.mjs
`,
);

// 3. a zip next to it, for downloading
const zip = path.join(root, "dist", "timetable-ling.zip");
await rm(zip, { force: true });
execFileSync("zip", ["-qr", "timetable-ling.zip", "timetable-ling"], { cwd: path.join(root, "dist") });

const files = await readdir(out);
console.log(`built ${path.relative(root, out)}/ (${files.join(", ")}) and dist/timetable-ling.zip`);
