// Tests for the campus map data and walking directions (assets/campus-geo.js + data/campus/*).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  metresBetween, bearingDeg, closestPointOnSegment, polygonCentroid, pointInRing, buildingForRoom,
  createRouter, directions, progressOnRoute, walkMinutes, CAMPUS_CODES,
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
  assert.equal(buildingForRoom("LTCL 9 (HL2-109)", { rooms, codes }), "HL2");
  assert.equal(buildingForRoom("LTBS LT II (HL2-111)", { rooms, codes }), "HL2");
  assert.equal(buildingForRoom("Auditorium", { rooms, codes }), "FN4");
  assert.equal(buildingForRoom("Harry Perkins LT", { rooms, codes }), "FN1");
  assert.equal(buildingForRoom("PA2 103 (Computer Lab)", { rooms, codes }), "PA2");
  assert.equal(buildingForRoom("Somewhere else", { rooms, codes }), null);
  // the page uses the built-in aliases and codes, without loading the map data
  assert.equal(buildingForRoom("Auditorium"), "FN4");
  assert.equal(buildingForRoom("SK3 102 Lecture 1"), "SK3");
  assert.equal(buildingForRoom("ZZ9 101"), null);
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
    // the door sits on (or right next to) the building outline
    const door = paths.nodes[paths.doors[code]];
    const ring = f.geometry.coordinates[0];
    const toOutline = Math.min(...ring.slice(0, -1).map((p, i) => metresBetween(door, closestPointOnSegment(door, p, ring[i + 1]))));
    assert.ok(toOutline < 1, `${code} door ${toOutline.toFixed(1)} m from its outline`);
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
      const straight = metresBetween(start, paths.nodes[paths.doors[to]]);
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
  assert.deepEqual(r.coords.at(-1), paths.nodes[paths.doors.FN4]);
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
