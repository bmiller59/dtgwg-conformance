// SPDX-License-Identifier: Apache-2.0
// Offline resolution of every vector's `tfRef` (docs/04 section 18.4): against the committed manifest (always available) and, when present, a local Trust Tasks clone.
//
// Sources of truth (read-only): a local clone of the Trust Tasks task-force repository, found via `--kit <dir>`, `TT_KIT`, or the sibling directory `dtgwg-trust-tasks-tf` of the
// suite checkout. The audit pinned it at origin/main 0dbc98f1c059af300ff84eb1ab407edea16a16c1 (the commit every tfRef carries) and the kit copy 640d498909dc2e0a6b979b8189e8b845c6b86c62.
// When the clone, or the pinned commit inside it, is absent the clone check is skipped with a message (never a silent pass, never a failure); the manifest check still runs.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultKitRoot, SUITE_ROOT } from "./source.ts";
import type { VectorSource } from "./source.ts";
import { loadTfManifest } from "./tfref.ts";
import type { TfManifest } from "./tfref.ts";

export interface FoundVector { /** A step of a ceremony scenario (docs/25), found for the spec-drift and tfRef checks only: not an id of the ledger. */ step?: true; file: string; id: string; source: VectorSource; excludedFromRun?: unknown; synthetic?: unknown; raw: Record<string, unknown> }

/** A scenario (docs/25) is found as one entry with its own id (the ledger issues it) and one entry per step source (`<id>#<step>`, for the drift and tfRef checks). */
function scenarioEntries(file: string, j: { scenarios?: Record<string, unknown>[] }): FoundVector[] {
  const out: FoundVector[] = [];
  for (const sc of j.scenarios ?? []) {
    if (typeof sc.id !== "string" || typeof sc.source !== "object") continue;
    out.push({ file, id: sc.id, source: sc.source as VectorSource, raw: sc });
    for (const st of (sc.steps ?? []) as Record<string, unknown>[]) if (typeof st.source === "object" && st.source !== null) {
      out.push({ step: true, file, id: `${sc.id}#${String(st.id)}`, source: st.source as VectorSource, raw: st });
      for (const [i, a] of ((st.also ?? []) as VectorSource[]).entries()) out.push({ step: true, file, id: `${sc.id}#${String(st.id)}+${i + 1}`, source: a, raw: st });
    }
  }
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "imported" ? [] : walk(join(dir, e.name))) : e.name.endsWith(".json") ? [join(dir, e.name)] : []));
}

/** Every vector (and governance probe) under vectors/, across all families. */
export function collectAllVectors(vectorsDir = join(SUITE_ROOT, "vectors")): FoundVector[] {
  const out: FoundVector[] = [];
  for (const f of walk(vectorsDir)) {
    let j: { vectors?: Record<string, unknown>[]; probes?: Record<string, unknown>[]; scenarios?: Record<string, unknown>[] };
    try { j = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
    for (const v of [...(j.vectors ?? []), ...(j.probes ?? [])]) {
      if (typeof v.id === "string" && typeof v.source === "object") out.push({ file: f.slice(vectorsDir.length + 1), id: v.id, source: v.source as VectorSource, excludedFromRun: v.excludedFromRun, synthetic: v.synthetic, raw: v });
    }
    out.push(...scenarioEntries(f.slice(vectorsDir.length + 1), j));
  }
  return out;
}

/** Check every tfRef against the manifest: path known, status equal, commit equal to the manifest's main commit. */
export function verifyAgainstManifest(vs: FoundVector[], m: TfManifest = loadTfManifest()): string[] {
  const problems: string[] = [];
  for (const v of vs) {
    const t = v.source.tfRef;
    if (t === undefined || t.status === "pr") continue; // an open PR is not on main; its number/head are recorded and verified online only
    const e = m.paths[t.repoPath!];
    if (e === undefined) problems.push(`${v.id}: ${t.repoPath} is not in the manifest (not a Trust Tasks path at ${m.main.commit.slice(0, 9)})`);
    else if (e.status !== t.status) problems.push(`${v.id}: tfRef.status ${t.status} but the manifest says ${e.status} for ${t.repoPath}`);
    else if (t.commit !== m.main.commit) problems.push(`${v.id}: tfRef.commit ${t.commit} is not the manifest's main commit ${m.main.commit}`);
    else if (t.status === "retired" && e.supersededBy !== t.supersededBy) problems.push(`${v.id}: supersededBy ${t.supersededBy} differs from the manifest (${e.supersededBy})`);
  }
  return problems;
}

export type CloneCheck = { skipped: string } | { checked: number; problems: string[] };

/** Check the tfRefs and the manifest against a local clone: the path exists at the cited commit and its front matter status equals the cited status. */
export function verifyAgainstClone(vs: FoundVector[], explicitClone?: string, m: TfManifest = loadTfManifest()): CloneCheck {
  const clone = defaultKitRoot(explicitClone);
  if (clone === undefined) return { skipped: "no Trust Tasks clone found (pass --kit <dir>, set TT_KIT, or place dtgwg-trust-tasks-tf next to the suite checkout): the clone check is SKIPPED; the manifest check still ran" };
  const git = (...a: string[]): string => execFileSync("git", ["-C", clone, ...a], { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] });
  try { git("cat-file", "-e", `${m.main.commit}^{commit}`); } catch { return { skipped: `the clone at ${clone} does not have commit ${m.main.commit} (fetch it, or use a clone that does): the clone check is SKIPPED` }; }
  const problems: string[] = [];
  const seen = new Set<string>();
  let checked = 0;
  for (const v of vs) {
    const t = v.source.tfRef;
    if (t === undefined || t.status === "pr") continue;
    const key = `${t.commit}:${t.repoPath}:${t.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    checked++;
    let text: string;
    try { text = git("show", `${t.commit}:${t.repoPath}`); } catch { problems.push(`${v.id}: ${t.repoPath} does not exist at ${t.commit!.slice(0, 9)}`); continue; }
    if (t.repoPath!.startsWith("specs/")) {
      const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
      const st = /^status:\s*(\S+)/m.exec(fm)?.[1]?.replace(/^["']|["']$/g, "");
      const want = t.status === "retired" ? "retired" : "draft";
      if (st !== want) problems.push(`${v.id}: ${t.repoPath} has front matter status ${st ?? "none"} but tfRef.status is ${t.status}`);
    }
  }
  return { checked, problems };
}

export const hasClone = (explicit?: string): boolean => defaultKitRoot(explicit) !== undefined && existsSync(defaultKitRoot(explicit)!);
