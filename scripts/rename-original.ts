// SPDX-License-Identifier: Apache-2.0
// Renames the old label for the measured platforms ("un" + "modified") to "original" across the tracked tree.
// Dry run by default (lists files and counts); `--execute` writes. Idempotent: a second run finds nothing to change.
//   node --experimental-strip-types scripts/rename-original.ts [--execute] [--root <dir>]
// The old word is built from parts so this file and its test do not carry it. Upstream specification text (the task-force
// snapshots and examples) is never touched: see PROTECTED.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OLD = ["un", "modified"].join("");
const Old = OLD[0]!.toUpperCase() + OLD.slice(1);

/** Files that quote upstream specification text, and this tool with its test. Never rewritten. */
export const PROTECTED: RegExp[] = [
  /^vectors-src\/(coverage\/tf-invalid-examples|alignment\/tf-snapshot|gap\/tf-snapshot)\.json$/,
  /^vectors\//,
  /^scripts\/rename-original\.ts$/,
  /^test\/rename-original\.test\.ts$/,
];

/** Phrase rules applied before the generic word rename, for places where "original" would read wrongly. */
const PHRASES: [RegExp, string][] = [
  [new RegExp(`(upstream \`?main\`?(?: \\(\`[0-9a-f]+\`, [0-9-]+\\))?), ${OLD}\\b`, "g"), "$1"],
  [new RegExp(`(container \`[^\`]+\`), ${OLD}, with`, "g"), "$1, with"],
  [new RegExp(`\\bis run ${OLD}\\b`, "g"), "is run as published"],
  [new RegExp(`\\bsources ${OLD}\\b`, "g"), "sources as published"],
  [new RegExp(`\\b(code|side) is ${OLD}\\b`, "g"), "$1 is the original"],
  [new RegExp(`\\bwallet ${OLD}:`, "g"), "original wallet:"],
  [new RegExp(`\\bas specified, ${OLD}:`, "g"), "as specified, on the original platforms:"],
];

/** Renames the old label in `text`. Case follows the match: lower, Capitalised, UPPER, and inside identifiers. */
export function renameText(text: string): { text: string; count: number } {
  let out = text; let count = 0;
  for (const [re, to] of PHRASES) out = out.replace(re, (...m) => { count++; return to.replace(/\$(\d)/g, (_, d) => String(m[Number(d)] ?? "")); });
  out = out.replace(new RegExp(OLD, "gi"), (m) => {
    count++;
    return m === OLD ? "original" : m === Old ? "Original" : m === OLD.toUpperCase() ? "ORIGINAL" : "original";
  });
  return { text: out, count };
}

export interface Change { file: string; count: number }

/** The tracked text files under `root` that would change, with the number of replacements in each. */
export function plan(root: string): { changes: Change[]; write: (c: Change[]) => void } {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 1 << 28 }).toString().split("\0").filter((f) => f !== "");
  const changes: Change[] = []; const next = new Map<string, string>();
  for (const f of files) {
    if (PROTECTED.some((p) => p.test(f))) continue;
    let s: string;
    try { s = readFileSync(join(root, f), "utf8"); } catch { continue; }
    if (!new RegExp(OLD, "i").test(s)) continue;
    const r = renameText(s);
    if (r.text !== s) { changes.push({ file: f, count: r.count }); next.set(f, r.text); }
  }
  return { changes, write: (cs) => { for (const c of cs) writeFileSync(join(root, c.file), next.get(c.file)!); } };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const ri = args.indexOf("--root");
  const root = ri >= 0 ? resolve(args[ri + 1]!) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { changes, write } = plan(root);
  for (const c of changes) console.log(`${String(c.count).padStart(5)}  ${c.file}`);
  console.log(`${changes.reduce((n, c) => n + c.count, 0)} replacements in ${changes.length} files${execute ? " (written)" : " (dry run; pass --execute to write)"}`);
  if (execute) write(changes);
}
