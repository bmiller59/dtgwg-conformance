// SPDX-License-Identifier: Apache-2.0
// The results directory: where run folders and other run records live (docs/04 section 21). Run records are not kept in this
// repository; the one configuration point is the environment variable SUITE_RESULTS_DIR, which every command line also takes as
// `--results-dir <dir>` (the flag sets the variable, so child processes see the same directory). Default: results-local/ at the
// suite root, which is git-ignored.
//
// Layout of a results directory:
//   runs/<YYYY-MM-DD-label>/        one folder per run (run.json, results.json, conformance-matrix.*, README.md, draft-issues/)
//   runs/INDEX.md                   the run index (written by npm run regen)
//   runs-before-run-json.json       run folders recorded before run.json existed (test/run-records.test.ts)
//   baseline-<commit>.json          the before/after baseline (scripts/baseline.ts)
//   interop/pair-matrix.json        the interop pair matrix data (scripts/interop-matrix.ts)
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RESULTS_DIR_ENV = "SUITE_RESULTS_DIR";
const suiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The results directory: $SUITE_RESULTS_DIR, else results-local/ at the suite root. */
export function resultsDir(root: string = suiteRoot): string {
  const env = process.env[RESULTS_DIR_ENV];
  return env !== undefined && env !== "" ? resolve(env) : join(root, "results-local");
}

/** The run folders of a results directory. */
export const runsDir = (results: string): string => join(results, "runs");

/** A run folder name, checked: one path segment (or a folder/part pair), no `..`. */
export function runName(name: string): string {
  if (!/^[\w.-]+(\/[\w.-]+)?$/.test(name) || name.split("/").includes("..")) throw new Error(`--run: not a run folder name: ${name}`);
  return name;
}

/** Whether the results directory holds run folders. Generators and tests that need them skip when it does not. */
export const hasRuns = (results: string): boolean => existsSync(runsDir(results));

/** Removes `--results-dir <dir>` from argv and exports it as SUITE_RESULTS_DIR. Returns the remaining arguments. */
export function takeResultsDirFlag(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--results-dir") {
      const v = argv[++i];
      if (v === undefined) throw new Error("--results-dir needs a value");
      process.env[RESULTS_DIR_ENV] = resolve(v);
    } else out.push(argv[i]!);
  }
  return out;
}

/** The message a generator or check prints when it skips for want of run folders. */
export const noRunsMessage = (what: string, results: string): string =>
  `${what}: skipped, no run folders at ${results}/runs (set ${RESULTS_DIR_ENV} or pass --results-dir to check against a results directory)`;

/**
 * The run set: a digest of every .json and .jsonl file under runs/ (path and content), so a generated page names the exact
 * run records it was generated from. Markdown files are left out (the run index and the Superseded banners are generated).
 */
export function runSetId(results: string): string {
  const base = runsDir(results);
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.jsonl?$/.test(e.name)) files.push(p);
    }
  };
  if (existsSync(base)) walk(base);
  // the ceremony outcome records (ceremonies/<row>/**/scenario-result.json) feed the `ceremony-rows` block, so they belong to the set
  const cer: string[] = [];
  const walkCer = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walkCer(p);
      else if (e.name === "scenario-result.json") cer.push(p);
    }
  };
  const cerBase = join(results, "ceremonies");
  if (existsSync(cerBase)) walkCer(cerBase);
  const h = createHash("sha256");
  for (const p of files.sort()) h.update(relative(base, p)).update("\0").update(readFileSync(p)).update("\0");
  for (const p of cer.sort()) h.update(relative(results, p)).update("\0").update(readFileSync(p)).update("\0");
  return h.digest("hex").slice(0, 12);
}
