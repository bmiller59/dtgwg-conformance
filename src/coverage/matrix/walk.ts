// SPDX-License-Identifier: Apache-2.0
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SKIP = new Set(["node_modules", ".git", "target", "dist", "build", ".codegraph", "Pods"]);

/** All files under `root` with one of the extensions, skipping build and dependency folders. */
export function walk(root: string, exts: string[]): string[] {
  const out: string[] = [];
  const rec = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      if (SKIP.has(n)) continue;
      const p = join(dir, n);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) rec(p);
      else if (exts.some((e) => n.endsWith(e))) out.push(p);
    }
  };
  rec(root);
  return out.sort();
}

export const rel = (root: string, p: string): string => relative(root, p);
export const text = (p: string): string => readFileSync(p, "utf8");

export const URI_RE = /https:\/\/trusttasks\.org\/spec\/([a-z0-9][a-z0-9/_-]*?)\/(\d+\.\d+)(?![0-9.])/g;
export const isTestPath = (p: string): boolean => /(^|\/)(__tests__|__mocks__|tests?|e2e|fixtures)\//.test(p) || /\.(test|spec)\.[tj]sx?$/.test(p);

export function urisIn(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(URI_RE)) out.add(`https://trusttasks.org/spec/${m[1]}/${m[2]}`);
  return [...out];
}
