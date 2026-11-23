// SPDX-License-Identifier: Apache-2.0
// Read-only git and gh helpers. Nothing here writes to a repository or contacts anyone but the read APIs named.
import { execFileSync } from "node:child_process";

export function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

/** A readable set of files at one revision. */
export interface FileSet {
  files(): string[];
  read(path: string): string;
}

/** Reads many blobs with one `git cat-file --batch` process. */
export function gitFileSet(repo: string, rev: string, paths: string[]): FileSet {
  const cache = new Map<string, string>();
  const input = paths.map((p) => `${rev}:${p}\n`).join("");
  if (paths.length > 0) {
    const buf = execFileSync("git", ["-C", repo, "cat-file", "--batch"], { input, maxBuffer: 1024 * 1024 * 1024 });
    let pos = 0;
    for (const p of paths) {
      const nl = buf.indexOf(10, pos);
      const header = buf.subarray(pos, nl).toString("utf8");
      const m = /^[0-9a-f]+ blob (\d+)$/.exec(header);
      pos = nl + 1;
      if (!m) continue; // "<spec> missing"
      const size = Number(m[1]);
      cache.set(p, buf.subarray(pos, pos + size).toString("utf8"));
      pos += size + 1;
    }
  }
  return { files: () => paths, read: (p) => cache.get(p) ?? "" };
}

export function listTree(repo: string, rev: string, dir: string): string[] {
  return git(repo, ["ls-tree", "-r", "--name-only", rev, dir]).split("\n").filter(Boolean);
}

/** Paths added or modified on `head` since its merge base with `base`. */
export function changedPaths(repo: string, base: string, head: string, dir: string): string[] {
  try {
    return git(repo, ["diff", "--name-only", "--diff-filter=AM", `${base}...${head}`, "--", dir]).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export function remoteBranches(repo: string, remote = "origin"): string[] {
  return git(repo, ["for-each-ref", "--format=%(refname:short)", `refs/remotes/${remote}`])
    .split("\n")
    .filter((b) => b && b !== remote && b !== `${remote}/HEAD`);
}

export interface PrInfo {
  number: number;
  title: string;
  isDraft: boolean;
  headRefOid: string;
  files: string[];
}

/** Open PRs with their changed files (gh, read-only). */
export function openPrs(ghRepo: string): PrInfo[] {
  const list = JSON.parse(
    execFileSync("gh", ["pr", "list", "-R", ghRepo, "--state", "open", "--limit", "200", "--json", "number"], { encoding: "utf8" }),
  ) as { number: number }[];
  const out: PrInfo[] = [];
  for (const { number } of list) {
    const v = JSON.parse(
      execFileSync("gh", ["pr", "view", String(number), "-R", ghRepo, "--json", "number,title,isDraft,headRefOid,files"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      }),
    ) as { number: number; title: string; isDraft: boolean; headRefOid: string; files: { path: string }[] };
    out.push({ number: v.number, title: v.title, isDraft: v.isDraft, headRefOid: v.headRefOid, files: v.files.map((f) => f.path) });
  }
  return out;
}

/** Make a PR head commit available locally (a read-only fetch; creates no ref). */
export function ensureCommit(repo: string, sha: string, prNumber: number): boolean {
  try {
    git(repo, ["cat-file", "-e", `${sha}^{commit}`]);
    return true;
  } catch {
    try {
      git(repo, ["fetch", "origin", `pull/${prNumber}/head`]);
      git(repo, ["cat-file", "-e", `${sha}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  }
}
