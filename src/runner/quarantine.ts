// SPDX-License-Identifier: Apache-2.0
// Quarantine of flaky vectors (docs/04 section 18.9): exceptions/quarantine.json names a vector (for one implementation, or all) whose
// result is not reproducible for a cause outside the rule under test (live network timing, a shared service). While the entry is
// current the vector still runs, but its result is recorded as QUARANTINED, with the observed outcome in the reason: advisory, in no
// gating count and never in the exit code. Like a KNOWN-FAIL exception it has an owner and an expiry, and an expired entry makes the
// result FAIL, so a vector cannot stay quarantined silently.
import { readFileSync } from "node:fs";
import { VectorLoadError } from "../vectors/load.ts";

export const QUARANTINE_FORMAT = "tt-conformance-quarantine/0.1";

export interface QuarantineEntry {
  vector: string;
  /** The implementation (capabilities name or platform) the entry applies to; absent: every implementation. */
  impl?: string;
  tier?: 1 | 2;
  /** Why the result is not reproducible (the cause outside the rule under test). */
  reason: string;
  /** Where the flakiness was observed: run folders or dates, at least one. */
  observedOn: string[];
  owner: string;
  /** YYYY-MM-DD. After this date the entry makes the result FAIL until it is fixed, renewed with a fresh observation, or removed. */
  expires: string;
}

export interface QuarantineFile { format: typeof QUARANTINE_FORMAT; quarantine: QuarantineEntry[] }

export function validateQuarantine(parsed: unknown): string[] {
  const p: string[] = [];
  const f = parsed as Partial<QuarantineFile> | null;
  if (f === null || typeof f !== "object") return ["not an object"];
  if (f.format !== QUARANTINE_FORMAT) p.push(`format must be ${QUARANTINE_FORMAT}`);
  if (!Array.isArray(f.quarantine)) return [...p, "quarantine must be an array"];
  for (const [i, x] of f.quarantine.entries()) {
    for (const k of ["vector", "reason", "owner"] as const) if (typeof x[k] !== "string" || x[k] === "") p.push(`quarantine[${i}].${k} required`);
    if (x.impl !== undefined && (typeof x.impl !== "string" || x.impl === "")) p.push(`quarantine[${i}].impl must be a non-empty string when given`);
    if (x.tier !== undefined && x.tier !== 1 && x.tier !== 2) p.push(`quarantine[${i}].tier must be 1 or 2 when given`);
    if (!Array.isArray(x.observedOn) || x.observedOn.length === 0 || !x.observedOn.every((o) => typeof o === "string" && o !== "")) p.push(`quarantine[${i}].observedOn must name at least one run folder or date`);
    if (typeof x.expires !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x.expires)) p.push(`quarantine[${i}].expires must be YYYY-MM-DD (owner and expiry are mandatory)`);
  }
  return p;
}

export function loadQuarantine(path: string): QuarantineFile {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as QuarantineFile;
  const problems = validateQuarantine(parsed);
  if (problems.length > 0) throw new VectorLoadError(problems);
  return parsed;
}

/** The entry that applies to a vector for an implementation (by capabilities name or platform) at a tier, if any. */
export function quarantineFor(entries: readonly QuarantineEntry[], vector: string, names: readonly string[], tier: 1 | 2): QuarantineEntry | undefined {
  return entries.find((q) => q.vector === vector && (q.impl === undefined || names.includes(q.impl)) && (q.tier === undefined || q.tier === tier));
}
