// SPDX-License-Identifier: Apache-2.0
// Every recorded run folder carries run.json (docs/04 section 20.1): beside every results.json, and at least one per folder. Folders
// recorded before run.json was committed are listed in runs-before-run-json.json of the results directory and are not edited.
// Run records are kept outside this repository (docs/04 section 21): skipped when SUITE_RESULTS_DIR names no run folders.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildModel } from "../src/glance/model.ts";
import { RUN_FORMAT } from "../src/runner/provenance.ts";
import { runsDir } from "../src/results-dir.ts";
import { HAVE_RUNS, NEEDS_RUNS, RESULTS } from "./helpers.ts";

const ROOT = join(import.meta.dirname, "..");
const RUNS = runsDir(RESULTS);
const LIST = HAVE_RUNS ? JSON.parse(readFileSync(join(RESULTS, "runs-before-run-json.json"), "utf8")) as { folders: string[]; currentEarlierRecordings: string[] } : { folders: [], currentEarlierRecordings: [] };
const BEFORE = LIST.folders;

function files(dir: string, name: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== "draft-issues" && e !== "logs") out.push(...files(p, name)); } else if (e === name) out.push(p);
  }
  return out;
}

/** The problems with one run folder's run.json records; empty when it is complete. */
export function runRecordProblems(folder: string): string[] {
  const p: string[] = [];
  const runJsons = files(folder, "run.json");
  if (runJsons.length === 0) p.push("no run.json");
  for (const r of files(folder, "results.json")) if (!existsSync(join(r, "..", "run.json"))) p.push(`no run.json beside ${r.slice(folder.length + 1)}`);
  for (const f of runJsons) {
    const j = JSON.parse(readFileSync(f, "utf8")) as { format?: string; suite?: { commit?: unknown; dirty?: unknown; version?: unknown } };
    const at = f.slice(folder.length + 1);
    if (j.format !== RUN_FORMAT) p.push(`${at}: format ${String(j.format)}, expected ${RUN_FORMAT}`);
    if (typeof j.suite?.commit !== "string" || !/^[0-9a-f]{40}$/.test(j.suite.commit)) p.push(`${at}: suite.commit is not a commit id`);
    if (typeof j.suite?.dirty !== "boolean") p.push(`${at}: suite.dirty is not recorded`);
    if (typeof j.suite?.version !== "string" || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(j.suite.version)) p.push(`${at}: suite.version is not a semver version`);
  }
  return p;
}

describe("run records carry run.json (R1)", NEEDS_RUNS, () => {
  const folders = !HAVE_RUNS ? [] : readdirSync(RUNS).filter((d) => /^\d{4}-\d{2}-\d{2}-/.test(d) && statSync(join(RUNS, d)).isDirectory());
  it("every run folder not listed as recorded before run.json has a complete run.json", () => {
    const bad = folders.filter((d) => !BEFORE.includes(d)).flatMap((d) => runRecordProblems(join(RUNS, d)).map((x) => `${d}: ${x}`));
    assert.deepEqual(bad, []);
  });
  it("the before-run.json list names only existing folders that still lack run.json (remove a folder once re-recorded)", () => {
    for (const d of BEFORE) {
      assert.ok(folders.includes(d), `${d} is not a run folder`);
      assert.ok(files(join(RUNS, d), "run.json").length === 0, `${d} now has run.json: remove it from runs-before-run-json.json`);
    }
    assert.equal(new Set(BEFORE).size, BEFORE.length);
  });
  it("the current run of every surface carries run.json, except the named earlier recordings", () => {
    const model = buildModel(ROOT, RESULTS);
    const current = new Set<string>(model.subjects.flatMap((s) => s.surfaces.flatMap((sf) => sf.runs)));
    for (const s of model.config.subjects) if (s.notReachable !== undefined) current.add(s.notReachable.run);
    const earlier = [...current].filter((d) => files(join(RUNS, d), "run.json").length === 0).sort();
    assert.deepEqual(earlier, [...LIST.currentEarlierRecordings].sort());
    for (const d of folders.filter((x) => x.startsWith("2026-11-16-agreed-"))) assert.ok(!BEFORE.includes(d) && runRecordProblems(join(RUNS, d)).length === 0, d);
  });
  it("the check is not vacuous: a folder without run.json is reported", () => {
    assert.ok(runRecordProblems(join(RUNS, BEFORE[0]!)).includes("no run.json"));
  });
});
