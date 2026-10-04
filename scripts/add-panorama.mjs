// Adds a 360° photo (or a wide phone panorama) to the campus map, where it opens as a draggable view.
//   node scripts/add-panorama.mjs <photo.jpg> [--at SK3 | --at 4.5112,114.0165] [--north 123]
//        [--haov 240] [--title "..."] [--author "..."] [--license "CC BY 4.0"] [--taken 2026-10-04]
// The position and the direction of the photo's middle come from its EXIF / Photo Sphere data when the
// phone wrote them; --at and --north override (or fill in) those. The photo is copied to panoramas/
// (made at most 6144 px wide, with a flat preview of its middle, if the optional "sharp" package is
// installed) and listed in data/campus/panoramas.json.
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { readJpegMeta, panoramaAngles } from "./lib/jpeg-meta.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--"));
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
if (!file) {
  console.error("usage: node scripts/add-panorama.mjs <photo.jpg> [--at SK3|lat,lon] [--north deg] [--haov deg] [--title t] [--author a] [--license l] [--taken yyyy-mm-dd]");
  process.exit(2);
}

const LIST = path.resolve("data/campus/panoramas.json");
const DIR = path.resolve("panoramas");
const buffer = await readFile(file);
const meta = readJpegMeta(buffer);

// where: --at CODE (the building's middle), --at lat,lon, or the photo's GPS
let lat = meta.lat;
let lon = meta.lon;
const at = option("at");
if (at && /^-?\d/.test(at)) [lat, lon] = at.split(",").map(Number);
else if (at) {
  const campus = JSON.parse(await readFile(path.resolve("data/campus/campus.geojson"), "utf8"));
  const f = campus.features.find((x) => x.properties.code === at.toUpperCase());
  if (!f) throw new Error(`no building ${at} on the map`);
  [lon, lat] = f.properties.centre;
}
if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("the photo has no GPS position: add --at SK3 or --at lat,lon");

const north = option("north") != null ? Number(option("north")) : meta.gpano.heading ?? meta.direction ?? null;
if (north == null) console.warn("warning: no direction in the photo; add --north <compass heading of the photo's middle> so it faces the right way");
const angles = panoramaAngles(meta, Number(option("haov") || 180));

const list = JSON.parse(await readFile(LIST, "utf8").catch(() => '{"panoramas":[]}'));
const id = `${(option("title") || path.basename(file, path.extname(file))).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pano"}-${list.panoramas.length + 1}`;
await mkdir(DIR, { recursive: true });
const target = path.join(DIR, `${id}.jpg`);
let width = meta.width;
let thumb = null; // the middle of the view as a flat picture, for the building's sheet
try {
  const { default: sharp } = await import("sharp");
  const image = sharp(buffer, { failOn: "none" }).rotate();
  if (meta.width > 6144) image.resize({ width: 6144 });
  await image.jpeg({ quality: 82, mozjpeg: true }).withMetadata().toFile(target);
  width = Math.min(meta.width, 6144);
  const { width: w, height: h } = await sharp(buffer, { failOn: "none" }).metadata();
  const cropW = Math.round(Math.min(w, (w * 100) / angles.haov)); // about 100° of the view
  const cropH = Math.round(Math.min(h, cropW * 0.6));
  thumb = `${id}-s.jpg`;
  await sharp(buffer, { failOn: "none" })
    .extract({ left: Math.round((w - cropW) / 2), top: Math.round((h - cropH) / 2), width: cropW, height: cropH })
    .resize({ width: 800, withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toFile(path.join(DIR, thumb));
} catch {
  if (meta.width > 8192) console.warn(`warning: ${meta.width} px wide; some phones only show panoramas up to 8192 px. Install "sharp" (npm i sharp) to shrink it automatically.`);
  await copyFile(file, target);
}

const entry = {
  id,
  file: `../../panoramas/${id}.jpg`,
  ...(thumb ? { thumb: `../../panoramas/${thumb}` } : {}),
  lon: +lon.toFixed(7),
  lat: +lat.toFixed(7),
  north: north == null ? 0 : +(((north % 360) + 360) % 360).toFixed(1),
  ...(angles.haov < 360 ? { haov: +angles.haov.toFixed(1), vaov: +angles.vaov.toFixed(1), vOffset: +angles.vOffset.toFixed(1) } : {}),
  title: option("title") || "",
  author: option("author") || "",
  license: option("license") || "",
  taken: option("taken") || null,
  width,
};
list.panoramas.push(entry);
await writeFile(LIST, `${JSON.stringify(list, null, 1)}\n`);
console.log(`added ${target} at ${entry.lat},${entry.lon} facing ${entry.north}°${entry.haov ? `, ${entry.haov}° wide` : ", full 360°"}`);
