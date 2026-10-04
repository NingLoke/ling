// Builds the 3D campus map data from the OpenStreetMap download (data/campus/osm.json)
// and the official building codes (data/campus/codes.json):
//   data/campus/campus.geojson  buildings (code, names, height), water, green, parking, roads, campus outline
//   data/campus/paths.json      walking graph for directions: nodes, edges, building doors
//   node scripts/build-campus.mjs
// Map data © OpenStreetMap contributors, ODbL 1.0.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { metresBetween, polygonCentroid, closestPointOnSegment, pointInRing, createRouter, CAMPUS_CODES, ROOM_ALIASES } from "../assets/campus-geo.js";

const DIR = path.resolve("data/campus");
const osm = JSON.parse(await readFile(path.join(DIR, "osm.json"), "utf8"));
const codes = JSON.parse(await readFile(path.join(DIR, "codes.json"), "utf8"));

const round = (n) => Math.round(n * 1e7) / 1e7;
const unique = new Map();
for (const e of osm.elements) unique.set(`${e.type}/${e.id}`, e);
const elements = [...unique.values()];
const ringOf = (e) => (e.geometry || []).map((p) => [round(p.lon), round(p.lat)]);
const closed = (ring) => ring.length > 3 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1];

// ---------- campus outline and the area we keep ----------
const uni = elements.find((e) => e.tags?.amenity === "university" && /curtin/i.test(e.tags.name || ""));
if (!uni) throw new Error("Curtin University Malaysia outline not found in osm.json");
const outline = ringOf(uni);
const inPolygon = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const distToRing = (p, ring) => {
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) best = Math.min(best, metresBetween(p, closestPointOnSegment(p, ring[i], ring[i + 1])));
  return best;
};
// "near campus": inside the outline or within `margin` metres of it
const nearCampus = (p, margin) => inPolygon(p, outline) || distToRing(p, outline) <= margin;
const anyNear = (ring, margin) => ring.some((p) => nearCampus(p, margin));

// ---------- buildings ----------
const listed = Object.keys(codes).filter((k) => !k.startsWith("_"));
if (listed.length !== CAMPUS_CODES.size || listed.some((k) => !CAMPUS_CODES.has(k))) throw new Error("codes.json and CAMPUS_CODES in assets/campus-geo.js disagree");
const byOsm = new Map(Object.entries(codes).filter(([k]) => !k.startsWith("_")).map(([code, info]) => [info.osm, { code, ...info }]));
const levelsOf = (tags) => {
  const n = parseFloat(tags["building:levels"]);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const features = [];
features.push({ type: "Feature", properties: { kind: "campus", name: uni.tags.name }, geometry: { type: "Polygon", coordinates: [outline] } });

for (const e of elements) {
  const tags = e.tags || {};
  if (!tags.building || e.type !== "way") continue;
  const ring = ringOf(e);
  if (!closed(ring)) continue;
  const centre = polygonCentroid(ring);
  const coded = byOsm.get(`way/${e.id}`);
  if (!coded && !nearCampus(centre, 25)) continue;
  const roof = tags.building === "roof"; // covered walkways / canopies: a thin slab overhead
  const levels = coded?.levels ?? levelsOf(tags) ?? (roof ? 1 : 2);
  const height = roof ? 3.4 : Math.max(4, levels * 3.6 + 0.6);
  features.push({
    type: "Feature",
    id: e.id,
    properties: {
      kind: roof ? "roof" : "building",
      osm: `way/${e.id}`,
      code: coded?.code ?? null,
      name: coded?.name ?? null,
      osmName: tags.name ?? null,
      zh: coded?.zh || null,
      levels,
      height: Math.round(height * 10) / 10,
      base: roof ? 2.8 : 0,
      centre,
    },
    geometry: { type: "Polygon", coordinates: [ring] },
  });
}
// buildings missing from OSM, drawn from the official map (ids above any OSM way id)
let syntheticId = 9_000_000_000;
for (const [code, info] of Object.entries(codes)) {
  if (code.startsWith("_") || info.osm || !info.polygon) continue;
  const levels = info.levels ?? 2;
  features.push({
    type: "Feature",
    id: syntheticId++,
    properties: { kind: "building", osm: null, code, name: info.name, osmName: null, zh: info.zh || null, levels, height: levels * 3.6 + 0.6, base: 0, centre: polygonCentroid(info.polygon) },
    geometry: { type: "Polygon", coordinates: [info.polygon] },
  });
}
const missing = [...byOsm.keys()].filter((id) => !features.some((f) => f.properties.osm === id));
if (missing.length) throw new Error(`coded buildings missing from osm.json: ${missing.join(", ")}`);

// ---------- water, green, parking, roads ----------
for (const e of elements) {
  const tags = e.tags || {};
  if (e.type !== "way" || tags.building) continue;
  const ring = ringOf(e);
  if (ring.length < 2 || !anyNear(ring, 120)) continue;
  let kind = null;
  if (tags.natural === "water" || tags.water) kind = "water";
  else if (tags.leisure === "pitch" || tags.landuse === "recreation_ground" || tags.leisure === "park" || tags.landuse === "grass" || tags.natural === "grassland") kind = "green";
  else if (tags.amenity === "parking") kind = "parking";
  else if (tags.highway) kind = "way";
  else if (tags.waterway) kind = "stream";
  if (!kind) continue;
  const isArea = kind !== "way" && kind !== "stream" && closed(ring);
  if ((kind === "water" || kind === "green" || kind === "parking") && !isArea) continue;
  features.push({
    type: "Feature",
    properties: { kind, osm: `way/${e.id}`, highway: tags.highway ?? null, sport: tags.sport ?? null, name: tags.name ?? null },
    geometry: isArea ? { type: "Polygon", coordinates: [ring] } : { type: "LineString", coordinates: ring },
  });
}

// ---------- walking graph ----------
const WALK = { footway: 1, path: 1, pedestrian: 1, steps: 1.15, corridor: 1, cycleway: 1.05, living_street: 1.1, service: 1.15, unclassified: 1.2, residential: 1.2, tertiary: 1.3, secondary: 1.35, primary: 1.4, track: 1.2 };
const nodes = []; // [lon, lat]
const nodeIndex = new Map(); // osm node id -> index
const edges = []; // [a, b, metres, weight]
const addNode = (key, coord) => {
  if (key != null && nodeIndex.has(key)) return nodeIndex.get(key);
  nodes.push(coord);
  if (key != null) nodeIndex.set(key, nodes.length - 1);
  return nodes.length - 1;
};
const edgeSeen = new Set();
const addEdge = (a, b, factor) => {
  if (a === b) return;
  const k = a < b ? `${a}-${b}` : `${b}-${a}`;
  if (edgeSeen.has(k)) return;
  edgeSeen.add(k);
  const m = metresBetween(nodes[a], nodes[b]);
  edges.push([a, b, Math.round(m * 10) / 10, Math.round(m * factor * 10) / 10]);
};
for (const e of elements) {
  const hw = e.tags?.highway;
  if (e.type !== "way" || !WALK[hw] || e.tags.access === "private" || e.tags.foot === "no") continue;
  const ring = ringOf(e);
  if (!anyNear(ring, 250)) continue;
  for (let i = 0; i < ring.length; i++) {
    const idx = addNode(e.nodes?.[i] ?? `${ring[i][0]},${ring[i][1]}`, ring[i]);
    if (i) addEdge(nodeIndex.get(e.nodes?.[i - 1] ?? `${ring[i - 1][0]},${ring[i - 1][1]}`), idx, WALK[hw]);
  }
}

// Join path pieces OSM left a few metres apart, so every building can be reached.
function components() {
  const parent = nodes.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [a, b] of edges) parent[find(a)] = find(b);
  const groups = new Map();
  nodes.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  });
  return [...groups.values()].sort((x, y) => y.length - x.length);
}
let bridges = 0;
for (let round = 0; round < 50; round++) {
  const groups = components();
  if (groups.length === 1) break;
  const main = new Set(groups[0]);
  let joined = false;
  for (const group of groups.slice(1)) {
    let best = null;
    for (const i of group) for (const j of main) {
      const d = metresBetween(nodes[i], nodes[j]);
      if (!best || d < best.d) best = { i, j, d };
    }
    if (best && best.d <= 40) {
      addEdge(best.i, best.j, 1.3);
      bridges++;
      joined = true;
      break;
    }
  }
  if (!joined) break;
}
// keep only the main connected network
const main = new Set(components()[0]);
const keep = new Map();
const graphNodes = [];
nodes.forEach((n, i) => {
  if (main.has(i)) {
    keep.set(i, graphNodes.length);
    graphNodes.push(n);
  }
});
let graphEdges = edges.filter(([a, b]) => keep.has(a) && keep.has(b)).map(([a, b, m, w]) => [keep.get(a), keep.get(b), m, w]);

// Doors: connect each building to the nearest point of the network (splitting that edge).
const doors = {};
const buildings = features.filter((f) => f.properties.kind === "building" && (f.properties.code || f.properties.osmName));
for (const f of buildings) {
  const ring = f.geometry.coordinates[0];
  let best = null;
  graphEdges.forEach(([a, b], ei) => {
    for (const v of ring) {
      const p = closestPointOnSegment(v, graphNodes[a], graphNodes[b]);
      const d = metresBetween(v, p);
      if (!best || d < best.d) best = { d, ei, p, v };
    }
  });
  if (!best || best.d > 120) continue;
  const [a, b, , w] = graphEdges[best.ei];
  const split = graphNodes.push(best.p.map(round)) - 1;
  const door = graphNodes.push(best.v) - 1;
  const factor = w / Math.max(graphEdges[best.ei][2], 0.1);
  const ma = metresBetween(graphNodes[a], best.p);
  const mb = metresBetween(graphNodes[b], best.p);
  graphEdges[best.ei] = null;
  graphEdges.push([a, split, ma, ma * factor], [split, b, mb, mb * factor], [split, door, best.d, best.d * 1.1]);
  graphEdges = graphEdges.filter(Boolean);
  doors[f.properties.code || f.properties.osm] = door;
}

// Open ground: OSM maps roads and a few footpaths but not the covered walkways and plazas between
// the academic buildings, so routes between neighbours went round the block. Where walking straight
// is plausible (short, not through another building or water) and the mapped route is a big detour,
// add a direct link, a little more "expensive" so real paths still win when they are close.
const blockers = features
  .filter((f) => ["building", "water"].includes(f.properties.kind))
  .map((f) => f.geometry.coordinates[0]);
const clear = (p, q) => {
  const len = metresBetween(p, q);
  const n = Math.ceil(len / 2);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (t * len < 1.5 || (1 - t) * len < 1.5) continue; // doors sit on their own outline
    const s = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    if (blockers.some((ring) => pointInRing(s, ring))) return false;
  }
  return true;
};
let shortcuts = 0;
{
  const doorNodes = Object.values(doors);
  const detour = (from, to) => {
    const r = createRouter({ nodes: graphNodes, edges: graphEdges, doors: { _: to } }).route(graphNodes[from], "_");
    return r ? r.metres : Infinity;
  };
  const candidates = [];
  for (const a of doorNodes) {
    for (let b = 0; b < graphNodes.length; b++) {
      if (a === b) continue;
      const isDoor = doorNodes.includes(b);
      const d = metresBetween(graphNodes[a], graphNodes[b]);
      if (d > (isDoor ? 70 : 40) || d < 3) continue;
      if (isDoor && b < a) continue;
      candidates.push([a, b, d]);
    }
  }
  candidates.sort((x, y) => x[2] - y[2]);
  for (const [a, b, d] of candidates) {
    if (detour(a, b) <= d * 1.6 + 10) continue;
    if (!clear(graphNodes[a], graphNodes[b])) continue;
    graphEdges.push([a, b, d, d * 1.25]);
    shortcuts++;
  }
}

graphEdges = graphEdges.map(([a, b, m, w]) => [a, b, Math.round(m * 10) / 10, Math.round(w * 10) / 10]);

const lons = graphNodes.map((n) => n[0]).concat(outline.map((p) => p[0]));
const lats = graphNodes.map((n) => n[1]).concat(outline.map((p) => p[1]));
const meta = {
  attribution: "© OpenStreetMap contributors",
  licence: "ODbL 1.0",
  source: osm.osm3s?.timestamp_osm_base ?? null,
  centre: polygonCentroid(outline),
  bounds: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
  rooms: ROOM_ALIASES,
};
await writeFile(path.join(DIR, "campus.geojson"), `${JSON.stringify({ type: "FeatureCollection", meta, features })}\n`);
await writeFile(path.join(DIR, "paths.json"), `${JSON.stringify({ meta: { attribution: meta.attribution }, nodes: graphNodes, edges: graphEdges, doors })}\n`);

const count = (k) => features.filter((f) => f.properties.kind === k).length;
console.log(`buildings ${count("building")} (coded ${features.filter((f) => f.properties.code).length}), roofs ${count("roof")}, water ${count("water")}, green ${count("green")}, parking ${count("parking")}, ways ${count("way")}`);
console.log(`graph: ${graphNodes.length} nodes, ${graphEdges.length} edges, ${bridges} gaps bridged, ${shortcuts} open-ground links, ${Object.keys(doors).length} doors; dropped ${nodes.length - main.size} nodes outside the main network`);
const noDoor = features.filter((f) => f.properties.code && doors[f.properties.code] == null).map((f) => f.properties.code);
if (noDoor.length) console.log(`::warning::no door for ${noDoor.join(", ")}`);
