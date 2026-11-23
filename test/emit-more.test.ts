// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { runSuite } from "../src/runner/suite.ts";
import { ROOT, FIXTURES, VECTORS, tempDir } from "./helpers.ts";

describe("producer class, further families (vectors/emit-more; layer 3a, not core)", () => {
  const dir0 = join(VECTORS, "emit-more");
  const more = loadSuite(dir0);
  it("is exactly what scripts/generate-emit-more.ts produces", () => {
    const { dir, cleanup } = tempDir();
    try {
      mkdirSync(join(dir, "o"));
      const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "scripts", "generate-emit-more.ts"), join(dir, "o")], { cwd: ROOT, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      for (const rel of ["manifest.json", ...more.files.map((f) => f.path.slice(dir0.length + 1))]) assert.equal(readFileSync(join(dir, "o", rel), "utf8"), readFileSync(join(dir0, rel), "utf8"), rel);
    } finally {
      cleanup();
    }
  });
  it("has 75 vectors, none of which fixes a role or policy content, and an adapter declaring no emit is SKIP, never PASS", async () => {
    const all = more.files.flatMap((f) => f.file.vectors);
    assert.equal(all.length, 75);
    for (const v of all) assert.ok(!/"(role|fromRole|toRole)":"(?!\$role)/.test(JSON.stringify(v.steps)), v.id);
    const none = await runSuite({ adapter: new ReferenceAdapter({ plain: false }), suite: more, tier: 1, today: "2026-11-15", fixtureRoot: FIXTURES });
    assert.equal(none.results.filter((r) => r.status !== "SKIP").length, 0);
  });
});
