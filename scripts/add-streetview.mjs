// Adds a Google Maps 360° view (Street View or an uploaded photo sphere) to the campus map, where the
// building's 街景 button then opens it inside the site.
//   node scripts/add-streetview.mjs '<address of the view in Google Maps, or its "Embed a map" iframe code>' [--title "..."] [--at SK3]
// The view is listed in data/campus/streetviews.json next to the nearest building (or the one given).
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseStreetView } from "../assets/streetview-url.js";
import { metresBetween } from "../assets/campus-geo.js";

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const input = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? (await readFile(0, "utf8").catch(() => ""));
const view = parseStreetView(input);
if (!view) {
  console.error("That is not a Google Maps 360° view: copy the address bar while looking at it, or Share → Embed a map → COPY HTML.");
  process.exit(2);
}
const LIST = path.resolve("data/campus/streetviews.json");
const campus = JSON.parse(await readFile(path.resolve("data/campus/campus.geojson"), "utf8"));
const coded = campus.features.filter((f) => f.properties.code);
const near = option("at")
  ? coded.find((f) => f.properties.code === option("at").toUpperCase())
  : coded.map((f) => ({ f, d: metresBetween([view.lon, view.lat], f.properties.centre) })).sort((a, b) => a.d - b.d)[0]?.f;
if (metresBetween([view.lon, view.lat], [114.0167, 4.5117]) > 3000) throw new Error("this view is not on the Curtin Malaysia campus");
const list = JSON.parse(await readFile(LIST, "utf8").catch(() => '{"views":[]}'));
if (list.views.some((v) => v.pano === view.pano)) {
  console.log("already listed");
  process.exit(0);
}
const entry = {
  id: `${near?.properties.code?.toLowerCase() || "view"}-${list.views.length + 1}`,
  pano: view.pano,
  lon: +view.lon.toFixed(7),
  lat: +view.lat.toFixed(7),
  heading: +(((view.heading % 360) + 360) % 360).toFixed(1),
  near: near?.properties.code ?? null,
  title: option("title") || (near ? `${near.properties.code} ${near.properties.zh || near.properties.name || ""}`.trim() : "360° 实景"),
};
list.views.push(entry);
await writeFile(LIST, `${JSON.stringify(list, null, 1)}\n`);
console.log(`added ${entry.id} at ${entry.lat},${entry.lon} (near ${entry.near ?? "no building"})`);
