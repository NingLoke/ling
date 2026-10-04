// Google Maps 360° views (Street View or a photo sphere someone uploaded) and satellite pictures as
// embeddable links, none of which needs an API key.
// Google Maps' own "Share → Embed a map" gives an <iframe> whose address looks like
//   https://www.google.com/maps/embed?pb=!4v…!6m8!1m7!1s<photo id>!2m2!1d<lat>!2d<lon>!3f<heading>!4f<pitch>!5f<zoom>
// parseStreetView() accepts that iframe code, its address, or the address shown in the browser while
// looking at the view (https://www.google.com/maps/@lat,lon,3a,80y,319h,93t/data=…!1s<id>…).
// Without a photo id, Google's older embed address for Street View (maps?layer=c&cbll=lat,lon&
// output=svembed) still works without a key: Google shows the 360° view nearest to that position, looked
// up when the page shows it (streetViewAt). Nothing of Google's is stored here.

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

/** The 360° view Google has nearest to a position (no photo id needed), looking towards `heading`. */
export function streetViewAt({ lat, lon }, heading = 0, pitch = 0) {
  const h = ((heading % 360) + 360) % 360;
  return `https://maps.google.com/maps?layer=c&cbll=${lat},${lon}&cbp=12,${h.toFixed(1)},0,0,${(-pitch).toFixed(1)}&source=embed&output=svembed`;
}

/** Google's satellite picture of a place, about `metres` across, as an embeddable address. */
export function satelliteEmbed({ lat, lon }, metres = 200) {
  return `https://www.google.com/maps/embed?pb=!1m14!1m12!1m3!1d${Math.round(metres)}!2d${lon}!3d${lat}!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!5e1!3m2!1szh-CN!2smy!4v1`;
}
