// SPDX-License-Identifier: Apache-2.0
// Writes results/AT-A-GLANCE.md and results/at-a-glance.html from the run folders of the results directory (src/results-dir.ts).
// Usage: node --experimental-strip-types scripts/at-a-glance.ts [--check] [--results-dir <dir>]
//   The pages are committed snapshots stamped with the run set they were generated from (docs/04 section 21).
//   --check  fails when the files on disk differ from what would be generated; skips (exit 0, with a message) when the
//            results directory holds no run folders.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel } from "../src/glance/model.ts";
import { buildDoc, renderHtml, renderMd } from "../src/glance/render.ts";
import { hasRuns, noRunsMessage, resultsDir, takeResultsDirFlag } from "../src/results-dir.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function generate(rootDir: string, results: string = resultsDir(rootDir)): { md: string; html: string } {
  const model = buildModel(rootDir, results);
  const doc = buildDoc(model);
  return { md: renderMd(doc), html: renderHtml(doc, model.runSet) };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = takeResultsDirFlag(process.argv.slice(2));
  const results = resultsDir(root);
  if (!hasRuns(results)) {
    if (args.includes("--check")) { console.log(noRunsMessage("at-a-glance --check", results)); process.exit(0); }
    console.error(noRunsMessage("at-a-glance", results)); process.exit(1);
  }
  const out = generate(root, results);
  const files: [string, string][] = [[join(root, "results", "AT-A-GLANCE.md"), out.md], [join(root, "results", "at-a-glance.html"), out.html]];
  if (args.includes("--check")) {
    let bad = false;
    for (const [p, c] of files) if (!existsSync(p) || readFileSync(p, "utf8") !== c) { console.error(`stale: ${p} (run npm run regen)`); bad = true; }
    process.exit(bad ? 1 : 0);
  }
  for (const [p, c] of files) writeFileSync(p, c);
  console.log("wrote results/AT-A-GLANCE.md and results/at-a-glance.html");
}
