// Google Maps 360° views (Street View or a photo sphere someone uploaded) as embeddable links.
// Google Maps' own "Share → Embed a map" gives an <iframe> whose address looks like
//   https://www.google.com/maps/embed?pb=!4v…!6m8!1m7!1s<photo id>!2m2!1d<lat>!2d<lon>!3f<heading>!4f<pitch>!5f<zoom>
// and needs no API key. parseStreetView() accepts that iframe code, its address, or the address shown in
// the browser while looking at the view (https://www.google.com/maps/@lat,lon,3a,80y,319h,93t/data=…!1s<id>…).

const ZOOM = 0.7820865974627469; // Google's default for an embedded view

/** { pano, lat, lon, heading, pitch } from what the student pasted, or null if it is not a Google 360° view. */
export function parseStreetView(text) {
  const input = String(text ?? "").trim();
  const src = /src="([^"]+)"/.exec(input)?.[1] ?? input;
  let url;
  try {
    url = new URL(src.replace(/&amp;/g, "&"));
  } catch {
    return null;
  }
  if (!/(^|\.)google\.[a-z.]+$/.test(url.hostname) || !url.pathname.startsWith("/maps")) return null;
  const pb = url.searchParams.get("pb");
  if (url.pathname.startsWith("/maps/embed") && pb) {
    const pano = /!1s([^!]+)!2m2/.exec(pb)?.[1];
    const lat = Number(/!1d(-?[\d.]+)/.exec(pb)?.[1]);
    const lon = Number(/!2d(-?[\d.]+)/.exec(pb)?.[1]);
    if (!pano || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { pano: decodeURIComponent(pano), lat, lon, heading: Number(/!3f(-?[\d.]+)/.exec(pb)?.[1] ?? 0), pitch: Number(/!4f(-?[\d.]+)/.exec(pb)?.[1] ?? 0) };
  }
  // the address bar: /maps/@lat,lon,3a,75y,319h,93t/data=!3m…!1s<id>!2e…
  const at = /@(-?[\d.]+),(-?[\d.]+),3a(?:,[\d.]+y)?(?:,(-?[\d.]+)h)?(?:,(-?[\d.]+)t)?/.exec(decodeURIComponent(url.pathname));
  const data = decodeURIComponent(url.pathname + url.search);
  const pano = /!1s([A-Za-z0-9_\-]{10,})!2e/.exec(data)?.[1] ?? /!1s([A-Za-z0-9_\-]{10,})/.exec(data)?.[1];
  if (!at || !pano) return null;
  return { pano, lat: Number(at[1]), lon: Number(at[2]), heading: Number(at[3] ?? 0), pitch: at[4] != null ? Number(at[4]) - 90 : 0 };
}

/** The embeddable address for a view, looking towards `heading` (degrees from north). */
export function streetViewEmbed({ pano, lat, lon }, heading = 0, pitch = 0) {
  const h = ((heading % 360) + 360) % 360;
  return `https://www.google.com/maps/embed?pb=!4v1!6m8!1m7!1s${encodeURIComponent(pano)}!2m2!1d${lat}!2d${lon}!3f${h.toFixed(1)}!4f${pitch.toFixed(1)}!5f${ZOOM}`;
}
