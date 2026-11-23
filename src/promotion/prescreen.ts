// SPDX-License-Identifier: Apache-2.0
// Mechanical pre-screen for registry promotion (docs/04 section 18.9, docs/33). Pure functions: the CLI is scripts/prescreen.ts.
// It checks only what a machine can: it never decides that a vector may gate. A human review (docs/33 section 3) follows it.
// Checks (each yields a reason code on failure):
//   channel / tfref-status   channel proposed or candidate, tfRef status draft or main (nothing from an open pull request)
//   clarify                  clarify is null and there is no clarifyClass
//   excluded                 not excludedFromRun, synthetic or retired
//   no-mutants               at least one mutant named
//   no-line-cite             a `spec` string cites a line (`:<digits>`); that a cite quotes the asserted rule is NOT checked
//   clock-dependent          no exact-clock or window field
//   oracle-not-pass          the reference adapter's recorded verdicts for the vector are PASS (SKIP aside) and at least one PASS
//   never-ran / verdict-unstable / non-pass   on the VTI surfaces: ran in at least one recorded run, the same verdict in every run, and it is PASS
//   probe (policy, D353)     a seeded-state probe (family probe) is excluded from promotion; reported apart, not a mechanical failure
export interface PrescreenVector {
  id: string;
  channel: string;
  tfStatus: string | null;
  clarify: unknown;
  clarifyClass: unknown;
  excluded: boolean;
  synthetic: boolean;
  retired: boolean;
  mutants: number;
  specLines: boolean;
  clockDependent: boolean;
  family: string;
  set: string;
}

export type Verdicts = Map<string, Set<string>>; // run root -> statuses seen for the vector on one surface group

export interface RunEvidence {
  /** vector id -> run root -> statuses (every tier-1 result of every counted surface) */
  surfaces: Map<string, Map<string, Verdicts>>; // surface -> vector -> root -> statuses
  /** vector id -> statuses recorded for the reference adapter (any root) */
  reference: Map<string, Set<string>>;
}

export interface ScreenResult { id: string; set: string; channel: string; surface: string; fails: string[]; runs: number; probe: boolean; clean: boolean; promotable: boolean }

const LINE = /:\d+/;
const CLOCK_FIELDS = ["clockStart", "exactClock", "exactTier", "profileWindow"];
export const hasLineCite = (spec: unknown): boolean => Array.isArray(spec) && spec.some((s) => typeof s === "string" && LINE.test(s));

/** Reduce a raw vector object (as in vectors/**) to what the screen needs. */
export function summarise(v: Record<string, any>, group: string, family: string): PrescreenVector { // eslint-disable-line @typescript-eslint/no-explicit-any
  const src = (v.source ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const tf = (src.tfRef ?? {}) as Record<string, unknown>;
  return {
    id: String(v.id), channel: String(src.channel ?? ""), tfStatus: typeof tf.status === "string" ? tf.status : null,
    clarify: v.clarify ?? null, clarifyClass: v.clarifyClass ?? null,
    excluded: v.excludedFromRun !== undefined && v.excludedFromRun !== null, synthetic: v.synthetic === true, retired: v.retired === true || tf.status === "retired",
    mutants: Array.isArray(v.mutants) ? v.mutants.length : 0, specLines: hasLineCite(v.spec),
    clockDependent: CLOCK_FIELDS.some((k) => k in v), family, set: group,
  };
}

/** The mechanical checks that need no run evidence; reason codes as listed above. */
export function staticFails(v: PrescreenVector): string[] {
  const f: string[] = [];
  if (v.channel !== "proposed" && v.channel !== "candidate") f.push(`channel-${v.channel}`);
  if (v.tfStatus !== "draft" && v.tfStatus !== "main") f.push(`tfref-${v.tfStatus}`);
  if (v.clarify !== null || (v.clarifyClass !== null && v.clarifyClass !== undefined)) f.push("clarify");
  if (v.excluded || v.synthetic || v.retired) f.push("excluded/synthetic/retired");
  if (v.mutants === 0) f.push("no-mutants");
  if (!v.specLines) f.push("no-line-cite");
  if (v.clockDependent) f.push("clock-dependent");
  return f;
}

/** Run-evidence checks for one vector against the surfaces it must be judged on. Returns the reason codes and how many runs it ran in. */
export function evidenceFails(id: string, surfaces: string[], ev: RunEvidence): { fails: string[]; runs: number } {
  const fails: string[] = [];
  const ref = ev.reference.get(id) ?? new Set<string>();
  const refBad = [...ref].some((s) => s !== "PASS" && s !== "SKIP");
  if (!ref.has("PASS") || refBad) fails.push("oracle-not-pass");
  const verdicts = new Set<string>();
  let runs = 0;
  for (const s of surfaces) {
    const byRoot = ev.surfaces.get(s)?.get(id);
    if (byRoot === undefined) continue;
    for (const st of byRoot.values()) {
      const ran = [...st].filter((x) => x !== "SKIP").sort();
      if (ran.length === 0) continue;
      runs += 1;
      verdicts.add(ran.join(","));
    }
  }
  if (runs === 0) fails.push("never-ran");
  else if (verdicts.size > 1) fails.push("verdict-unstable");
  else { const only = [...verdicts][0]!; if (only !== "PASS") fails.push(`non-pass:${only}`); }
  return { fails, runs };
}

export function screen(v: PrescreenVector, surfaces: string[], ev: RunEvidence, opts: { excludeProbes: boolean }): ScreenResult {
  const e = evidenceFails(v.id, surfaces, ev);
  const fails = [...staticFails(v), ...e.fails];
  const probe = v.family === "probe";
  const clean = fails.length === 0;
  return { id: v.id, set: v.set, channel: v.channel, surface: surfaces.join("+"), fails, runs: e.runs, probe, clean, promotable: clean && !(opts.excludeProbes && probe) };
}

/** Reason-code tally keyed by the code before a colon. */
export function tally(rows: ScreenResult[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const r of rows) for (const f of r.fails) { const k = f.split(":")[0]!; t[k] = (t[k] ?? 0) + 1; }
  return t;
}
