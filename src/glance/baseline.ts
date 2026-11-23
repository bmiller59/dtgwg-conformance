// SPDX-License-Identifier: Apache-2.0
// Before/after headline figures per surface: the current run of each surface against a named baseline suite commit. The baseline is a
// tracked file (results/baseline-<commit>.json) written once by scripts/baseline.ts from the glance model at that commit (its own
// src/glance/model.ts over the run folders tracked there); regen only reads it. The "why it moved" column comes from structured causes
// (CAUSES): each is a decision with a detector over the baseline and the current model, shown only for a measure whose figures moved.
// A cause no detector finds is not guessed: the cell stays blank.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { runsDir } from "../results-dir.ts";
import { loadRuns, ordered, pct, recordedPlatform, type Counts, type Model, type SurfaceModel } from "./model.ts";

export const BASELINE_FORMAT = "tt-glance-baseline/0.1";
/** The baseline the before/after block compares against (the branch point of the agreed changes). */
export const BASELINE_COMMIT = "a80f5bb";
export const BASELINE_MEASURES = ["core", "plain", "emit", "witness"] as const;

export type BaselineCounts = Pick<Counts, "total" | "applicable" | "ran" | "pass" | "clarify" | "knownFail" | "fail" | "notApplicable" | "notReached" | "versionMismatch">;
export interface BaselineSurface { id: string; impl: string; label: string; runs: string[]; recordedEarlier: boolean; measures: Partial<Record<(typeof BASELINE_MEASURES)[number], BaselineCounts>> }
export interface Baseline {
  format: typeof BASELINE_FORMAT;
  commit: string;
  about: string;
  surfaces: BaselineSurface[];
  /** Tier 1 core vectors on the registry channel in the catalog at the baseline commit. */
  registryCore: string[];
}

const KEYS: (keyof BaselineCounts)[] = ["total", "applicable", "ran", "pass", "clarify", "knownFail", "fail", "notApplicable", "notReached", "versionMismatch"];
export const pickCounts = (c: Counts): BaselineCounts => Object.fromEntries(KEYS.map((k) => [k, c[k]])) as unknown as BaselineCounts;

/** The baseline record of a glance model (used once, by scripts/baseline.ts, on the model built at the baseline commit). */
export function baselineOf(model: Pick<Model, "subjects">, catalog: Map<string, { kind: string; channel: string; tier: number; excludedFromRun: boolean }>, commit: string): Baseline {
  const surfaces: BaselineSurface[] = [];
  for (const s of model.subjects) for (const sf of s.surfaces) {
    const measures: BaselineSurface["measures"] = {};
    for (const m of BASELINE_MEASURES) { const c = sf.byMeasure[m]; if (c !== undefined && c.total > 0) measures[m] = pickCounts(c); }
    surfaces.push({ id: sf.cfg.id, impl: sf.cfg.impl, label: sf.cfg.label, runs: sf.runs, recordedEarlier: sf.recordedEarlier, measures });
  }
  const registryCore = [...catalog.entries()].filter(([, v]) => v.kind === "core" && v.channel === "registry" && v.tier === 1 && !v.excludedFromRun).map(([id]) => id).sort();
  return {
    format: BASELINE_FORMAT, commit,
    about: `Headline figures per surface as the glance model at suite commit ${commit} computed them (Tier 1), written once by scripts/baseline.ts; not regenerated. The before/after block in results/README.md compares the current runs against it.`,
    surfaces, registryCore,
  };
}

/** The baseline file in the results directory (src/results-dir.ts), or null when there is none. */
export function loadBaseline(results: string, commit = BASELINE_COMMIT): Baseline | null {
  const p = join(results, `baseline-${commit}.json`);
  if (!existsSync(p)) return null;
  const b = JSON.parse(readFileSync(p, "utf8")) as Baseline;
  if (b.format !== BASELINE_FORMAT) throw new Error(`${p}: format ${String(b.format)}, expected ${BASELINE_FORMAT}`);
  return b;
}

/** Everything a cause detector may read. */
export interface CauseInput { results: string; model: Model; sf: SurfaceModel; measure: string; before: BaselineSurface | undefined; was: BaselineCounts | undefined; now: BaselineCounts | undefined; baseline: Baseline }
export interface Cause { id: string; anchor: string; detect: (x: CauseInput) => string | null }

/** The recorded FAIL text (reason plus failure lines) of a surface's Tier 1 results, by vector id. */
const failTextCache = new Map<string, Map<string, string>>();
function failText(results: string, sf: SurfaceModel): Map<string, string> {
  const key = `${results}\0${sf.cfg.id}`;
  let m = failTextCache.get(key);
  if (m === undefined) {
    m = new Map();
    for (const b of loadRuns(results)) {
      if (b.tier !== 1 || !sf.runs.includes(b.run) || (b.impl !== sf.cfg.impl && !(sf.cfg.aliases ?? []).includes(b.impl))) continue;
      for (const r of b.results as (typeof b.results[number] & { failures?: unknown })[]) if (r.status === "FAIL" && !m.has(r.id)) m.set(r.id, `${r.reason ?? ""} ${JSON.stringify(r.failures ?? "")}`);
    }
    failTextCache.set(key, m);
  }
  return m;
}
/** FAIL results of the measure's registry part whose recorded text matches. */
const failCount = (results: string, sf: SurfaceModel, measure: string, re: RegExp): number => {
  const text = failText(results, sf);
  return sf.results.filter((r) => r.status === "FAIL" && r.kind === measure && r.channel === "registry" && re.test(text.get(r.id) ?? r.reason)).length;
};
/** SKIP classes moved beyond what a change of the recorded total explains (vectors that left the part were not-applicable SKIPs). */
const skipsDiffer = (a: BaselineCounts, b: BaselineCounts): boolean =>
  a.notApplicable - b.notApplicable !== a.total - b.total || a.notReached !== b.notReached || a.versionMismatch !== b.versionMismatch;

/** The structured causes, in the order they are shown. Each names the decision (docs/decisions/README.md anchor) and says what it moved. */
export const CAUSES: Cause[] = [
  {
    id: "ceremony split", anchor: "../docs/decisions/04-ceremonies-governance-and-exceptions.md#d39",
    detect: ({ model, measure, was, now, baseline }) => {
      if (measure !== "core" || was === undefined || now === undefined || was.total === now.total) return null;
      const cat = new Map(model.subjects.flatMap((s) => s.surfaces.flatMap((sf) => sf.results.map((r) => [r.id, r.channel] as const))));
      const moved = baseline.registryCore.filter((id) => { const ch = cat.get(id); return ch !== undefined && ch !== "registry"; }).length;
      return moved > 0 ? `ceremony split (decision 39): ${moved} checks left the registry channel` : null;
    },
  },
  {
    id: "R8", anchor: "../docs/decisions/04-ceremonies-governance-and-exceptions.md#cited-not-offered",
    detect: ({ results, sf, was, now }) => {
      if (was === undefined || now === undefined || !skipsDiffer(was, now)) return null;
      const cited = sf.runs.some((run) => hasNotApplicableRule(results, run));
      return cited ? "R8: not applicable only from a cited notOffered (other SKIPs read as not reached)" : null;
    },
  },
  {
    id: "R10", anchor: "../docs/decisions/04-ceremonies-governance-and-exceptions.md#min-quiet",
    detect: ({ results, sf, measure, was, now }) => {
      const n = failCount(results, sf, measure, /QUIET-NOT-ESTABLISHED/);
      return n > 0 && (was === undefined || now === undefined || was.fail !== now.fail) ? `R10 minimum quiet period: ${n} FAIL (QUIET-NOT-ESTABLISHED)` : null;
    },
  },
  {
    id: "R6 expectFailure", anchor: "../docs/decisions/04-ceremonies-governance-and-exceptions.md#exception-surfaces",
    detect: ({ results, sf, measure }) => {
      const n = failCount(results, sf, measure, /KNOWN-FAIL exception does not match the observed failure/);
      return n > 0 ? `R6 expectFailure: ${n} FAIL (the exception does not match the observed failure)` : null;
    },
  },
  {
    id: "R5", anchor: "../docs/decisions/04-ceremonies-governance-and-exceptions.md#platform-surfaces",
    detect: ({ results, sf, before }) => before === undefined && recordedPlatform(results, sf.runs, sf.cfg.impl) !== undefined ? `R5: new surface, counted under its platform (${recordedPlatform(results, sf.runs, sf.cfg.impl)!})` : null,
  },
  {
    id: "R6 name", anchor: "../docs/decisions/04-ceremonies-governance-and-exceptions.md#exception-surfaces",
    detect: ({ sf, before }) => before !== undefined && before.impl !== sf.cfg.impl ? `R6: implementation name ${before.impl} -> ${sf.cfg.impl}` : null,
  },
];

function hasNotApplicableRule(results: string, run: string): boolean {
  const dir = join(runsDir(results), run);
  const walk = (d: string): boolean => {
    if (!existsSync(d)) return false;
    for (const e of readdirSafe(d)) {
      const p = join(d, e);
      if (e === "results.json") { if (readFileSync(p, "utf8").includes("\"notApplicableRule\"")) return true; } else if (e !== "draft-issues" && statSync(p).isDirectory() && walk(p)) return true;
    }
    return false;
  };
  return walk(dir);
}
function readdirSafe(d: string): string[] { try { return readdirSync(d).sort(); } catch { return []; } }

const cell = (c: BaselineCounts | undefined): string =>
  c === undefined ? "-" : `${c.ran} of ${c.applicable} (${pct(c.ran, c.applicable)}; ${c.total} recorded); ${c.pass} / ${c.clarify} / ${c.knownFail} / ${c.fail}; ${c.notApplicable} / ${c.notReached} / ${c.versionMismatch}`;
const same = (a: BaselineCounts | undefined, b: BaselineCounts | undefined): boolean => a !== undefined && b !== undefined && KEYS.every((k) => a[k] === b[k]);
const PART: Record<string, string> = { core: "core", plain: "single tasks", emit: "what it sends", witness: "witness server" };

/** The before/after block of results/README.md. */
export function baselineBlock(root: string, model: Model, base: string, baseline: Baseline | null = loadBaseline(model.results)): string {
  if (baseline === null) return `No baseline file (baseline-${BASELINE_COMMIT}.json in the results directory): run scripts/baseline.ts once to write it.`;
  const rows: string[][] = [];
  for (const s of ordered(model)) for (const sf of s.surfaces) {
    const before = baseline.surfaces.find((b) => b.id === sf.cfg.id);
    for (const m of BASELINE_MEASURES) {
      const now = sf.byMeasure[m] !== undefined && sf.byMeasure[m]!.total > 0 ? pickCounts(sf.byMeasure[m]!) : undefined;
      const was = before?.measures[m];
      if (now === undefined && was === undefined) continue;
      const moved = !same(was, now);
      const causes = moved ? CAUSES.map((c) => { const t = c.detect({ results: model.results, model, sf, measure: m, before, was, now, baseline }); return t === null ? null : `[${t}](${base}${c.anchor.replace(/^\.\.\//, "")})`; }).filter((x): x is string => x !== null) : [];
      const current = sf.recordedEarlier ? `earlier recording (${sf.runs.join(", ")}), re-read: ${cell(now)}` : cell(now);
      const why = !moved ? "unchanged" : causes.join("; ");
      rows.push([s.cfg.name, sf.cfg.label, PART[m]!, was === undefined ? (before === undefined ? "not a surface at the baseline" : "-") : cell(was), current, why]);
    }
  }
  const esc = (x: string): string => x.replace(/\|/g, "\\|");
  return [
    `Headline figures per surface, Tier 1, gating (registry) parts only: the current run of each surface against the glance model at suite commit \`${baseline.commit.slice(0, 7)}\` (the branch point of the agreed changes; \`baseline-${BASELINE_COMMIT}.json\` in the results directory, written once from that commit). Each cell: reach (run of applicable; recorded); PASS / CLARIFY / KNOWN-FAIL / FAIL; not applicable / not reached / version mismatch. "Earlier recording": the surface was not re-run; its recorded results are re-read by the current model (catalog and classification), so its figures can move without a new run. "Why it moved" names only the decisions a check of the records finds; blank where none is found. Not a ranking.`,
    "",
    "| Platform | Surface | Part | Baseline | Current | Why it moved |",
    "|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
  ].join("\n");
}
