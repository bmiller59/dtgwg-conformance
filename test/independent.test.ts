// SPDX-License-Identifier: Apache-2.0
// Independent passing implementations per group (docs/14 section 8, src/glance/independent.ts): the reference adapter is
// never counted, the original is reported apart, and every counted row rests on a recorded run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { buildModel } from "../src/glance/model.ts";
import { HAVE_RUNS, NEEDS_RUNS, RESULTS } from "./helpers.ts";
import { buildIndependent, independentBlock, independentPage } from "../src/glance/independent.ts";

const root = join(import.meta.dirname, "..");
const model = HAVE_RUNS ? buildModel(root, RESULTS) : undefined!;
const r = HAVE_RUNS ? buildIndependent(root, model) : undefined!;

test("the reference adapter is shown apart and never counted", NEEDS_RUNS, () => {
  const notCounted = r.sources.filter((s) => !s.counted).map((s) => s.subject).sort();
  assert.deepEqual([...new Set(notCounted)], ["reference"]);
  for (const g of r.groups) for (const p of [...g.passing, ...g.differing]) {
    assert.ok(!/reference|truststackers/i.test(p.platform), `${g.group}: ${p.platform} counted`);
  }
  assert.ok(r.notReachable.some((x) => x.platform === "truststackers (original)"));
});

test("a counted platform passes a group only with a PASS and no FAIL or KNOWN-FAIL, and counts once", NEEDS_RUNS, () => {
  for (const g of r.groups) {
    for (const p of g.passing) assert.ok(p.cell.pass > 0 && p.cell.differ === 0, g.group);
    for (const p of g.differing) assert.ok(p.cell.pass === 0 || p.cell.differ > 0, g.group);
    const names = [...g.passing, ...g.differing].map((p) => p.platform);
    assert.equal(new Set(names).size, names.length, `${g.group}: a platform counted twice`);
  }
});

test("every source names its run folders and suite version, and the page says what it is not", NEEDS_RUNS, () => {
  for (const s of r.sources) { assert.ok(s.runs.length > 0); assert.ok(s.suiteVersion.length > 0); }
  const page = independentPage(r);
  assert.match(page, /Status: draft proposal/);
  assert.match(page, /not interoperation/);
  assert.match(independentBlock(r, "../"), /results\/independent-implementations\.md/);
});
