// SPDX-License-Identifier: Apache-2.0
// Capability matrix: implementation x family x tier, as JSON and Markdown.
import { SPEC_CHANGED_TEXT } from "../vectors/spec-flags.ts";
import type { AcceptanceWindow } from "../adapter/contract.ts";
import type { CountedStatus, Status, SuiteRun, VectorResult } from "./suite.ts";
import type { Channel, DriftFinding } from "../vectors/source.ts";
import { ADVISORY_CHANNELS } from "../vectors/source.ts";

export interface MatrixCell {
  status: Status;
  counts: Record<CountedStatus, number>;
  /** The family's anchor positive vectors (not CLARIFY, some step expects an accepted response): how many passed, how many ran (not SKIP), how many exist. */
  anchors: { pass: number; ran: number; total: number };
  /**
   * The vacuous-pass rule: a cell is green only when its anchor positives pass: at least one anchor ran and passed, and none that ran
   * failed. A PASS roll-up that is not green is annotated, because its negative vectors may pass only because the implementation
   * refuses everything.
   */
  green: boolean;
  /** Present when the roll-up is PASS but the cell is not green. */
  annotation?: string;
}

export interface MatrixRow {
  impl: string;
  tier: number;
  /** The tiers of the runs merged into this row. */
  tiers: number[];
  /** Present when several runs of one implementation were merged: `<name>@<tier>`. */
  runs?: string[];
  families: Record<string, MatrixCell>;
  /** Tier 2 roll-up per named sub-group (docs/04 section 3.1), counts as in a family cell. Only sub-groups with at least one vector. */
  subgroups: Record<string, Record<CountedStatus, number>>;
  /** Quarantined flaky vectors (docs/04 section 18.9), present when any: advisory, in no count or roll-up, never in the exit code. */
  quarantined?: string[];
  /** Vectors not run because they change deployment state and no disposable deployment was named (neither pass nor fail). */
  skippedSafety?: string[];
  /** Vectors flagged by the spec-drift check: recorded SPEC-CHANGED, in no count (docs/23). */
  specChanged?: string[];
  /** SHOULD mismatches observed (docs/04 section 3.2): reported, never a Tier 1 failure, never hidden. */
  advisories: { vector: string; messages: string[] }[];
  /** Vectors skipped only because this server claims `attested` (or the run selected Tier 2): they need a run against a non-attested server at Tier 1. */
  needsNonAttestedRun: string[];
  /** Vectors no run of the row ran because of the selected tier (`excludedByTier`): not SKIP, not counted. Present when any. */
  excludedByTier?: number;
  /** The acceptance window measured against, and its members that differ from the profile pins (a difference, not a failure). */
  window?: AcceptanceWindow;
  windowDifference: string[];
  /** Vectors not run because they pin the profile window and this implementation's differs. */
  windowSkipped: string[];
  /** `rebase` when any merged run could not set the clock: the vectors that need clock control are SKIP (never PASS), listed here with the count by reason. */
  clockMode: "set" | "rebase";
  clockSkipped: string[];
}

export interface Matrix {
  format: "tt-conformance-matrix/0.1";
  /** Present only on an advisory matrix (`pr` or `proposed`); the gating matrix is registry and carries no channel member. */
  channel?: Channel;
  /** Vectors left out because their channel was not selected (counts), present when any were. Not SKIP. */
  excludedByChannel?: Partial<Record<Channel, number>>;
  /** Vectors excluded from every run (`excludedFromRun`): count, present when any (gating matrix only). Not run, not counted, not SKIP. */
  excludedFromRun?: number;
  /** spec-drift advisory findings (needs human review), present when any. */
  drift?: DriftFinding[];
  families: string[];
  rows: MatrixRow[];
}

function rollup(counts: Record<CountedStatus, number>): CountedStatus {
  if (counts.FAIL > 0) return "FAIL";
  if (counts["KNOWN-FAIL"] > 0) return "KNOWN-FAIL";
  if (counts.PASS > 0) return "PASS";
  if (counts.CLARIFY > 0) return "CLARIFY";
  return "SKIP";
}

const RANK: Status[] = ["FAIL", "KNOWN-FAIL", "PASS", "CLARIFY", "QUARANTINED", "SPEC-CHANGED", "SKIPPED-SAFETY", "SKIP"];

/** One result per vector across the runs of one implementation: a run that executed the vector beats one that skipped it; otherwise the worst executed status. */
function mergeRuns(runs: SuiteRun[]): { results: VectorResult[]; tiers: number[] } {
  const byId = new Map<string, VectorResult>();
  for (const run of runs) {
    for (const x of run.results) {
      const prev = byId.get(x.id);
      if (prev === undefined || RANK.indexOf(x.status) < RANK.indexOf(prev.status)) byId.set(x.id, x);
    }
  }
  return { results: [...byId.values()], tiers: [...new Set(runs.map((r) => r.tier))].sort() };
}

/**
 * One row per implementation. Runs that share an implementation key (an attested and a non-attested server, or two tiers) are
 * merged, so a vector an attested server skips is covered by the run that executed it.
 */
export function buildMatrix(allRuns: SuiteRun[], channel: Channel = "registry"): Matrix {
  const inChannel = (x: VectorResult): boolean => (x.channel ?? "registry") === channel;
  const runs = allRuns.map((r) => ({ ...r, results: r.results.filter(inChannel) }));
  const families = [...new Set(runs.flatMap((r) => r.results.map((x) => x.family)))].sort();
  const groups = new Map<string, SuiteRun[]>();
  for (const run of runs) groups.set(run.implementation ?? run.impl, [...(groups.get(run.implementation ?? run.impl) ?? []), run]);
  const rows: MatrixRow[] = [...groups.entries()].map(([key, group]) => {
    const merged = group.length === 1 ? { results: group[0]!.results, tiers: [group[0]!.tier] } : mergeRuns(group);
    const cells: Record<string, MatrixCell> = {};
    for (const f of families) {
      const counts: Record<CountedStatus, number> = { PASS: 0, FAIL: 0, SKIP: 0, "KNOWN-FAIL": 0, CLARIFY: 0 };
      const anchors = { pass: 0, ran: 0, total: 0 };
      for (const x of merged.results.filter((r) => r.family === f)) {
        if (x.status === "QUARANTINED" || x.status === "SPEC-CHANGED" || x.status === "SKIPPED-SAFETY") continue;
        counts[x.status]++;
        if (x.anchor === true) {
          anchors.total++;
          if (x.status !== "SKIP") anchors.ran++;
          if (x.status === "PASS") anchors.pass++;
        }
      }
      const status = rollup(counts);
      const green = status === "PASS" && anchors.pass > 0 && anchors.pass === anchors.ran;
      cells[f] = {
        status, counts, anchors, green,
        ...(status === "PASS" && !green ? { annotation: anchors.pass === 0 ? `no anchor positive vector passed (${anchors.total} in the family, ${anchors.ran} ran): the passing negatives may be vacuous, not shown green` : `anchor positives ${anchors.pass}/${anchors.ran} that ran passed: not shown green` } : {}),
      };
    }
    const subgroups: Record<string, Record<CountedStatus, number>> = {};
    for (const x of merged.results) {
      if (x.subgroup === undefined || x.status === "QUARANTINED" || x.status === "SPEC-CHANGED" || x.status === "SKIPPED-SAFETY") continue;
      subgroups[x.subgroup] ??= { PASS: 0, FAIL: 0, SKIP: 0, "KNOWN-FAIL": 0, CLARIFY: 0 };
      subgroups[x.subgroup]![x.status]++;
    }
    const advisories = merged.results.filter((x) => (x.advisories ?? []).length > 0).map((x) => ({ vector: x.id, messages: x.advisories! })).sort((a, b) => a.vector.localeCompare(b.vector));
    const ranIds = new Set(merged.results.map((x) => x.id));
    const tierOut = [...new Map(group.flatMap((g) => (g.excludedByTier ?? []).filter((e) => e.channel === channel && !ranIds.has(e.id))).map((e) => [e.id, e])).values()];
    const needs = [
      ...merged.results.filter((x) => x.status === "SKIP" && /declares optional attested|only runs at tier/.test(x.reason ?? "")).map((x) => x.id),
      ...tierOut.filter((e) => e.reason.startsWith("only runs at tier")).map((e) => e.id),
    ];
    const lastWithWindow = [...group].reverse().find((g) => g.window !== undefined);
    const clockMode = group.some((g) => g.clockMode === "rebase") ? "rebase" as const : "set" as const;
    const skippedBy = (re: RegExp): string[] => merged.results.filter((x) => x.status === "SKIP" && re.test(x.reason ?? "")).map((x) => x.id);
    return {
      window: lastWithWindow?.window, windowDifference: lastWithWindow?.windowDifference ?? [], windowSkipped: skippedBy(/^window difference/),
      clockMode, clockSkipped: skippedBy(/^clock not settable/),
      impl: group.length === 1 ? group[0]!.impl : key, tier: Math.max(...merged.tiers), tiers: merged.tiers,
      ...(group.length > 1 ? { runs: group.map((g) => `${g.impl}@${g.tier}`) } : {}), families: cells, subgroups, advisories, needsNonAttestedRun: needs, ...(tierOut.length > 0 ? { excludedByTier: tierOut.length } : {}),
      ...(merged.results.some((x) => x.status === "SPEC-CHANGED") ? { specChanged: merged.results.filter((x) => x.status === "SPEC-CHANGED").map((x) => x.id) } : {}),
      ...(merged.results.some((x) => x.status === "SKIPPED-SAFETY") ? { skippedSafety: merged.results.filter((x) => x.status === "SKIPPED-SAFETY").map((x) => x.id) } : {}),
      ...(merged.results.some((x) => x.status === "QUARANTINED") ? { quarantined: merged.results.filter((x) => x.status === "QUARANTINED").map((x) => x.id) } : {}),
    };
  });
  const excluded: Partial<Record<Channel, number>> = {};
  for (const r of allRuns) for (const [c, ids] of Object.entries(r.excludedByChannel ?? {})) if (ids.length > 0) excluded[c as Channel] = Math.max(excluded[c as Channel] ?? 0, ids.length);
  const excludedFromRun = Math.max(0, ...allRuns.map((r) => Object.keys(r.excludedFromRun ?? {}).length));
  const drift = allRuns.flatMap((r) => r.drift ?? []).filter((d) => d.channel === channel);
  const uniqueDrift = drift.filter((d, i) => drift.findIndex((e) => e.ref === d.ref && e.reason === d.reason && e.pinned === d.pinned) === i);
  return {
    format: "tt-conformance-matrix/0.1", ...(channel === "registry" ? {} : { channel }), families, rows,
    ...(channel === "registry" && Object.keys(excluded).length > 0 ? { excludedByChannel: excluded } : {}), ...(channel === "registry" && excludedFromRun > 0 ? { excludedFromRun } : {}), ...(uniqueDrift.length > 0 ? { drift: uniqueDrift } : {}),
  };
}

/** The channels the runs selected that are advisory and have results (pr, proposed, candidate). */
export function advisoryChannelsOf(runs: SuiteRun[]): Channel[] {
  return ADVISORY_CHANNELS.filter((c) => runs.some((r) => r.results.some((x) => x.channel === c)));
}

export const ADVISORY_BANNER = (c: Channel): string =>
  `> ADVISORY, channel \`${c}\`: ${c === "pr" ? "these vectors come from an open, unmerged pull request" : c === "candidate" ? "these vectors cover behaviour with no home in the Trust Tasks repository, implemented by one or a few platforms and possibly adoptable later (candidates): not an endorsement" : "these vectors come from a suite-defined profile (for example 2L) over tasks that exist in the Trust Tasks repository; the profile grouping is our proposal"}. They are not an endorsement of any specification, are not part of the gating counts or of any headline total, and a result here never changes the exit code. Draft proposal for discussion; not an adopted or endorsed standard.`;

export function matrixMarkdown(m: Matrix): string {
  const lines = [
    m.channel === undefined ? "# Capability matrix" : `# Capability matrix, advisory channel ${m.channel}`,
    "",
    ...(m.channel === undefined ? [] : [ADVISORY_BANNER(m.channel), ""]),
    "Cell = roll-up of the family's vectors at the selected tier (FAIL > KNOWN-FAIL > PASS > CLARIFY > SKIP); counts are pass/fail/skip/known-fail/clarify. A cell is green only when its anchor positive vectors pass: `*` marks a PASS roll-up that is not (its passing negative vectors may be vacuous; see the notes under the table).",
    "",
    `| Implementation | Tier | ${m.families.join(" | ")} |`,
    `|---|---|${m.families.map(() => "---").join("|")}|`,
  ];
  for (const r of m.rows) {
    const cells = m.families.map((f) => {
      const c = r.families[f]!;
      const n = c.counts;
      return `${c.status} (${n.PASS}/${n.FAIL}/${n.SKIP}/${n["KNOWN-FAIL"]}/${n.CLARIFY})${c.annotation === undefined ? "" : " *"}`;
    });
    lines.push(`| ${r.impl} | ${r.tiers.join("+")} | ${cells.join(" | ")} |`);
  }
  lines.push("");
  for (const r of m.rows) {
    for (const f of m.families) {
      const c = r.families[f]!;
      if (c.annotation !== undefined) lines.push(`* ${r.impl} / ${f}: ${c.annotation}.`);
    }
    lines.push(r.window === undefined
      ? `Window, ${r.impl}: not recorded in the run.`
      : `Window, ${r.impl}: maxAgeSeconds ${r.window.maxAgeSeconds}, clockSkewSeconds ${r.window.clockSkewSeconds}, expiryHorizonSeconds ${r.window.expiryHorizonSeconds ?? "not declared"} (${r.windowDifference.length === 0 ? "equal to the profile pins" : "differs from the profile pins"}; the pins are a profile choice, not framework text).`);
    const sg = Object.entries(r.subgroups);
    if (sg.length > 0) {
      lines.push(`Tier 2 sub-groups, ${r.impl} (pass/fail/skip/known-fail/clarify): ${sg.map(([k, n]) => `${k} ${n.PASS}/${n.FAIL}/${n.SKIP}/${n["KNOWN-FAIL"]}/${n.CLARIFY}`).join("; ")}.`);
    }
    if (r.excludedByTier !== undefined) lines.push(`Excluded by tier, ${r.impl}: ${r.excludedByTier} vector(s) outside the selected tier (not run, not counted, and not SKIP).`);
    lines.push(`Advisories, ${r.impl}: ${r.advisories.reduce((a, x) => a + x.messages.length, 0)} SHOULD mismatch(es) in ${r.advisories.length} vector(s); never a Tier 1 failure.${r.advisories.length === 0 ? "" : " " + r.advisories.map((a) => `${a.vector}: ${a.messages.join(" | ")}`).join("; ")}`);
    if (r.windowDifference.length > 0) {
      lines.push(`Window difference, ${r.impl}: measured against its declared window (${r.windowDifference.join("; ")}). This is a measured difference from the profile pins, not a failure; ${r.windowSkipped.length} fixture rows that pin the profile window are SKIP (${r.windowSkipped.join(", ") || "none"}).`);
    }
    if (r.specChanged !== undefined) lines.push(`Spec changed, ${r.impl}: ${r.specChanged.length} vector(s) (${r.specChanged.join(", ")}); ${SPEC_CHANGED_TEXT}; advisory, in no count above and never in the exit code (docs/23).`);
    if (r.quarantined !== undefined) lines.push(`Quarantined as flaky, ${r.impl}: ${r.quarantined.length} vector(s) (${r.quarantined.join(", ")}); advisory, in no count above and never in the exit code (docs/04 section 18.9).`);
    if (r.clockMode === "rebase") {
      lines.push(`Clock, ${r.impl}: the clock cannot be set, so real time was each vector's clock start (rebase mode). ${r.clockSkipped.length} vectors that need exact or multi-offset clock control are SKIP, not PASS (${r.clockSkipped.join(", ") || "none"}).`);
    }
  }
  for (const r of m.rows.filter((x) => x.needsNonAttestedRun.length > 0)) {
    lines.push(`Not covered by ${r.impl} at tier ${r.tier}: ${r.needsNonAttestedRun.length} vectors run only against a non-attested server at Tier 1 (${r.needsNonAttestedRun.join(", ")}). Run the implementation a second time without \`attested\`; a merged row (several runs of one implementation) already counts that run.`);
  }
  if (m.excludedByChannel !== undefined) {
    lines.push(`Excluded by channel: ${Object.entries(m.excludedByChannel).map(([c, n]) => `${n} vector(s) of channel ${c}`).join(", ")} (not selected with --channels; not run and not counted, and not SKIP).`);
  }
  if (m.excludedFromRun !== undefined) lines.push(`Excluded from every run: ${m.excludedFromRun} vector(s) (a vector that cites a retired Trust Tasks spec is never run, counted or reported as SKIP).`);
  if (m.drift !== undefined) {
    lines.push(`spec-drift (advisory, needs human review; never a failure): ${m.drift.length} source(s). ${m.drift.map((d) => `${d.ref} ${d.reason} (${d.vectors.length} vector(s))`).join("; ")}`);
  }
  lines.push("");
  return lines.join("\n");
}
