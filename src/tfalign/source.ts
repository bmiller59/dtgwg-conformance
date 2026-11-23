// SPDX-License-Identifier: Apache-2.0
// Read-only access to a Trust Tasks task-force checkout (docs/tf-alignment.md). Two modes: the working tree of a directory, or one git
// revision of it (`git archive` of a few top-level paths into a temporary directory outside the checkout). Nothing here writes to the checkout.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

export interface TfSource {
  /** Directory holding `specs/`, `ceremonies/`, `fixtures/`, `SPEC.md` and `bindings/` (the working tree, or the extracted revision). */
  root: string;
  /** Every file of the checkout (or revision), as `/`-separated paths relative to the root, sorted. */
  files: string[];
  mode: "working-tree" | "revision";
  /** Revision read in `revision` mode. */
  ref: string | null;
  git: GitFacts | null;
  /** The checkout itself when it is a git repository (where git questions are asked, also in `revision` mode), else null. */
  gitDir: string | null;
  cleanup(): void;
}

export interface GitFacts {
  /** Full SHA of the commit that was read (the revision, or HEAD of the working tree). */
  commit: string;
  /** Commit date, YYYY-MM-DD. */
  date: string;
  /** Checked-out branch name for a working tree; null for a detached HEAD or a revision read. */
  branch: string | null;
  /** The remote main branch tip when the clone has one, and how far it is ahead of the commit that was read. */
  originMain: { commit: string; date: string; aheadOfRead: number } | null;
}

const SKIP = new Set([".git", "node_modules", "target", "dist", "build", ".dart_tool"]);
const EXTRACT = ["specs", "ceremonies", "fixtures", "bindings", "SPEC.md"];

export const git = (dir: string, ...args: string[]): string => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
export const gitOk = (dir: string, ...args: string[]): boolean => { try { git(dir, ...args); return true; } catch { return false; } };

function walk(root: string, dir = root, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(root, p, out);
    else if (st.isFile()) out.push(relative(root, p).split("\\").join("/"));
  }
  return out;
}

export function gitFacts(dir: string, rev: string): GitFacts | null {
  if (!gitOk(dir, "rev-parse", "--git-dir")) return null;
  const commit = git(dir, "rev-parse", `${rev}^{commit}`).trim();
  const date = git(dir, "show", "-s", "--format=%cs", commit).trim();
  let branch: string | null = null;
  if (rev === "HEAD") { const b = git(dir, "rev-parse", "--abbrev-ref", "HEAD").trim(); branch = b === "HEAD" ? null : b; }
  let originMain: GitFacts["originMain"] = null;
  if (gitOk(dir, "rev-parse", "--verify", "-q", "origin/main^{commit}")) {
    const om = git(dir, "rev-parse", "origin/main^{commit}").trim();
    originMain = { commit: om, date: git(dir, "show", "-s", "--format=%cs", om).trim(), aheadOfRead: Number(git(dir, "rev-list", "--count", `${commit}..${om}`).trim()) };
  }
  return { commit, date, branch, originMain };
}

/** Open the checkout at `path`. With `ref`, read that revision instead of the working tree (the checkout is never switched or changed). */
export function openTf(path: string, ref?: string): TfSource {
  if (!existsSync(join(path, "specs"))) throw new Error(`not a Trust Tasks checkout (no specs/ directory): ${path}`);
  if (ref === undefined) return { root: path, files: walk(path), mode: "working-tree", ref: null, git: gitFacts(path, "HEAD"), gitDir: gitOk(path, "rev-parse", "--git-dir") ? path : null, cleanup() {} };
  const facts = gitFacts(path, ref);
  if (facts === null) throw new Error(`--ref needs a git checkout: ${path}`);
  const tmp = mkdtempSync(join(tmpdir(), "tf-alignment-"));
  try {
    const present = EXTRACT.filter((p) => git(path, "ls-tree", "--name-only", facts.commit, p).trim() !== "");
    const tar = execFileSync("git", ["-C", path, "archive", "--format=tar", facts.commit, ...present], { maxBuffer: 1 << 30 });
    execFileSync("tar", ["-x", "-C", tmp], { input: tar });
  } catch (e) { rmSync(tmp, { recursive: true, force: true }); throw e; }
  const files = git(path, "ls-tree", "-r", "--name-only", facts.commit).split("\n").filter((l) => l !== "").sort();
  return { root: tmp, files, mode: "revision", ref, git: facts, gitDir: path, cleanup() { rmSync(tmp, { recursive: true, force: true }); } };
}
