// SPDX-License-Identifier: Apache-2.0
// Per-version reach of vectors/gap against a VTI source tree: which of the gap versions VTI serves (declared by a host, or routed behind a
// feature), sends, serves only at another version, or does not name at all. Read only. Writes JSON and a counts table.
//   VTI_ROOT=<VTI checkout> node --experimental-strip-types scripts/gap-reach.ts --declared <run folder>... [--matrix results/coverage/matrix.json] --out <dir>
// `--declared` takes run folders whose run.json holds a host's capabilities (the types it declared at start-up).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { classifyReach, scanReach, type ReachRow } from "../src/coverage/reach.ts";
import { scanVti } from "../src/coverage/matrix/vti.ts";
import { GAP_FAMILIES, gapTasks } from "../src/plain/gap.ts";

export function declaredTypes(runFolders: string[]): Set<string> {
  const out = new Set<string>();
  for (const f of runFolders) {
    const run = JSON.parse(readFileSync(join(f, "run.json"), "utf8")) as { implementations: { capabilities: { supportedTypes?: string[]; unlistedTypes?: string[] } }[] };
    for (const impl of run.implementations) for (const u of [...(impl.capabilities.supportedTypes ?? []), ...(impl.capabilities.unlistedTypes ?? [])]) out.add(u);
  }
  return out;
}

/** The Type URIs vectors/gap names in `requires` (the gap versions: the ones no other vector set names); a reply-only type is named only by its producer-class vector (`emit:<type>`). */
export function gapVersions(vectorsDir: string): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync(vectorsDir)) {
    if (!/^g[pe]-.*\.json$/.test(f)) continue;
    for (const v of (JSON.parse(readFileSync(join(vectorsDir, f), "utf8")) as { vectors: { requires?: string[] }[] }).vectors) for (const r0 of v.requires ?? []) { const r = r0.replace(/^emit:/, ""); if (r.startsWith("https://trusttasks.org/spec/")) out.add(r); }
  }
  return out;
}

/** Focus class per Type URI from the committed coverage matrix (results/coverage/matrix.json); an empty map when it is absent. */
export function focusOf(matrixPath: string): Map<string, "focus" | "older" | "retired"> {
  const out = new Map<string, "focus" | "older" | "retired">();
  if (!existsSync(matrixPath)) return out;
  for (const t of (JSON.parse(readFileSync(matrixPath, "utf8")) as { tasks: { typeUri: string; focus?: "focus" | "older" | "retired" }[] }).tasks) if (t.focus !== undefined) out.set(t.typeUri, t.focus);
  return out;
}

/** Counts per family by state; `other-version` is split by direction (`other-version:superseded` = VTI names only newer versions, `other-version:behind` = VTI is below this version), and `class:<reached|platform|scope>` counts the reach classes. */
export function countsByFamily(rows: ReachRow[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const f = (out[r.family] ??= { total: 0 });
    f.total = (f.total ?? 0) + 1;
    f[r.state] = (f[r.state] ?? 0) + 1;
    if (r.otherDirection !== undefined) f[`other-version:${r.otherDirection}`] = (f[`other-version:${r.otherDirection}`] ?? 0) + 1;
    f[`class:${r.reachClass}`] = (f[`class:${r.reachClass}`] ?? 0) + 1;
  }
  return out;
}

function main(): void {
  const args = process.argv.slice(2);
  const arg = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const root = process.env.VTI_ROOT;
  if (root === undefined) throw new Error("VTI_ROOT is required");
  const out = resolve(arg("out") ?? ".");
  const declaredFolders: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === "--declared") { while (args[i + 1] !== undefined && !args[i + 1]!.startsWith("--")) declaredFolders.push(resolve(args[++i]!)); }
  const gap = gapVersions(resolve(arg("vectors") ?? "vectors/gap"));
  const tasks = gapTasks(GAP_FAMILIES).filter((t) => gap.has(t.snap.typeUri));
  const focus = focusOf(resolve(arg("matrix") ?? "results/coverage/matrix.json"));
  const inputs = tasks.map((t) => ({ uri: t.snap.typeUri, family: t.snap.family, retired: t.snap.status === "retired", ...(focus.has(t.snap.typeUri) ? { focus: focus.get(t.snap.typeUri) as "focus" | "older" | "retired" } : {}) }));
  const served = new Set(scanVti(resolve(root)).served.keys());
  const rows = classifyReach(inputs, declaredTypes(declaredFolders), served, scanReach(resolve(root), inputs.map((i) => i.uri)));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "reach.json"), JSON.stringify({ root: "VTI source tree (see run record)", rows, byFamily: countsByFamily(rows) }, null, 1) + "\n");
  console.log(JSON.stringify(countsByFamily(rows), null, 1));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
