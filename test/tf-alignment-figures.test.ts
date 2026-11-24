// SPDX-License-Identifier: Apache-2.0
// The alignment figures quoted in tracked pages must not drift from the recomputed values: results/tf-alignment.md is exactly the render of
// results/tf-alignment.json, every "N of 5,252"-style figure in a tracked page is one of the JSON's counts, decision D951 quotes the JSON,
// and (when TT_KIT names a task-force checkout) the JSON's invalid-example mapping is what the analysis computes now.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { analyse, pct } from "../src/tfalign/analyse.ts";
import { renderReport } from "../src/tfalign/report.ts";
import { openTf } from "../src/tfalign/source.ts";
import { SUITE_ROOT } from "../src/vectors/source.ts";

type Inv = { total: number; exact: number; exactExpectingRefusal: number; namedOnly: number; notMatched: number; exactWithoutAlignmentSet: number; requestEntries: number; responseEntries: number; exactRequestEntries: number; exactResponseEntries: number; responseEntriesSentAsRequests: number };
const json = JSON.parse(readFileSync(join(SUITE_ROOT, "results/tf-alignment.json"), "utf8")) as { mapping: { invalidExamples: Inv } };
const inv = json.mapping.invalidExamples;
const n = (s: string): number => Number(s.replace(/,/g, ""));
const fmt = (x: number): string => x.toLocaleString("en-US");

describe("alignment figures in tracked pages match the recomputed values", () => {
  test("results/tf-alignment.md is the render of results/tf-alignment.json", () => {
    assert.equal(readFileSync(join(SUITE_ROOT, "results/tf-alignment.md"), "utf8"), renderReport(json as unknown as Record<string, unknown>));
  });
  test("decision D951 quotes the current figures", () => {
    const d = readFileSync(join(SUITE_ROOT, "docs/decisions/02-specs-tiers-and-channels.md"), "utf8");
    const m = /([\d,]+) of the ([\d,]+) invalid examples are used \(([\d.]+)%; ([\d.]+)% of the ([\d,]+) request entries\), ([\d,]+) \(([\d.]+)%\) without the alignment set; none of the ([\d,]+) response entries counts as used/.exec(d);
    assert.ok(m !== null, "D951 states the alignment figures in the expected form");
    assert.deepEqual([n(m[1]!), n(m[2]!), `${m[3]}%`, `${m[4]}%`, n(m[5]!), n(m[6]!), `${m[7]}%`, n(m[8]!)],
      [inv.exact, inv.total, pct(inv.exact, inv.total), pct(inv.exactRequestEntries, inv.requestEntries), inv.requestEntries, inv.exactWithoutAlignmentSet, pct(inv.exactWithoutAlignmentSet, inv.total), inv.responseEntries]);
    assert.equal(inv.exactResponseEntries, 0, "D951 says no response entry counts as used");
  });
  test("every 'N of <total>' invalid-example figure in a tracked page is a current count", (t) => {
    let files: string[] = [];
    try { files = execFileSync("git", ["-C", SUITE_ROOT, "ls-files", "*.md"], { encoding: "utf8" }).split("\n").filter((f) => f !== "" && f !== "results/tf-alignment.md"); } catch { t.skip("not a git checkout"); return; }
    const allowed = new Set([inv.exact, inv.exactWithoutAlignmentSet, inv.exactExpectingRefusal, inv.namedOnly, inv.notMatched, inv.exactRequestEntries]);
    const total = new RegExp(`([\\d,]+) (?:of|out of) (?:the )?(?:${fmt(inv.total)}|${inv.total})\\b`, "g");
    const bad: string[] = [];
    for (const f of files) for (const m of readFileSync(join(SUITE_ROOT, f), "utf8").matchAll(total)) if (!allowed.has(n(m[1]!))) bad.push(`${f}: ${m[0]}`);
    assert.deepEqual(bad, []);
  });
  test("the committed mapping is what the analysis computes now (TT_KIT)", (t) => {
    const kit = process.env["TT_KIT"];
    if (kit === undefined || !existsSync(join(kit, "specs"))) { t.skip("TT_KIT names no task-force checkout"); return; }
    const tf = openTf(kit);
    try {
      const now = (analyse(tf, { suiteRoot: SUITE_ROOT }) as { mapping: { invalidExamples: Inv } }).mapping.invalidExamples;
      for (const k of ["total", "exact", "exactExpectingRefusal", "namedOnly", "notMatched", "exactWithoutAlignmentSet", "requestEntries", "responseEntries", "exactRequestEntries", "exactResponseEntries", "responseEntriesSentAsRequests"] as const) assert.equal(now[k], inv[k], k);
    } finally { tf.cleanup(); }
  });
});
