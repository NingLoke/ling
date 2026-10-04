// Adds ?v=<content hash> to a page's own JS module URLs ("./assets/tetris.js" -> "./assets/tetris.js?v=1a2b3c4d5e"),
// so a changed file gets a new URL and phones load it instead of an old cached copy. Modules that import
// other modules ("./campus-geo.js" inside assets/campus-map.js) are stamped first, so a change deep down
// changes every URL on the way up.
//   node scripts/stamp-assets.mjs index.html            update the files, print "changed" or "unchanged"
//   node scripts/stamp-assets.mjs index.html --check    change nothing; exit 1 and list files that are out of date
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const args = process.argv.slice(2);
const check = args.includes("--check");
const [entry] = args.filter((a) => !a.startsWith("--"));
if (!entry) {
  console.error("usage: node scripts/stamp-assets.mjs <page.html> [--check]");
  process.exit(2);
}

const pattern = /(["'])(\.\/(?:assets\/)?[\w-]+\.js)(?:\?v=[0-9a-f]*)?\1/g;
const files = new Map(); // absolute path -> { before, after }

async function stamped(file, stack = []) {
  if (files.has(file)) return files.get(file).after;
  if (stack.includes(file)) throw new Error(`import cycle: ${[...stack, file].join(" -> ")}`);
  const before = await readFile(file, "utf8");
  const hashes = new Map();
  for (const [, , ref] of before.matchAll(pattern)) {
    if (hashes.has(ref)) continue;
    const body = await stamped(path.join(path.dirname(file), ref), [...stack, file]).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    hashes.set(ref, body == null ? null : createHash("sha256").update(body).digest("hex").slice(0, 10));
  }
  const after = before.replace(pattern, (all, quote, ref) => (hashes.get(ref) ? `${quote}${ref}?v=${hashes.get(ref)}${quote}` : all));
  files.set(file, { before, after });
  return after;
}

await stamped(path.resolve(entry));
const changed = [...files].filter(([, f]) => f.before !== f.after).map(([file]) => file);
if (check) {
  if (changed.length) {
    console.log(`out of date: ${changed.map((f) => path.relative(process.cwd(), f)).join(", ")}`);
    process.exit(1);
  }
  console.log("up to date");
} else {
  for (const file of changed) await writeFile(file, files.get(file).after);
  console.log(changed.length ? "changed" : "unchanged");
}
