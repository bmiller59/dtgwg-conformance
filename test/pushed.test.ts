// SPDX-License-Identifier: Apache-2.0
// Pushed-document observation (docs/20): the reference passes CEX-033 to CEX-039, every mutant is caught, an adapter without the capability SKIPs.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PushedBox } from "../src/adapter/pushed.ts";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { validateVectorFile } from "../src/vectors/validate.ts";
import { runSuite } from "../src/runner/suite.ts";
import type { SuiteRun } from "../src/runner/suite.ts";
import type { Adapter, Capabilities } from "../src/adapter/contract.ts";
import { FIXTURES, VECTORS } from "./helpers.ts";

const suite = loadSuite(VECTORS);
const today = "2026-11-15";
const file = suite.files.find((f) => f.path.endsWith("dtg/cex-push.json"))!;
const ids = file.file.vectors.map((v) => v.id);
const only = (r: SuiteRun) => r.results.filter((x) => ids.includes(x.id));
const run = (adapter: Adapter): Promise<SuiteRun> => runSuite({ adapter, suite, tier: 1, today, fixtureRoot: FIXTURES, salt: "pushed" });

describe("pushed-document observation", () => {
  it("the new file is registered and holds CEX-033 to CEX-039 on the registry channel", () => {
    assert.deepEqual(ids, ["CEX-033", "CEX-034", "CEX-035", "CEX-036", "CEX-037", "CEX-038", "CEX-039"]);
    for (const v of file.file.vectors) {
      assert.equal(v.source?.channel, "registry", v.id);
      assert.ok((v.requires ?? []).includes("optional:observe.pushed"), v.id);
      assert.ok(v.spec.some((s) => /^specs\/credential-exchange\//.test(s)), v.id);
    }
  });

  it("the reference passes every pushed vector (CLARIFY ones observed to pass)", async () => {
    const r = only(await run(new ReferenceAdapter()));
    assert.equal(r.length, 7);
    assert.deepEqual(r.filter((x) => x.status === "FAIL"), []);
    assert.deepEqual(r.filter((x) => x.status === "PASS").map((x) => x.id), ["CEX-036", "CEX-038"]);
    for (const x of r.filter((y) => y.status === "CLARIFY")) assert.match(x.reason ?? "", /observed: pass/, x.id);
  });

  const mutantsOf = [...new Set(file.file.vectors.flatMap((v) => v.mutants ?? []))];
  it("names the four addressing mutants, the refusal mutant and the decline mutant", () => {
    assert.deepEqual(mutantsOf.sort(), ["noPush", "pushOnDecline", "pushOnRefusal", "pushedWrongRecipient", "pushedWrongThread", "pushedWrongType"]);
  });
  for (const v of file.file.vectors) {
    for (const m of v.mutants ?? []) {
      it(`${v.id} fails the mutant ${m}`, async () => {
        const r = only(await run(new ReferenceAdapter({ mutants: [m] }))).find((x) => x.id === v.id)!;
        // a CLARIFY vector reports the observation ("observed: fail"); a gating one FAILs
        assert.ok(r.status === "FAIL" || (r.status === "CLARIFY" && /observed: fail/.test(r.reason ?? "")), `${v.id} ${m}: ${r.status} ${r.reason ?? ""}`);
      });
    }
  }

  it("an adapter that does not declare observe.pushed gets SKIP, never PASS", async () => {
    const inner = new ReferenceAdapter();
    const bare: Adapter = Object.create(inner) as Adapter;
    bare.capabilities = async (): Promise<Capabilities> => {
      const c = await inner.capabilities();
      return { ...c, optional: c.optional.filter((o) => o !== "observe.pushed") };
    };
    const r = only(await run(bare));
    assert.equal(r.length, 7);
    for (const x of r) {
      assert.equal(x.status, "SKIP", x.id);
      assert.match(x.reason ?? "", /missing capability optional:observe\.pushed/);
    }
  });

  it("the step schema accepts observePushed and rejects bad shapes", () => {
    const bad = JSON.parse(JSON.stringify(file.file)) as typeof file.file;
    assert.deepEqual(validateVectorFile(bad), []);
    const step = bad.vectors[0]!.steps[1]!;
    step.observePushed = { type: "x", withinMs: 999999 };
    assert.ok(validateVectorFile(bad).some((e) => /withinMs/.test(e)));
    step.observePushed = {};
    assert.ok(validateVectorFile(bad).some((e) => /at least one of/.test(e)));
    step.observePushed = { to: "$A", none: true, count: 1 };
    assert.ok(validateVectorFile(bad).some((e) => /count/.test(e)));
  });

  it("PushedBox filters by recipient, type and thread, oldest first, and keeps the document verbatim", () => {
    const b = new PushedBox();
    const a = JSON.stringify({ id: "1", threadId: "t1", type: "x/1", recipient: "did:a" });
    b.record(a);
    b.record({ id: "2", type: "y/1", recipient: "did:b" });
    assert.deepEqual(b.query({ to: "did:a" }), [a]);
    assert.equal(b.observe({ threadId: "2" }).value, 1); // no threadId member: the id opens the thread
    assert.equal(b.observe({ type: "y/1", to: "did:a" }).value, 0);
    assert.equal(b.observe({}).documents?.length, 2);
    b.clear();
    assert.equal(b.observe({}).value, 0);
  });
});
