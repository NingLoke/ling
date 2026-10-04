// Finds openly licensed real-world pictures of the Curtin Malaysia (Miri) campus for the 3D campus map:
//   - photos on Wikimedia Commons with a location near the campus, or in its Commons category
//   - street-level photos on Panoramax and KartaView (open street-level imagery)
//   - drone/aerial imagery on OpenAerialMap
//   node scripts/fetch-campus-photos.mjs
// Writes data/campus/photos.json (links, authors and licences; the pictures stay on their own servers).
// A source that is down or empty is reported and skipped, never fatal.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve("data/campus/photos.json");
const CENTER = { lat: 4.5117, lon: 114.0167 };
const RADIUS = 1200; // metres
const BBOX = [114.0058, 4.5009, 114.0276, 4.5225]; // about RADIUS around the centre
const UA = "ling-timetable-campus-map/1.0 (https://github.com/NingLoke/ling)";
const report = {};

async function getJson(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { "user-agent": UA, accept: "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}
const plain = (html) => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();
const metres = (a, b) => {
  const R = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// ---------- Wikimedia Commons ----------
async function commons() {
  const api = "https://commons.wikimedia.org/w/api.php";
  const ids = new Set();
  const geo = await getJson(`${api}?action=query&list=geosearch&gscoord=${CENTER.lat}|${CENTER.lon}&gsradius=${RADIUS}&gsnamespace=6&gslimit=500&format=json&origin=*`);
  for (const p of geo.query?.geosearch || []) ids.add(p.pageid);
  // files whose title or description mention the campus (many have no location)
  for (const words of ["Curtin Miri", "Curtin Malaysia", "Curtin Sarawak", "Curtin University Miri"]) {
    const found = await getJson(`${api}?action=query&list=search&srsearch=${encodeURIComponent(words)}&srnamespace=6&srlimit=100&format=json&origin=*`).catch(() => null);
    for (const r of found?.query?.search || []) ids.add(r.pageid);
  }
  // files filed under the university's category (one level of subcategories), with or without a location
  const categories = ["Category:Curtin University Malaysia", "Category:Curtin University, Malaysia", "Category:Curtin University Sarawak", "Category:Curtin Malaysia"];
  const roots = categories.length;
  for (let i = 0; i < categories.length && i < 20; i++) {
    const members = await getJson(`${api}?action=query&list=categorymembers&cmtitle=${encodeURIComponent(categories[i])}&cmtype=file|subcat&cmlimit=500&format=json&origin=*`).catch(() => null);
    for (const m of members?.query?.categorymembers || []) {
      if (m.ns === 14 && i < roots) categories.push(m.title);
      else if (m.ns === 6) ids.add(m.pageid);
    }
  }
  console.log(`commons: ${ids.size} candidate files`);
  const photos = [];
  const list = [...ids];
  for (let i = 0; i < list.length; i += 50) {
    const batch = list.slice(i, i + 50).join("|");
    const info = await getJson(`${api}?action=query&pageids=${batch}&prop=imageinfo|coordinates&iiprop=url|extmetadata|mime|size&iiurlwidth=960&coprop=type|dim&format=json&origin=*`);
    for (const page of Object.values(info.query?.pages || {})) {
      const ii = page.imageinfo?.[0];
      const skip = (why) => console.log(`  skip ${page.title} (${why})`);
      if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime)) {
        skip(ii?.mime || "no image");
        continue;
      }
      const meta = ii.extmetadata || {};
      const coord = page.coordinates?.[0];
      const words = `${page.title} ${plain(meta.ImageDescription?.value)} ${plain(meta.Categories?.value)}`;
      if (!coord && !/curtin/i.test(words)) {
        skip("no location, not about Curtin");
        continue;
      }
      if (!coord && !/miri|malaysia|sarawak/i.test(words)) {
        skip("no location, not the Malaysian campus");
        continue;
      }
      console.log(`  keep ${page.title}${coord ? ` @ ${coord.lat},${coord.lon}` : ""}`);
      photos.push({
        id: `commons:${page.pageid}`,
        source: "Wikimedia Commons",
        lon: coord?.lon ?? null,
        lat: coord?.lat ?? null,
        heading: null,
        thumb: ii.thumburl,
        full: ii.url,
        page: ii.descriptionurl,
        title: plain(meta.ObjectName?.value) || page.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, ""),
        description: plain(meta.ImageDescription?.value).slice(0, 300),
        author: plain(meta.Artist?.value) || plain(meta.Credit?.value) || "Unknown",
        license: plain(meta.LicenseShortName?.value) || "see source",
        licenseUrl: meta.LicenseUrl?.value || ii.descriptionurl,
        taken: plain(meta.DateTimeOriginal?.value).slice(0, 10) || null,
        width: ii.width,
        height: ii.height,
      });
    }
  }
  return photos;
}

// ---------- Panoramax (open street-level imagery; global instance) ----------
async function panoramax() {
  const data = await getJson(`https://api.panoramax.xyz/api/search?bbox=${BBOX.join(",")}&limit=500`);
  return (data.features || []).map((f) => {
    const p = f.properties || {};
    const a = f.assets || {};
    return {
      id: `panoramax:${f.id}`,
      source: "Panoramax",
      lon: f.geometry?.coordinates?.[0] ?? null,
      lat: f.geometry?.coordinates?.[1] ?? null,
      heading: p["view:azimuth"] ?? null,
      thumb: a.sd?.href || a.thumb?.href,
      full: a.hd?.href || a.sd?.href,
      page: `https://api.panoramax.xyz/#focus=pic&pic=${f.id}`,
      title: "Panoramax",
      description: "",
      author: (f.providers || p.providers || []).map((x) => x.name).filter(Boolean).join(", ") || "Panoramax contributor",
      license: p.license || "CC-BY-SA-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      taken: (p.datetime || "").slice(0, 10) || null,
    };
  }).filter((x) => x.thumb);
}

// ---------- KartaView (open street-level imagery) ----------
async function kartaview() {
  // the v1 "nearby photos" call; the v2 API rejects plain radius searches
  const body = new URLSearchParams({ lat: CENTER.lat, lng: CENTER.lon, radius: RADIUS, ipp: 200 });
  const response = await fetch("https://api.openstreetcam.org/1.0/list/nearby-photos/", {
    method: "POST",
    headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 150)}`);
  const data = JSON.parse(text);
  const items = data.currentPageItems || data.osv?.photos || data.result?.data || data.data || [];
  return items.map((p) => ({
    id: `kartaview:${p.id}`,
    source: "KartaView",
    lon: Number(p.lng),
    lat: Number(p.lat),
    heading: p.heading != null ? Number(p.heading) : null,
    thumb: [p.lth_name, p.th_name, p.fileurlLTh, p.fileurlTh, p.imageThUrl].find(Boolean)?.replace(/^(?!https?:)/, "https://"),
    full: [p.name, p.fileurlProc, p.fileurl, p.imageProcUrl].find(Boolean)?.replace(/^(?!https?:)/, "https://"),
    page: `https://kartaview.org/details/${p.sequence_id ?? p.sequenceId}/${p.sequence_index ?? p.sequenceIndex}`,
    title: "KartaView",
    description: "",
    author: p.username || "KartaView contributor",
    license: "CC-BY-SA-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    taken: (p.shotDate || p.dateAdded || "").slice(0, 10) || null,
  })).filter((x) => x.thumb && Number.isFinite(x.lon));
}

// ---------- OpenAerialMap (drone and aerial imagery, CC BY 4.0) ----------
async function openaerialmap() {
  const data = await getJson(`https://api.openaerialmap.org/meta?bbox=${BBOX.join(",")}&limit=50`);
  return (data.results || []).map((r) => ({
    id: `oam:${r._id}`,
    title: r.title,
    provider: r.provider,
    platform: r.platform,
    gsd: r.gsd,
    date: (r.acquisition_start || "").slice(0, 10) || null,
    bbox: r.bbox,
    tms: r.properties?.tms || null,
    thumbnail: r.properties?.thumbnail || null,
    license: r.properties?.license || "CC-BY 4.0",
  }));
}

const sources = { commons, panoramax, kartaview };
const photos = [];
for (const [name, run] of Object.entries(sources)) {
  try {
    const found = await run();
    const near = found.filter((p) => p.lat == null || metres(CENTER, p) <= RADIUS * 1.3);
    report[name] = { found: found.length, kept: near.length, located: near.filter((p) => p.lat != null).length };
    photos.push(...near);
  } catch (error) {
    report[name] = { error: String(error.message || error).slice(0, 200) };
  }
}
let aerial = [];
try {
  aerial = await openaerialmap();
  report.openaerialmap = { found: aerial.length, finest: aerial.reduce((m, a) => Math.min(m, a.gsd ?? Infinity), Infinity) };
} catch (error) {
  report.openaerialmap = { error: String(error.message || error).slice(0, 200) };
}

console.log(JSON.stringify(report, null, 1));
const result = { meta: { sources: report, note: "Pictures stay on their own servers; credit the author and licence when showing them." }, photos, aerial };
// only write when the pictures themselves changed, so a run that finds nothing new makes no commit
const before = JSON.parse(await readFile(OUT, "utf8").catch(() => "null"));
const same = before && JSON.stringify([before.photos, before.aerial]) === JSON.stringify([photos, aerial]);
if (!same) await writeFile(OUT, `${JSON.stringify(result, null, 1)}\n`);
console.log(`${photos.length} photos, ${aerial.length} aerial images`);
