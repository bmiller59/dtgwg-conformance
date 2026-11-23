// SPDX-License-Identifier: Apache-2.0
// Registry promotion (src/vectors/promotion.ts, vectors-src/promotions.json, docs/33) and the review checks (src/promotion/review.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { join } from "node:path";
import { EXCLUDED_RUN_FOLDERS } from "../src/promotion/evidence.ts";
import { checkNonVacuity } from "../src/runner/suite.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { activePromotions, applyPromotions, loadPromotions, promotionProblems, type PromotionFile } from "../src/vectors/promotion.ts";
import { validateSource } from "../src/vectors/source.ts";
import { citedLines, frontMatter, itemNumbers, reviewVector } from "../src/promotion/review.ts";
import type { VectorFile } from "../src/vectors/types.ts";
import { FIXTURES, ROOT, VECTORS } from "./helpers.ts";

const src = (extra: Record<string, unknown> = {}) => ({ slug: "a/b", version: "0.1", channel: "proposed", profile: "coverage", ref: "pkg:x@1#y", pinnedDigest: null, note: "N.", tfRef: { repoPath: "specs/a/b/0.1/spec.md", commit: "0".repeat(40), status: "draft" }, ...extra });
const vec = (id: string, over: Record<string, unknown> = {}) => ({ id, title: "t", tier: 1, spec: ["SPEC.md:1012"], clarify: null, source: src(), steps: [{ send: {}, expect: {} }], mutants: ["m"], ...over });
const file = (...v: unknown[]): VectorFile => ({ format: "tt-conformance-vectors/0.1", group: "G", family: "coverage", clock: { start: "2026-11-12T10:00:00Z" }, vectors: v as never });
const pf = (over: Partial<PromotionFile> = {}): PromotionFile => ({
  format: "tt-conformance-promotions/0.1", note: "n",
  amendedRule: { enabled: true, decision: "D353", status: "provisional", label: "single implementer", text: "t" },
  batches: { B1: { date: "2026-11-20", record: "docs/33-registry-promotion.md#b1-review", ids: { standard: [], "single-implementer": ["A-1"] } } }, ...over,
});

describe("applyPromotions", () => {
  it("changes the tags only: channel, profile, note and the promotion record; ids, steps and tfRef stay", () => {
    const f = file(vec("A-1"), vec("A-2"));
    const before = JSON.stringify(f.vectors[0]!.steps);
    assert.deepEqual(applyPromotions([f], pf()), ["A-1"]);
    const s = f.vectors[0]!.source as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(s.channel, "registry");
    assert.equal(s.profile, undefined);
    assert.deepEqual(s.promotion, { batch: "B1", rule: "single-implementer", provisional: true, decision: "D353", was: { channel: "proposed", profile: "coverage" } });
    assert.equal(s.tfRef.status, "draft");
    assert.match(s.note, /Promoted to the registry channel in batch B1 \(single implementer, provisional rule D353\)/);
    assert.equal(JSON.stringify(f.vectors[0]!.steps), before);
    assert.equal((f.vectors[1]!.source as unknown as { channel: string }).channel, "proposed");
    assert.deepEqual(validateSource(s, "source"), []);
  });
  it("the amended rule is one switch: off, and the vectors promoted on it stay advisory", () => {
    const off = pf(); off.amendedRule.enabled = false;
    assert.equal(activePromotions(off).size, 0);
    const f = file(vec("A-1"));
    assert.deepEqual(applyPromotions([f], off), []);
    assert.equal((f.vectors[0]!.source as unknown as { channel: string }).channel, "proposed");
  });
  it("a confirmed amended rule clears the provisional flag but keeps the single implementer label", () => {
    const f = file(vec("A-1"));
    const c = pf(); c.amendedRule.status = "confirmed";
    applyPromotions([f], c);
    const src = f.vectors[0]!.source as unknown as { promotion: { provisional: boolean; rule: string }; note: string };
    assert.equal(src.promotion.provisional, false);
    assert.equal(src.promotion.rule, "single-implementer");
    assert.match(src.note, /single implementer, confirmed rule D353/);
  });
  it("a standard-rule vector is not marked provisional", () => {
    const f = file(vec("A-1"));
    applyPromotions([f], pf({ batches: { B9: { date: "2026-11-21", record: "r", ids: { standard: ["A-1"], "single-implementer": [] } } } }));
    assert.equal((f.vectors[0]!.source as unknown as { promotion: { provisional: boolean } }).promotion.provisional, false);
  });
  it("refuses a vector that cannot gate", () => {
    for (const bad of [vec("A-1", { clarify: "x" }), vec("A-1", { source: src({ channel: "registry", profile: undefined }) }), vec("A-1", { probe: true }), vec("A-1", { excludedFromRun: { reason: "r" } }), vec("A-1", { source: { ...src(), tfRef: undefined } })]) {
      assert.throws(() => applyPromotions([file(bad)], pf()), /cannot promote A-1/);
    }
  });
});

describe("the promotions file", () => {
  it("is valid and has no id twice", () => {
    assert.deepEqual(promotionProblems(loadPromotions(ROOT)), []);
    const dup = pf(); dup.batches.B2 = { date: "2026-11-21", record: "r", ids: { standard: ["A-1"], "single-implementer": [] } };
    assert.match(promotionProblems(dup).join(), /A-1: listed in B1 and B2/);
    assert.match(promotionProblems({ ...pf(), format: "x" as never }).join(), /format/);
  });
  const promo = loadPromotions(ROOT);
  const suites = [loadSuite(join(VECTORS, "coverage")), loadSuite(join(VECTORS, "gap")), loadSuite(join(VECTORS, "probe")), loadSuite(join(VECTORS, "2l"))];
  const all = suites.flatMap((s) => s.files.flatMap((f) => f.file.vectors)) as unknown as { id: string; clarify: string | null; mutants?: string[]; probe?: boolean; excludedFromRun?: unknown; synthetic?: boolean; source: { channel: string; profile?: string; promotion?: { batch: string; rule: string; provisional: boolean }; tfRef?: { status: string } } }[];
  const active = activePromotions(promo);
  it("every listed vector exists, is registry with its promotion record, and every promotion record is listed", () => {
    const byId = new Map(all.map((v) => [v.id, v]));
    for (const [id, a] of active) {
      const v = byId.get(id);
      assert.ok(v, `${id} is listed but is in no vector file`);
      assert.equal(v.source.channel, "registry", id);
      assert.equal(v.source.promotion?.batch, a.batch, id);
      assert.equal(v.source.promotion?.rule, a.rule, id);
      assert.equal(v.source.promotion?.provisional, a.rule === "single-implementer" && promo.amendedRule.status === "provisional", id);
    }
    for (const v of all) if (v.source.promotion !== undefined) assert.ok(active.has(v.id), `${v.id} carries a promotion record but is not listed (or the rule is off)`);
  });
  it("a promoted vector meets the static criteria of docs/04 18.9: tfRef on main, not CLARIFY, not excluded, a mutant, no probe", () => {
    for (const v of all.filter((x) => active.has(x.id))) {
      assert.ok(["draft", "main"].includes(v.source.tfRef?.status ?? ""), v.id);
      assert.equal(v.clarify, null, v.id);
      assert.ok(v.excludedFromRun === undefined && v.synthetic !== true && v.probe !== true, v.id);
      assert.ok((v.mutants ?? []).length > 0, v.id);
      assert.equal(v.source.profile, undefined, v.id);
    }
  });
  it("non-vacuity: every mutant a promoted vector names makes it fail on the oracle", async () => {
    const rows = [];
    for (const s of suites) {
      const sub = { ...s, files: s.files.map((f) => ({ ...f, file: { ...f.file, vectors: f.file.vectors.filter((v) => active.has(v.id)) } })).filter((f) => f.file.vectors.length > 0) };
      rows.push(...(await checkNonVacuity(sub as never, FIXTURES)));
    }
    assert.ok(rows.length >= active.size);
    assert.deepEqual(rows.filter((r) => !r.caught), []);
  });
});

describe("review checks", () => {
  const spec = `---\nstatus: "draft"\nparties:\n  - role: "A"\n    requirement: "REQUIRED"\n    member: "issuer"\n  - role: "B"\n    requirement: "REQUIRED"\n    member: "recipient"\nproofRequirement:\n  request: REQUIRED\n---\nbody`;
  const lines = ["x", ...Array(1009).fill(""), "1. Validate the outer document", "2. Validate the document's payload", "3. Reject type", "4. expiry", "5. Reject recipient", "6. identity", "7. proof"].join("\n");
  const git = (c: string, p: string): string | null => (p === "SPEC.md" ? lines : p === "specs/a/b/0.1/spec.md" ? spec : null);
  const tf = { repoPath: "specs/a/b/0.1/spec.md", commit: "c", status: "draft" };
  it("reads front matter in the quoted and list-indented forms", () => assert.deepEqual(frontMatter(spec), { status: "draft", recipient: "REQUIRED", proof: "REQUIRED" }));
  it("reads cited lines and item numbers", () => {
    assert.deepEqual(citedLines("SPEC.md:1011-1023 (x)"), [1011, 1023]);
    assert.deepEqual(citedLines("SPEC.md:246, :1069 (x) and SPEC.md:388"), [246, 1069, 388]);
    assert.deepEqual(itemNumbers("SPEC.md:1015, 1017 (7.2 items 5 and 7: x)"), [5, 7]);
    assert.deepEqual(citedLines("SPEC.md 7.2 item 2"), []);
  });
  it("passes a vector whose cites and policy agree with the text", () => {
    const r = reviewVector({ id: "V", title: "a/b 0.1: the policy the specification declares is enforced (recipient REQUIRED, proof REQUIRED)", tfRef: tf, spec: ["SPEC.md:1012 (7.2 item 2: x)", "SPEC.md:1015 (7.2 item 5: x)", "isProofRequired=true, isRecipientRequired=true", "d"] }, git);
    assert.deepEqual(r.problems, []);
  });
  it("flags a cite on the wrong item, a missing line, a missing spec and a policy that the front matter does not declare", () => {
    assert.match(reviewVector({ id: "V", title: "t", tfRef: tf, spec: ["SPEC.md:1012 (7.2 item 5: x)"] }, git).problems.join(), /item 5 not at the cited line/);
    assert.match(reviewVector({ id: "V", title: "t", tfRef: tf, spec: ["SPEC.md:99999 (x)"] }, git).problems.join(), /not a line/);
    assert.match(reviewVector({ id: "V", title: "t", tfRef: { ...tf, repoPath: "nope.md" }, spec: [] }, git).problems.join(), /tf-spec/);
    const noProof = (c: string, p: string): string | null => (p === "specs/a/b/0.1/spec.md" ? spec.replace("request: REQUIRED", "request: OPTIONAL") : git(c, p));
    assert.match(reviewVector({ id: "V", title: "x (recipient REQUIRED, proof REQUIRED)", tfRef: tf, spec: [] }, noProof).problems.join(), /proof REQUIRED/);
    assert.match(reviewVector({ id: "V", title: "t", tfRef: tf, spec: ["isProofRequired=false, isRecipientRequired=true"] }, git).problems.join(), /isProofRequired=false/);
  });
  it("calls a vector with few spec strings or no numbered item thin", () => {
    assert.equal(reviewVector({ id: "V", title: "t", tfRef: tf, spec: ["SPEC.md:1011-1023 (7.2: processed)"] }, git).thin, true);
  });
});

describe("excluded evidence run folders", () => {
  const w = ["f", "ork"].join("");
  it("excludes the same run folders under either name pattern (case-insensitive marker, superseded, vti-a/b/c/e/af)", () => {
    for (const f of [`a-${w}-b`, `A-${w.toUpperCase()}`, "x-superseded-y", "set/vti-a-1", "set/vti-af-2", "set/vti-e-3"]) assert.ok(EXCLUDED_RUN_FOLDERS.test(f), f);
    for (const f of ["set/vti-d-1", "set/vti-ab-1", "kw-upstream-a", "reference"]) assert.ok(!EXCLUDED_RUN_FOLDERS.test(f), f);
  });
});
