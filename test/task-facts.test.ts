// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectOf, factsOf, mandatedCodes, noResponseOk } from "../src/coverage/task-facts.ts";

const SPEC = ["---", "slug: x/y", "sideEffects:", "  level: mutating", "  rationale: >-", "    why", "---", "", "# T", "The recipient **MUST** refuse an id already in use with `idConflict`.", "A successful reload drops the transport. That is not a failure and MUST NOT be retried.", "Nothing about `proofInvalid` here is in front matter."].join("\n");

describe("task facts read from a spec.md", () => {
  it("reads sideEffects.level (none is read-only) and null when absent", () => {
    assert.equal(effectOf(SPEC), "mutating");
    assert.equal(effectOf("---\nsideEffects:\n  level: none\n---\n"), "read-only");
    assert.equal(effectOf("---\nsideEffects:\n  level: \"destructive\"\n---\n"), "destructive");
    assert.equal(effectOf("---\nslug: a\n---\n"), null);
    assert.equal(effectOf("no front matter"), null);
  });
  it("cites each envelope code a consumer rule requires, by file line; a sentence that only mentions a code and the front matter are ignored (R-04)", () => {
    assert.deepEqual(mandatedCodes(SPEC).map((c) => [c.code, c.line]), [["idConflict", 10]]);
  });
  it("finds a clause that says a missing response is not a failure", () => {
    assert.deepEqual(noResponseOk(SPEC).map((c) => c.line), [11]);
    assert.equal(factsOf("u", SPEC).effect, "mutating");
  });
});
