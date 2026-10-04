// Downloads the Curtin Malaysia (Miri) campus from OpenStreetMap for the 3D campus map:
// buildings (with heights/levels/names), footways and roads, water, landuse, entrances.
//   node scripts/fetch-campus-osm.mjs
// Writes data/campus/osm.json (raw Overpass result) and data/campus/summary.json (what was found).
// Map data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve("data/campus");
const CENTER = { lat: 4.5117, lon: 114.0167 }; // Wikipedia: Curtin University Malaysia
const RADIUS = 1400; // metres around the centre (the campus plus its lake and roads)
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const UA = "ling-timetable-campus-map/1.0 (https://github.com/NingLoke/ling)";

const around = `around:${RADIUS},${CENTER.lat},${CENTER.lon}`;
const QUERY = `
[out:json][timeout:180];
(
  nwr["amenity"="university"](${around});
  nwr["name"~"Curtin",i](${around});
)->.uni;
(
  way["building"](${around});
  relation["building"](${around});
  way["building:part"](${around});
  way["highway"](${around});
  way["footway"](${around});
  way["natural"~"water|wood|scrub|grassland"](${around});
  relation["natural"="water"](${around});
  way["water"](${around});
  way["waterway"](${around});
  way["leisure"](${around});
  way["landuse"](${around});
  way["amenity"](${around});
  node["amenity"](${around});
  node["entrance"](${around});
  node["name"](${around});
  way["indoor"](${around});
  way["area:highway"](${around});
);
out body geom;
.uni out body geom;
`;

async function overpass(query) {
  let lastError;
  for (const url of ENDPOINTS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
          body: new URLSearchParams({ data: query }),
        });
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        const json = await response.json();
        console.log(`${url}: ${json.elements?.length ?? 0} elements`);
        return json;
      } catch (error) {
        lastError = error;
        console.log(`::warning::${error.message} (attempt ${attempt})`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
  throw lastError;
}

async function nominatim() {
  try {
    const url = "https://nominatim.openstreetmap.org/search?q=Curtin+University+Malaysia+Miri&format=jsonv2&polygon_geojson=1&limit=5";
    const response = await fetch(url, { headers: { "user-agent": UA } });
    return response.ok ? await response.json() : { error: `HTTP ${response.status}` };
  } catch (error) {
    return { error: error.message };
  }
}

const data = await overpass(QUERY);
const search = await nominatim();
const elements = data.elements || [];
const tagged = (key) => elements.filter((e) => e.tags && e.tags[key] !== undefined);
const named = elements.filter((e) => e.tags?.name).map((e) => ({ type: e.type, id: e.id, name: e.tags.name, kind: e.tags.building ? "building" : e.tags.highway ? `highway=${e.tags.highway}` : e.tags.amenity ? `amenity=${e.tags.amenity}` : Object.keys(e.tags).find((k) => k !== "name") }));
const summary = {
  fetchedAt: new Date().toISOString(),
  center: CENTER,
  radius: RADIUS,
  counts: {
    elements: elements.length,
    buildings: tagged("building").length,
    buildingsWithHeight: elements.filter((e) => e.tags && (e.tags.height || e.tags["building:levels"])).length,
    highways: tagged("highway").length,
    footways: elements.filter((e) => ["footway", "path", "pedestrian", "steps", "corridor"].includes(e.tags?.highway)).length,
    water: elements.filter((e) => e.tags?.natural === "water" || e.tags?.water || e.tags?.waterway).length,
    entrances: tagged("entrance").length,
  },
  university: elements.filter((e) => e.tags?.amenity === "university").map((e) => ({ type: e.type, id: e.id, name: e.tags.name, bounds: e.bounds })),
  named,
  nominatim: Array.isArray(search) ? search.map((r) => ({ name: r.display_name, osm: `${r.osm_type}/${r.osm_id}`, lat: r.lat, lon: r.lon, bbox: r.boundingbox, class: r.class, type: r.type })) : search,
};

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "osm.json"), `${JSON.stringify({ attribution: "© OpenStreetMap contributors, ODbL 1.0", ...data, elements })}\n`);
await writeFile(path.join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary.counts));
console.log(`named features: ${named.length}`);
for (const n of named.slice(0, 80)) console.log(`  ${n.kind}: ${n.name}`);
