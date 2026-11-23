// SPDX-License-Identifier: Apache-2.0
// Computes the conformance-implied pair matrix from the recorded results.json files of the results directory (src/results-dir.ts)
// and writes interop/pair-matrix.json there and results/interop/pair-matrix.md here (a committed snapshot stamped with the run set,
// docs/04 section 21).
// This is NOT demonstrated interoperability: it counts vectors on which two platforms, each measured on its own
// against the same vectors, both did what the standard-based vector expects. See docs/14-interoperability-tracking.md.
// Usage: node --experimental-strip-types scripts/interop-matrix.ts [--check] [--results-dir <dir>]
//   --check fails if the files on disk differ; it skips (exit 0, with a message) when the results directory holds no run folders.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasRuns, noRunsMessage, resultsDir, runSetId, runsDir, takeResultsDirFlag } from "../src/results-dir.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Source { id: string; label: string; run: string; surface: string; tier1Only: true }
// truststackers is not reachable by the suite (no run, so no overlap with anything) and is listed apart in NOT_REACHABLE.
// VTI's surfaces are paired separately.
export const SOURCES: Source[] = [
  { id: "vti-live", label: "VTI live service", run: "2026-11-14-vti-26d0da81-rcpt", surface: "live community service over HTTPS (364-vector set, not re-run)", tier1Only: true },
  { id: "vti-inproc", label: "VTI agent handlers in process", run: "2026-11-16-agreed-vti-inprocess/core", surface: "agent service handlers (VTA) in one process", tier1Only: true },
  { id: "vti-vtc", label: "VTI community service in process", run: "2026-11-16-agreed-vtc-inprocess/core", surface: "community service (VTC) in process through the live-service adapter, against the service's own test host", tier1Only: true },
  { id: "kw", label: "keyring-wallet", run: "2026-11-16-agreed-keyring-wallet/core", surface: "wallet logic over a shim carrier", tier1Only: true },
];

/** Reported separately and never paired: no run, so no vector both ran. */
export const NOT_REACHABLE = [
  { label: "truststackers (original)", run: "2026-11-15-truststackers-base", reason: "the original repository's main (d7ebe8f) has no trust-task boundary or conformance adapter; 0 vectors could be run" },
];

type Status = "PASS" | "CLARIFY" | "SKIP" | "KNOWN-FAIL" | "FAIL";
interface Row { id: string; group: string; family: string; status: Status }

function load(results: string, run: string): Map<string, Row> {
  const all = JSON.parse(readFileSync(join(runsDir(results), run, "results.json"), "utf8")) as { tier: number; results: Row[] }[];
  const t1 = all.find((r) => r.tier === 1);
  if (!t1) throw new Error(`no Tier 1 block in ${run}`);
  return new Map(t1.results.map((r) => [r.id, r]));
}

export interface PairCell { ran: number; bothPass: number }
export interface PairRow { pair: string[]; total: PairCell; byGroup: Record<string, PairCell> }

export function compute(results: string = resultsDir(root)): { sources: Source[]; notReachable: typeof NOT_REACHABLE; pairs: PairRow[] } {
  const data = new Map(SOURCES.map((s) => [s.id, load(results, s.run)]));
  const ids = SOURCES.map((s) => s.id);
  const sets: string[][] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) sets.push([ids[i]!, ids[j]!]);
  // The VTI surfaces are separate measurements (two services, one of them measured two ways) and are never combined, so no set holds two.
  const pairs: PairRow[] = [];
  const vti = (s: string[]): number => s.filter((p) => p.startsWith("vti-")).length;
  for (const set of sets.filter((s) => vti(s) < 2)) {
    const total: PairCell = { ran: 0, bothPass: 0 };
    const byGroup: Record<string, PairCell> = {};
    const first = data.get(set[0]!)!;
    for (const [id, r0] of first) {
      const rs = set.map((p) => data.get(p)!.get(id));
      if (rs.some((r) => !r || r.status === "SKIP")) continue;
      const cell = (byGroup[r0.group] ??= { ran: 0, bothPass: 0 });
      cell.ran++; total.ran++;
      if (rs.every((r) => r!.status === "PASS")) { cell.bothPass++; total.bothPass++; }
    }
    pairs.push({ pair: set, total, byGroup });
  }
  return { sources: SOURCES, notReachable: NOT_REACHABLE, pairs };
}

export function render(m: ReturnType<typeof compute>, runSet: string): { json: string; md: string } {
  const label = (id: string): string => m.sources.find((s) => s.id === id)!.label;
  const json = JSON.stringify({ format: "tt-interop-pair-matrix/0.1", kind: "conformance-implied", demonstrated: false, tier: 1, sources: m.sources, notReachable: m.notReachable, pairs: m.pairs }, null, 2) + "\n";
  const lines: string[] = [
    "# Pair matrix (conformance-implied, Tier 1)",
    "",
    `> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. Generated by \`scripts/interop-matrix.ts\` from the \`results.json\` files named below (run folders in the results directory, kept outside this repository; run set \`${runSet}\`). **This is conformance-implied evidence (kind a in [docs/14](../../docs/14-interoperability-tracking.md)). It is not demonstrated interoperability: no two platforms exchanged a document in any run.** Do not edit by hand; re-run the script.`,
    "",
    "Each platform was measured alone against the same vectors. A vector counts for a pair when both platforms ran it (not SKIP) and \"both PASS\" when both did what the standard-based vector expects. A SKIP is never a PASS. VTI's surfaces are separate measurements (the agent service, and the community service live and in process) and are never combined. truststackers is not reachable by the suite (so it is in no pair). Not a ranking.",
    "",
    "## Sources",
    "",
    "| Id | Measured as | Run |",
    "|---|---|---|",
    ...m.sources.map((s) => `| ${s.id} | ${s.label}: ${s.surface} | \`runs/${s.run}/\` |`),
    "",
    "Every figure below is conformance-implied (each platform measured alone), never demonstrated interoperability.",
    "",
    "## Reported apart, in no pair",
    "",
    "| Platform | Run | Why no pair |",
    "|---|---|---|",
    ...m.notReachable.map((n) => `| ${n.label} | \`runs/${n.run}/\` | ${n.reason} |`),
    "",
    "## Totals",
    "",
    "| Pair or set (conformance-implied) | Vectors all ran | All PASS |",
    "|---|---|---|",
    ...m.pairs.map((p) => `| ${p.pair.map(label).join(" and ")} | ${p.total.ran} | ${p.total.bothPass} |`),
    "",
    "## By conformance group (the finest grain the results carry)",
    "",
  ];
  for (const p of m.pairs) {
    lines.push(`### ${p.pair.map(label).join(" and ")}`, "", "| Group | Ran | All PASS |", "|---|---|---|");
    for (const g of Object.keys(p.byGroup).sort()) lines.push(`| ${g} | ${p.byGroup[g]!.ran} | ${p.byGroup[g]!.bothPass} |`);
    lines.push("");
  }
  return { json, md: lines.join("\n") };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = takeResultsDirFlag(process.argv.slice(2));
  const results = resultsDir(root);
  if (!hasRuns(results)) {
    if (args.includes("--check")) { console.log(noRunsMessage("interop-matrix --check", results)); process.exit(0); }
    console.error(noRunsMessage("interop-matrix", results)); process.exit(1);
  }
  const out = render(compute(results), runSetId(results));
  const jp = join(results, "interop", "pair-matrix.json");
  const mp = join(root, "results", "interop", "pair-matrix.md");
  if (args.includes("--check")) {
    const same = existsSync(jp) && existsSync(mp) && readFileSync(jp, "utf8") === out.json && readFileSync(mp, "utf8") === out.md;
    if (!same) { console.error("pair matrix is out of date; re-run scripts/interop-matrix.ts"); process.exit(1); }
  } else { mkdirSync(dirname(jp), { recursive: true }); writeFileSync(jp, out.json); writeFileSync(mp, out.md); }
}
