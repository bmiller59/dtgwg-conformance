// SPDX-License-Identifier: Apache-2.0
// The adapter honesty check (src/runner/honesty.ts, decision 39): the harness probes the declared essential governance against
// behaviour in every suite run. The honest reference at k = 1..4 is not flagged; each deliberately lying variant (DECLARATION_LIES) and
// each quorum mutant is caught: a declaration mismatch, the E family FAIL, a GOV-DECLARATION-MISMATCH finding and a non-zero exit code.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { DECLARATION_LIES } from "../src/adapters/reference/mutants.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { DECLARATION_MISMATCH_REASON, exitCode, runSuite } from "../src/runner/suite.ts";
import type { SuiteRun } from "../src/runner/suite.ts";
import { NO_CEREMONY } from "../src/runner/honesty.ts";
import { bannedWordsIn, GOV_KIND_MEANING } from "../src/governance/findings.ts";
import type { VectorFile } from "../src/vectors/types.ts";
import { FIXTURES, VECTORS } from "./helpers.ts";

const today = "2026-11-16";
const full = loadSuite(VECTORS);
/** The ceremony vectors driven from E (quorum steps) plus one that is not (CER-003), to show the mismatch fails only the E family. */
const IDS = ["CER-001", "CER-002", "CER-003", "CER-005", "CER-015", "CER-017", "CER-018", "CER-019"];
const E_FAMILY = IDS.filter((id) => id !== "CER-003");
const cer = { ...full, files: full.files.filter((f) => f.file.group === "CER").map((f) => ({ ...f, file: { ...f.file, vectors: f.file.vectors.filter((v) => IDS.includes(v.id)) } as VectorFile })) };

async function run(opts: ConstructorParameters<typeof ReferenceAdapter>[0]): Promise<SuiteRun> {
  return runSuite({ adapter: new ReferenceAdapter(opts), suite: cer, tier: 1, today, fixtureRoot: FIXTURES, channels: ["registry", "proposed", "candidate"] });
}

const CONFIGS: { label: string; approvers: string[]; k: number }[] = [
  { label: "k=1 of 1", approvers: ["A"], k: 1 },
  { label: "k=1 of 3", approvers: ["A", "B", "C"], k: 1 },
  { label: "k=2 of 2", approvers: ["A", "X"], k: 2 },
  { label: "k=2 of 3", approvers: ["A", "X", "B"], k: 2 },
  { label: "k=3 of 4", approvers: ["B", "C", "D", "F"], k: 3 },
  { label: "k=4 of 4", approvers: ["A", "X", "B", "C"], k: 4 },
];

function assertCaught(r: SuiteRun, what: string): void {
  const p = r.essentialProbe!;
  assert.equal(p.result, "mismatch", `${what}: ${JSON.stringify(p.checks)}`);
  assert.equal(p.finding?.kind, "GOV-DECLARATION-MISMATCH", what);
  assert.deepEqual(bannedWordsIn(p.finding!.text), [], what);
  for (const x of r.results.filter((y) => E_FAMILY.includes(y.id) && !(y.status === "SKIP" && /ceremony\.status/.test(y.reason ?? "")))) {
    assert.equal(x.status, "FAIL", `${what}: ${x.id} ${x.status}`);
    assert.ok(x.reason!.startsWith(DECLARATION_MISMATCH_REASON), `${what}: ${x.id} ${x.reason}`);
  }
  // CER-003 (Tier 2, not in the E family) is excluded by tier in this Tier 1 run: never a result, so never made FAIL
  assert.ok(r.results.every((y) => y.id !== "CER-003") && (r.excludedByTier ?? []).some((e) => e.id === "CER-003"), `${what}: CER-003 is not in the E family`);
  assert.equal(exitCode([r]), 1, what);
  // gating whatever the channels: a registry-only run that selects no E-driven vector still exits non-zero
}

describe("honesty check: the honest reference is not flagged", () => {
  for (const c of CONFIGS) {
    for (const proposerApproves of [true, false]) {
      it(`${c.label}, proposerApproves ${proposerApproves}`, async () => {
        const r = await run({ essential: { approvers: c.approvers, minApprovals: c.k }, proposerApproves });
        const p = r.essentialProbe!;
        assert.equal(p.result, "consistent", JSON.stringify(p.checks));
        assert.equal(p.finding, undefined);
        assert.deepEqual(p.checks.map((x) => x.result), ["consistent", "consistent"]);
        assert.equal(exitCode([r]), 0);
      });
    }
  }
  it("the default reference (A and X, k = 2, from its own configuration) is consistent", async () => {
    const r = await run({});
    assert.equal(r.essentialProbe!.result, "consistent");
    assert.match(r.essentialProbe!.declared!, /^k = 2 of an authority set of 2/);
  });
});

describe("honesty check: every lying variant is caught", () => {
  for (const c of CONFIGS) {
    for (const proposerApproves of [true, false]) {
      for (const lie of Object.keys(DECLARATION_LIES)) {
        // At k = 1 with a counted begin, completing "one early" is the same behaviour as the honest one (the begin is the first approval).
        if (lie === "completesEarly" && c.k === 1 && proposerApproves) continue;
        it(`${c.label}, proposerApproves ${proposerApproves}: ${lie}`, async () => {
          assertCaught(await run({ essential: { approvers: c.approvers, minApprovals: c.k }, proposerApproves, declarationLie: lie }), `${lie} at ${c.label}`);
        });
      }
    }
  }
  it("the examples of decision 39: declares 1 of 1 but needs 2; declares 1 of 1 but accepts anyone; declares k = 2 but completes at 1 or at 3", async () => {
    const needsTwo = await run({ essential: { approvers: ["A"], minApprovals: 1 }, declarationLie: "completesLate" });
    assertCaught(needsTwo, "needs two");
    assert.match(needsTwo.essentialProbe!.checks[0]!.observed, /did not complete at the declared k-th/);
    const anyone = await run({ essential: { approvers: ["A"], minApprovals: 1 }, declarationLie: "anyPrincipalDecides" });
    assertCaught(anyone, "accepts anyone");
    assert.match(anyone.essentialProbe!.checks[1]!.observed, /outside the declared authority set completed/);
    const early = await run({ essential: { approvers: ["A", "X", "B"], minApprovals: 2 }, declarationLie: "completesEarly" });
    assertCaught(early, "completes at 1");
    assert.match(early.essentialProbe!.checks[0]!.observed, /completed at 1 distinct approval/);
    assert.equal(early.essentialProbe!.checks[1]!.result, "not-run");
    assertCaught(await run({ essential: { approvers: ["A", "X", "B"], minApprovals: 2 }, declarationLie: "completesLate" }), "completes at 3");
  });
  it("the quorum mutants are declaration mismatches too", async () => {
    for (const m of ["cerQuorumEarly", "cerQuorumLate", "cerNonAdminApproves"]) assertCaught(await run({ mutants: [m] }), m);
  });
  it("a mismatch gates even when no E-driven vector is selected (registry only, no ceremony vector)", async () => {
    const plain = { ...full, files: full.files.filter((f) => f.file.group === "MSG").slice(0, 1) };
    const r = await runSuite({ adapter: new ReferenceAdapter({ declarationLie: "completesLate" }), suite: plain, tier: 1, today, fixtureRoot: FIXTURES });
    assert.equal(r.essentialProbe!.result, "mismatch");
    assert.equal(exitCode([r]), 1);
  });
});

describe("honesty check: where it does not run", () => {
  it("E unreadable: GOV-NOT-PROBED, nothing made FAIL", async () => {
    const adapter = new ReferenceAdapter({ declarationLie: "completesLate" });
    const caps = await adapter.capabilities();
    delete caps.governance!.essential;
    const wrapped = Object.assign(Object.create(Object.getPrototypeOf(adapter) as object) as ReferenceAdapter, adapter, { capabilities: async () => caps });
    const r = await runSuite({ adapter: wrapped, suite: cer, tier: 1, today, fixtureRoot: FIXTURES });
    assert.equal(r.essentialProbe!.result, "not-probed");
    assert.equal(r.essentialProbe!.finding?.kind, "GOV-NOT-PROBED");
    assert.ok(r.results.every((x) => !(x.reason ?? "").startsWith(DECLARATION_MISMATCH_REASON)));
  });
  it("no ceremony offered: not run, with that reason", async () => {
    const r = await runSuite({ adapter: new ReferenceAdapter({ ceremony: false }), suite: cer, tier: 1, today, fixtureRoot: FIXTURES });
    assert.equal(r.essentialProbe!.result, "not-run");
    assert.equal(r.essentialProbe!.reason, NO_CEREMONY);
    assert.equal(r.essentialProbe!.finding, undefined);
  });
  it("the finding kind's meaning is free of banned words", () => {
    assert.deepEqual(bannedWordsIn(GOV_KIND_MEANING["GOV-DECLARATION-MISMATCH"]), []);
  });
});
