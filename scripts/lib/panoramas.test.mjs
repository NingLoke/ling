// 360° photos for the campus map: the JPEG reader behind scripts/add-panorama.mjs, and the list itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readJpegMeta, panoramaAngles } from "./jpeg-meta.mjs";
import { metresBetween } from "../../assets/campus-geo.js";

// a tiny JPEG skeleton with an EXIF GPS block, Photo Sphere XMP and a frame header
function jpeg({ lat, lon, direction, xmp, width, height }) {
  const tiff = Buffer.alloc(200);
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  // IFD0: one entry pointing at the GPS IFD (offset 26)
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8825, 10); tiff.writeUInt16LE(4, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt32LE(26, 18);
  tiff.writeUInt32LE(0, 22);
  const gps = 26;
  const entries = [
    [1, 2, 2, Buffer.from(lat < 0 ? "S\0\0\0" : "N\0\0\0", "latin1")],
    [2, 5, 3, 100],
    [3, 2, 2, Buffer.from(lon < 0 ? "W\0\0\0" : "E\0\0\0", "latin1")],
    [4, 5, 3, 124],
    [17, 5, 1, 148],
  ];
  tiff.writeUInt16LE(entries.length, gps);
  entries.forEach(([tag, type, count, value], k) => {
    const e = gps + 2 + k * 12;
    tiff.writeUInt16LE(tag, e); tiff.writeUInt16LE(type, e + 2); tiff.writeUInt32LE(count, e + 4);
    if (Buffer.isBuffer(value)) value.copy(tiff, e + 8); else tiff.writeUInt32LE(value, e + 8);
  });
  const dms = (deg, at) => {
    const a = Math.abs(deg);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const s = Math.round(((a - d) * 60 - m) * 60 * 100);
    [[d, 1], [m, 1], [s, 100]].forEach(([n, q], k) => { tiff.writeUInt32LE(n, at + k * 8); tiff.writeUInt32LE(q, at + k * 8 + 4); });
  };
  dms(lat, 100);
  dms(lon, 124);
  tiff.writeUInt32LE(Math.round(direction * 10), 148); tiff.writeUInt32LE(10, 152);
  const segment = (marker, body) => {
    const head = Buffer.alloc(4);
    head.writeUInt16BE(marker, 0);
    head.writeUInt16BE(body.length + 2, 2);
    return Buffer.concat([head, body]);
  };
  const sof = Buffer.alloc(6);
  sof[0] = 8; sof.writeUInt16BE(height, 1); sof.writeUInt16BE(width, 3); sof[5] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xffe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff])),
    segment(0xffe1, Buffer.concat([Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1"), Buffer.from(xmp, "utf8")])),
    segment(0xffc0, sof),
    Buffer.from([0xff, 0xd9]),
  ]);
}

test("reads position, direction and Photo Sphere data from a phone panorama", () => {
  const xmp = '<x:xmpmeta><rdf:Description GPano:ProjectionType="equirectangular" GPano:PoseHeadingDegrees="77.5" GPano:FullPanoWidthPixels="8000" GPano:FullPanoHeightPixels="4000" GPano:CroppedAreaImageWidthPixels="8000" GPano:CroppedAreaImageHeightPixels="2000" GPano:CroppedAreaLeftPixels="0" GPano:CroppedAreaTopPixels="1000"/></x:xmpmeta>';
  const meta = readJpegMeta(jpeg({ lat: 4.5117, lon: 114.0167, direction: 123.5, xmp, width: 8000, height: 2000 }));
  assert.equal(meta.width, 8000);
  assert.equal(meta.height, 2000);
  assert.ok(Math.abs(meta.lat - 4.5117) < 1e-5 && Math.abs(meta.lon - 114.0167) < 1e-5);
  assert.equal(meta.direction, 123.5);
  assert.equal(meta.gpano.heading, 77.5);
  assert.equal(meta.gpano.projection, "equirectangular");
  const angles = panoramaAngles(meta);
  assert.deepEqual([angles.haov, angles.vaov, angles.vOffset], [360, 90, 0]);
  // southern / western hemispheres come out negative
  const south = readJpegMeta(jpeg({ lat: -33.86, lon: -70.6, direction: 0, xmp: "", width: 4000, height: 2000 }));
  assert.ok(south.lat < 0 && south.lon < 0);
  assert.deepEqual(panoramaAngles(south), { haov: 360, vaov: 180, vOffset: 0 }); // 2:1 = full sphere
  assert.equal(panoramaAngles({ width: 9000, height: 2250, gpano: {} }, 200).haov, 200); // ordinary phone panorama
  assert.throws(() => readJpegMeta(Buffer.from("not a jpeg")));
});

test("every listed 360° photo exists, is on campus, faces somewhere and credits its author", () => {
  const listUrl = new URL("../../data/campus/panoramas.json", import.meta.url);
  const { panoramas } = JSON.parse(readFileSync(listUrl, "utf8"));
  assert.ok(Array.isArray(panoramas));
  const centre = [114.0167, 4.5117];
  const ids = new Set();
  for (const p of panoramas) {
    assert.ok(!ids.has(p.id), `duplicate ${p.id}`);
    ids.add(p.id);
    assert.ok(existsSync(fileURLToPath(new URL(p.file, listUrl))), `${p.id}: ${p.file} missing`);
    assert.ok(metresBetween([p.lon, p.lat], centre) < 3000, `${p.id} is not on campus`);
    assert.ok(p.north >= 0 && p.north < 360, `${p.id} north`);
    assert.ok(p.author && p.license, `${p.id} needs an author and a licence`);
    assert.ok(!p.width || p.width <= 8192, `${p.id} is too wide for some phones`);
  }
});
