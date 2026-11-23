// SPDX-License-Identifier: Apache-2.0
// R22: one exceptions file, loaded by default, holding every platform's KNOWN-FAIL entries.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { expectFailureProblems, loadExceptions, notOnProblems } from "../src/vectors/load.ts";
import { unmatchedExpectations } from "../src/runner/suite.ts";
import { EXCEPTION_CLASSES } from "../src/vectors/types.ts";
import { buildModel, classOf, loadFindings, loadRuns } from "../src/glance/model.ts";
import { exceptionClasses, exceptionsLine } from "../src/glance/docs.ts";
import { loadCatalog } from "../src/glance/model.ts";
import { expiryMismatches, loadExpiryPolicy, policyExpiry } from "../src/vectors/expiry-policy.ts";
import { NEEDS_RUNS, RESULTS, ROOT } from "./helpers.ts";

const FILE = join(ROOT, "exceptions", "exceptions.json");

/** Entries whose vector was widened by the older-sets fixes (D890): their recorded failure lines name the old code list. Drop an entry once its surface is re-run. */
const RERUN_PENDING = new Set([
  "verifiable-trust-infrastructure-vtc-inprocess CB-RM-006", "verifiable-trust-infrastructure-inprocess CB-CS-010", "verifiable-trust-infrastructure-vtc-inprocess CX-MB-040",
  "verifiable-trust-infrastructure-vtc-inprocess TL-JRQ-001", "verifiable-trust-infrastructure-vtc-inprocess TL-JRQ-005", "verifiable-trust-infrastructure-vtc-inprocess TL-MBR-001",
]);
const PENDING_DECISION = new Set<string>();

describe("exceptions/exceptions.json", () => {
  it("is the only exceptions file, so a default run applies every entry without --exceptions (R22)", () => {
    assert.deepEqual(readdirSync(join(ROOT, "exceptions")).filter((f) => f.endsWith(".json") && f !== "quarantine.json" && f !== "expiry-policy.json"), ["exceptions.json"]);
    const impls = new Set(loadExceptions(FILE).exceptions.map((e) => e.impl));
    assert.ok(impls.has("witness-server"));
  });
  it("every entry's expiry is the one exceptions/expiry-policy.json gives its surface, and the surfaces are staggered (R2)", () => {
    const es = loadExceptions(FILE).exceptions;
    const policy = loadExpiryPolicy(ROOT);
    assert.deepEqual(expiryMismatches(policy, es), []);
    const impls = [...new Set(es.map((e) => e.impl))];
    const dates = impls.map((i) => policyExpiry(policy, i));
    assert.equal(new Set(dates).size, dates.length, `two surfaces share an expiry date: ${dates.join(", ")}`);
    assert.throws(() => policyExpiry(policy, "no-such-implementation"), /no offset/);
    assert.equal(policyExpiry({ ...policy, anchor: "2026-12-31", offsetDays: { x: 1 } }, "x"), "2027-01-01");
  });
  it("a structured class agrees with the class its reason states, and every reason that states one has the field (R6)", (t) => {
    const es = loadExceptions(FILE).exceptions;
    for (const e of es) {
      const inText = [...new Set([...e.reason.matchAll(/class ([A-D])\b/g)].map((m) => m[1]!))];
      assert.ok(inText.length <= 1, `${e.impl} ${e.vector}: reason names more than one class`);
      if (inText.length === 1) assert.equal(e.class, inText[0], `${e.impl} ${e.vector}: class field ${String(e.class)} vs reason class ${inText[0]}`);
      if (e.class !== undefined) assert.ok((EXCEPTION_CLASSES as readonly string[]).includes(e.class));
      assert.equal(classOf(e), e.class ?? "");
    }
    const unclassed = es.filter((e) => e.class === undefined).length;
    t.diagnostic(`exceptions without a class: ${unclassed} of ${es.length} (not guessed; see results/vector-review.md)`);
    assert.ok(unclassed < es.length);
  });
  it("every entry is justified by a recorded result of its surface, or marked inherited; its expectFailure matches what was recorded (R6)", NEEDS_RUNS, (t) => {
    const es = loadExceptions(FILE).exceptions;
    const config = buildModel(ROOT, RESULTS).config;
    const blocks = loadRuns(RESULTS);
    // the recorded results of an implementation key: every current surface keyed on it (its impl, or an earlier name in aliases), all tiers
    const recorded = (key: string, vector: string, tier: 1 | 2 | undefined) =>
      config.subjects.flatMap((s) => s.surfaces).filter((sf) => sf.impl === key).flatMap((sf) =>
        blocks.filter((b) => (sf.runs ?? []).includes(b.run) && (b.impl === sf.impl || (sf.aliases ?? []).includes(b.impl)) && (tier === undefined || b.tier === tier))
          .flatMap((b) => b.results.filter((r) => r.id === vector && (r.status === "KNOWN-FAIL" || r.status === "FAIL")) as { status: string; failures?: string[]; reason?: string }[]));
    const unjustified: string[] = [];
    for (const e of es) {
      const seen = recorded(e.impl, e.vector, e.tier);
      if (seen.length === 0 && e.inherited === undefined) unjustified.push(`${e.impl} ${e.vector}`);
      for (const r of seen) {
        if (/exception is stale/.test(r.reason ?? "")) continue; // the vector passes: a recorded result of the entry's surface, with no failure lines to match
        const unmatched = unmatchedExpectations(e, r.failures ?? []);
        // Pending a decision of the project owner (docs/decisions/README.md, "VRC-PRO-021 exception"): after the harness fix that makes document state follow the thread, the
        // step 4 documentState line the entry expects no longer appears, so the vector is FAIL. The entry is deliberately left unedited; this allowance
        // lapses (the test fails) as soon as the entry matches again or is edited, so it cannot outlive the decision.
        // D890: the vector's accepted codes were widened (standing, lookup and earlier codes), so the entry's pattern names the new list while the recorded failure line still names the
        // old one. The recorded result is stale until the platform is re-run (docs/decisions/README.md D890; the re-run list); then the line matches and the entry drops out of this set.
        if (RERUN_PENDING.has(`${e.impl} ${e.vector}`) && unmatched.length > 0) continue;
        if (PENDING_DECISION.has(`${e.impl} ${e.vector}`)) { assert.notDeepEqual(unmatched, [], `${e.impl} ${e.vector}: the entry matches again; drop it from PENDING_DECISION`); continue; }
        assert.deepEqual(unmatched, [], `${e.impl} ${e.vector}: expectFailure does not match a recorded ${r.status}`);
      }
    }
    assert.deepEqual(unjustified, [], "entries with no recorded KNOWN-FAIL or FAIL on their surface: record one or mark the entry inherited");
    t.diagnostic(`entries with expectFailure: ${es.filter((e) => e.expectFailure !== undefined).length} of ${es.length}; inherited: ${es.filter((e) => e.inherited !== undefined).length}`);
  });
  it("the loader refuses a malformed expectFailure, inherited or notOn", () => {
    assert.deepEqual(expectFailureProblems(undefined, "x"), []);
    assert.deepEqual(expectFailureProblems({ failures: ["^step 1: a$"] }, "x"), []);
    assert.equal(expectFailureProblems({ failures: [] }, "x").length, 1);
    assert.equal(expectFailureProblems({ failures: ["("] }, "x").length, 1);
    assert.equal(expectFailureProblems({ failures: ["a"], status: 1 }, "x").length, 1);
    assert.equal(expectFailureProblems("a", "x").length, 1);
    assert.deepEqual(notOnProblems(undefined, "p", "x"), []);
    assert.deepEqual(notOnProblems({ "p-v2": "the v2 path drops it first" }, "p", "x"), []);
    assert.equal(notOnProblems({}, "p", "x").length, 1);
    assert.equal(notOnProblems(["p-v2"], "p", "x").length, 1);
    assert.equal(notOnProblems({ "p-v2": "" }, "p", "x").length, 1);
    assert.equal(notOnProblems({ p: "own key" }, "p", "x").length, 1);
  });
  it("every recorded finding (results/findings.json) is a current FAIL, not excused, not also an exception (R21)", NEEDS_RUNS, () => {
    const fs = loadFindings(ROOT);
    const excs = loadExceptions(FILE).exceptions;
    const model = buildModel(ROOT, RESULTS);
    for (const f of fs) {
      assert.equal(f.excused, false, `${f.impl} ${f.vector}`);
      assert.ok(f.class === null || (EXCEPTION_CLASSES as readonly string[]).includes(f.class), `${f.impl} ${f.vector}: class`);
      assert.ok(f.explanation.length > 20, `${f.impl} ${f.vector}: explanation`);
      assert.ok(!excs.some((e) => e.impl === f.impl && e.vector === f.vector), `${f.impl} ${f.vector} is also an exception`);
      if (f.inherited !== undefined) continue; // measured in a coverage re-measure that is not yet a recorded run folder: the next recorded run decides it
      const shown = model.subjects.flatMap((s) => s.surfaces).filter((sf) => sf.cfg.impl === f.impl).some((sf) => sf.recorded.some((r) => r.vector === f.vector) && sf.results.some((r) => r.id === f.vector && r.status === "FAIL"));
      assert.ok(shown, `${f.impl} ${f.vector}: not a FAIL in any current surface (stale finding)`);
    }
  });
});

// The plain "answers the task's own notFound as taskFailed with details.reason not_found" group of the coverage vectors (proposed channel, advisory).
const NOT_FOUND_GROUP: [string, string][] = [
  ["verifiable-trust-infrastructure-inprocess", "CB-AA-028"], ["verifiable-trust-infrastructure-inprocess", "CB-AA-029"], ["verifiable-trust-infrastructure-inprocess", "CB-AA-035"],
  ["verifiable-trust-infrastructure-inprocess", "CB-AA-036"], ["verifiable-trust-infrastructure-inprocess", "CB-AA-037"], ["verifiable-trust-infrastructure-inprocess", "CB-AA-038"],
  ["verifiable-trust-infrastructure-inprocess", "CB-AA-040"], ["verifiable-trust-infrastructure-inprocess", "CB-SD-017"], ["verifiable-trust-infrastructure-inprocess", "CB-RM-009"],
  ["verifiable-trust-infrastructure-vtc-inprocess", "CB-RM-006"],
];
describe("the taskFailed-for-notFound group of VTI entries (coverage vectors, advisory)", () => {
  const es = loadExceptions(FILE).exceptions;
  const vectors = new Map<string, { source: { slug: string; version: string; channel: string }; steps: { expect?: { code?: string[] } }[] }>();
  for (const f of readdirSync(join(ROOT, "vectors", "coverage")).filter((n) => /^cb-.*\.json$/.test(n))) {
    const doc = JSON.parse(readFileSync(join(ROOT, "vectors", "coverage", f), "utf8")) as { vectors?: unknown } | unknown[];
    for (const v of (Array.isArray(doc) ? doc : (doc as { vectors: unknown[] }).vectors) as { id: string; source: { slug: string; version: string; channel: string }; steps: { expect?: { code?: string[] } }[] }[]) vectors.set(v.id, v);
  }
  it("each entry is for a proposed-channel vector that exists, is class A, for the original platform's surface key, and expects exactly the observed code", () => {
    for (const [impl, id] of NOT_FOUND_GROUP) {
      const e = es.find((x) => x.impl === impl && x.vector === id);
      assert.ok(e, `${impl} ${id}: no entry`);
      const v = vectors.get(id);
      assert.ok(v, `${id}: no such vector`);
      assert.equal(v.source.channel, "proposed");
      assert.equal(e.class, "A");
      const codes = v.steps[0]!.expect!.code!;
      // the vector accepts the task code, the task's standing and lookup codes (D880, D882) and permissionDenied, never taskFailed: a not-found answered as taskFailed is a real difference
      assert.ok(codes.includes("permissionDenied") && !codes.includes("taskFailed"), `${id}: the vector must not accept taskFailed, so taskFailed is a real difference`);
      assert.deepEqual(e.expectFailure!.failures, [`^step 1: expected code ${codes.join("\\|")}, got taskFailed$`]);
      assert.match(e.reason, /taskFailed with details\.reason not_found/);
      assert.equal(e.notOn, undefined);
      assert.equal(e.inherited !== undefined, true);
    }
    assert.equal(es.filter((x) => /taskFailed with details\.reason not_found/.test(x.reason) && x.expectFailure?.failures.some((f) => /^\^step 1: expected code \S+, got taskFailed\$$/.test(f)) === true).length, NOT_FOUND_GROUP.length);
  });
  it("each quoted passage occurs on the cited line of the specification text, and the cited file is the vector's task and version (needs TT_KIT)", (t) => {
    const kit = process.env["TT_KIT"];
    if (kit === undefined || !existsSync(join(kit, "specs"))) { t.skip("TT_KIT is not set: the quotes were not checked against the text"); return; }
    for (const [impl, id] of NOT_FOUND_GROUP) {
      const e = es.find((x) => x.impl === impl && x.vector === id)!;
      const v = vectors.get(id)!;
      const quotes = [...e.reason.matchAll(/specs\/(\S+?)\/spec\.md:(\d+) '([^']+)'/g)];
      assert.ok(quotes.length >= 1, `${id}: no quoted specification line`);
      for (const [, path, line, text] of quotes) {
        assert.equal(path, `${v.source.slug}/${v.source.version}`, `${id}: cites another task or version`);
        const lines = readFileSync(join(kit, "specs", path!, "spec.md"), "utf8").split("\n");
        assert.ok(lines[Number(line) - 1]!.includes(text!), `${id}: line ${line} of ${path} does not contain "${text}"`);
      }
    }
  });
  it("advisory entries are outside the headline count of recorded differences, and the class table says how many it includes", () => {
    const base = loadCatalog(ROOT);
    const cat = loadCatalog(ROOT, { coverage: true });
    const advisory = es.filter((x) => cat.has(x.vector) && !base.has(x.vector));
    assert.equal(advisory.length, NOT_FOUND_GROUP.length + OTHER_CODE_GROUP.length + OWNERS_GROUP.length);
    for (const [, id] of [...NOT_FOUND_GROUP, ...OTHER_CODE_GROUP, ...OWNERS_GROUP.map((g) => [g[0], g[1]] as const)]) assert.ok(advisory.some((x) => x.vector === id), id);
    assert.match(exceptionsLine(ROOT, ""), new RegExp(`: ${es.length - advisory.length} in all,`));
    assert.match(exceptionClasses(ROOT, ""), new RegExp(`${advisory.length} of them (are|is) for advisory`));
  });
});

// Three further coverage-vector differences of the original VTI (proposed channel, advisory): the code the task force's text names is not the one VTI answers.
const OTHER_CODE_GROUP: [string, string, string, RegExp][] = [
  ["verifiable-trust-infrastructure-inprocess", "CB-CS-004", "auth/step-up/approve-response:challengeUnknown", /got taskFailed$/],
  ["verifiable-trust-infrastructure-inprocess", "CB-CS-010", "consent/decision:challengeMismatch", /got malformedRequest$/],
  ["verifiable-trust-infrastructure-vtc-inprocess", "CX-MB-040", "malformedRequest", /got internalError$/],
];
describe("the CB-CS-004, CB-CS-010 and CX-MB-040 entries (coverage vectors, advisory)", () => {
  const es = loadExceptions(FILE).exceptions;
  const vectors = new Map<string, { source: { slug: string; version: string; channel: string }; steps: { expect?: { code?: string[] } }[] }>();
  for (const f of readdirSync(join(ROOT, "vectors", "coverage")).filter((n) => /^c[bx]-.*\.json$/.test(n))) {
    const doc = JSON.parse(readFileSync(join(ROOT, "vectors", "coverage", f), "utf8")) as { vectors?: unknown } | unknown[];
    for (const v of (Array.isArray(doc) ? doc : (doc as { vectors: unknown[] }).vectors) as { id: string; source: { slug: string; version: string; channel: string }; steps: { expect?: { code?: string[] } }[] }[]) vectors.set(v.id, v);
  }
  it("each entry is for a proposed-channel vector that exists, is class A, and the vector expects a code other than the observed one", () => {
    for (const [impl, id, code, got] of OTHER_CODE_GROUP) {
      const e = es.find((x) => x.impl === impl && x.vector === id);
      assert.ok(e, `${impl} ${id}: no entry`);
      const v = vectors.get(id);
      assert.ok(v, `${id}: no such vector`);
      assert.equal(v.source.channel, "proposed");
      assert.equal(e.class, "A");
      const codes = v.steps[0]!.expect!.code!;
      assert.ok(codes.includes(code) && codes.includes("permissionDenied"), `${id}: the vector must expect ${code}`);
      const observed = got.source.replace("got ", "").replace("$", "");
      assert.ok(!codes.includes(observed), `${id}: the vector accepts the observed code ${observed}, so it is no difference`);
      assert.equal(e.expectFailure!.failures.length, 1);
      assert.match(e.expectFailure!.failures[0]!.replace(/\\/g, "").replace(/\$$/, ""), new RegExp(`${got.source.replace("$", "")}$`));
      assert.equal(e.notOn, undefined);
      assert.equal(e.inherited !== undefined, true);
    }
  });
  it("each quoted passage occurs on the cited line of the task-force text (needs TT_KIT)", (t) => {
    const kit = process.env["TT_KIT"];
    if (kit === undefined || !existsSync(join(kit, "specs"))) { t.skip("TT_KIT is not set: the quotes were not checked against the text"); return; }
    for (const [impl, id] of OTHER_CODE_GROUP) {
      const e = es.find((x) => x.impl === impl && x.vector === id)!;
      const quotes = [...e.reason.matchAll(/((?:specs\/\S+?\/)?(?:spec\.md|payload\.schema\.json|SPEC\.md)):(\d+) '([^']+)'/g)];
      assert.ok(quotes.length >= 2, `${id}: expected at least two quoted lines`);
      for (const [, file, line, text] of quotes) {
        const lines = readFileSync(join(kit, file!), "utf8").split("\n");
        assert.ok(lines[Number(line) - 1]!.includes(text!), `${id}: line ${line} of ${file} does not contain "${text}"`);
      }
    }
  });
});

// Two further coverage-vector differences of the original VTI (proposed channel, advisory): the owners constraints of the task's payload schema (uniqueItems, and minItems for create) are not enforced.
const OWNERS_GROUP: [string, string, string, string[]][] = [
  ["verifiable-trust-infrastructure-vtc-inprocess", "CX-CA-031", "git-ns/repo/adopt/0.3", ["^step 1: expected code malformedRequest\\|permissionDenied, got git-ns:unknownNamespace$", "^step 3: expected code malformedRequest\\|permissionDenied, got git-ns:unknownNamespace$"]],
  ["verifiable-trust-infrastructure-vtc-inprocess", "CX-CA-033", "git-ns/repo/create/0.4", ["^step 6: expected code malformedRequest\\|permissionDenied, got git-ns:unknownNamespace$", "^step 7: expected code malformedRequest\\|permissionDenied, got git-ns:unknownNamespace$"]],
];
describe("the CX-CA-031 and CX-CA-033 entries (coverage vectors, advisory)", () => {
  const es = loadExceptions(FILE).exceptions;
  const vectors = new Map<string, { source: { slug: string; version: string; channel: string }; steps: { expect?: { code?: string[] } }[] }>();
  for (const f of readdirSync(join(ROOT, "vectors", "coverage")).filter((n) => /^cx-ca\.json$/.test(n))) {
    const doc = JSON.parse(readFileSync(join(ROOT, "vectors", "coverage", f), "utf8")) as { vectors?: unknown } | unknown[];
    for (const v of (Array.isArray(doc) ? doc : (doc as { vectors: unknown[] }).vectors) as { id: string; source: { slug: string; version: string; channel: string }; steps: { expect?: { code?: string[] } }[] }[]) vectors.set(v.id, v);
  }
  it("each entry is for a proposed-channel vector that exists, is class A, inherited, names the seeded probe and the side effect, and expects a failure only where the vector accepts malformedRequest or permissionDenied", () => {
    for (const [impl, id, task, failures] of OWNERS_GROUP) {
      const e = es.find((x) => x.impl === impl && x.vector === id);
      assert.ok(e, `${impl} ${id}: no entry`);
      const v = vectors.get(id);
      assert.ok(v, `${id}: no such vector`);
      assert.equal(v.source.channel, "proposed");
      assert.equal(`${v.source.slug}/${v.source.version}`, task);
      assert.equal(e.class, "A");
      assert.deepEqual(e.expectFailure!.failures, failures);
      for (const f of failures) {
        const step = Number(/^\^step (\d+):/.exec(f)![1]);
        assert.deepEqual(v.steps[step - 1]!.expect!.code, ["malformedRequest", "permissionDenied"], `${id} step ${step}`);
      }
      assert.equal(e.notOn, undefined);
      assert.equal(e.inherited !== undefined, true);
      assert.match(e.reason, /uniqueItems/);
      assert.match(e.reason, /membersOnly/);
    }
    const ca031 = es.find((x) => x.vector === "CX-CA-031")!;
    const ca033 = es.find((x) => x.vector === "CX-CA-033")!;
    assert.match(ca031.reason, /CP-CA-002/);
    assert.match(ca033.reason, /CP-CA-003/);
    assert.match(ca033.reason, /repository was created/);
    assert.match(ca033.reason, /in-process host only/);
  });
  it("each quoted passage occurs on the cited line of the task-force text (needs TT_KIT)", (t) => {
    const kit = process.env["TT_KIT"];
    if (kit === undefined || !existsSync(join(kit, "specs"))) { t.skip("TT_KIT is not set: the quotes were not checked against the text"); return; }
    for (const [impl, id, task] of OWNERS_GROUP) {
      const e = es.find((x) => x.impl === impl && x.vector === id)!;
      const quotes = [...e.reason.matchAll(/((?:specs\/\S+?\/)?(?:spec\.md|payload\.schema\.json|SPEC\.md)):(\d+) '([^']+)'/g)];
      assert.ok(quotes.length >= 3, `${id}: expected at least three quoted lines`);
      assert.ok(quotes.some(([, file]) => file === `specs/${task}/payload.schema.json`), `${id}: no quote of the task's own payload schema`);
      for (const [, file, line, text] of quotes) {
        const lines = readFileSync(join(kit, file!), "utf8").split("\n");
        assert.ok(lines[Number(line) - 1]!.includes(text!), `${id}: line ${line} of ${file} does not contain "${text}"`);
      }
    }
  });
});
