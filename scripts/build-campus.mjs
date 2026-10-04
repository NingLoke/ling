// Builds the 3D campus map data from the OpenStreetMap download (data/campus/osm.json)
// and the official building codes (data/campus/codes.json):
//   data/campus/campus.geojson  buildings (code, names, height), water, green, parking, roads, campus outline
//   data/campus/paths.json      walking graph for directions: nodes, edges, building doors
//   node scripts/build-campus.mjs
// Map data © OpenStreetMap contributors, ODbL 1.0.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { metresBetween, polygonCentroid, closestPointOnSegment, pointInRing, createRouter, segmentsCross, CAMPUS_CODES, ROOM_ALIASES } from "../assets/campus-geo.js";

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
    properties: {
      kind, osm: `way/${e.id}`, highway: tags.highway ?? null, sport: tags.sport ?? null, name: tags.name ?? null,
      ...(kind === "stream" ? { culvert: tags.tunnel === "culvert" || tags.culvert === "yes" } : {}),
    },
    geometry: isArea ? { type: "Polygon", coordinates: [ring] } : { type: "LineString", coordinates: ring },
  });
}

// lakes drawn as multipolygon relations (Curtin University Lake, with its island) from their member ways
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const joinRings = (lines) => {
  const rings = [];
  const pool = lines.filter((l) => l.length > 1).map((l) => l.slice());
  while (pool.length) {
    let ring = pool.shift();
    while (!closed(ring)) {
      const end = ring.at(-1);
      const i = pool.findIndex((l) => same(l[0], end) || same(l.at(-1), end));
      if (i < 0) break;
      const next = pool.splice(i, 1)[0];
      ring = ring.concat((same(next[0], end) ? next : next.slice().reverse()).slice(1));
    }
    if (closed(ring)) rings.push(ring);
  }
  return rings;
};
for (const e of elements) {
  const tags = e.tags || {};
  if (e.type !== "relation" || tags.type !== "multipolygon" || !(tags.natural === "water" || tags.water)) continue;
  const ringsFor = (inner) => joinRings((e.members || []).filter((m) => m.type === "way" && m.geometry && (m.role === "inner") === inner).map((m) => ringOf(m)));
  const outers = ringsFor(false).filter((r) => anyNear(r, 120));
  if (!outers.length) continue;
  const inners = ringsFor(true);
  const polygons = outers.map((outer) => [outer, ...inners.filter((inner) => pointInRing(inner[0], outer))]);
  features.push({
    type: "Feature",
    properties: { kind: "water", osm: `relation/${e.id}`, highway: null, sport: null, name: tags.name ?? null },
    geometry: polygons.length === 1 ? { type: "Polygon", coordinates: polygons[0] } : { type: "MultiPolygon", coordinates: polygons },
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

// Doors: OSM has no entrances here, so each building gets up to three "doors": the corner of its outline
// nearest the network, plus corners on other sides that are almost as close to a path. Each door is joined
// to the nearest point of the network (splitting that edge). Routes end at whichever door is nearest.
const doors = {}; // code -> the main door (nearest the network)
const entrances = {}; // code -> every door
const buildings = features.filter((f) => f.properties.kind === "building" && (f.properties.code || f.properties.osmName));
const nearestEdge = (v) => {
  let best = null;
  graphEdges.forEach(([a, b], ei) => {
    const p = closestPointOnSegment(v, graphNodes[a], graphNodes[b]);
    const d = metresBetween(v, p);
    if (!best || d < best.d) best = { d, ei, p };
  });
  return best;
};
const attach = (v) => {
  const best = nearestEdge(v);
  const [a, b, , w] = graphEdges[best.ei];
  const split = graphNodes.push(best.p.map(round)) - 1;
  const door = graphNodes.push(v) - 1;
  const factor = w / Math.max(graphEdges[best.ei][2], 0.1);
  const ma = metresBetween(graphNodes[a], best.p);
  const mb = metresBetween(graphNodes[b], best.p);
  graphEdges[best.ei] = null;
  graphEdges.push([a, split, ma, ma * factor], [split, b, mb, mb * factor], [split, door, best.d, best.d * 1.1]);
  graphEdges = graphEdges.filter(Boolean);
  return door;
};
for (const f of buildings) {
  const ring = f.geometry.coordinates[0].slice(0, -1);
  const corners = ring.map((v) => ({ v, d: nearestEdge(v)?.d ?? Infinity })).sort((x, y) => x.d - y.d);
  if (!corners.length || corners[0].d > 120) continue;
  const chosen = [corners[0]];
  for (const c of corners.slice(1)) {
    if (chosen.length >= 3) break;
    if (c.d > Math.max(20, corners[0].d + 10)) break;
    if (chosen.every((x) => metresBetween(x.v, c.v) >= 25)) chosen.push(c);
  }
  const key = f.properties.code || f.properties.osm;
  entrances[key] = chosen.map((c) => attach(c.v));
  doors[key] = entrances[key][0];
}

// Open ground: OSM maps roads and a few footpaths but not the covered walkways and plazas between
// the academic buildings, so routes between neighbours went round the block. Where walking straight
// is plausible (short, not through another building or water) and the mapped route is a big detour,
// add a direct link, a little more "expensive" so real paths still win when they are close.
// Links join doors to doors and paths, and paths to paths: the router never walks *through* another
// building's door (a corner of its outline), so the shortcuts between paths must exist on their own.
const blockers = features
  .filter((f) => ["building", "water"].includes(f.properties.kind))
  .flatMap((f) => (f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.map((polygon) => polygon[0]) : [f.geometry.coordinates[0]]));
// drains and streams with no bridge cannot be walked across either (culverts under a path can)
const waterLines = features.filter((f) => f.properties.kind === "stream" && !f.properties.culvert).map((f) => f.geometry.coordinates);
const clear = (p, q) => {
  const len = metresBetween(p, q);
  const n = Math.ceil(len / 0.5); // fine enough not to step over a thin strip of water
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (t * len < 1.5 || (1 - t) * len < 1.5) continue; // doors sit on their own outline
    const s = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    if (blockers.some((ring) => pointInRing(s, ring))) return false;
  }
  return !waterLines.some((line) => line.some((c, i) => i > 0 && segmentsCross(p, q, line[i - 1], c)));
};
let shortcuts = 0;
{
  const doorNodes = Object.values(entrances).flat();
  const detour = (from, to) => {
    const r = createRouter({ nodes: graphNodes, edges: graphEdges, doors: { _: to } }).route(graphNodes[from], "_");
    return r ? r.metres : Infinity;
  };
  const isDoor = new Set(doorNodes);
  const candidates = [];
  for (let a = 0; a < graphNodes.length; a++) {
    for (let b = a + 1; b < graphNodes.length; b++) {
      const doorsAtEnds = isDoor.has(a) + isDoor.has(b);
      const d = metresBetween(graphNodes[a], graphNodes[b]);
      if (d < 3 || d > (doorsAtEnds ? 70 : 60)) continue;
      candidates.push([a, b, d]);
    }
  }
  candidates.sort((x, y) => x[2] - y[2]);
  for (const [a, b, d] of candidates) {
    if (detour(a, b) <= d * 1.6 + 10) continue;
    if (!clear(graphNodes[a], graphNodes[b])) continue;
    graphEdges.push([a, b, d, d * 1.25, 1]); // 1 marks an open-ground link
    shortcuts++;
  }
}

graphEdges = graphEdges.map(([a, b, m, w, link]) => [a, b, Math.round(m * 10) / 10, Math.round(w * 10) / 10, ...(link ? [1] : [])]);

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
await writeFile(path.join(DIR, "paths.json"), `${JSON.stringify({ meta: { attribution: meta.attribution }, nodes: graphNodes, edges: graphEdges, doors, entrances })}\n`);

const count = (k) => features.filter((f) => f.properties.kind === k).length;
console.log(`buildings ${count("building")} (coded ${features.filter((f) => f.properties.code).length}), roofs ${count("roof")}, water ${count("water")}, green ${count("green")}, parking ${count("parking")}, ways ${count("way")}`);
console.log(`graph: ${graphNodes.length} nodes, ${graphEdges.length} edges, ${bridges} gaps bridged, ${shortcuts} open-ground links, ${Object.keys(doors).length} buildings with ${Object.values(entrances).flat().length} doors; dropped ${nodes.length - main.size} nodes outside the main network`);
const noDoor = features.filter((f) => f.properties.code && doors[f.properties.code] == null).map((f) => f.properties.code);
if (noDoor.length) console.log(`::warning::no door for ${noDoor.join(", ")}`);
