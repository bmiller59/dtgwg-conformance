// SPDX-License-Identifier: Apache-2.0
// Runs every generator that writes tracked files: the vector generators, the vector id ledger, the exception expiries (from
// exceptions/expiry-policy.json), the interop pair matrix and ledger view,
// the at-a-glance page, the generated documentation blocks (scripts/docs-blocks.ts) and the version-grain coverage page
// (scripts/coverage-pages.ts; takes an optional folder of coverage run records, COVERAGE_RUNS_DIR, and needs none), in that order.
// Usage: node --experimental-strip-types scripts/regen.ts [--check] [--results-dir <dir>]
//   --check  writes nothing: vector generators write to a temporary directory that is compared with vectors/,
//            the other generators run in their own --check mode, and the link, banner and claims-lint tests run. Exits 1 when anything is stale.
// The interop pair matrix, the at-a-glance page and the documentation blocks are generated from the run folders of the results
// directory (src/results-dir.ts; docs/04 section 21). When it holds none, regen leaves those committed snapshots as they are and
// --check skips them with a message; the vectors' derived `implementedBy` keeps its committed value (src/vectors/implemented-by.ts).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasRuns, noRunsMessage, resultsDir, takeResultsDirFlag } from "../src/results-dir.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = takeResultsDirFlag(process.argv.slice(2));
const check = args.includes("--check");
const results = resultsDir(root);
const withRuns = hasRuns(results);
const node = (script: string, ...args: string[]): boolean => {
  try { execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(root, "scripts", script), ...args], { cwd: root, stdio: ["ignore", check ? "ignore" : "inherit", "inherit"] }); return true; } catch { return false; }
};
// generator, and the directory it writes (each takes an output directory as its first argument)
const VECTORS: [string, string][] = [
  ["generate-vectors.ts", "vectors"], ["generate-plain.ts", "vectors/plain"], ["generate-emit.ts", "vectors/emit"],
  ["generate-emit-more.ts", "vectors/emit-more"], ["generate-witness-vectors.ts", "vectors/witness"], ["generate-2l.ts", "vectors/2l"],
  ["generate-governance.ts", "vectors/governance"], ["generate-coverage.ts", "vectors/coverage"], ["generate-probe.ts", "vectors/probe"], ["generate-ceremony-scenarios.ts", "vectors/ceremony-scenarios"],
  ["generate-gap.ts", "vectors/gap"], ["generate-complete.ts", "vectors/complete"], ["generate-alignment.ts", "vectors/alignment"],
];

function sameFiles(gen: string, committed: string): boolean {
  for (const f of readdirSync(gen)) {
    const p = join(gen, f);
    if (statSync(p).isDirectory()) { if (!sameFiles(p, join(committed, f))) return false; continue; }
    try { if (readFileSync(p, "utf8") !== readFileSync(join(committed, f), "utf8")) return false; } catch { return false; }
  }
  return true;
}

let bad: string[] = [];
for (const [g, dir] of VECTORS) {
  if (!check) { if (!node(g, join(root, dir))) bad.push(g); continue; }
  const tmp = mkdtempSync(join(tmpdir(), "tt-regen-"));
  try { if (!node(g, tmp) || !sameFiles(tmp, join(root, dir))) bad.push(`${g} (${dir})`); } finally { rmSync(tmp, { recursive: true, force: true }); }
}
const FROM_RUNS = new Set(["interop-matrix.ts", "at-a-glance.ts", "docs-blocks.ts"]);
for (const g of ["id-ledger.ts", "expiry-policy.ts", "interop-matrix.ts", "interop-ledger-view.ts", "at-a-glance.ts", "docs-blocks.ts", "coverage-pages.ts"]) {
  if (FROM_RUNS.has(g) && !withRuns) continue;
  if (!node(g, ...(check ? ["--check"] : []))) bad.push(g);
}
if (!withRuns) console.log(noRunsMessage(`regen${check ? " --check" : ""}: interop-matrix, at-a-glance and docs-blocks`, results));
// In --check mode the recorded task-force pins must agree (scripts/check-pins.ts), and then run the page checks: links resolve, every page carries the status banner, and no page uses a claim word.
if (check) {
  if (!node("check-pins.ts")) bad.push("check-pins.ts (the generators' recorded task-force commits disagree; run npm run check:pins)");
  try {
    execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--test", join(root, "test", "links.test.ts"), join(root, "test", "banner.test.ts"), join(root, "test", "claims-lint.test.ts")], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
  } catch { bad.push("test/links.test.ts, test/banner.test.ts or test/claims-lint.test.ts (run them, or scripts/lint-claims.ts, for details)"); }
}
if (bad.length > 0) { console.error(`${check ? "stale" : "failed"}: ${bad.join(", ")}`); process.exit(1); }
console.log(check ? `regen --check: everything ${withRuns ? "" : "else "}is current` : "regen: done");
