// The page's module URLs must carry the hash of the files as committed, or phones keep stale copies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("module URLs in index.html (and the modules they import) are stamped with the current hashes", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  let out;
  try {
    out = execFileSync(process.execPath, ["scripts/stamp-assets.mjs", "index.html", "--check"], { cwd: root, encoding: "utf8" });
  } catch (error) {
    assert.fail(`${error.stdout || error.message}\nrun: node scripts/stamp-assets.mjs index.html`);
  }
  assert.match(out, /up to date/);
});

test("Windows and Linux line endings produce the same module and page hashes", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const dir = mkdtempSync(path.join(tmpdir(), "ling-stamp-"));
  try {
    mkdirSync(path.join(dir, "assets"));
    const html = path.join(dir, "index.html"), js = path.join(dir, "assets", "test.js");
    writeFileSync(html, '<head>\n<meta charset="UTF-8">\n</head>\n<script type="module">\nimport "./assets/test.js";\n</script>\n');
    writeFileSync(js, 'export const value = 1;\n');
    const run = () => execFileSync(process.execPath, [path.join(root, "scripts", "stamp-assets.mjs"), html], { encoding: "utf8" });
    run();
    const stamped = readFileSync(html, "utf8");
    for (const file of [html, js]) writeFileSync(file, readFileSync(file, "utf8").replace(/\n/g, "\r\n"));
    run();
    assert.equal(readFileSync(html, "utf8"), stamped);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
