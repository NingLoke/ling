// 3D campus map: real-scale buildings from OpenStreetMap, live GPS position with compass heading,
// and walking directions to a building. Opens as a full-screen overlay; returns close().
// Map data © OpenStreetMap contributors (ODbL). Rendering: MapLibre GL JS (BSD-3-Clause), loaded on demand.
import {
  createRouter, buildingForRoom, metresBetween, bearingDeg, progressOnRoute, walkMinutes, TURN_ZH, pointInRing, createPositionFilter, closestPointOnSegment, polygonCentroid,
} from "./campus-geo.js?v=29383000af";
import { streetViewEmbed, streetViewAt, satelliteEmbed } from "./streetview-url.js?v=4ae4fac379";

let current = null;

const PALETTES = {
  ink: {
    bg: "#efe9dd", campus: "#f4efe5", green: "#dde4cc", water: "#c3d3da", parking: "#e6dfd2",
    road: "#d9cfbf", roadCasing: "#c9bfae", foot: "#bfb4a1",
    building: "#ece6da", buildingOther: "#e2dccf", buildingMine: "#e3c3b3", focus: "#b5412e", roof: "#d8d0c1",
    route: "#b5412e", routeCasing: "#fbf7ef", me: "#2f6f8f", meRing: "rgba(47,111,143,.18)",
    sky: "#efe9dd", horizon: "#e6dfd2",
    worldWood: "#dfe3cd", worldGreen: "#e4e6d2", worldHomes: "#e9e2d4", worldRoad: "#fbf8f1", worldMajor: "#f7eedb", worldCasing: "#d3c8b5",
    worldBuilding: "#e6dfd2", worldLabel: "#6b665d", worldHalo: "#f4efe5",
    panel: "#f9f6ef", text: "#1d1c1a", muted: "#6b665d", line: "rgba(29,28,26,.12)", accent: "#b5412e", onAccent: "#fbf7ef",
    font: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', Roboto, sans-serif",
    label: "'Noto Serif SC', 'Songti SC', serif",
  },
  neon: {
    bg: "#0a0e17", campus: "#0e1421", green: "#0f2420", water: "#0c2440", parking: "#121a29",
    road: "#1b2537", roadCasing: "#0a0e17", foot: "#33415c",
    building: "#1f2a40", buildingOther: "#18202f", buildingMine: "#2c4a78", focus: "#7cc4ff", roof: "#222c40",
    route: "#7cc4ff", routeCasing: "#04070d", me: "#5fd4b8", meRing: "rgba(95,212,184,.18)",
    sky: "#0a0e17", horizon: "#16233d",
    worldWood: "#0c1b1b", worldGreen: "#0e1f1d", worldHomes: "#0d1320", worldRoad: "#1a2335", worldMajor: "#24314c", worldCasing: "#070a12",
    worldBuilding: "#151d2c", worldLabel: "#7d89a3", worldHalo: "#0a0e17",
    panel: "#111827", text: "#e8ecf4", muted: "#8591aa", line: "rgba(255,255,255,.1)", accent: "#7cc4ff", onAccent: "#06111f",
    font: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', Roboto, sans-serif",
    label: "-apple-system, BlinkMacSystemFont, 'PingFang SC', Roboto, sans-serif",
  },
};

const CSS = `
.cm{position:fixed;inset:0;z-index:2147482000;background:var(--cm-bg);color:var(--cm-text);font-family:var(--cm-font);
  overscroll-behavior:contain;-webkit-tap-highlight-color:transparent}
.cm *,.cm *::before,.cm *::after{box-sizing:border-box}
.cm-map{position:absolute;inset:0}
.cm-map canvas{outline:none}
.cm-top{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;gap:8px;pointer-events:none;
  padding:calc(env(safe-area-inset-top) + 10px) calc(env(safe-area-inset-right) + 12px) 10px calc(env(safe-area-inset-left) + 12px)}
.cm-top>*{pointer-events:auto}
.cm-btn{min-width:44px;min-height:44px;padding:0 14px;border-radius:14px;border:1px solid var(--cm-line);background:var(--cm-panel);
  color:var(--cm-text);font:inherit;font-size:15px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;
  box-shadow:0 6px 18px -10px rgba(0,0,0,.45)}
.cm-btn:focus-visible{outline:2px solid var(--cm-accent);outline-offset:2px}
.cm-btn.cm-primary{background:var(--cm-accent);border-color:transparent;color:var(--cm-on-accent);font-weight:700}
.cm-btn[aria-pressed="true"]{border-color:var(--cm-accent);color:var(--cm-accent)}
.cm-btn svg{width:20px;height:20px}
.cm-title{flex:1;min-width:0;padding:6px 12px;border-radius:14px;background:var(--cm-panel);border:1px solid var(--cm-line);
  box-shadow:0 6px 18px -10px rgba(0,0,0,.45)}
.cm-title b{display:block;font-size:15px;line-height:1.25}
.cm-title span{display:block;font-size:12px;color:var(--cm-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cm-fabs{position:absolute;right:calc(env(safe-area-inset-right) + 12px);top:calc(env(safe-area-inset-top) + 72px);display:flex;flex-direction:column;gap:8px}
.cm-fabs .cm-btn{padding:0;width:46px;height:46px;font-size:13px;font-weight:700}
.cm-sheet{position:absolute;left:0;right:0;bottom:0;
  padding:14px calc(env(safe-area-inset-right) + 16px) calc(env(safe-area-inset-bottom) + 14px + var(--cm-host,0px)) calc(env(safe-area-inset-left) + 16px);
  background:var(--cm-panel);border-top:1px solid var(--cm-line);border-radius:20px 20px 0 0;box-shadow:0 -12px 40px -24px rgba(0,0,0,.6);
  max-height:46vh;overflow:auto}
.cm-sheet h2{margin:0;font-size:19px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.cm-sheet h2 small{font-size:13px;font-weight:400;color:var(--cm-muted)}
.cm-sheet p{margin:6px 0 0;font-size:14px;color:var(--cm-muted);line-height:1.55}
.cm-sheet ul{margin:8px 0 0;padding:0;list-style:none;display:grid;gap:4px}
.cm-sheet li{font-size:14px;line-height:1.45}
.cm-sheet li b{font-variant-numeric:tabular-nums}
.cm-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.cm-nav{display:grid;grid-template-columns:56px 1fr;gap:12px;align-items:center}
.cm-arrow{width:56px;height:56px;border-radius:16px;display:grid;place-items:center;background:var(--cm-accent);color:var(--cm-on-accent)}
.cm-arrow svg{width:34px;height:34px;transition:transform .3s}
.cm-nav strong{display:block;font-size:22px;line-height:1.2}
.cm-nav span{display:block;font-size:14px;color:var(--cm-muted);margin-top:2px}
.cm-msg{position:absolute;left:50%;top:calc(env(safe-area-inset-top) + 70px);transform:translateX(-50%);max-width:min(92vw,420px);
  padding:10px 14px;border-radius:14px;background:var(--cm-panel);border:1px solid var(--cm-line);font-size:14px;text-align:center;
  box-shadow:0 10px 30px -12px rgba(0,0,0,.5)}
.cm-msg:empty{display:none}
.cm-loading{position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:12px;font-size:15px;color:var(--cm-muted);
  pointer-events:none;text-align:center;padding:0 24px}
.cm-loading.cm-failed{pointer-events:auto}
.cm-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.cm-label{pointer-events:none;transform:translateY(-6px);text-align:center;white-space:nowrap}
.cm-label b{display:inline-block;padding:2px 6px;border-radius:7px;font:700 12px/1.2 var(--cm-label);letter-spacing:.02em;
  color:var(--cm-text);background:color-mix(in srgb,var(--cm-panel) 82%,transparent);border:1px solid var(--cm-line)}
.cm-label.cm-mine b{border-color:var(--cm-accent);color:var(--cm-accent)}
.cm-label.cm-focus b{background:var(--cm-accent);color:var(--cm-on-accent);border-color:transparent;font-size:14px;padding:3px 9px}
.cm-label small{display:table;margin:3px auto 0;padding:1px 6px;border-radius:6px;font-size:11px;color:var(--cm-text);
  background:color-mix(in srgb,var(--cm-panel) 88%,transparent)}
.cm-me{width:22px;height:22px;position:relative}
.cm-me i{position:absolute;inset:3px;border-radius:50%;background:var(--cm-me);border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.15),0 2px 8px rgba(0,0,0,.35)}
.cm-me::before{content:"";position:absolute;inset:-9px;border-radius:50%;background:var(--cm-me);opacity:.25;animation:cm-pulse 2s ease-out infinite}
.cm-me .cm-cone{position:absolute;left:50%;bottom:50%;width:60px;height:60px;margin-left:-30px;transform-origin:50% 100%;display:none;
  background:radial-gradient(circle at 50% 100%,color-mix(in srgb,var(--cm-me) 55%,transparent),transparent 70%);
  clip-path:polygon(50% 100%,15% 0,85% 0)}
.cm-me.cm-has-heading .cm-cone{display:block}
@keyframes cm-pulse{0%{transform:scale(.6);opacity:.35}100%{transform:scale(1.6);opacity:0}}
.cm-pin{width:30px;height:40px;transform:translateY(-4px)}
.cm-list{position:absolute;inset:0;background:var(--cm-panel);overflow:auto;padding:calc(env(safe-area-inset-top) + 12px) 16px calc(env(safe-area-inset-bottom) + 16px)}
.cm-list h3{margin:18px 0 6px;font-size:13px;color:var(--cm-muted);letter-spacing:.08em;font-weight:600}
.cm-list button{display:flex;width:100%;align-items:baseline;gap:10px;text-align:left;min-height:46px;padding:8px 10px;border:0;border-bottom:1px solid var(--cm-line);
  background:none;color:var(--cm-text);font:inherit;cursor:pointer}
.cm-list button b{min-width:42px;font-variant-numeric:tabular-nums}
.cm-list button span{color:var(--cm-muted);font-size:13px}
.cm-list button em{margin-left:auto;font-style:normal;font-size:12px;color:var(--cm-accent)}
.cm .maplibregl-ctrl-bottom-right,.cm .maplibregl-ctrl-bottom-left{bottom:var(--cm-sheet,0px)}
.cm .maplibregl-ctrl-attrib{font-size:10px;max-width:calc(100vw - 24px)}
.cm-fabs .cm-north svg{transition:transform .15s linear}
.cm-fabs .cm-btn[hidden]{display:none}
.cm-fabs .cm-compass.cm-needs{border-color:var(--cm-accent);color:var(--cm-accent);animation:cm-nudge 1.6s ease-in-out 3}
.cm-real{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:10px}
.cm-real>span{font-size:13px;color:var(--cm-muted);margin-right:2px}
.cm-real a{min-height:38px;padding:0 12px;font-size:14px;text-decoration:none}
.cm-real a svg{width:14px;height:14px;opacity:.7}
.cm-real .cm-pano-btn{border-color:var(--cm-accent);color:var(--cm-accent);font-weight:700}
.cm-real .cm-pano-btn svg{width:18px;height:18px}
.cm-sheet:has(>.cm-media){padding-top:0;
  max-height:min(72vh,calc(100vh - 290px - env(safe-area-inset-top)));max-height:min(72dvh,calc(100dvh - 290px - env(safe-area-inset-top)))}
.cm-media{display:flex;flex-direction:column;margin:0 calc(-16px - env(safe-area-inset-right)) 12px calc(-16px - env(safe-area-inset-left));
  height:min(36vh,70vw,360px,calc((100vh - 290px - env(safe-area-inset-top)) * .55));
  height:min(36dvh,70vw,360px,calc((100dvh - 290px - env(safe-area-inset-top)) * .55));min-height:150px;
  overflow:hidden;border-radius:20px 20px 0 0;background:var(--cm-line);border-bottom:1px solid var(--cm-line)}
.cm-media.cm-media-small{height:min(24vh,200px);min-height:120px}
.cm-media-wait{animation:cm-wait 1.2s ease-in-out infinite alternate}
.cm-media-track{flex:1;min-height:0;display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scrollbar-width:none;overscroll-behavior-x:contain;background:#111}
.cm-media-track::-webkit-scrollbar{display:none}
.cm-media-item{flex:0 0 100%;height:100%;margin:0;padding:0;border:0;background:none;color:inherit;font:inherit;position:relative;scroll-snap-align:start;scroll-snap-stop:always}
button.cm-media-item{cursor:zoom-in}
.cm-media-item img,.cm-media-item iframe{width:100%;height:100%;border:0;object-fit:cover;display:block}
.cm-media-item:focus-visible{outline:3px solid var(--cm-accent);outline-offset:-3px}
.cm-media-poster{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:4px;color:var(--cm-text);
  background:radial-gradient(120% 90% at 50% 35%,color-mix(in srgb,var(--cm-accent) 22%,var(--cm-panel)),var(--cm-panel))}
.cm-media-poster svg{width:40px;height:40px;color:var(--cm-accent)}
.cm-media-poster small{color:var(--cm-muted)}
.cm-media-cap{flex:none;margin:0;display:flex;align-items:center;gap:8px;background:var(--cm-panel);touch-action:pan-y;
  padding:7px calc(10px + env(safe-area-inset-right)) 7px calc(14px + env(safe-area-inset-left))}
.cm-media-text{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:baseline;column-gap:8px;row-gap:2px;font-size:13px;line-height:1.35}
.cm-media-text span{min-width:0}
.cm-media-text small{flex-basis:100%;font-size:11px;color:var(--cm-muted)}
.cm-media-text a{color:inherit}
.cm-near{padding:1px 8px;border-radius:999px;background:var(--cm-accent);color:var(--cm-on-accent);font-size:12px;white-space:nowrap}
.cm-media-nav{flex:none;display:flex;align-items:center;gap:4px}
.cm-media-nav .cm-btn{min-width:38px;min-height:38px;padding:0;border-radius:12px;font-size:22px;line-height:1;box-shadow:none}
.cm-media-nav .cm-btn:disabled{opacity:.35;cursor:default}
.cm-media-count{min-width:30px;text-align:center;font-size:12px;color:var(--cm-muted);font-variant-numeric:tabular-nums}
@keyframes cm-wait{to{opacity:.55}}
@media (min-width:720px) and (orientation:landscape){
  /* side by side, and clear of the map buttons on the right */
  .cm-sheet:has(>.cm-media){display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start;padding-top:14px;
    max-height:62vh;right:calc(env(safe-area-inset-right) + 70px);border-top-right-radius:20px;border-right:1px solid var(--cm-line)}
  .cm-media,.cm-media.cm-media-small{position:sticky;top:0;margin:0;height:min(54vh,420px);min-height:0;border-radius:14px;border:1px solid var(--cm-line)}
  .cm-media-cap{padding:7px 10px 7px 12px}
  .cm:has(.cm-sheet>.cm-media) .maplibregl-ctrl-bottom-right{bottom:0}
}
.cm-photo{position:absolute;inset:0;z-index:5;background:#000;display:grid;grid-template-rows:auto 1fr auto;color:#f2f2f2}
.cm-photo .cm-pano-box,.cm-photo iframe{width:100%;height:100%;min-height:0;border:0;display:block;background:#111}
.cm-photo .cm-pano-box .pnlm-load-box{font-family:var(--cm-font)}
.cm-pano{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;cursor:pointer;border:2px solid #fff;
  background:var(--cm-accent);color:var(--cm-on-accent);box-shadow:0 2px 8px rgba(0,0,0,.35)}
.cm-pano svg{width:17px;height:17px}
.cm-pano.cm-pano-g{width:24px;height:24px;opacity:.85}
.cm-pano.cm-pano-g svg{width:14px;height:14px}
.cm-photo header{display:flex;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top) + 8px) 12px 8px}
.cm-photo header b{flex:1;font-size:15px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-photo img{width:100%;height:100%;object-fit:contain;min-height:0}
.cm-photo footer{padding:8px 14px calc(env(safe-area-inset-bottom) + 12px);font-size:12px;line-height:1.5;color:#bbb}
.cm-photo footer a{color:#9cd2ff}
.cm-photo .cm-btn{background:rgba(255,255,255,.12);color:#fff;border-color:transparent}
.cm-sheet-head{display:flex;align-items:center;gap:8px}
.cm-sheet-head h2{flex:1}
.cm-sheet-head .cm-btn{min-height:40px;padding:0 12px;font-size:14px}
.cm-picks{display:grid;gap:6px;margin-top:10px}
.cm-pick{display:flex;align-items:center;gap:10px;width:100%;min-height:48px;padding:6px 12px;border-radius:12px;border:1px solid var(--cm-line);
  background:none;color:var(--cm-text);font:inherit;font-size:15px;text-align:left;cursor:pointer}
.cm-pick b{min-width:40px}
.cm-pick span{color:var(--cm-muted);font-size:13px}
.cm-pick i{margin-left:auto;font-style:normal;font-size:20px;color:var(--cm-accent);display:inline-block}
@keyframes cm-nudge{50%{transform:scale(1.08)}}
@media (prefers-reduced-motion:reduce){.cm-me::before,.cm-media-wait{animation:none}.cm-arrow svg{transition:none}}
`;

const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  locate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  north: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l5 14-5-3-5 3z" fill="currentColor" fill-opacity=".25"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V5"/><path d="M6 11l6-6 6 6"/></svg>',
  compass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor" fill-opacity=".3"/></svg>',
  pano: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="9" ry="4.5"/><path d="M12 7.5v9"/><path d="M3 12h18"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V4"/><path d="M6 4h11l-2 4 2 4H6"/></svg>',
};
const TURN_ROTATE = { start: 0, "slight-left": -40, left: -90, "slight-right": 40, right: 90, uturn: 180, arrive: 0 };

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value; // our own static icons only
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) if (child != null && child !== false) node.append(child);
  return node;
}

const fmtMetres = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${Math.max(1, Math.round(m / 5) * 5)} 米`);
const circle = (centre, radius, steps = 48) => {
  const [lon, lat] = centre;
  const dLat = radius / 111195;
  const dLon = radius / (111195 * Math.cos((lat * Math.PI) / 180));
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
};
const EMPTY = { type: "FeatureCollection", features: [] };

// Keyless world basemap around the campus (OpenMapTiles schema). Free, no account, commercial use allowed;
// the attribution comes with its TileJSON. If it cannot be reached the campus still draws from our own data.
export const OPENFREEMAP = "https://tiles.openfreemap.org/planet";

/** The surroundings (roads, water, woods, towns and 3D buildings) drawn from the world basemap, under our campus. */
function worldLayers(c, campus) {
  const src = { source: "world" };
  const areas = ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false];
  const lines = ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false];
  const cls = (...names) => ["match", ["get", "class"], names, true, false];
  const width = (z15, z19) => ["interpolate", ["exponential", 2], ["zoom"], 12, z15 / 6, 15, z15, 19, z19];
  const name = ["coalesce", ["get", "name:latin"], ["get", "name"]];
  // our own buildings (taller, with codes) replace the basemap's copies of them
  const ours = {
    type: "MultiPolygon",
    coordinates: campus.features.filter((f) => f.properties.kind === "building" || f.properties.kind === "roof").map((f) => f.geometry.coordinates),
  };
  // with no glyph server MapLibre draws text with the phone's own fonts, named here as CSS families
  const fonts = c.font.split(",").map((f) => f.trim().replace(/^['"]|['"]$/g, ""));
  const text = (size) => ({ "text-field": name, "text-size": size, "text-font": fonts, "text-max-width": 8 });
  const halo = { "text-color": c.worldLabel, "text-halo-color": c.worldHalo, "text-halo-width": 1.6 };
  return [
    { id: "w-wood", type: "fill", ...src, "source-layer": "landcover", filter: ["all", areas, cls("wood", "forest", "wetland")], paint: { "fill-color": c.worldWood } },
    { id: "w-green", type: "fill", ...src, "source-layer": "landcover", filter: ["all", areas, cls("grass", "farmland", "sand")], paint: { "fill-color": c.worldGreen } },
    { id: "w-park", type: "fill", ...src, "source-layer": "park", filter: areas, paint: { "fill-color": c.worldGreen } },
    { id: "w-homes", type: "fill", ...src, "source-layer": "landuse", filter: ["all", areas, cls("residential", "suburb", "neighbourhood")], paint: { "fill-color": c.worldHomes } },
    { id: "w-water", type: "fill", ...src, "source-layer": "water", filter: ["all", areas, ["!=", ["get", "brunnel"], "tunnel"]], paint: { "fill-color": c.water } },
    { id: "w-waterway", type: "line", ...src, "source-layer": "waterway", filter: lines, paint: { "line-color": c.water, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.6, 18, 4] } },
    {
      id: "w-path", type: "line", ...src, "source-layer": "transportation", minzoom: 15, filter: ["all", lines, cls("path"), ["!=", ["get", "brunnel"], "tunnel"]],
      paint: { "line-color": c.foot, "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.8, 19, 3], "line-dasharray": [1.5, 1.2] },
    },
    {
      id: "w-minor-casing", type: "line", ...src, "source-layer": "transportation", filter: ["all", lines, cls("minor", "service", "track")],
      layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": c.worldCasing, "line-width": width(3, 20) },
    },
    {
      id: "w-major-casing", type: "line", ...src, "source-layer": "transportation", filter: ["all", lines, cls("motorway", "trunk", "primary", "secondary", "tertiary")],
      layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": c.worldCasing, "line-width": width(6, 32) },
    },
    {
      id: "w-minor", type: "line", ...src, "source-layer": "transportation", filter: ["all", lines, cls("minor", "service", "track")],
      layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": c.worldRoad, "line-width": width(2, 17) },
    },
    {
      id: "w-major", type: "line", ...src, "source-layer": "transportation", filter: ["all", lines, cls("motorway", "trunk", "primary", "secondary", "tertiary")],
      layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": c.worldMajor, "line-width": width(4.5, 28) },
    },
    {
      id: "w-road-names", type: "symbol", ...src, "source-layer": "transportation_name", minzoom: 15, filter: lines,
      layout: { ...text(11), "symbol-placement": "line", "text-rotation-alignment": "map" }, paint: halo,
    },
    {
      id: "w-places", type: "symbol", ...src, "source-layer": "place", filter: cls("city", "town", "village", "suburb", "neighbourhood", "hamlet"),
      layout: { ...text(["match", ["get", "class"], ["city", "town"], 15, 12.5]), "text-transform": "uppercase", "text-letter-spacing": 0.12 }, paint: halo,
    },
    {
      id: "w-buildings", type: "fill-extrusion", ...src, "source-layer": "building", minzoom: 14,
      filter: ["all", ["!=", ["get", "hide_3d"], true], [">", ["distance", ours], 0.5]],
      paint: {
        "fill-extrusion-color": c.worldBuilding,
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 5],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.85,
      },
    },
  ];
}

/** Map style: our own campus data on top of the world basemap. The campus works with no network beyond our own site. */
function campusStyle(c, campus, basemap) {
  const building = (kind) => ["==", ["get", "kind"], kind];
  const world = basemap ? worldLayers(c, campus) : [];
  const under = world.filter((l) => l.type !== "fill-extrusion");
  const over = world.filter((l) => l.type === "fill-extrusion");
  return {
    version: 8,
    sources: {
      ...(basemap ? { world: { type: "vector", url: basemap } } : {}),
      campus: { type: "geojson", data: campus, attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>' },
      route: { type: "geojson", data: EMPTY },
      accuracy: { type: "geojson", data: EMPTY },
    },
    sky: { "sky-color": c.sky, "horizon-color": c.horizon, "fog-color": c.sky, "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.4 },
    light: { anchor: "viewport", color: "#ffffff", intensity: 0.32, position: [1.2, 200, 35] },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": c.bg } },
      ...under,
      { id: "campus", type: "fill", source: "campus", filter: building("campus"), paint: { "fill-color": c.campus } },
      { id: "green", type: "fill", source: "campus", filter: building("green"), paint: { "fill-color": c.green } },
      { id: "parking", type: "fill", source: "campus", filter: building("parking"), paint: { "fill-color": c.parking } },
      { id: "water", type: "fill", source: "campus", filter: building("water"), paint: { "fill-color": c.water } },
      { id: "stream", type: "line", source: "campus", filter: building("stream"), paint: { "line-color": c.water, "line-width": 3 } },
      {
        id: "road-casing", type: "line", source: "campus",
        filter: ["all", building("way"), ["!", ["in", ["get", "highway"], ["literal", ["footway", "path", "steps", "cycleway", "pedestrian"]]]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.roadCasing, "line-width": ["interpolate", ["exponential", 2], ["zoom"], 15, 3, 19, 22] },
      },
      {
        id: "road", type: "line", source: "campus",
        filter: ["all", building("way"), ["!", ["in", ["get", "highway"], ["literal", ["footway", "path", "steps", "cycleway", "pedestrian"]]]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.road, "line-width": ["interpolate", ["exponential", 2], ["zoom"], 15, 2, 19, 18] },
      },
      {
        id: "foot", type: "line", source: "campus",
        filter: ["all", building("way"), ["in", ["get", "highway"], ["literal", ["footway", "path", "steps", "cycleway", "pedestrian"]]]],
        layout: { "line-cap": "round" },
        paint: { "line-color": c.foot, "line-width": ["interpolate", ["linear"], ["zoom"], 15, 1, 19, 4], "line-dasharray": [1.5, 1.2] },
      },
      { id: "accuracy", type: "fill", source: "accuracy", paint: { "fill-color": c.me, "fill-opacity": 0.12 } },
      { id: "accuracy-edge", type: "line", source: "accuracy", paint: { "line-color": c.me, "line-opacity": 0.35, "line-width": 1 } },
      {
        id: "route-casing", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.routeCasing, "line-width": ["interpolate", ["linear"], ["zoom"], 15, 6, 19, 16], "line-opacity": 0.9 },
      },
      {
        id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.route, "line-width": ["interpolate", ["linear"], ["zoom"], 15, 3.5, 19, 10] },
      },
      {
        id: "roofs", type: "fill-extrusion", source: "campus", filter: building("roof"),
        paint: { "fill-extrusion-color": c.roof, "fill-extrusion-height": ["get", "height"], "fill-extrusion-base": ["get", "base"], "fill-extrusion-opacity": 0.55 },
      },
      {
        id: "buildings", type: "fill-extrusion", source: "campus", filter: building("building"),
        paint: {
          "fill-extrusion-color": ["case", ["boolean", ["feature-state", "focus"], false], c.focus, ["boolean", ["feature-state", "mine"], false], c.buildingMine, ["!=", ["get", "code"], null], c.building, c.buildingOther],
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-base": ["get", "base"],
          "fill-extrusion-opacity": 0.94,
          "fill-extrusion-vertical-gradient": true,
        },
      },
      ...over,
    ],
  };
}

/**
 * Open the 3D campus map.
 *   maplibreUrl  URL of maplibre-gl.mjs (its CSS sits next to it)
 *   campusUrl, pathsUrl  data/campus/campus.geojson and paths.json
 *   photosUrl    data/campus/photos.json: real pictures of the buildings (their files are relative to it)
 *   panoramasUrl data/campus/panoramas.json: 360° photos of the campus (their files are relative to it)
 *   pannellumUrl the Pannellum panorama viewer's script (its CSS sits next to it), loaded when first needed
 *   streetViewsUrl  data/campus/streetviews.json: Google Maps 360° views to open inside the map (no key)
 *   googleEmbedKey  a Google Maps Embed API key; with it, Street View opens inside the map instead of Google Maps
 *   style        "ink" | "neon"
 *   focus        building code to show ("SK3"), or null
 *   navigate     start walking directions to focus right away
 *   classes      [{ code, room, title, when }] the timetable's classes, shown per building
 *   classLabel   "2E3" (used in texts)
 *   basemap      TileJSON URL of the world map around the campus (OpenFreeMap by default), or false
 *   returnFocus  () => element to focus after closing, if the button that opened the map is gone
 *   compassPermission  the promise from DeviceOrientationEvent.requestPermission() if the page already
 *                asked during the tap that opened the map (iPhone only lets a page ask during a tap)
 */
export function openCampusMap(options) {
  if (current) {
    current.focus(options.focus, options.navigate, options.compassPermission);
    return current.close;
  }
  const { maplibreUrl, campusUrl, pathsUrl, photosUrl = null, panoramasUrl = null, pannellumUrl = null, streetViewsUrl = null, googleEmbedKey = "", style = "ink", classes = [], classLabel = "", basemap = OPENFREEMAP } = options;
  const c = { ...PALETTES[style === "neon" ? "neon" : "ink"], ...(options.palette || {}) };
  const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const html = document.documentElement;
  const body = document.body;
  let closed = false;

  // ----- DOM -----
  const overlay = el("div", { class: `cm cm-${style}`, role: "dialog", "aria-modal": "true", "aria-label": "校园地图", tabindex: "-1" });
  for (const [k, v] of Object.entries({ bg: c.bg, panel: c.panel, text: c.text, muted: c.muted, line: c.line, accent: c.accent, "on-accent": c.onAccent, me: c.me, font: c.font, label: c.label })) {
    overlay.style.setProperty(`--cm-${k}`, v);
  }
  const mapBox = el("div", { class: "cm-map" });
  const subtitle = el("span", { text: "Curtin Malaysia · 1:1 3D" });
  const listBtn = el("button", { class: "cm-btn", type: "button", "aria-label": "楼列表", html: ICON.list });
  const closeBtn = el("button", { class: "cm-btn", type: "button", "aria-label": "关闭地图", html: ICON.back });
  const top = el("div", { class: "cm-top" }, [closeBtn, el("div", { class: "cm-title" }, [el("b", { text: "校园地图" }), subtitle]), listBtn]);
  const locateBtn = el("button", { class: "cm-btn", type: "button", "aria-label": "显示我的位置", "aria-pressed": "false", html: ICON.locate });
  const pitchBtn = el("button", { class: "cm-btn", type: "button", "aria-label": "切换 2D / 3D", text: "2D" });
  const northBtn = el("button", { class: "cm-btn cm-north", type: "button", "aria-label": "指向正北", html: ICON.north });
  const compassBtn = el("button", { class: "cm-btn cm-compass", type: "button", "aria-label": "方向校准", title: "方向校准", html: ICON.compass, hidden: true });
  const fabs = el("div", { class: "cm-fabs" }, [locateBtn, compassBtn, pitchBtn, northBtn]);
  const sheet = el("div", { class: "cm-sheet" });
  const announcer = el("div", { class: "cm-sr", role: "status", "aria-live": "polite" });
  const msg = el("div", { class: "cm-msg", role: "status" });
  const loading = el("div", { class: "cm-loading", text: "正在载入 3D 校园地图…" });
  const styleTag = el("style", { text: CSS });
  overlay.append(styleTag, mapBox, loading, top, fabs, sheet, msg, announcer);
  const sheetSize = typeof ResizeObserver === "function" ? new ResizeObserver(() => overlay.style.setProperty("--cm-sheet", `${sheet.offsetHeight}px`)) : null;
  sheetSize?.observe(sheet);

  // MapLibre's stylesheet (once per page)
  const cssUrl = new URL("maplibre-gl.css", new URL(maplibreUrl, document.baseURI)).href;
  if (!document.querySelector(`link[data-cm-css]`)) document.head.append(el("link", { rel: "stylesheet", href: cssUrl, "data-cm-css": "1" }));

  // ----- page lock (like the game overlay): no scroll behind, page inert, back button closes -----
  const scrollY = window.scrollY;
  const previousFocus = document.activeElement;
  const saved = { htmlOverflow: html.style.overflow, position: body.style.position, top: body.style.top, width: body.style.width, left: body.style.left, right: body.style.right };
  body.append(overlay);
  const inerted = [];
  for (const child of body.children) {
    if (child !== overlay && !child.inert && child.tagName !== "SCRIPT" && child.tagName !== "STYLE") {
      child.inert = true;
      inerted.push(child);
    }
  }
  html.style.overflow = "hidden";
  Object.assign(body.style, { position: "fixed", top: `-${scrollY}px`, left: "0", right: "0", width: "100%" });
  overlay.style.setProperty("--cm-host", getComputedStyle(html).getPropertyValue("--host-inset") || "0px");
  let historyPushed = false;
  try {
    history.pushState({ ...(history.state || {}), __campusMap: true }, "");
    historyPushed = true;
  } catch {
    /* ignore */
  }
  let ignorePops = 0;
  const onPop = () => {
    if (ignorePops > 0) {
      ignorePops--;
      return;
    }
    const layer = [...overlay.querySelectorAll(".cm-list, .cm-photo")].at(-1);
    if (layer) layer.closeLayer(true);
    else close({ fromHistory: true });
  };
  // the building list and the photo viewer each get a history entry, so Back closes them, not the map
  let layers = 0;
  function pushLayer(node) {
    let pushed = false;
    try {
      history.pushState({ ...(history.state || {}), __campusLayer: layers + 1 }, "");
      pushed = true;
      layers++;
    } catch {
      /* ignore */
    }
    node.closeLayer = (fromHistory = false) => {
      if (!node.isConnected) return;
      node.remove();
      if (!pushed) return;
      layers--;
      if (!fromHistory) {
        ignorePops++;
        history.back();
      }
    };
  }
  window.addEventListener("popstate", onPop);
  overlay.focus({ preventScroll: true });

  // ----- state -----
  let map = null;
  let maplibre = null;
  let campus = null;
  let router = null;
  let buildings = new Map(); // code -> feature
  let focusCode = null;
  let me = null; // { lon, lat, accuracy, at }: smoothed position, accuracy as the phone reports it
  const positionFilter = createPositionFilter();
  let heading = null; // where the phone points, degrees from north, smoothed and calibrated
  let rawHeading = null; // the same straight from the compass
  // the student's own correction for this phone's compass (方向校准), kept for a few hours
  const OFFSET_KEY = "cm:compass-offset";
  let headingOffset = 0;
  try {
    const saved = JSON.parse(localStorage.getItem(OFFSET_KEY) || "null");
    if (saved && Date.now() - saved.at < 6 * 3600_000 && Number.isFinite(saved.offset)) headingOffset = saved.offset;
  } catch {
    /* private mode */
  }
  let course = null; // direction of travel from GPS, when walking and there is no compass
  let watchId = null;
  let meMarker = null;
  let pinMarker = null;
  let nav = null; // { code, route, lastRoute, arrived, offCount }
  let ready = false; // the map's style is in: labels, taps and the sheet work (the basemap may still be loading)
  let follow = false;
  let wakeLock = null;
  const labels = [];
  const byCode = new Map(); // code -> [class]
  function indexClasses() {
    const known = new Set(buildings.keys());
    for (const cls of classes) {
      cls.code ??= buildingForRoom(cls.room, { codes: known });
      if (!cls.code) continue;
      if (!byCode.has(cls.code)) byCode.set(cls.code, []);
      byCode.get(cls.code).push(cls);
    }
  }

  const say = (text, ms = 3500) => {
    msg.textContent = text;
    clearTimeout(say.timer);
    if (ms) say.timer = setTimeout(() => (msg.textContent = ""), ms);
  };

  // ----- loading -----
  (async () => {
    try {
      const [lib, campusData, pathsData] = await Promise.all([
        import(new URL(maplibreUrl, document.baseURI).href), // page-relative, not module-relative
        fetch(campusUrl).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`campus ${r.status}`)))),
        fetch(pathsUrl).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`paths ${r.status}`)))),
      ]);
      if (closed) return;
      maplibre = lib;
      campus = campusData;
      router = createRouter(pathsData);
      for (const f of campus.features) if (f.properties.code) buildings.set(f.properties.code, f);
      indexClasses();
      start();
    } catch (error) {
      console.warn(error);
      if (closed) return;
      loading.classList.add("cm-failed");
      loading.replaceChildren(
        el("span", { text: "地图载入失败。检查一下网络，再重新载入页面。" }),
        el("button", { class: "cm-btn cm-primary", type: "button", text: "重新载入", onclick: () => location.reload() })
      );
    }
  })();

  // The overview is fitted to where the coded buildings really land on screen, 3D perspective included,
  // between the title bar and the sheet. It tries a few bearings around the official map's "west at the
  // top" and keeps the one that shows the campus largest (the campus is about as wide as it is long, so a
  // slight turn often fits a tall phone screen better).
  let campusPoints = null;
  function overviewCamera() {
    campusPoints ??= [...buildings.values()].flatMap((f) => f.geometry.coordinates[0]);
    const w = mapBox.clientWidth || 390;
    const h = mapBox.clientHeight || 700;
    const box = { left: 6, right: w - 6, top: 76, bottom: h - Math.min(Math.max(sheet.offsetHeight, 150) + 6, h * 0.5) };
    const saved = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), padding: map.getPadding() };
    let best = null;
    for (const bearing of [240, 255, 270, 285, 300]) {
      const camera = fitPoints(campusPoints, bearing, 48, box);
      const score = camera.zoom - Math.abs(bearing - 270) / 150;
      if (!best || score > best.score) best = { ...camera, score };
    }
    map.jumpTo(saved); // all of this happens before the next frame is drawn
    delete best.score;
    return best;
  }
  function fitPoints(points, bearing, pitch, box) {
    const padding = { top: 0, bottom: 0, left: 0, right: 0 };
    const w = mapBox.clientWidth || 390;
    const h = mapBox.clientHeight || 700;
    let center = campus.meta.centre;
    let zoom = 16;
    for (let round = 0; round < 6; round++) {
      map.jumpTo({ center, zoom, bearing, pitch, padding });
      const xy = points.map((p) => map.project(p));
      const xs = xy.map((p) => p.x);
      const ys = xy.map((p) => p.y);
      const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      // move the drawing's middle to the middle of the free area, then scale it to fit
      center = map.unproject([w / 2 + (left + right) / 2 - (box.left + box.right) / 2, h / 2 + (top + bottom) / 2 - (box.top + box.bottom) / 2]).toArray();
      const scale = Math.min((box.right - box.left) / Math.max(1, right - left), (box.bottom - box.top) / Math.max(1, bottom - top));
      zoom = Math.min(19, Math.max(14, zoom + Math.log2(scale)));
      if (Math.abs(Math.log2(scale)) < 0.01) break;
    }
    return { center, zoom, bearing, pitch, padding };
  }

  function start() {
    const [w, s, e, n] = campus.meta.bounds;
    try {
      map = new maplibre.Map({
        container: mapBox,
        style: campusStyle(c, campus, basemap),
        center: campus.meta.centre,
        zoom: 16,
        pitch: 52,
        bearing: 270, // like the official campus map: west at the top
        maxPitch: 78,
        minZoom: basemap ? 12 : 14.5,
        maxZoom: 20.5,
        maxBounds: basemap ? [[w - 0.25, s - 0.25], [e + 0.25, n + 0.25]] : [[w - 0.012, s - 0.012], [e + 0.012, n + 0.012]],
        attributionControl: { compact: true },
        localIdeographFontFamily: c.font,
        fadeDuration: 0,
      });
    } catch (error) {
      loading.textContent = "这台手机的浏览器不支持 3D 地图（WebGL）。";
      console.warn(error);
      return;
    }
    map.jumpTo(overviewCamera());
    if (options.debug) window.__campusMap = map;
    let warned = 0;
    map.on("error", (event) => {
      // an unreachable basemap only blanks the surroundings; say so once in the console
      if (warned++ < 3) console.warn("map:", event?.sourceId || "", event?.error?.message || event);
    });
    // the campus is drawn from our own data; hide the loading text once it is in (or after a while anyway)
    const loaded = () => {
      if (loading.isConnected && !loading.classList.contains("cm-failed")) loading.remove();
    };
    map.on("sourcedata", (event) => {
      if (event.sourceId === "campus" && map.isSourceLoaded("campus")) loaded();
    });
    setTimeout(loaded, 8000);
    map.once("style.load", () => {
      if (closed) return;
      // MapLibre unfolds the compact attribution each time new credits arrive (the basemap's come later);
      // keep it folded over the map until the student taps the ⓘ themselves
      let creditsOpened = false;
      overlay.addEventListener("click", (event) => {
        if (event.target.closest?.(".maplibregl-ctrl-attrib-button")) creditsOpened = true;
      });
      const foldCredits = () => {
        if (!creditsOpened) overlay.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show")?.classList.remove("maplibregl-compact-show");
      };
      map.on("data", foldCredits);
      foldCredits();
      const northIcon = northBtn.firstElementChild;
      const turnCompass = () => (northIcon.style.transform = `rotate(${-map.getBearing()}deg)`);
      map.on("rotate", turnCompass);
      turnCompass();
      for (const f of campus.features) {
        if (f.properties.kind === "building" && f.id != null && byCode.has(f.properties.code)) map.setFeatureState({ source: "campus", id: f.id }, { mine: true });
      }
      addLabels();
      map.on("click", "buildings", (event) => {
        const f = event.features?.[0];
        if (f?.properties?.code) select(f.properties.code);
        else if (f) showOther(f.properties, campus.features.find((x) => x.id != null && x.id === f.id) || { ...f, properties: { ...f.properties, centre: [event.lngLat.lng, event.lngLat.lat] } });
      });
      map.on("mouseenter", "buildings", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "buildings", () => (map.getCanvas().style.cursor = ""));
      map.on("dragstart", () => {
        if (follow) setFollow(false);
      });
      map.on("zoomend", updateLabelsVisibility);
      map.on("moveend", updateLabelsVisibility);
      map.on("rotateend", updateLabelsVisibility);
      // the follow camera must not fight the student's fingers: pause it while they touch or scroll the map
      mapBox.addEventListener("touchstart", () => (touching = true), { passive: true });
      const untouch = (event) => {
        if (!event.touches?.length) touching = false;
      };
      mapBox.addEventListener("touchend", untouch, { passive: true });
      mapBox.addEventListener("touchcancel", untouch, { passive: true });
      mapBox.addEventListener("wheel", () => (wheelAt = Date.now()), { passive: true });
      updateLabelsVisibility();
      ready = true;
      showPanoramaSpots();
      if (options.focus) select(options.focus, { navigate: options.navigate });
      else {
        idleSheet();
        map.jumpTo(overviewCamera()); // again, now that the sheet's real height is known
      }
    });
  }
  let touching = false;
  let wheelAt = 0;
  const handsOn = () => touching || Date.now() - wheelAt < 1000;

  // ----- labels (HTML, so Chinese and our fonts render without a glyph server) -----
  function addLabels() {
    for (const [code, f] of buildings) {
      const mine = byCode.has(code);
      const node = el("div", { class: `cm-label${mine ? " cm-mine" : ""}`, "data-code": code }, [el("b", { text: code })]);
      const marker = new maplibre.Marker({ element: node, anchor: "bottom" }).setLngLat(f.properties.centre).addTo(map);
      labels.push({ code, node, marker, mine });
    }
  }
  function updateLabelsVisibility() {
    if (!map) return;
    const z = map.getZoom();
    for (const l of labels) {
      const show = l.code === focusCode || (z >= 15 && (z >= 15.8 || l.mine)); // all codes from the campus overview in
      l.node.style.display = show ? "" : "none";
    }
    cancelAnimationFrame(updateLabelsVisibility.frame);
    updateLabelsVisibility.frame = requestAnimationFrame(declutter);
  }
  function declutter() {
    const nextCode = classes.find((m) => m.next && m.code)?.code;
    const rank = (l) => (l.code === focusCode ? 3 : l.code === nextCode ? 2 : l.mine ? 1 : 0);
    const placed = [];
    for (const l of [...labels].sort((a, b) => rank(b) - rank(a))) {
      if (l.node.style.display === "none") continue;
      l.node.style.visibility = "";
      const r = l.node.getBoundingClientRect();
      const hit = placed.some((p) => r.left < p.right + 2 && r.right > p.left - 2 && r.top < p.bottom + 2 && r.bottom > p.top - 2);
      if (hit) l.node.style.visibility = "hidden";
      else placed.push(r);
    }
  }
  function markFocusLabel() {
    for (const l of labels) {
      l.node.classList.toggle("cm-focus", l.code === focusCode);
      const f = buildings.get(l.code);
      const small = l.node.querySelector("small");
      if (l.code === focusCode && !small) l.node.append(el("small", { text: f.properties.zh || f.properties.name || "" }));
      else if (l.code !== focusCode && small) small.remove();
    }
    updateLabelsVisibility();
  }

  // ----- selection / sheet -----
  function setFocusState(code) {
    for (const [k, f] of buildings) if (f.id != null) map.setFeatureState({ source: "campus", id: f.id }, { focus: k === code });
  }

  // keep what the camera looks at in the part of the map the sheet leaves free
  function sheetPadding() {
    const free = mapBox.clientHeight - 70 - 80;
    return { top: 70, bottom: Math.max(0, Math.min(sheet.offsetHeight + 12, free)), left: 0, right: 0 };
  }
  function cameraTo(centre, { zoom = 17.6, pitch = 58, bearing = map.getBearing(), duration = 900 } = {}) {
    map.easeTo({ center: centre, zoom, pitch, bearing, duration: reduceMotion ? 0 : duration, padding: sheetPadding() });
  }

  function select(code, { navigate = false } = {}) {
    const f = buildings.get(code);
    if (!f) {
      say(`地图上找不到 ${code}`);
      return;
    }
    if (nav && !nav.arrived && !navigate) {
      // keep walking to the destination; just say what this building is
      say(code === nav.code ? `${code} 就是目的地。` : `${code} · ${f.properties.zh || f.properties.name || ""}。要改去这里，先结束这次导航。`, 4000);
      return;
    }
    if (nav) stopNavigation(); // a new destination, or already arrived at the last one
    if (follow) setFollow(false); // looking somewhere else: stop pulling the camera back to the walker
    focusCode = code;
    setFocusState(code);
    markFocusLabel();
    buildingSheet(code); // first, so the camera knows how tall the sheet is
    cameraTo(f.properties.centre);
    if (navigate) beginNavigation(code);
  }

  function buildingSheet(code) {
    const f = buildings.get(code);
    const p = f.properties;
    const mine = byCode.get(code) || [];
    // half picture (this building, or the nearest real picture), half options
    sheet.replaceChildren(
      mediaPane(placeOf(f, code)),
      el("div", { class: "cm-opts" }, [
        el("h2", {}, [p.code, el("small", { text: [p.name, p.zh].filter(Boolean).join(" · ") })]),
        mine.length
          ? el("ul", {}, mine.slice(0, 6).map((m) => el("li", {}, [el("b", { text: m.when }), ` ${m.title} · ${m.room}`])))
          : el("p", { text: p.osmName ? `OpenStreetMap：${p.osmName}` : `${classLabel} 这周没有课在这里。` }),
        el("div", { class: "cm-actions" }, [
          el("button", { class: "cm-btn cm-primary", type: "button", onclick: () => select(code, { navigate: true }) }, [el("span", { html: ICON.flag }), "带我去"]),
          el("button", { class: "cm-btn", type: "button", text: "看全校", onclick: overview }),
        ]),
        realViews(f),
      ])
    );
    sheet.scrollTop = 0;
  }

  // ----- real-world pictures -----
  // A building's sheet starts with its pictures (mediaPane below). Street View, satellite and the place in
  // Google Maps also open in the Maps app or site (plain Maps URLs, no key).
  // street view cars drive on roads: stand on the nearest one and look at the building
  const DRIVEN = new Set(["service", "residential", "unclassified", "living_street", "tertiary", "secondary", "primary", "trunk"]);
  let roads = null;
  function roadsideSpot(centre) {
    roads ??= campus.features.filter((x) => x.properties.kind === "way" && DRIVEN.has(x.properties.highway)).map((x) => x.geometry.coordinates);
    let best = null;
    for (const line of roads) {
      for (let i = 0; i < line.length - 1; i++) {
        const p = closestPointOnSegment(centre, line[i], line[i + 1]);
        const d = metresBetween(centre, p);
        if (!best || d < best.d) best = { p, d };
      }
    }
    return best && best.d < 150 ? best.p : centre;
  }
  function realViews(f) {
    const code = f.properties.code;
    const [lon, lat] = f.properties.centre;
    const [vlon, vlat] = roadsideSpot(f.properties.centre);
    const look = Math.round(bearingDeg([vlon, vlat], [lon, lat]));
    const at = (n) => n.toFixed(6);
    const link = (text, href) => el("a", { class: "cm-btn", href, target: "_blank", rel: "noopener" }, [text, el("span", { html: ICON.out })]);
    const street = googleEmbedKey
      ? el("button", { class: "cm-btn cm-street", type: "button", text: "街景", onclick: () => streetViewHere([vlon, vlat], look, code) })
      : link("街景", `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${at(vlat)},${at(vlon)}&heading=${look}&pitch=5&fov=80`);
    const row = el("div", { class: "cm-real" }, [
      el("span", { text: "看实景" }),
      street,
      link("卫星图", `https://www.google.com/maps/@?api=1&map_action=map&center=${at(lat)},${at(lon)}&zoom=19&basemap=satellite`),
      link("Google 地图", `https://www.google.com/maps/search/?api=1&query=${at(lat)},${at(lon)}`),
    ]);
    // our own 360° photo near this building: a draggable view right here, facing the building
    loadPanoramas().then((list) => {
      const near = list
        .map((x) => ({ x, d: metresBetween([x.lon, x.lat], f.properties.centre) }))
        .filter(({ d }) => d < 100)
        .sort((a, b) => a.d - b.d)[0];
      if (!near || !row.isConnected) return;
      row.insertBefore(el("button", { class: "cm-btn cm-pano-btn", type: "button", onclick: () => openPanorama(near.x, f.properties.centre, code) }, [el("span", { html: ICON.pano }), "360°"]), row.children[1]);
    });
    // a Google 360° view we know of at (or near) this building, the same one the picture half shows
    // first: 街景 opens that one in Google Maps (the roadside spot above often has none)
    if (!googleEmbedKey) {
      loadPictures().then(() => {
        const found = picturesFor(placeOf(f, code));
        const view = found.list.find((pic) => pic.kind === "google" && (!found.near || pic.d < 150));
        if (!view) return;
        const x = view.x;
        const heading = Math.round(bearingDeg([x.lon, x.lat], f.properties.centre));
        street.href = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${at(x.lat)},${at(x.lon)}${x.pano ? `&pano=${encodeURIComponent(x.pano)}` : ""}&heading=${heading}&pitch=0&fov=80`;
      });
    }
    return row;
  }

  // ----- Google 360° views inside the map (Google's own embed, no key) -----
  let streetViews = null;
  let noGoogleView = null; // buildings Google has no 360° view near
  async function loadStreetViews() {
    if (streetViews || !streetViewsUrl) return streetViews || [];
    try {
      const data = await fetch(new URL(streetViewsUrl, document.baseURI)).then((r) => (r.ok ? r.json() : null));
      if (data) noGoogleView = new Set(Array.isArray(data.noGoogleView) ? data.noGoogleView : []);
      // a view is found by its photo id, or by its exact position (Google shows the view nearest to it)
      streetViews = (Array.isArray(data?.views) ? data.views : []).filter((x) => Number.isFinite(x.lon) && Number.isFinite(x.lat));
    } catch {
      streetViews = [];
    }
    return streetViews;
  }
  const googleView = (x, heading) => (x.pano ? streetViewEmbed(x, heading, 0) : streetViewAt(x, heading, 0));
  function openStreetView(x, target, code) {
    const heading = target ? bearingDeg([x.lon, x.lat], target) : x.heading || 0;
    const frame = el("iframe", { src: googleView(x, heading), title: x.title || "街景", allowfullscreen: true, loading: "eager", referrerpolicy: "strict-origin-when-cross-origin" });
    viewerLayer(x.title || (code ? `${code} 街景` : "街景"), frame, ["Google 地图 360° 实景 · 拖动看四周，点箭头往前走"]);
  }

  // ----- 360° photos (Pannellum) and Street View inside the map -----
  let panoramas = null;
  async function loadPanoramas() {
    if (panoramas || !panoramasUrl) return panoramas || [];
    try {
      const base = new URL(panoramasUrl, document.baseURI);
      const data = await fetch(base).then((r) => (r.ok ? r.json() : null));
      panoramas = (Array.isArray(data?.panoramas) ? data.panoramas : [])
        .filter((x) => x.file && Number.isFinite(x.lon) && Number.isFinite(x.lat))
        .map((x) => ({ ...x, url: new URL(x.file, base).href, thumb: x.thumb ? new URL(x.thumb, base).href : null }));
    } catch {
      panoramas = [];
    }
    return panoramas;
  }
  let panoramaMarkers = [];
  async function showPanoramaSpots() {
    const [ours, google] = await Promise.all([loadPanoramas(), loadStreetViews()]);
    if (closed || !(ours.length + google.length)) return;
    const spot = (x, open) => {
      const node = el("button", { class: "cm-pano", type: "button", "aria-label": `360° 实景：${x.title || ""}`, html: ICON.pano, onclick: (event) => {
        event.stopPropagation();
        open();
      } });
      return new maplibre.Marker({ element: node }).setLngLat([x.lon, x.lat]).addTo(map);
    };
    panoramaMarkers = [
      ...ours.map((x) => spot(x, () => openPanorama(x, null, null))),
      ...google.map((x) => {
        const marker = spot(x, () => openStreetView(x, null, x.near));
        marker.getElement().classList.add("cm-pano-g"); // there are many: smaller, and only close up
        return marker;
      }),
    ];
    const toggle = () => {
      const zoom = map.getZoom();
      for (const m of panoramaMarkers) m.getElement().style.display = zoom >= (m.getElement().classList.contains("cm-pano-g") ? 17.8 : 16.6) ? "" : "none";
    };
    map.on("zoomend", toggle);
    toggle();
  }
  let pannellumReady = null;
  function loadPannellum() {
    if (!pannellumUrl) return Promise.reject(new Error("no pannellumUrl"));
    if (window.pannellum) return Promise.resolve(window.pannellum);
    pannellumReady ??= new Promise((resolve, reject) => {
      const src = new URL(pannellumUrl, document.baseURI);
      if (!document.querySelector("link[data-cm-pnlm]")) document.head.append(el("link", { rel: "stylesheet", href: new URL("pannellum.css", src).href, "data-cm-pnlm": "1" }));
      const script = el("script", { src: src.href });
      script.onload = () => (window.pannellum ? resolve(window.pannellum) : reject(new Error("pannellum missing")));
      script.onerror = () => {
        pannellumReady = null;
        reject(new Error("pannellum failed to load"));
      };
      document.head.append(script);
    });
    return pannellumReady;
  }
  // a full-screen layer with a header and a footer (credits); Back / Esc / the arrow close it
  function viewerLayer(title, body, credits, onClose) {
    const box = el("div", { class: "cm-photo", role: "dialog", "aria-label": title });
    pushLayer(box);
    const closeBox = box.closeLayer;
    box.closeLayer = (fromHistory) => {
      onClose?.();
      closeBox(fromHistory);
    };
    box.append(
      el("header", {}, [el("button", { class: "cm-btn", type: "button", "aria-label": "关闭", html: ICON.back, onclick: () => box.closeLayer() }), el("b", { text: title })]),
      body,
      el("footer", {}, credits)
    );
    overlay.append(box);
    box.querySelector("button")?.focus();
    return box;
  }
  async function openPanorama(x, target, code) {
    const holder = el("div", { class: "cm-pano-box" });
    let viewer = null;
    const credits = [
      x.author ? `${x.author} · ` : "",
      x.licenseUrl ? el("a", { href: x.licenseUrl, target: "_blank", rel: "noopener", text: x.license || "licence" }) : x.license || "",
      x.taken ? ` · ${x.taken}` : "",
      " · 拖动看四周，双指缩放",
    ];
    viewerLayer(x.title || (code ? `${code} 360°` : "360° 实景"), holder, credits, () => viewer?.destroy?.());
    try {
      const pannellum = await loadPannellum();
      if (!holder.isConnected) return;
      const north = Number.isFinite(x.north) ? x.north : 0; // the compass heading at the middle of the photo
      const yaw = target ? ((bearingDeg([x.lon, x.lat], target) - north + 540) % 360) - 180 : 0;
      viewer = pannellum.viewer(holder, {
        type: "equirectangular",
        panorama: x.url,
        autoLoad: true,
        crossOrigin: "anonymous",
        yaw,
        pitch: 0,
        hfov: 100,
        northOffset: north,
        compass: true,
        showFullscreenCtrl: false,
        ...(x.haov ? { haov: x.haov } : {}),
        ...(x.vaov ? { vaov: x.vaov } : {}),
        ...(x.vOffset != null ? { vOffset: x.vOffset } : {}),
        strings: { loadingLabel: "正在载入…", loadButtonLabel: "点这里载入", genericWebGLError: "这台手机的浏览器显示不了全景图。", fileAccessError: "全景图载不进来。" },
      });
      if (options.debug) window.__campusPano = viewer;
    } catch (error) {
      console.warn(error);
      holder.textContent = "全景查看器载入失败，检查网络后再试。";
    }
  }
  function streetViewHere([lon, lat], heading, code) {
    const src = `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(googleEmbedKey)}&location=${lat.toFixed(6)},${lon.toFixed(6)}&heading=${heading}&pitch=5&fov=80`;
    const frame = el("iframe", { src, title: `${code} 街景`, allowfullscreen: true, loading: "eager", referrerpolicy: "strict-origin-when-cross-origin" });
    viewerLayer(`${code} 街景`, frame, ["Google 街景 · 拖动看四周（附近没有街景时会显示空白）"]);
  }
  let photos = null; // [] once loaded (or failed)
  async function loadPhotos() {
    if (photos || !photosUrl) return photos || [];
    try {
      const base = new URL(photosUrl, document.baseURI);
      const data = await fetch(base).then((r) => (r.ok ? r.json() : null));
      photos = (Array.isArray(data?.photos) ? data.photos : [])
        .filter((x) => x.thumb && x.full)
        .map((x) => ({ ...x, thumb: new URL(x.thumb, base).href, full: new URL(x.full, base).href }));
    } catch {
      photos = [];
    }
    return photos;
  }

  // ----- the picture half of a sheet -----
  // Every real picture we have and the spot it shows: a photo filed under buildings ("codes") shows them;
  // a located photo or a 360° view shows where it was taken.
  let pictures = null;
  async function loadPictures() {
    if (pictures) return pictures;
    const [ph, pa, gv] = await Promise.all([loadPhotos(), loadPanoramas(), loadStreetViews()]);
    const spot = (x) => (Number.isFinite(x.lon) && Number.isFinite(x.lat) ? [x.lon, x.lat] : null);
    const codesOf = (x) => [...(Array.isArray(x.codes) ? x.codes : []), ...(x.near ? [x.near] : [])].filter((k) => buildings.has(k));
    const centreOf = (codes) => (codes.length ? buildings.get(codes[0]).properties.centre : null);
    const walls = campus.features.filter((f) => f.properties.kind === "building" && f.id != null);
    // the building a picture was taken inside, if any: it then only counts as that building's own (a few
    // metres in from the outline, which is about as good as the map's outlines and the photos' positions)
    const inside = (point) => (point ? walls.find((f) => outlines(f.geometry).some((outer) => pointInRing(point, outer)) && toOutline(f.geometry, point) > 3)?.id ?? null : null);
    pictures = [
      ...ph.map((x) => ({ kind: "photo", x, codes: codesOf(x), from: spot(x), at: centreOf(codesOf(x)) || spot(x) })),
      ...gv.map((x) => ({ kind: "google", x, codes: codesOf(x), from: spot(x), at: spot(x) })),
      ...pa.map((x) => ({ kind: "pano", x, codes: codesOf(x), from: spot(x), at: spot(x) })),
    ].map((pic) => ({ ...pic, inside: inside(pic.from) }));
    return pictures;
  }
  const outlines = (g) => (g?.type === "Polygon" ? [g.coordinates[0]] : g?.type === "MultiPolygon" ? g.coordinates.map((p) => p[0]) : []);
  // metres from a point to the nearest outline of a building, inside or out
  function toOutline(geometry, point) {
    let best = Infinity;
    for (const outer of outlines(geometry)) {
      for (let i = 0; i < outer.length - 1; i++) best = Math.min(best, metresBetween(point, closestPointOnSegment(point, outer[i], outer[i + 1])));
    }
    return best;
  }
  // metres from a point to a building's walls (0 inside it)
  const fromWalls = (geometry, point) => (outlines(geometry).some((outer) => pointInRing(point, outer)) ? 0 : toOutline(geometry, point));
  // what a sheet's pictures are about: a building with a code, or one tapped without a code
  function placeOf(feature, code = feature.properties.code) {
    const ring = outlines(feature.geometry)[0];
    return { code: code || null, id: feature.id ?? null, geometry: feature.geometry, centre: feature.properties.centre || (ring ? polygonCentroid(ring) : null) };
  }
  const distanceTo = (place, point) => {
    const d = fromWalls(place.geometry, point);
    return Number.isFinite(d) ? d : metresBetween(place.centre, point);
  };
  // is this a picture of the place?
  function shows(pic, place) {
    if (pic.codes.length) return !!place.code && pic.codes.includes(place.code);
    if (!pic.from) {
      if (!place.code) return false;
      const f = buildings.get(place.code).properties;
      const text = `${pic.x.title || ""} ${pic.x.description || ""}`.toLowerCase();
      return [place.code, f.name, f.osmName].some((w) => w && w.length > 2 && text.includes(w.toLowerCase()));
    }
    if (pic.inside != null && pic.inside !== place.id) return false; // taken inside another building
    const d = distanceTo(place, pic.from);
    if (pic.kind !== "photo") return d < 30; // a 360° view taken right beside it
    if (pic.x.heading == null) return d < 20;
    return d < 60 && Math.abs(((bearingDeg(pic.from, place.centre) - pic.x.heading + 540) % 360) - 180) < 50;
  }
  const KIND_ORDER = { photo: 0, google: 1, pano: 2 };
  // Google's 360° view nearest a building's main door, looked up by Google when it is shown (only the
  // buildings it has none near are listed, in streetviews.json)
  const doorOf = (code) => router?.nodes[router.doors[code]] || buildings.get(code).properties.centre;
  const hasGoogleView = (code) => !!streetViewsUrl && !!noGoogleView && !noGoogleView.has(code);
  const googleAt = (code) => {
    const [lon, lat] = doorOf(code);
    return { kind: "google", x: { lon, lat, title: "", author: "" }, codes: [code], from: [lon, lat], at: [lon, lat], inside: null, auto: true };
  };
  // the place's own pictures; without any, the nearest real pictures (each with how far away it is)
  function picturesFor(place) {
    // photos filed under the building first, then flat photos, then 360° views from outside (they show
    // what the building looks like) before the ones inside it
    const rank = (pic) => (pic.kind !== "photo" && pic.d === 0 ? 25 : pic.d);
    const mine = pictures.filter((pic) => shows(pic, place));
    // a view picked by hand (streetviews.json) stands in for the one Google would pick
    if (place.code && hasGoogleView(place.code) && !mine.some((pic) => pic.kind === "google")) mine.push(googleAt(place.code));
    const own = mine
      .map((pic) => ({ ...pic, d: pic.at ? distanceTo(place, pic.at) : 0 }))
      .sort((a, b) => b.codes.includes(place.code) - a.codes.includes(place.code) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || rank(a) - rank(b));
    if (own.length) return { near: false, list: own.slice(0, 8) };
    const others = [...buildings.keys()].filter((code) => code !== place.code && hasGoogleView(code)).map(googleAt);
    const near = [...pictures, ...others]
      .filter((pic) => pic.at && (pic.inside == null || pic.kind === "photo")) // not from inside another building
      .map((pic) => ({ ...pic, d: distanceTo(place, pic.at) }))
      .sort((a, b) => a.d - b.d);
    return { near: true, list: near.slice(0, 3) };
  }
  // The picture half of a sheet: the place's own pictures, or the nearest ones marked 在这附近, and last
  // Google's satellite picture of it. `small`: a lower strip (the arrival sheet), only with its own pictures.
  function mediaPane(place, { small = false } = {}) {
    const pane = el("figure", { class: `cm-media cm-media-wait${small ? " cm-media-small" : ""}`, "aria-label": place.code ? `${place.code} 的实景` : "实景" });
    loadPictures().then(() => {
      if (!pane.isConnected) return; // the sheet moved on
      const found = picturesFor(place);
      if (small && found.near) pane.remove();
      else fillPane(pane, place, found);
    }).catch((error) => {
      console.warn(error);
      pane.remove();
    });
    return pane;
  }
  function fillPane(pane, place, { near, list }) {
    const { code, centre } = place;
    pane.classList.remove("cm-media-wait");
    const items = list.map((pic) => ({ ...pic, near }));
    // the satellite picture is real too, and every building has one
    const size = Math.max(180, 5 * Math.max(0, ...outlines(place.geometry).flat().map((p) => metresBetween(p, centre)))); // metres across
    items.push({ kind: "satellite", x: { lat: centre[1], lon: centre[0], size }, codes: [], d: 0, near: false });
    const photoList = items.filter((pic) => pic.kind === "photo").map((pic) => pic.x);
    const frames = [];
    const slides = items.map((pic, i) => {
      const x = pic.x;
      if (pic.kind === "google" || pic.kind === "satellite") {
        // a live view: drag to look around (Google's own embed); loaded when it is shown
        const src = pic.kind === "google" ? googleView(x, bearingDeg([x.lon, x.lat], centre)) : satelliteEmbed(x, x.size);
        const frame = el("iframe", { title: pic.kind === "google" ? `${x.title || "Google 360° 实景"}（可以拖动看四周）` : "卫星图（可以拖动、缩放）", allowfullscreen: true, referrerpolicy: "strict-origin-when-cross-origin", "data-src": src });
        frames[i] = frame;
        return el("div", { class: `cm-media-item cm-media-${pic.kind}` }, [frame]);
      }
      const open = () => (pic.kind === "photo" ? photoViewer(photoList, photoList.indexOf(x)) : openPanorama(x, centre, code)); // turned towards the building
      const label = x.title || (pic.kind === "photo" ? "实景照片" : "360° 实景");
      return el("button", { class: `cm-media-item cm-media-${pic.kind}`, type: "button", "aria-label": `${label}，点开看大图`, onclick: open }, [
        x.thumb
          ? el("img", { src: x.thumb, alt: "", loading: i ? "lazy" : "eager", decoding: "async", referrerpolicy: "no-referrer" })
          : el("span", { class: "cm-media-poster" }, [el("span", { html: ICON.pano }), el("b", { text: "360° 实景" }), el("small", { text: "点开，拖动看四周" })]),
      ]);
    });
    const track = el("div", { class: "cm-media-track" }, slides);
    const text = el("div", { class: "cm-media-text" });
    const count = el("span", { class: "cm-media-count", "aria-hidden": "true" });
    let shown = 0; // the picture on screen
    let target = 0; // where the ‹ › buttons are taking it
    let moving = false;
    let width = 0;
    const go = (i) => {
      target = Math.max(0, Math.min(items.length - 1, i));
      moving = true;
      track.scrollTo({ left: target * track.clientWidth, behavior: reduceMotion ? "auto" : "smooth" });
      caption(target); // straight away, so quick taps add up and the buttons say where it is going
    };
    const prev = el("button", { class: "cm-btn", type: "button", "aria-label": "上一张", text: "‹", onclick: () => go(target - 1) });
    const nextBtn = el("button", { class: "cm-btn", type: "button", "aria-label": "下一张", text: "›", onclick: () => go(target + 1) });
    function caption(i) {
      const pic = items[i];
      const x = pic.x;
      const where = pic.auto ? `${pic.codes[0]} 门口` : pic.kind === "google" && x.title ? x.title : pic.codes.length ? pic.codes[0] : "";
      const here = code ? `${code} ` : "这栋楼";
      const line = pic.kind === "satellite"
        ? `${code ? `${code} ` : "这里"}的卫星图，可以拖动、缩放`
        : pic.near
          ? `${here}还没有实景照片，这是附近${where ? `的 ${where}` : "拍的"}${pic.kind === "photo" ? "" : `，已经转向${code ? ` ${code}` : "这里"}`}`
          : pic.auto ? `${code} 门口最近的 360° 实景 · 拖动看四周，点箭头往前走`
            : pic.kind === "google" ? `${x.title || "360° 实景"} · 拖动看四周` : x.title || (pic.kind === "pano" ? "360° 实景" : "实景照片");
      const credit = pic.kind === "satellite" ? "Google 卫星图" : pic.kind === "google" ? ["Google 地图", x.author || "作者见画面右下角"].join(" · ") : [x.author, x.license].filter(Boolean).join(" · ");
      text.replaceChildren(...[
        pic.near ? el("b", { class: "cm-near", text: `在这附近 · 约 ${fmtMetres(pic.d)}` }) : null,
        el("span", { text: line }),
        credit ? el("small", {}, [x.page ? el("a", { href: x.page, target: "_blank", rel: "noopener", text: `© ${credit}` }) : `© ${credit}`]) : null,
      ].filter(Boolean));
      count.textContent = `${i + 1}/${items.length}`;
      prev.disabled = i === 0;
      nextBtn.disabled = i === items.length - 1;
      // only the picture on screen can be reached with Tab or a screen reader
      slides.forEach((slide, k) => (slide.inert = k !== i));
      const frame = frames[i];
      if (frame && !frame.src) frame.src = frame.dataset.src;
    }
    track.addEventListener("scroll", () => {
      if (track.clientWidth !== width) {
        // the phone turned: stay on the same picture
        width = track.clientWidth;
        track.scrollTo({ left: shown * width });
        return;
      }
      const i = Math.min(items.length - 1, Math.max(0, Math.round(track.scrollLeft / Math.max(1, width))));
      if (moving && Math.abs(track.scrollLeft - target * width) < 2) moving = false;
      if (i !== shown) {
        shown = i;
        if (!moving) caption(i);
      }
      if (!moving) target = shown;
    }, { passive: true });
    track.addEventListener("pointerdown", () => (moving = false), { passive: true });
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => {
        if (!track.isConnected || track.clientWidth === width) return;
        width = track.clientWidth;
        track.scrollTo({ left: target * width });
      }).observe(track);
    }
    // a 360° view keeps the swipe for itself: swiping along the caption strip changes pictures too
    const cap = el("figcaption", { class: "cm-media-cap" }, [text, el("div", { class: "cm-media-nav" }, [prev, count, nextBtn])]);
    let swipe = null;
    cap.addEventListener("pointerdown", (event) => (swipe = { x: event.clientX, y: event.clientY }));
    cap.addEventListener("pointerup", (event) => {
      if (!swipe) return;
      const dx = event.clientX - swipe.x;
      const dy = event.clientY - swipe.y;
      swipe = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) go(target + (dx < 0 ? 1 : -1));
    });
    cap.addEventListener("pointercancel", () => (swipe = null));
    caption(0);
    width = track.clientWidth;
    pane.replaceChildren(track, cap);
    text.setAttribute("aria-live", "polite"); // after the first caption: say only what the student changes
  }
  function photoViewer(list, index) {
    const box = el("div", { class: "cm-photo", role: "dialog", "aria-label": "照片" });
    pushLayer(box);
    const show = (i) => {
      index = (i + list.length) % list.length;
      const x = list[index];
      box.replaceChildren(
        el("header", {}, [
          el("button", { class: "cm-btn", type: "button", "aria-label": "关闭", html: ICON.back, onclick: () => box.closeLayer() }),
          el("b", { text: x.title }),
          list.length > 1 ? el("button", { class: "cm-btn", type: "button", text: "‹", "aria-label": "上一张", onclick: () => show(index - 1) }) : null,
          list.length > 1 ? el("button", { class: "cm-btn", type: "button", text: "›", "aria-label": "下一张", onclick: () => show(index + 1) }) : null,
        ]),
        el("img", { src: x.full, alt: x.title, referrerpolicy: "no-referrer" }),
        el("footer", {}, [
          ...[
            x.author || null,
            x.license ? (x.licenseUrl || x.page ? el("a", { href: x.licenseUrl || x.page, target: "_blank", rel: "noopener", text: x.license }) : x.license) : null,
            x.source ? (x.page ? el("a", { href: x.page, target: "_blank", rel: "noopener", text: x.source }) : x.source) : null,
          ].filter(Boolean).flatMap((part, k) => (k ? [" · ", part] : [part])),
          x.taken ? ` · ${x.taken}` : "",
          list.length > 1 ? ` · ${index + 1}/${list.length}` : "",
        ])
      );
    };
    show(index);
    overlay.append(box);
    box.querySelector("button")?.focus();
  }

  function showOther(props, feature) {
    if (nav && !nav.arrived) {
      say(props.osmName || "这栋楼没有课表代码。", 3000);
      return;
    }
    if (nav) stopNavigation();
    if (follow) setFollow(false);
    focusCode = null;
    setFocusState(null);
    markFocusLabel();
    const place = placeOf(feature, null);
    sheet.replaceChildren(
      mediaPane(place),
      el("div", { class: "cm-opts" }, [
        el("h2", { text: props.osmName || "校园建筑" }),
        el("p", { text: "这栋楼没有课表代码。点有代码（比如 SK3、PA3）的楼可以导航。" }),
        el("div", { class: "cm-actions" }, [el("button", { class: "cm-btn", type: "button", text: "看全校", onclick: overview })]),
      ])
    );
    sheet.scrollTop = 0;
    // the taller sheet must not hide the building just tapped
    if (place.centre) map.easeTo({ center: place.centre, duration: reduceMotion ? 0 : 600, padding: sheetPadding() });
  }

  function idleSheet() {
    const next = classes.find((m) => m.next && m.code);
    sheet.replaceChildren(
      el("h2", { text: "Curtin Malaysia 校园" }),
      el("p", { text: next ? `下一节：${next.when} ${next.title} · ${next.room}` : "点一栋楼看看在哪里，或者点右上角的列表找楼。" }),
      el("div", { class: "cm-actions" }, [
        next ? el("button", { class: "cm-btn cm-primary", type: "button", text: `去 ${next.code}`, onclick: () => select(next.code, { navigate: true }) }) : null,
        el("button", { class: "cm-btn", type: "button", text: "显示我的位置", onclick: () => locate(true) }),
      ])
    );
  }

  function overview() {
    // back to the short campus sheet first, so the map has the room
    if (!nav) {
      focusCode = null;
      setFocusState(null);
      markFocusLabel();
      idleSheet();
    }
    if (follow) setFollow(false);
    map.easeTo({ ...overviewCamera(), duration: reduceMotion ? 0 : 900 });
  }

  // ----- building list -----
  function openList() {
    const groups = [
      ["教学楼", ["SK", "PA", "HL", "FN", "HN"]],
      ["学生宿舍 Kingfisher", ["KR"]],
    ];
    const list = el("div", { class: "cm-list", role: "dialog", "aria-label": "楼列表" });
    pushLayer(list);
    const closeList = () => list.closeLayer();
    list.append(el("button", { type: "button", onclick: () => closeList() }, [el("b", { html: ICON.back }), el("span", { text: "返回地图" })]));
    if (byCode.size) {
      list.append(el("h3", { text: `${classLabel} 上课的楼` }));
      for (const code of [...byCode.keys()].sort()) {
        const f = buildings.get(code);
        if (!f) continue;
        list.append(el("button", { type: "button", onclick: () => { closeList(); select(code); } }, [el("b", { text: code }), el("span", { text: f.properties.zh || f.properties.name }), el("em", { text: `${byCode.get(code).length} 节课` })]));
      }
    }
    for (const [title, prefixes] of groups) {
      list.append(el("h3", { text: title }));
      for (const [code, f] of [...buildings].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))) {
        if (!prefixes.includes(code.slice(0, 2))) continue;
        list.append(el("button", { type: "button", onclick: () => { closeList(); select(code); } }, [el("b", { text: code }), el("span", { text: [f.properties.name, f.properties.zh].filter(Boolean).join(" · ") })]));
      }
    }
    overlay.append(list);
    list.querySelector("button")?.focus();
  }

  // ----- location & compass -----
  // iPhone only lets a page ask for the motion sensors during a tap, so askCompass() is called straight
  // from click handlers, before any await. The page can also ask on its "带我去" tap and hand the pending
  // answer over (options.compassPermission). Chrome 152+ has the same function but answers without asking.
  let compass = "off"; // off | on | needs-tap | denied
  let pendingPermission = options.compassPermission || null;
  function askCompass() {
    if (compass === "on" || compass === "denied") return;
    const listen = () => {
      if (closed || compass === "on") return;
      compass = "on";
      compassBtn.classList.remove("cm-needs");
      if ("ondeviceorientationabsolute" in window) window.addEventListener("deviceorientationabsolute", onOrientation);
      else window.addEventListener("deviceorientation", onOrientation);
    };
    let request = pendingPermission;
    pendingPermission = null;
    try {
      request ??= typeof DeviceOrientationEvent !== "undefined" ? DeviceOrientationEvent.requestPermission?.(true) : null;
    } catch {
      request = null;
    }
    if (!request || typeof request.then !== "function") {
      listen();
      return;
    }
    request.then(
      (answer) => {
        if (answer === "granted") listen();
        else if (!closed) {
          compass = "denied";
          compassBtn.classList.remove("cm-needs");
        }
      },
      () => {
        // asked outside a tap: show a button the student can tap
        if (closed || compass === "on") return;
        compass = "needs-tap";
        compassBtn.hidden = false;
        compassBtn.classList.add("cm-needs");
      }
    );
  }
  let sx = 0;
  let sy = 0;
  let lastTurn = 0;
  let headingFrame = 0;
  let calibrationSaid = false;
  function onOrientation(event) {
    let h = null;
    if (typeof event.webkitCompassHeading === "number" && event.webkitCompassAccuracy !== -1) h = event.webkitCompassHeading; // iPhone
    else if (event.absolute && typeof event.alpha === "number") h = 360 - event.alpha; // Android
    if (h == null || Number.isNaN(h)) return;
    if (!calibrationSaid && event.webkitCompassAccuracy > 30) {
      calibrationSaid = true;
      say("指南针不太准：离开金属和电器，拿着手机在空中画几个 8 字。", 5000);
    }
    // the sensors measure the phone's top edge in portrait; turn by the screen rotation
    const screenAngle = screen.orientation?.angle ?? (window.orientation < 0 ? window.orientation + 360 : window.orientation) ?? 0;
    const r = (((h + screenAngle) % 360) * Math.PI) / 180;
    // average as a unit vector (so 359° and 1° average to 0°, not 180°), time constant 0.25 s
    const now = performance.now();
    const k = lastTurn ? 1 - Math.exp(-(now - lastTurn) / 250) : 1;
    lastTurn = now;
    sx += k * (Math.sin(r) - sx);
    sy += k * (Math.cos(r) - sy);
    if (!headingFrame) headingFrame = requestAnimationFrame(showHeading);
  }
  function showHeading() {
    headingFrame = 0;
    rawHeading = ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360;
    const h = (rawHeading + headingOffset + 360) % 360;
    if (heading != null && Math.abs(((h - heading + 540) % 360) - 180) < 1.5) return; // no shimmering
    heading = h;
    turnDot();
  }
  function turnDot() {
    const facing = heading ?? course;
    if (!meMarker || facing == null) return;
    meMarker.getElement().classList.add("cm-has-heading");
    meMarker.setRotation(facing);
  }
  const isIPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function startWatch() {
    watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    compassBtn.hidden = false;
  }
  function locate(fly) {
    if (!("geolocation" in navigator) || window.isSecureContext === false) {
      say("这个浏览器用不了定位。");
      return;
    }
    askCompass();
    setFollow(true, false);
    if (watchId == null) {
      say(/MicroMessenger/i.test(navigator.userAgent) ? "微信里常常拿不到定位：点右上角 ··· 选「在浏览器打开」。" : "正在定位…（要允许网页使用位置）", 0);
      locatingSaid = msg.textContent;
      startWatch();
    } else if (me && fly) {
      cameraTo([me.lon, me.lat], { zoom: 18, pitch: 60, bearing: heading ?? course ?? map.getBearing() });
    }
  }

  function onPositionError(error) {
    if (error.code === 1) {
      // denied: stop, so the next tap on the locate button asks again
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
      setFollow(false);
      say(isIPhone()
        ? "没有定位权限。到 设置 › 隐私与安全性 › 定位服务 › Safari 网站，选「使用 App 期间」，再点一次定位。"
        : "没有定位权限。点地址栏左边的图标 › 权限 › 位置 › 允许，再点一次定位。", 9000);
    } else if (error.code === 3) say("还在找 GPS 信号…到空旷一点的地方会快很多。", 5000);
    else {
      // often a one-off between good fixes: only mention it when the position has gone quiet
      if (!me || Date.now() - me.at > 10000) say("暂时拿不到位置，会继续尝试。", 4000);
      // some browsers drop the watch on this error: start it again if no fix comes in a moment
      clearTimeout(restartTimer);
      const lastFix = me?.at ?? 0;
      restartTimer = setTimeout(() => {
        if (closed || watchId == null || (me && me.at > lastFix)) return;
        navigator.geolocation.clearWatch(watchId);
        startWatch();
      }, 3000);
    }
  }
  let restartTimer = 0;
  // the phone only shares a rough position (iPhone "Precise Location" off, or Chrome's "Approximate")
  const roughHelp = () => isIPhone()
    ? "手机只给了大概位置。到 设置 › 隐私与安全性 › 定位服务 › Safari 网站，打开「精确位置」。"
    : "手机只给了大概位置。点地址栏左边的图标 › 权限 › 位置，改成「精确」。";
  let roughSaid = 0;
  let locatingSaid = ""; // the "locating…" hint, cleared by the first fix
  let offCompass = 0;
  let offCompassSaid = false;

  function onPosition(position) {
    const { longitude, latitude, accuracy } = position.coords;
    const fix = positionFilter.update(longitude, latitude, accuracy, position.timestamp || Date.now());
    if (!fix) return; // a sudden jump: wait for the next fixes to confirm it
    const { heading: gpsCourse, speed } = position.coords;
    const walking = gpsCourse != null && !Number.isNaN(gpsCourse) && speed > 0.8 && accuracy < 25;
    course = walking ? gpsCourse : course;
    // walking steadily one way while the compass points elsewhere: suggest calibrating (once)
    if (walking && heading != null && speed > 1 && accuracy < 15) {
      offCompass = Math.abs(((gpsCourse - heading + 540) % 360) - 180) > 50 ? offCompass + 1 : 0;
      if (offCompass >= 6 && !offCompassSaid) {
        offCompassSaid = true;
        say("地图的方向好像跟你走的方向对不上：点右边的指南针按钮校准一下。", 7000);
      }
    }
    const first = !me;
    me = { lon: fix.lon, lat: fix.lat, accuracy, at: Date.now() };
    if (locatingSaid && msg.textContent === locatingSaid) msg.textContent = "";
    locatingSaid = "";
    const point = [me.lon, me.lat];
    map.getSource("accuracy")?.setData(circle(point, Math.max(3, accuracy)));
    // while navigating, the dot sits on the route when we are clearly walking along it
    const shown = (nav && updateNavigation()) || point;
    if (!meMarker) {
      const node = el("div", { class: "cm-me" }, [el("div", { class: "cm-cone" }), el("i")]);
      meMarker = new maplibre.Marker({ element: node, rotationAlignment: "map", pitchAlignment: "map" }).setLngLat(shown).addTo(map);
    } else meMarker.setLngLat(shown);
    if (heading == null) turnDot();
    const far = metresBetween(point, campus.meta.centre);
    if (first && far > 2500) say(`你现在离校园约 ${fmtMetres(far)}，到了学校再用导航。`, 6000);
    if (accuracy >= 1000) {
      if (Date.now() - roughSaid > 60000) say(roughHelp(), 10000);
      roughSaid = Date.now();
    } else if (accuracy > 60) say(`GPS 不太准（误差约 ${Math.round(accuracy)} 米），走到空旷处会好一些。`, 4000);
    if (!nav && follow && (first || far < 3000) && !handsOn()) {
      if (first) cameraTo(point, { zoom: 18, pitch: 60 });
      else map.easeTo({ center: point, duration: reduceMotion ? 0 : 600 });
    }
  }

  // ----- direction calibration (方向校准) -----
  // Phone compasses are often off by 10-40° near steel and concrete. The student points the top of the
  // phone at something they know (a building nearby, or the way the path under their feet leads) and taps
  // it; the difference becomes a correction. A phone with no compass gets its map turned that way instead.
  let calibrating = false;
  const COMPASS_WORDS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
  const compassWord = (deg) => COMPASS_WORDS[Math.round(deg / 45) % 8];
  function calibrationTargets(point) {
    const picks = [];
    const nameOf = (f) => f.properties.zh || f.properties.name || "";
    const ahead = (bearing) => {
      let best = null;
      for (const [code, f] of buildings) {
        const d = metresBetween(point, f.properties.centre);
        const off = Math.abs(((bearingDeg(point, f.properties.centre) - bearing + 540) % 360) - 180);
        if (d < 15 || d > 400 || off > 30) continue;
        if (!best || d < best.d) best = { code, f, d };
      }
      return best;
    };
    const path = router.pathDirection(point);
    if (path && path.distance <= 15 && path.length >= 12) {
      for (const bearing of [path.bearing, (path.bearing + 180) % 360]) {
        const there = ahead(bearing);
        picks.push({
          bearing,
          title: there ? `顺着这条路，往 ${there.code} 那边` : `顺着这条路，往${compassWord(bearing)}`,
          note: there ? nameOf(there.f) : "脚下的路",
        });
      }
    }
    const near = [...buildings]
      .map(([code, f]) => ({ code, f, d: metresBetween(point, f.properties.centre) }))
      .filter(({ f, d }) => d >= 20 && d <= 300 && !pointInRing(point, f.geometry.coordinates[0]))
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    for (const { code, f, d } of near) picks.push({ bearing: bearingDeg(point, f.properties.centre), title: code, note: `${nameOf(f)} · ${fmtMetres(d)}` });
    return picks;
  }
  function calibrationSheet() {
    if (!me) {
      say("先等定位好了再校准方向。", 3500);
      if (watchId == null) locate(true);
      return;
    }
    calibrating = true;
    const picks = calibrationTargets([me.lon, me.lat]);
    const hasCompass = compass === "on" && rawHeading != null; // some phones have no magnetometer at all
    const facing = heading ?? course;
    const arrowFor = (bearing) => (facing == null ? "" : `rotate(${(((bearing - facing + 540) % 360) - 180).toFixed(0)}deg)`);
    sheet.replaceChildren(
      el("div", { class: "cm-sheet-head" }, [el("h2", { text: "方向校准" }), el("button", { class: "cm-btn", type: "button", text: "取消", onclick: closeCalibration })]),
      el("p", {
        text: hasCompass
          ? "手机平拿在胸前，顶端对准下面一个你认得的目标，然后点它。箭头是指南针现在以为它在的方向。"
          : "这台手机没开指南针。面朝下面一个你认得的目标，点它，地图就按这个方向摆好。",
      }),
      picks.length
        ? el("div", { class: "cm-picks" }, picks.map((pick) => {
          const arrow = el("i", { "aria-hidden": "true", text: facing == null ? "" : "↑" });
          arrow.style.transform = arrowFor(pick.bearing);
          return el("button", { class: "cm-pick", type: "button", onclick: () => applyCalibration(pick) }, [el("b", { text: pick.title }), el("span", { text: pick.note }), arrow]);
        }))
        : el("p", { text: "附近 300 米内没有认得出的楼。走到楼旁边或路上再试。" }),
      headingOffset
        ? el("div", { class: "cm-actions" }, [el("button", { class: "cm-btn", type: "button", text: `清除校准（现在修正 ${headingOffset > 0 ? "+" : ""}${Math.round(headingOffset)}°）`, onclick: () => applyCalibration(null) })])
        : null
    );
  }
  function applyCalibration(pick) {
    askCompass(); // still inside the tap
    if (!pick) {
      headingOffset = 0;
      say("已清除方向校准。", 3000);
    } else if (compass === "on" && rawHeading != null) {
      headingOffset = ((pick.bearing - rawHeading + 540) % 360) - 180;
      say(Math.abs(headingOffset) < 5 ? "指南针本来就很准，不用改。" : `方向校准好了：指南针偏了 ${Math.round(Math.abs(headingOffset))}°，已经修正。`, 4500);
    } else {
      course = pick.bearing; // no compass: face this way until walking shows otherwise
      say("已按你面对的方向摆好地图。走起来以后会跟着你走的方向转。", 5000);
    }
    try {
      if (headingOffset) localStorage.setItem(OFFSET_KEY, JSON.stringify({ offset: headingOffset, at: Date.now() }));
      else localStorage.removeItem(OFFSET_KEY);
    } catch {
      /* private mode */
    }
    if (rawHeading != null) heading = (rawHeading + headingOffset + 360) % 360;
    turnDot();
    if (pick) map.easeTo({ bearing: pick.bearing, duration: reduceMotion ? 0 : 600 });
    closeCalibration();
  }
  function closeCalibration() {
    calibrating = false;
    if (nav) {
      navView = null;
      if (nav.arrived) arrivedSheet(nav.code);
      else if (me && updateNavigation()) return;
      else if (!me) navWaitingSheet(nav.code);
    } else if (focusCode) buildingSheet(focusCode);
    else idleSheet();
  }

  // ----- navigation -----
  function beginNavigation(code) {
    focusCode = code;
    setFocusState(code);
    markFocusLabel();
    nav = { code, route: null, lastRoute: 0, arrived: false, offCount: 0, framed: false, said: "" };
    seeThrough(true);
    setPin(code);
    locate(false);
    requestWakeLock();
    if (me) updateNavigation(true);
    else navWaitingSheet(code);
  }

  function setPin(code) {
    const door = router.nodes[router.doors[code]] || buildings.get(code)?.properties.centre;
    if (!door) return;
    if (!pinMarker) {
      const node = el("div", { class: "cm-pin", html: `<svg viewBox="0 0 30 40"><path d="M15 39C15 39 2 23 2 14a13 13 0 0 1 26 0c0 9-13 25-13 25z" fill="${c.accent}" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14" r="5" fill="#fff"/></svg>` });
      pinMarker = new maplibre.Marker({ element: node, anchor: "bottom" }).setLngLat(door).addTo(map);
    } else pinMarker.setLngLat(door);
  }

  function navWaitingSheet(code) {
    const f = buildings.get(code);
    sheet.replaceChildren(
      el("h2", {}, [`去 ${code}`, el("small", { text: f?.properties.zh || f?.properties.name || "" })]),
      el("p", { text: "正在等 GPS 定位…第一次会问你要不要允许网页使用位置，选允许。在室外会快很多。位置只在你的手机上用，不会上传。" }),
      el("div", { class: "cm-actions" }, [el("button", { class: "cm-btn", type: "button", text: "取消", onclick: endNavigation })])
    );
  }

  /** Re-checks the walk after a new fix; returns where to draw the walker (on the route when close to it). */
  function updateNavigation(force = false) {
    if (!nav || !me || nav.arrived) return null; // arrival stays until the student taps 好
    const point = [me.lon, me.lat];
    const entrances = router.entrancesOf(nav.code);
    const f = buildings.get(nav.code);
    if (me.accuracy >= 1000) {
      statusSheet("rough", `${roughHelp()}改好后回到这里就能带路。`);
      return null;
    }
    const far = metresBetween(point, campus.meta.centre);
    if (far > 2500) {
      statusSheet("far", `你现在离校园约 ${fmtMetres(far)}。导航只在校园里用，到了学校再打开。`);
      return null;
    }
    // off the route = further than the GPS error (20-30 m) from it, twice in a row, with a usable fix
    const tolerance = Math.max(20, Math.min(me.accuracy, 30));
    let progress = nav.route ? progressOnRoute(nav.route, point, tolerance, nav.along) : null;
    // arrived: at the door, or inside the building near the end of the route (a route can pass beside it earlier)
    const atDoor = entrances.some((d) => metresBetween(point, d) < Math.max(12, Math.min(25, me.accuracy * 0.6)));
    const inside = f && pointInRing(point, f.geometry.coordinates[0]) && (!progress || progress.remaining < 40);
    if (atDoor || inside) {
      nav.arrived = true;
      try {
        navigator.vibrate?.(180);
      } catch {
        /* ignore */
      }
      arrivedSheet(nav.code);
      map.getSource("route")?.setData(EMPTY);
      return null;
    }
    if (progress?.offRoute && me.accuracy <= 30) nav.offCount++;
    else if (progress && !progress.offRoute) nav.offCount = 0;
    const stale = Date.now() - nav.lastRoute > 4000;
    if (force || !nav.route || (nav.offCount >= 2 && stale)) {
      nav.route = router.route(point, nav.code);
      nav.lastRoute = Date.now();
      nav.offCount = 0;
      if (!nav.route) {
        say("算不出路线，请先往大路走。", 4000);
        return null;
      }
      map.getSource("route")?.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: nav.route.coords } });
      pinMarker?.setLngLat(nav.route.coords.at(-1)); // the door this route leads to
      progress = progressOnRoute(nav.route, point, tolerance);
    }
    nav.along = progress.offRoute ? null : progress.along; // next fix: look near here first
    if (!calibrating) navSheet(progress);
    const shown = !progress.offRoute && progress.distance <= Math.min(15, Math.max(5, me.accuracy)) ? progress.point : point;
    if (follow && !handsOn()) {
      const bearing = heading ?? course ?? bearingDeg(shown, progress.nextStep?.at || nav.route.coords.at(-1));
      const camera = { center: shown, bearing, duration: reduceMotion ? 0 : 800, padding: { bottom: sheet.offsetHeight * 0.9, top: 60 } };
      // tilt and zoom in once when the walk starts; after that the student's own zoom and 2D/3D choice stay
      if (!nav.framed) Object.assign(camera, { pitch: pitchBtn.textContent === "3D" ? 0 : 62, zoom: Math.max(map.getZoom(), 18.2) });
      nav.framed = true;
      map.easeTo(camera);
    }
    return shown;
  }

  // a waiting state during navigation (rough position, far away): built once, then only the text changes,
  // so the 结束 button is not replaced under the student's finger every second
  let statusView = null;
  function statusSheet(kind, text) {
    if (calibrating) return;
    if (statusView?.kind === kind && sheet.contains(statusView.p)) {
      statusView.p.textContent = text;
      return;
    }
    const p = el("p", { text });
    statusView = { kind, p };
    navView = null;
    sheet.replaceChildren(
      el("h2", { text: `去 ${nav.code}` }),
      p,
      el("div", { class: "cm-actions" }, [el("button", { class: "cm-btn", type: "button", text: "结束", onclick: endNavigation })])
    );
  }
  let navView = null; // the nav sheet's live parts, reused while it is showing
  function navSheet(progress) {
    const step = progress.nextStep;
    const arriving = step.turn === "arrive";
    const instruction = arriving ? `再走 ${fmtMetres(progress.toNext)}就到 ${nav.code}` : `${fmtMetres(progress.toNext)}后${TURN_ZH[step.turn]}`;
    const detail = `还有 ${fmtMetres(progress.remaining)} · 约 ${walkMinutes(progress.remaining)} 分钟 · 去 ${nav.code}`;
    if (!navView || !sheet.contains(navView.strong)) {
      const strong = el("strong");
      const span = el("span");
      const arrow = el("div", { class: "cm-arrow" });
      const followBtn = el("button", { class: "cm-btn", type: "button", onclick: () => setFollow(!follow) });
      navView = { strong, span, arrow, followBtn, icon: null };
      sheet.replaceChildren(
        el("div", { class: "cm-nav" }, [arrow, el("div", {}, [strong, span])]),
        el("div", { class: "cm-actions" }, [
          followBtn,
          el("button", { class: "cm-btn", type: "button", text: "校准方向", onclick: () => { askCompass(); calibrationSheet(); } }),
          el("button", { class: "cm-btn", type: "button", text: "结束导航", onclick: endNavigation }),
        ])
      );
    }
    const icon = arriving ? "flag" : "arrow";
    if (navView.icon !== icon) {
      navView.arrow.innerHTML = ICON[icon];
      navView.icon = icon;
    }
    if (!arriving) navView.arrow.firstChild.style.transform = `rotate(${TURN_ROTATE[step.turn] ?? 0}deg)`;
    navView.strong.textContent = instruction;
    navView.span.textContent = detail;
    navView.followBtn.textContent = follow ? "自由看地图" : "跟着我";
    // screen readers hear the next turn when it changes, not every metre
    const turnKey = `${step.turn}@${step.at}`;
    if (nav.said !== turnKey) {
      nav.said = turnKey;
      announcer.textContent = instruction;
    }
  }
  function setFollow(on, refresh = true) {
    follow = on;
    locateBtn.setAttribute("aria-pressed", String(on));
    if (navView) navView.followBtn.textContent = on ? "自由看地图" : "跟着我";
    if (on && nav && refresh) updateNavigation();
  }

  function arrivedSheet(code) {
    calibrating = false;
    const f = buildings.get(code);
    const mine = (byCode.get(code) || []).find((m) => m.next) || (byCode.get(code) || [])[0];
    announcer.textContent = `到了 ${code}`;
    sheet.replaceChildren(
      ...(f ? [mediaPane(placeOf(f, code), { small: true })] : []), // a picture, so it is easy to recognise
      el("div", { class: "cm-opts" }, [
        el("h2", {}, [`到了！${code}`, el("small", { text: [f?.properties.name, f?.properties.zh].filter(Boolean).join(" · ") })]),
        el("p", { text: mine ? `${mine.title} 在 ${mine.room}。` : "你已经在这栋楼旁边了。" }),
        el("div", { class: "cm-actions" }, [el("button", { class: "cm-btn cm-primary", type: "button", text: "好", onclick: endNavigation })]),
      ])
    );
    releaseWakeLock();
  }

  // while walking, buildings turn half see-through so they never hide the route
  function seeThrough(on) {
    map.setPaintProperty("buildings", "fill-extrusion-opacity", on ? 0.62 : 0.94);
    if (map.getLayer("w-buildings")) map.setPaintProperty("w-buildings", "fill-extrusion-opacity", on ? 0.5 : 0.85);
  }

  function stopNavigation() {
    nav = null;
    navView = null;
    seeThrough(false);
    map.getSource("route")?.setData(EMPTY);
    pinMarker?.remove();
    pinMarker = null;
    releaseWakeLock();
  }
  function endNavigation() {
    stopNavigation();
    if (follow) setFollow(false);
    if (focusCode) buildingSheet(focusCode);
    else idleSheet();
  }

  // keep the screen on while walking; the browser drops the lock whenever the page is hidden
  let wakeRequest = null;
  function requestWakeLock() {
    if (wakeLock || wakeRequest || !navigator.wakeLock) return;
    wakeRequest = navigator.wakeLock.request("screen").then(
      (lock) => {
        wakeRequest = null;
        if (closed || !nav || nav.arrived) {
          lock.release().catch(() => {});
          return;
        }
        wakeLock = lock;
        lock.addEventListener?.("release", () => {
          if (wakeLock === lock) wakeLock = null;
        });
      },
      () => {
        wakeRequest = null;
      }
    );
  }
  function releaseWakeLock() {
    wakeLock?.release?.().catch(() => {});
    wakeLock = null;
  }

  // ----- controls -----
  closeBtn.addEventListener("click", () => close());
  compassBtn.addEventListener("click", () => {
    askCompass(); // first, while the tap still counts as a gesture
    calibrationSheet();
  });
  // iPhone grants the screen wake lock only during a tap: retry on the next one if it failed earlier
  overlay.addEventListener("click", () => {
    if (nav && !nav.arrived && !wakeLock) requestWakeLock();
  }, true);
  listBtn.addEventListener("click", () => {
    if (ready && !overlay.querySelector(".cm-list")) openList();
  });
  locateBtn.addEventListener("click", () => {
    if (!ready) return;
    if (follow && me) {
      setFollow(false);
      return;
    }
    locate(true);
  });
  pitchBtn.addEventListener("click", () => {
    if (!ready) return;
    const flat = map.getPitch() > 5;
    map.easeTo({ pitch: flat ? 0 : 58, duration: reduceMotion ? 0 : 600 });
    pitchBtn.textContent = flat ? "3D" : "2D";
  });
  northBtn.addEventListener("click", () => {
    if (!ready) return;
    setFollow(false);
    map.easeTo({ bearing: 0, duration: reduceMotion ? 0 : 600 });
  });
  const onKey = (event) => {
    if (event.key === "Escape") {
      const layer = [...overlay.querySelectorAll(".cm-list, .cm-photo")].at(-1);
      if (layer) layer.closeLayer();
      else close();
    }
  };
  window.addEventListener("keydown", onKey);
  const onVisible = () => {
    if (!document.hidden && nav && !nav.arrived && !wakeLock) requestWakeLock();
  };
  document.addEventListener("visibilitychange", onVisible);
  // Safari stops location when the page goes into the back/forward cache; start again when it returns
  const onPageShow = (event) => {
    if (event.persisted && watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      startWatch();
    }
  };
  window.addEventListener("pageshow", onPageShow);

  function close({ fromHistory = false } = {}) {
    if (closed) return;
    closed = true;
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    window.removeEventListener("deviceorientationabsolute", onOrientation);
    window.removeEventListener("deviceorientation", onOrientation);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("popstate", onPop);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pageshow", onPageShow);
    cancelAnimationFrame(headingFrame);
    releaseWakeLock();
    sheetSize?.disconnect();
    clearTimeout(say.timer);
    clearTimeout(restartTimer);
    try {
      map?.remove();
    } catch {
      /* ignore */
    }
    overlay.remove();
    for (const child of inerted) child.inert = false;
    html.style.overflow = saved.htmlOverflow;
    Object.assign(body.style, { position: saved.position, top: saved.top, width: saved.width, left: saved.left, right: saved.right });
    try {
      window.scrollTo({ top: scrollY, left: 0, behavior: "instant" });
    } catch {
      window.scrollTo(0, scrollY);
    }
    const back = typeof options.returnFocus === "function" ? options.returnFocus() : null;
    (previousFocus?.isConnected ? previousFocus : back)?.focus?.({ preventScroll: true });
    if (historyPushed && !fromHistory && history.state?.__campusMap) history.go(-1 - layers);
    current = null;
  }

  current = {
    close: () => close(),
    focus: (code, navigate, permission) => {
      if (permission && compass !== "on") pendingPermission = permission;
      if (!code) return;
      if (ready) select(code, { navigate });
      else Object.assign(options, { focus: code, navigate }); // picked up when the map is ready
    },
  };
  return current.close;
}

export { buildingForRoom };
