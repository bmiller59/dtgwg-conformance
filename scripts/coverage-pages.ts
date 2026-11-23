// SPDX-License-Identifier: Apache-2.0
// Writes results/coverage.md (the version-grain coverage page, docs/22, decision CV-13) and the generated blocks `coverage-counts` and `coverage-candidates` in
// docs/22-coverage-families.md. Advisory: nothing it writes enters a headline count or an exit code, and an absent coverage runs folder is
// not an error (the page then prints the vector counts and says that no coverage run is recorded).
// Usage: node --experimental-strip-types scripts/coverage-pages.ts [--check] [--coverage-runs <dir>] [--out <file>]
//   COVERAGE_RUNS_DIR names an optional folder of coverage run records (any depth; each results-advisory.json is one record).
//   --check  fails when results/coverage.md or the docs/22 block differs from what would be generated.
//   --snapshot  with --out: writes the measured snapshot (results/coverage-measured.md: a header giving the suite commit and date read from each record's run.json, how to regenerate and, with --superseded <comma-separated names>, the older run folders this set replaces) instead of the coverage page. Needs COVERAGE_RUNS_DIR or --coverage-runs.
//   --out    writes the page to <file> instead of results/coverage.md (to look at a page built from runs without touching the tracked one).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCoveragePage, buildSnapshotPage, coverageBlock, kwRolesBlock, reconcileBlock, COVERAGE_RUNS_ENV } from "../src/coverage/pages.ts";
import { fillBlocks } from "./docs-blocks.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every file this script owns, with the content it should have. */
export function outputs(rootDir: string, runsDir?: string): Map<string, string> {
  const out = new Map<string, string>();
  // The pages read the generated coverage matrix (results/coverage/matrix.json), a working output that is not published: without it nothing is owned here.
  if (!existsSync(join(rootDir, "results", "coverage", "matrix.json"))) return out;
  out.set(join(rootDir, "results", "coverage.md"), buildCoveragePage(rootDir, runsDir) + "\n");
  const doc = join(rootDir, "docs", "22-coverage-families.md");
  out.set(doc, fillBlocks(readFileSync(doc, "utf8"), (n) => { if (n === "coverage-kw-roles") return kwRolesBlock(rootDir); if (n === "coverage-reconcile") return reconcileBlock(rootDir); if (n !== "coverage-counts" && n !== "coverage-candidates") throw new Error(`unknown generated block: ${n}`); return coverageBlock(rootDir, n); }));
  return out;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const flag = (n: string): string | undefined => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const env = process.env[COVERAGE_RUNS_ENV];
  const runs = flag("--coverage-runs") ?? (env !== undefined && env !== "" ? env : undefined);
  const dir = runs === undefined ? undefined : resolve(runs);
  if (dir !== undefined && !existsSync(dir)) console.error(`coverage-pages: ${dir} does not exist; printing the page without run records`);
  const files = outputs(root, dir);
  const out = flag("--out");
  if (args.includes("--snapshot")) {
    if (out === undefined || dir === undefined || !existsSync(dir)) { console.error("coverage-pages: --snapshot needs --out <file> and an existing runs folder (COVERAGE_RUNS_DIR or --coverage-runs)"); process.exit(2); }
    const sup = (flag("--superseded") ?? "").split(",").map((x) => x.trim()).filter((x) => x !== "");
    writeFileSync(out, buildSnapshotPage(root, dir, sup) + "\n");
    process.exit(0);
  }
  if (out !== undefined) { writeFileSync(out, files.get(join(root, "results", "coverage.md")) ?? ""); process.exit(0); }
  if (args.includes("--check")) {
    let bad = false;
    for (const [p, c] of files) if (!existsSync(p) || readFileSync(p, "utf8") !== c) { console.error(`stale: ${p.slice(root.length + 1)} (run npm run regen)`); bad = true; }
    process.exit(bad ? 1 : 0);
  }
  for (const [p, c] of files) if (!existsSync(p) || readFileSync(p, "utf8") !== c) writeFileSync(p, c);
  console.log("coverage-pages: results/coverage.md and docs/22 block written");
}
