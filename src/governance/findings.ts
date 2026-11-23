// SPDX-License-Identifier: Apache-2.0
// Governance findings (docs/17): an advisory result class kept apart from PASS, FAIL, SKIP, KNOWN-FAIL and CLARIFY. The suite never
// rules on which governance is right; a finding reports only whether a declaration was honoured, overridden, or replaced by a built-in.
// One kind gates: GOV-DECLARATION-MISMATCH (the adapter honesty check, src/runner/honesty.ts) is a fact about the adapter's own
// declaration of essential governance, not a ruling on governance, and the run counts it as FAIL.
import type { Channel } from "../vectors/source.ts";

export const GOV_KINDS = ["GOV-HONOURED", "GOV-FIXED", "GOV-DEFAULT", "GOV-NOT-PROBED", "GOV-DECLARATION-MISMATCH"] as const;
export type GovKind = (typeof GOV_KINDS)[number];

export const GOV_KIND_MEANING: Record<GovKind, string> = {
  "GOV-HONOURED": "The declaration was applied.",
  "GOV-FIXED": "A governance value the adapter declared was not applied: it was refused, ignored or replaced by a built-in. This reports declaration support only.",
  "GOV-DEFAULT": "With nothing declared for an item, the platform stated or applied a value for it as if one had been given.",
  "GOV-NOT-PROBED": "No declaration path was exercised, so nothing is reported about the platform.",
  "GOV-DECLARATION-MISMATCH": "The essential governance the adapter declared (authority set and minApprovals) does not match the behaviour the harness observed. This one gates: the results that rest on the declaration are FAIL.",
};

/** Short cell labels (no colour, no order). */
export const GOV_KIND_LABEL: Record<GovKind, string> = {
  "GOV-HONOURED": "honoured",
  "GOV-FIXED": "declared value not applied",
  "GOV-DEFAULT": "value implied where none was declared",
  "GOV-NOT-PROBED": "not probed",
  "GOV-DECLARATION-MISMATCH": "declaration does not match behaviour",
};

export interface GovFinding {
  kind: GovKind;
  probe: string;
  title: string;
  platform: string;
  /** The channel of the vector (docs/04 section 18). A governance finding is advisory whatever the channel. */
  channel: Channel;
  /** What was declared (nonce names, no semantics). Empty for a default-probe or a not-probed finding. */
  declared: string;
  /** What the platform did. */
  observed: string;
  /** Why no declaration path was exercised (GOV-NOT-PROBED only). */
  reason?: string;
  /** Neutral sentence generated from the template for the kind. */
  text: string;
}

/** The report wording. Every sentence a finding carries comes from here. */
export function findingText(kind: GovKind, p: { declared: string; observed: string; reason?: string }): string {
  switch (kind) {
    case "GOV-HONOURED":
      return `Declared ${p.declared}; the platform applied ${p.observed}. The declaration was applied. This reports whether a declaration was honoured and makes no statement about whether it is appropriate.`;
    case "GOV-FIXED":
      return `Declared ${p.declared}; the platform applied ${p.observed}. This reports whether a declaration was honoured. It makes no statement about whether the observed behaviour is appropriate.`;
    case "GOV-DEFAULT":
      return `${p.declared === "" ? "Nothing was declared for this item" : `Declared ${p.declared}`}; the platform applied ${p.observed}. This reports whether a value was implied where none was declared. It makes no statement about whether that value is appropriate.`;
    case "GOV-NOT-PROBED":
      return `Not probed: ${p.reason ?? "no declaration path was exercised"}. No declaration was exercised, so this reports nothing about the platform.`;
    case "GOV-DECLARATION-MISMATCH":
      return `Declared essential governance ${p.declared}; the harness observed that ${p.observed}. The declaration does not match the behaviour, so the results that rest on it are recorded as FAIL. This reports whether the adapter's declaration matches the platform and makes no statement about whether the platform's governance is appropriate.`;
  }
}

export function makeFinding(kind: GovKind, base: { probe: string; title: string; platform: string; channel: Channel; declared?: string; observed?: string; reason?: string }): GovFinding {
  const declared = base.declared ?? "";
  const observed = base.observed ?? "";
  const f: GovFinding = { kind, probe: base.probe, title: base.title, platform: base.platform, channel: base.channel, declared, observed, text: findingText(kind, { declared, observed, ...(base.reason === undefined ? {} : { reason: base.reason }) }) };
  if (base.reason !== undefined) f.reason = base.reason;
  return f;
}

// ---------------------------------------------------------------- wording lint

/**
 * Words and phrases no governance finding, report or governance document may use: they either rule on governance or rank platforms.
 * Matched as whole words, case-insensitively.
 */
export const BANNED_WORDS: readonly string[] = [
  "wrong", "bad", "violates", "violated", "violation", "violations", "non-compliant", "noncompliant", "fails governance", "fails", "failing",
  "should have", "weak", "insecure", "broken", "defective", "deficient",
  "rank", "ranks", "ranked", "ranking", "rankings", "score", "scores", "scored", "scoring", "best", "worst", "better", "worse", "grade", "graded", "leaderboard",
];

const SKIP_BLOCK = /<!--\s*lint:skip\s*-->[\s\S]*?<!--\s*\/lint:skip\s*-->/g;

/** Banned words found in `text` (blocks between `<!-- lint:skip -->` and `<!-- /lint:skip -->` are ignored, so a document can name the list). */
export function bannedWordsIn(text: string): string[] {
  const t = text.replace(SKIP_BLOCK, " ");
  const hits: string[] = [];
  for (const w of BANNED_WORDS) {
    const re = new RegExp(`(^|[^A-Za-z0-9-])${w.replace(/[-]/g, "\\-").replace(/ /g, "\\s+")}(?![A-Za-z0-9-])`, "i");
    if (re.test(t)) hits.push(w);
  }
  return hits;
}
