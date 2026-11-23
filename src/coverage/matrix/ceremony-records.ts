// SPDX-License-Identifier: Apache-2.0
// Ceremony run records (`ceremonies/<row>/**/scenario-result.json`) as an overlay for the coverage matrix. A ceremony is an outcome of
// parties run together (decision 39); it is never a conformance count, so nothing here feeds the covered / skip / not run figures.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface CeremonyRecord {
  row: string;
  scenario: string;
  status: string;
  /** Adapters named in the result's participants (for example `keyring-wallet`, `verifiable-trust-infrastructure-inprocess`, `reference-party`). */
  adapters: string[];
  countedAsConformance: boolean;
}

interface ScenarioResult {
  countedAsConformance?: boolean;
  results?: { id?: string; status?: string; participants?: Record<string, { adapter?: string }> }[];
}

export function readCeremonyRecords(dir: string): CeremonyRecord[] {
  const out: CeremonyRecord[] = [];
  const base = join(dir, "ceremonies");
  if (!existsSync(base)) return out;
  const walk = (d: string, row: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, row);
      else if (e.name === "scenario-result.json") {
        try {
          const j = JSON.parse(readFileSync(p, "utf8")) as ScenarioResult;
          for (const r of j.results ?? []) {
            if (typeof r.id !== "string") continue;
            const adapters = [...new Set(Object.values(r.participants ?? {}).map((x) => x.adapter ?? "").filter(Boolean))].sort();
            out.push({ row, scenario: r.id, status: String(r.status ?? "unknown"), adapters, countedAsConformance: j.countedAsConformance === true });
          }
        } catch {
          /* an unreadable record is left out */
        }
      }
    }
  };
  for (const e of readdirSync(base, { withFileTypes: true })) if (e.isDirectory()) walk(join(base, e.name), e.name);
  return out;
}
