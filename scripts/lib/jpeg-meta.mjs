// Reads what a panorama needs from a JPEG, with no dependencies: pixel size, the GPS position and
// camera direction from EXIF, and the Photo Sphere (GPano) fields from XMP.
//   readJpegMeta(buffer) -> { width, height, lat, lon, direction, gpano: { heading, fullWidth, fullHeight,
//                              croppedWidth, croppedHeight, croppedLeft, croppedTop, projection } }

export function readJpegMeta(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("not a JPEG");
  const out = { width: null, height: null, lat: null, lon: null, direction: null, gpano: {} };
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan
    const length = buf.readUInt16BE(i + 2);
    const body = buf.subarray(i + 4, i + 2 + length);
    if (marker === 0xe1 && body.subarray(0, 6).toString("latin1") === "Exif\0\0") Object.assign(out, readExif(body.subarray(6)));
    else if (marker === 0xe1 && body.subarray(0, 29).toString("latin1") === "http://ns.adobe.com/xap/1.0/\0") out.gpano = readGPano(body.subarray(29).toString("utf8"));
    else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      out.height = body.readUInt16BE(1);
      out.width = body.readUInt16BE(3);
    }
    i += 2 + length;
  }
  return out;
}

function readExif(tiff) {
  const little = tiff.subarray(0, 2).toString("latin1") === "II";
  const u16 = (o) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const entries = (offset) => {
    const list = new Map();
    const count = u16(offset);
    for (let k = 0; k < count; k++) {
      const e = offset + 2 + k * 12;
      list.set(u16(e), { type: u16(e + 2), count: u32(e + 4), at: e + 8 });
    }
    return list;
  };
  const rationals = (entry) => {
    const start = u32(entry.at);
    return Array.from({ length: entry.count }, (_, k) => u32(start + k * 8) / (u32(start + k * 8 + 4) || 1));
  };
  const ascii = (entry) => String.fromCharCode(tiff[entry.at]); // one-letter refs (N/S/E/W/T/M) fit in the entry
  const result = {};
  const ifd0 = entries(u32(4));
  const gpsPointer = ifd0.get(0x8825);
  if (!gpsPointer) return result;
  const gps = entries(u32(gpsPointer.at));
  const degrees = (tag, refTag, negative) => {
    const value = gps.get(tag);
    if (!value) return null;
    const [d, m, s] = rationals(value);
    const sign = gps.get(refTag) && ascii(gps.get(refTag)) === negative ? -1 : 1;
    return sign * (d + (m || 0) / 60 + (s || 0) / 3600);
  };
  result.lat = degrees(2, 1, "S");
  result.lon = degrees(4, 3, "W");
  const direction = gps.get(17);
  if (direction) result.direction = rationals(direction)[0];
  return result;
}

function readGPano(xml) {
  const field = (name) => {
    const m = new RegExp(`GPano:${name}(?:="([^"]*)"|>([^<]*)<)`).exec(xml);
    const value = m ? (m[1] ?? m[2]) : null;
    return value == null ? null : value;
  };
  const number = (name) => {
    const v = field(name);
    return v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v);
  };
  return {
    projection: field("ProjectionType"),
    heading: number("PoseHeadingDegrees"),
    fullWidth: number("FullPanoWidthPixels"),
    fullHeight: number("FullPanoHeightPixels"),
    croppedWidth: number("CroppedAreaImageWidthPixels"),
    croppedHeight: number("CroppedAreaImageHeightPixels"),
    croppedLeft: number("CroppedAreaLeftPixels"),
    croppedTop: number("CroppedAreaTopPixels"),
  };
}

/** Angles of view for Pannellum from the image size and GPano: { haov, vaov, vOffset } (degrees). */
export function panoramaAngles({ width, height, gpano = {} }, fallbackHaov = 180) {
  if (gpano.fullWidth && gpano.croppedWidth) {
    const haov = (gpano.croppedWidth / gpano.fullWidth) * 360;
    const vaov = (gpano.croppedHeight / gpano.fullHeight) * 180;
    const vOffset = ((gpano.fullHeight / 2 - (gpano.croppedTop + gpano.croppedHeight / 2)) / gpano.fullHeight) * 180;
    return { haov, vaov, vOffset };
  }
  if (width && height && Math.abs(width / height - 2) < 0.05) return { haov: 360, vaov: 180, vOffset: 0 };
  // an ordinary phone panorama: wide but not a full sphere; the height follows from the width's angle
  const haov = fallbackHaov;
  return { haov, vaov: width && height ? Math.min(120, (haov * height) / width) : 60, vOffset: 0 };
}
