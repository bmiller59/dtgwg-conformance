// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { MUTANTS } from "../src/adapters/reference/mutants.ts";
import { TWO_L_MUTANTS } from "../src/adapters/reference/2l-oracle.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { checkNonVacuity, runSuite } from "../src/runner/suite.ts";
import { ROOT, FIXTURES, VECTORS, tempDir } from "./helpers.ts";

const DIR = join(VECTORS, "2l");
const suite = loadSuite(DIR);
const all = suite.files.flatMap((f) => f.file.vectors);
const today = "2026-11-15";

describe("2L vectors (second-layer common application profiles; layer 3a, channel proposed, not core)", () => {
  it("is exactly what scripts/generate-2l.ts produces", () => {
    const { dir, cleanup } = tempDir();
    try {
      mkdirSync(join(dir, "o"));
      const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "scripts", "generate-2l.ts"), join(dir, "o")], { cwd: ROOT, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      for (const rel of ["manifest.json", "not-generated.json", ...suite.files.map((f) => f.path.slice(DIR.length + 1))]) assert.equal(readFileSync(join(dir, "o", rel), "utf8"), readFileSync(join(DIR, rel), "utf8"), rel);
    } finally {
      cleanup();
    }
  });
  it("every vector is channel proposed (profile 2L), or registry once promoted (D361), with a source, a Trust Tasks reference and a citation, and fixes no role value (mechanics only)", () => {
    assert.ok(all.length >= 150);
    for (const v of all) {
      if (v.source?.channel === "registry") assert.ok(v.source?.promotion !== undefined, `${v.id}: a registry vector is a recorded promotion`);
      else { assert.equal(v.source?.channel, "proposed", v.id); assert.equal(v.source?.profile, "2L", v.id); } // the profile grouping is advisory; the task is a TF draft (tfRef), which is its real status (audit: all 29 tasks are drafts on main)
      assert.equal(v.source?.tfRef?.status, "draft", v.id);
      assert.ok(v.source?.pinnedDigest !== null, v.id);
      assert.ok(v.spec.length > 0, v.id);
      assert.ok(!/"(role|fromRole|toRole)":"(?!\$role)/.test(JSON.stringify(v.steps)), v.id);
      assert.ok((v.requires ?? []).some((r) => r.startsWith("https://trusttasks.org/spec/") || r.startsWith("emit:")), `${v.id} is gated on the type`);
    }
  });
  it("only its promoted vectors are in the default (registry) run, and none enters the registry vector directory", async () => {
    const run = await runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today, fixtureRoot: FIXTURES, salt: "" });
    const promoted = all.filter((v) => v.source?.channel === "registry").map((v) => v.id).sort();
    assert.deepEqual(run.results.map((r) => r.id).sort(), promoted);
    assert.equal(run.excludedByChannel!.proposed.length, all.length - promoted.length);
    const root = loadSuite(VECTORS);
    const ids = new Set(root.files.flatMap((f) => f.file.vectors.map((v) => v.id)));
    for (const v of all) assert.ok(!ids.has(v.id), v.id);
  });
  it("the reference passes every vector, and an adapter that serves and emits no 2L type is SKIP, never PASS", async () => {
    const run = await runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today, fixtureRoot: FIXTURES, salt: "", channels: ["registry", "proposed"] });
    assert.deepEqual(run.results.filter((r) => r.status === "FAIL"), []);
    assert.ok(run.results.filter((r) => r.status === "PASS").length >= 100);
    const none = await runSuite({ adapter: new ReferenceAdapter({ plain: false }), suite, tier: 1, today, fixtureRoot: FIXTURES, salt: "", channels: ["registry", "proposed"] });
    assert.equal(none.results.filter((r) => r.status !== "SKIP").length, 0);
  });
  it("non-vacuity: every mutant a 2L vector names makes it fail, and each 2L-specific mutant is used", async () => {
    const rows = await checkNonVacuity(suite, FIXTURES);
    assert.ok(rows.length >= 150);
    assert.deepEqual(rows.filter((r) => !r.caught), []);
    const used = new Set(all.flatMap((v) => v.mutants ?? []));
    for (const m of Object.keys(TWO_L_MUTANTS)) assert.ok(used.has(m) && m in MUTANTS, m);
    for (const m of ["recipientOptional", "plainBadResponse", "noPayloadValidation", "openPayload", "proofOptional", "emitBadPayload", "emitNoProof"]) assert.ok(used.has(m), m);
  });
});
