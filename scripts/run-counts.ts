// SPDX-License-Identifier: Apache-2.0
// Counts the statuses in each run folder of a run set, per implementation, tier and vector group, from the folder's own results.json
// (or results-advisory.json for a non-gating channel; never from a summary), and writes counts.json beside the folders. Usage:
//   node --experimental-strip-types scripts/run-counts.ts <run set folder>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Counts { [status: string]: number }
export interface RunCounts { run: string; impl: string; tier: number; total: Counts; byGroup: Record<string, Counts>; skipReasons: Record<string, number> }

interface Row { id: string; status: string; reason?: string }

/** Statuses per block of a results.json (an array of blocks, one per implementation and tier). */
export function countRun(run: string, results: unknown): RunCounts[] {
  const out: RunCounts[] = [];
  for (const b of results as { impl: string; tier: number; results: Row[] }[]) {
    const total: Counts = {};
    const byGroup: Record<string, Counts> = {};
    const skipReasons: Record<string, number> = {};
    for (const r of b.results) {
      total[r.status] = (total[r.status] ?? 0) + 1;
      const g = r.id.slice(0, r.id.lastIndexOf("-"));
      (byGroup[g] ??= {})[r.status] = (byGroup[g]?.[r.status] ?? 0) + 1;
      if (r.status === "SKIP") {
        // the reason with the type URI replaced, so reasons of one kind add up
        const k = (r.reason ?? "no reason").replace(/https:\/\/\S+/g, "<type>");
        skipReasons[k] = (skipReasons[k] ?? 0) + 1;
      }
    }
    out.push({ run, impl: b.impl, tier: b.tier, total, byGroup, skipReasons });
  }
  return out;
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("run-counts.ts") && process.argv[2] !== undefined) {
  const dir = process.argv[2];
  const all: RunCounts[] = [];
  for (const n of readdirSync(dir).sort()) {
    // a run of a non-gating channel (proposed, candidate) writes its results to <out>-advisory/results-advisory.json
    const f = existsSync(join(dir, n, "results-advisory.json")) ? join(dir, n, "results-advisory.json") : join(dir, n, "results.json");
    if (existsSync(f)) all.push(...countRun(n, JSON.parse(readFileSync(f, "utf8"))));
  }
  writeFileSync(join(dir, "counts.json"), JSON.stringify({ note: "Counted from each run folder's results.json by scripts/run-counts.ts.", runs: all }, null, 1) + "\n");
  console.log(`${all.length} blocks`);
}
