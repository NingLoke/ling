// Builds the timetable site (课表 + 每日任务 · 行程 · 待办 + sync) as a stand-alone folder:
// dist/timetable-ling/ (+ dist/timetable-ling.zip).
// index.html carries all the page's code in one plain <script> (Firebase, the game and the map's own code
// included), so it opens by double-clicking the file, without a web server. The 3D map also needs
// MapLibre and the campus data files, which a browser only runs from a real address: they are in the folder
// for the APK / EXE later (which serve it from one), and the page explains when opened as a file.
//   node scripts/build-app.mjs        (npm run build:app)
// Needs npx (it runs esbuild 0.25.10). Rebuild after changing the page or assets (e.g. firebase-config.js).
import { readFile, writeFile, mkdir, rm, cp, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const out = path.join(dist, "timetable-ling");
const work = path.join(dist, ".build");
const STAMP = /(["'])(\.\/(?:assets\/)?[\w-]+\.js)\?v=[0-9a-f]*\1/g; // "./x.js?v=abc" -> "./x.js" (esbuild wants plain paths)
const unstamp = (code) => code.replace(STAMP, "$1$2$1");

let html = await readFile(path.join(root, "index.html"), "utf8");
const MODULE = /<script type="module">\n([\s\S]*?)<\/script>/;
const match = MODULE.exec(html);
if (!match) throw new Error('index.html no longer has its <script type="module">');

// 1. the page's module and everything it imports, in a scratch copy without the ?v= stamps
await rm(work, { recursive: true, force: true });
await mkdir(path.join(work, "assets"), { recursive: true });
for (const name of await readdir(path.join(root, "assets"))) {
  if (name.endsWith(".js")) await writeFile(path.join(work, "assets", name), unstamp(await readFile(path.join(root, "assets", name), "utf8")));
}
await cp(path.join(root, "assets", "vendor", "firebase-12.19.0"), path.join(work, "assets", "vendor", "firebase-12.19.0"), { recursive: true });
await writeFile(path.join(work, "page.js"), unstamp(match[1]));
const bundle = execFileSync(
  "npx",
  ["--yes", "esbuild@0.25.10", "page.js", "--bundle", "--format=iife", "--minify", "--target=es2020", "--legal-comments=eof", "--log-level=error"],
  { cwd: work, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
await rm(work, { recursive: true, force: true });

// inside <script>, "</script" would end the element early; "<\/script" means the same thing to JS
const inline = (js) => js.replace(/<\/script/gi, "<\\/script");
html = html.replace(MODULE, () => `<script>\n${inline(bundle)}</script>`);

// 2. the folder
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await writeFile(path.join(out, "index.html"), html);
await writeFile(path.join(out, "manifest.webmanifest"), await readFile(path.join(root, "manifest.webmanifest")));
for (const size of [180, 192, 512]) await cp(path.join(root, "assets", `icon-${size}.png`), path.join(out, "assets", `icon-${size}.png`));
for (const lib of ["maplibre-gl-6.12.0", "pannellum-2.5.7"]) await cp(path.join(root, "assets", "vendor", lib), path.join(out, "assets", "vendor", lib), { recursive: true });
for (const file of ["campus.geojson", "paths.json", "photos.json", "panoramas.json", "streetviews.json"]) {
  await cp(path.join(root, "data", "campus", file), path.join(out, "data", "campus", file));
}
// Not copied on purpose: data/<class>.json and sws/. The page carries a copy of the timetable and fetches the
// newest one (and the SWS screenshots) from GitHub, so a packaged app never gets stuck on an old copy.
await writeFile(
  path.join(out, "使用说明.txt"),
  `课表 · 计划（timetable-ling）
==========================

打开：双击 index.html（Chrome / Edge / Safari 都可以）。

- 课表、此刻、核准查看、科目：和网站一样。有网时自动读取最新的课表；没网时用文件里附带的课表（${new Date().toISOString().slice(0, 10)} 的版本）。
- 清单（每日任务、待办）和行程：点「＋ 新建」或右下角的 ＋。行程会和课一起显示在课表里。
  资料存在这台电脑的浏览器里（用同一个浏览器打开同一个文件，才会看到同一份资料）。
- 云同步：右上角齿轮 →「设置 · 同步」，登录后手机和电脑自动同步。
  要先把 Firebase 设置填进 assets/firebase-config.js 再重新生成这个文件夹（步骤见仓库里的 SYNC-SETUP.md）。
- 校园地图：直接双击打开文件时，浏览器不让地图运行；用网站或以后的 App 打开就可以。

以后打包成 APK / EXE：这个文件夹就是 App 的内容（Capacitor 的 webDir、Electron 载入的页面）。

重新生成（在仓库根目录）：npm run build:app
`,
);

// 3. a zip next to it, for downloading
await rm(path.join(dist, "timetable-ling.zip"), { force: true });
execFileSync("zip", ["-qr", "timetable-ling.zip", "timetable-ling"], { cwd: dist });
console.log(`built ${path.relative(root, out)}/ and dist/timetable-ling.zip`);
