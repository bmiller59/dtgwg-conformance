// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countRun } from "../scripts/run-counts.ts";

describe("run counts", () => {
  it("counts statuses per block and per vector group, and groups the SKIP reasons", () => {
    const blocks = [{ impl: "x", tier: 1, results: [
      { id: "GP-VTA-001", status: "PASS" }, { id: "GP-VTA-002", status: "SKIP", reason: "type not declared: https://trusttasks.org/spec/a/b/0.1" },
      { id: "GP-VTC-001", status: "SKIP", reason: "type not declared: https://trusttasks.org/spec/c/d/0.2" }, { id: "GE-VTA-001", status: "FAIL" },
    ] }];
    const [c] = countRun("r", blocks);
    assert.deepEqual(c!.total, { PASS: 1, SKIP: 2, FAIL: 1 });
    assert.deepEqual(c!.byGroup["GP-VTA"], { PASS: 1, SKIP: 1 });
    assert.deepEqual(c!.byGroup["GE-VTA"], { FAIL: 1 });
    assert.deepEqual(c!.skipReasons, { "type not declared: <type>": 2 });
  });
});
