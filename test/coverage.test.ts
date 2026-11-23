// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { COVERAGE_FAMILIES, isDestructive, loadCensus } from "../src/coverage/families.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { checkNonVacuity, runSuite } from "../src/runner/suite.ts";
import { ROOT, FIXTURES, VECTORS, tempDir } from "./helpers.ts";

const DIR = join(VECTORS, "coverage");
const suite = loadSuite(DIR);
const all = suite.files.flatMap((f) => f.file.vectors);
const today = "2026-11-18";

describe("coverage family vectors (docs/22; layer 3a, channel proposed, not core)", () => {
  it("is exactly what scripts/generate-coverage.ts produces", () => {
    const { dir, cleanup } = tempDir();
    try {
      mkdirSync(join(dir, "o"));
      const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "scripts", "generate-coverage.ts"), join(dir, "o")], { cwd: ROOT, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      for (const rel of ["manifest.json", "not-generated.json", "clarify-classes.json", ...suite.files.map((f) => f.path.slice(DIR.length + 1))]) assert.equal(readFileSync(join(dir, "o", rel), "utf8"), readFileSync(join(DIR, rel), "utf8"), rel);
    } finally { cleanup(); }
  });
  it("every vector is channel proposed or candidate (or registry only through a recorded promotion, docs/33), with a source, a Trust Tasks reference and a citation; none fixes a role value", () => {
    assert.ok(all.length >= 900);
    for (const v of all) {
      // a promoted vector (vectors-src/promotions.json) is registry and keeps its former tags in source.promotion.was
      const was = v.source?.promotion?.was;
      const channel = was?.channel ?? v.source?.channel;
      const profile = was?.profile ?? v.source?.profile;
      if (v.source?.promotion !== undefined) assert.equal(v.source.channel, "registry", v.id);
      assert.ok(channel === "proposed" || channel === "candidate", v.id);
      if (channel === "proposed") assert.equal(profile, "coverage", v.id);
      // a candidate coverage vector (CC, decision CV-6) has no Trust Tasks text: it rests on the suite-owned local text, test/coverage-candidates.test.ts
      if (channel === "candidate") assert.ok(v.id.startsWith("CC-") && v.source!.candidate !== undefined && v.source!.pinnedDigest !== null, v.id);
      else assert.ok(v.source?.tfRef !== undefined && v.source.pinnedDigest !== null, v.id);
      assert.ok(v.spec.length > 0, v.id);
      assert.ok(!/"(role|fromRole|toRole)":"(?!\$role)/.test(JSON.stringify(v.steps)), v.id);
    }
  });
  it("every census type with a buildable specification has a vector, in the family the census names; the families are exactly the eight", () => {
    assert.equal(COVERAGE_FAMILIES.length, 8);
    const have = new Set(all.map((v) => `${v.source!.slug}/${v.source!.version}`));
    const notGen = JSON.parse(readFileSync(join(DIR, "not-generated.json"), "utf8")) as { types: { type: string; reason: string }[] };
    for (const r of loadCensus().filter((x) => x.family !== "FW")) {
      if (have.has(r.type)) continue;
      assert.ok(notGen.types.some((n) => n.type === r.type), `${r.type} has neither a vector nor a listed reason`);
    }
  });
  it("a destructive task is probed with schema-invalid payloads only (no valid-payload probe, no unknown-member probe)", () => {
    const destructive = all.filter((v) => isDestructive(v.source!.slug) && v.id.startsWith("C") && !v.id.startsWith("CE-"));
    assert.ok(destructive.length > 20);
    for (const v of destructive) {
      assert.ok(!/is not refused for an envelope reason/.test(v.title), v.id);
      assert.ok(!/policy the specification declares/.test(v.title), v.id);
      for (const s of v.steps) if ("send" in s) assert.equal((s.expect as { disposition?: string }).disposition, "error", v.id);
    }
  });
  it("only its promoted vectors are in the default (registry) run, and none enters the registry vector directory", async () => {
    const run = await runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today, fixtureRoot: FIXTURES, salt: "" });
    const promoted = all.filter((v) => v.source?.channel === "registry").map((v) => v.id).sort();
    assert.deepEqual(run.results.map((r) => r.id).sort(), promoted);
    assert.deepEqual(run.results.filter((r) => r.status !== "PASS" && r.status !== "SKIP").map((r) => r.id), []);
    const ids = new Set(loadSuite(VECTORS).files.flatMap((f) => f.file.vectors.map((v) => v.id)));
    for (const v of all) assert.ok(!ids.has(v.id), v.id);
  });
  it("the reference passes every vector, and an adapter that serves and emits nothing is SKIP, never PASS", async () => {
    const run = await runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today, fixtureRoot: FIXTURES, salt: "", channels: ["registry", "proposed", "candidate"] });
    assert.deepEqual(run.results.filter((r) => r.status === "FAIL").map((r) => r.id), []);
    assert.ok(run.results.filter((r) => r.status === "PASS").length >= 900);
    const none = await runSuite({ adapter: new ReferenceAdapter({ plain: false }), suite, tier: 1, today, fixtureRoot: FIXTURES, salt: "", channels: ["registry", "proposed", "candidate"] });
    assert.equal(none.results.filter((r) => r.status !== "SKIP").length, 0);
  });
  it("non-vacuity: every mutant a coverage vector names makes it fail", async () => {
    const rows = await checkNonVacuity(suite, FIXTURES);
    assert.ok(rows.length >= 900);
    assert.deepEqual(rows.filter((r) => !r.caught).map((r) => r.vector), []);
  });
});
