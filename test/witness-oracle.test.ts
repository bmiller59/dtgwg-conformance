// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { MUTANTS } from "../src/adapters/reference/mutants.ts";
import { WITNESS_DISCOVERY_TYPE, WITNESS_DISCOVERY_TYPE_01, WITNESS_SESSION_TYPE, WITNESS_SESSION_TYPE_01, WITNESS_SUBMIT_TYPE, WITNESS_SUBMIT_TYPE_01 } from "../src/adapters/reference/witness-oracle.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { checkNonVacuity, runSuite } from "../src/runner/suite.ts";
import { FIXTURES, VECTORS } from "./helpers.ts";

const DIR = join(VECTORS, "witness");
const suite = loadSuite(DIR);
const all = suite.files.flatMap((f) => f.file.vectors);
const today = "2026-11-15";
const oracle = (mutants: string[] = []): ReferenceAdapter => new ReferenceAdapter({ witness: true, vrc: false, ceremony: false, dtg: false, plain: false, name: "reference-witness", mutants });

describe("witness oracle (docs/13 section 6)", () => {
  it("the manifest no longer declares pending-oracle, so the loader's mutant-declaration check applies", () => {
    assert.equal((JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as { nonVacuity?: string }).nonVacuity, undefined);
    assert.equal(all.length, 28);
  });
  it("passes all 28 witness vectors (the 3 CLARIFY vectors are observed to pass)", async () => {
    const run = await runSuite({ adapter: oracle(), suite, tier: 1, today, fixtureRoot: FIXTURES });
    assert.equal(run.results.length, 28);
    assert.deepEqual(run.results.filter((r) => r.status === "FAIL" || r.status === "SKIP"), []);
    assert.equal(run.results.filter((r) => r.status === "PASS").length, 25);
    const clarify = run.results.filter((r) => r.status === "CLARIFY");
    assert.deepEqual(clarify.map((r) => r.id).sort(), ["WSB-004", "WSB-007", "WSD-009"]);
    for (const r of clarify) assert.match(r.reason ?? "", /observed: pass/, r.id);
  });
  it("the default reference skips the witness vectors (no didcomm binding) and its registry is unchanged", async () => {
    const caps = await new ReferenceAdapter().capabilities();
    assert.ok(!caps.bindings.some((b) => b.startsWith("didcomm")));
    // the default reference now serves witness/session and witness/session/submit for the WIT group (docs/29); these WSD, WSS and WSB vectors need a DIDComm binding the default reference lacks, so they still skip
    const run = await runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today, fixtureRoot: FIXTURES });
    assert.ok(run.results.every((r) => r.status === "SKIP"));
  });
  it("targets the latest versions (discovery 0.4, session 0.2, submit 0.2): every vector sends and expects them, and the oracle serves 0.1 only as the older version", async () => {
    for (const v of all) {
      const text = JSON.stringify(v.steps);
      assert.ok(!/(trust-task-discovery|witness\/session(\/submit)?)\/0\.1\b/.test(text), `${v.id} sends or expects a 0.1 type`);
      assert.ok(v.spec.every((c) => !/specs\/(trust-task-discovery|witness\/session(\/submit)?)\/0\.1\//.test(c)), `${v.id} cites a 0.1 text`);
      assert.ok(v.source?.version === "0.2" || v.source?.version === "0.4" || v.source?.slug === "trust-task-framework", `${v.id} source version ${v.source?.version}`);
    }
    const caps = await oracle().capabilities();
    assert.deepEqual(caps.supportedTypes.filter((t) => /\/0\.4$|\/0\.2$/.test(t)).sort(), [WITNESS_DISCOVERY_TYPE, WITNESS_SESSION_TYPE, WITNESS_SUBMIT_TYPE].sort());
    assert.ok(caps.supportedTypes.includes(WITNESS_SESSION_TYPE_01) && caps.supportedTypes.includes(WITNESS_SUBMIT_TYPE_01) && caps.supportedTypes.includes(WITNESS_DISCOVERY_TYPE_01));
  });
  it("every declared mutant makes its vector fail", async () => {
    const rows = await checkNonVacuity(suite, FIXTURES);
    const declared = all.reduce((n, v) => n + (v.mutants ?? []).length, 0);
    assert.equal(rows.length, declared);
    assert.equal(declared, 32);
    assert.deepEqual(rows.filter((r) => !r.caught), []);
  });
  it("every negative vector names a mutant, so none needs a blanket skip", () => {
    for (const v of all) {
      const negative = v.steps.some((s) => ["error", "silence", "any-refusal"].includes(s.expect?.disposition ?? ""));
      if (negative) assert.ok((v.mutants ?? []).length > 0, v.id);
    }
  });
  it("every witness mutant is used by a witness vector", () => {
    const used = new Set(all.flatMap((v) => v.mutants ?? []));
    for (const m of Object.keys(MUTANTS).filter((k) => k.startsWith("witness"))) assert.ok(used.has(m), m);
  });
});
