// SPDX-License-Identifier: Apache-2.0
// Generated documentation blocks: every figure in README.md, STATUS.md, platforms.md, results/README.md and
// results/platforms/*.md comes from scripts/docs-blocks.ts, and the files on disk must match it (npm run regen). The pages are
// committed snapshots of the run set they were generated from (docs/04 section 21): the checks against the run folders skip when
// SUITE_RESULTS_DIR names none; the stamp check runs either way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fillBlocks, stale } from "../scripts/docs-blocks.ts";
import { buildModel } from "../src/glance/model.ts";
import { estimatedCoverage, oracleGaps, scopeTasks, statusTable } from "../src/glance/docs.ts";
import { runSetId, runsDir } from "../src/results-dir.ts";
import { HAVE_RUNS, NEEDS_RUNS, RESULTS } from "./helpers.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("generated documentation blocks are current (run npm run regen)", NEEDS_RUNS, () => {
  assert.deepEqual(stale(root, RESULTS), []);
});

test("every snapshot page names one and the same run set (and it is the results directory's when present)", { skip: !existsSync(join(root, "STATUS.md")) && "the dated results pages are working outputs and are not in a clean checkout" }, () => {
  const pages = ["STATUS.md", "results/AT-A-GLANCE.md", "results/at-a-glance.html", "results/interop/pair-matrix.md"];
  const sets = new Set<string>();
  for (const p of pages) {
    const m = [...readFileSync(join(root, p), "utf8").matchAll(/run set (?:`|<code>)?([0-9a-f]{12})\b/g)].map((x) => x[1]!);
    assert.ok(m.length > 0, `${p} carries no run set stamp`);
    for (const x of m) sets.add(x);
  }
  assert.equal(sets.size, 1, `snapshot pages name different run sets: ${[...sets].join(", ")} (run npm run regen against one results directory)`);
  if (HAVE_RUNS) assert.deepEqual([...sets], [runSetId(RESULTS)]);
});

test("the keyring-wallet task scope reads the hand list and the named-types file, one entry per task", () => {
  const tasks = scopeTasks(root, "keyring-wallet").map((t) => t.task);
  assert.ok(tasks.includes("trust-task-error") && tasks.includes("vtc/members/vmc"), "hand list and named-types file are both read");
  assert.equal(new Set(tasks).size, tasks.length);
  assert.ok(tasks.every((t) => !/\/\d+(\.\d+)*$/.test(t)), "versions are stripped");
});

test("the estimated coverage block gives both definitions, keeps truststackers separate, and never counts a SKIP", NEEDS_RUNS, () => {
  const model = buildModel(root, RESULTS);
  const t = estimatedCoverage(root, model, "");
  assert.match(t, /\(1\) Share of the trust tasks keyring-wallet uses/);
  assert.match(t, /\(2\) Share of the suite's core and 2L checks/);
  assert.match(t, /\| truststackers \(original\) \| \*\*0\*\* \(not reachable\)/);
  assert.doesNotMatch(t, /\| truststackers \|/);
  // the reference adapter row: core figures equal its recorded non-SKIP core registry results
  const ref = model.subjects.find((s) => s.cfg.role === "self-check")!.surfaces[0]!;
  const ran = ref.results.filter((r) => r.kind === "core" && r.channel === "registry" && r.status !== "SKIP").length;
  assert.match(t, new RegExp(`Reference adapter[^\n]*\\| ${ran} of \\d+ `));
});

test("blocks are replaced between their markers only", () => {
  const t = "a\n<!-- generated:x -->\nold\n<!-- /generated:x -->\nb\n";
  assert.equal(fillBlocks(t, () => "new"), "a\n<!-- generated:x -->\nnew\n<!-- /generated:x -->\nb\n");
});

test("the status table lists platforms in the required order, and never blends truststackers", NEEDS_RUNS, () => {
  const t = statusTable(buildModel(root, RESULTS), "");
  const at = (s: string): number => t.indexOf(`| ${s} |`);
  const order = ["VTI", "keyring-wallet", "truststackers (original)"].map(at);
  for (const i of order) assert.ok(i >= 0);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(t, /\| truststackers \|/);
  assert.match(t, /never added together and are not a ranking/);
});

test("the README folder overview names every source folder and adapter", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const overview = readme.slice(readme.indexOf("## Folder overview"));
  const dirs = (p: string): string[] => readdirSync(join(root, p)).filter((d) => statSync(join(root, p, d)).isDirectory());
  for (const d of dirs("src")) assert.match(overview, new RegExp(`src/${d}/`), `src/${d}/`);
  for (const d of dirs("src/adapters")) assert.match(overview, new RegExp(`\`${d}/\``), `src/adapters/${d}/`);
});

test("the run index names a current folder per surface and every superseded folder carries the banner", NEEDS_RUNS, () => {
  const idx = readFileSync(join(runsDir(RESULTS), "INDEX.md"), "utf8");
  const current = idx.slice(idx.indexOf("## Current run per surface"), idx.indexOf("## Milestones"));
  assert.match(current, /2026-11-19-final-upstream-vti-inprocess/);
  assert.match(current, /truststackers \(original\)/);
  const sup = idx.slice(idx.indexOf("## Superseded"), idx.indexOf("## Supporting records"));
  for (const m of sup.matchAll(/^\| `([^`]+)`/gm)) {
    assert.match(readFileSync(join(runsDir(RESULTS), m[1]!, "README.md"), "utf8"), /^> \*\*Superseded\*\* by \[/m, m[1]);
  }
});

test("AT-A-GLANCE lists platforms in the required order and never says alphabetical", { skip: !existsSync(join(root, "results", "AT-A-GLANCE.md")) && "working output, not in a clean checkout" }, () => {
  const md = readFileSync(join(root, "results", "AT-A-GLANCE.md"), "utf8");
  assert.doesNotMatch(md, /alphabetical/i);
  assert.match(md, /## Conformance measured vs interoperation demonstrated/);
  const grid = md.slice(md.indexOf("## Status grid"));
  const at = ["| VTI |", "| keyring-wallet |", "| truststackers (original) |"].map((s) => grid.indexOf(s));
  for (const i of at) assert.ok(i >= 0);
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test("results/README.md labels every emit and emit-more vector the reference oracle SKIPs as not validated by the oracle", NEEDS_RUNS, () => {
  const model = buildModel(root, RESULTS);
  const md = readFileSync(join(root, "results", "README.md"), "utf8");
  const block = md.slice(md.indexOf("<!-- generated:oracle-gaps -->"), md.indexOf("<!-- /generated:oracle-gaps -->"));
  assert.match(block, /Not validated by the oracle/);
  const sf = model.subjects.find((s) => s.cfg.role === "self-check")!.surfaces[0]!;
  let n = 0;
  for (const run of sf.runs) for (const folder of ["emit", "emit-more"]) {
    const blocks = JSON.parse(readFileSync(join(runsDir(RESULTS), run, folder, "results.json"), "utf8")) as { impl: string; tier: number; results: { id: string; status: string }[] }[];
    for (const r of blocks.find((b) => b.impl === sf.cfg.impl && b.tier === 1)!.results) if (r.status === "SKIP") { n++; assert.match(block, new RegExp(`\\b${r.id}\\b`), r.id); }
  }
  assert.ok(n > 0);
  assert.equal(oracleGaps(root, model, "../").trimEnd(), block.slice(block.indexOf("\n") + 1).trimEnd());
});
