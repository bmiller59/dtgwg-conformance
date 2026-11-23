// SPDX-License-Identifier: Apache-2.0
// The exception expiry policy (exceptions/expiry-policy.json): one anchor date plus a whole-day offset per implementation key, so the
// entries of different surfaces expire on different days. The policy is the only place that sets `expires`; scripts/expiry-policy.ts
// rewrites the entries from it (npm run regen) and fails in --check mode when an entry disagrees.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExceptionEntry } from "./types.ts";

export interface ExpiryPolicy {
  format: "tt-conformance-expiry-policy/0.1";
  note: string;
  anchor: string;
  offsetDays: Record<string, number>;
}

export function loadExpiryPolicy(root: string): ExpiryPolicy {
  const p = JSON.parse(readFileSync(join(root, "exceptions", "expiry-policy.json"), "utf8")) as ExpiryPolicy;
  const problems: string[] = [];
  if (p.format !== "tt-conformance-expiry-policy/0.1") problems.push("format must be tt-conformance-expiry-policy/0.1");
  if (typeof p.anchor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.anchor) || Number.isNaN(Date.parse(`${p.anchor}T00:00:00Z`))) problems.push("anchor must be a YYYY-MM-DD date");
  for (const [k, n] of Object.entries(p.offsetDays ?? {})) if (!Number.isInteger(n) || n < 0) problems.push(`offsetDays.${k} must be a whole number of days, 0 or more`);
  if (problems.length > 0) throw new Error(`exceptions/expiry-policy.json: ${problems.join("; ")}`);
  return p;
}

/** The expiry date the policy gives an implementation key; throws for a key the policy does not list. */
export function policyExpiry(policy: ExpiryPolicy, impl: string): string {
  const n = policy.offsetDays[impl];
  if (n === undefined) throw new Error(`exceptions/expiry-policy.json: no offset for implementation key ${impl}`);
  return new Date(Date.parse(`${policy.anchor}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Entries whose `expires` differs from the policy, as "<impl> <vector>: <has> (policy <wants>)". */
export function expiryMismatches(policy: ExpiryPolicy, entries: Pick<ExceptionEntry, "impl" | "vector" | "expires">[]): string[] {
  return entries.filter((e) => e.expires !== policyExpiry(policy, e.impl)).map((e) => `${e.impl} ${e.vector}: ${e.expires} (policy ${policyExpiry(policy, e.impl)})`);
}
