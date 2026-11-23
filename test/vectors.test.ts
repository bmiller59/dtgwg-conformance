// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { loadExceptions, loadSuite, VectorLoadError } from "../src/vectors/load.ts";
import { formatVectorId, parseVectorId } from "../src/vectors/ids.ts";
import { DISPOSITIONS, MUTATION_OPS } from "../src/vectors/types.ts";
import { validateVectorFile } from "../src/vectors/validate.ts";
import { MUTANTS } from "../src/adapters/reference/mutants.ts";
import { ROOT, VECTORS, tempDir } from "./helpers.ts";

const SRC = { slug: "s", version: "0.1", channel: "registry", ref: "suite:docs/README.md", pinnedDigest: null, tfRef: { status: "main", repoPath: "SPEC.md", commit: "0dbc98f1c059af300ff84eb1ab407edea16a16c1" } };
const minimal = () => ({
  format: "tt-conformance-vectors/0.1", group: "ENV", family: "framework", clock: { start: "2026-11-12T10:00:00Z" },
  vectors: [{ id: "ENV-001", title: "t", tier: 1, spec: ["x"], source: SRC, clarify: null,
    steps: [{ send: { template: "carrier.request" }, expect: { disposition: "response" } }] }],
});

describe("vector id scheme", () => {
  it("parses and formats", () => {
    assert.deepEqual(parseVectorId("VRC-ISS-014"), { group: "VRC-ISS", number: 14 });
    assert.equal(parseVectorId("ENV-001")?.group, "ENV");
    assert.equal(formatVectorId("TIME", 7), "TIME-007");
    for (const bad of ["env-001", "ENV-1", "ENV001", "-001", "ENV-001x", "ENV_001"]) assert.equal(parseVectorId(bad), null, bad);
  });
});

describe("vector validation", () => {
  it("accepts a minimal file", () => assert.deepEqual(validateVectorFile(minimal()), []));
  it("rejects structural problems", () => {
    const cases: [string, (f: ReturnType<typeof minimal>) => void, RegExp][] = [
      ["wrong format", (f) => { f.format = "x"; }, /format/],
      ["id of another group", (f) => { f.vectors[0]!.id = "ERR-001"; }, /group/],
      ["bad tier", (f) => { (f.vectors[0] as { tier: number }).tier = 3; }, /tier/],
      ["no spec trace", (f) => { f.vectors[0]!.spec = []; }, /spec/],
      ["unknown disposition", (f) => { (f.vectors[0]!.steps[0]!.expect as { disposition: string }).disposition = "maybe"; }, /disposition/],
      ["error without code", (f) => { f.vectors[0]!.steps[0]!.expect = { disposition: "error" } as never; }, /code/],
      ["step without send or verifyProof", (f) => { delete (f.vectors[0]!.steps[0] as { send?: unknown }).send; }, /exactly one/],
      ["two document sources", (f) => { (f.vectors[0]!.steps[0]!.send as Record<string, unknown>).raw = "{}"; }, /exactly one of template/],
      ["bad mutation", (f) => { (f.vectors[0]!.steps[0]!.send as Record<string, unknown>).mutate = [{ op: "explode" }]; }, /op/],
    ];
    for (const [name, mutate, re] of cases) {
      const f = minimal();
      mutate(f);
      const errs = validateVectorFile(f);
      assert.ok(errs.some((e) => re.test(e)), `${name}: ${JSON.stringify(errs)}`);
    }
  });
});

describe("loader", () => {
  it("rejects duplicate ids across files and negative vectors without a mutant", () => {
    const { dir, cleanup } = tempDir();
    try {
      const neg = minimal();
      neg.vectors[0]!.steps[0]!.expect = { disposition: "error", code: "expired" } as never;
      writeFileSync(join(dir, "a.json"), JSON.stringify(neg));
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ format: "tt-conformance-manifest/0.1", files: ["a.json"] }));
      assert.throws(() => loadSuite(dir), (e: unknown) => e instanceof VectorLoadError && /no mutant/.test(e.message));
      const pos = minimal();
      writeFileSync(join(dir, "a.json"), JSON.stringify(pos));
      writeFileSync(join(dir, "b.json"), JSON.stringify(pos));
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ format: "tt-conformance-manifest/0.1", files: ["a.json", "b.json"] }));
      assert.throws(() => loadSuite(dir), /duplicate vector id ENV-001/);
    } finally {
      cleanup();
    }
  });
  it("requires owner and expiry on exceptions", () => {
    const { dir, cleanup } = tempDir();
    try {
      const p = join(dir, "e.json");
      writeFileSync(p, JSON.stringify({ format: "tt-conformance-exceptions/0.1", exceptions: [{ impl: "x", vector: "ENV-001", reason: "r", owner: "o" }] }));
      assert.throws(() => loadExceptions(p), /expires/);
      writeFileSync(p, JSON.stringify({ format: "tt-conformance-exceptions/0.1", exceptions: [{ impl: "x", vector: "ENV-001", reason: "r", owner: "", expires: "2027-01-01" }] }));
      assert.throws(() => loadExceptions(p), /owner/);
      const base = { impl: "x", vector: "ENV-001", reason: "r", owner: "o", expires: "2027-01-01" };
      writeFileSync(p, JSON.stringify({ format: "tt-conformance-exceptions/0.1", exceptions: [base] }));
      assert.throws(() => loadExceptions(p), /acknowledged required/);
      writeFileSync(p, JSON.stringify({ format: "tt-conformance-exceptions/0.1", exceptions: [{ ...base, acknowledged: { by: "x", on: "soon" } }] }));
      assert.throws(() => loadExceptions(p), /acknowledged\.on must be YYYY-MM-DD/);
      assert.throws(() => loadExceptions(p), /acknowledged\.ref required/);
      writeFileSync(p, JSON.stringify({ format: "tt-conformance-exceptions/0.1", exceptions: [{ ...base, acknowledged: null }, { ...base, acknowledged: { by: "x project", on: "2026-11-16", ref: "challenges/a.md" } }] }));
      assert.equal(loadExceptions(p).exceptions.length, 2);
    } finally {
      cleanup();
    }
  });
});

describe("committed vectors", () => {
  const suite = loadSuite(VECTORS);
  const all = suite.files.flatMap((f) => f.file.vectors);

  it("load, validate and have unique ids", () => {
    assert.ok(all.length >= 100);
    assert.equal(new Set(all.map((v) => v.id)).size, all.length);
  });
  it("every named mutant exists", () => {
    for (const v of all) for (const m of v.mutants ?? []) assert.ok(m in MUTANTS, `${v.id}: ${m}`);
  });
  it("every vector traces to the specification", () => {
    for (const v of all) assert.ok(v.spec.length > 0 && v.spec.every((s) => s.length > 3), v.id);
  });
  it("JSON schema enums agree with the code", () => {
    const schema = JSON.parse(readFileSync(join(ROOT, "schema", "tt-conformance-vectors-0.1.schema.json"), "utf8"));
    assert.deepEqual(schema.$defs.expect.properties.disposition.enum, [...DISPOSITIONS]);
    assert.deepEqual(schema.$defs.send.properties.mutate.items.properties.op.enum, [...MUTATION_OPS]);
  });
  it("are exactly what scripts/generate-vectors.ts produces", () => {
    const { dir, cleanup } = tempDir();
    try {
      mkdirSync(join(dir, "o"));
      const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "scripts", "generate-vectors.ts"), join(dir, "o")], { cwd: ROOT, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      for (const rel of ["manifest.json", ...suite.files.map((f) => f.path.slice(VECTORS.length + 1))]) {
        assert.equal(readFileSync(join(dir, "o", rel), "utf8"), readFileSync(join(VECTORS, rel), "utf8"), rel);
      }
      // R15: the hand-authored pushed-document vectors live in vectors-src/ and are emitted, never edited in vectors/
      assert.ok(readFileSync(join(ROOT, "vectors-src", "dtg", "cex-push.json"), "utf8").length > 0);
      assert.ok(suite.files.some((f) => f.path.endsWith(join("dtg", "cex-push.json"))));
    } finally {
      cleanup();
    }
  });
});
