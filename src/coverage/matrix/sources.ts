// SPDX-License-Identifier: Apache-2.0
// Gathers spec and ceremony records from origin/main, open PRs and remote branches.
import { changedPaths, ensureCommit, gitFileSet, listTree, openPrs, remoteBranches, type FileSet, type PrInfo } from "./git.ts";
import { isCeremonyPath, isSpecPath, mkSource, readCeremonies, readSpecs, type CeremonyRecord, type SpecRecord } from "./specs.ts";
import type { SpecSource } from "./types.ts";

export interface Gathered {
  tasks: { rec: SpecRecord; source: SpecSource }[];
  ceremonies: { rec: CeremonyRecord; source: SpecSource }[];
  notes: string[];
  mainRev: string;
  prs: { number: number; draft: boolean; title: string; specs: number; read: boolean }[];
  branches: { name: string; specs: number }[];
}

export interface GatherOptions {
  repo: string;
  ghRepo: string;
  baseRev: string;
  /** Test hook: replaces `gh`. */
  prs?: PrInfo[];
}

export function gather(o: GatherOptions): Gathered {
  const g: Gathered = { tasks: [], ceremonies: [], notes: [], mainRev: o.baseRev, prs: [], branches: [] };
  const add = (fs: FileSet, source: SpecSource) => {
    for (const rec of readSpecs(fs)) g.tasks.push({ rec, source: { ...source, status: rec.status } });
    for (const rec of readCeremonies(fs)) g.ceremonies.push({ rec, source: { ...source, status: rec.status } });
  };

  const main = [...listTree(o.repo, o.baseRev, "specs"), ...listTree(o.repo, o.baseRev, "ceremonies")].filter(
    (p) => isSpecPath(p) || isCeremonyPath(p),
  );
  const mainFs = gitFileSet(o.repo, o.baseRev, main);
  add(mainFs, mkSource("main", "main", ""));
  const mainPaths = new Set(main);
  /** A PR or branch adds something only for paths that are absent from main or differ from it (squash-merged branches drop out). */
  const differing = (fs: FileSet, paths: string[]): string[] => paths.filter((p) => !mainPaths.has(p) || mainFs.read(p) !== fs.read(p));

  let prs: PrInfo[] = [];
  try {
    prs = o.prs ?? openPrs(o.ghRepo);
  } catch (e) {
    g.notes.push(`open PRs could not be listed with gh: ${(e as Error).message.split("\n")[0]}`);
  }
  for (const pr of prs) {
    const paths = pr.files.filter((p) => isSpecPath(p) || isCeremonyPath(p));
    if (paths.length === 0) continue;
    const ok = ensureCommit(o.repo, pr.headRefOid, pr.number);
    g.prs.push({ number: pr.number, draft: pr.isDraft, title: pr.title, specs: paths.filter(isSpecPath).length, read: ok });
    if (!ok) {
      g.notes.push(`PR #${pr.number} head commit could not be fetched; its specs are not read`);
      continue;
    }
    const fs = gitFileSet(o.repo, pr.headRefOid, paths);
    add({ files: () => differing(fs, paths), read: (p) => fs.read(p) }, mkSource("pr", `pr#${pr.number}`, "", pr.isDraft));
  }

  for (const b of remoteBranches(o.repo)) {
    const paths = [...changedPaths(o.repo, o.baseRev, b, "specs"), ...changedPaths(o.repo, o.baseRev, b, "ceremonies")].filter(
      (p) => isSpecPath(p) || isCeremonyPath(p),
    );
    if (paths.length === 0) continue;
    const fs = gitFileSet(o.repo, b, paths);
    const diff = differing(fs, paths);
    if (diff.length === 0) continue;
    g.branches.push({ name: b, specs: diff.filter(isSpecPath).length });
    add({ files: () => diff, read: (p) => fs.read(p) }, mkSource("branch", `branch:${b}`, ""));
  }
  return g;
}
