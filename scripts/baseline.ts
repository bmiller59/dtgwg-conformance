// SPDX-License-Identifier: Apache-2.0
// Writes baseline-<commit>.json once, in the results directory (src/results-dir.ts): the headline figures per surface as the glance
// model AT that suite commit computed them (its own src/glance/model.ts and vectors, read with `git archive`, over the run folders
// tracked there at a commit from before run records moved out of the repository, or else over the results directory's run folders),
// for the before/after block of results/README.md (src/glance/baseline.ts). Regen never runs this: the file is a fixed record.
// Usage: node --experimental-strip-types scripts/baseline.ts [<commit>] [--results-dir <dir>]   (default commit: BASELINE_COMMIT)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BASELINE_COMMIT, baselineOf } from "../src/glance/baseline.ts";
import { resultsDir, takeResultsDirFlag } from "../src/results-dir.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = takeResultsDirFlag(process.argv.slice(2));
const short = args[0] ?? BASELINE_COMMIT;
const commit = execFileSync("git", ["rev-parse", "--verify", `${short}^{commit}`], { cwd: root, encoding: "utf8" }).trim();
const tree = mkdtempSync(join(tmpdir(), "tt-baseline-"));
try {
  execFileSync("sh", ["-c", `git archive ${commit} | tar -x -C "$1"`, "sh", tree], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
  symlinkSync(join(root, "node_modules"), join(tree, "node_modules"));
  const { buildModel, loadCatalog } = (await import(join(tree, "src", "glance", "model.ts"))) as typeof import("../src/glance/model.ts");
  // A model from before the move reads <tree>/results/runs and ignores the second argument.
  const b = baselineOf(buildModel(tree, resultsDir(root)), loadCatalog(tree), commit);
  const out = join(resultsDir(root), `baseline-${short}.json`);
  writeFileSync(out, JSON.stringify(b, null, 2) + "\n");
  console.log(`wrote ${out}: ${b.surfaces.length} surfaces, ${b.registryCore.length} registry core vectors at ${commit.slice(0, 7)}`);
} finally {
  rmSync(tree, { recursive: true, force: true });
}
