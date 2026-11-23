// SPDX-License-Identifier: Apache-2.0
// The community "open gaps" page (docs/community/open-gaps.md) is generated from data and the scenario files. These tests check that
// the page is current, that the data agrees with the scenario files and with itself, and that the page keeps the suite's reporting
// rules: a denominator beside every percentage, nothing called a pass for a ceremony, no private paths.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { SUITE_ROOT } from "../src/vectors/source.ts";
import { claimWordsIn } from "../src/glance/claims-lint.ts";
import {
  buildOpenGaps, dataProblems, loadScenarios, pct, PAGE,
  type CompletionData, type OpenGapsData, type VectorCompleteness,
} from "../scripts/community-open-gaps.ts";

const read = <T>(rel: string): T => JSON.parse(readFileSync(join(SUITE_ROOT, rel), "utf8")) as T;
const completion = read<CompletionData>("docs/community/data/ceremony-completion.json");
const gaps = read<OpenGapsData>("docs/community/data/open-gaps.json");
const vc = read<VectorCompleteness>("docs/community/data/vector-completeness.json");

describe("community open gaps", () => {
  test("the page on disk is exactly what the generator produces", () => {
    assert.equal(readFileSync(join(SUITE_ROOT, PAGE), "utf8"), buildOpenGaps(SUITE_ROOT), "run: node --experimental-strip-types scripts/community-open-gaps.ts");
  });

  test("the data is consistent with the scenario files", () => {
    assert.deepEqual(dataProblems(SUITE_ROOT, loadScenarios(SUITE_ROOT), completion, gaps, vc), []);
  });

  test("every scenario of the repository has a completion entry, and the totals are those of the recorded snapshot", () => {
    const scenarios = loadScenarios(SUITE_ROOT);
    assert.equal(scenarios.length, Object.keys(completion.completion).length);
    const entries = Object.values(completion.completion);
    assert.equal(scenarios.length, 163);
    assert.equal(entries.filter((v) => v).length, 104);
  });

  test("each open scenario is named by exactly one blocker (the check detects a missing and a doubled one)", () => {
    const scenarios = loadScenarios(SUITE_ROOT);
    const open = Object.entries(completion.completion).filter(([, v]) => !v).map(([k]) => k);
    assert.deepEqual(gaps.ceremonyBlockers.flatMap((b) => b.scenarios).sort(), open.sort());
    const missing: OpenGapsData = { ...gaps, ceremonyBlockers: gaps.ceremonyBlockers.slice(1) };
    assert.ok(dataProblems(SUITE_ROOT, scenarios, completion, missing, vc).some((p) => p.includes("has no blocker")));
    const doubled: OpenGapsData = { ...gaps, ceremonyBlockers: [...gaps.ceremonyBlockers, { ...gaps.ceremonyBlockers[0]! }] };
    assert.ok(dataProblems(SUITE_ROOT, scenarios, completion, doubled, vc).some((p) => p.includes("is named by both")));
  });

  test("a blocker for a completed scenario or a family sum that does not add up is reported", () => {
    const scenarios = loadScenarios(SUITE_ROOT);
    const done = Object.entries(completion.completion).find(([, v]) => v)![0];
    const wrong: OpenGapsData = { ...gaps, ceremonyBlockers: [{ ...gaps.ceremonyBlockers[0]!, scenarios: [done] }] };
    assert.ok(dataProblems(SUITE_ROOT, scenarios, completion, wrong, vc).some((p) => p.includes("has a completed run")));
    const bad: VectorCompleteness = { ...vc, families: vc.families.map((f, i) => (i === 0 ? { ...f, weakOnly: f.weakOnly + 1 } : f)) };
    assert.ok(dataProblems(SUITE_ROOT, scenarios, completion, gaps, bad).length > 0);
  });

  test("vector completion totals are those of the recorded snapshot", () => {
    assert.equal(vc.scope, 682);
    assert.equal(vc.totals.assertsSuccess + vc.totals.weakOnly, vc.totals.positive);
    assert.equal(pct(vc.totals.weakOnly, vc.scope), "44.3% [302/682]");
    assert.equal(pct(vc.totals.assertsSuccess, vc.scope), "55.6% [379/682]");
  });

  test("pct always prints the denominator", () => {
    assert.equal(pct(1, 3), "33.3% [1/3]");
  });

  test("the page states its maturity and never calls a ceremony a pass or a platform conformant", () => {
    const page = buildOpenGaps(SUITE_ROOT);
    assert.ok(page.includes("Every task specification involved is draft"));
    assert.ok(page.includes("never conformance"));
    assert.deepEqual(claimWordsIn(page), []);
  });

  test("every percentage on the page carries its denominator", () => {
    const page = buildOpenGaps(SUITE_ROOT);
    const bare = [...page.matchAll(/\d+(?:\.\d)?%(?! \[\d+\/\d+\])/g)].map((m) => m[0]);
    assert.deepEqual(bare, []);
  });
});

describe("README figures are pinned to the community data", () => {
  const readme = readFileSync(join(SUITE_ROOT, "README.md"), "utf8");
  const entries = Object.entries(completion.completion);
  const done = entries.filter(([, v]) => v).length;
  const d = completion.denominators;

  test("the ceremony table and headline lines are the counts of the data over each denominator", () => {
    assert.equal(d.allScenarios, entries.length);
    for (const den of [d.allScenarios, d.bothAttempted, d.vtiAttempted, d.keyringWalletAttempted]) {
      assert.ok(readme.includes(pct(done, den)), `README lacks ${pct(done, den)}`);
    }
    assert.ok(readme.includes(`original platforms: ${pct(done, d.bothAttempted)}`));
    assert.ok(readme.includes(pct(entries.length - done, entries.length)), "scenarios with no completed run");
  });

  test("the README dates the baseline and says gating passing figures are not quoted yet", () => {
    for (const x of ["4 November 2026 (commit 26d0da81a)", "62af4d2d4", "7e14c5124", "235, 174 and 191 commits behind current upstream main", "A re-run on current main is in progress"]) assert.ok(readme.includes(x), `README lacks: ${x}`);
    assert.ok(readme.includes("Passing figures for the gating channel are not quoted yet: older vectors were corrected and the recorded results are being re-run."));
  });

  test("the caveat lines are the counts of the data", () => {
    const c = completion.caveats;
    const g = c.cannotBePairedWithTodaysDeclarations;
    assert.equal(Object.values(g.groups).reduce((x, y) => x + y, 0), g.total);
    assert.equal(c.originalByCarrier.liveContainers + c.originalByCarrier.didcommWire + c.originalByCarrier.inProcess, done);
    assert.ok(readme.includes(`${g.total} of the ${d.bothAttempted} cannot be run as a pair`));
    assert.ok(readme.includes(Object.entries(g.groups).map(([k, n]) => (n === 1 ? k : `${k} ${n}`)).join(", ")));
    assert.ok(readme.includes(`${c.referenceInThirdSeatAmongOriginal} of the ${done} had a reference`));
    assert.ok(readme.includes(`${c.originalByCarrier.liveContainers} of the ${done} ran against VTI's live service containers, ${c.originalByCarrier.didcommWire} over DIDComm wire and ${c.originalByCarrier.inProcess} with both`));
    assert.ok(readme.includes("Reference-assisted results are included"));
    assert.ok(readme.includes("Role-level coverage"));
  });

  test("the vector card is the totals of the data, and the vector pages are linked", () => {
    const t = vc.totals;
    for (const n of [t.covered, t.positive, t.negative, t.assertsSuccess, t.weakOnly, t.gating]) assert.ok(readme.includes(pct(n, vc.scope)), `README lacks ${pct(n, vc.scope)}`);
    assert.ok(readme.includes("(docs/37-vector-completeness.md)"));
    assert.ok(readFileSync(join(SUITE_ROOT, "docs/community/open-gaps.md"), "utf8").includes("(../37-vector-completeness.md)"));
  });
});
