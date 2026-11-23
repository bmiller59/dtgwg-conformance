// SPDX-License-Identifier: Apache-2.0
// truststackers is reported as its own platform, never as one blended entry with another.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { compute, NOT_REACHABLE } from "../scripts/interop-matrix.ts";
import { join } from "node:path";
import { runsDir } from "../src/results-dir.ts";
import { NEEDS_RUNS, RESULTS } from "./helpers.ts";

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the pair matrix lists truststackers apart, in no pair", NEEDS_RUNS, () => {
  const m = compute(RESULTS);
  assert.ok(!m.sources.some((s) => /original/.test(s.label)), "the original has no run, so it is never a pair source");
  assert.equal(NOT_REACHABLE[0]!.label, "truststackers (original)");
  const md = read("results/interop/pair-matrix.md");
  assert.match(md, /truststackers \(original\)/);
  assert.doesNotMatch(md, /truststackers \(with [^)]*\)|truststackers \(base\)/);
});

test("the at-a-glance page has a truststackers entry and no blended one", { skip: !existsSync(new URL("../results/AT-A-GLANCE.md", import.meta.url)) && "working output, not in a clean checkout" }, () => {
  const md = read("results/AT-A-GLANCE.md");
  assert.match(md, /### truststackers \(original\)/);
  assert.doesNotMatch(md, /^### truststackers\s*$/m);
  assert.doesNotMatch(md, /\| truststackers \|/);
});

test("the top-level docs use the split names", () => {
  for (const f of ["platforms.md"]) {
    const t = read(f);
    assert.match(t, /truststackers \(original\)/, f);
    assert.doesNotMatch(t, /truststackers \(with [^)]*\)|truststackers \(base\)/, f);
  }
});

test("the truststackers run folders carry a Code measured line", NEEDS_RUNS, () => {
  for (const r of ["2026-11-14-truststackers-i5", "2026-11-14-truststackers-i6", "2026-11-15-truststackers-bridge-query", "2026-11-15-truststackers-base"]) {
    assert.match(readFileSync(join(runsDir(RESULTS), r, "README.md"), "utf8"), /\| Code measured \|/, r);
  }
});
