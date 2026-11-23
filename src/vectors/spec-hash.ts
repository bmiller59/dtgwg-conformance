// SPDX-License-Identifier: Apache-2.0
// Content hashes of the Trust Tasks text a vector cites (docs/23-spec-drift.md). One module, so the vectors, the drift check and the re-pin
// script all hash the same way.
//
// A hash catches CHANGE in the cited text, never correctness. It is taken over NORMALISED text, so a reflow, a changed emphasis marker,
// a re-styled table or a shift in line numbers does not move it, while a changed word does.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalJson } from "@openvtc/trust-tasks/runtime";

const sha256 = (s: string): string => `sha256:${createHash("sha256").update(s).digest("hex")}`;

/** One normalised line of markdown: markup noise removed, whitespace collapsed. Returns "" for a line that is only markup. */
function normaliseLine(line: string): string {
  let s = line;
  if (/^\s*\|?[\s:|-]+\|?\s*$/.test(s) && s.includes("-") && s.includes("|")) return ""; // table separator row
  if (/^\s*(```|~~~)/.test(s)) return ""; // code fence marker
  s = s.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/\s+#+\s*$/, ""); // heading hashes
  s = s.replace(/^\s*(>\s*)+/, ""); // block quote marker
  s = s.replace(/^\s*[-*+]\s+/, ""); // bullet marker
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1"); // inline links and images: keep the text
  s = s.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1"); // reference links
  s = s.replace(/^\s*\[[^\]]+\]:\s+\S+.*$/, ""); // reference definitions
  s = s.replace(/<(https?:[^>]+)>/g, "$1"); // autolinks
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, " "); // inline html tags
  s = s.replace(/[`*~]/g, ""); // code spans, bold, italic, strikethrough
  s = s.replace(/(^|[^A-Za-z0-9])_+|_+(?=$|[^A-Za-z0-9])/g, "$1"); // _emphasis_ (not snake_case)
  s = s.replace(/\|/g, " "); // table pipes
  return s.replace(/\s+/g, " ").trim();
}

/** The normalised text as paragraphs (blocks separated by blank lines, each on one line). Line wrapping and line numbers are not part of it. */
export function normaliseParagraphs(text: string): string[] {
  const withoutComments = text.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "\n");
  const out: string[] = [];
  let cur: string[] = [];
  const flush = (): void => { if (cur.length > 0) out.push(cur.join(" ")); cur = []; };
  for (const raw of withoutComments.split("\n")) {
    if (raw.trim() === "") { flush(); continue; }
    const n = normaliseLine(raw);
    if (n === "") continue;
    if (/^\s{0,3}#{1,6}\s/.test(raw)) { flush(); out.push(n); continue; } // a heading is its own block
    cur.push(n);
  }
  flush();
  return out;
}

/** The normalised text: paragraphs joined by one space. */
export const normaliseSpec = (text: string): string => normaliseParagraphs(text).join(" ");

/** `sha256:<hex>` of the normalised text of a markdown document. */
export const specHashOfText = (text: string): string => sha256(normaliseSpec(text));

/** `sha256:<hex>` of a JSON document in canonical form (key order and formatting do not count). */
export const jsonHashOfText = (text: string): string => sha256(canonicalJson(JSON.parse(text)));

export interface TfHashes { specHash: string; schemaHash?: string }

/**
 * The hashes of a Trust Tasks repository path at a checkout: `specHash` of the file (a `.md` file is normalised; a `.json` file is hashed
 * canonically), and, for a task spec (`specs/<slug>/<version>/spec.md`), `schemaHash` of the sibling `payload.schema.json`. Null when the file is absent.
 */
export function hashTfPath(tfRoot: string, repoPath: string): TfHashes | null {
  const file = join(tfRoot, repoPath);
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const specHash = repoPath.endsWith(".json") ? jsonHashOfText(text) : specHashOfText(text);
  if (!/^specs\/.+\/\d+\.\d+\/spec\.md$/.test(repoPath)) return { specHash };
  const schemaFile = join(dirname(file), "payload.schema.json");
  return existsSync(schemaFile) ? { specHash, schemaHash: jsonHashOfText(readFileSync(schemaFile, "utf8")) } : { specHash };
}

/** A short line diff of two normalised texts, by paragraph: `- old` / `+ new`, at most `max` lines (then a "... N more" line). Empty when equal. */
export function passageDiff(oldText: string, newText: string, max = 12): string[] {
  const a = normaliseParagraphs(oldText);
  const b = normaliseParagraphs(newText);
  const n = a.length, m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: string[] = [];
  let i = 0, j = 0;
  const clip = (s: string): string => (s.length > 160 ? `${s.slice(0, 157)}...` : s);
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { i++; j++; }
    else if (i < n && (j === m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) out.push(`- ${clip(a[i++]!)}`);
    else out.push(`+ ${clip(b[j++]!)}`);
  }
  return out.length > max ? [...out.slice(0, max), `... ${out.length - max} more changed paragraph(s)`] : out;
}
