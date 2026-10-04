// Screenshots of the Curtin SWS "List" page, one per unit (sws/<UNIT>.png + sws/index.json).
//
// SWS keeps the chosen unit in its server session, so no link can open one unit's timetable.
// The scraper asks SWS for each unit on its own and takes a full-page 4K-wide screenshot,
// so the website can show the real SWS page for any subject ("核准查看").
import { createHash } from "node:crypto";

export const SHOT_VIEWPORT = { width: 1024, height: 800 };
export const SHOT_SCALE = 3.75; // 1024 CSS px x 3.75 = 3840 px wide

/**
 * Runs inside the SWS page (page.evaluate); must not use anything outside its own body.
 * Every table row's cell texts and its box on the page (CSS px from the page's top-left),
 * plus the page's full size, so the website can draw boxes on the screenshot.
 */
export function measureInPage() {
  const clean = (text) => (text || "").replace(/\s+/g, " ").trim();
  const root = document.documentElement;
  const rows = [...document.querySelectorAll("tr")].map((row) => {
    const box = row.getBoundingClientRect();
    return {
      cells: [...row.cells].map((cell) => clean(cell.textContent)),
      x: Math.round((box.left + window.scrollX) * 10) / 10,
      y: Math.round((box.top + window.scrollY) * 10) / 10,
      w: Math.round(box.width * 10) / 10,
      h: Math.round(box.height * 10) / 10,
    };
  });
  return { rows, pageWidth: Math.max(root.scrollWidth, document.body?.scrollWidth || 0), pageHeight: Math.max(root.scrollHeight, document.body?.scrollHeight || 0) };
}

/** Fingerprint of the timetable rows, so a unit is only re-shot when SWS really changed. */
export const rowsHash = (rows) => createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 32);

/** Width and height of a PNG from its header. */
export function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") throw new Error("not a PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * The index entry for one unit.
 *   listRows   [{cells, x, y, w, h}] rows that are SWS list rows (11 cells)
 *   size       pngSize() of the screenshot
 */
export function shotEntry({ code, label, capturedAt, hash, listRows, size, scale = SHOT_SCALE }) {
  return {
    label,
    image: `${code}.png`,
    width: size.width,
    height: size.height,
    scale,
    capturedAt,
    hash,
    rows: listRows.map((row) => ({ id: row.cells[0], x: row.x, y: row.y, w: row.w, h: row.h })),
  };
}
