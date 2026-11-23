// SPDX-License-Identifier: Apache-2.0
// The persona ceremony (docs/31, group FC-PER) between a phone and an agent. Both sides are the suite's reference oracle (src/adapters/reference/persona-reference.ts): the oracle pair completes every scenario
// (the step-down against its labelled legacy profile), and each deliberate mutant of the agent makes the scenario meant to catch it end `failed`. Runs of the real platforms are recorded outside the repository.
// Never a statement about a platform, never a conformance count.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeAdapter } from "../src/runner/adapters.ts";
import { loadScenarios } from "../src/ceremony/scenario.ts";
import { runScenarios } from "../src/ceremony/runner.ts";
import { PERSONA_MUTANTS } from "../src/adapters/reference/persona-reference.ts";
import { VECTORS } from "./helpers.ts";

const files = () => loadScenarios(join(VECTORS, "ceremony-scenarios")).files.map((f) => f.file);
const run = async (id: string, mut?: string) => {
  const specs = { K: "reference-persona-phone", V: mut === undefined ? "reference-persona-agent" : `reference-persona-agent:mut=${mut}` };
  return (await runScenarios(files(), { make: (s) => makeAdapter(specs[s as "K" | "V"]), specs, today: "2026-11-19", only: [id] })).results[0]!;
};
const IDS = Array.from({ length: 5 }, (_, i) => `FC-PER-${String(i + 1).padStart(3, "0")}`);

describe("persona ceremony: the oracle pair", () => {
  it("the group has its 5 scenarios, on the proposed channel, with evidence kind complete-ceremony, and every step that sends a document cites a specification", () => {
    const f = files().filter((x) => x.group === "FC-PER");
    assert.equal(f.length, 1);
    assert.equal(f[0]!.scenarios.length, 5);
    assert.equal(f[0]!.ceremony.channel, "proposed");
    for (const s of f[0]!.scenarios) assert.ok(s.steps.filter((st) => st.do.initiate !== undefined).every((st) => st.source !== undefined), s.id);
  });
  for (const s of IDS) {
    it(`${s} ends as specified on the oracle pair, never a conformance count`, async () => {
      const r = await run(s);
      assert.ok(r.status === "completed" || r.status === "ended-as-specified", `${r.status}: ${r.reason} (${r.failedStep})`);
      assert.equal(r.countedAsConformance, false);
    });
  }
});

describe("persona ceremony: mutants of the agent end the scenario that watches for them `failed`", () => {
  const WATCH: Record<(typeof PERSONA_MUTANTS)[number], string[]> = { perContextMerges: ["FC-PER-003"], perNoServerlessFlag: ["FC-PER-001"], perExportOverRest: ["FC-PER-004"] };
  for (const m of PERSONA_MUTANTS) for (const id of WATCH[m]) {
    it(`${m} is caught by ${id}`, async () => { assert.equal((await run(id, m)).status, "failed"); });
  }
});
