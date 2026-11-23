// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countStatuses, markdownTable } from "../src/ceremony/counts.ts";

describe("ceremony result counts", () => {
  const f = { results: [
    { id: "a", status: "completed" as const, terminal: "completed", reason: "" },
    { id: "b", status: "completed" as const, terminal: "completed", reason: "" },
    { id: "c", status: "failed" as const, terminal: null, reason: "x" },
    { id: "d", status: "skipped" as const, terminal: null, reason: "role not offered" },
  ] };
  it("counts each status and the total from the file", () => {
    const c = countStatuses(f);
    assert.equal(c.completed, 2);
    assert.equal(c.failed, 1);
    assert.equal(c.skipped, 1);
    assert.equal(c["ended-as-specified"], 0);
    assert.equal(c.total, 4);
  });
  it("a status the suite does not know is an error, not a silent zero", () => {
    assert.throws(() => countStatuses({ results: [{ id: "z", status: "passed" as never, terminal: null, reason: "" }] }), /unknown status/);
  });
  it("renders a table whose row sums to the total", () => {
    const t = markdownTable([{ label: "run", counts: countStatuses(f) }]);
    assert.match(t, /\| run \| 2 \| 0 \| 1 \| 0 \| 0 \| 1 \| 4 \|/);
  });
});
