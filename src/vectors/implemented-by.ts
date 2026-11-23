// SPDX-License-Identifier: Apache-2.0
// Which platforms implement a `candidate` vector's subject, derived from the recorded run folders (runs/ in the results directory,
// src/results-dir.ts), never hard-coded. Run folders are kept outside this repository (docs/04 section 21): when the results
// directory holds none, the derivation keeps the value the committed vectors already carry, so the vectors regenerate unchanged
// without them; with run folders present, `npm run check:docs` verifies that committed value against the runs.
// A platform counts as an implementer of a set of vectors when at least one of its recorded results for them is an executed one (PASS, FAIL, KNOWN-FAIL or CLARIFY: the
// adapter reached the behaviour), not SKIP (the platform lacks it). Reference adapters (the suite's own oracle) and mutant runs are never platforms.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resultsDir, runsDir } from "../results-dir.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** The run folders the derivation reads: runs/ of the results directory. */
export const defaultRunsDir = (): string => runsDir(resultsDir(root));

/** The `candidate.implementedBy` values the committed vectors carry (every vector file under vectors/, imported fixtures aside), by vector id. */
function committedImplementedBy(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walkV = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "imported") walkV(p); continue; }
      if (!e.name.endsWith(".json") || e.name === "manifest.json") continue;
      let j: { vectors?: { id: string; source?: { candidate?: { implementedBy?: string[] } } }[] };
      try { j = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
      for (const v of j.vectors ?? []) if (Array.isArray(v.source?.candidate?.implementedBy)) out.set(v.id, v.source!.candidate!.implementedBy!);
    }
  };
  walkV(join(root, "vectors"));
  return out;
}
const fromCommitted = (want: (id: string) => boolean): string[] =>
  [...new Set([...committedImplementedBy()].filter(([id]) => want(id)).flatMap(([, p]) => p))].sort();

/** Map a run's `impl` name to the platform it measures; null for the suite's own reference adapters and mutants. */
export function platformOf(impl: string): string | null {
  if (impl.startsWith("reference")) return null;
  if (impl.startsWith("keyring-wallet")) return "keyring-wallet";
  if (impl.startsWith("truststackers")) return "truststackers";
  if (impl.startsWith("verifiable-trust-infrastructure") || impl.startsWith("vti")) return "verifiable-trust-infrastructure";
  if (impl.startsWith("witness-server")) return null; // a carrier-side server, not a platform under test for these vectors
  return impl;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /^results.*\.json$/.test(e.name) ? [join(dir, e.name)] : []));
}

const EXECUTED = new Set(["PASS", "FAIL", "KNOWN-FAIL", "CLARIFY"]);

/** Platforms with an executed recorded result for at least one vector whose id matches `want`. */
export function deriveImplementedBy(want: (id: string) => boolean, runs = defaultRunsDir()): string[] {
  if (!existsSync(runs)) return fromCommitted(want);
  const out = new Set<string>();
  for (const f of walk(runs)) {
    let j: unknown;
    try { j = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
    for (const e of Array.isArray(j) ? j : [j]) {
      const run = e as { impl?: unknown; results?: { id: string; status: string }[] };
      if (typeof run?.impl !== "string" || !Array.isArray(run.results)) continue;
      const plat = platformOf(run.impl);
      if (plat !== null && run.results.some((r) => want(r.id) && EXECUTED.has(r.status))) out.add(plat);
    }
  }
  return [...out].sort();
}

/** Governance probes: platforms whose recorded governance-advisory findings include at least one probed finding (anything but GOV-NOT-PROBED). */
export function deriveImplementedByGovernance(runs = defaultRunsDir()): string[] {
  if (!existsSync(runs)) return fromCommitted((id) => id.startsWith("GOV-"));
  const out = new Set<string>();
  const stack = [runs];
  while (stack.length > 0) {
    const d = stack.pop()!;
    if (!existsSync(d)) continue;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === "governance-advisory.json") {
        try {
          const j = JSON.parse(readFileSync(p, "utf8")) as { platforms?: { platform: string; counts: Record<string, number> }[] };
          for (const pl of j.platforms ?? []) {
            const plat = platformOf(pl.platform);
            const probed = Object.entries(pl.counts).some(([k, n]) => k !== "GOV-NOT-PROBED" && n > 0);
            if (plat !== null && probed) out.add(plat);
          }
        } catch { /* unreadable run file: not evidence */ }
      }
    }
  }
  return [...out].sort();
}
