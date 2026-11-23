// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captureFrom } from "../src/runner/engine.ts";

const nextStep = JSON.stringify({ type: "https://trusttasks.org/spec/trust-task-next-step/0.1", payload: { continuation: "resubmit" } });
const response = JSON.stringify({ type: "https://trusttasks.org/spec/vrc/relationships/propose/0.1#response", payload: { relationshipDid: "did:peer:0zR", n: 3 } });

describe("captureFrom (a held task answers with a next step before its response, SPEC.md 8.6)", () => {
  it("reads a single reply as before", () => {
    const into: Record<string, string> = {};
    captureFrom([response], { ibr: "/payload/relationshipDid", n: "/payload/n" }, into);
    assert.deepEqual(into, { ibr: "did:peer:0zR", n: "3" });
  });
  it("takes a value from the first reply in which its pointer resolves, not only from the first reply", () => {
    const into: Record<string, string> = {};
    captureFrom([nextStep, response], { ibr: "/payload/relationshipDid" }, into);
    assert.deepEqual(into, { ibr: "did:peer:0zR" });
  });
  it("prefers the earlier reply when both carry the member, and captures nothing when none does", () => {
    const early = JSON.stringify({ payload: { relationshipDid: "did:peer:0zEarly" } });
    const into: Record<string, string> = {};
    captureFrom([early, response], { ibr: "/payload/relationshipDid", gone: "/payload/missing" }, into);
    assert.deepEqual(into, { ibr: "did:peer:0zEarly" });
  });
});
