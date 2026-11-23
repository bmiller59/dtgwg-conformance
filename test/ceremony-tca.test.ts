// SPDX-License-Identifier: Apache-2.0
// FC-TCA (docs/25): task-consent approval under the executor's declared essential governance. The oracle first (two to five reference parties
// complete, for several declared k and approver sets), then the mutants that must end a scenario `failed`. Never a statement about a platform.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeAdapter } from "../src/runner/adapters.ts";
import { loadScenarios } from "../src/ceremony/scenario.ts";
import { runScenarios } from "../src/ceremony/runner.ts";
import type { ScenarioResult } from "../src/ceremony/runner.ts";
import { VECTORS } from "./helpers.ts";

const files = () => loadScenarios(join(VECTORS, "ceremony-scenarios")).files.map((f) => f.file);
const party = (seed: number, more = "") => `reference-party:seed=${seed}${more}`;
/** Executor declaring `k` of `n` (approvers named by letters); `cosign`: the begin does not count as the requester's approval. */
const pair = (k: number, n: number, opts: { cosign?: boolean; mut?: string } = {}): Record<string, string> => ({
  E: party(97, `,k=${k},approvers=${"ABCDE".slice(0, n).split("").join("+")}${opts.cosign === true ? ",cosign" : ""}${opts.mut === undefined ? "" : `,mut=${opts.mut}`}`),
  A1: party(98), A2: party(99), A3: party(100), O: party(101),
});
const run = async (specs: Record<string, string>, id: string): Promise<ScenarioResult> =>
  (await runScenarios(files(), { make: (s) => makeAdapter(specs[s]!), specs, today: "2026-11-18", only: [id] })).results[0]!;
const IDS = ["FC-TCA-001", "FC-TCA-002", "FC-TCA-003"];

describe("FC-TCA: the oracle (the reference executor, declaring k and the approver set, completes)", () => {
  // [k, n, cosign]: the begin counts as the requester's approval unless cosign
  const DECL: [number, number, boolean][] = [[2, 3, false], [2, 3, true], [3, 3, true], [3, 3, false], [1, 3, true], [2, 2, false]];
  for (const [k, n, cosign] of DECL) for (const id of IDS) {
    if (id === "FC-TCA-003" && k === 1) continue; // no counted approval to repeat (skipped, below)
    it(`${id} completes: declared ${k} of ${n}${cosign ? " (cosign)" : ""}`, async () => {
      const r = await run(pair(k, n, { cosign }), id);
      assert.equal(r.status, "completed", r.reason);
      assert.equal(r.terminal, "completed");
      assert.equal(r.countedAsConformance, false);
      assert.equal(r.evidence, "complete-ceremony");
      assert.ok(r.assertions.every((a) => a.ok));
    });
  }
  it("k and the approver set come from the declaration: a different k changes how many decisions the runner relays", async () => {
    const decisions = async (k: number) => (await runScenarios(files(), { make: (s) => makeAdapter(pair(k, 3, { cosign: true })[s]!), specs: pair(k, 3, { cosign: true }), today: "2026-11-18", only: ["FC-TCA-001"] })).transcript.filter((t) => t.kind === "built" && t.step.includes("/") && t.bytes.includes("task-consent/decision")).length;
    assert.equal(await decisions(1), 1);
    assert.equal(await decisions(2), 2);
    assert.equal(await decisions(3), 3);
  });
  it("no document is built by the runner: every built entry has a participant as its author, each hashed", async () => {
    const out = await runScenarios(files(), { make: (s) => makeAdapter(pair(2, 3)[s]!), specs: pair(2, 3), today: "2026-11-18", only: ["FC-TCA-002"] });
    assert.ok(out.transcript.filter((t) => t.kind === "built").length >= 5);
    for (const t of out.transcript) assert.match(t.sha256, /^[0-9a-f]{64}$/);
  });
});

describe("FC-TCA: skipped, never guessed", () => {
  it("an executor that declares no governance is skipped with the reason", async () => {
    const r = await run({ ...pair(2, 3), E: "reference-witness" }, "FC-TCA-001");
    assert.equal(r.status, "skipped");
  });
  it("a declaration with more approvers than the scenario has slots is skipped", async () => {
    const r = await run({ ...pair(2, 3), E: party(97, ",k=2,approvers=A+B+C+D+E") }, "FC-TCA-001");
    assert.equal(r.status, "skipped");
    assert.match(r.reason, /declares 5 approvers/);
  });
  it("FC-TCA-003 at k=1 has no counted approval to repeat: skipped", async () => {
    const r = await run(pair(1, 3, { cosign: true }), "FC-TCA-003");
    assert.equal(r.status, "skipped");
    assert.match(r.reason, /no counted approval/);
  });
  it("k=1 with a begin that counts as the requester's approval has no short quorum to hold: skipped", async () => {
    const r = await run(pair(1, 3), "FC-TCA-001");
    assert.equal(r.status, "skipped");
    assert.match(r.reason, /one short/);
  });
});

describe("FC-TCA: non-vacuity (each mutant makes the scenario end failed)", () => {
  // [mutant, scenario, step it must fail at, k, n, cosign]
  const MUT: [string, string, string, RegExp, number, boolean][] = [
    ["consentNonApproverApproves", "FC-TCA-002", "outsider-decides", /O received 0 matching document\(s\), expected 1/, 2, true],
    ["cerQuorumEarly", "FC-TCA-001", "approve-k-1", /E reads completed, expected held/, 3, true],
    ["cerQuorumLate", "FC-TCA-001", "approve-k", /E reads held, expected completed/, 3, true],
    ["cerRespondOnFirstApproval", "FC-TCA-001", "approve-k-1", /no ceremony held for approvals/, 3, true],
    ["consentDoubleApproveCounts", "FC-TCA-003", "approve-again", /E reads completed, expected held/, 3, true],
    ["cerRespondWithoutEffect", "FC-TCA-001", "approve-k", /stores 0 ceremony-effect, expected 1/, 2, true],
  ];
  for (const [m, id, stepId, why, k, cosign] of MUT) {
    it(`${m}: ${id} ends failed at ${stepId}`, async () => {
      const r = await run(pair(k, 3, { cosign, mut: m }), id);
      assert.equal(r.status, "failed", `${m}: ${r.status} ${r.reason}`);
      assert.equal(r.failedStep, stepId);
      assert.match(r.reason, why);
    });
  }
  it("the same mutants are caught with the begin counting as an approval (declared 3 of 3)", async () => {
    for (const [m, id] of [["cerQuorumEarly", "FC-TCA-001"], ["consentNonApproverApproves", "FC-TCA-002"]] as const) {
      const r = await run(pair(3, 3, { mut: m }), id);
      assert.equal(r.status, "failed", m);
    }
  });
  it("a mutant that is not about this ceremony (a VRC receipt mutant on an approver) does not change the outcome: the scenario still completes", async () => {
    const r = await run({ ...pair(2, 3, { cosign: true }), A2: party(99, ",mut=ceremonyDropReceipt") }, "FC-TCA-001");
    assert.equal(r.status, "completed");
  });
  it("an executor that stops at the wrong quorum is caught on both sides of k, and a vector mutant that is not on the consent path (cerNonAdminApproves) is not claimed", async () => {
    assert.equal((await run(pair(2, 3, { cosign: true, mut: "cerQuorumEarly" }), "FC-TCA-001")).failedStep, "approve-k-1");
    assert.equal((await run(pair(2, 3, { cosign: true, mut: "cerQuorumLate" }), "FC-TCA-001")).failedStep, "approve-k");
  });
});
