// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dispatch, RPC_METHODS } from "../src/adapter/contract.ts";
import { ReferenceAdapter, CARRIER_TYPE } from "../src/adapters/reference/reference.ts";
import { MUTANTS } from "../src/adapters/reference/mutants.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { checkNonVacuity, runSuite } from "../src/runner/suite.ts";
import { join } from "node:path";
import { FIXTURES, VECTORS } from "./helpers.ts";

const suite = loadSuite(VECTORS);
const today = "2026-11-13";

describe("reference adapter passes every applicable vector", () => {
  it("tier 1 (framework consumer behaviour)", async () => {
    const run = await runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today, fixtureRoot: FIXTURES });
    const fails = run.results.filter((r) => r.status === "FAIL");
    assert.deepEqual(fails, []);
    assert.ok(run.results.filter((r) => r.status === "PASS").length >= 90);
  });
  it("tier 2 (attested profile) on the attested reference, including every tier 1 vector it can take", async () => {
    // every channel: the ceremony-design vectors (proposed, decision 39) include tier 2 ones
    const run = await runSuite({ adapter: new ReferenceAdapter({ attested: true }), suite, tier: 2, today, fixtureRoot: FIXTURES, channels: ["registry", "proposed", "candidate"] });
    assert.deepEqual(run.results.filter((r) => r.status === "FAIL"), []);
    const tier2 = run.results.filter((r) => r.tier === 2);
    // Every tier 2 vector must pass on the attested reference, except those that need what it does not have: a server that is not
    // attested (the unsigned fixture rows) and the P-384 cryptosuite.
    assert.ok(tier2.length >= 50);
    for (const r of tier2) assert.ok(r.status === "PASS" || (r.status === "CLARIFY" && /\(observed: pass\)$/.test(r.reason ?? "")) || (r.status === "SKIP" && /declares optional attested|missing capability cryptosuite/.test(r.reason ?? "")), `${r.id} ${r.status} ${r.reason ?? ""}`);
    assert.deepEqual(run.results.filter((r) => (r.advisories ?? []).length > 0), []);
  });
  it("the non-attested reference skips the attested sub-group rather than passing it, and is measured against the named profile sub-groups", async () => {
    const run = await runSuite({ adapter: new ReferenceAdapter(), suite, tier: 2, today, fixtureRoot: FIXTURES, channels: ["registry", "proposed", "candidate"] });
    for (const r of run.results.filter((x) => x.subgroup === "attested")) assert.equal(r.status, "SKIP", r.id);
    const profile = run.results.filter((x) => x.subgroup !== undefined && x.subgroup !== "attested");
    assert.ok(profile.length >= 35);
    for (const r of profile) assert.ok(r.status === "PASS" || (r.status === "CLARIFY" && /\(observed: pass\)$/.test(r.reason ?? "")) || (r.status === "SKIP" && /missing capability cryptosuite/.test(r.reason ?? "")), `${r.id} ${r.status} ${r.reason ?? ""}`);
  });
});

describe("non-vacuity: every negative vector fails the mutants it names", () => {
  it("catches every declared mutant", async () => {
    const rows = await checkNonVacuity(suite, FIXTURES);
    assert.ok(rows.length >= 90);
    assert.deepEqual(rows.filter((r) => !r.caught), []);
  });
  it("every mutant is used by at least one vector", () => {
    const plain = loadSuite(join(VECTORS, "plain"));
    const emitSuite = loadSuite(join(VECTORS, "emit"));
    const witness = loadSuite(join(VECTORS, "witness"));
    const twoL = loadSuite(join(VECTORS, "2l"));
    const complete = loadSuite(join(VECTORS, "complete"));
    const used = new Set([...suite.files, ...plain.files, ...emitSuite.files, ...witness.files, ...twoL.files, ...complete.files].flatMap((f) => f.file.vectors.flatMap((v) => [...(v.mutants ?? []), ...(v.advisoryMutants ?? [])])));
    for (const m of Object.keys(MUTANTS)) assert.ok(used.has(m), `unused mutant ${m}`);
  });
  it("every negative vector names a mutant", () => {
    for (const { file } of suite.files) {
      for (const v of file.vectors) {
        const negative = v.steps.some((s) => ["error", "silence", "any-refusal"].includes(s.expect?.disposition ?? "") || s.verifyProof?.expect === "invalid");
        if (negative) assert.ok((v.mutants ?? []).length + (v.advisoryMutants ?? []).length > 0, v.id);
      }
    }
  });
  it("a whole mutant run through the runner reports FAIL", async () => {
    const run = await runSuite({ adapter: new ReferenceAdapter({ mutants: ["noRecipientCheck"] }), suite, tier: 1, today, fixtureRoot: FIXTURES });
    assert.equal(run.results.find((r) => r.id === "ID-001")?.status, "FAIL");
  });
});

describe("JSON-RPC surface", () => {
  it("serves capabilities and rejects unknown methods", async () => {
    const a = new ReferenceAdapter({ attested: true });
    const ok = await dispatch(a, { jsonrpc: "2.0", id: 1, method: "capabilities" });
    assert.ok("result" in ok && (ok.result as { tierMax: number }).tierMax === 2);
    assert.deepEqual((ok as { result: { carriers: { typeUri: string }[] } }).result.carriers.map((c) => c.typeUri), [CARRIER_TYPE]);
    const bad = await dispatch(a, { jsonrpc: "2.0", id: 2, method: "nope" });
    assert.ok("error" in bad && bad.error.code === -32601);
    for (const m of RPC_METHODS) assert.equal(typeof (a as unknown as Record<string, unknown>)[m], "function", m);
  });
  it("send returns bytes and observe reports state", async () => {
    const a = new ReferenceAdapter();
    const iut = (await a.provision(["iut"])).iut!;
    await a.setClock("2026-11-12T10:00:00Z");
    const doc = { id: "urn:uuid:7", type: CARRIER_TYPE, issuer: "did:web:peer.example", recipient: iut.vid, issuedAt: "2026-11-12T10:00:00Z", payload: { subject: "s" } };
    const res = await dispatch(a, { jsonrpc: "2.0", id: 3, method: "send", params: { from: { kind: "none" }, bytes: JSON.stringify(doc) } });
    assert.ok("result" in res);
    assert.equal((res as { result: { replies: string[] } }).result.replies.length, 1);
    assert.equal((await a.observe({ query: "handled" })).value, 1);
    assert.equal((await a.observe({ query: "documentState", id: "urn:uuid:7" })).value, "responded");
  });
});
