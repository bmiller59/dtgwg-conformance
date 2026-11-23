// SPDX-License-Identifier: Apache-2.0
// The claims lint (docs/claims.md): the suite's pages never call a platform conformant, compliant or certified. Those words are allowed
// only for a platform whose run at a released (not pre-release) suite version has FAIL 0 and KNOWN-FAIL 0, and no released version
// exists, so the lint is unconditional. A page may name the words inside a lint:skip block (the docs/17 convention).
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { hasRuns, resultsDir, runsDir } from "../results-dir.ts";

const SKIP_BLOCK = /<!--\s*lint:skip\s*-->[\s\S]*?<!--\s*\/lint:skip\s*-->/g;
/** Whole words, any case: conformant, compliant, certified and their forms (non-, -ly, compliance, certify, certification). */
const CLAIM_WORD = /(?<![A-Za-z0-9])(?:non-?)?(?:conformant(?:ly)?|compliant(?:ly)?|compliance|certif(?:y|ies|ied|ying|ication|ications))(?![A-Za-z0-9])/gi;

/** The claim words found in a text outside lint:skip blocks, each with its 1-based line. */
export function claimWordsIn(text: string): { line: number; word: string }[] {
  const t = text.replace(SKIP_BLOCK, (m) => m.replace(/[^\n]/g, " "));
  const hits: { line: number; word: string }[] = [];
  for (const m of t.matchAll(CLAIM_WORD)) hits.push({ line: t.slice(0, m.index).split("\n").length, word: m[0] });
  return hits;
}

/** Tracked pages in the lint's scope: README, STATUS, CONTRIBUTING, CHANGELOG, platforms.md, results (every .md, generated pages too) and docs. */
export function claimsLintFiles(root: string): string[] {
  const r = spawnSync("git", ["ls-files", "-z", "--", "README.md", "STATUS.md", "CONTRIBUTING.md", "CHANGELOG.md", "platforms.md", "results/*.md", "docs/*"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`);
  return r.stdout.split("\0").filter((f) => f.endsWith(".md")).sort();
}

/** The Markdown pages of the run folders in the results directory (kept outside this repository, docs/04 section 21), as paths relative to it. */
export function claimsLintRunFiles(results: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith(".md")) out.push(relative(results, p));
    }
  };
  if (hasRuns(results)) walk(runsDir(results));
  return out.sort();
}

/** Every claim word in scope, as "<file>:<line>: <word>": the tracked pages, and the run folders' pages when the results directory holds them. */
export function lintClaims(root: string, results: string = resultsDir(root)): string[] {
  const out: string[] = [];
  for (const f of claimsLintFiles(root)) for (const h of claimWordsIn(readFileSync(join(root, f), "utf8"))) out.push(`${f}:${h.line}: ${h.word}`);
  for (const f of claimsLintRunFiles(results)) for (const h of claimWordsIn(readFileSync(join(results, f), "utf8"))) out.push(`<results dir>/${f}:${h.line}: ${h.word}`);
  return out;
}
