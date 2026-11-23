// SPDX-License-Identifier: Apache-2.0
// Fills the generated blocks (`<!-- generated:NAME -->` ... `<!-- /generated:NAME -->`) in README.md,
// platforms.md, results/README.md, results/vector-review.md and results/platforms/*.md, writes
// results/independent-implementations.md (src/glance/independent.ts), and in the results directory (src/results-dir.ts) writes
// runs/INDEX.md and keeps the "Superseded" banner on every superseded run README. All figures come from the at-a-glance model
// (src/glance). The pages in this repository are committed snapshots stamped with the run set they came from (docs/04 section 21).
// Usage: node --experimental-strip-types scripts/docs-blocks.ts [--check] [--results-dir <dir>]
//   --check  fails when any file differs from what would be generated; skips (exit 0, with a message) when the results directory
//            holds no run folders.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, type Model } from "../src/glance/model.ts";
import { hasRuns, noRunsMessage, resultsDir, runsDir, takeResultsDirFlag } from "../src/results-dir.ts";
import { buildIndependent, independentBlock, independentPage } from "../src/glance/independent.ts";
import { baselineBlock } from "../src/glance/baseline.ts";
import { ceremonyBlock, loadCeremonyRows } from "../src/glance/ceremonies.ts";
import { asOf, clarifyClasses, coverageTables, estimatedCoverage, exceptionClasses, oracleGaps, exceptionsLine, failTable, familyTable, latestRuns, platformBlock, renderRunIndex, runIndex, statusTable, supersededBanner } from "../src/glance/docs.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function render(name: string, rootDir: string, model: Model, base: string): string {
  if (name.startsWith("platform:")) return platformBlock(rootDir, model, name.slice(9));
  switch (name) {
    case "status": return statusTable(model, base);
    case "status-asof": return asOf(model);
    case "coverage": return coverageTables(model, base);
    case "estimated-coverage": return estimatedCoverage(rootDir, model, base);
    case "families": return familyTable(rootDir);
    case "fails": return failTable(rootDir, model, base);
    case "exceptions": return exceptionsLine(rootDir, base);
    case "exception-classes": return exceptionClasses(rootDir, base);
    case "clarify-classes": return clarifyClasses(rootDir, model, base);
    case "oracle-gaps": return oracleGaps(rootDir, model, base);
    case "latest-runs": return latestRuns(model);
    case "ceremony-rows": return ceremonyBlock(model.results, loadCeremonyRows(rootDir));
    case "before-after": return baselineBlock(rootDir, model, base);
    case "independent-implementations": return independentBlock(buildIndependent(rootDir, model), base);
    default: throw new Error(`unknown generated block: ${name}`);
  }
}

const BLOCK = /<!-- generated:([\w:-]+) -->\n[\s\S]*?<!-- \/generated:\1 -->/g;

export function fillBlocks(text: string, fill: (name: string) => string): string {
  return text.replace(BLOCK, (_m, name: string) => `<!-- generated:${name} -->\n${fill(name).trimEnd()}\n<!-- /generated:${name} -->`);
}

/** runs/INDEX.md and the Superseded banner of every superseded run README, in the results directory. */
function runIndexOutputs(rootDir: string, model: Model, out: Map<string, string>): void {
  const idx = runIndex(rootDir, model);
  out.set(join(runsDir(model.results), "INDEX.md"), renderRunIndex(idx));
  for (const s of idx.superseded) {
    const p = join(runsDir(model.results), s.run, "README.md");
    if (!existsSync(p)) continue;
    const lines = readFileSync(p, "utf8").split("\n");
    const banner = supersededBanner(s.by);
    const at = lines.findIndex((l) => l.startsWith("> **Superseded**"));
    if (at >= 0) lines[at] = banner;
    else lines.splice(1, 0, "", banner);
    out.set(p, lines.join("\n"));
  }
}

/** Every file this script owns, with the content it should have. */
export function outputs(rootDir: string, results: string = resultsDir(rootDir)): Map<string, string> {
  const model = buildModel(rootDir, results);
  const out = new Map<string, string>();
  const targets = ["README.md", "STATUS.md", "platforms.md", "results/README.md", "results/vector-review.md"];
  const pdir = join(rootDir, "results", "platforms");
  if (existsSync(pdir)) for (const f of readdirSync(pdir).sort()) if (f.endsWith(".md")) targets.push(`results/platforms/${f}`);
  for (const t of targets) {
    const p = join(rootDir, t);
    if (!existsSync(p)) continue;
    const base = "../".repeat(t.split("/").length - 1);
    out.set(p, fillBlocks(readFileSync(p, "utf8"), (name) => render(name, rootDir, model, base)));
  }
  runIndexOutputs(rootDir, model, out);
  out.set(join(rootDir, "results", "independent-implementations.md"), independentPage(buildIndependent(rootDir, model)));
  return out;
}

/** Paths (relative to the root, or to the results directory for files there) whose content on disk differs from what would be generated. */
export function stale(rootDir: string, results: string = resultsDir(rootDir)): string[] {
  const bad: string[] = [];
  for (const [p, c] of outputs(rootDir, results)) if (!existsSync(p) || readFileSync(p, "utf8") !== c) bad.push(p.startsWith(results + "/") ? `${relative(results, p)} (results directory)` : relative(rootDir, p));
  return bad;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = takeResultsDirFlag(process.argv.slice(2));
  const results = resultsDir(root);
  if (!hasRuns(results)) {
    if (args.includes("--check")) { console.log(noRunsMessage("docs-blocks --check", results)); process.exit(0); }
    console.error(noRunsMessage("docs-blocks", results)); process.exit(1);
  }
  if (args.includes("--check")) {
    const bad = stale(root, results);
    for (const b of bad) console.error(`stale: ${b} (run npm run regen)`);
    process.exit(bad.length > 0 ? 1 : 0);
  }
  let n = 0;
  for (const [p, c] of outputs(root, results)) if (!existsSync(p) || readFileSync(p, "utf8") !== c) { writeFileSync(p, c); n++; }
  console.log(`docs-blocks: ${n} file(s) written`);
}
