// SPDX-License-Identifier: Apache-2.0
// The before/after block (src/glance/baseline.ts): the baseline file in the results directory, the rows and the structured causes.
// Needs run folders (test/helpers.ts NEEDS_RUNS): skipped when SUITE_RESULTS_DIR names none.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { BASELINE_COMMIT, BASELINE_FORMAT, CAUSES, baselineBlock, loadBaseline, pickCounts } from "../src/glance/baseline.ts";
import { buildModel } from "../src/glance/model.ts";
import { HAVE_RUNS, NEEDS_RUNS, RESULTS } from "./helpers.ts";

const ROOT = join(import.meta.dirname, "..");
const model = HAVE_RUNS ? buildModel(ROOT, RESULTS) : undefined!;
const baseline = HAVE_RUNS ? loadBaseline(RESULTS)! : undefined!;
const block = HAVE_RUNS ? baselineBlock(ROOT, model, "../", baseline) : "";
const rowsOf = (label: string): string[] => block.split("\n").filter((l) => l.includes(`| ${label} |`));

describe("before/after block against the baseline commit", NEEDS_RUNS, () => {
  it("the baseline file is the named commit's record", () => {
    assert.equal(baseline.format, BASELINE_FORMAT);
    assert.ok(baseline.commit.startsWith(BASELINE_COMMIT) && /^[0-9a-f]{40}$/.test(baseline.commit));
    assert.ok(baseline.surfaces.length > 0 && baseline.registryCore.length > 0);
  });
  it("every current surface with a gating part has a row; a surface not re-run says earlier recording", () => {
    for (const s of model.subjects) for (const sf of s.surfaces) {
      const rows = rowsOf(sf.cfg.label);
      assert.ok(rows.length > 0, sf.cfg.id);
      if (sf.recordedEarlier) assert.ok(rows.every((r) => r.includes("earlier recording")), sf.cfg.id);
    }
  });
  it("an unchanged measure says unchanged, and a moved one names only detected causes", () => {
    const same = structuredClone(baseline);
    for (const s of model.subjects) for (const sf of s.surfaces) {
      const b = same.surfaces.find((x) => x.id === sf.cfg.id);
      if (b !== undefined) for (const m of Object.keys(b.measures) as (keyof typeof b.measures)[]) if (sf.byMeasure[m] !== undefined) b.measures[m] = pickCounts(sf.byMeasure[m]!);
    }
    const unchanged = baselineBlock(ROOT, model, "../", same);
    assert.ok(!unchanged.includes("ceremony split") && !unchanged.includes("R8:"));
    assert.match(unchanged, /\| unchanged \|/);
  });
  it("the causes are found where the records show them (non-vacuous)", () => {
    assert.ok(block.includes("ceremony split (decision 39)"));
    assert.match(block, /R8: not applicable only from a cited notOffered/);
    assert.match(block, /R10 minimum quiet period: \d+ FAIL/);
    assert.match(block, /R5: new surface/);
    assert.match(block, /R6: implementation name/);
    assert.equal(new Set(CAUSES.map((c) => c.id)).size, CAUSES.length);
  });
  it("without a baseline file the block says so instead of inventing figures", () => {
    assert.match(baselineBlock(ROOT, model, "../", null), /No baseline file/);
  });
});
