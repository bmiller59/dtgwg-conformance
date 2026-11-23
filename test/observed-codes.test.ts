// SPDX-License-Identifier: Apache-2.0
// Which error code a PASS observed (decision CV-13 follow-up): a vector that accepts the task's own code or permissionDenied records the
// code seen per error step, and `acceptedOnlyGate` when every such step passed on permissionDenied alone. Informational and advisory-only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SendParams, SendResult } from "../src/adapter/contract.ts";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { makeActors, runVector } from "../src/runner/engine.ts";
import type { EngineEnv } from "../src/runner/engine.ts";
import { runSuite } from "../src/runner/suite.ts";
import { PROFILE_WINDOW } from "../src/runner/window.ts";
import { loadSuite } from "../src/vectors/load.ts";
import type { Vector } from "../src/vectors/types.ts";
import { FIXTURES, VECTORS } from "./helpers.ts";

const suite = loadSuite(VECTORS);
const find = (id: string): { v: Vector; clock: string } => {
  for (const { file } of suite.files) for (const v of file.vectors) if (v.id === id) return { v, clock: file.clock.start };
  throw new Error(`no vector ${id}`);
};

class Rewriting extends ReferenceAdapter {
  private readonly from: string; private readonly to: string;
  constructor(from: string, to: string) { super(); this.from = from; this.to = to; }
  override async send(p: SendParams): Promise<SendResult> {
    const r = await super.send(p);
    return { ...r, replies: r.replies.map((x) => x.replace(`"${this.from}"`, `"${this.to}"`)) };
  }
}
async function run(adapter: ReferenceAdapter, v: Vector, clock: string) {
  const caps = await adapter.capabilities();
  const iut = (await adapter.provision(["iut"])).iut!;
  const env: EngineEnv = { caps, iutVid: iut.vid, actors: makeActors(), tier: 1, fixtureRoot: FIXTURES, defaultClockStart: clock, window: PROFILE_WINDOW, salt: "" };
  return runVector(adapter, v, env);
}
/** ENV-009 (an unsupported type is refused) with its accepted code list widened to the task's own code or permissionDenied. */
const twoCodes = (): { v: Vector; clock: string } => {
  const { v, clock } = find("ENV-009");
  const steps = v.steps.map((s) => (s.expect?.disposition === "error" ? { ...s, expect: { ...s.expect, code: ["unsupportedType", "permissionDenied"] } } : s));
  return { v: { ...v, steps }, clock };
};

describe("observed error codes", () => {
  it("the task's own code passes, and the outcome records it and no gate flag", async () => {
    const { v, clock } = twoCodes();
    const r = await run(new Rewriting("unsupportedType", "unsupportedType"), v, clock);
    assert.equal(r.pass, true);
    assert.deepEqual(r.observedCodes, ["unsupportedType"]);
    assert.equal(r.acceptedOnlyGate, undefined);
  });
  it("permissionDenied passes too, and the outcome says it was the gate only", async () => {
    const { v, clock } = twoCodes();
    const r = await run(new Rewriting("unsupportedType", "permissionDenied"), v, clock);
    assert.equal(r.pass, true);
    assert.deepEqual(r.observedCodes, ["permissionDenied"]);
    assert.equal(r.acceptedOnlyGate, true);
  });
  it("a code outside the list still fails", async () => {
    const { v, clock } = twoCodes();
    const r = await run(new Rewriting("unsupportedType", "malformedRequest"), v, clock);
    assert.equal(r.pass, false);
    assert.equal(r.acceptedOnlyGate, undefined);
  });
  it("a vector whose list holds no permissionDenied alongside a task code records nothing (registry outcomes unchanged)", async () => {
    const { v, clock } = find("ENV-009");
    const r = await run(new Rewriting("unsupportedType", "unsupportedType"), v, clock);
    assert.deepEqual(r, { pass: true, failures: [], advisories: [] });
  });
  it("a registry result row never carries the fields; an advisory (proposed) row does, from the suite", async () => {
    const reg = await runSuite({ adapter: new Rewriting("unsupportedType", "permissionDenied"), suite, tier: 1, exceptions: [], today: "2026-11-18", fixtureRoot: FIXTURES });
    assert.deepEqual(reg.results.filter((x) => "observedCodes" in x || "acceptedOnlyGate" in x), []);
    const cov = loadSuite(`${VECTORS}/coverage`);
    const adv = await runSuite({ adapter: new ReferenceAdapter(), suite: cov, tier: 1, exceptions: [], today: "2026-11-18", fixtureRoot: FIXTURES, channels: ["proposed", "candidate"] });
    const withCodes = adv.results.filter((x) => x.status === "PASS" && x.observedCodes !== undefined);
    assert.ok(withCodes.length > 100, String(withCodes.length));
    assert.ok(withCodes.every((x) => x.channel !== "registry" && x.observedCodes!.length > 0));
    assert.ok(withCodes.some((x) => x.acceptedOnlyGate !== true));
  });
});
