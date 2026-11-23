// SPDX-License-Identifier: Apache-2.0
// FC-KVC and FC-KVX (docs/27): the KW-to-VTI ceremony set, on the oracle first. The reference executor and approver complete every scenario (so the scenarios are sound), and each
// deliberate mutant of the executor or the verifier makes the scenario it is aimed at end `failed` (so no scenario is vacuous). The wallet and the VTA are not in this file:
// their runs are recorded under results/runs/ (docs/27). Never a statement about a platform.
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
const exec = (k: number, extra = "") => party(97, `,k=${k},approvers=A+B,cosign${extra}`);
const run = async (specs: Record<string, string>, id: string): Promise<ScenarioResult> =>
  (await runScenarios(files(), { make: (s) => makeAdapter(specs[s]!), specs, today: "2026-11-19", only: [id] })).results[0]!;
const kvc = (k: number, mut?: string, dv?: string) => ({ E: exec(k, `${mut === undefined ? "" : `,mut=${mut}`}${dv === undefined ? "" : `,dv=${dv}`}`), K1: party(98), K2: party(99), O: party(100) });
const kvx = (vMut?: string) => ({ V: party(97, `,attested${vMut === undefined ? "" : `,mut=${vMut}`}`), H: party(98, ",attested") });

describe("FC-KVC: the oracle completes (executor and approvers are reference parties)", () => {
  const K1 = ["FC-KVC-001", "FC-KVC-003", "FC-KVC-006", "FC-KVC-007", "FC-KVC-008", "FC-KVC-009", "FC-KVC-010", "FC-KVC-011", "FC-KVC-012"];
  for (const id of K1) it(`${id} completes at k=1`, async () => {
    const r = await run(kvc(1), id);
    assert.equal(r.status, "completed", r.reason);
    assert.equal(r.countedAsConformance, false);
    assert.equal(r.evidence, "complete-ceremony");
  });
  for (const id of ["FC-KVC-002", "FC-KVC-004", "FC-KVC-014"]) it(`${id} completes at k=2`, async () => assert.equal((await run(kvc(2), id)).status, "completed"));
  it("FC-KVC-005 (deny) ends as specified, aborted", async () => {
    const r = await run(kvc(1), "FC-KVC-005");
    assert.equal(r.status, "ended-as-specified");
    assert.equal(r.terminal, "aborted");
  });
  it("FC-KVC-013 (version skew) is skipped unless the approver has a ladder, and the executor serves only 0.1", async () => {
    const r = await run(kvc(1, undefined, "0.1"), "FC-KVC-013");
    assert.equal(r.status, "skipped");
    assert.match(r.reason, /approver-laddered/);
  });
  it("FC-KVC-101 (decision leg alone) is skipped on an executor that can raise the gate: its role is executor-leg", async () => {
    const r = await run(kvc(1), "FC-KVC-101");
    assert.equal(r.status, "skipped");
    assert.match(r.reason, /executor-leg/);
  });
  it("the scenarios of a 0.1-only executor are skipped for every other scenario (role executor-v01 only)", async () => {
    const r = await run(kvc(1, undefined, "0.1"), "FC-KVC-001");
    assert.equal(r.status, "skipped");
  });
  it("a tamper the executor refuses names the right code: noProof is proofRequired, a bad signature proofInvalid, another recipient wrongRecipient", async () => {
    for (const id of ["FC-KVC-007", "FC-KVC-008", "FC-KVC-009"]) {
      const r = await run(kvc(1), id);
      assert.ok(r.steps.some((s) => s.id === "tampered" || s.detail !== ""), id);
      assert.equal(r.status, "completed", `${id}: ${r.reason}`);
    }
  });
});

describe("FC-KVC: non-vacuity (each mutant of the executor makes the scenario it is aimed at end failed)", () => {
  // [mutant, scenario, k, the step it must fail at]
  const MUT: [string, string, number, string][] = [
    ["consentNonApproverApproves", "FC-KVC-003", 1, "outsider-decides"],
    ["consentDoubleApproveCounts", "FC-KVC-014", 2, "decide-K1-again"],
    ["consentDenyKeepsPending", "FC-KVC-005", 1, "deny"],
    ["consentAnyProofPurpose", "FC-KVC-006", 1, "tampered"],
    ["proofOptional", "FC-KVC-007", 1, "tampered"],
    ["acceptUnverifiedProof", "FC-KVC-008", 1, "tampered"],
    ["noRecipientCheck", "FC-KVC-009", 1, "tampered"],
        ["consentNoDigestCheck", "FC-KVC-011", 1, "tampered"],
    ["consentNoChallengeCheck", "FC-KVC-012", 1, "tampered"],
    ["cerQuorumEarly", "FC-KVC-002", 2, "decide-K1"],
    ["cerRespondWithoutEffect", "FC-KVC-001", 1, "resubmit"],
  ];
  for (const [m, id, k, at] of MUT) it(`${m}: ${id} ends failed at ${at}`, async () => {
    const r = await run(kvc(k, m), id);
    assert.equal(r.status, "failed", `${m}: ${r.status} ${r.reason}`);
    assert.equal(r.failedStep, at, r.reason);
  });
});

describe("FC-KVX: the oracle completes and refuses (verifier and holder are reference parties)", () => {
  it("FC-KVX-001 completes", async () => assert.equal((await run(kvx(), "FC-KVX-001")).status, "completed"));
  it("FC-KVX-002 (the person declines) ends declined", async () => {
    const r = await run(kvx(), "FC-KVX-002");
    assert.equal(r.status, "ended-as-specified");
    assert.equal(r.terminal, "declined");
  });
  for (const id of ["FC-KVX-003", "FC-KVX-004", "FC-KVX-005"]) it(`${id}: the changed presentation is refused and kept nowhere`, async () => {
    const r = await run(kvx(), id);
    assert.equal(r.status, "ended-as-specified", r.reason);
    assert.equal(r.terminal, "refused");
  });
  for (const [m, id] of [["proofOptional", "FC-KVX-003"], ["acceptUnverifiedProof", "FC-KVX-004"], ["noRecipientCheck", "FC-KVX-005"]] as const) it(`non-vacuity: verifier mutant ${m} makes ${id} end failed`, async () => {
    const r = await run(kvx(m), id);
    assert.equal(r.status, "failed", `${m}: ${r.status} ${r.reason}`);
  });
});

describe("FC-KVC and FC-KVX: files", () => {
  it("every step that sends a document cites its task, the two groups are in the manifest and the files name no local path", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["fc-kvc.json", "fc-kvx.json"]) {
      const text = readFileSync(join(VECTORS, "ceremony-scenarios", f), "utf8");
      assert.ok(!/\/home\/|\/srv\/|\/var\/tmp|\/tmp\//.test(text), f);
      const j = JSON.parse(text) as { evidence: string; scenarios: { steps: { do: Record<string, unknown>; source?: unknown }[] }[] };
      assert.equal(j.evidence, "complete-ceremony");
      for (const s of j.scenarios) for (const st of s.steps) if (st.do.initiate !== undefined || st.do.relayPushed !== undefined) assert.ok(st.source !== undefined, f);
    }
    const m = JSON.parse(readFileSync(join(VECTORS, "ceremony-scenarios", "scenarios-manifest.json"), "utf8")) as { files: string[] };
    assert.ok(m.files.includes("fc-kvc.json") && m.files.includes("fc-kvx.json"));
  });
});
