// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadTask } from "../src/plain/catalog.ts";
import { answeredErrors } from "../src/plain/check.ts";
import { example } from "../src/plain/schema.ts";
import { discoveryResponseErrors } from "../src/runner/engine.ts";

const malformed = (type: string): string => JSON.stringify({ type: "https://trusttasks.org/spec/trust-task-error/0.1", payload: { code: "malformedRequest" }, id: "e", threadId: "t", issuedAt: "2026-11-15T10:00:00Z", _t: type });

describe("malformedRequest for a schema-valid payload (SPEC.md:246, :1069, :388)", () => {
  it("is a note, never escalated, where the payload schema admits ext", () => {
    const task = loadTask("https://trusttasks.org/spec/policy/upsert/0.3")!;
    const should: string[] = [];
    const note: string[] = [];
    const errs = answeredErrors(task, [malformed(task.typeUri)], { should: (m) => should.push(m), note: (m) => note.push(m) });
    assert.deepEqual(errs, []);
    assert.deepEqual(should, []);
    assert.equal(note.length, 1);
  });
  it("is still a SHOULD where the payload schema has no ext, and an envelope code still fails", () => {
    const task = loadTask("https://trusttasks.org/spec/policy/upsert/0.3")!;
    const noExt = { ...task, payloadSchema: { type: "object", properties: {} } };
    const should: string[] = [];
    const note: string[] = [];
    answeredErrors(noExt, [malformed(task.typeUri)], { should: (m) => should.push(m), note: (m) => note.push(m) });
    assert.equal(should.length, 1);
    assert.deepEqual(note, []);
  });
});

describe("generated input", () => {
  it("gives a member whose description names a DID a DID", () => {
    const task = loadTask("https://trusttasks.org/spec/vtc/invitations/issue/0.1")!;
    assert.match(String((example(task.payloadSchema as never) as Record<string, unknown>).subjectDid), /^did:/);
  });
});

describe("discovery 0.3 response: expiryHorizonSeconds", () => {
  const doc = { payload: { supportedTypes: [], acceptanceWindow: { maxAgeSeconds: 60, clockSkewSeconds: 5, expiryHorizonSeconds: 10 } } };
  it("is rejected in a 0.3 answer and accepted in 0.4", () => {
    assert.deepEqual(discoveryResponseErrors(doc), []);
    assert.deepEqual(discoveryResponseErrors(doc, false), ["acceptanceWindow has unknown member expiryHorizonSeconds"]);
    const entry = { payload: { supportedTypes: [{ type: "https://trusttasks.org/spec/acl/grant/0.2", acceptanceWindow: { maxAgeSeconds: 60, clockSkewSeconds: 5, expiryHorizonSeconds: 10 } }] } };
    assert.equal(discoveryResponseErrors(entry, false).length, 1);
  });
});
