// SPDX-License-Identifier: Apache-2.0
// The generated ceremony-outcome block (src/glance/ceremonies.ts): counts come from scenario-result.json files, never from typed numbers.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ceremonyBlock, rowGroups } from "../src/glance/ceremonies.ts";
import { runSetId } from "../src/results-dir.ts";

const write = (dir: string, results: { id: string; status: string }[]): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "scenario-result.json"), JSON.stringify({ results: results.map((r) => ({ ...r, terminal: null, reason: "" })) }));
};
const CFG = { format: "tt-ceremony-rows/0.1", rows: [{ row: "r1", pair: "pair one", kind: "platform" as const }, { row: "r2", pair: "pair two", kind: "oracle" as const }, { row: "absent", pair: "no folder", kind: "platform" as const }] };

describe("ceremony rows block", () => {
  it("sums the outcomes per row and group from the result files and lists the scenarios that did not complete", () => {
    const tmp = mkdtempSync(join(tmpdir(), "tt-cer-"));
    try {
      write(join(tmp, "ceremonies", "r1", "a"), [{ id: "FC-ACL-001", status: "completed" }, { id: "FC-ACL-002", status: "ended-as-specified" }, { id: "FC-DEV-001", status: "failed" }]);
      write(join(tmp, "ceremonies", "r1", "b"), [{ id: "FC-ACL-003", status: "skipped" }]);
      write(join(tmp, "ceremonies", "r2"), [{ id: "FC-VRC-001", status: "completed" }]);
      const g = rowGroups(join(tmp, "ceremonies", "r1"));
      assert.equal(g.get("FC-ACL")!.total, 3);
      assert.deepEqual(g.get("FC-DEV")!.bad, ["FC-DEV-001"]);
      const md = ceremonyBlock(tmp, CFG);
      assert.match(md, /\| FC-ACL \(3\) \| pair one \| platform rows \| 1 \| 1 \| 0 \| 0 \| 0 \| 1 \| none \|/);
      assert.match(md, /\| FC-DEV \(1\) \| pair one \| platform rows \| 0 \| 0 \| 1 \| 0 \| 0 \| 0 \| FC-DEV-001 \|/);
      assert.match(md, /\| FC-VRC \(1\) \| pair two \| the suite's own oracle \| 1 /);
      assert.match(md, /No record for: absent\./);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
  it("a live row is labelled as a live container row, never as a count of any other kind", () => {
    const tmp = mkdtempSync(join(tmpdir(), "tt-cer-"));
    try {
      write(join(tmp, "ceremonies", "l1"), [{ id: "FC-KVC-001", status: "completed" }, { id: "FC-KVC-003", status: "failed" }]);
      const md = ceremonyBlock(tmp, { format: "tt-ceremony-rows/0.1", rows: [{ row: "l1", pair: "live pair", kind: "live" as const }] });
      assert.match(md, /\| FC-KVC \(2\) \| live pair \| live container rows \| 1 \| 0 \| 1 \| 0 \| 0 \| 0 \| FC-KVC-003 \|/);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
  it("prints the wire row kind apart from the in-process kinds, and never merges it into them", () => {
    const tmp = mkdtempSync(join(tmpdir(), "tt-cer-"));
    try {
      write(join(tmp, "ceremonies", "r1"), [{ id: "FC-ACL-001", status: "completed" }]);
      write(join(tmp, "ceremonies", "w1"), [{ id: "FC-ACL-001", status: "completed" }, { id: "FC-ACL-008", status: "skipped" }]);
      const md = ceremonyBlock(tmp, { format: "tt-ceremony-rows/0.1", rows: [{ row: "r1", pair: "in process", kind: "platform" }, { row: "w1", pair: "wallet to live VTA", kind: "wire" }] });
      assert.match(md, /\| FC-ACL \(1\) \| in process \| platform rows \| 1 /);
      assert.match(md, /\| FC-ACL \(2\) \| wallet to live VTA \| wire rows \(real DIDComm v2 wire, live agent\) \| 1 \| 0 \| 0 \| 0 \| 0 \| 1 \| none \|/);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
  it("says so when there are no ceremony records, and rejects an unknown status", () => {
    const tmp = mkdtempSync(join(tmpdir(), "tt-cer-"));
    try {
      assert.match(ceremonyBlock(tmp, CFG), /No ceremony run records/);
      write(join(tmp, "ceremonies", "r1"), [{ id: "FC-ACL-001", status: "bogus" }]);
      assert.throws(() => ceremonyBlock(tmp, CFG), /unknown status/);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
  it("the run set id changes when a ceremony record changes", () => {
    const tmp = mkdtempSync(join(tmpdir(), "tt-cer-"));
    try {
      mkdirSync(join(tmp, "runs"), { recursive: true });
      write(join(tmp, "ceremonies", "r1"), [{ id: "FC-ACL-001", status: "completed" }]);
      const a = runSetId(tmp);
      write(join(tmp, "ceremonies", "r1"), [{ id: "FC-ACL-001", status: "failed" }]);
      assert.notEqual(runSetId(tmp), a);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
});
