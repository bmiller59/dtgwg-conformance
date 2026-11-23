// SPDX-License-Identifier: Apache-2.0
// The spec-drift check (docs/23): re-hash what the vectors cite against a Trust Tasks checkout and report what moved. Hashes catch change, not correctness.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hashTfPath, passageDiff } from "./spec-hash.ts";
import type { SpecFlag } from "./spec-flags.ts";
import type { TfManifest } from "./tfref.ts";
import type { VectorSource } from "./source.ts";

export interface DriftVector { id: string; source: VectorSource }

export type ChangeKind = "changed" | "removed" | "renamed" | "schema-changed";
export interface PathFinding {
  kind: ChangeKind;
  repoPath: string;
  /** For `renamed`: where the same text is now. */
  renamedTo?: string;
  vectors: string[];
  oldHash: string;
  newHash: string | null;
  /** Short line diff of the normalised passages (spec changes only); a note when the old text is not available. */
  diff: string[];
}
export interface SpecDriftReport {
  /** Vectors that carry hashes, and the distinct paths they cite. */
  hashedVectors: number;
  paths: number;
  findings: PathFinding[];
  /** Task spec paths in the checkout that the pinned manifest does not hold and that no census row or vector names: new task versions with no vector. */
  newVersions: string[];
  /** Task spec paths the pinned manifest holds that the checkout no longer has (and that were not renamed). */
  vanished: string[];
}

/** Every `specs/<slug>/<version>/spec.md` in a checkout. */
export function listTaskSpecs(tf: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const e of readdirSync(join(tf, "specs", rel), { withFileTypes: true })) {
      if (e.isDirectory()) walk(rel === "" ? e.name : `${rel}/${e.name}`);
      else if (e.name === "spec.md" && rel !== "") out.push(`specs/${rel}/spec.md`);
    }
  };
  walk("");
  return out.filter((p) => /^specs\/.+\/\d+\.\d+\/spec\.md$/.test(p) && !p.startsWith("specs/_framework/")).sort();
}

const slugVersion = (p: string): string => /^specs\/(.+)\/spec\.md$/.exec(p)![1]!;

export interface DriftInput {
  vectors: DriftVector[];
  tf: string;
  manifest: Pick<TfManifest, "paths">;
  /** `<slug>/<version>` of every census row. */
  census: ReadonlySet<string>;
  /** The old text of a cited file at the pinned commit, when the checkout has history or an old copy was given. */
  oldText?: (repoPath: string, tfCommit: string) => string | null;
}

export function checkSpecDrift(inp: DriftInput): SpecDriftReport {
  // per vector, not per file: vectors citing one file can carry different hashes (one repinned, one not), and a check that took the first vector's hash for the file missed the others (F-13)
  const byPath = new Map<string, { repoPath: string; vectors: string[]; specHash?: string; schemaHash?: string; tfCommit: string }>();
  let hashedVectors = 0;
  for (const v of inp.vectors) {
    const s = v.source;
    if (s.specHash === undefined || s.tfRef?.repoPath === undefined) continue;
    hashedVectors++;
    const key = `${s.tfRef.repoPath}\0${s.specHash}\0${s.schemaHash ?? ""}`;
    const e = byPath.get(key) ?? { repoPath: s.tfRef.repoPath, vectors: [], specHash: s.specHash, ...(s.schemaHash === undefined ? {} : { schemaHash: s.schemaHash }), tfCommit: s.tfCommit ?? s.tfRef.commit ?? "" };
    e.vectors.push(v.id);
    byPath.set(key, e);
  }
  const findings: PathFinding[] = [];
  const specsNow = listTaskSpecs(inp.tf);
  const renamedFrom = new Set<string>();
  const renamedToSet = new Set<string>();
  for (const e of [...byPath.values()].sort((a, b) => (a.repoPath + a.specHash! < b.repoPath + b.specHash! ? -1 : 1))) {
    const repoPath = e.repoPath;
    const now = hashTfPath(inp.tf, repoPath);
    const vectors = [...e.vectors].sort();
    if (now === null) {
      let renamedTo: string | undefined;
      for (const cand of specsNow) if (!(cand in inp.manifest.paths) && hashTfPath(inp.tf, cand)?.specHash === e.specHash) { renamedTo = cand; break; }
      if (renamedTo !== undefined) { renamedFrom.add(repoPath); renamedToSet.add(renamedTo); }
      findings.push({ kind: renamedTo === undefined ? "removed" : "renamed", repoPath, ...(renamedTo === undefined ? {} : { renamedTo }), vectors, oldHash: e.specHash!, newHash: null, diff: [] });
      continue;
    }
    if (now.specHash !== e.specHash) {
      const old = inp.oldText?.(repoPath, e.tfCommit) ?? null;
      const cur = readFileSync(join(inp.tf, repoPath), "utf8");
      findings.push({ kind: "changed", repoPath, vectors, oldHash: e.specHash!, newHash: now.specHash, diff: old === null ? ["(no passage diff: the old text is not available; give a checkout with history, or --old <checkout at the pinned commit>)"] : passageDiff(old, cur) });
    }
    if (e.schemaHash !== undefined && now.schemaHash !== e.schemaHash) {
      findings.push({ kind: "schema-changed", repoPath: repoPath.replace(/spec\.md$/, "payload.schema.json"), vectors, oldHash: e.schemaHash, newHash: now.schemaHash ?? null, diff: [] });
    }
  }
  const known = new Set<string>(inp.census);
  for (const v of inp.vectors) known.add(`${v.source.slug}/${v.source.version}`);
  const newVersions = specsNow.filter((p) => !(p in inp.manifest.paths) && !renamedToSet.has(p) && !known.has(slugVersion(p)));
  const nowSet = new Set(specsNow);
  const vanished = Object.keys(inp.manifest.paths).filter((p) => /^specs\/.+\/\d+\.\d+\/spec\.md$/.test(p) && !p.startsWith("specs/_framework/") && !nowSet.has(p) && !renamedFrom.has(p)).sort();
  return { hashedVectors, paths: new Set([...byPath.values()].map((x) => x.repoPath)).size, findings, newVersions, vanished };
}

/** Whether the report flags anything (the command then exits non-zero). */
export const flagged = (r: SpecDriftReport): boolean => r.findings.length > 0 || r.newVersions.length > 0 || r.vanished.length > 0;

/** The vector flags a report implies: every vector citing a changed, removed, renamed or schema-changed path. An existing flag keeps its first `oldHash` and `detectedOn`. */
export function flagsFromReport(r: SpecDriftReport, tfCommit: string, today: string, existing: Record<string, SpecFlag> = {}): Record<string, SpecFlag> {
  const out: Record<string, SpecFlag> = { ...existing };
  for (const f of r.findings) {
    for (const id of f.vectors) {
      const prev = existing[id];
      out[id] = { oldHash: prev?.oldHash ?? f.oldHash, newHash: f.newHash, tfCommit, detectedOn: prev?.detectedOn ?? today, what: f.kind === "schema-changed" ? "schema" : f.newHash === null ? "removed" : "spec" };
    }
  }
  return out;
}

/** Plain-text report. */
export function formatReport(r: SpecDriftReport): string {
  const L: string[] = [];
  L.push(`spec drift: ${r.hashedVectors} vector(s) carry hashes, ${r.paths} cited Trust Tasks file(s) re-hashed`);
  const label: Record<ChangeKind, string> = { changed: "CHANGED", removed: "REMOVED", renamed: "RENAMED", "schema-changed": "SCHEMA CHANGED" };
  for (const f of r.findings) {
    L.push(`${label[f.kind]} ${f.repoPath}${f.renamedTo === undefined ? "" : ` -> ${f.renamedTo}`}: ${f.vectors.length} vector(s): ${f.vectors.slice(0, 12).join(", ")}${f.vectors.length > 12 ? ", ..." : ""}`);
    for (const d of f.diff) L.push(`    ${d}`);
  }
  for (const p of r.newVersions) L.push(`NEW TASK VERSION with no vector: ${p}`);
  for (const p of r.vanished) L.push(`VANISHED task version (in the pinned manifest, absent now): ${p}`);
  if (r.hashedVectors === 0) L.push("NOTHING CHECKED: no vector carries spec hashes");
  else if (!flagged(r)) L.push("nothing flagged");
  return L.join("\n");
}
