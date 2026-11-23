// SPDX-License-Identifier: Apache-2.0
// Engine additions of the vector review: expect.errorReply "should", silence with an allowed acknowledgement, requires "window:declared".
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SendParams, SendResult } from "../src/adapter/contract.ts";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { makeActors, runVector } from "../src/runner/engine.ts";
import type { EngineEnv } from "../src/runner/engine.ts";
import { gateReason } from "../src/runner/suite.ts";
import { PROFILE_WINDOW } from "../src/runner/window.ts";
import { loadSuite } from "../src/vectors/load.ts";
import type { Vector } from "../src/vectors/types.ts";
import { join } from "node:path";
import { FIXTURES, VECTORS } from "./helpers.ts";

const suite = loadSuite(VECTORS);
const plainSuite = loadSuite(join(VECTORS, "plain"));
const vectorOf = (id: string): { v: Vector; clock: string } => {
  for (const { file } of [...suite.files, ...plainSuite.files]) for (const v of file.vectors) if (v.id === id) return { v, clock: file.clock.start };
  throw new Error(`no vector ${id}`);
};

type Rewrite = (replies: string[], p: SendParams) => string[];
class Rewriting extends ReferenceAdapter {
  private readonly rewrite: Rewrite;
  constructor(rewrite: Rewrite) {
    super();
    this.rewrite = rewrite;
  }
  override async send(p: SendParams): Promise<SendResult> {
    const r = await super.send(p);
    return { ...r, replies: this.rewrite(r.replies, p) };
  }
}

async function run(adapter: ReferenceAdapter, v: Vector, clock: string, tier: 1 | 2 = 1) {
  const caps = await adapter.capabilities();
  const iut = (await adapter.provision(["iut"])).iut!;
  const env: EngineEnv = { caps, iutVid: iut.vid, actors: makeActors(), tier, fixtureRoot: FIXTURES, defaultClockStart: clock, window: PROFILE_WINDOW, salt: "" };
  return runVector(adapter, v, env);
}

describe("expect.errorReply: should", () => {
  const { v, clock } = vectorOf("ENV-009");
  const wrongCode = (replies: string[]): string[] => replies.map((r) => r.replace('"unsupportedType"', '"malformedRequest"'));

  it("the vector under test carries errorReply should and ENV-010 does not", () => {
    assert.equal(v.steps[0]!.expect!.errorReply, "should");
    assert.equal(vectorOf("ENV-010").v.steps.every((s) => s.expect?.errorReply === undefined), true);
  });
  it("a sent error reply with the right code passes with no advisory", async () => {
    const r = await run(new Rewriting((x) => x), v, clock);
    assert.deepEqual(r, { pass: true, failures: [], advisories: [] });
  });
  it("a missing reply passes with an advisory at Tier 1", async () => {
    const r = await run(new Rewriting(() => []), v, clock);
    assert.equal(r.pass, true);
    assert.equal(r.advisories.length, 1);
    assert.match(r.advisories[0]!, /no error response was returned/);
  });
  it("a sent reply with the wrong code still fails: the code stays checked", async () => {
    const r = await run(new Rewriting((x) => wrongCode(x)), v, clock);
    assert.equal(r.pass, false);
    assert.match(r.failures.join("\n"), /expected code unsupportedType, got malformedRequest/);
  });
  it("without errorReply a missing reply is a failure", async () => {
    const strict: Vector = { ...v, steps: v.steps.map((s) => ({ ...s, expect: { ...s.expect!, errorReply: undefined } })) };
    const r = await run(new Rewriting(() => []), strict, clock);
    assert.equal(r.pass, false);
    assert.match(r.failures.join("\n"), /expected one error, got 0 replies/);
  });
  it("on the attested profile (Tier 2) the missing reply is a failure", async () => {
    class Attested extends Rewriting {
      override async capabilities(): ReturnType<ReferenceAdapter["capabilities"]> {
        const c = await super.capabilities();
        return { ...c, optional: [...c.optional, "attested"] };
      }
    }
    const r = await run(new Attested(() => []), v, clock, 2);
    assert.equal(r.pass, false);
    assert.match(r.failures.join("\n"), /no error response was returned/);
  });
});

describe("expect.acknowledgement: allowed on silence (SPEC.md 4.4.2)", () => {
  const { v, clock } = vectorOf("CEX-001");
  const synthetic: Vector = { id: "ZZZ-001", title: "t", tier: 1, spec: ["x"], clarify: null, steps: [{ send: { template: "carrier.request" }, expect: { disposition: "silence", acknowledgement: "allowed" } }] } as unknown as Vector;
  const ack = (payload: unknown): Rewrite => (replies) => replies.map((r) => JSON.stringify({ ...JSON.parse(r), payload }));
  const wrongType: Rewrite = (replies) => replies.map((r) => JSON.stringify({ ...JSON.parse(r), type: "https://trusttasks.org/spec/conformance/other/0.1#response" }));

  it("CEX-001 allows the acknowledgement", () => {
    assert.equal(v.steps.find((s) => s.expect?.disposition === "silence")?.expect?.acknowledgement, "allowed");
  });
  it("silence passes", async () => {
    const r = await run(new Rewriting(() => []), synthetic, clock);
    assert.equal(r.pass, true);
  });
  it("one #response of the originating type with payload {} passes", async () => {
    const r = await run(new Rewriting(ack({})), synthetic, clock);
    assert.deepEqual(r.failures, []);
  });
  it("an acknowledgement with any payload content fails", async () => {
    const r = await run(new Rewriting(ack({ stored: true })), synthetic, clock);
    assert.match(r.failures.join("\n"), /payload must be exactly \{\}/);
  });
  it("a reply of another type fails", async () => {
    const r = await run(new Rewriting(wrongType), synthetic, clock);
    assert.match(r.failures.join("\n"), /expected silence or an empty acknowledgement/);
  });
  it("without acknowledgement allowed a reply is still a failure", async () => {
    const strict: Vector = { ...synthetic, steps: [{ ...synthetic.steps[0]!, expect: { disposition: "silence" } }] } as Vector;
    const r = await run(new Rewriting(ack({})), strict, clock);
    assert.match(r.failures.join("\n"), /expected silence, got 1 replies/);
  });
});

describe("requires window:declared", () => {
  it("DUP-005, TIME-101 and TIME-105 carry the gate", () => {
    for (const id of ["DUP-005", "TIME-101", "TIME-105"]) assert.ok(vectorOf(id).v.requires?.includes("window:declared"), id);
  });
  it("skips when neither the implementation nor the runner declares a window, never falling back to the profile pin", async () => {
    const { v } = vectorOf("TIME-101");
    const caps = { ...(await new ReferenceAdapter().capabilities()) };
    delete (caps as { window?: unknown }).window;
    assert.match(gateReason(v, caps, 1) ?? "", /window not declared/);
  });
  it("runs when the implementation declares a window, or the runner is given one", async () => {
    const { v } = vectorOf("TIME-101");
    const caps = { ...(await new ReferenceAdapter().capabilities()) };
    delete (caps as { window?: unknown }).window;
    assert.equal(gateReason(v, { ...caps, window: PROFILE_WINDOW }, 1), null);
    assert.equal(gateReason(v, caps, 1, { window: PROFILE_WINDOW }), null);
  });
});

describe("note sink on an attested run (SPEC.md:246, :1069, :388)", () => {
  const { v, clock } = vectorOf("PP-POL-047");
  const asMalformed: Rewrite = (replies) =>
    replies.map((r) => {
      const d = JSON.parse(r) as Record<string, unknown>;
      return JSON.stringify({ ...d, type: "https://trusttasks.org/spec/trust-task-error/0.1", payload: { code: "malformedRequest", retryable: false } });
    });
  class Attested extends Rewriting {
    override async capabilities(): ReturnType<ReferenceAdapter["capabilities"]> {
      const c = await super.capabilities();
      return { ...c, optional: [...c.optional, "attested"] };
    }
  }
  it("a malformedRequest to a schema-valid payload that admits ext is an advisory, also on attested", async () => {
    const r = await run(new Attested(asMalformed), v, clock, 2);
    // the rewritten reply is unsigned, which the attested profile rejects for its own reason; the refusal code must not be one
    assert.deepEqual(r.failures.filter((f) => !/tier 2: /.test(f)), []);
    assert.equal(r.advisories.filter((a) => /permitted where the consumer requires its own ext namespace/.test(a)).length, 1);
  });
  it("an envelope code is still a failure", async () => {
    const asEnvelope: Rewrite = (replies, p) => asMalformed(replies, p).map((r) => r.replace("malformedRequest", "proofInvalid"));
    const r = await run(new Attested(asEnvelope), v, clock, 2);
    assert.match(r.failures.join("\n"), /envelope or addressing code/);
  });
});
