// Adds a photo of a campus building to the 3D campus map: it shows at the top of that building's sheet,
// and as the nearest picture for buildings that have none of their own.
//   node scripts/add-photo.mjs <photo.jpg> --code FN4 [--code FN5] [--at 4.5112,114.0165] [--heading 300]
//        [--title "..."] [--author "..."] [--license "CC BY 4.0"] [--page https://...] [--taken 2026-10-04]
// --code: the building(s) the photo shows. Without it, the photo counts for the spot it was taken at (the
// phone's GPS in the photo, or --at) looking towards --heading (or the phone's compass in the photo).
// The photo is copied to photos/ (at most 1600 px wide, plus a 640 px preview, if the optional "sharp"
// package is installed) and listed in data/campus/photos.json, where the weekly photo job keeps it.
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { readJpegMeta } from "./lib/jpeg-meta.mjs";

const args = process.argv.slice(2);
const values = (name) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] != null ? [args[i + 1]] : []));
const option = (name) => values(name)[0] ?? null;
const file = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!file) {
  console.error("usage: node scripts/add-photo.mjs <photo.jpg> [--code FN4] [--at lat,lon] [--heading deg] [--title t] [--author a] [--license l] [--page url] [--taken yyyy-mm-dd]");
  process.exit(2);
}

const LIST = path.resolve("data/campus/photos.json");
const DIR = path.resolve("photos");
const buffer = await readFile(file);
const meta = (() => {
  try {
    return readJpegMeta(buffer);
  } catch {
    return { lat: null, lon: null, direction: null }; // a PNG or WebP: no GPS to read
  }
})();
const campus = JSON.parse(await readFile(path.resolve("data/campus/campus.geojson"), "utf8"));
const codes = values("code").map((c) => c.toUpperCase());
for (const code of codes) {
  if (!campus.features.some((f) => f.properties.code === code)) throw new Error(`no building ${code} on the map`);
}
let lat = meta.lat;
let lon = meta.lon;
if (option("at")) [lat, lon] = option("at").split(",").map(Number);
if (!codes.length && !(Number.isFinite(lat) && Number.isFinite(lon))) throw new Error("say which building it shows (--code FN4) or where it was taken (--at lat,lon)");
const heading = option("heading") != null ? Number(option("heading")) : meta.direction ?? null;

const list = JSON.parse(await readFile(LIST, "utf8").catch(() => '{"meta":{},"photos":[],"aerial":[]}'));
const base = (option("title") || codes.join("-") || path.basename(file, path.extname(file))).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "photo";
let id = base;
for (let n = 2; list.photos.some((p) => p.id === id); n++) id = `${base}-${n}`;
await mkdir(DIR, { recursive: true });
const ext = path.extname(file).toLowerCase() || ".jpg";
let full = `${id}${ext}`;
let thumb = full;
try {
  const { default: sharp } = await import("sharp");
  full = `${id}.jpg`;
  thumb = `${id}-s.jpg`;
  await sharp(buffer, { failOn: "none" }).rotate().resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(DIR, full));
  await sharp(buffer, { failOn: "none" }).rotate().resize({ width: 640, withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toFile(path.join(DIR, thumb));
} catch {
  console.warn('note: copied as is; install "sharp" (npm i sharp) to make it smaller for phones');
  await copyFile(file, path.join(DIR, full));
}

const entry = {
  id,
  pinned: true,
  source: option("source") || (option("page") ? new URL(option("page")).hostname.replace(/^www\./, "") : "Curtin Malaysia students"),
  ...(codes.length ? { codes } : {}),
  lon: Number.isFinite(lon) ? +lon.toFixed(7) : null,
  lat: Number.isFinite(lat) ? +lat.toFixed(7) : null,
  heading: Number.isFinite(heading) ? +(((heading % 360) + 360) % 360).toFixed(1) : null,
  thumb: `../../photos/${thumb}`,
  full: `../../photos/${full}`,
  page: option("page") || "",
  title: option("title") || (codes.length ? `${codes.join(" · ")}` : "校园实景"),
  description: "",
  author: option("author") || "",
  license: option("license") || "",
  licenseUrl: option("license-url") || "",
  taken: option("taken") || null,
};
list.photos.unshift(entry);
await writeFile(LIST, `${JSON.stringify(list, null, 1)}\n`);
console.log(`added photos/${full}${codes.length ? ` for ${codes.join(", ")}` : ` at ${entry.lat},${entry.lon}`}`);
