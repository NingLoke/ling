// Adds ?v=<content hash> to a page's own JS module URLs ("./assets/tetris.js" -> "./assets/tetris.js?v=1a2b3c4d5e"),
// so a changed file gets a new URL and phones load it instead of an old cached copy.
//   node scripts/stamp-assets.mjs index.html
// Prints "changed" or "unchanged".
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const [htmlPath] = process.argv.slice(2);
if (!htmlPath) {
  console.error("usage: node scripts/stamp-assets.mjs <page.html>");
  process.exit(2);
}

const html = await readFile(htmlPath, "utf8");
const dir = path.dirname(htmlPath);
const pattern = /(["'])(\.\/(?:assets\/)?[\w-]+\.js)(?:\?v=[0-9a-f]*)?\1/g;

const hashes = new Map();
for (const [, , file] of html.matchAll(pattern)) {
  if (hashes.has(file)) continue;
  const body = await readFile(path.join(dir, file)).catch(() => null);
  hashes.set(file, body ? createHash("sha256").update(body).digest("hex").slice(0, 10) : null);
}
const next = html.replace(pattern, (all, quote, file) => (hashes.get(file) ? `${quote}${file}?v=${hashes.get(file)}${quote}` : all));
if (next !== html) await writeFile(htmlPath, next);
console.log(next === html ? "unchanged" : "changed");
