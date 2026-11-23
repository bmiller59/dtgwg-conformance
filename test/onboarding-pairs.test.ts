// SPDX-License-Identifier: Apache-2.0
// The onboarding and vetting-directory ceremonies (docs/30): groups FC-MBR and FC-IDV between a member and a community. Here both sides are the suite's reference oracle
// (src/adapters/reference/join-reference.ts): the oracle pair completes every scenario, and each deliberate mutant of the community makes the scenario meant to catch it end
// `failed`, so no scenario passes vacuously. Runs of the real platforms (keyring-wallet with VTI's community service) are recorded outside the repository and are never part of
// this test. Never a statement about a platform, never a conformance count.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeAdapter } from "../src/runner/adapters.ts";
import { loadScenarios } from "../src/ceremony/scenario.ts";
import { runScenarios } from "../src/ceremony/runner.ts";
import { COMMUNITY_MUTANTS } from "../src/adapters/reference/join-reference.ts";
import { VECTORS } from "./helpers.ts";

const files = () => loadScenarios(join(VECTORS, "ceremony-scenarios")).files.map((f) => f.file);
const mine = () => files().filter((f) => ["FC-MBR", "FC-IDV"].includes(f.group));
const specsFor = (mut?: string) => ({ K: "reference-joiner", V: mut === undefined ? "reference-community" : `reference-community:mut=${mut}` });
const run = async (id: string, mut?: string) => {
  const specs = specsFor(mut);
  return (await runScenarios(files(), { make: (s) => makeAdapter(specs[s as "K" | "V"]), specs, today: "2026-11-19", only: [id] })).results[0]!;
};
const IDS = [...Array.from({ length: 17 }, (_, i) => `FC-MBR-${String(i + 1).padStart(3, "0")}`), ...Array.from({ length: 8 }, (_, i) => `FC-IDV-${String(i + 1).padStart(3, "0")}`)];

describe("onboarding and vetting-directory ceremonies: the oracle pair", () => {
  it("the two groups have their scenarios, on the proposed channel, with evidence kind complete-ceremony, and every step cites a specification", () => {
    const f = mine();
    assert.deepEqual(f.map((x) => x.group).sort(), ["FC-IDV", "FC-MBR"]);
    assert.equal(f.flatMap((x) => x.scenarios).length, 25);
    for (const x of f) {
      assert.equal(x.ceremony.channel, "proposed");
      assert.equal(x.evidence, "complete-ceremony");
      for (const s of x.scenarios) assert.ok(s.steps.filter((st) => st.do.initiate !== undefined).every((st) => st.source !== undefined), s.id);
    }
  });
  it("the retired submit 0.1 stays a documented step of the definition (named in FC-MBR-001's specification lines) and is claimed by no step of FC-MBR", () => {
    const all = mine().filter((x) => x.group === "FC-MBR").flatMap((x) => x.scenarios);
    assert.ok(all[0]!.spec.some((l) => l.includes("retired vtc/join-requests/submit/0.1")));
    for (const s of all) for (const st of s.steps) assert.ok(!(st.source?.slug === "vtc/join-requests/submit" && st.source.version === "0.1"), `${s.id} step ${st.id}`);
  });
  for (const s of IDS) {
    it(`${s} ends as specified on the oracle pair, never a conformance count`, async () => {
      const r = await run(s);
      assert.ok(r.status === "completed" || r.status === "ended-as-specified", `${r.status}: ${r.reason} (${r.failedStep})`);
      assert.equal(r.countedAsConformance, false);
      assert.equal(r.evidence, "complete-ceremony");
    });
  }
});

describe("onboarding and vetting-directory ceremonies: mutants of the community end the scenario that watches for them `failed`", () => {
  const WATCH: Record<(typeof COMMUNITY_MUTANTS)[number], string[]> = {
    joinAdmitsOnSubmit: ["FC-MBR-001"], joinDecidesUnknown: ["FC-MBR-009"], joinDecideByAnyone: ["FC-MBR-012"], joinNoProofCheck: ["FC-MBR-007"], joinWithdrawKeepsPending: ["FC-MBR-003"], joinSecondOpen: ["FC-MBR-004"],
    joinVmcBeforeApproval: ["FC-ONB-006"], joinVmcNeverStored: ["FC-ONB-004"],
    joinDecideTwice: ["FC-MBR-010"], joinWrongRecipientAccepted: ["FC-MBR-008"], joinSupplementPending: ["FC-MBR-016"], vetProfileWithoutGrant: ["FC-IDV-003"], vetUnlistedStillListed: ["FC-IDV-002"], vetShowAlwaysLive: ["FC-IDV-004"], vetRevokeNotIdempotent: ["FC-IDV-005"],
  };
  for (const m of COMMUNITY_MUTANTS) for (const id of WATCH[m]) {
    it(`${m} is caught by ${id}`, async () => {
      const r = await run(id, m);
      assert.equal(r.status, "failed", `${m} should end ${id} failed, got ${r.status}`);
    });
  }
  it("every mutant is watched by at least one scenario", () => { for (const m of COMMUNITY_MUTANTS) assert.ok(WATCH[m].length > 0, m); });
});
