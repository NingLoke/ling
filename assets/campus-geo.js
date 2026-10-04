// Geometry and walking directions for the campus map. No DOM: used by the page and by the build script.
// Coordinates are [lon, lat] (GeoJSON order). Distances in metres.

const R = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Great-circle distance in metres. */
export function metresBetween([lon1, lat1], [lon2, lat2]) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass bearing from a to b, degrees clockwise from north (0..360). */
export function bearingDeg([lon1, lat1], [lon2, lat2]) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Local flat projection around a latitude (plenty accurate across a campus).
const kx = (lat) => (Math.PI / 180) * R * Math.cos(toRad(lat));
const KY = (Math.PI / 180) * R;

/** Closest point to p on segment a-b, as [lon, lat]. */
export function closestPointOnSegment(p, a, b) {
  const sx = kx(p[1]);
  const ax = (a[0] - p[0]) * sx;
  const ay = (a[1] - p[1]) * KY;
  const bx = (b[0] - p[0]) * sx;
  const by = (b[1] - p[1]) * KY;
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Area-weighted centroid of a closed ring. */
export function polygonCentroid(ring) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  const [ox, oy] = ring[0];
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0] - ox;
    const y1 = ring[i][1] - oy;
    const x2 = ring[i + 1][0] - ox;
    const y2 = ring[i + 1][1] - oy;
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (!area) {
    const n = ring.length;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [ox + cx / (3 * area), oy + cy / (3 * area)];
}

/** Is a point inside a ring? */
export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// The official campus map's building codes: Skylark, Prinia, Hornbill, Falcon, Heron, Kingfisher.
const BLOCKS = { SK: 3, PA: 3, HL: 2, FN: 7, HN: 4, KR: 9 };
export const CAMPUS_CODES = new Set(Object.entries(BLOCKS).flatMap(([prefix, n]) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)));

/** SWS room names without a building code in them. */
export const ROOM_ALIASES = { "Auditorium": "FN4", "Harry Perkins LT": "FN1", "Harry Perkins Lecture Theatre": "FN1" };

/**
 * Which building a SWS room is in: "SK3 102 Lecture 1" -> "SK3", "LTCL 9 (HL2-109)" -> "HL2",
 * "Auditorium" -> "FN4" (via rooms aliases). Returns null when unknown.
 */
export function buildingForRoom(room, { rooms = ROOM_ALIASES, codes = CAMPUS_CODES } = {}) {
  const text = String(room ?? "").trim();
  if (!text) return null;
  const known = (code) => (!codes || codes.has(code) ? code : null);
  const inner = /\(([A-Z]{2}\d)-\d+/.exec(text);
  if (inner && known(inner[1])) return inner[1];
  const lead = /^([A-Z]{2})\s?(\d)\b/.exec(text);
  if (lead && known(lead[1] + lead[2])) return lead[1] + lead[2];
  for (const [alias, code] of Object.entries(rooms)) {
    if (text.toLowerCase().startsWith(alias.toLowerCase())) return known(code);
  }
  return null;
}

/**
 * Smooths phone GPS fixes for someone walking: a constant-position Kalman filter (uncertainty grows by
 * q metres per second, each fix weighs in by its reported accuracy), and a fix that would mean running
 * faster than maxSpeed is ignored, unless several in a row agree (then we really moved: start over).
 *   update(lon, lat, accuracy, timeMs) -> { lon, lat, accuracy } or null when the fix was ignored
 */
export function createPositionFilter({ q = 4, maxSpeed = 8, stale = 30_000 } = {}) {
  let state = null;
  let ignored = 0;
  const start = (lon, lat, accuracy, at) => {
    state = { lon, lat, variance: accuracy * accuracy, at };
    ignored = 0;
    return { lon, lat, accuracy };
  };
  return {
    update(lon, lat, accuracy, at) {
      const acc = Math.max(1, Number.isFinite(accuracy) ? accuracy : 50);
      if (!state || at - state.at > stale) return start(lon, lat, acc, at);
      const dt = Math.max(0, (at - state.at) / 1000);
      const variance = state.variance + dt * q * q;
      const jump = metresBetween([state.lon, state.lat], [lon, lat]);
      if (jump > maxSpeed * Math.max(dt, 1) + acc + Math.sqrt(variance)) {
        if (++ignored < 3) return null;
        return start(lon, lat, acc, at);
      }
      ignored = 0;
      const k = variance / (variance + acc * acc);
      state = { lon: state.lon + k * (lon - state.lon), lat: state.lat + k * (lat - state.lat), variance: (1 - k) * variance, at };
      return { lon: state.lon, lat: state.lat, accuracy: Math.sqrt(state.variance) };
    },
    reset() {
      state = null;
      ignored = 0;
    },
  };
}

/** "about 3 min": walking at 1.25 m/s. */
export const walkMinutes = (metres) => Math.max(1, Math.round(metres / 1.25 / 60));

// ---------- routing ----------

class Heap {
  constructor() {
    this.items = [];
  }
  push(item, priority) {
    const a = this.items;
    a.push([priority, item]);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent][0] <= a[i][0]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top?.[1];
  }
  get size() {
    return this.items.length;
  }
}

/**
 * Walking router over paths.json ({ nodes: [[lon,lat]], edges: [[a, b, metres, weight]], doors: {CODE: node} }).
 *   snap(point)            nearest spot on the network: { point, edge, distance }
 *   route(from, toCode)    { coords, metres, steps } or null
 */
export function createRouter(paths) {
  const { nodes, edges, doors } = paths;
  const adjacency = nodes.map(() => []);
  edges.forEach(([a, b, metres, weight], i) => {
    adjacency[a].push([b, weight, metres, i]);
    adjacency[b].push([a, weight, metres, i]);
  });

  function snap(point) {
    let best = null;
    edges.forEach(([a, b], i) => {
      const p = closestPointOnSegment(point, nodes[a], nodes[b]);
      const d = metresBetween(point, p);
      if (!best || d < best.distance) best = { point: p, edge: i, distance: d };
    });
    return best;
  }

  function shortest(startLinks, goal) {
    // startLinks: [[node, weight, metres]] from a virtual start
    const g = new Map();
    const metresTo = new Map();
    const came = new Map();
    const heap = new Heap();
    const h = (n) => metresBetween(nodes[n], nodes[goal]);
    for (const [n, w, m] of startLinks) {
      if (!g.has(n) || w < g.get(n)) {
        g.set(n, w);
        metresTo.set(n, m);
        came.set(n, -1);
        heap.push(n, w + h(n));
      }
    }
    const done = new Set();
    while (heap.size) {
      const n = heap.pop();
      if (done.has(n)) continue;
      done.add(n);
      if (n === goal) break;
      for (const [next, w, m] of adjacency[n]) {
        const cost = g.get(n) + w;
        if (!g.has(next) || cost < g.get(next)) {
          g.set(next, cost);
          metresTo.set(next, metresTo.get(n) + m);
          came.set(next, n);
          heap.push(next, cost + h(next));
        }
      }
    }
    if (!g.has(goal)) return null;
    const order = [];
    for (let n = goal; n !== -1 && n !== undefined; n = came.get(n)) order.push(n);
    return { order: order.reverse(), metres: metresTo.get(goal) };
  }

  function route(from, toCode) {
    const goal = doors[toCode];
    if (goal == null) return null;
    const s = snap(from);
    if (!s) return null;
    const [a, b, edgeMetres, edgeWeight] = edges[s.edge];
    const factor = edgeWeight / Math.max(edgeMetres, 0.1);
    const toA = metresBetween(s.point, nodes[a]);
    const toB = metresBetween(s.point, nodes[b]);
    const found = shortest(
      [
        [a, toA * factor, toA],
        [b, toB * factor, toB],
      ],
      goal
    );
    if (!found) return null;
    const coords = [from, s.point, ...found.order.map((n) => nodes[n])].filter(
      (c, i, all) => i === 0 || metresBetween(c, all[i - 1]) > 0.5
    );
    const metres = s.distance + found.metres;
    return { coords, metres, steps: directions(coords), toCode };
  }

  return { snap, route, doors, nodes, edges };
}

/** Turn-by-turn steps for a path: [{ turn, at, metres }] where metres is the walk before that step. */
export function directions(coords) {
  const steps = [{ turn: "start", at: coords[0], metres: 0 }];
  let run = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    run += metresBetween(coords[i - 1], coords[i]);
    const inBearing = bearingDeg(coords[i - 1], coords[i]);
    const outBearing = bearingDeg(coords[i], coords[i + 1]);
    const delta = ((outBearing - inBearing + 540) % 360) - 180; // -180..180, + = right
    const nextLeg = metresBetween(coords[i], coords[i + 1]);
    if (Math.abs(delta) < 30 || (nextLeg < 4 && Math.abs(delta) < 60)) continue;
    const turn = Math.abs(delta) > 150 ? "uturn" : Math.abs(delta) > 60 ? (delta > 0 ? "right" : "left") : delta > 0 ? "slight-right" : "slight-left";
    steps.push({ turn, at: coords[i], metres: run });
    run = 0;
  }
  if (coords.length > 1) run += metresBetween(coords.at(-2), coords.at(-1));
  steps.push({ turn: "arrive", at: coords.at(-1), metres: run });
  return steps;
}

export const TURN_ZH = { start: "出发", left: "左转", right: "右转", "slight-left": "稍向左", "slight-right": "稍向右", uturn: "掉头", arrive: "到达" };

/**
 * Where the walker is along a route: { along, remaining, offRoute, distance, point, nextStep, toNext }.
 * along/remaining/distance/toNext in metres; point is the nearest spot on the route; offRoute when more
 * than `tolerance` metres from the line.
 */
export function progressOnRoute(routeResult, position, tolerance = 30) {
  const { coords, steps } = routeResult;
  let best = null;
  let walked = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const p = closestPointOnSegment(position, coords[i], coords[i + 1]);
    const d = metresBetween(position, p);
    const along = walked + metresBetween(coords[i], p);
    if (!best || d < best.distance) best = { distance: d, along, segment: i, point: p };
    walked += metresBetween(coords[i], coords[i + 1]);
  }
  const total = walked;
  let acc = 0;
  let nextStep = steps.at(-1);
  let toNext = total - best.along;
  for (const step of steps.slice(1)) {
    acc += step.metres;
    if (acc > best.along + 2) {
      nextStep = step;
      toNext = acc - best.along;
      break;
    }
  }
  return { along: best.along, remaining: Math.max(0, total - best.along), offRoute: best.distance > tolerance, distance: best.distance, point: best.point, nextStep, toNext };
}
