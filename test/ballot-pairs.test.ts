// SPDX-License-Identifier: Apache-2.0
// The ballot-cast ceremony (docs/32, group FC-BAL) between a voter's client and a ballot box. Both sides are the suite's reference oracle (src/adapters/reference/ballot-reference.ts): the oracle pair completes (or ends as the scenario
// specifies) every scenario, and each mutant of the ballot box ends the scenario that watches for it `failed`. Runs of the real platforms are recorded outside the repository.
// Never a statement about a platform, never a conformance count.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeAdapter } from "../src/runner/adapters.ts";
import { loadScenarios } from "../src/ceremony/scenario.ts";
import { runScenarios } from "../src/ceremony/runner.ts";
import { BALLOT_MUTANTS } from "../src/adapters/reference/ballot-reference.ts";
import { VECTORS } from "./helpers.ts";

const files = () => loadScenarios(join(VECTORS, "ceremony-scenarios")).files.map((f) => f.file);
const run = async (id: string, mut?: string) => {
  const specs = { K: "reference-ballot-voter", B: mut === undefined ? "reference-ballot-box" : `reference-ballot-box:mut=${mut}` };
  return (await runScenarios(files(), { make: (s) => makeAdapter(specs[s as "K" | "B"]), specs, today: "2026-11-19", only: [id] })).results[0]!;
};
const IDS = Array.from({ length: 14 }, (_, i) => `FC-BAL-${String(i + 1).padStart(3, "0")}`);
describe("ballot-cast ceremony: the oracle pair", () => {
  it("the group has its 14 scenarios, on the proposed channel, evidence kind complete-ceremony", () => {
    const f = files().filter((x) => x.group === "FC-BAL");
    assert.equal(f.length, 1);
    assert.equal(f[0]!.scenarios.length, 14);
    assert.equal(f[0]!.ceremony.channel, "proposed");
  });
  for (const s of IDS) {
    it(`${s} ends as specified on the oracle pair, never a conformance count`, async () => {
      const r = await run(s);
      assert.ok(r.status === "completed" || r.status === "ended-as-specified", `${r.status}: ${r.reason}`);
      assert.equal(r.countedAsConformance, false);
    });
  }
});
describe("ballot-cast ceremony: mutants of the ballot box end the scenario that watches for them `failed`", () => {
  const WATCH: Record<(typeof BALLOT_MUTANTS)[number], string> = {
    ballotCountsTwice: "FC-BAL-002", ballotNoOpenCheck: "FC-BAL-003", ballotNoManifestCheck: "FC-BAL-005", ballotNoAnswerCheck: "FC-BAL-006", ballotNoClassCheck: "FC-BAL-007", ballotAcceptsForged: "FC-BAL-008",
    ballotRevoteIgnored: "FC-BAL-009", ballotReplaceKeepsBoth: "FC-BAL-010", ballotNoProofCheck: "FC-BAL-011", ballotReceiptWrongThread: "FC-BAL-001", ballotReceiptToWrongKey: "FC-BAL-001",
  };
  for (const m of BALLOT_MUTANTS) it(`${m} is caught by ${WATCH[m]}`, async () => { assert.equal((await run(WATCH[m], m)).status, "failed"); });
});
