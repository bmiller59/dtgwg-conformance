// SPDX-License-Identifier: Apache-2.0
// The Trust Tasks reference rule (decision 79 by the project owner and the TF-source audit): every vector cites a Trust Tasks repository artifact (tfRef) or is an explicit candidate;
// a retired citation is excluded from every run; synthetic carriers are marked; candidates record who implements them.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { deriveImplementedBy, deriveImplementedByGovernance } from "../src/vectors/implemented-by.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { validateVectorFile } from "../src/vectors/validate.ts";
import { countedClassOf, detectDrift, usesSyntheticType, validateSource } from "../src/vectors/source.ts";
import { loadTfManifest, tfPathOf } from "../src/vectors/tfref.ts";
import { collectAllVectors, verifyAgainstClone, verifyAgainstManifest } from "../src/vectors/tfresolve.ts";
import { NEEDS_RUNS, ROOT } from "./helpers.ts";
import { tmpdir } from "node:os";

const all = collectAllVectors();
const manifest = loadTfManifest();
const SYNTHETIC_IDS = ["TC-015", "TC-016", "TC-017", "ENV-006", "ENV-007", ...Array.from({ length: 13 }, (_, i) => `DUP-${101 + i}`), "ERR-004", "ERR-005", "ENV-009", "BND-004", "BND-007", "RCPT-069", "RCPT-020"];
const RETIRED_IDS = ["EM-PSH-001", "EM-PSH-003", "EM-PSH-005", "EM-VLT-003", "PP-VLT-009", "PP-VLT-010", "PP-VLT-011"];

describe("every vector cites a Trust Tasks artifact or is a candidate (all families)", () => {
  it("covers every family: 1429 vectors in the shipped files", () => {
    // the coverage families (vectors/coverage, docs/22) are counted apart
    const coverage = loadSuite(join(ROOT, "vectors", "coverage")).files.reduce((n, f) => n + f.file.vectors.length, 0);
    // the ceremony scenarios (vectors/ceremony-scenarios, docs/25 to 27) are found for the drift and tfRef checks, but are not vectors: 163 scenarios and their step sources (a step that sends two kinds counts each)
    const scenarios = all.filter((x) => x.file.startsWith("ceremony-scenarios/"));
    assert.equal(scenarios.length, 618);
    assert.equal(scenarios.filter((x) => x.step === true).length, 455);
    // the seeded-state probe (vectors/probe, docs/22) is advisory and counted apart too
    const probe = loadSuite(join(ROOT, "vectors", "probe")).files.reduce((n, f) => n + f.file.vectors.length, 0);
    // the gap families (vectors/gap, tested in test/gap.test.ts) are counted apart as well
    const gap = loadSuite(join(ROOT, "vectors", "gap")).files.reduce((n, f) => n + f.file.vectors.length, 0);
    assert.ok(gap > 0);
    // the completion vectors (vectors/complete, tested in test/complete.test.ts) are counted apart too
    const complete = all.filter((x) => x.file.startsWith("complete/")).length; // vectors and their step sources, as for the gap set
    assert.ok(complete > 0);
    // the advisory alignment set (vectors/alignment, docs/tf-alignment.md) is counted apart as well
    const alignment = all.filter((x) => x.file.startsWith("alignment/")).length;
    assert.ok(alignment > 0);
    assert.equal(all.length - coverage - probe - scenarios.length - gap - complete - alignment, 1429);
    const fam = new Map<string, number>();
    for (const v of all.filter((x) => !x.file.startsWith("coverage/") && !x.file.startsWith("probe/") && !x.file.startsWith("ceremony-scenarios/") && !x.file.startsWith("gap/") && !x.file.startsWith("complete/") && !x.file.startsWith("alignment/"))) fam.set(v.file.split("/")[0]!, (fam.get(v.file.split("/")[0]!) ?? 0) + 1);
    assert.deepEqual(Object.fromEntries([...fam].sort()), { "2l": 158, "ceremony-doc": 19, "ceremony-receipt": 70, "ceremony-vrc": 88, dtg: 63, emit: 183, "emit-more": 75, framework: 154, governance: 5, plain: 543, witness: 28, "ceremony-witness": 43 });
  });
  it("each non-candidate vector has a valid tfRef; each candidate is a complete candidate", () => {
    for (const v of all) {
      const errs = validateSource(v.source, v.id);
      assert.deepEqual(errs, [], v.id);
      if (v.source.channel !== "candidate") assert.ok(v.source.tfRef !== undefined, `${v.id} has no tfRef`);
    }
  });
  it("the loader rejects a vector without tfRef, a candidate without its fields, and a retired vector that is not excluded from run", () => {
    const ok = { slug: "s", version: "0.1", channel: "registry", ref: "kit:SPEC.md", pinnedDigest: null, tfRef: { status: "main", repoPath: "SPEC.md", commit: manifest.main.commit } };
    const file = (src: unknown, extra: object = {}) => ({ format: "tt-conformance-vectors/0.1", group: "ENV", family: "f", clock: { start: "2026-11-12T10:00:00Z" }, vectors: [{ id: "ENV-001", title: "t", tier: 1, spec: ["x"], source: src, clarify: null, steps: [{ send: { template: "carrier.request" }, expect: { disposition: "response" } }], ...extra }] });
    assert.deepEqual(validateVectorFile(file(ok)), []);
    const { tfRef: _t, ...bare } = ok;
    assert.match(validateVectorFile(file(bare)).join(), /tfRef: required/);
    assert.match(validateVectorFile(file({ ...ok, tfRef: { status: "main", repoPath: "SPEC.md" } })).join(), /commit/);
    assert.match(validateVectorFile(file({ ...ok, tfRef: { status: "pr", pr: 5, head: "abcdef0" } })).join(), /pr exactly when channel is pr/);
    const cand = { slug: "s", version: "0.1", channel: "candidate", ref: "suite:docs/10-witness-share-profile.md", pinnedDigest: null };
    assert.match(validateVectorFile(file(cand)).join(), /candidate: channel candidate requires/);
    const full = { implementedBy: ["a"], localText: "docs/10-witness-share-profile.md", adoptionNote: "none filed" };
    assert.deepEqual(validateVectorFile(file({ ...cand, candidate: full })), []);
    assert.match(validateVectorFile(file({ ...cand, candidate: { ...full, implementedBy: [] } })).join(), /implementedByNote/);
    assert.match(validateVectorFile(file({ ...cand, candidate: { ...full, localText: "docs/nope.md" } })).join(), /does not exist/);
    assert.match(validateVectorFile(file({ ...cand, candidate: { ...full, adoptionNote: "" } })).join(), /adoptionNote/);
    assert.match(validateVectorFile(file({ ...ok, candidate: full })).join(), /only allowed with channel candidate/);
    const retired = { ...ok, tfRef: { status: "retired", repoPath: "specs/push/register/0.1/spec.md", commit: manifest.main.commit, supersededBy: "push/register/0.2" } };
    assert.match(validateVectorFile(file(retired)).join(), /must be excluded from every run/);
    assert.deepEqual(validateVectorFile(file(retired, { excludedFromRun: { reason: "r" } })), []);
    assert.match(validateVectorFile(file({ ...ok, channel: "proposed" })).join(), /profile/);
  });
  it("every tfRef resolves in the committed manifest at the manifest's main commit with the status it names", () => {
    // the gap vectors (vectors/gap) cite the task-force text at the snapshot commit (vectors-src/gap/tf-snapshot.json), not the manifest commit; test/gap.test.ts checks them against the snapshot
    assert.deepEqual(verifyAgainstManifest(all.filter((x) => !x.file.startsWith("gap/") && !x.file.startsWith("complete/"))), []);
    assert.equal(manifest.main.commit, "bd0c05013277b83f23fa90db699671ebb48dd24c");
    assert.equal(manifest.kit.commit, manifest.main.commit, "one agreed commit: the kit pin equals the manifest's commit (scripts/check-pins.ts)");
  });
  it("the tfRef follows the source ref (a vector cannot cite one TF path and carry another)", () => {
    for (const v of all) if (v.source.tfRef !== undefined && v.source.tfRef.status !== "pr" && v.source.channel !== "candidate" && v.source.ref !== "") { // a pr tfRef names the pull request and its head, not a main path
      const p = tfPathOf(v.source.ref);
      if (p !== null) assert.equal(v.source.tfRef.repoPath, p, v.id);
    }
  });
  it("the clone check passes when a Trust Tasks clone is available, and is skipped with a clear message when it is not", () => {
    const c = verifyAgainstClone(all);
    if ("skipped" in c) assert.match(c.skipped, /SKIPPED/);
    else assert.deepEqual(c.problems, []);
    const none = verifyAgainstClone(all, join(ROOT, "no-such-clone-dir"));
    // an explicit path that does not exist falls through to the default lookup; with no clone at all the message is explicit
    if ("skipped" in none) assert.match(none.skipped, /SKIPPED/);
  });
});

describe("candidate channel (decision 79 by the project owner)", () => {
  // the candidate coverage vectors (group CC, decision CV-6, test/coverage-candidates.test.ts) are counted apart from these 32
  const ccCands = all.filter((v) => v.source.channel === "candidate" && v.id.startsWith("CC-"));
  // the witnessed-VRC scenarios (FC-WSH, channel candidate, docs/25) are scenarios, not vectors: never counted here
  const cands = all.filter((v) => v.source.channel === "candidate" && !v.id.startsWith("CC-") && !v.file.startsWith("ceremony-scenarios/"));
  it("is exactly WSH-001..023, TD-001..006, the five governance probes and the three per-declared-E ceremony vectors", () => {
    const wshFile = all.filter((v) => v.file === "ceremony-vrc/witness-share.json").map((v) => v.id);
    assert.equal(wshFile.length, 23);
    assert.deepEqual(cands.map((v) => v.id).sort(), [...wshFile, ...Array.from({ length: 6 }, (_, i) => `TD-00${i + 1}`), ...Array.from({ length: 5 }, (_, i) => `GOV-D-00${i + 1}`), "CER-017", "CER-018", "CER-019"].sort());
  });
  it("counted as candidate: 32 (WSH, TD, CER-017..019); the five governance probes carry probe and are counted apart (review R19)", () => {
    const byClass = (c: string) => all.filter((v) => !v.id.startsWith("CC-") && !v.file.startsWith("ceremony-scenarios/") && countedClassOf(v.raw) === c).map((v) => v.id);
    assert.equal(byClass("candidate").length, 32);
    assert.deepEqual(byClass("probe"), Array.from({ length: 5 }, (_, i) => `GOV-D-00${i + 1}`));
    for (const v of all.filter((x) => x.raw.probe !== undefined)) assert.equal(v.source.channel, "candidate", v.id);
  });
  it("the candidate coverage vectors are counted apart: 5, all in the coverage directory", () => {
    assert.equal(ccCands.length, 5);
    for (const v of ccCands) assert.ok(v.file.startsWith("coverage/"), v.id);
  });
  it("without run folders, implementedBy keeps the value the committed vectors carry", () => {
    const none = join(tmpdir(), "no-such-results-dir", "runs");
    for (const v of cands) assert.deepEqual(v.source.candidate!.implementedBy, v.id.startsWith("GOV-") ? deriveImplementedByGovernance(none) : deriveImplementedBy((id) => id === v.id, none), v.id);
  });
  it("implementedBy is what the recorded results show, not a hard-coded value", NEEDS_RUNS, () => {
    const wsh = deriveImplementedBy((id) => id.startsWith("WSH-"));
    const td = deriveImplementedBy((id) => id.startsWith("TD-"));
    assert.ok(wsh.includes("keyring-wallet") && wsh.includes("truststackers"), `witness-share platforms: ${wsh.join()}`);
    assert.ok(!wsh.includes("verifiable-trust-infrastructure"), "VTI skips every witness-share vector");
    for (const v of cands) {
      const c = v.source.candidate!;
      const want = v.id.startsWith("WSH-") ? wsh : v.id.startsWith("TD-") ? td : v.id.startsWith("CER-") ? deriveImplementedBy((id) => ["CER-017", "CER-018", "CER-019"].includes(id)) : deriveImplementedByGovernance();
      assert.deepEqual(c.implementedBy, want, v.id);
    }
    assert.deepEqual(deriveImplementedBy(() => false), []);
  });
  it("the local text exists and drift tracks its digest", () => {
    for (const v of cands) {
      assert.ok(existsSync(join(ROOT, v.source.candidate!.localText)), v.id);
      assert.equal(v.source.ref, `suite:${v.source.candidate!.localText}`, v.id);
      assert.deepEqual(detectDrift([{ id: v.id, source: v.source }], { suite: ROOT }), [], `${v.id}: pinned digest of the local text is current`);
    }
    const v = cands[0]!;
    const drifted = detectDrift([{ id: v.id, source: { ...v.source, pinnedDigest: "sha256:" + "0".repeat(64) } }], { suite: ROOT });
    assert.deepEqual(drifted.map((d) => [d.channel, d.reason]), [["candidate", "changed"]]);
  });
});

describe("excluded-from-run and synthetic vectors", () => {
  it("exactly the seven retired-spec vectors are excluded from every run, with the reason, and cite a retired tfRef", () => {
    // the retired gap specifications are excluded too, with their own reason (test/gap.test.ts)
    const heldAll = all.filter((v) => v.excludedFromRun !== undefined && !v.file.startsWith("gap/") && !v.file.startsWith("complete/"));
    // three more cite vta/webvh/dids/list 1.0, which the task force retired after the first manifest pin (the manifest now lists it as retired, successor vta/dids/list/0.1): excluded from every run with that successor named (D901)
    const laterPin = heldAll.filter((v) => v.source.tfRef?.supersededBy === "vta/dids/list/0.1");
    assert.deepEqual(laterPin.map((v) => v.id).sort(), ["CV-AA-177", "CV-AA-178", "EX-VTA-020"]);
    for (const v of laterPin) { assert.equal(v.source.tfRef!.status, "retired"); assert.equal((v.excludedFromRun as { reason: string }).reason, "cites a retired TF spec; successor vta/dids/list/0.1 is draft on main"); }
    const held = heldAll.filter((v) => !laterPin.includes(v));
    assert.deepEqual(held.map((v) => v.id).sort(), [...RETIRED_IDS].sort());
    for (const v of held) {
      assert.equal((v.excludedFromRun as { reason: string }).reason, "cites a retired TF spec; successor 0.2 is draft on main");
      assert.equal(v.source.tfRef!.status, "retired");
      assert.match(v.source.tfRef!.supersededBy!, /0\.2$/);
    }
    for (const v of all.filter((x) => !x.file.startsWith("ceremony-scenarios/"))) if (v.source.tfRef?.status === "retired") assert.ok(v.excludedFromRun !== undefined, v.id);
    // A ceremony scenario step is not a vector and is not run against a platform: it cites the task the Trust Tasks ceremony definition names. member-onboarding 0.1 names a retired task (its `apply` step is submit 0.1) and FC-ONB now runs the latest instead (D560).
    const retiredSteps = all.filter((x) => x.file.startsWith("ceremony-scenarios/") && x.source.tfRef?.status === "retired");
    assert.equal(retiredSteps.length, 0, "FC-ONB runs at the latest versions (D560): no ceremony scenario step claims a retired task");
    assert.match((held.find((v) => v.id === "EM-PSH-001")!.excludedFromRun as { note: string }).note, /keyring-wallet still emits the retired 0\.1/);
  });
  it("exactly the 25 vectors (the audit counted 24: it missed ENV-007, whose type is conformance/Widget) with a synthetic carrier type are marked synthetic", () => {
    const marked = all.filter((v) => v.synthetic === true).map((v) => v.id).sort();
    assert.deepEqual(marked, [...SYNTHETIC_IDS].sort());
    assert.deepEqual(all.filter((v) => usesSyntheticType(v.raw) !== (v.synthetic === true)).map((v) => v.id), []);
  });
});
