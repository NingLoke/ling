// The page's module URLs must carry the hash of the files as committed, or phones keep stale copies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
