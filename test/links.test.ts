// SPDX-License-Identifier: Apache-2.0
// Link check: every relative link in a tracked Markdown or HTML file resolves to a tracked file (or a folder holding one),
// and every #anchor into a Markdown file names a heading there (GitHub slug rules) or an explicit id.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, test } from "node:test";
import { SUITE_ROOT } from "../src/vectors/source.ts";

/** Files whose links are not checked, and why. */
const EXEMPT: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /^results\/TEMPLATE-run\//, why: "templates: their links are placeholders filled in when a run is recorded" },
];

function tracked(): string[] | undefined {
  const r = spawnSync("git", ["ls-files", "-z"], { cwd: SUITE_ROOT, encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) return undefined;
  return r.stdout.split("\0").filter((f) => f !== "");
}

/** Markdown text with fenced code blocks and inline code spans blanked, so example links in code are not checked. */
function stripCode(md: string): string {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of md.split("\n")) {
    const m = /^\s*(```+|~~~+)/.exec(line);
    if (fence === undefined && m !== null) {
      fence = m[1]![0]!;
      out.push("");
      continue;
    }
    if (fence !== undefined) {
      if (m !== null && m[1]![0] === fence) fence = undefined;
      out.push("");
      continue;
    }
    out.push(line.replace(/(`+)(?:(?!\1).)+?\1/g, ""));
  }
  return out.join("\n");
}

/** GitHub's heading anchor: rendered text lower-cased, punctuation dropped, spaces to hyphens. */
export function slug(heading: string): string {
  const text = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*]/g, "")
    .trim()
    .toLowerCase();
  return text.replace(/[^\p{L}\p{N}\p{M}\- _]/gu, "").replace(/ /g, "-");
}

const anchorCache = new Map<string, Set<string>>();
function anchorsOf(file: string): Set<string> {
  const hit = anchorCache.get(file);
  if (hit !== undefined) return hit;
  const set = new Set<string>();
  const seen = new Map<string, number>();
  const md = readFileSync(join(SUITE_ROOT, file), "utf8");
  for (const line of stripCodeFences(md)) {
    const h = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (h !== null) {
      const base = slug(h[1]!);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      set.add(n === 0 ? base : `${base}-${n}`);
    }
    for (const m of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) set.add(m[1]!);
  }
  anchorCache.set(file, set);
  return set;
}

function stripCodeFences(md: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out;
}

function linksOf(file: string, text: string): string[] {
  const out: string[] = [];
  if (file.endsWith(".md")) {
    const body = stripCode(text);
    for (const m of body.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push(m[1]!);
    for (const m of body.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)) out.push(m[1]!);
  }
  for (const m of text.matchAll(/\b(?:href|src)="([^"]+)"/g)) out.push(m[1]!);
  return out;
}

describe("links", () => {
  test("every relative link in a tracked page resolves, and every anchor names a heading", (t) => {
    const files = tracked();
    if (files === undefined) {
      t.skip("not a git checkout");
      return;
    }
    const all = new Set(files);
    const dirs = new Set<string>();
    for (const f of files) for (let d = dirname(f); d !== "."; d = dirname(d)) dirs.add(d);
    const pages = files.filter((f) => /\.(md|html)$/.test(f) && !EXEMPT.some((e) => e.pattern.test(f)));
    const broken: string[] = [];
    let checked = 0;
    for (const file of pages) {
      const text = readFileSync(join(SUITE_ROOT, file), "utf8");
      for (const raw of linksOf(file, text)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) continue; // absolute URL, mailto:, data:
        const [pathPart, anchor] = raw.split("#", 2) as [string, string | undefined];
        let target: string;
        try {
          target = pathPart === "" ? file : normalize(join(dirname(file), decodeURIComponent(pathPart.split("?")[0]!))).replace(/\/$/, "");
        } catch {
          broken.push(`${file}: ${raw} (bad encoding)`);
          continue;
        }
        checked++;
        if (target.startsWith("..") || (!all.has(target) && !dirs.has(target))) {
          broken.push(`${file}: ${raw} (no tracked file ${target})`);
          continue;
        }
        if (anchor !== undefined && anchor !== "" && target.endsWith(".md") && all.has(target)) {
          if (!anchorsOf(target).has(decodeURIComponent(anchor).toLowerCase())) broken.push(`${file}: ${raw} (no heading #${anchor} in ${target})`);
        }
      }
    }
    assert.ok(checked > 500, `expected many links to be checked, saw ${checked}`);
    assert.deepEqual(broken, [], `broken links:\n${broken.join("\n")}`);
  });
});
