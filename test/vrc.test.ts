// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { digestMultibase } from "../src/crypto/digest.ts";
import { runSuite } from "../src/runner/suite.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { FIXTURES, VECTORS } from "./helpers.ts";

const suite = loadSuite(VECTORS);
const today = "2026-11-13";
const vrcVectors = suite.files.filter((f) => f.file.group.startsWith("VRC-")).flatMap((f) => f.file.vectors);

describe("VRC-PRO and VRC-ISS vectors", () => {
  it("exist as two groups with their own families", () => {
    const groups = suite.files.filter((f) => f.file.group.startsWith("VRC-")).map((f) => [f.file.group, f.file.family]);
    assert.deepEqual(groups, [["VRC-PRO", "vrc-propose"], ["VRC-ISS", "vrc-issue"]]);
    assert.ok(vrcVectors.length >= 40);
  });
  it("every vector cites a specification file and line, and is capability gated", () => {
    for (const v of vrcVectors) {
      assert.ok(v.spec.some((s) => /(spec\.md|SPEC\.md|body\.md):\d+|payload[\w.-]*\.json/.test(s) || /^decision \d+/.test(s) || /^profile:/.test(s)), `${v.id}: ${JSON.stringify(v.spec)}`);
      assert.ok((v.requires ?? []).includes("optional:trigger.consent"), v.id);
      assert.ok((v.requires ?? []).some((r) => r.startsWith("https://trusttasks.org/spec/vrc/relationships/")), v.id);
    }
  });
  it("the profile rules and open questions are CLARIFY and never gate; the settled expectations are not", () => {
    const clarify = vrcVectors.filter((v) => v.clarify !== null).map((v) => v.id).sort();
    assert.deepEqual(clarify, [
      "VRC-ISS-003", "VRC-ISS-020", "VRC-ISS-021", "VRC-ISS-022", "VRC-ISS-023",
      "VRC-PRO-009", "VRC-PRO-010", "VRC-PRO-011", "VRC-PRO-016", "VRC-PRO-017", "VRC-PRO-018",
    ]);
    // Holds follow the framework: next-step is required (Tier 1), and signed at Tier 2. Neither is CLARIFY.
    for (const id of ["VRC-PRO-008", "VRC-PRO-019", "VRC-PRO-020", "VRC-PRO-021"]) assert.equal(vrcVectors.find((v) => v.id === id)!.clarify, null, id);
    assert.equal(vrcVectors.find((v) => v.id === "VRC-PRO-019")!.tier, 2);
    const byId = new Map(vrcVectors.map((v) => [v.id, v]));
    // The connection-DID rule (envelope issuer and proof under the connection DID) is a Tier 2 `attested` expectation, not a CLARIFY.
    for (const id of ["VRC-ISS-018", "VRC-ISS-019"]) {
      assert.equal(byId.get(id)!.tier, 2, id);
      assert.equal(byId.get(id)!.clarify, null, id);
    }
  });
  it("every negative vector names at least one mutant, including the settled ones", () => {
    for (const v of vrcVectors.filter((x) => x.clarify === null)) {
      const negative = v.steps.some((s) => ["error", "silence", "any-refusal"].includes(s.expect?.disposition ?? ""));
      if (negative) assert.ok((v.mutants ?? []).length > 0, v.id);
    }
  });
  it("tier 1: the reference passes every VRC vector it applies to", async () => {
    const run = await runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today, fixtureRoot: FIXTURES });
    const vrc = run.results.filter((r) => r.group.startsWith("VRC-"));
    assert.deepEqual(vrc.filter((r) => r.status === "FAIL"), []);
    assert.ok(vrc.filter((r) => r.status === "PASS").length >= 25);
    // Tier 2 vectors are not selected, and the CLARIFY ones report an observation.
    assert.ok(vrc.filter((r) => r.status === "CLARIFY" && /observed: pass/.test(r.reason ?? "")).length >= 8);
  });
  it("tier 2: the attested reference passes every VRC vector, including the signed next-step for a hold", async () => {
    const run = await runSuite({ adapter: new ReferenceAdapter({ attested: true }), suite, tier: 2, today, fixtureRoot: FIXTURES });
    const vrc = run.results.filter((r) => r.group.startsWith("VRC-"));
    assert.deepEqual(vrc.filter((r) => r.status === "FAIL"), []);
    assert.ok(vrc.filter((r) => r.tier === 2 && r.status === "PASS").length >= 5);
    assert.equal(vrc.find((r) => r.id === "VRC-PRO-019")!.status, "PASS");
  });
  it("an implementation that hosts neither task (VTI) gets SKIP for every VRC vector, not FAIL", async () => {
    for (const tier of [1, 2] as const) {
      const run = await runSuite({ adapter: new ReferenceAdapter({ vrc: false, attested: tier === 2 }), suite, tier, today, fixtureRoot: FIXTURES });
      const vrc = run.results.filter((r) => r.group.startsWith("VRC-"));
      // vectors outside the selected tier are recorded apart (excludedByTier), never as a result
      assert.equal(vrc.length + (run.excludedByTier ?? []).filter((e) => e.id.startsWith("VRC-")).length, vrcVectors.length);
      for (const r of vrc) {
        assert.equal(r.status, "SKIP", r.id);
        assert.match(r.reason ?? "", /type not declared|not selected|only runs at tier/, r.id);
      }
      assert.deepEqual(run.results.filter((r) => r.status === "FAIL"), []);
    }
  });
});

describe("reference ceremony behaviour", () => {
  it("digest has the framework DigestMultibase shape and depends only on the canonical form", () => {
    const d = digestMultibase({ b: 1, a: [2, { z: 1, y: 2 }] });
    assert.match(d, /^zQm[1-9A-HJ-NP-Za-km-z]+$/);
    assert.equal(d, digestMultibase({ a: [2, { y: 2, z: 1 }], b: 1 }));
    assert.notEqual(d, digestMultibase({ a: [2, { y: 2, z: 1 }], b: 2 }));
  });
  it("a hold is answered with a conformant next-step: originating type, resubmit, inResponseTo, same thread", async () => {
    for (const attested of [false, true]) {
      const run = await runSuite({ adapter: new ReferenceAdapter({ attested }), suite, tier: attested ? 2 : 1, today, fixtureRoot: FIXTURES });
      for (const id of ["VRC-PRO-008", "VRC-PRO-020", "VRC-PRO-021", "VRC-ISS-005"]) assert.equal(run.results.find((r) => r.id === id)!.status, "PASS", id);
    }
  });
  it("a silent hold fails VRC-PRO-008, and a malformed next-step fails on shape", async () => {
    for (const mutant of ["silentHold", "holdEmptyExpects", "holdNextStepOpenPayload"]) {
      const run = await runSuite({ adapter: new ReferenceAdapter({ mutants: [mutant] }), suite, tier: 1, today, fixtureRoot: FIXTURES });
      assert.equal(run.results.find((r) => r.id === "VRC-PRO-008")!.status, "FAIL", mutant);
    }
  });
  it("a consent for a proposal that is not held is an adapter error, not a reply", async () => {
    const a = new ReferenceAdapter();
    await assert.rejects(() => a.trigger("consent", { exchangeId: "urn:uuid:none", decision: "accept" }), /no held proposal/);
    await assert.rejects(() => a.trigger("policy", { propose: "maybe" }), /accept, decline or hold/);
  });
  it("advertises the VRC types and consent trigger only when it hosts them", async () => {
    const yes = await new ReferenceAdapter().capabilities();
    const no = await new ReferenceAdapter({ vrc: false }).capabilities();
    assert.ok(yes.supportedTypes.some((t) => t.includes("/vrc/relationships/propose/")) && yes.optional.includes("trigger.consent"));
    assert.ok(!no.supportedTypes.some((t) => t.includes("/vrc/")) && !no.optional.includes("trigger.consent"));
  });
});
