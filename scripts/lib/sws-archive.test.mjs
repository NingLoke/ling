// Tests for the SWS screenshot helpers (the browser part is exercised by the update workflow).
import { test } from "node:test";
import assert from "node:assert/strict";
import { pngSize, rowsHash, shotEntry, SHOT_SCALE, SHOT_VIEWPORT } from "./sws-archive.mjs";

// Smallest valid PNG header: signature + IHDR with width 3840, height 2600.
const header = (width, height) => {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

test("screenshots are 4K wide", () => {
  assert.equal(SHOT_VIEWPORT.width * SHOT_SCALE, 3840);
});

test("pngSize reads the PNG header and rejects other files", () => {
  assert.deepEqual(pngSize(header(3840, 2600)), { width: 3840, height: 2600 });
  assert.throws(() => pngSize(Buffer.from("<html></html>, definitely not a png")));
});

test("rowsHash changes only when the rows change", () => {
  const rows = [["CMFP0051/CSM/1/3/WS/06", "2E3", "CMFP0051 Physics 2", "Workshop", "6/10/26", "14:00", "17:00", "3:00", "41-52", "SK2 101", "John Wong Sze Yong"]];
  assert.equal(rowsHash(rows), rowsHash(JSON.parse(JSON.stringify(rows))));
  const moved = structuredClone(rows);
  moved[0][9] = "SK3 206";
  assert.notEqual(rowsHash(rows), rowsHash(moved));
});

test("shotEntry keeps each row's Activity id and box", () => {
  const entry = shotEntry({
    code: "CMFP0051",
    label: "CMFP0051 Physics 2",
    capturedAt: "2026-10-04T10:17:00.000Z",
    hash: "abc",
    size: { width: 3840, height: 2600 },
    listRows: [{ cells: ["CMFP0051/CSM/1/3/LEC/1", "3E1-3; 2E1-7"], x: 8, y: 246.5, w: 980, h: 19 }],
  });
  assert.equal(entry.image, "CMFP0051.png");
  assert.equal(entry.scale, SHOT_SCALE);
  assert.deepEqual(entry.rows, [{ id: "CMFP0051/CSM/1/3/LEC/1", x: 8, y: 246.5, w: 980, h: 19 }]);
});
