// SPDX-License-Identifier: Apache-2.0
// Mechanical pre-screen for registry promotion (docs/33). Reads vector files and recorded runs; writes a machine-readable result.
// Usage: node --experimental-strip-types scripts/prescreen.ts --run-root <dir>... [--vectors vectors] [--population <json>]
//          [--surface agent|community|agent+community] [--include-emit] [--exclude <regex>] [--keep-probes] --out <file.json>
//   --run-root    one recorded run set per flag (a directory tree of run.json + results*.json); repeat. A "run" is one root.
//   --population  JSON array of ids (or of {vec}) to screen; default: every non-registry vector. Judged on --surface (both VTI surfaces jointly:
//                 it must have run on at least one, and every run on either must be the same PASS).
//   --surface     surfaces judged when the population gives none (default agent+community).
//   --reference-include  regex: only reference-adapter results from matching paths count as oracle evidence (default: every root given).
//   Only the original VTI in-process hosts count; folders excluded by name and superseded folders are skipped (override with --exclude).
//   Probes (family probe) are reported as `probe` and not promotable unless --keep-probes (D353).
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEvidence, loadVectors, EXCLUDED_RUN_FOLDERS } from "../src/promotion/evidence.ts";
import { screen, tally, type ScreenResult } from "../src/promotion/prescreen.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const all = (f: string): string[] => args.flatMap((a, i) => (a === f && args[i + 1] !== undefined ? [args[i + 1]!] : []));
const one = (f: string): string | undefined => all(f)[0];

export const FORMAT = "tt-conformance-prescreen/0.1";

function main(): void {
  const roots = all("--run-root").map((r) => resolve(r));
  if (roots.length === 0) throw new Error("at least one --run-root is required");
  const out = one("--out");
  if (out === undefined) throw new Error("--out <file.json> is required");
  const vecs = loadVectors(resolve(one("--vectors") ?? join(root, "vectors")));
  const exclude = one("--exclude") === undefined ? EXCLUDED_RUN_FOLDERS : new RegExp(one("--exclude")!);
  const { ev, counted } = loadEvidence({ roots, exclude, includeEmit: args.includes("--include-emit"), ...(one("--reference-include") === undefined ? {} : { referenceInclude: new RegExp(one("--reference-include")!) }) });
  const defSurf = (one("--surface") ?? "agent+community").split("+");
  const popFile = one("--population");
  const pop: { vec: string; surface: string[] }[] = [];
  if (popFile !== undefined) {
    const raw = JSON.parse(readFileSync(resolve(popFile), "utf8")) as (string | { vec: string; surface?: string })[];
    const seen = new Set<string>();
    for (const r of raw) {
      const id = typeof r === "string" ? r : r.vec;
      const s = typeof r === "string" || r.surface === undefined ? defSurf : r.surface.split("+");
      const k = `${id}\0${s.join("+")}`; if (!seen.has(k)) { seen.add(k); pop.push({ vec: id, surface: s }); }
    }
  } else for (const v of vecs.values()) if (v.channel !== "registry") pop.push({ vec: v.id, surface: defSurf });
  const rows: ScreenResult[] = [];
  const missing: string[] = [];
  for (const p of pop) {
    const v = vecs.get(p.vec);
    if (v === undefined) { missing.push(p.vec); continue; }
    if (v.channel === "registry") continue; // already gating: nothing to screen
    rows.push(screen(v, p.surface, ev, { excludeProbes: !args.includes("--keep-probes") }));
  }
  // a vector screened on several surfaces is clean only when clean on every row it appears in
  const byId = new Map<string, ScreenResult[]>();
  for (const r of rows) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
  const distinct = [...byId.entries()].map(([id, rs]) => ({ id, clean: rs.every((r) => r.clean), promotable: rs.every((r) => r.promotable), probe: rs[0]!.probe, set: rs[0]!.set }));
  const summary = {
    rowsScreened: rows.length, distinctVectors: distinct.length, notFound: missing.length,
    clean: distinct.filter((d) => d.clean).length, promotable: distinct.filter((d) => d.promotable).length, cleanProbes: distinct.filter((d) => d.clean && d.probe).length,
    failTally: tally(rows), cleanBySet: distinct.filter((d) => d.clean).reduce<Record<string, number>>((m, d) => { m[d.set] = (m[d.set] ?? 0) + 1; return m; }, {}),
  };
  writeFileSync(out, JSON.stringify({ format: FORMAT, runRoots: roots, runFoldersCounted: counted.length, exclude: String(exclude), surfaces: defSurf, summary, missing, vectors: rows }, null, 1) + "\n");
  console.log(`${summary.distinctVectors} distinct vectors (${summary.rowsScreened} rows): ${summary.clean} pass every mechanical check, ${summary.promotable} promotable (probes excluded: ${summary.cleanProbes}); wrote ${out}`);
}
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main();
