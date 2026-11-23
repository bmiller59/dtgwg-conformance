// SPDX-License-Identifier: Apache-2.0
// The paired ceremonies (docs/26): groups FC-ACL, FC-DEV and FC-VLT between a member phone and an agent, and FC-AUT (sign-in). Here both sides are the suite's reference
// oracle (src/adapters/reference/pair-reference.ts, oob-starter.ts): the oracle pair completes every scenario, and each deliberate mutant of the agent makes the scenario
// that is meant to catch it end `failed`, so no scenario passes vacuously. Runs of the real platforms (keyring-wallet with VTI) are recorded under results/runs and are
// never part of this test. Never a statement about a platform, never a conformance count.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeAdapter } from "../src/runner/adapters.ts";
import { loadScenarios } from "../src/ceremony/scenario.ts";
import { runScenarios } from "../src/ceremony/runner.ts";
import { AGENT_MUTANTS } from "../src/adapters/reference/pair-reference.ts";
import { VECTORS } from "./helpers.ts";

const files = () => loadScenarios(join(VECTORS, "ceremony-scenarios")).files.map((f) => f.file);
const mine = () => files().filter((f) => ["FC-ACL", "FC-DEV", "FC-VLT", "FC-STU"].includes(f.group)).flatMap((f) => f.scenarios);
const specsFor = (mut?: string) => ({ K: "reference-member", V: mut === undefined ? "reference-agent" : `reference-agent:mut=${mut}` });
const run = async (id: string, mut?: string) => {
  const specs = specsFor(mut);
  return (await runScenarios(files(), { make: (s) => makeAdapter(specs[s as "K" | "V"]), specs, today: "2026-11-19", only: [id] })).results[0]!;
};

describe("paired ceremonies: the oracle pair", () => {
  it("the three groups have their scenarios, on the proposed channel, with evidence kind complete-ceremony", () => {
    const f = files();
    for (const g of ["FC-ACL", "FC-DEV", "FC-VLT", "FC-STU"]) assert.ok(f.some((x) => x.group === g && x.ceremony.channel === "proposed" && x.evidence === "complete-ceremony"), g);
    assert.ok(mine().length >= 15);
  });
  for (const s of ["FC-ACL-001", "FC-ACL-002", "FC-ACL-003", "FC-ACL-004", "FC-ACL-005", "FC-ACL-006", "FC-ACL-007", "FC-ACL-008", "FC-ACL-009", "FC-DEV-001", "FC-DEV-002", "FC-DEV-003", "FC-DEV-004", "FC-DEV-005", "FC-DEV-006", "FC-DEV-007", "FC-STU-001", "FC-STU-002", "FC-STU-003", "FC-STU-004", "FC-STU-005", "FC-VLT-001", "FC-VLT-002"]) {
    it(`${s} ends as specified on the oracle pair, never a conformance count`, async () => {
      const r = await run(s);
      assert.ok(r.status === "completed" || r.status === "ended-as-specified", `${r.status}: ${r.reason} (${r.failedStep})`);
      assert.equal(r.countedAsConformance, false);
      assert.equal(r.evidence, "complete-ceremony");
    });
  }
});

describe("paired ceremonies: mutants of the agent end the scenario that watches for them `failed`", () => {
  const WATCH: Record<(typeof AGENT_MUTANTS)[number], string[]> = {
    aclRevokeKeepsEntry: ["FC-ACL-001"], aclAnyoneMayGrant: ["FC-ACL-002"], aclReplayExecutes: ["FC-ACL-005"], aclNoProofCheck: ["FC-ACL-006"], aclNoRecipientCheck: ["FC-ACL-007"], aclNoWindow: ["FC-ACL-008"],
    aclSwapKeepsOld: ["FC-ACL-009"], deviceRegisterTwice: ["FC-DEV-002"], deviceWipeDeletes: ["FC-DEV-007"], deviceHeartbeatUnregistered: ["FC-DEV-003"], vaultFilesNothing: ["FC-VLT-001"], vaultQueryError: ["FC-VLT-001"], stepUpNoGate: ["FC-STU-001"], stepUpAnyChallenge: ["FC-STU-005"], stepUpDeniedElevates: ["FC-STU-003"],
  };
  for (const m of AGENT_MUTANTS) for (const id of WATCH[m]) {
    it(`${m} is caught by ${id}`, async () => {
      const r = await run(id, m);
      assert.equal(r.status, "failed", `${m} should end ${id} failed, got ${r.status}`);
    });
  }
  it("every mutant is watched by at least one scenario", () => { for (const m of AGENT_MUTANTS) assert.ok(WATCH[m].length > 0, m); });
});
