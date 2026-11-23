// SPDX-License-Identifier: Apache-2.0
// Facts about a task read from its own specification text (spec.md at a pinned task-force commit): what it does to a deployment
// (`sideEffects.level`), the framework error codes its own text requires or permits at the payload level, and a "no response is not a
// failure" clause. Pure functions over the text; scripts/derive-task-facts.ts reads the text from git and commits the result in
// vectors-src/complete/task-facts.json, so the generator and its tests need no task-force checkout.
import { ENVELOPE_CODES } from "../plain/check.ts";

export type Effect = "destructive" | "mutating" | "read-only";
export interface CodeClause { code: string; line: number; text: string }
export interface NoResponseClause { line: number; text: string }
export interface TaskFacts {
  typeUri: string;
  effect: Effect | null;
  /** Envelope codes the task's own text requires a consumer to refuse with (an explicit MUST or SHOULD rule, not any sentence that names a code); see `mandatedCodes`. */
  mandatedCodes: CodeClause[];
  /** The task's own error codes from the front matter (`errorCodes`). */
  errorCodes: ErrorCodeEntry[];
  /** A clause saying that a missing response is not a failure. */
  noResponseOk: NoResponseClause[];
  /** Whether the task's whole directory at the facts' commit is byte-identical to its directory at `commit` (set by derive-task-facts --since): a vector that cited the older commit may be re-pinned. */
  identicalSince?: { commit: string; identical: boolean };
}

/** `sideEffects.level` from the front matter: none -> read-only, mutating, destructive; null when the text states none. */
export function effectOf(specText: string): Effect | null {
  const fm = /^---\n([\s\S]*?)\n---/.exec(specText);
  if (fm === null) return null;
  const m = /^sideEffects:\s*\n\s+level:\s*"?([a-z-]+)"?/m.exec(fm[1]!);
  if (m === null) return null;
  const level = m[1]!;
  if (level === "none") return "read-only";
  return level === "mutating" || level === "destructive" ? level : null;
}

const clip = (s: string): string => (s.length > 220 ? `${s.slice(0, 217)}...` : s);

/** One entry of the front matter's `errorCodes`: the task's own code (`<slug>:<name>`), what it means, and the 1-based line of its `code:` key. */
export interface ErrorCodeEntry { code: string; meaning: string; line: number }

/** The task's own error codes, read from the front matter (R-01: a code a conforming implementation may return for a valid request of this task). */
export function errorCodesOf(specText: string): ErrorCodeEntry[] {
  const lines = specText.split("\n");
  const end = lines.findIndex((l, i) => i > 0 && l === "---");
  const out: ErrorCodeEntry[] = [];
  let inBlock = false;
  let cur: ErrorCodeEntry | null = null;
  for (let i = 1; i < (end < 0 ? 0 : end); i++) {
    const l = lines[i]!;
    if (/^errorCodes:/.test(l)) { inBlock = true; continue; }
    if (!inBlock) continue;
    if (/^[A-Za-z]/.test(l)) break;
    const c = /^\s*-\s+code:\s*"?([^"\s]+)"?/.exec(l);
    if (c !== null) { cur = { code: c[1]!, meaning: "", line: i + 1 }; out.push(cur); continue; }
    if (cur === null) continue;
    const m = /^\s+meaning:\s*(.*)$/.exec(l);
    if (m !== null) { cur.meaning = m[1]!.replace(/^(>-?|["'])\s*/, "").replace(/["']$/, ""); continue; }
    if (/^\s+(retryable|details|http)\b/.test(l)) continue;
    if (/^\s{4,}\S/.test(l) && !/^\s+\w+:/.test(l)) cur.meaning += ` ${l.trim()}`;
  }
  return out;
}

const REFUSE_VERB = /\b(refus|reject|answer|reply|respond|return)\w*\b/i;
// a sentence that is not a consumer rule for the vector's own (valid, signed, in-window) request: non-normative asides, producer rules, a missing proof (the vector signs)
const NOT_A_RULE = /non-normative|no verified `proof`|\bre-send\b|\bproducer\b/i;

/**
 * Envelope codes the task's body requires a consumer to refuse with (R-04): an explicit consumer rule, that is a sentence with MUST or SHOULD, a refusal verb
 * (refuse, reject, answer, reply, respond, return) and the code, or an arrow `-> code` in a MUST item. A sentence that merely mentions a code
 * (a reader's fallback, a table row, a producer rule, a missing-proof clause) is not one. `proofInvalid` counts only for a check against live state
 * (the sentence or its list item says the DID is resolved afresh or "live"), because the vector signs its own proof.
 */
export function mandatedCodes(specText: string): CodeClause[] {
  const lines = specText.split("\n");
  const start = lines.findIndex((l, i) => i > 0 && l === "---") + 1;
  const out: CodeClause[] = [];
  let para: { text: string; line: number } | null = null;
  const flush = (): void => {
    if (para === null) return;
    for (const sent of para.text.split(/(?<=\.)\s+(?=[A-Z*`])/)) {
      if (NOT_A_RULE.test(sent)) continue;
      const must = /\b(MUST|SHOULD)\b/.test(sent) || /^\s*(?:\d+[a-z]?\.\s*)?(?:\*\*)?(?:Refuse|Reject)/.test(sent);
      for (const code of ENVELOPE_CODES) {
        const tick = "`" + code + "`";
        if (!sent.includes(tick)) continue;
        const refuses = must && REFUSE_VERB.test(sent) && (sent.includes(`with ${tick}`) || sent.includes(`as ${tick}`) || sent.includes(`(or ${tick})`));
        const arrow = /\b(MUST|SHOULD)\b/.test(para.text) && para.text.split(/\u2192|->/).slice(1).some((seg) => seg.trimStart().replace(/^the framework\s+/, "").startsWith(tick));
        const explicit = refuses || arrow;
        if (!explicit) continue;
        if (code === "proofInvalid" && !/\blive\b|afresh/i.test(para.text)) continue;
        out.push({ code, line: para.line, text: clip(sent.trim()) });
      }
    }
    para = null;
  };
  lines.forEach((l, i) => {
    if (i < start) return;
    if (l.trim() === "" || /^#{1,6}\s/.test(l)) { flush(); return; }
    if (/^\s*(?:\d+[a-z]?\.|[-*])\s/.test(l)) flush();
    if (para === null) para = { text: l.trim(), line: i + 1 }; else para.text += ` ${l.trim()}`;
  });
  flush();
  return out;
}

const NO_RESPONSE = /(that is not a failure|no `?#response`? (document )?(is|at all)|there is a second case with no response|may see the connection close instead of a `#response`)/i;
export function noResponseOk(specText: string): NoResponseClause[] {
  const out: NoResponseClause[] = [];
  specText.split("\n").forEach((l, i) => { if (NO_RESPONSE.test(l)) out.push({ line: i + 1, text: clip(l.trim()) }); });
  return out;
}

export function factsOf(typeUri: string, specText: string): TaskFacts {
  return { typeUri, effect: effectOf(specText), mandatedCodes: mandatedCodes(specText), errorCodes: errorCodesOf(specText), noResponseOk: noResponseOk(specText) };
}
