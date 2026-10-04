// 3D campus map: real-scale buildings from OpenStreetMap, live GPS position with compass heading,
// and walking directions to a building. Opens as a full-screen overlay; returns close().
// Map data © OpenStreetMap contributors (ODbL). Rendering: MapLibre GL JS (BSD-3-Clause), loaded on demand.
import {
  createRouter, buildingForRoom, metresBetween, bearingDeg, progressOnRoute, walkMinutes, TURN_ZH, pointInRing, createPositionFilter,
} from "./campus-geo.js?v=274ed27a1c";

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
.cm-fabs .cm-compass{border-color:var(--cm-accent);color:var(--cm-accent);animation:cm-nudge 1.6s ease-in-out 3}
@keyframes cm-nudge{50%{transform:scale(1.08)}}
@media (prefers-reduced-motion:reduce){.cm-me::before{animation:none}.cm-arrow svg{transition:none}}
`;

const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  locate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  north: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l5 14-5-3-5 3z" fill="currentColor" fill-opacity=".25"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V5"/><path d="M6 11l6-6 6 6"/></svg>',
  compass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor" fill-opacity=".3"/></svg>',
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
  const { maplibreUrl, campusUrl, pathsUrl, style = "ink", classes = [], classLabel = "", basemap = OPENFREEMAP } = options;
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
  const compassBtn = el("button", { class: "cm-btn cm-compass", type: "button", "aria-label": "开启指南针（地图跟着手机转）", html: ICON.compass, hidden: true });
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
    const list = overlay.querySelector(".cm-list");
    if (list) list.closeList(true);
    else close({ fromHistory: true });
  };
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
  let heading = null; // where the phone points, degrees from north, smoothed
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

  // the overview frames the buildings with codes (teaching blocks and Kingfisher), not the empty fields around them
  function campusBounds() {
    const points = [...buildings.values()].flatMap((f) => f.geometry.coordinates[0]);
    const lons = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
  }

  // fit the buildings flat, then tilt and lean in a little: tilted, the far half shrinks and leaves room
  function overviewCamera(bottom = Math.max(sheet.offsetHeight, 170)) {
    const height = mapBox.clientHeight || 600;
    const padding = { top: 90, bottom: Math.min(bottom + 10, Math.max(0, height - 200)), left: 12, right: 12 };
    const flat = map.cameraForBounds(campusBounds(), { padding, bearing: 270, absolutePadding: true });
    if (!flat) return { center: campus.meta.centre, zoom: 16, bearing: 270, pitch: 52 };
    return { center: flat.center, zoom: flat.zoom + 0.35, bearing: 270, pitch: 52, padding: flat.padding };
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
        else if (f) showOther(f.properties);
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
      if (options.focus) select(options.focus, { navigate: options.navigate });
      else idleSheet();
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
      const show = l.code === focusCode || (z >= 15 && (z >= 16.3 || l.mine));
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

  function cameraTo(centre, { zoom = 17.6, pitch = 58, bearing = map.getBearing(), duration = 900 } = {}) {
    map.easeTo({ center: centre, zoom, pitch, bearing, duration: reduceMotion ? 0 : duration, padding: { bottom: sheet.offsetHeight * 0.8, top: 70 } });
  }

  function select(code, { navigate = false } = {}) {
    const f = buildings.get(code);
    if (!f) {
      say(`地图上找不到 ${code}`);
      return;
    }
    if (nav) {
      if (!navigate) {
        // keep walking to the destination; just say what this building is
        say(code === nav.code ? `${code} 就是目的地。` : `${code} · ${f.properties.zh || f.properties.name || ""}。要改去这里，先点「结束导航」。`, 4000);
        return;
      }
      stopNavigation();
    }
    focusCode = code;
    setFocusState(code);
    markFocusLabel();
    cameraTo(f.properties.centre);
    buildingSheet(code);
    if (navigate) beginNavigation(code);
  }

  function buildingSheet(code) {
    const f = buildings.get(code);
    const p = f.properties;
    const mine = byCode.get(code) || [];
    sheet.replaceChildren(
      el("h2", {}, [p.code, el("small", { text: [p.name, p.zh].filter(Boolean).join(" · ") })]),
      mine.length
        ? el("ul", {}, mine.slice(0, 6).map((m) => el("li", {}, [el("b", { text: m.when }), ` ${m.title} · ${m.room}`])))
        : el("p", { text: p.osmName ? `OpenStreetMap：${p.osmName}` : `${classLabel} 这周没有课在这里。` }),
      el("div", { class: "cm-actions" }, [
        el("button", { class: "cm-btn cm-primary", type: "button", onclick: () => select(code, { navigate: true }) }, [el("span", { html: ICON.flag }), "带我去"]),
        el("button", { class: "cm-btn", type: "button", text: "看全校", onclick: overview }),
      ])
    );
  }

  function showOther(props) {
    if (nav) {
      say(props.osmName || "这栋楼没有课表代码。", 3000);
      return;
    }
    focusCode = null;
    setFocusState(null);
    markFocusLabel();
    sheet.replaceChildren(
      el("h2", { text: props.osmName || "校园建筑" }),
      el("p", { text: "这栋楼没有课表代码。点有代码（比如 SK3、PA3）的楼可以导航。" }),
      el("div", { class: "cm-actions" }, [el("button", { class: "cm-btn", type: "button", text: "看全校", onclick: overview })])
    );
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
    map.easeTo({ ...overviewCamera(), duration: reduceMotion ? 0 : 900 });
  }

  // ----- building list -----
  function openList() {
    const groups = [
      ["教学楼", ["SK", "PA", "HL", "FN", "HN"]],
      ["学生宿舍 Kingfisher", ["KR"]],
    ];
    const list = el("div", { class: "cm-list", role: "dialog", "aria-label": "楼列表" });
    let listPushed = false;
    try {
      history.pushState({ ...(history.state || {}), __campusList: true }, "");
      listPushed = true;
    } catch {
      /* ignore */
    }
    const closeList = (fromHistory = false) => {
      if (!list.isConnected) return;
      list.remove();
      if (listPushed && !fromHistory && history.state?.__campusList) {
        ignorePops++;
        history.back();
      }
    };
    list.closeList = closeList;
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
      compassBtn.hidden = true;
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
          compassBtn.hidden = true;
        }
      },
      () => {
        // asked outside a tap: show a button the student can tap
        if (closed || compass === "on") return;
        compass = "needs-tap";
        compassBtn.hidden = false;
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
    const h = ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360;
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
  }
  function locate(fly) {
    if (!("geolocation" in navigator) || window.isSecureContext === false) {
      say("这个浏览器用不了定位。");
      return;
    }
    askCompass();
    follow = true;
    locateBtn.setAttribute("aria-pressed", "true");
    if (watchId == null) {
      say(/MicroMessenger/i.test(navigator.userAgent) ? "微信里常常拿不到定位：点右上角 ··· 选「在浏览器打开」。" : "正在定位…（要允许网页使用位置）", 0);
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
      follow = false;
      locateBtn.setAttribute("aria-pressed", "false");
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

  function onPosition(position) {
    const { longitude, latitude, accuracy } = position.coords;
    const fix = positionFilter.update(longitude, latitude, accuracy, position.timestamp || Date.now());
    if (!fix) return; // a sudden jump: wait for the next fixes to confirm it
    const { heading: gpsCourse, speed } = position.coords;
    course = gpsCourse != null && !Number.isNaN(gpsCourse) && speed > 0.8 && accuracy < 25 ? gpsCourse : course;
    const first = !me;
    me = { lon: fix.lon, lat: fix.lat, accuracy, at: Date.now() };
    if (msg.textContent.startsWith("正在定位")) msg.textContent = "";
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
    const door = router.nodes[router.doors[nav.code]];
    const f = buildings.get(nav.code);
    if (me.accuracy >= 1000) {
      sheet.replaceChildren(
        el("h2", { text: `去 ${nav.code}` }),
        el("p", { text: `${roughHelp()}改好后回到这里就能带路。` }),
        el("div", { class: "cm-actions" }, [el("button", { class: "cm-btn", type: "button", text: "结束", onclick: endNavigation })])
      );
      return null;
    }
    const far = metresBetween(point, campus.meta.centre);
    if (far > 2500) {
      sheet.replaceChildren(
        el("h2", { text: `去 ${nav.code}` }),
        el("p", { text: `你现在离校园约 ${fmtMetres(far)}。导航只在校园里用，到了学校再打开。` }),
        el("div", { class: "cm-actions" }, [el("button", { class: "cm-btn", type: "button", text: "结束", onclick: endNavigation })])
      );
      return null;
    }
    // off the route = further than the GPS error (20-30 m) from it, twice in a row, with a usable fix
    const tolerance = Math.max(20, Math.min(me.accuracy, 30));
    let progress = nav.route ? progressOnRoute(nav.route, point, tolerance, nav.along) : null;
    // arrived: at the door, or inside the building near the end of the route (a route can pass beside it earlier)
    const atDoor = door && metresBetween(point, door) < Math.max(12, Math.min(25, me.accuracy * 0.6));
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
      progress = progressOnRoute(nav.route, point, tolerance);
    }
    nav.along = progress.offRoute ? null : progress.along; // next fix: look near here first
    navSheet(progress);
    const shown = !progress.offRoute && progress.distance <= Math.min(15, Math.max(5, me.accuracy)) ? progress.point : point;
    if (follow && !handsOn()) {
      const bearing = heading ?? course ?? bearingDeg(shown, progress.nextStep?.at || door);
      const camera = { center: shown, bearing, duration: reduceMotion ? 0 : 800, padding: { bottom: sheet.offsetHeight * 0.9, top: 60 } };
      // tilt and zoom in once when the walk starts; after that the student's own zoom and 2D/3D choice stay
      if (!nav.framed) Object.assign(camera, { pitch: pitchBtn.textContent === "3D" ? 0 : 62, zoom: Math.max(map.getZoom(), 18.2) });
      nav.framed = true;
      map.easeTo(camera);
    }
    return shown;
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
        el("div", { class: "cm-actions" }, [followBtn, el("button", { class: "cm-btn", type: "button", text: "结束导航", onclick: endNavigation })])
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
  function setFollow(on) {
    follow = on;
    locateBtn.setAttribute("aria-pressed", String(on));
    if (navView) navView.followBtn.textContent = on ? "自由看地图" : "跟着我";
    if (on && nav) updateNavigation();
  }

  function arrivedSheet(code) {
    const f = buildings.get(code);
    const mine = (byCode.get(code) || []).find((m) => m.next) || (byCode.get(code) || [])[0];
    announcer.textContent = `到了 ${code}`;
    sheet.replaceChildren(
      el("h2", {}, [`到了！${code}`, el("small", { text: [f?.properties.name, f?.properties.zh].filter(Boolean).join(" · ") })]),
      el("p", { text: mine ? `${mine.title} 在 ${mine.room}。` : "你已经在这栋楼旁边了。" }),
      el("div", { class: "cm-actions" }, [el("button", { class: "cm-btn cm-primary", type: "button", text: "好", onclick: endNavigation })])
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
    say("转一转手机，地图上的扇形会跟着你转。", 3500);
  });
  // iPhone grants the screen wake lock only during a tap: retry on the next one if it failed earlier
  overlay.addEventListener("pointerdown", () => {
    if (nav && !nav.arrived && !wakeLock) requestWakeLock();
  });
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
      const list = overlay.querySelector(".cm-list");
      if (list) list.closeList();
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
    if (historyPushed && !fromHistory && history.state?.__campusMap) history.go(history.state.__campusList ? -2 : -1);
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
