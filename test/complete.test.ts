// SPDX-License-Identifier: Apache-2.0
// The completion vectors (vectors/complete) and the completeness measure (src/coverage/completeness.ts). Runs no platform: the reference
// oracle is the suite's own stand-in.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { analyse, deriveScope, loadVecRows, renderReport, unlistedVectorFiles, type Scope, type VecRow } from "../src/coverage/completeness.ts";
import { loadTask } from "../src/plain/catalog.ts";
import { validate } from "../src/plain/schema.ts";
import { checkNonVacuity, exitCode, runSuite } from "../src/runner/suite.ts";
import { answeredErrors } from "../src/plain/check.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { FIXTURES, ROOT, VECTORS, tempDir } from "./helpers.ts";

const DIR = join(VECTORS, "complete");
const suite = loadSuite(DIR);
const all = suite.files.flatMap((f) => f.file.vectors);
const scope = JSON.parse(readFileSync(join(ROOT, "vectors-src", "complete", "scope.json"), "utf8")) as Scope;

describe("completion vectors: vectors/complete", () => {
  it("is exactly what scripts/generate-complete.ts produces", () => {
    const { dir, cleanup } = tempDir();
    try {
      mkdirSync(join(dir, "o"));
      const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "scripts", "generate-complete.ts"), join(dir, "o")], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
      assert.equal(r.status, 0, r.stderr);
      // every file under vectors/complete/, not only the ones the manifest lists: an orphan (F-01) or a stale file fails here
      const onDisk = readdirSync(DIR).sort();
      assert.deepEqual(readdirSync(join(dir, "o")).sort(), onDisk, "vectors/complete holds exactly the files the generator produces");
      for (const rel of onDisk) assert.equal(readFileSync(join(dir, "o", rel), "utf8"), readFileSync(join(DIR, rel), "utf8"), rel);
    } finally {
      cleanup();
    }
  });
  it("is advisory (channel proposed, profile vectors-complete), labels spec maturity, and cites the clause it tests", () => {
    assert.ok(all.length > 0);
    for (const v of all) {
      assert.equal(v.source?.channel, "proposed", v.id);
      assert.equal(v.source?.profile, "vectors-complete", v.id);
      assert.ok(v.source?.tfRef !== undefined, v.id);
      assert.match(v.source?.note ?? "", /Spec maturity: (draft|retired)/, v.id);
      assert.ok(v.spec.some((s) => /SPEC\.md[: ]/.test(s)), `${v.id} cites no SPEC.md clause`);
    }
  });
  it("cites the task-force text at the gap snapshot commit or at the manifest's main commit (a version the snapshot does not hold is read from the pinned package)", () => {
    const snapCommit = (JSON.parse(readFileSync(join(ROOT, "vectors-src", "gap", "tf-snapshot.json"), "utf8")) as { tfCommit: string }).tfCommit;
    const manifestCommit = (JSON.parse(readFileSync(join(VECTORS, "tf-manifest.json"), "utf8")) as { main: { commit: string } }).main.commit;
    // a tombstone (`retired`) keeps the source it had when it was retired; it is a record, not a live citation
    for (const v of all.filter((x) => (x as { retired?: unknown }).retired === undefined)) assert.ok([snapCommit, manifestCommit].includes(v.source!.tfRef!.commit ?? ""), `${v.id}: ${v.source!.tfRef!.commit}`);
  });
  it("sends only payloads the task's own payload schema accepts (a role token is replaced by a string first)", () => {
    let checked = 0;
    for (const v of all) {
      for (const s of v.steps) {
        const send = (s as { send?: { document?: { type?: string; payload?: unknown } } }).send;
        if (send?.document?.type === undefined) continue;
        // a negative vector sends an invalid payload on purpose (the specification's own invalid example, a missing or unknown member)
        if (["error", "any-refusal"].includes(s.expect?.disposition ?? "")) continue;
        const t = loadTask(send.document.type);
        assert.ok(t !== undefined, v.id);
        const pl = JSON.parse(JSON.stringify(send.document.payload).replace(/\$role\(\d\)/g, (m) => (m === "$role(0)" ? "conformance-role-a" : "conformance-role-b"))) as unknown;
        assert.deepEqual(validate(t.payloadSchema, pl), [], v.id);
        checked++;
      }
    }
    assert.ok(checked > 0);
  });
  it("gives every in-scope task a positive vector, except the ones listed in not-generated.json", () => {
    const ng = JSON.parse(readFileSync(join(DIR, "not-generated.json"), "utf8")) as { items: { typeUri: string; class: string }[] };
    const listed = new Set(ng.items.map((i) => i.typeUri));
    const rep = analyse(scope, loadVecRows(ROOT));
    for (const u of rep.noPositive) assert.ok(listed.has(u), `${u} has no positive vector and is not listed as not generated`);
    for (const i of ng.items) assert.ok(["C", "D"].includes(i.class), i.typeUri);
  });
  it("passes on the reference oracle on both tiers, and every named mutant makes its vector fail", async () => {
    for (const [adapter, tier] of [[new ReferenceAdapter(), 1], [new ReferenceAdapter({ attested: true }), 2]] as const) {
      const run = await runSuite({ adapter, suite, tier, today: "2026-11-22", fixtureRoot: FIXTURES, channels: ["proposed"], allowEffects: "reference-oracle" });
      assert.deepEqual(run.results.filter((r) => r.status === "FAIL"), []);
      assert.equal(run.results.filter((r) => r.status === "SKIPPED-SAFETY").length, 0);
    }
    const rows = await checkNonVacuity(suite, FIXTURES);
    assert.ok(rows.length > 0);
    assert.deepEqual(rows.filter((r) => !r.caught), []);
  });
});

describe("completion vectors: success assertion, effect and safety (F-02, F-06)", () => {
  it("tags every vector that sends to the implementation with the effect of its task, and every answered vector with its strength", () => {
    for (const v of all.filter((x) => x.retired === undefined)) {
      const sends = v.steps.some((s) => s.send !== undefined);
      if (sends) assert.ok(["destructive", "mutating", "read-only"].includes(v.effect ?? ""), `${v.id} has no effect tag`);
      const answered = v.steps.filter((s) => s.expect?.disposition === "answered");
      if (answered.length > 0) assert.ok(v.strength === "asserted" || v.strength === "weak", v.id);
      if (v.strength === "asserted") { assert.equal(v.effect, "read-only", v.id); assert.ok(v.requires?.includes("optional:authorised"), v.id); }
    }
    assert.ok(all.some((v) => v.strength === "asserted") && all.some((v) => v.strength === "weak"));
  });
  it("never sends a specification example identifier to a destructive task", () => {
    for (const v of all.filter((x) => x.effect === "destructive")) assert.ok(!/request examples in the specification/.test(v.title), v.id);
  });
  it("skips state-changing vectors unless a disposable deployment is named, as SKIPPED-SAFETY (neither pass nor fail)", async () => {
    const run = await runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today: "2026-11-22", fixtureRoot: FIXTURES, channels: ["proposed"] });
    const changing = new Set(all.filter((v) => v.retired === undefined && (v.effect === "mutating" || v.effect === "destructive")).map((v) => v.id));
    assert.ok(changing.size > 0);
    const safety = run.results.filter((r) => r.status === "SKIPPED-SAFETY").map((r) => r.id);
    assert.deepEqual(new Set(safety), changing);
    assert.deepEqual(run.results.filter((r) => r.status === "FAIL"), []);
    for (const r of run.results) if (!changing.has(r.id)) assert.notEqual(r.status, "SKIPPED-SAFETY");
    assert.equal(exitCode([run]), 0);
  });
  it("catches an implementation that refuses every request with internalError on the asserted-success vectors only", async () => {
    const run = await runSuite({ adapter: new ReferenceAdapter({ mutants: ["plainInternalError"] }), suite, tier: 1, today: "2026-11-22", fixtureRoot: FIXTURES, channels: ["proposed"], allowEffects: "reference-oracle" });
    const strong = new Set(all.filter((v) => v.strength === "asserted").map((v) => v.id));
    for (const r of run.results) if (strong.has(r.id)) assert.equal(r.status, "FAIL", r.id);
    // the weak vectors pass it, which is exactly why they are reported apart
    assert.ok(run.results.some((r) => !strong.has(r.id) && r.status === "PASS"));
  });
  it("accepts a payload-level code the task's own text names, and fails an envelope code it does not", () => {
    const t = loadTask("https://trusttasks.org/spec/vta/webvh/servers/register/1.0")!;
    const err = (code: string): string => JSON.stringify({ type: "https://trusttasks.org/spec/trust-task-error/0.6", payload: { code } });
    assert.deepEqual(answeredErrors(t, [err("idConflict")], { should: () => {}, acceptCodes: ["idConflict"] }), []);
    assert.equal(answeredErrors(t, [err("idConflict")], { should: () => {} }).length, 1);
    assert.equal(answeredErrors(t, [err("expired")], { should: () => {}, acceptCodes: ["idConflict"] }).length, 1);
  });
  it("treats silence as an advisory on the weak form and a failure when success is asserted", () => {
    const t = loadTask("https://trusttasks.org/spec/vta/management/reload-services/1.0")!;
    const notes: string[] = [];
    assert.deepEqual(answeredErrors(t, [], { should: () => {}, note: (m) => notes.push(m) }), []);
    assert.equal(notes.length, 1);
    assert.equal(answeredErrors(t, [], { should: () => {}, success: true }).length, 1);
  });
  it("fails a non-response (an error of any code) when success is asserted, and passes the task's own response", () => {
    const t = loadTask("https://trusttasks.org/spec/vta/metrics/show/0.1")!;
    const ok = JSON.stringify({ type: t.responseTypeUri, payload: t.validResponse });
    const internal = JSON.stringify({ type: "https://trusttasks.org/spec/trust-task-error/0.6", payload: { code: "internalError" } });
    assert.deepEqual(answeredErrors(t, [ok], { should: () => {}, success: true }), []);
    assert.equal(answeredErrors(t, [internal], { should: () => {}, success: true }).length, 1);
    const advisories: string[] = [];
    assert.deepEqual(answeredErrors(t, [internal], { should: (m) => advisories.push(m) }), []);
    assert.equal(advisories.length, 1, "internalError on the weak form is an advisory");
  });
  it("observes, and does not fail, a follow-on task document for a task that declares no response (spec-open C-1)", () => {
    const t = loadTask("https://trusttasks.org/spec/credential-exchange/request/0.1")!;
    const notes: string[] = [];
    const follow = JSON.stringify({ type: "https://trusttasks.org/spec/credential-exchange/issue/0.1", payload: {} });
    assert.deepEqual(answeredErrors(t, [follow], { should: () => {}, note: (m) => notes.push(m) }), []);
    assert.equal(notes.length, 1);
  });
});

describe("completeness measure", () => {
  const mk = (id: string, tasks: string[], o: Partial<VecRow>): VecRow => ({ id, group: "G", set: "s", channel: "proposed", tasks, pos: false, neg: false, edge: false, emit: false, ...o });
  const u = (n: string): string => `https://trusttasks.org/spec/${n}/0.1`;
  const sc: Scope = { format: "tt-vector-completeness-scope/0.1", note: "", inputs: {}, tasks: [
    { typeUri: u("a/x"), slug: "a/x", version: "0.1", family: "a", vti: ["vta"], kw: null },
    { typeUri: u("a/y"), slug: "a/y", version: "0.1", family: "a", vti: [], kw: "emits" },
    { typeUri: u("b/z"), slug: "b/z", version: "0.1", family: "b", vti: ["vtc"], kw: "serves" },
  ] };
  it("derives the scope from latest versions that VTI serves or the wallet has a role with code for", () => {
    const m = [
      { typeUri: u("a/x"), slug: "a/x", version: "0.1", family: "a", latest: true, vti: { served: ["vta"] } },
      { typeUri: u("a/old"), slug: "a/old", version: "0.1", family: "a", latest: false, vti: { served: ["vta"] } },
      { typeUri: u("c/n"), slug: "c/n", version: "0.1", family: "c", latest: true, vti: { served: [] } },
      { typeUri: u("a/y"), slug: "a/y", version: "0.1", family: "a", latest: true, vti: { served: [] } },
      { typeUri: u("c/m"), slug: "c/m", version: "0.1", family: "c", latest: true, vti: { served: [] } },
    ];
    const kw = [{ slug: "a/y", version: "0.1", role: "emits" }, { slug: "c/m", version: "0.1", role: "not-involved" }];
    assert.deepEqual(deriveScope(m, kw, {}).tasks.map((t) => t.slug), ["a/x", "a/y"]);
  });
  it("counts polarity, gating and emit coverage with denominators", () => {
    const rows = [
      mk("V1", [u("a/x")], { pos: true, channel: "registry" }), mk("V2", [u("a/x")], { neg: true }),
      mk("V3", [u("a/y")], { neg: true, edge: true }), mk("V4", [u("b/z")], { pos: true, emit: true }),
    ];
    const r = analyse(sc, rows, [{ ceremony: "c", step: "s1", type: u("a/x"), covered: true }, { ceremony: "c", step: "s2", type: u("zz/none"), covered: false }], ["c", "empty"]);
    assert.deepEqual([r.anyVector.n, r.positive.n, r.negative.n, r.positiveAndNegative.n, r.gating.n, r.edge.n, r.anyVector.of], [3, 2, 2, 1, 1, 1, 3]);
    assert.deepEqual(r.noPositive, [u("a/y")]);
    assert.deepEqual(r.kwEmitsWithoutEmitVector, [u("a/y")]);
    assert.deepEqual([r.ceremonySteps.n, r.ceremonySteps.of, r.ceremonyStepTypesPosNeg.n, r.ceremonyStepTypesPosNeg.of], [1, 2, 1, 2]);
    assert.deepEqual(r.ceremoniesWithoutSteps, ["empty"]);
    assert.equal(r.families.find((f) => f.family === "a")!.positiveAndNegative.pct, 50);
    assert.match(renderReport(r, null, { x: "1" }), /Tasks with a positive vector \(any kind\) \| 66\.7% \[2\/3\]/);
  });
  it("reports asserted-success positives and weak-only positives apart, with denominators, and never counts a weak vector as asserted", () => {
    const rows = [mk("W1", [u("a/x")], { pos: true, weak: true }), mk("S1", [u("a/y")], { pos: true, strong: true }), mk("W2", [u("a/y")], { pos: true, weak: true }), mk("N1", [u("b/z")], { neg: true })];
    const r = analyse(sc, rows);
    assert.deepEqual([r.positive.n, r.positiveAsserted.n, r.positiveWeakOnly.n, r.positive.of], [2, 1, 1, 3]);
    assert.deepEqual(r.weakOnly, [u("a/x")]);
    assert.match(renderReport(r, null, {}), /asserts success[^|]*\| 33\.3% \[1\/3\]/);
    assert.match(renderReport(r, null, {}), /weak only[^|]*\| 33\.3% \[1\/3\]/);
  });
  it("counts only the files a set's manifest lists, and reports an unlisted file (an orphan is never counted)", () => {
    const { dir, cleanup } = tempDir();
    try {
      const set = join(dir, "vectors", "s");
      mkdirSync(set, { recursive: true });
      const vf = (id: string): string => JSON.stringify({ vectors: [{ id, title: "t", steps: [{ expect: { disposition: "response" } }], source: { channel: "proposed" } }] });
      writeFileSync(join(set, "a.json"), vf("A-1"));
      writeFileSync(join(set, "orphan.json"), vf("O-1"));
      writeFileSync(join(set, "manifest.json"), JSON.stringify({ format: "tt-conformance-manifest/0.1", files: ["a.json"] }));
      assert.deepEqual(loadVecRows(dir).map((r) => r.id), ["A-1"]);
      assert.deepEqual(unlistedVectorFiles(dir), ["vectors/s/orphan.json"]);
    } finally {
      cleanup();
    }
  });
  it("gives no coverage to a retired or excluded vector", () => {
    const { dir, cleanup } = tempDir();
    try {
      mkdirSync(join(dir, "vectors", "s"), { recursive: true });
      const v = (id: string, extra: object): object => ({ id, title: "t", steps: [{ expect: { disposition: "response" } }], source: { channel: "proposed" }, ...extra });
      writeFileSync(join(dir, "vectors", "s", "a.json"), JSON.stringify({ vectors: [v("A-1", { retired: { reason: "r", since: "0.1.0" } }), v("A-2", { excludedFromRun: { reason: "r" } }), v("A-3", {})] }));
      assert.deepEqual(loadVecRows(dir).map((r) => r.id), ["A-3"]);
    } finally {
      cleanup();
    }
  });
  it("leaves no unlisted vector file in this repository", () => {
    assert.deepEqual(unlistedVectorFiles(ROOT), []);
  });
});
