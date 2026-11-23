// SPDX-License-Identifier: Apache-2.0
// Counts of the outcomes in ceremony result files (scenario-result.json), by status, so a run README quotes numbers read from the files and never typed by hand.
// Usage: node --experimental-strip-types src/ceremony/counts.ts <folder or scenario-result.json> ...
// These are outcomes of ceremonies run together, never conformance counts and never added to a PASS total.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SCENARIO_STATUSES } from "./scenario.ts";
import type { ScenarioStatus } from "./scenario.ts";

export interface ResultFile { participants?: Record<string, string>; results: { id: string; status: ScenarioStatus; terminal: string | null; reason: string }[] }
export type Counts = Record<ScenarioStatus, number> & { total: number };

export function countStatuses(f: ResultFile): Counts {
  const c = Object.fromEntries(SCENARIO_STATUSES.map((s) => [s, 0])) as Counts;
  c.total = 0;
  for (const r of f.results) {
    if (!(SCENARIO_STATUSES as readonly string[]).includes(r.status)) throw new Error(`unknown status ${r.status} in ${r.id}`);
    c[r.status]++;
    c.total++;
  }
  return c;
}

/** One markdown row per file: the columns are the statuses in the suite's own order. */
export function markdownTable(rows: { label: string; counts: Counts }[]): string {
  const head = `| Run | ${SCENARIO_STATUSES.join(" | ")} | total |`;
  const sep = `|---|${SCENARIO_STATUSES.map(() => "---").join("|")}|---|`;
  return [head, sep, ...rows.map((r) => `| ${r.label} | ${SCENARIO_STATUSES.map((s) => r.counts[s]).join(" | ")} | ${r.counts.total} |`)].join("\n");
}

function files(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((n) => (n === "scenario-result.json" ? [join(path, n)] : statSync(join(path, n)).isDirectory() ? files(join(path, n)) : []));
}

if (process.argv[1]?.endsWith("counts.ts")) {
  const rows = process.argv.slice(2).flatMap(files).map((p) => ({ label: p, counts: countStatuses(JSON.parse(readFileSync(p, "utf8")) as ResultFile) }));
  console.log(markdownTable(rows));
}
