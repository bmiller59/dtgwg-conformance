// SPDX-License-Identifier: Apache-2.0
// Review R10: the engine holds no-reply verdicts (silence, any-refusal, duplicate) to a minimum quiet period per binding (docs/04 section 3.3).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Capabilities, SendParams, SendResult } from "../src/adapter/contract.ts";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { makeActors, runVector } from "../src/runner/engine.ts";
import type { EngineEnv } from "../src/runner/engine.ts";
import { ASYNC_MIN_QUIET_MS, minimumQuiet, QUIET_NOT_ESTABLISHED, quietFailure, restsOnNoReply } from "../src/runner/quiet.ts";
import { runSuite } from "../src/runner/suite.ts";
import { PROFILE_WINDOW } from "../src/runner/window.ts";
import { loadSuite } from "../src/vectors/load.ts";
import type { Vector } from "../src/vectors/types.ts";
import { FIXTURES, VECTORS } from "./helpers.ts";

const suite = loadSuite(VECTORS);
const vectorOf = (id: string): { v: Vector; clock: string } => {
  for (const { file } of suite.files) for (const v of file.vectors) if (v.id === id) return { v, clock: file.clock.start };
  throw new Error(`no vector ${id}`);
};

/**
 * A fake asynchronous carrier: the reference's behaviour, declared as DIDComm only, and every reply after the first send swallowed
 * (the duplicate of DUP-001 then rests on no reply), each send reporting `quietMs` of observed quiet.
 */
class FakeDidcomm extends ReferenceAdapter {
  sends = 0;
  private readonly quietMs: number | undefined;
  private readonly bindingsDeclared: string[];
  constructor(quietMs: number | undefined, bindingsDeclared: string[] = ["didcomm", "didcomm-v1"]) {
    super();
    this.quietMs = quietMs;
    this.bindingsDeclared = bindingsDeclared;
  }
  override async capabilities(): Promise<Capabilities> {
    return { ...(await super.capabilities()), bindings: this.bindingsDeclared };
  }
  override async reset(): Promise<void> {
    this.sends = 0;
    await super.reset();
  }
  override async send(p: SendParams): Promise<SendResult> {
    const r = await super.send(p);
    this.sends++;
    return { ...r, replies: this.sends === 1 ? r.replies : [], quiescentAfterMs: this.quietMs as number };
  }
}

async function runDup(adapter: FakeDidcomm, quiet?: EngineEnv["quiet"]) {
  const { v, clock } = vectorOf("DUP-001");
  const caps = await adapter.capabilities();
  const iut = (await adapter.provision(["iut"])).iut!;
  const env: EngineEnv = { caps, iutVid: iut.vid, actors: makeActors(), tier: 1, fixtureRoot: FIXTURES, defaultClockStart: clock, window: PROFILE_WINDOW, salt: "", ...(quiet === undefined ? {} : { quiet }) };
  return runVector(adapter, v, env);
}

describe("minimum quiet period by binding", () => {
  it("is 0 over a synchronous binding (in-process, https), also when DIDComm is declared beside it", () => {
    assert.deepEqual(minimumQuiet({ bindings: ["in-process"] }), { minimumMs: 0, basis: "binding:in-process" });
    assert.deepEqual(minimumQuiet({ bindings: ["https"] }), { minimumMs: 0, basis: "binding:https" });
    assert.deepEqual(minimumQuiet({ bindings: ["in-process", "didcomm", "didcomm-v1", "didcomm-v2"] }), { minimumMs: 0, basis: "binding:in-process" });
  });
  it("is 1500 ms over DIDComm and over a binding the suite does not know", () => {
    assert.deepEqual(minimumQuiet({ bindings: ["didcomm", "didcomm-v2"] }), { minimumMs: ASYNC_MIN_QUIET_MS, basis: "binding:didcomm" });
    assert.deepEqual(minimumQuiet({ bindings: ["mqtt"] }), { minimumMs: 1500, basis: "binding:mqtt" });
    assert.deepEqual(minimumQuiet({ bindings: [] }), { minimumMs: 1500, basis: "binding:none declared" });
  });
  it("a runner override wins, and must be a non-negative number", () => {
    assert.deepEqual(minimumQuiet({ bindings: ["in-process"] }, 250), { minimumMs: 250, basis: "runner option" });
    assert.throws(() => minimumQuiet({ bindings: [] }, -1));
    assert.throws(() => minimumQuiet({ bindings: [] }, Number.NaN));
  });
});

describe("which verdicts rest on no reply", () => {
  it("silence, any-refusal and duplicate (with or without priorReplyLost) with no reply; never a step that got a reply", () => {
    for (const d of ["silence", "any-refusal", "duplicate"] as const) {
      assert.equal(restsOnNoReply({ disposition: d }, []), true, d);
      assert.equal(restsOnNoReply({ disposition: d }, ["{}"]), false, d);
    }
    assert.equal(restsOnNoReply({ disposition: "duplicate", priorReplyLost: true }, []), true);
    for (const d of ["response", "error", "next-step"] as const) assert.equal(restsOnNoReply({ disposition: d }, []), false, d);
  });
  it("a quiet period below the minimum, or none reported, is not established", () => {
    const q = { minimumMs: 1500, basis: "binding:didcomm" };
    assert.equal(quietFailure({ disposition: "silence" }, { replies: [], quiescentAfterMs: 1500 }, q), undefined);
    assert.match(quietFailure({ disposition: "silence" }, { replies: [], quiescentAfterMs: 40 }, q)!, /^QUIET-NOT-ESTABLISHED: silence not established: the adapter reported 40 ms of quiet, the minimum is 1500 ms \(binding:didcomm\)$/);
    assert.match(quietFailure({ disposition: "any-refusal" }, { replies: [], quiescentAfterMs: undefined as unknown as number }, q)!, /reported no quiet period/);
    assert.match(quietFailure({ disposition: "duplicate", priorReplyLost: true }, { replies: [], quiescentAfterMs: 3 }, q)!, /prior reply lost/);
    assert.equal(quietFailure({ disposition: "silence" }, { replies: ["{}"], quiescentAfterMs: 0 }, q), undefined);
  });
});

describe("the engine holds a no-reply verdict to the minimum", () => {
  it("a fake DIDComm adapter reporting too short a quiet period: the duplicate verdict is not established (FAIL, never PASS)", async () => {
    const out = await runDup(new FakeDidcomm(100));
    assert.equal(out.pass, false);
    assert.deepEqual(out.failures.filter((f) => f.includes(QUIET_NOT_ESTABLISHED)), [`step 2: ${QUIET_NOT_ESTABLISHED}: no reply to the duplicate not established: the adapter reported 100 ms of quiet, the minimum is 1500 ms (binding:didcomm)`]);
  });
  it("the same adapter reporting no quiet period at all also fails", async () => {
    const out = await runDup(new FakeDidcomm(undefined));
    assert.ok(out.failures.some((f) => f.includes("reported no quiet period")), JSON.stringify(out.failures));
  });
  it("a quiet period at the minimum establishes the verdict", async () => {
    const out = await runDup(new FakeDidcomm(ASYNC_MIN_QUIET_MS));
    assert.equal(out.pass, true, JSON.stringify(out.failures));
  });
  it("the same short quiet period passes over an in-process binding (minimum 0), and an explicit minimum overrides", async () => {
    assert.equal((await runDup(new FakeDidcomm(0, ["in-process"]))).pass, true);
    const out = await runDup(new FakeDidcomm(100, ["in-process"]), { minimumMs: 200, basis: "runner option" });
    assert.ok(out.failures.some((f) => f.includes("the minimum is 200 ms (runner option)")), JSON.stringify(out.failures));
  });
});

describe("the run records its quiet period", () => {
  it("SuiteRun.quietPeriod is the binding rule's value, or the runner option", async () => {
    const r = await runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today: "2026-11-13", fixtureRoot: FIXTURES, sleep: async () => undefined, channels: ["registry"] });
    assert.deepEqual(r.quietPeriod, { minimumMs: 0, basis: "binding:in-process" });
    assert.equal(r.results.filter((x) => x.status === "FAIL").length, 0);
    assert.ok(!r.results.some((x) => (x.failures ?? []).some((f) => f.includes(QUIET_NOT_ESTABLISHED))));
  });
});
