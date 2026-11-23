// SPDX-License-Identifier: Apache-2.0
// Essential governance E (decision 39, docs/04 sections 11.4 and 19): the per-declared-E ceremony vectors run against the reference
// adapter at any k the harness configures, SKIP with a specific reason where they cannot, and catch the quorum mutants at every k.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { runSuite } from "../src/runner/suite.ts";
import { makeActors } from "../src/runner/engine.ts";
import { resolveEssential, SET_OF_ONE, UNREADABLE } from "../src/runner/essential.ts";
import type { Capabilities } from "../src/adapter/contract.ts";
import type { VectorFile } from "../src/vectors/types.ts";
import { FIXTURES, VECTORS } from "./helpers.ts";

const today = "2026-11-15";
const full = loadSuite(VECTORS);
/** The ceremony vectors that are driven from E: the registry hold and duplicate rules and the per-declared-E vectors. */
const E_IDS = ["CER-001", "CER-002", "CER-005", "CER-015", "CER-017", "CER-018", "CER-019"];
const cer = { ...full, files: full.files.filter((f) => f.file.group === "CER").map((f) => ({ ...f, file: { ...f.file, vectors: f.file.vectors.filter((v) => E_IDS.includes(v.id)) } as VectorFile })) };
const CH = { channels: ["registry", "candidate"] as ("registry" | "candidate")[] };

async function run(opts: ConstructorParameters<typeof ReferenceAdapter>[0]): Promise<Record<string, { status: string; reason?: string; failures?: string[] }>> {
  const r = await runSuite({ adapter: new ReferenceAdapter(opts), suite: cer, tier: 1, today, fixtureRoot: FIXTURES, ...CH });
  return Object.fromEntries(r.results.map((x) => [x.id, x]));
}

const CONFIGS: { label: string; approvers: string[]; k: number }[] = [
  { label: "k=1 of 1", approvers: ["A"], k: 1 },
  { label: "k=1 of 3", approvers: ["A", "B", "C"], k: 1 },
  { label: "k=2 of 2 (default)", approvers: ["A", "X"], k: 2 },
  { label: "k=3 of 4", approvers: ["B", "C", "D", "F"], k: 3 },
  { label: "k=4 of 4", approvers: ["A", "X", "B", "C"], k: 4 },
];

describe("essential governance: the declaration", () => {
  it("an adapter that states nothing is unreadable (GOV-NOT-PROBED) and a fixed rule is GOV-FIXED", () => {
    const base = { name: "x", version: "0", tierMax: 1, bindings: [], supportedTypes: [], carriers: [], cryptosuites: [], optional: [], pins: { framework: "", error: "", binding: "" } } as Capabilities;
    const none = resolveEssential(base);
    assert.equal(none.readable, false);
    assert.equal(none.record.finding, "GOV-NOT-PROBED");
    const fixed = resolveEssential({ ...base, governance: { essential: { source: "fixed-rule", principals: [{ vid: "$A", role: "admin" }], consent: { task: "t", approverSet: "admin", minApprovals: 1, excludeRequester: false } } } }, makeActors());
    assert.equal(fixed.readable, true);
    assert.equal(fixed.record.finding, "GOV-FIXED");
    assert.equal(fixed.record.singleParty, true);
    const bad = resolveEssential({ ...base, governance: { essential: { source: "platform-config", principals: [{ vid: "$A", role: "admin" }], consent: { task: "t", approverSet: "admin", minApprovals: 2, excludeRequester: false } } } });
    assert.equal(bad.readable, false);
  });

  it("the reference declares its E (default: A and X, k = 2, from its own configuration)", async () => {
    const caps = await new ReferenceAdapter().capabilities();
    const r = resolveEssential(caps, makeActors());
    assert.equal(r.readable, true);
    assert.deepEqual(r.record.authority, ["$A", "$X"]);
    assert.equal(r.record.minApprovals, 2);
    assert.equal(r.record.source, "platform-config");
  });
});

describe("essential governance: per-declared-E vectors at any k", () => {
  for (const c of CONFIGS) {
    for (const proposerApproves of [true, false]) {
      it(`${c.label}, proposerApproves ${proposerApproves}: every vector passes or SKIPs with a specific reason`, async () => {
        const res = await run({ essential: { approvers: c.approvers, minApprovals: c.k }, proposerApproves });
        for (const id of E_IDS) {
          const r = res[id];
          assert.ok(r !== undefined, id);
          if (r.status === "SKIP") assert.match(r.reason ?? "", /^(authority set of one|declared minApprovals of one|implementation declares optional ceremony.status|missing capability optional:ceremony.status)/, `${id}: ${r.reason}`);
          else assert.equal(r.status, "PASS", `${id}: ${JSON.stringify(r.failures)}`);
        }
        // The per-declared-E vectors that need no second approver always run.
        assert.equal(res["CER-017"]!.status, "PASS");
        assert.equal(res["CER-018"]!.status, "PASS");
        if (c.approvers.length === 1) assert.equal(res["CER-019"]!.reason, SET_OF_ONE);
        else if (c.k >= 2) assert.equal(res["CER-019"]!.status, "PASS");
      });
    }
  }

  it("with E unreadable the per-declared-E vectors SKIP (authority set unreadable) and the registry ones keep the two-administrator scenario", async () => {
    const adapter = new ReferenceAdapter();
    const caps = await adapter.capabilities();
    delete caps.governance!.essential;
    const wrapped = Object.assign(Object.create(Object.getPrototypeOf(adapter) as object) as ReferenceAdapter, adapter, { capabilities: async () => caps });
    const r = await runSuite({ adapter: wrapped, suite: cer, tier: 1, today, fixtureRoot: FIXTURES, ...CH });
    const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
    for (const id of ["CER-017", "CER-018", "CER-019"]) {
      assert.equal(by[id]!.status, "SKIP", id);
      assert.ok(by[id]!.reason!.startsWith(UNREADABLE), by[id]!.reason);
    }
    for (const id of ["CER-001", "CER-005"]) assert.equal(by[id]!.status, "PASS", id);
  });
});

describe("essential governance: non-vacuity at any k", () => {
  const MUTANTS: Record<string, string> = { cerQuorumEarly: "CER-017", cerQuorumLate: "CER-017", cerNonAdminApproves: "CER-018", cerDoubleApproveCountsTwice: "CER-019" };
  for (const c of CONFIGS.filter((x) => x.k >= 2)) {
    for (const [m, id] of Object.entries(MUTANTS)) {
      it(`${c.label}: ${id} catches ${m}`, async () => {
        const res = await run({ essential: { approvers: c.approvers, minApprovals: c.k }, mutants: [m] });
        assert.equal(res[id]!.status, "FAIL", `${m} at ${c.label}: ${res[id]!.status}`);
      });
    }
  }
  it("k=1: CER-017 catches the late mutant and CER-018 the outsider mutant", async () => {
    const late = await run({ essential: { approvers: ["A", "B"], minApprovals: 1 }, proposerApproves: false, mutants: ["cerQuorumLate"] });
    assert.equal(late["CER-017"]!.status, "FAIL");
    const out = await run({ essential: { approvers: ["A", "B"], minApprovals: 1 }, proposerApproves: false, mutants: ["cerNonAdminApproves"] });
    assert.equal(out["CER-018"]!.status, "FAIL");
  });
});

describe("essential governance: the task-consent family is driven from E", () => {
  const tcSuite = { ...full, files: full.files.filter((f) => f.file.group === "TC") };
  const TC_PENDING = ["TC-001", "TC-002", "TC-003", "TC-004", "TC-005", "TC-006", "TC-007", "TC-008", "TC-009", "TC-010", "TC-011", "TC-018"];
  for (const c of CONFIGS) {
    for (const proposerApproves of [true, false]) {
      it(`${c.label}, proposerApproves ${proposerApproves}: no failure; a SKIP names the essential-governance reason`, async () => {
        const r = await runSuite({ adapter: new ReferenceAdapter({ essential: { approvers: c.approvers, minApprovals: c.k }, proposerApproves }), suite: tcSuite, tier: 1, today, fixtureRoot: FIXTURES, channels: ["registry", "proposed", "candidate"] });
        const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
        for (const id of TC_PENDING) {
          const x = by[id]!;
          assert.ok(x !== undefined, id);
          assert.notEqual(x.status, "FAIL", `${id}: ${JSON.stringify(x.failures)}`);
          if (x.status === "SKIP") assert.match(x.reason ?? "", /^(authority set of one|declared minApprovals of one)/, `${id}: ${x.reason}`);
        }
        // Held one short of k: the begin must be held, so k = 1 with a counted begin leaves nothing to decide.
        const runs = !(c.k === 1 && proposerApproves);
        assert.equal(by["TC-001"]!.status === "SKIP", !runs, `TC-001 ${by["TC-001"]!.status}`);
        assert.equal(by["TC-018"]!.status === "SKIP", !runs || c.k < 2, `TC-018 ${by["TC-018"]!.status}`);
      });
    }
  }
});
