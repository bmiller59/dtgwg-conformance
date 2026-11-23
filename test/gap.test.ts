// SPDX-License-Identifier: Apache-2.0
// The gap families (vectors/gap: every family whose versions no other set covers; layer 3a, not core).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { MUTANTS } from "../src/adapters/reference/mutants.ts";
import { loadTask, packageHas } from "../src/plain/catalog.ts";
import { rolesAreGovernance } from "../src/plain/gap-build.ts";
import { GAP_FAMILIES, gapTasks } from "../src/plain/gap.ts";
import { constraintViolations, missingRequired } from "../src/plain/negatives.ts";
import { validate } from "../src/plain/schema.ts";
import { loadSnapshot } from "../src/plain/snapshot.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { checkNonVacuity, runSuite } from "../src/runner/suite.ts";
import { FIXTURES, ROOT, VECTORS, tempDir } from "./helpers.ts";

const GAP = join(VECTORS, "gap");
const suite = loadSuite(GAP);
const today = "2026-11-19";

describe("gap families: negatives derived from a schema", () => {
  const root = { type: "object", required: ["a", "n"], additionalProperties: false, properties: { a: { type: "string", minLength: 2, maxLength: 4, pattern: "^[a-z]+$" }, n: { type: "integer", minimum: 1, maximum: 5 }, e: { enum: ["x", "y"] }, l: { type: "array", minItems: 1, items: { type: "string" } } } };
  const valid = { a: "ab", n: 2, e: "x", l: ["q"] };
  it("one negative per required member, each refused by the schema", () => {
    const m = missingRequired(root, valid);
    assert.deepEqual(m.map((x) => x.label), ["missing required member a", "missing required member n"]);
    for (const x of m) assert.ok(validate(root, x.payload).length > 0);
  });
  it("one negative per stated constraint, each refused by the schema; a candidate the schema accepts is dropped", () => {
    const c = constraintViolations(root, valid);
    const labels = c.map((x) => x.label).join("|");
    for (const want of ["longer than maxLength 4", "shorter than minLength 2", "does not match its pattern", "below minimum 1", "above maximum 5", "outside its enum", "fewer than minItems 1"]) assert.match(labels, new RegExp(want));
    for (const x of c) assert.ok(validate(root, x.payload).length > 0, x.label);
    assert.deepEqual(constraintViolations({ type: "object", properties: { s: { type: "string" } } }, { s: "a" }).map((x) => x.label), ["s: wrong type (not string)"]);
  });
  it("a role member is a governance token only where the schema admits any string", () => {
    assert.equal(rolesAreGovernance({ type: "object", properties: { role: { type: "string", minLength: 1 } } }, { role: "admin" }), true);
    assert.equal(rolesAreGovernance({ type: "object", properties: { role: { enum: ["signing", "auth"] } } }, { role: "signing" }), false);
    assert.equal(rolesAreGovernance({ type: "object", properties: { a: { type: "string" } } }, { a: "x" }), false);
  });
});

describe("gap families: the snapshot and the tasks", () => {
  const snap = loadSnapshot();
  it("holds every version of the named families, with a policy, and records where its text is from", () => {
    assert.match(snap.tfCommit, /^[0-9a-f]{40}$/);
    assert.deepEqual([...new Set(snap.tasks.map((t) => t.family))].sort(), [...GAP_FAMILIES].sort());
    for (const t of snap.tasks) {
      assert.ok(["draft", "retired"].includes(t.status), `${t.typeUri}: status ${t.status}`);
      assert.match(t.specHash, /^sha256:[0-9a-f]{64}$/);
      assert.equal(t.inPackage, packageHas(t.typeUri), t.typeUri);
      assert.equal(t.payloadSchema !== undefined, !t.inPackage, `${t.typeUri}: a schema is stored exactly when the package lacks the version`);
    }
  });
  it("loadTask falls back to the snapshot for a version the pinned package does not ship", () => {
    const only = snap.tasks.find((t) => !t.inPackage)!;
    const task = loadTask(only.typeUri)!;
    assert.equal(task.typeUri, only.typeUri);
    assert.deepEqual(task.requestPolicy, only.requestPolicy);
  });
  it("every version yields a valid payload, and every kept example and invalid example is judged by the task's own schema", () => {
    for (const g of gapTasks()) {
      assert.ok(g.valid !== undefined, g.snap.typeUri);
      assert.deepEqual(validate(g.task.payloadSchema, g.valid), [], g.snap.typeUri);
      for (const e of g.examples) assert.deepEqual(validate(g.task.payloadSchema, e.payload), [], g.snap.typeUri);
      for (const e of g.invalid) assert.ok(validate(g.task.payloadSchema, e.payload).length > 0, g.snap.typeUri);
    }
  });
});

describe("gap families: vectors/gap", () => {
  it("is exactly what scripts/generate-gap.ts produces", () => {
    const { dir, cleanup } = tempDir();
    try {
      mkdirSync(join(dir, "o"));
      const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "scripts", "generate-gap.ts"), join(dir, "o")], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
      assert.equal(r.status, 0, r.stderr);
      for (const rel of ["manifest.json", "not-generated.json", "clarify-classes.json", ...suite.files.map((f) => f.path.slice(GAP.length + 1))]) assert.equal(readFileSync(join(dir, "o", rel), "utf8"), readFileSync(join(GAP, rel), "utf8"), rel);
    } finally {
      cleanup();
    }
  });
  it("is a separate family, cites the task-force text with its maturity, and marks a retired spec excluded and a branch-modified one provisional", () => {
    const snap = loadSnapshot();
    let retired = 0;
    let provisional = 0;
    let onPr = 0;
    for (const { file } of suite.files) {
      assert.equal(file.family, "gap");
      for (const v of file.vectors) {
        const task = snap.tasks.find((t) => t.typeUri === `https://trusttasks.org/spec/${v.source!.slug}/${v.source!.version}`)!;
        assert.ok(task !== undefined, v.id);
        if (task.origin === undefined) {
          // non-core, non-gating, outside headline counts, unless promoted (vectors-src/promotions.json, docs/33), which keeps the former tags
          assert.equal(v.source?.promotion?.was.channel ?? v.source?.channel, "proposed", v.id);
          assert.equal(v.source?.promotion?.was.profile ?? v.source?.profile, "gap-families", v.id);
          assert.equal(v.source?.tfCommit, snap.tfCommit, v.id);
          assert.equal(v.source?.tfRef?.status, task.status === "retired" ? "retired" : "draft", v.id);
        } else {
          // a version that exists only on an open pull request: channel pr (advisory too), citing the PR head, never main
          onPr++;
          assert.equal(v.source?.channel, "pr", v.id);
          assert.equal(v.source?.tfCommit, task.origin.sha, v.id);
          assert.deepEqual(v.source?.tfRef, { status: "pr", pr: 904, head: task.origin.sha }, v.id);
          assert.match(v.source?.note ?? "", /not on main/, v.id);
        }
        assert.match(v.source?.note ?? "", /Spec maturity: (draft|retired)/, v.id);
        if (task.status === "retired") { retired++; assert.ok(v.excludedFromRun !== undefined, v.id); } else assert.equal(v.excludedFromRun, undefined, v.id);
        if ((task.branches ?? []).length > 0) { provisional++; assert.match(v.source?.note ?? "", /PROVISIONAL AGAINST BRANCHES/, v.id); }
        assert.ok(!/"(role|fromRole|toRole)":"(?!\$role)/.test(JSON.stringify(v.steps)) || !/optional:governance.roles/.test(JSON.stringify(v.requires)), v.id);
      }
    }
    assert.ok(retired > 0 && provisional > 0 && onPr > 0);
  });
  it("the reference passes at both tiers, attested and not", async () => {
    for (const [adapter, tier] of [[new ReferenceAdapter(), 1], [new ReferenceAdapter({ attested: true }), 2]] as const) {
      const run = await runSuite({ adapter, suite, tier, today, fixtureRoot: FIXTURES, channels: ["proposed", "pr"] });
      assert.deepEqual(run.results.filter((r) => r.status === "FAIL"), []);
      assert.ok(run.results.filter((r) => r.status === "PASS").length >= 4000);
    }
  });
  it("non-vacuity: every mutant a gap vector names makes it fail", async () => {
    const rows = await checkNonVacuity(suite, FIXTURES);
    assert.ok(rows.length >= 3500);
    assert.deepEqual(rows.filter((r) => !r.caught).map((r) => `${r.vector}:${r.mutant}`).slice(0, 20), []);
    const used = new Set(suite.files.flatMap((f) => f.file.vectors.flatMap((v) => v.mutants ?? [])));
    for (const m of ["recipientOptional", "plainBadResponse", "noPayloadValidation", "openPayload", "proofOptional", "noFreshnessWindow"]) assert.ok(used.has(m) && m in MUTANTS, m);
  });
});
