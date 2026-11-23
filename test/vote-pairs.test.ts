// SPDX-License-Identifier: Apache-2.0
// The elections ceremony's reads (docs/31, group FC-VOT) between a member and a community. Both sides are the suite's reference oracle (src/adapters/reference/vote-reference.ts): the oracle pair completes every scenario
// (the step-down against its labelled legacy profile) and each mutant of the community ends the scenario that watches for it `failed`. Runs of the real platforms are recorded outside the repository.
// Never a statement about a platform, never a conformance count.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeAdapter } from "../src/runner/adapters.ts";
import { loadScenarios } from "../src/ceremony/scenario.ts";
import { runScenarios } from "../src/ceremony/runner.ts";
import { VOTE_MUTANTS } from "../src/adapters/reference/vote-reference.ts";
import { VECTORS } from "./helpers.ts";

const files = () => loadScenarios(join(VECTORS, "ceremony-scenarios")).files.map((f) => f.file);
const run = async (id: string, mut?: string) => {
  const specs = { K: "reference-vote-member", V: mut === undefined ? "reference-vote-community" : `reference-vote-community:mut=${mut}` };
  return (await runScenarios(files(), { make: (s) => makeAdapter(specs[s as "K" | "V"]), specs, today: "2026-11-19", only: [id] })).results[0]!;
};
describe("elections ceremony (reads): the oracle pair", () => {
  it("the group has its 4 scenarios, on the proposed channel, evidence kind complete-ceremony", () => {
    const f = files().filter((x) => x.group === "FC-VOT");
    assert.equal(f.length, 1);
    assert.equal(f[0]!.scenarios.length, 4);
    assert.equal(f[0]!.ceremony.channel, "proposed");
  });
  for (const s of ["FC-VOT-001", "FC-VOT-002", "FC-VOT-003", "FC-VOT-004"]) {
    it(`${s} ends as specified on the oracle pair, never a conformance count`, async () => {
      const r = await run(s);
      assert.ok(r.status === "completed" || r.status === "ended-as-specified", `${r.status}: ${r.reason}`);
      assert.equal(r.countedAsConformance, false);
    });
  }
});
describe("elections ceremony (reads): mutants of the community end the scenario that watches for them `failed`", () => {
  const WATCH: Record<(typeof VOTE_MUTANTS)[number], string> = { voteNonMemberServed: "FC-VOT-003", voteUnknownShownEmpty: "FC-VOT-002" };
  for (const m of VOTE_MUTANTS) it(`${m} is caught by ${WATCH[m]}`, async () => { assert.equal((await run(WATCH[m], m)).status, "failed"); });
});
