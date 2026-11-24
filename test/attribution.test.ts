// SPDX-License-Identifier: Apache-2.0
// A published statement about a measured platform's commit must match the recorded run inputs: no tracked page calls a measured checkout
// "unmodified" (or "the originals" as such), and the README, which names the measured wallet commits, says that they are not on upstream
// main. Whether a commit is on upstream main is checked by hand (docs/maintainers/checklist.md); this test holds the published wording to it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { SUITE_ROOT } from "../src/vectors/source.ts";

const runMap = JSON.parse(readFileSync(join(SUITE_ROOT, "results/platform-run-map.json"), "utf8")) as { runs: { platform: string; checkout: string }[] };
const commits = [...new Set(runMap.runs.map((r) => r.checkout).filter((c) => /^[0-9a-f]{7,40}$/.test(c)))];
// the bifold commit is recorded beside the outer wallet commit in the run READMEs, not in the run map
const MEASURED = [...commits, "7e14c5124"];
const tracked = (): string[] => { try { return execFileSync("git", ["-C", SUITE_ROOT, "ls-files", "*.md"], { encoding: "utf8" }).split("\n").filter((f) => f !== "" && !f.startsWith("vectors/")); } catch { return []; } };

describe("platform attribution matches the recorded run inputs", () => {
  test("the run map records the commits measured", () => assert.ok(commits.length > 0));
  test("no tracked page calls a measured checkout unmodified", (t) => {
    const files = tracked();
    if (files.length === 0) { t.skip("not a git checkout"); return; }
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(join(SUITE_ROOT, f), "utf8");
      text.split(/\n\s*\n/).forEach((para) => {
        if (MEASURED.some((c) => para.includes(c.slice(0, 8))) && /\bunmodified\b|\bthe originals\b/i.test(para)) bad.push(`${f}: ${para.slice(0, 120)}`);
      });
    }
    assert.deepEqual(bad, []);
  });
  test("the README states that the measured wallet commits are not on upstream main", () => {
    const readme = readFileSync(join(SUITE_ROOT, "README.md"), "utf8");
    const para = readme.split(/\n\s*\n/).find((p) => p.includes("62af4d2d4") && p.includes("7e14c5124"));
    assert.ok(para !== undefined, "README names both measured wallet commits");
    assert.match(para, /Neither wallet commit is on upstream main/);
  });
});
