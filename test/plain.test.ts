// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { MUTANTS } from "../src/adapters/reference/mutants.ts";
import { example, validate } from "../src/plain/schema.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { checkNonVacuity, runSuite } from "../src/runner/suite.ts";
import { ROOT, FIXTURES, VECTORS, tempDir } from "./helpers.ts";

const PLAIN = join(VECTORS, "plain");
const suite = loadSuite(PLAIN);
const today = "2026-11-15";

describe("plain-task family (layer 3a, not core)", () => {
  it("is a separate family and keeps its governance rule: no role value is fixed in any vector", () => {
    for (const { file } of suite.files) {
      assert.equal(file.family, "plain");
      for (const v of file.vectors) assert.ok(!/"(role|fromRole|toRole)":"(?!\$role)/.test(JSON.stringify(v.steps)), v.id);
    }
  });
  it("is exactly what scripts/generate-plain.ts produces", () => {
    const { dir, cleanup } = tempDir();
    try {
      mkdirSync(join(dir, "o"));
      const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "scripts", "generate-plain.ts"), join(dir, "o")], { cwd: ROOT, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      for (const rel of ["manifest.json", "not-generated.json", ...suite.files.map((f) => f.path.slice(PLAIN.length + 1))]) assert.equal(readFileSync(join(dir, "o", rel), "utf8"), readFileSync(join(PLAIN, rel), "utf8"), rel);
    } finally {
      cleanup();
    }
  });
  it("the reference passes at both tiers, attested and not", async () => {
    for (const [adapter, tier] of [[new ReferenceAdapter(), 1], [new ReferenceAdapter({ attested: true }), 2]] as const) {
      const run = await runSuite({ adapter, suite, tier, today, fixtureRoot: FIXTURES });
      assert.deepEqual(run.results.filter((r) => r.status === "FAIL"), []);
      assert.ok(run.results.filter((r) => r.status === "PASS").length >= 400);
    }
  });
  it("SKIPs, with the reason 'governance not declared', a vector that needs a role value the adapter did not declare", async () => {
    class NoGov extends ReferenceAdapter {
      override async capabilities() {
        const c = await super.capabilities();
        return { ...c, optional: c.optional.filter((o) => o !== "governance.roles"), governance: undefined };
      }
    }
    const run = await runSuite({ adapter: new NoGov(), suite, tier: 1, today, fixtureRoot: FIXTURES });
    const gov = run.results.filter((r) => /governance not declared \(optional:governance.roles\)/.test(r.reason ?? ""));
    assert.ok(gov.length > 0);
    assert.deepEqual(run.results.filter((r) => r.status === "FAIL"), []);
  });
  it("non-vacuity: every mutant a plain vector names makes it fail", async () => {
    const rows = await checkNonVacuity(suite, FIXTURES);
    assert.ok(rows.length >= 400);
    assert.deepEqual(rows.filter((r) => !r.caught), []);
    const used = new Set(suite.files.flatMap((f) => f.file.vectors.flatMap((v) => v.mutants ?? [])));
    for (const m of ["recipientOptional", "plainBadResponse", "noPayloadValidation", "openPayload", "proofOptional", "noFreshnessWindow"]) assert.ok(used.has(m) && m in MUTANTS, m);
  });
});

describe("schema validator and generator", () => {
  const s = { type: "object", required: ["a"], additionalProperties: false, properties: { a: { type: "string", minLength: 2, pattern: "^[a-z]+$" }, b: { oneOf: [{ type: "integer" }, { type: "boolean" }] } } };
  it("validates", () => {
    assert.deepEqual(validate(s, { a: "xy" }), []);
    assert.ok(validate(s, {}).length > 0);
    assert.ok(validate(s, { a: "xy", c: 1 }).length > 0);
    assert.ok(validate(s, { a: "y" }).length > 0);
    assert.ok(validate(s, { a: "xy", b: "s" }).length > 0);
  });
  it("generates a valid instance", () => assert.deepEqual(validate(s, example(s)), []));
});

describe("producer class (emit; layer 3a, not core)", () => {
  const emitDir = join(VECTORS, "emit");
  const emit = loadSuite(emitDir);
  it("is exactly what scripts/generate-emit.ts produces", () => {
    const { dir, cleanup } = tempDir();
    try {
      mkdirSync(join(dir, "o"));
      const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "scripts", "generate-emit.ts"), join(dir, "o")], { cwd: ROOT, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      for (const rel of ["manifest.json", ...emit.files.map((f) => f.path.slice(emitDir.length + 1))]) assert.equal(readFileSync(join(dir, "o", rel), "utf8"), readFileSync(join(emitDir, rel), "utf8"), rel);
    } finally {
      cleanup();
    }
  });
  it("the reference passes, and an adapter that declares no emit capability is SKIP, never PASS", async () => {
    const run = await runSuite({ adapter: new ReferenceAdapter(), suite: emit, tier: 1, today, fixtureRoot: FIXTURES });
    assert.deepEqual(run.results.filter((r) => r.status === "FAIL"), []);
    assert.ok(run.results.filter((r) => r.status === "PASS").length >= 150);
    const none = await runSuite({ adapter: new ReferenceAdapter({ plain: false }), suite: emit, tier: 1, today, fixtureRoot: FIXTURES });
    assert.equal(none.results.filter((r) => r.status !== "SKIP").length, 0);
  });
  it("a standIn note returned by emit is recorded as an advisory and does not change the result", async () => {
    const ref = new ReferenceAdapter();
    const wrapped = Object.assign(Object.create(ref), { emit: async (p: Parameters<NonNullable<typeof ref.emit>>[0]) => ({ ...(await ref.emit!(p)), standIn: ["class D: signed by a stand-in"] }) });
    const run = await runSuite({ adapter: wrapped, suite: emit, tier: 1, today, fixtureRoot: FIXTURES });
    const passed = run.results.filter((r) => r.status === "PASS");
    assert.ok(passed.length >= 150);
    assert.ok(JSON.stringify(passed[0]).includes("class D: signed by a stand-in"));
    assert.deepEqual(run.results.filter((r) => r.status === "FAIL"), []);
  });
  it("non-vacuity: every emit mutant makes the vector fail", async () => {
    const rows = await checkNonVacuity(emit, FIXTURES);
    assert.ok(rows.length >= 400);
    assert.deepEqual(rows.filter((r) => !r.caught), []);
    const used = new Set(emit.files.flatMap((f) => f.file.vectors.flatMap((v) => v.mutants ?? [])));
    for (const m of ["emitBadPayload", "emitNoProof", "emitNoRecipient", "emitNoIssuedAt"]) assert.ok(used.has(m) && m in MUTANTS, m);
  });
});
