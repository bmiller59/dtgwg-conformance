// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { notOfferedReason, reclassify } from "../src/ceremony/reclassify.ts";
import { NOT_OFFERED } from "../src/ceremony/runner.ts";
import { loadScenarios } from "../src/ceremony/scenario.ts";
import { runScenarios } from "../src/ceremony/runner.ts";
import { makeAdapter } from "../src/runner/adapters.ts";
import { join } from "node:path";

describe("not offered by the row is skipped, never failed (D528)", () => {
  it("reclassify maps the three class D failures of the first wire records and leaves a real failure alone", () => {
    const wire = { K: { mode: "wire: real" } };
    const out = reclassify({
      results: [
        { id: "A", status: "failed", reason: `participant error: ${NOT_OFFERED} a tampered (noProof) decision (x)`, participants: wire },
        { id: "B", status: "failed", reason: "participant error: the wire participant has no trigger clockOffset (a real wire has real time)", participants: wire },
        { id: "C", status: "failed", reason: "step apply built no document 1 to replay", participants: wire },
        { id: "D", status: "failed", reason: "step apply built no document 1 to replay", participants: { K: {} } },
        { id: "E", status: "failed", reason: "participant error: the community answered 500", participants: wire },
        { id: "F", status: "completed", reason: "", participants: wire },
      ],
    });
    assert.deepEqual(out.results.map((r) => r.status), ["skipped", "skipped", "skipped", "failed", "failed", "completed"]);
    assert.ok(out.results.slice(0, 3).every((r) => r.reason.startsWith(NOT_OFFERED)));
    assert.deepEqual(out.reclassified, [{ id: "A", from: "failed" }, { id: "B", from: "failed" }, { id: "C", from: "failed" }]);
    assert.equal(notOfferedReason("participant error: boom", true), null);
  });

  it("the runner records a step an adapter says it does not offer as skipped with that reason", async () => {
    const files = loadScenarios(join(import.meta.dirname, "..", "vectors", "ceremony-scenarios")).files.map((f) => f.file);
    const specs = { K: "reference-joiner", V: "reference-community" };
    const make = async (slot: string): Promise<Awaited<ReturnType<typeof makeAdapter>>> => {
      const a = await makeAdapter(specs[slot as "K" | "V"]);
      if (slot !== "K") return a;
      return new Proxy(a, { get: (t, k) => {
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        if (k === "initiate") return async () => { throw new Error(`${NOT_OFFERED} a thing the wire cannot do`); };
        return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      } });
    };
    const out = await runScenarios(files, { make, specs, today: "2026-11-20", only: ["FC-MBR-002"] });
    assert.equal(out.results[0]!.status, "skipped");
    assert.match(out.results[0]!.reason, /^not offered by the wire row: a thing/);
  });
});
