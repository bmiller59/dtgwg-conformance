// SPDX-License-Identifier: Apache-2.0
// Reverse traceability (docs/04 section 18.11): normative statements in the pinned task-force texts, and the vector citations that point
// at them. Best effort and line based; the limits are stated on the generated page (scripts/traceability.ts).

/** BCP 14 keywords counted as normative requirements (upper case only, RFC 8174). MAY and OPTIONAL are not requirements and are left out. */
export const KEYWORDS = ["MUST NOT", "MUST", "SHALL NOT", "SHALL", "SHOULD NOT", "SHOULD", "NOT RECOMMENDED", "RECOMMENDED", "REQUIRED"] as const;
const KW = new RegExp(`\\b(${KEYWORDS.join("|")})\\b`, "g");

export interface Statement {
  path: string;
  /** 1-based first and last line of the block (paragraph, list item, table row or heading) that holds the keyword(s). */
  start: number;
  end: number;
  /** The nearest heading above (its number when it has one, else its text). */
  section: string;
  keywords: string[];
  text: string;
}

const isListItem = (l: string): boolean => /^\s*([-*+]|\d+[.)])\s+/.test(l);
const isBoilerplate = (l: string): boolean => /BCP ?14|RFC ?2119|RFC ?8174/.test(l);

/** The normative statements of one text. Front matter and fenced code are skipped, and so is the BCP 14 boilerplate. */
export function extractStatements(path: string, text: string): Statement[] {
  const lines = text.split("\n");
  const out: Statement[] = [];
  let i = 0;
  if (lines[0] === "---") { const e = lines.indexOf("---", 1); if (e > 0) i = e + 1; }
  let section = "(top)";
  let fence = false;
  let block: { start: number; lines: string[] } | undefined;
  const flush = (): void => {
    if (block === undefined) return;
    const t = block.lines.join(" ");
    const kws = [...new Set([...t.matchAll(KW)].map((m) => m[1]!))];
    if (kws.length > 0 && !isBoilerplate(t)) out.push({ path, start: block.start, end: block.start + block.lines.length - 1, section, keywords: kws, text: t.replace(/\s+/g, " ").trim() });
    block = undefined;
  };
  for (; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*(```|~~~)/.test(l)) { flush(); fence = !fence; continue; }
    if (fence) continue;
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h !== null) {
      flush();
      const title = h[2]!.trim();
      // A heading is a statement only when it carries a keyword itself.
      block = { start: i + 1, lines: [l] };
      flush();
      const num = /^(\d+(?:\.\d+)*)\.?\s/.exec(title);
      section = num !== null ? num[1]! : title.replace(/[`*]/g, "");
      continue;
    }
    if (l.trim() === "") { flush(); continue; }
    if (l.trimStart().startsWith("|") || isListItem(l)) flush();
    if (block === undefined) block = { start: i + 1, lines: [] };
    block.lines.push(l);
    if (l.trimStart().startsWith("|")) flush();
  }
  flush();
  return out;
}

export interface Citation {
  path: string;
  /** Line ranges cited (inclusive). */
  lines: [number, number][];
  /** Section numbers cited without a line (`SPEC.md 7.2 item 8`). */
  sections: string[];
  vector: string;
}

const PATH = String.raw`(SPEC\.md|specs/[\w./-]+?/spec\.md|bindings/[\w./-]+?/spec\.md)`;
const LINE_LIST = new RegExp(`${PATH}:(\\d+(?:\\s*-\\s*\\d+)?(?:(?:\\s*,\\s*|\\s+and\\s+)\\d+(?:\\s*-\\s*\\d+)?)*)`, "g");
const SECTION = new RegExp(`${PATH}(?:\\s+\\([^)]*\\))?\\s+(\\d+(?:\\.\\d+)+)`, "g");

/** The citations of task-force text lines and sections in one string of a vector. */
export function parseCitations(vector: string, s: string): Citation[] {
  const by = new Map<string, Citation>();
  const get = (p: string): Citation => { let c = by.get(p); if (c === undefined) { c = { path: p, lines: [], sections: [], vector }; by.set(p, c); } return c; };
  for (const m of s.matchAll(LINE_LIST)) {
    for (const part of m[2]!.split(/\s*,\s*|\s+and\s+/)) {
      const r = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part.trim());
      if (r !== null) get(m[1]!).lines.push([Number(r[1]), Number(r[2] ?? r[1])]);
    }
  }
  for (const m of s.matchAll(SECTION)) get(m[1]!).sections.push(m[2]!);
  return [...by.values()];
}

export type Coverage = "line" | "section" | "none";

/** How a statement is cited: by a line inside its block, else by its section (or a parent section) only, else not at all. */
export function coverage(st: Statement, cites: Citation[]): { by: Coverage; vectors: string[] } {
  const mine = cites.filter((c) => c.path === st.path);
  const byLine = mine.filter((c) => c.lines.some(([a, b]) => a <= st.end && b >= st.start)).map((c) => c.vector);
  if (byLine.length > 0) return { by: "line", vectors: [...new Set(byLine)].sort() };
  const bySec = mine.filter((c) => c.sections.some((s) => st.section === s || st.section.startsWith(`${s}.`))).map((c) => c.vector);
  if (bySec.length > 0) return { by: "section", vectors: [...new Set(bySec)].sort() };
  return { by: "none", vectors: [] };
}

/** Every string inside a JSON value. */
export function stringsOf(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsOf(x, out);
  else if (v !== null && typeof v === "object") for (const x of Object.values(v)) stringsOf(x, out);
  return out;
}
