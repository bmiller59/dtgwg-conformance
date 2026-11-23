// SPDX-License-Identifier: Apache-2.0
// Assembles the results directory the generated pages are checked against (docs/04 section 21), so it can be rebuilt instead of
// kept as a hand-made copy: a base results directory (run folders, run index, baseline, pair matrix data and the ceremony records
// already in it) plus what results/ceremony-overlay.json names, copied over it: ceremony run records (`entries`, one folder or, with `each`, every child folder), whole run folders (`runs`, copied to runs/<name>/) and replacement files (`files`: the run index, run READMEs). Every source root is documented in the overlay's `sources`; the root `repo` is this repository.
// Usage: node --experimental-strip-types scripts/assemble-results-set.ts --base <dir> --out <dir> --root <label>=<dir> [--root ...] [--dry-run]
//   --base     an existing results directory (it is copied; never modified)
//   --out      the directory to write (must not exist, so nothing is overwritten)
//   --root     one label for each source root used in the overlay file (the label is the first path part of an entry's `source`)
//   --dry-run  prints what would be copied and writes nothing
// Exits 1 on any missing root, missing source folder, or existing output directory.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** `each`: the source is a folder of run folders (each holding scenario-result.json); every child is copied to ceremonies/<row>/<child>/ (`as` is not used). */
export interface OverlayEntry { row: string; as?: string; source: string; each?: boolean }
/** A whole run folder (everything in it) copied to runs/<name>/ of the output. `label` and `note` document where it comes from. */
export interface OverlayRun { name: string; source: string; label?: string; note?: string }
/** One file copied to <as> (a path below the output directory), replacing the base's file of that name (run index, run READMEs). */
export interface OverlayFile { source: string; as: string; note?: string }
/** `sources` documents each root label used by a source path: what it is and where it lives (never a local path; the roots come on the command line). The label `repo` is this repository and needs no --root. */
export interface OverlaySource { root: string; about: string }
export interface Overlay { format: string; sources?: OverlaySource[]; entries: OverlayEntry[]; runs?: OverlayRun[]; files?: OverlayFile[] }

function resolveSource(source: string, roots: Record<string, string>, what: string): string {
  const slash = source.indexOf("/");
  const label = slash < 0 ? source : source.slice(0, slash);
  const root = roots[label];
  if (slash < 0 || root === undefined) throw new Error(`no --root for "${label}" (${what})`);
  return join(root, source.slice(slash + 1));
}

/** Resolves each ceremony entry to [source folder, destination folder below the output directory]; throws on a missing root or source. */
export function plan(overlay: Overlay, roots: Record<string, string>, out: string): [string, string][] {
  return overlay.entries.flatMap((e): [string, string][] => {
    const src = resolveSource(e.source, roots, `entry ${e.row}/${e.as ?? "*"}`);
    if (e.each === true) {
      if (!existsSync(src) || !statSync(src).isDirectory()) throw new Error(`no folder ${src} (entry ${e.row}/*)`);
      const kids = readdirSync(src).sort().filter((k) => existsSync(join(src, k, "scenario-result.json")));
      if (kids.length === 0) throw new Error(`no scenario-result.json below ${src} (entry ${e.row}/*)`);
      return kids.map((k) => [join(src, k), join(out, "ceremonies", e.row, k)]);
    }
    if (e.as === undefined) throw new Error(`entry ${e.row} has neither "as" nor "each"`);
    if (!existsSync(join(src, "scenario-result.json"))) throw new Error(`no scenario-result.json in ${src} (entry ${e.row}/${e.as})`);
    return [[src, join(out, "ceremonies", e.row, e.as)]];
  });
}

/** Whole-folder run copies and single-file replacements, resolved the same way; throws on a missing root or source. */
export function planRuns(overlay: Overlay, roots: Record<string, string>, out: string): { runs: [string, string][]; files: [string, string][] } {
  const runs = (overlay.runs ?? []).map((r): [string, string] => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(r.name)) throw new Error(`bad run folder name "${r.name}"`);
    const src = resolveSource(r.source, roots, `run ${r.name}`);
    if (!existsSync(src) || !statSync(src).isDirectory()) throw new Error(`no run folder ${src} (run ${r.name})`);
    return [src, join(out, "runs", r.name)];
  });
  const files = (overlay.files ?? []).map((f): [string, string] => {
    const src = resolveSource(f.source, roots, `file ${f.as}`);
    if (!existsSync(src) || !statSync(src).isFile()) throw new Error(`no file ${src} (file ${f.as})`);
    if (f.as.startsWith("/") || f.as.split("/").includes("..")) throw new Error(`bad destination "${f.as}"`);
    return [src, join(out, f.as)];
  });
  return { runs, files };
}

/** Root labels used by the overlay that its `sources` list does not document (the label `repo` is always known). */
export function undocumentedRoots(overlay: Overlay): string[] {
  const known = new Set(["repo", ...(overlay.sources ?? []).map((s) => s.root)]);
  const used = [...overlay.entries, ...(overlay.runs ?? []), ...(overlay.files ?? [])].map((x) => x.source.split("/")[0]!);
  return [...new Set(used)].filter((u) => !known.has(u)).sort();
}

/** Copies the base, then the overlay: ceremony records (only scenario-result.json of each source, which the table reads alone), whole run folders, replacement files. */
export function assemble(base: string, out: string, overlay: Overlay, roots: Record<string, string>, dryRun: boolean): string[] {
  if (!statSync(base).isDirectory()) throw new Error(`base is not a directory: ${base}`);
  if (existsSync(out)) throw new Error(`output exists, not overwriting: ${out}`);
  const steps = plan(overlay, roots, out);
  const { runs, files } = planRuns(overlay, roots, out);
  const log = [`copy ${base} -> ${out}`, ...steps.map(([s, d]) => `copy ${s} -> ${d}`), ...runs.map(([s, d]) => `copy run folder ${s} -> ${d}`), ...files.map(([s, d]) => `copy file ${s} -> ${d}`)];
  if (dryRun) return log;
  cpSync(base, out, { recursive: true });
  for (const [s, d] of steps) {
    mkdirSync(d, { recursive: true });
    cpSync(s, d, { recursive: true, filter: (p) => (statSync(p).isDirectory() ? basename(p) !== "superseded" : p.endsWith("scenario-result.json")) }); // a `superseded` folder inside a source holds earlier passes of the same run and is never a record
  }
  for (const [s, d] of runs) {
    if (existsSync(d)) throw new Error(`run folder already in the base, not overwriting: ${d}`);
    cpSync(s, d, { recursive: true });
  }
  for (const [s, d] of files) { mkdirSync(dirname(d), { recursive: true }); cpSync(s, d); }
  return log;
}

function main(argv: string[]): number {
  const opt = (n: string): string[] => argv.flatMap((a, i) => (a === n ? [argv[i + 1] ?? ""] : []));
  const base = opt("--base")[0], out = opt("--out")[0];
  const here = dirname(fileURLToPath(import.meta.url));
  const roots: Record<string, string> = { repo: resolve(here, "..") };
  for (const r of opt("--root")) { const i = r.indexOf("="); if (i > 0) roots[r.slice(0, i)] = resolve(r.slice(i + 1)); }
  if (!base || !out) { console.error("usage: assemble-results-set.ts --base <dir> --out <dir> --root <label>=<dir> [--dry-run]"); return 2; }
  const overlay = JSON.parse(readFileSync(join(here, "..", "results", "ceremony-overlay.json"), "utf8")) as Overlay;
  try { const bad = undocumentedRoots(overlay); if (bad.length > 0) throw new Error(`overlay uses undocumented source roots: ${bad.join(", ")}`); for (const l of assemble(resolve(base), resolve(out), overlay, roots, argv.includes("--dry-run"))) console.log(l); } catch (e) { console.error(String(e instanceof Error ? e.message : e)); return 1; }
  return 0;
}
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
