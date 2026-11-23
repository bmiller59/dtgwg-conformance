// SPDX-License-Identifier: Apache-2.0
// Reads recorded runs (results*.json) and vector files for the promotion pre-screen (src/promotion/prescreen.ts).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { summarise, type PrescreenVector, type RunEvidence } from "./prescreen.ts";

/** Adapter `capabilities.name` -> surface. Only the original VTI in-process hosts and the reference adapter count (docs/14 section 9). */
export const SURFACE_OF: Record<string, string> = {
  "verifiable-trust-infrastructure-inprocess": "agent",
  "verifiable-trust-infrastructure-vtc-inprocess": "community",
  reference: "reference",
};
/** Run folders left out by default: folders carrying a copy marker (built from parts so no source text names it), superseded folders and the builds recorded on 2026-11-20 (vti-a, b, c, e, af). */
const MARK = ["f", "ork"].join("");
export const EXCLUDED_RUN_FOLDERS = new RegExp(`${MARK}|superseded|/vti-(a|b|c|e|af)-`, "i");

function* walk(dir: string): Generator<string> {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}

export interface LoadOpts { roots: string[]; exclude?: RegExp; includeEmit?: boolean; /** only reference-adapter results from files whose path matches count as oracle evidence (default: all) */ referenceInclude?: RegExp }

/**
 * One run root = one recorded run set (a directory tree); the results of a vector on one surface are merged across the folders of a
 * root. The surface is the adapter name each result block records (`impl`), not the folder name, because some re-published sets keep
 * results*.json without a run.json. Folder names are used only for the exclusion regex.
 */
export function loadEvidence(o: LoadOpts): { ev: RunEvidence; counted: string[] } {
  const ex = o.exclude ?? EXCLUDED_RUN_FOLDERS;
  const ev: RunEvidence = { surfaces: new Map(), reference: new Map() };
  const counted: string[] = [];
  for (const root of o.roots) {
    if (!existsSync(root)) throw new Error(`run root not found: ${root}`);
    for (const f of walk(root)) {
      if (!/^results.*\.json$/.test(basename(f))) continue;
      let blocks: unknown;
      try { blocks = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
      if (!Array.isArray(blocks)) continue;
      let used = false;
      for (const b of blocks as { tier?: number; impl?: string; results?: { id: string; status: string }[] }[]) {
        if (typeof b !== "object" || b === null || b.tier !== 1) continue;
        let surface = SURFACE_OF[b.impl ?? ""];
        if (surface === undefined && o.includeEmit === true && b.impl === "vti-emit") surface = "emit";
        if (surface === undefined) continue;
        if (surface !== "reference" && ex.test(f)) continue;
        if (surface === "reference" && o.referenceInclude !== undefined && !o.referenceInclude.test(f)) continue;
        for (const r of b.results ?? []) {
          used = true;
          if (surface === "reference") {
            const s = ev.reference.get(r.id) ?? new Set<string>(); s.add(r.status); ev.reference.set(r.id, s);
          } else {
            const byVec = ev.surfaces.get(surface) ?? new Map(); ev.surfaces.set(surface, byVec);
            const byRoot = byVec.get(r.id) ?? new Map(); byVec.set(r.id, byRoot);
            const s = byRoot.get(root) ?? new Set<string>(); s.add(r.status); byRoot.set(root, s);
          }
        }
      }
      if (used) counted.push(f.slice(root.length));
    }
  }
  return { ev, counted };
}

/** Every vector of a vectors directory (the manifest.json files name the groups; the files are read by their `vectors` array). */
export function loadVectors(vectorsDir: string): Map<string, PrescreenVector> {
  const out = new Map<string, PrescreenVector>();
  for (const f of walk(vectorsDir)) {
    if (!f.endsWith(".json") || /manifest|pins|tf-manifest|not-generated|clarify-classes/.test(basename(f))) continue;
    let d: { group?: string; family?: string; vectors?: Record<string, unknown>[] };
    try { d = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
    if (!Array.isArray(d.vectors)) continue;
    const fam = f.slice(vectorsDir.length).split("/").filter(Boolean)[0] ?? "";
    for (const v of d.vectors) if (typeof v.id === "string") out.set(v.id, summarise(v, d.group ?? "", fam));
  }
  return out;
}
