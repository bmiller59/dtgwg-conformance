// SPDX-License-Identifier: Apache-2.0
// O-01: which task texts REQUIRE an error reply to a rejection. SPEC.md 7.2 (closing paragraph) makes the rejection a MUST and the error reply a SHOULD
// (a MAY at SPEC.md:1196), so a vector that judges a rejection by state alone must not FAIL a consumer that rejects and stays silent. A task text can
// put the reply itself inside a MUST of its own ("On refusal, returns a `trust-task-error` with ..." in a consumer MUST list); for those tasks silence
// is a failure and the vector keeps it. Pure functions over the spec text; scripts/derive-reply-required.ts reads the text from a task-force checkout and
// commits the result (vectors-src/complete/reply-required.json), so the generators need no checkout.
//
// The matcher is deliberately inclusive: a sentence that names the error reply in a MUST (own sentence, or a list item under a MUST lead-in) marks the task
// as requiring it, and an ambiguous task is kept as requiring it (a FAIL stays a FAIL where unsure).

export interface ReplyClause { line: number; text: string }

const STRONG = /\bMUST\b(?! NOT)/;
const WEAK = /\b(SHOULD|MAY|RECOMMENDED|OPTIONAL)\b/;
/** An explicit statement that the consumer replies with an error document: the reply verb with `trust-task-error` (or "an error" as the object of a reply verb). A task that only names the code it refuses with does not say the reply is required. */
const NAMES_REPLY = /\b(?:returns?|returned|repl(?:y|ies)|respond(?:s|ed)?|answers?|sends?|emits?)\b[^.\n]{0,60}?\b(?:a |an |the )?(?:`?trust-task-error`?|error (?:document|response|reply|message))|\b(?:`?trust-task-error`?|error (?:document|response|reply))[^.\n]{0,40}\b(?:is returned|is sent|is the reply)\b/i;
const NOT_AN_ERROR = /\b(not an error|rather than an? error|instead of an? error|no error)\b/i;

/** The first clause of a spec text that puts an error reply inside a MUST, or null. `text` is the whole spec.md. */
export function replyRequiredClause(specText: string): ReplyClause | null {
  const lines = specText.split("\n");
  let i0 = 0;
  if (lines[0] === "---") { const end = lines.findIndex((l, i) => i > 0 && l === "---"); i0 = end < 0 ? 0 : end + 1; }
  let lead: "strong" | "weak" | null = null;
  for (let i = i0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^#{1,6}\s/.test(l)) { lead = null; continue; }
    // a lead-in line ends with a colon and carries the key word its list items inherit ("A conforming consumer **MUST**:")
    if (/:\s*$/.test(l) && !/^\s*(\d+\.|[-*])\s/.test(l)) { const bare = l.replace(/\*\*/g, ""); lead = (STRONG.test(bare) || /^A conforming\b/.test(bare)) && !WEAK.test(bare) ? "strong" : "weak"; continue; }
    const item = /^\s*(\d+\.|[-*])\s/.test(l);
    if (!item && l.trim() === "") { if (lead !== null && !item) { /* a blank line inside a list keeps the lead-in */ } continue; }
    if (!item) lead = null;
    const plain = l.replace(/\*\*/g, "");
    if (/^>|^\|/.test(plain.trim())) continue;
    if (!NAMES_REPLY.test(plain) || NOT_AN_ERROR.test(plain)) continue;
    const own = STRONG.test(plain) ? "strong" : WEAK.test(plain) ? "weak" : null;
    const strength = own ?? (item ? lead : null);
    if (strength === "strong") return { line: i + 1, text: plain.trim().slice(0, 240) };
  }
  return null;
}
