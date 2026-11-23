// SPDX-License-Identifier: Apache-2.0
// Assesses how the suite lines up with the Trust Tasks task-force repository (docs/tf-alignment.md). Read-only on the checkout.
//   npm run tf-alignment -- <path to the task-force checkout> [--ref <git revision>] [--out <dir>]
// Writes results/tf-alignment.json and results/tf-alignment.md (or into --out). Without --ref it reads the working tree; with --ref it reads
// that revision (for example origin/main) without switching the checkout. Exit 0 whether or not drift is found: the output is the finding.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyse } from "../src/tfalign/analyse.ts";
import { renderReport } from "../src/tfalign/report.ts";
import { openTf } from "../src/tfalign/source.ts";

const suiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n: string): string | undefined => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const flagged = new Set(["--ref", "--out"]);
const pos = args.filter((a, i) => !a.startsWith("--") && !flagged.has(args[i - 1] ?? ""));
if (pos.length !== 1 || args.includes("--help")) {
  console.error("usage: npm run tf-alignment -- <task-force checkout> [--ref <git revision>] [--out <directory, default results>]");
  process.exit(2);
}
const out = resolve(opt("--out") ?? join(suiteRoot, "results"));
const tf = openTf(resolve(pos[0]!), opt("--ref"));
try {
  const result = analyse(tf, { suiteRoot });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "tf-alignment.json"), JSON.stringify(result, null, 2) + "\n");
  writeFileSync(join(out, "tf-alignment.md"), renderReport(result as Record<string, unknown>));
  console.log(`wrote ${join(out, "tf-alignment.json")} and tf-alignment.md`);
} finally { tf.cleanup(); }
