// SPDX-License-Identifier: Apache-2.0
// The rooms ceremony (docs/32, group FC-RMS) between a member, a community that hosts an open room and the member's agent. All three sides are the suite's reference oracle (src/adapters/reference/rooms-reference.ts): the oracle
// completes every scenario (the step-downs against their labelled legacy profiles) and each mutant of the community or the agent ends the scenario that watches for it `failed`. Runs of the real platforms are recorded outside the
// repository. Never a statement about a platform, never a conformance count.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeAdapter } from "../src/runner/adapters.ts";
import { loadScenarios } from "../src/ceremony/scenario.ts";
import { runScenarios } from "../src/ceremony/runner.ts";
import { ROOMS_MUTANTS } from "../src/adapters/reference/rooms-reference.ts";
import { VECTORS } from "./helpers.ts";

const files = () => loadScenarios(join(VECTORS, "ceremony-scenarios")).files.map((f) => f.file);
const IDS = Array.from({ length: 18 }, (_, i) => `FC-RMS-${String(i + 1).padStart(3, "0")}`);
const run = async (id: string, mut?: string) => {
  const m = (side: "community" | "agent") => (mut !== undefined && (side === "agent") === ["rmsActsAnyType", "rmsKeyPackageUninvited"].includes(mut) ? `:mut=${mut}` : "");
  const specs = { K: "reference-rooms-member", V: `reference-rooms-community${m("community")}`, A: `reference-rooms-agent${m("agent")}` };
  return (await runScenarios(files(), { make: (s) => makeAdapter(specs[s as "K" | "V" | "A"]), specs, today: "2026-11-19", only: [id] })).results[0]!;
};
describe("rooms ceremony: the oracle trio", () => {
  it("the group has its 18 scenarios, on the proposed channel, evidence kind complete-ceremony", () => {
    const f = files().filter((x) => x.group === "FC-RMS");
    assert.equal(f.length, 1);
    assert.equal(f[0]!.scenarios.length, 18);
    assert.equal(f[0]!.ceremony.channel, "proposed");
  });
  for (const s of IDS) {
    it(`${s} ends as specified on the oracle trio, never a conformance count`, async () => {
      const r = await run(s);
      assert.ok(r.status === "completed" || r.status === "ended-as-specified", `${r.status}: ${r.reason}`);
      assert.equal(r.countedAsConformance, false);
    });
  }
});
describe("rooms ceremony: mutants end the scenario that watches for them `failed`", () => {
  const WATCH: Record<(typeof ROOMS_MUTANTS)[number], string> = { rmsListsToNonMember: "FC-RMS-009", rmsExpiredAccepted: "FC-RMS-007", rmsPutWithoutPresentation: "FC-RMS-010", rmsNoVersionCheck: "FC-RMS-006", rmsReplayWrites: "FC-RMS-005", rmsInvalidManifestAccepted: "FC-RMS-011", rmsActsAnyType: "FC-RMS-015", rmsKeyPackageUninvited: "FC-RMS-014" };
  for (const m of ROOMS_MUTANTS) it(`${m} is caught by ${WATCH[m]}`, async () => { assert.equal((await run(WATCH[m], m)).status, "failed"); });
});
