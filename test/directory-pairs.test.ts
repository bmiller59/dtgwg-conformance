// SPDX-License-Identifier: Apache-2.0
// The directory ceremony (docs/31, group FC-DIR) between a member and a community. Here both sides are the suite's reference oracle (src/adapters/reference/directory-reference.ts):
// the oracle pair completes every scenario, and each deliberate mutant of the community makes the scenario meant to catch it end `failed`, so no scenario passes vacuously. Runs of the
// real platforms (keyring-wallet with VTI's community service) are recorded outside the repository and are never part of this test. Never a statement about a platform, never a conformance count.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeAdapter } from "../src/runner/adapters.ts";
import { loadScenarios } from "../src/ceremony/scenario.ts";
import { runScenarios } from "../src/ceremony/runner.ts";
import { DIR_MUTANTS } from "../src/adapters/reference/directory-reference.ts";
import { VECTORS } from "./helpers.ts";

const files = () => loadScenarios(join(VECTORS, "ceremony-scenarios")).files.map((f) => f.file);
const mine = () => files().filter((f) => f.group === "FC-DIR");
const specsFor = (mut?: string) => ({ K: "reference-dir-member", V: mut === undefined ? "reference-dir-community" : `reference-dir-community:mut=${mut}` });
const run = async (id: string, mut?: string) => {
  const specs = specsFor(mut);
  return (await runScenarios(files(), { make: (s) => makeAdapter(specs[s as "K" | "V"]), specs, today: "2026-11-19", only: [id] })).results[0]!;
};
const IDS = Array.from({ length: 13 }, (_, i) => `FC-DIR-${String(i + 1).padStart(3, "0")}`);

describe("directory ceremony: the oracle pair", () => {
  it("the group has its 13 scenarios, on the proposed channel, with evidence kind complete-ceremony, and every step that sends a document cites a specification", () => {
    const f = mine();
    assert.equal(f.length, 1);
    assert.equal(f[0]!.scenarios.length, 13);
    assert.equal(f[0]!.ceremony.channel, "proposed");
    assert.equal(f[0]!.evidence, "complete-ceremony");
    for (const s of f[0]!.scenarios) assert.ok(s.steps.filter((st) => st.do.initiate !== undefined || st.do.replay !== undefined).every((st) => st.source !== undefined), s.id);
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

describe("directory ceremony: mutants of the community end the scenario that watches for them `failed`", () => {
  const WATCH: Record<(typeof DIR_MUTANTS)[number], string[]> = {
    dirClampsSilently: ["FC-DIR-010"], dirHiddenStillListed: ["FC-DIR-006"], dirWithheldAsNull: ["FC-DIR-002"], dirNoRevisionCheck: ["FC-DIR-008"], dirServesNonMember: ["FC-DIR-009"],
    dirDerivedWritable: ["FC-DIR-010"], dirNarrowingDeferred: ["FC-DIR-005"], dirQueryEmptyNotNotFound: ["FC-DIR-007"], dirListsIncomplete: ["FC-DIR-003"],
  };
  for (const m of DIR_MUTANTS) for (const id of WATCH[m]) {
    it(`${m} is caught by ${id}`, async () => {
      const r = await run(id, m);
      assert.equal(r.status, "failed", `${m} should end ${id} failed, got ${r.status}`);
    });
  }
  it("every mutant is watched by at least one scenario", () => { for (const m of DIR_MUTANTS) assert.ok(WATCH[m].length > 0, m); });
});
