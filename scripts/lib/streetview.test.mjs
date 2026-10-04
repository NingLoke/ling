// Google Maps 360° views pasted by students become embeddable links (no API key) for the campus map.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStreetView, streetViewEmbed } from "../../assets/streetview-url.js";
import { metresBetween } from "../../assets/campus-geo.js";

const ID = "CIHM0ogKEICAgICUDGHAEQ";

test("reads the address bar of a photo sphere in Google Maps", () => {
  const url = `https://www.google.com/maps/@4.5118437,114.0181191,3a,80y,319h,93t/data=!3m7!1e1!3m5!1s${ID}!2e10!6shttps:%2F%2Flh5.googleusercontent.com%2Fp%2FAF1Qip!7i10240!8i5120?entry=ttu`;
  const v = parseStreetView(url);
  assert.deepEqual(v, { pano: ID, lat: 4.5118437, lon: 114.0181191, heading: 319, pitch: 3 });
});

test("reads Google Maps' 'Embed a map' iframe code", () => {
  const code = `<iframe src="https://www.google.com/maps/embed?pb=!4v1727000000000!6m8!1m7!1s${ID}!2m2!1d4.5118437!2d114.0181191!3f319.5!4f2.1!5f0.7820865974627469" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
  const v = parseStreetView(code);
  assert.equal(v.pano, ID);
  assert.equal(v.lat, 4.5118437);
  assert.equal(v.lon, 114.0181191);
  assert.equal(v.heading, 319.5);
});

test("builds an embed address that looks the requested way", () => {
  const src = streetViewEmbed({ pano: ID, lat: 4.5118437, lon: 114.0181191 }, -45);
  assert.match(src, /^https:\/\/www\.google\.com\/maps\/embed\?pb=!4v1!6m8!1m7!1sCIHM0ogKEICAgICUDGHAEQ!2m2!1d4\.5118437!2d114\.0181191!3f315\.0!4f0\.0!5f0\.78/);
  assert.deepEqual(parseStreetView(src), { pano: ID, lat: 4.5118437, lon: 114.0181191, heading: 315, pitch: 0 });
});

test("other links are refused", () => {
  assert.equal(parseStreetView("https://example.com/maps/@4.5,114,3a/data=!1sCIHM0ogKEICAgICUDGHAEQ"), null);
  assert.equal(parseStreetView("https://www.google.com/maps/place/Curtin/@4.51,114.01,17z"), null);
  assert.equal(parseStreetView("hello"), null);
});

test("every saved view is on campus and has a photo id", () => {
  const { views } = JSON.parse(readFileSync(new URL("../../data/campus/streetviews.json", import.meta.url), "utf8"));
  assert.ok(Array.isArray(views));
  for (const v of views) {
    assert.ok(v.pano && v.pano.length >= 10, `${v.id} photo id`);
    assert.ok(metresBetween([v.lon, v.lat], [114.0167, 4.5117]) < 3000, `${v.id} is not on campus`);
  }
});
