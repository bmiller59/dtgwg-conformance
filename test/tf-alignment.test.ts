// SPDX-License-Identifier: Apache-2.0
// The task-force alignment tool (src/tfalign, scripts/tf-alignment.ts) over a small synthetic checkout and suite, and the advisory alignment vectors.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { analyse, embeddedExamples, payloadMatches } from "../src/tfalign/analyse.ts";
import { renderReport } from "../src/tfalign/report.ts";
import { openTf } from "../src/tfalign/source.ts";
import { loadSuiteFacts } from "../src/tfalign/suite.ts";
import { hashTfPath } from "../src/vectors/spec-hash.ts";
import { loadSuite } from "../src/vectors/load.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const B = "https://trusttasks.org/spec/";
const tmp = mkdtempSync(join(tmpdir(), "tf-align-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const put = (root: string, p: string, body: unknown): void => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), typeof body === "string" ? body : JSON.stringify(body, null, 1)); };
const fm = (status: string): string => `---\nstatus: ${status}\n---\n# T\n`;
const example = (type: string, payload: unknown): string => "```json\n" + JSON.stringify({ id: "x", type, payload }, null, 1) + "\n```\n";

/** A tiny task-force checkout: three tasks (one retired, one nobody sends anything to), five invalid examples, two fixtures, one ceremony. */
function makeTf(root: string): void {
  put(root, "specs/alpha/one/0.1/spec.md", fm("draft") + example(`${B}alpha/one/0.1`, { a: 1 }) + example(`${B}alpha/one/0.1#response`, { ok: true }));
  put(root, "specs/alpha/one/0.1/payload.invalid-examples.json", [{ note: "a missing", payload: {} }, { note: "a is text", payload: { a: "x" } }, { note: "extra member", payload: { a: 1, z: 2 } }]);
  put(root, "specs/alpha/two/0.1/spec.md", fm("draft"));
  put(root, "specs/alpha/two/0.1/payload.invalid-examples.json", [{ note: "bad", payload: { q: 1 } }]);
  put(root, "specs/alpha/old/0.1/spec.md", fm("retired"));
  put(root, "specs/alpha/old/0.1/payload.invalid-examples.json", [{ note: "bad", payload: { r: 1 } }]);
  put(root, "specs/_framework/0.1/spec.md", fm("draft"));
  put(root, "fixtures/proof/p1.json", { n: 1 });
  put(root, "fixtures/proof/p2.json", { n: 2 });
  put(root, "fixtures/proof/manifest.json", { entries: [] });
  put(root, "ceremonies/mine/demo/0.1/ceremony.json", { name: "demo" });
  put(root, "ceremonies/ceremony.invalid-examples.json", { cases: [{}, {}] });
  put(root, "scripts/check-bindings-conformance.mjs", "// x\n");
  put(root, "trust-tasks-go/a_test.go", "package a\n");
}

function makeSuite(root: string, tf: string): void {
  const doc = (n: string, type: string, payload: unknown): unknown => ({ id: `$id(${n})`, type, payload });
  put(root, "vectors/g.json", { format: "tt-conformance-vectors/0.1", group: "G", family: "f", vectors: [
    { id: "G-001", title: "t", spec: ["payload.invalid-examples.json of x"], source: { slug: "alpha/one", version: "0.1", channel: "proposed", ref: "kit:specs/alpha/one/0.1", tfRef: { repoPath: "specs/alpha/one/0.1/spec.md" } },
      steps: [{ send: { document: doc("a", `${B}alpha/one/0.1`, {}) }, expect: { disposition: "error" } }, { send: { document: doc("b", `${B}alpha/one/0.1`, { a: "$tok" }) }, expect: { disposition: "error" } }] },
    { id: "G-002", title: "cites a file that is gone", spec: ["specs/alpha/gone/0.1/spec.md"], source: { slug: "alpha/gone", version: "0.1", channel: "proposed", ref: "kit:specs/alpha/gone/0.1", tfRef: { repoPath: "specs/alpha/gone/0.1/spec.md" } }, steps: [] },
    { id: "G-003", title: "text moved", spec: [], source: { slug: "alpha/two", version: "0.1", channel: "proposed", ref: "kit:specs/alpha/two/0.1", specHash: "sha256:" + "0".repeat(64), tfRef: { repoPath: "specs/alpha/two/0.1/spec.md" } }, steps: [{ send: { document: doc("c", `${B}alpha/two/0.1`, { ok: 1 }) }, expect: { disposition: "answered" } }] },
  ] });
  put(root, "vectors/imported/proof/p1.json", { n: 1 });
  put(root, "vectors/imported/PROVENANCE.json", { commit: null, importedOn: "2026-01-01", files: [{ path: "proof/p1.json" }, { path: "proof/p9.json" }] });
  void tf;
}

const sha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");
function snapshot(dir: string, out: string[] = []): string[] { for (const n of readdirSync(dir).sort()) { const p = join(dir, n); if (statSync(p).isDirectory()) snapshot(p, out); else out.push(`${p}:${sha(p)}:${statSync(p).mtimeMs}`); } return out; }

describe("tf-alignment: building blocks", () => {
  it("a vector token matches a value of its own kind only; everything else must be equal", () => {
    assert.ok(payloadMatches({ a: "$id(x)", b: [1, { c: "$now+0s" }] }, { a: "anything", b: [1, { c: "2026-11-12T10:00:00Z" }] }));
    assert.ok(!payloadMatches({ c: "$now+1h" }, { c: "last Tuesday" }), "a clock token matches only an RFC 3339 date-time");
    assert.ok(!payloadMatches({ c: "$now+0s" }, { c: 7 }), "a token matches only a string");
    assert.ok(!payloadMatches({ a: "$id(x)" }, { a: { nested: 1 } }));
    assert.ok(!payloadMatches({ a: 1 }, { a: 1, b: 2 }), "a member the example lacks or has extra is a difference");
    assert.ok(!payloadMatches({ a: "x" }, { a: "y" }));
    assert.ok(!payloadMatches([1], [1, 2]));
  });
  it("tells request examples from response examples in a specification", () => {
    const e = embeddedExamples(example(`${B}a/b/0.1`, { x: 1 }) + example(`${B}a/b/0.1#response`, {}) + "```json\n{not json}\n```\n");
    assert.equal(e.request.length, 1);
    assert.equal(e.response.length, 1);
  });
});

describe("tf-alignment: over a synthetic checkout and suite", () => {
  const tf = join(tmp, "tf"), suite = join(tmp, "suite");
  makeTf(tf); makeSuite(suite, tf);
  const before = snapshot(tf);
  const run = (): Record<string, any> => { const s = openTf(tf); try { return analyse(s, { suiteRoot: suite }) as Record<string, any>; } finally { s.cleanup(); } }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = run();

  it("counts what the checkout holds, with the retired task and the framework folder handled", () => {
    assert.equal(r.inventory.tasks.total, 3);
    assert.equal(r.inventory.tasks.retired, 1);
    assert.equal(r.inventory.invalidExamples, 5);
    assert.equal(r.inventory.invalidExampleFiles, 3);
    assert.equal(r.inventory.payloadExamplesFiles, 0);
    assert.equal(r.inventory.embeddedRequestExamples, 1);
    assert.equal(r.inventory.embeddedResponseExamples, 1);
    assert.equal(r.inventory.ceremonyInvalidCases, 2);
    assert.equal(r.inventory.bindingsConformanceScript, true);
    assert.equal(r.inventory.libraryTestFiles.go.testFiles, 1);
  });
  it("maps invalid examples: two used, three not, each with a reason", () => {
    const m = r.mapping.invalidExamples;
    assert.equal(m.total, 5);
    assert.equal(m.exact, 2);
    assert.equal(m.notMatched + m.namedOnly, 3);
    assert.equal(m.reasons.taskRetired, 1);
    assert.deepEqual([...r.unmappedInvalidExamples].sort(), ["alpha/old/0.1#0", "alpha/one/0.1#2", "alpha/two/0.1#0"]);
  });
  it("flags tasks with no vector", () => {
    assert.deepEqual(r.mapping.tasks.noVectorsList, [`${B}alpha/old/0.1`]);
    assert.equal(r.mapping.tasks.withStep, 2);
  });
  it("flags a cited file that no longer exists and a cited text that moved", () => {
    assert.deepEqual(r.mapping.citations.missingList.map((x: { path: string }) => x.path), ["specs/alpha/gone/0.1/spec.md"]);
    assert.deepEqual(r.mapping.citations.changedList.map((x: { path: string }) => x.path), ["specs/alpha/two/0.1/spec.md"]);
  });
  it("flags fixtures not imported and imported files that vanished", () => {
    assert.equal(r.mapping.fixtures.total, 2);
    assert.equal(r.mapping.fixtures.importedIdentical, 1);
    assert.deepEqual(r.mapping.fixtures.notImportedList, ["fixtures/proof/p2.json"]);
    assert.deepEqual(r.mapping.fixtures.importedGoneList, ["proof/p9.json"]);
  });
  it("lists a ceremony definition no scenario cites", () => {
    assert.equal(r.mapping.ceremonies.definitions, 1);
    assert.equal(r.mapping.ceremonies.withScenarios, 0);
  });
  it("is deterministic and leaves the checkout untouched", () => {
    assert.equal(JSON.stringify(run()), JSON.stringify(r));
    assert.deepEqual(snapshot(tf), before, "no file of the checkout changed (content or time)");
  });
  it("the report prints denominators and the draft status line", () => {
    const md = renderReport(r);
    assert.match(md, /Status: draft proposal/);
    assert.match(md, /Every specification measured here is a draft/);
    assert.match(md, /\| Invalid examples used \(all sets\) \| 2 \| 5 \| 40\.0% \|/);
  });
  it("the command line writes the two files and refuses a directory that is not a checkout", () => {
    const out = join(tmp, "out");
    const ok = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "scripts", "tf-alignment.ts"), tf, "--out", out], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(readFileSync(join(out, "tf-alignment.json"), "utf8")).format, "tt-tf-alignment/0.1");
    const bad = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "scripts", "tf-alignment.ts"), tmp, "--out", out], { encoding: "utf8" });
    assert.notEqual(bad.status, 0);
  });
});

describe("advisory alignment vectors (vectors/alignment)", () => {
  it("is exactly what scripts/generate-alignment.ts produces, and loads", () => {
    const dir = mkdtempSync(join(tmp, "gen-"));
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "scripts", "generate-alignment.ts"), dir], { cwd: ROOT, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    for (const f of readdirSync(dir)) assert.equal(readFileSync(join(dir, f), "utf8"), readFileSync(join(ROOT, "vectors", "alignment", f), "utf8"), f);
    assert.equal(readdirSync(dir).length, readdirSync(join(ROOT, "vectors", "alignment")).length);
    assert.ok(loadSuite(join(ROOT, "vectors", "alignment")).files.length > 0);
  });
  it("every vector is advisory (proposed, profile tf-alignment) and expects a refusal at every step", () => {
    const f = JSON.parse(readFileSync(join(ROOT, "vectors", "alignment", "tfa-inv.json"), "utf8")) as { vectors: { id: string; source: { channel: string; profile: string }; steps: { expect: { disposition: string } }[] }[] };
    assert.ok(f.vectors.length > 0);
    for (const v of f.vectors) { assert.equal(v.source.channel, "proposed", v.id); assert.equal(v.source.profile, "tf-alignment", v.id); for (const s of v.steps) assert.equal(s.expect.disposition, "error", v.id); }
  });
});

describe("recorded text hashes belong to the file the vector cites", () => {
  it("a vector whose text mentions another spec path is checked against its own cited file only", () => {
    const tfRoot = join(tmp, "hash-tf"), suiteRoot = join(tmp, "hash-suite");
    put(tfRoot, "specs/alpha/one/0.1/spec.md", fm("draft") + "one\n");
    put(tfRoot, "specs/aaa/two/0.1/spec.md", fm("draft") + "two, changed\n");
    const own = hashTfPath(tfRoot, "specs/alpha/one/0.1/spec.md")!.specHash;
    put(suiteRoot, "vectors/manifest.json", { format: "tt-conformance-manifest/0.1", files: ["a.json"] });
    put(suiteRoot, "vectors/a.json", { format: "tt-conformance-vectors/0.1", group: "A", vectors: [{ id: "A-1", title: "t", tier: 1, spec: ["see specs/aaa/two/0.1/spec.md"], source: { slug: "alpha/one", version: "0.1", tfCommit: "c".repeat(40), specHash: own, tfRef: { repoPath: "specs/alpha/one/0.1/spec.md", commit: "c".repeat(40), status: "draft" } }, steps: [] }] });
    const facts = loadSuiteFacts(suiteRoot);
    const v = facts.vectors.find((x) => x.id === "A-1")!;
    assert.equal(v.ownPath, "specs/alpha/one/0.1/spec.md");
    assert.ok(v.tfPaths.includes("specs/aaa/two/0.1/spec.md"), "the mentioned path is still a citation");
    assert.equal([...v.tfPaths].sort()[0], "specs/aaa/two/0.1/spec.md", "the old check took this first, sorted path and reported a change that was not one");
  });
});
