// Tests for the campus map data and walking directions (assets/campus-geo.js + data/campus/*).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  metresBetween, bearingDeg, closestPointOnSegment, polygonCentroid, pointInRing, buildingForRoom, roomLabel,
  createRouter, directions, progressOnRoute, walkMinutes, CAMPUS_CODES, createPositionFilter, segmentsCross,
} from "../../assets/campus-geo.js";

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const campus = json("../../data/campus/campus.geojson");
const paths = json("../../data/campus/paths.json");
const codes = new Set(campus.features.filter((f) => f.properties.code).map((f) => f.properties.code));
const rooms = campus.meta.rooms;
const router = createRouter(paths);
const building = (code) => campus.features.find((f) => f.properties.code === code);

test("geometry helpers", () => {
  // one degree on the mean-radius sphere is ~111.2 km
  assert.ok(Math.abs(metresBetween([114, 4.5], [114, 5.5]) - 111_195) < 50);
  assert.ok(Math.abs(bearingDeg([114, 4.5], [114, 4.6]) - 0) < 0.01);
  assert.ok(Math.abs(bearingDeg([114, 4.5], [114.1, 4.5]) - 90) < 0.1);
  assert.deepEqual(closestPointOnSegment([114.0005, 4.5005], [114, 4.5], [114.001, 4.5]).map((n) => +n.toFixed(6)), [114.0005, 4.5]);
  const square = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
  assert.deepEqual(polygonCentroid(square), [1, 1]);
  assert.equal(pointInRing([1, 1], square), true);
  assert.equal(pointInRing([3, 1], square), false);
  assert.equal(walkMinutes(10), 1);
  assert.equal(walkMinutes(450), 6);
});

test("every room in both timetables maps to a building on the map", () => {
  for (const cls of ["2E3", "3E4"]) {
    const data = json(`../../data/${cls}.json`);
    for (const e of data.events) {
      for (const room of e.rooms) {
        const code = buildingForRoom(room, { rooms, codes });
        assert.ok(code, `${cls}: no building for "${room}"`);
        assert.ok(codes.has(code), `${cls}: ${room} -> ${code} not on the map`);
      }
    }
  }
  assert.equal(buildingForRoom("SK3 102 Lecture 1", { rooms, codes }), "SK3");
  assert.equal(buildingForRoom("LTCL 9 (HL2-109)", { rooms, codes }), "HN2"); // SWS says HL2, the room is in Heron 2
  assert.equal(buildingForRoom("LTBS LT II (HL2-111)", { rooms, codes }), "HN2");
  assert.equal(buildingForRoom("Auditorium", { rooms, codes }), "FN4");
  assert.equal(buildingForRoom("Harry Perkins LT", { rooms, codes }), "FN1");
  assert.equal(buildingForRoom("PA2 103 (Computer Lab)", { rooms, codes }), "PA2");
  assert.equal(buildingForRoom("Somewhere else", { rooms, codes }), null);
  // the page uses the built-in aliases and codes, without loading the map data
  assert.equal(buildingForRoom("Auditorium"), "FN4");
  assert.equal(buildingForRoom("SK3 102 Lecture 1"), "SK3");
  assert.equal(buildingForRoom("ZZ9 101"), null);
  assert.equal(buildingForRoom("LTCL 9"), "HN2"); // sometimes written without the bracketed room code
  assert.equal(buildingForRoom(""), null);
});

test("the built-in building codes match the map data", () => {
  const listed = Object.keys(json("../../data/campus/codes.json")).filter((k) => !k.startsWith("_"));
  assert.deepEqual([...CAMPUS_CODES].sort(), listed.sort());
  assert.deepEqual([...CAMPUS_CODES].sort(), [...codes].sort());
});

test("all 28 official buildings are on the map with a door on the walking network", () => {
  const expected = ["SK1", "SK2", "SK3", "PA1", "PA2", "PA3", "HL1", "HL2", ...[1, 2, 3, 4, 5, 6, 7].map((n) => `FN${n}`), "HN1", "HN2", "HN3", "HN4", ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `KR${n}`)];
  for (const code of expected) {
    const f = building(code);
    assert.ok(f, `${code} missing`);
    assert.ok(f.properties.height >= 3, `${code} has a height`);
    assert.ok(paths.doors[code] != null, `${code} has no door`);
    assert.ok(paths.entrances[code].includes(paths.doors[code]) && paths.entrances[code].length <= 3);
    // every door sits on (or right next to) the building outline
    const ring = f.geometry.coordinates[0];
    for (const n of paths.entrances[code]) {
      const door = paths.nodes[n];
      const toOutline = Math.min(...ring.slice(0, -1).map((p, i) => metresBetween(door, closestPointOnSegment(door, p, ring[i + 1]))));
      assert.ok(toOutline < 1, `${code} door ${toOutline.toFixed(1)} m from its outline`);
    }
  }
});

test("walking routes exist between every pair of teaching buildings and are sensible", () => {
  const teaching = ["SK1", "SK2", "SK3", "PA1", "PA2", "PA3", "HL1", "HL2", "FN1", "FN4", "HN2"];
  for (const from of teaching) {
    const start = paths.nodes[paths.doors[from]];
    for (const to of teaching) {
      if (from === to) continue;
      const r = router.route(start, to);
      assert.ok(r, `no route ${from} -> ${to}`);
      const straight = metresBetween(start, r.coords.at(-1));
      assert.ok(r.metres >= straight - 1, `${from}->${to} shorter than a straight line`);
      assert.ok(r.metres < straight * 4 + 150, `${from}->${to} detour too long: ${Math.round(r.metres)} m vs ${Math.round(straight)} m`);
      assert.ok(r.metres < 1500, `${from}->${to} ${Math.round(r.metres)} m`);
      assert.equal(r.steps[0].turn, "start");
      assert.equal(r.steps.at(-1).turn, "arrive");
      const summed = r.steps.reduce((s, x) => s + x.metres, 0);
      assert.ok(Math.abs(summed - r.metres) < 3, `${from}->${to} step lengths add up`);
    }
  }
});

test("a route from the student village to the library starts at the walker and ends at the door", () => {
  const near = [paths.nodes[paths.doors.KR4][0] + 0.00012, paths.nodes[paths.doors.KR4][1] + 0.00008];
  const r = router.route(near, "FN4");
  assert.ok(r);
  assert.deepEqual(r.coords[0], near);
  assert.ok(paths.entrances.FN4.some((n) => paths.nodes[n].join() === r.coords.at(-1).join()), "ends at one of FN4's doors");
  const halfway = r.coords[Math.floor(r.coords.length / 2)];
  const p = progressOnRoute(r, halfway);
  assert.equal(p.offRoute, false);
  assert.ok(p.remaining > 0 && p.remaining < r.metres);
  assert.ok(Math.abs(p.along + p.remaining - r.metres) < 3);
  const far = progressOnRoute(r, [near[0] + 0.002, near[1]]);
  assert.equal(far.offRoute, true);
});

test("directions turn left and right at corners", () => {
  // north 100 m, then east 100 m (right turn), then north again (left turn)
  const a = [114, 4.5];
  const b = [114, 4.5009];
  const c = [114.0009, 4.5009];
  const d = [114.0009, 4.5018];
  const steps = directions([a, b, c, d]);
  assert.deepEqual(steps.map((s) => s.turn), ["start", "right", "left", "arrive"]);
  assert.ok(Math.abs(steps[1].metres - 100) < 2);
});

test("GPS smoothing follows a walker, damps jitter and ignores one-off jumps", () => {
  const f = createPositionFilter();
  const metresEast = (m) => 114 + m / (111_195 * Math.cos((4.5 * Math.PI) / 180));
  const first = f.update(114, 4.5, 8, 0);
  assert.deepEqual([first.lon, first.lat, first.accuracy], [114, 4.5, 8]);
  // a 6 m wobble one second later moves the dot only part of the way
  const wobble = f.update(metresEast(6), 4.5, 8, 1000);
  const moved = metresBetween([114, 4.5], [wobble.lon, wobble.lat]);
  assert.ok(moved > 0.5 && moved < 4, `moved ${moved.toFixed(1)} m`);
  // walking east at 1.3 m/s for a minute: the smoothed dot keeps up (no long lag)
  let out = wobble;
  for (let s = 2; s <= 60; s++) out = f.update(metresEast(1.3 * s), 4.5, 8, s * 1000) || out;
  const lag = metresBetween([metresEast(1.3 * 60), 4.5], [out.lon, out.lat]);
  assert.ok(lag < 8, `lags ${lag.toFixed(1)} m behind`);
  // a 500 m jump is ignored twice, then accepted when it keeps coming (we really are there)
  const far = metresEast(1.3 * 60 + 500);
  assert.equal(f.update(far, 4.5, 8, 61_000), null);
  assert.equal(f.update(far, 4.5, 8, 62_000), null);
  const accepted = f.update(far, 4.5, 8, 63_000);
  assert.ok(accepted && Math.abs(accepted.lon - far) < 1e-9);
  // after a long gap (phone asleep) the next fix is taken as is
  const later = f.update(114, 4.5, 20, 200_000);
  assert.deepEqual([later.lon, later.lat], [114, 4.5]);
});

test("route progress gives the nearest point on the route", () => {
  const r = { coords: [[114, 4.5], [114, 4.5009]], steps: directions([[114, 4.5], [114, 4.5009]]) };
  const p = progressOnRoute(r, [114.00005, 4.5004], 20);
  assert.ok(Math.abs(p.point[0] - 114) < 1e-9 && Math.abs(p.point[1] - 4.5004) < 1e-6);
  assert.ok(p.distance > 5 && p.distance < 6);
  assert.equal(p.offRoute, false);
});

test("a gentle bend is announced at a fork where another way goes straighter on", () => {
  // walking east, the path bends 20° left at a junction where another way carries straight on
  const a = [114, 4.5];
  const b = [114.0005, 4.5];
  const c = [114.0005 + 0.0005 * Math.cos((20 * Math.PI) / 180), 4.5 + 0.0005 * Math.sin((20 * Math.PI) / 180)];
  const plain = directions([a, b, c]);
  assert.deepEqual(plain.map((s) => s.turn), ["start", "arrive"]); // no junction: nothing to say
  const fork = directions([a, b, c], [null, [90], null]); // another way leaves at bearing 90 (straight east)
  assert.deepEqual(fork.map((s) => s.turn), ["start", "slight-left", "arrive"]);
});

test("a small jog is not two turns, and two quick turns the same way are one", () => {
  const m = (east, north) => [114 + east / 110_850, 4.5 + north / 110_574];
  // a 4 m sideways jog between two junctions: on its own each corner would be a slight turn
  // (slight-left, then slight-right 6 m later); together they cancel out
  const jog = directions([m(0, 0), m(40, 0), m(42, 4), m(44, 4), m(90, 4)], [null, [0], null, [180], null]);
  assert.deepEqual(jog.map((s) => s.turn), ["start", "arrive"]);
  assert.ok(Math.abs(jog.at(-1).metres - (40 + Math.hypot(2, 4) + 2 + 46)) < 1);
  // round a corner: right, 6 m, right again -> a single right turn, not a U-turn
  const corner = directions([m(0, 0), m(0, 40), m(6, 40), m(6, 0)]);
  assert.deepEqual(corner.map((s) => s.turn), ["start", "right", "arrive"]);
});

test("progress stays near where the walker was when the route passes close to itself", () => {
  const m = (east, north) => [114 + east / 110_850, 4.5 + north / 110_574];
  // out 100 m east, 8 m north, back 100 m west: the way back runs 8 m from the way out
  const coords = [m(0, 0), m(100, 0), m(100, 8), m(0, 8)];
  const r = { coords, steps: directions(coords) };
  const walker = m(30, 5); // on the way out, but GPS puts them 5 m north (nearer the way back)
  assert.ok(progressOnRoute(r, walker, 20).along > 150); // no history: snaps to the way back
  const p = progressOnRoute(r, walker, 20, 25);
  assert.ok(p.along > 25 && p.along < 40, `along ${p.along}`);
});

test("routes do not turn at another building's door, and coded routes rarely double back", () => {
  let uturns = 0;
  let turns = 0;
  let pairs = 0;
  const doorNodes = new Map(Object.entries(paths.doors).map(([code, n]) => [paths.nodes[n].join(","), code]));
  for (const a of CAMPUS_CODES) {
    for (const b of CAMPUS_CODES) {
      if (a === b) continue;
      const r = router.route(paths.nodes[paths.doors[a]], b);
      pairs++;
      turns += r.steps.length - 2;
      if (r.steps.some((s) => s.turn === "uturn")) uturns++;
      // walking past another building's door corner is fine; turning sharply there is not
      for (let i = 1; i < r.coords.length - 1; i++) {
        const door = doorNodes.get(r.coords[i].join(","));
        if (!door || door === a || door === b) continue;
        if (router.nodes.filter((n) => n.join(",") === r.coords[i].join(",")).length > 1) continue; // a path node there too
        const turn = Math.abs(((bearingDeg(r.coords[i], r.coords[i + 1]) - bearingDeg(r.coords[i - 1], r.coords[i]) + 540) % 360) - 180);
        assert.ok(turn <= 46, `${a}->${b} turns ${Math.round(turn)}° at ${door}'s door`);
      }
    }
  }
  assert.ok(uturns <= 5, `${uturns} of ${pairs} routes have a U-turn`);
  assert.ok(turns / pairs < 6.5, `${(turns / pairs).toFixed(1)} turns per route`);
});

test("Curtin University Lake is on the map with its island", () => {
  const lake = campus.features.find((f) => f.properties.kind === "water" && /Curtin University Lake/i.test(f.properties.name || ""));
  assert.ok(lake, "lake missing");
  const polygons = lake.geometry.type === "MultiPolygon" ? lake.geometry.coordinates : [lake.geometry.coordinates];
  assert.ok(polygons.some((rings) => rings.length >= 2), "the island (inner ring) is missing");
});

test("the path under the walker gives a direction to calibrate the compass with", () => {
  // a long straight edge of the walking network: standing on it, its direction comes back (either way)
  const [a, b] = paths.edges.filter(([x, y, m]) => m > 40).map(([x, y]) => [paths.nodes[x], paths.nodes[y]])[0];
  const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const d = router.pathDirection(middle);
  assert.ok(d && d.distance < 1 && d.length >= 12);
  const along = bearingDeg(a, b);
  const off = Math.abs(((d.bearing - along + 540) % 360) - 180);
  assert.ok(Math.min(off, 180 - off) < 15, `path runs ${along.toFixed(0)}°, got ${d.bearing.toFixed(0)}°`);
});

test("open-ground shortcuts never cross a drain or stream where there is no bridge", () => {
  const lines = campus.features.filter((f) => f.properties.kind === "stream" && !f.properties.culvert).map((f) => f.geometry.coordinates);
  const links = paths.edges.filter((e) => e[4] === 1);
  assert.ok(links.length > 20, "open-ground links are marked");
  for (const [a, b] of links) {
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) assert.ok(!segmentsCross(paths.nodes[a], paths.nodes[b], line[i - 1], line[i]), `link ${a}-${b} crosses water`);
    }
  }
  assert.equal(segmentsCross([0, 0], [2, 2], [0, 2], [2, 0]), true);
  assert.equal(segmentsCross([0, 0], [1, 1], [2, 2], [3, 0]), false);
});

test("a building's doors: a route may end at any of them, whichever is nearest", () => {
  const several = Object.entries(paths.entrances).filter(([, list]) => list.length > 1);
  assert.ok(several.length >= 10, "big buildings have more than one door");
  for (const [code, list] of several.slice(0, 10)) {
    for (const n of list) {
      // standing at one of its own doors, the route is (almost) nothing
      const r = router.route(paths.nodes[n], code);
      assert.ok(r && r.metres < 1, `${code}: ${r?.metres}`);
    }
  }
});

test("roomLabel drops a bracketed SWS code only when it names the wrong building", () => {
  assert.equal(roomLabel("LTCL 9 (HL2-109)"), "LTCL 9");
  assert.equal(roomLabel("LTBS LT II (HL2-111)"), "LTBS LT II");
  assert.equal(buildingForRoom(roomLabel("LTCL 9 (HL2-109)")), "HN2", "the label still finds the building");
  assert.equal(roomLabel("SK2 101 (ME 101) Physic Lab"), "SK2 101 (ME 101) Physic Lab");
  assert.equal(roomLabel("PA2 103 (Computer Lab)"), "PA2 103 (Computer Lab)");
  assert.equal(roomLabel("Auditorium"), "Auditorium");
  assert.equal(roomLabel(""), "");
});
