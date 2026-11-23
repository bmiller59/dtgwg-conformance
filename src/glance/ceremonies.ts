// SPDX-License-Identifier: Apache-2.0
// The ceremony-outcome table (generated block `ceremony-rows`). Reads the ceremony run records of the results directory
// (<results>/ceremonies/<row>/<run>/scenario-result.json, written by `npm run ceremony --out`) and the number-free row descriptions in
// results/ceremony-rows.json, and prints one line per row and group with the outcome counts read from the files (src/ceremony/counts.ts).
// These are outcomes of ceremonies run together (one pair, one carrier, one date); they are never conformance counts and never added to a PASS total.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SCENARIO_STATUSES } from "../ceremony/scenario.ts";
import type { ScenarioStatus } from "../ceremony/scenario.ts";

export interface CeremonyRowCfg { row: string; pair: string; kind: "oracle" | "platform" | "live" | "wire"; groups?: string[]; note?: string }
export interface CeremonyRowsFile { format: string; rows: CeremonyRowCfg[] }
interface Result { id: string; status: ScenarioStatus }

/** What the Kind column says. `live` rows run against a deployed service container, not an in-process host: the service side is the original, and the control layer around it holds class D stand-ins (docs/35). */
const KIND_LABEL: Record<CeremonyRowCfg["kind"], string> = { oracle: "the suite's own oracle", platform: "platform rows", live: "live container rows", wire: "wire rows (real DIDComm v2 wire, live agent)" };

const groupOf = (id: string): string => /^(FC-[A-Z]+)-/.exec(id)?.[1] ?? id;

function resultFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap((n) => {
    const p = join(dir, n);
    if (n === "scenario-result.json") return [p];
    return statSync(p).isDirectory() ? resultFiles(p) : [];
  });
}

/** Counts per group for one row folder, with the ids that did not complete (failed, incomplete or inconclusive). */
export function rowGroups(rowDir: string): Map<string, { counts: Record<ScenarioStatus, number>; total: number; bad: string[] }> {
  const out = new Map<string, { counts: Record<ScenarioStatus, number>; total: number; bad: string[] }>();
  for (const f of resultFiles(rowDir)) {
    const data = JSON.parse(readFileSync(f, "utf8")) as { results: Result[] };
    for (const r of data.results) {
      if (!(SCENARIO_STATUSES as readonly string[]).includes(r.status)) throw new Error(`unknown status ${r.status} in ${r.id}`);
      const g = groupOf(r.id);
      let e = out.get(g);
      if (e === undefined) { e = { counts: Object.fromEntries(SCENARIO_STATUSES.map((s) => [s, 0])) as Record<ScenarioStatus, number>, total: 0, bad: [] }; out.set(g, e); }
      e.counts[r.status]++;
      e.total++;
      if (r.status === "failed" || r.status === "incomplete" || r.status === "inconclusive") e.bad.push(r.id);
    }
  }
  return out;
}

export function ceremonyBlock(results: string, cfg: CeremonyRowsFile): string {
  const base = join(results, "ceremonies");
  const rows: string[][] = [];
  const missing: string[] = [];
  for (const c of cfg.rows) {
    const dir = join(base, c.row);
    if (!existsSync(dir)) { missing.push(c.row); continue; }
    const groups = rowGroups(dir);
    for (const g of [...groups.keys()].sort()) {
      if (c.groups !== undefined && !c.groups.includes(g)) continue;
      const e = groups.get(g)!;
      rows.push([`${g} (${e.total})`, c.pair, KIND_LABEL[c.kind], ...SCENARIO_STATUSES.map((s) => String(e.counts[s])), e.bad.length === 0 ? "none" : e.bad.join(", ")]);
    }
  }
  if (rows.length === 0) return "No ceremony run records in this results directory, so no ceremony outcome is shown here.";
  const head = ["Group (scenarios run)", "Pair", "Kind", ...SCENARIO_STATUSES.map(String), "Not completed"];
  const esc = (s: string): string => s.replace(/\|/g, "\\|");
  const lines = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`)];
  if (missing.length > 0) lines.push("", `No record for: ${missing.join(", ")}.`);
  return lines.join("\n");
}

export function loadCeremonyRows(root: string): CeremonyRowsFile {
  return JSON.parse(readFileSync(join(root, "results", "ceremony-rows.json"), "utf8")) as CeremonyRowsFile;
}
