// SPDX-License-Identifier: Apache-2.0
// Vector completeness for the tasks the VTI and keyring-wallet pair exchange (latest version of each task only): which of them have a
// positive vector, a negative vector, a gating (registry) vector, and which carry only vectors of one polarity. Read-only over the
// generated vectors and the coverage matrix; it runs no platform. Polarity comes from the dispositions the steps expect:
// positive = response, answered, emitted, next-step; negative = error, any-refusal, silence, duplicate. Edge is a title heuristic.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tasksReferencedBy } from "./matrix/vectors.ts";
import { POSITIVE_DISPOSITIONS, NEGATIVE_DISPOSITIONS } from "../vectors/dispositions.ts";
import { taskOfType, vectorEffect } from "../vectors/effects.ts";

export const POSITIVE = POSITIVE_DISPOSITIONS;
export const NEGATIVE = NEGATIVE_DISPOSITIONS;
const EDGE = /\b(minimum|maximum|minItems|maxItems|minLength|maxLength|boundary|empty|clamp\w*|limit|cursor|expired|window|constraint\w*)\b/i;
const NOT_VECTORS = /(^|\/)(manifest|pins|tf-manifest|not-generated|clarify-classes|scenarios-manifest)\.json$/;
export const KW_ROLES = ["emits", "serves", "names-only"];

/** `vtiServedVersion` / `kwNamedVersion`: the version the platform actually exchanges where it is behind the latest (the entry stays at the latest version). */
export interface ScopeTask { typeUri: string; slug: string; version: string; family: string; vti: string[]; kw: string | null; note?: string; vtiServedVersion?: string; kwNamedVersion?: string }
export interface OutOfScope { slug: string; servedVersions: string[]; reason: string }
export interface Scope { format: "tt-vector-completeness-scope/0.1"; note: string; inputs: Record<string, string>; tasks: ScopeTask[]; outOfScope?: OutOfScope[] }

interface MatrixTask { typeUri: string; slug: string; version: string; family: string; latest: boolean; vti: { served: string[] } }
interface KwRow { slug: string; version: string; role: string }

/** Latest-version tasks that VTI serves or the wallet's source gives a role with code (emits, serves, names-only). */
export function deriveScope(tasks: MatrixTask[], kwRows: KwRow[], inputs: Record<string, string>): Scope {
  const role = new Map(kwRows.map((r) => [`${r.slug}/${r.version}`, r.role]));
  const out: ScopeTask[] = [];
  for (const t of tasks) {
    if (!t.latest) continue;
    const r = role.get(`${t.slug}/${t.version}`);
    const kw = r !== undefined && KW_ROLES.includes(r) ? r : null;
    if (t.vti.served.length === 0 && kw === null) continue;
    out.push({ typeUri: t.typeUri, slug: t.slug, version: t.version, family: t.family, vti: [...t.vti.served].sort(), kw });
  }
  out.sort((a, b) => a.typeUri.localeCompare(b.typeUri));
  return { format: "tt-vector-completeness-scope/0.1", note: "Latest version of each task that VTI serves or the wallet's source gives a role with code. Derived by scripts/vector-completeness.ts scope from a coverage-matrix run; the inputs are the revisions read.", inputs, tasks: out };
}

/**
 * `strong`: the vector asserts a real success (a `response` or `emitted` step, or an `answered` step with `success`). `weak`: its positives
 * are all `answered` without `success` (any non-envelope answer passes). A positive vector is exactly one of the two.
 */
export interface TaskPolarity { pos: boolean; neg: boolean; emit: boolean; strong: boolean; weak: boolean }
/**
 * `tasks`: every Type URI the vector names (any-vector coverage). `by`: polarity and strength per Type URI, credited to the task each step sends or emits (R-02): a seeding step
 * (`rooms/create` expecting a response, ahead of negatives for `rooms/epoch/mint`) credits `rooms/create`, not the probed task. A step that names no Type URI (a template step) credits the
 * Type URIs the vector names. `skippedByDefault`: the runner skips the vector unless a disposable deployment is named (its effect, tagged or derived, is mutating or destructive; R-05, R-07).
 */
export interface VecRow { id: string; group: string; set: string; channel: string; tasks: string[]; pos: boolean; neg: boolean; edge: boolean; emit: boolean; strong?: boolean; weak?: boolean; by?: Record<string, TaskPolarity>; skippedByDefault?: boolean }

function walk(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir).sort()) {
    const rel = base ? `${base}/${n}` : n;
    if (n === "imported") continue;
    if (statSync(join(dir, n)).isDirectory()) out.push(...walk(join(dir, n), rel));
    else if (n.endsWith(".json") && !NOT_VECTORS.test(rel)) out.push(rel);
  }
  return out;
}

/** The vector files a set directory's manifest.json lists (relative to the directory), or null when the directory has none (the root `vectors/` manifest does not govern its subdirectories). */
function listedFiles(dir: string, set: string): Set<string> | null {
  if (set === ".") return null;
  const m = join(dir, set, "manifest.json");
  if (!existsSync(m)) return null;
  try {
    const j = JSON.parse(readFileSync(m, "utf8")) as { files?: unknown };
    return Array.isArray(j.files) ? new Set(j.files.map(String)) : null;
  } catch { return null; }
}

/** Vector files that sit in a set directory with a manifest but are not listed in it: the runner never runs them, so they must not be counted (F-01). */
export function unlistedVectorFiles(root: string): string[] {
  const dir = join(root, "vectors");
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const f of walk(dir)) {
    const set = f.includes("/") ? f.split("/")[0]! : ".";
    const listed = listedFiles(dir, set);
    if (listed !== null && !listed.has(f.slice(set.length + 1))) out.push(`vectors/${f}`);
  }
  return out;
}

/** Every vector that runs (not retired or excluded) with its set, read from the files the set manifests list: the raw documents, for audits that need the steps. */
export function loadRunnableVectors(root: string): { set: string; file: string; vector: Record<string, unknown> }[] {
  const dir = join(root, "vectors");
  const out: { set: string; file: string; vector: Record<string, unknown> }[] = [];
  if (!existsSync(dir)) return out;
  for (const f of walk(dir)) {
    const set = f.includes("/") ? f.split("/")[0]! : ".";
    const listed = listedFiles(dir, set);
    if (listed !== null && !listed.has(f.slice(set.length + 1))) continue;
    let j: { vectors?: unknown };
    try { j = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; }
    if (!Array.isArray(j.vectors)) continue;
    for (const v of j.vectors as Record<string, unknown>[]) {
      if (typeof v["id"] !== "string" || v["retired"] !== undefined || v["excludedFromRun"] !== undefined) continue;
      out.push({ set, file: f, vector: v });
    }
  }
  return out;
}

/** Every vector under `<root>/vectors` (not the imported fixtures), minus the sets named in `excludeSets`. A file a set's manifest does not list is not counted (the runner never runs it). */
export function loadVecRows(root: string, excludeSets: string[] = []): VecRow[] {
  const dir = join(root, "vectors");
  const rows: VecRow[] = [];
  if (!existsSync(dir)) return rows;
  for (const f of walk(dir)) {
    const set = f.includes("/") ? f.split("/")[0]! : ".";
    if (excludeSets.includes(set) || set === "alignment") continue; // the advisory alignment set gives no coverage (docs/tf-alignment.md)
    const listed = listedFiles(dir, set);
    if (listed !== null && !listed.has(f.slice(set.length + 1))) continue;
    let j: { group?: string; vectors?: unknown };
    try { j = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; }
    if (!Array.isArray(j.vectors)) continue;
    for (const v of j.vectors as Record<string, unknown>[]) {
      if (typeof v["id"] !== "string") continue;
      if (v["retired"] !== undefined || v["excludedFromRun"] !== undefined) continue; // a tombstone or an excluded vector is never run, so it gives no coverage
      const steps = (Array.isArray(v["steps"]) ? v["steps"] : []) as { expect?: { disposition?: string }; emit?: unknown }[];
      const ds = steps.map((s) => s.expect?.disposition ?? "");
      const src = v["source"] as { channel?: string } | undefined;
      const exps = steps as { expect?: { disposition?: string; success?: boolean; orRefusal?: string[]; acceptCodes?: string[] } }[];
      const posSteps = exps.filter((x) => POSITIVE.has(x.expect?.disposition ?? ""));
      // a positive step asserts real success unless it is an `answered` step without `success` (any non-envelope answer passes)
      // D781: a step that also accepts a refusal (`orRefusal`, `acceptCodes`) does not assert success, so it is weak credit
      const isStrong = (x: { expect?: { disposition?: string; success?: boolean; orRefusal?: string[]; acceptCodes?: string[] } }): boolean =>
        (x.expect?.disposition !== "answered" || x.expect.success === true) && (x.expect?.orRefusal ?? []).length === 0 && (x.expect?.acceptCodes ?? []).length === 0;
      const strong = posSteps.some(isStrong);
      const named = tasksReferencedBy(JSON.stringify(v));
      const by: Record<string, TaskPolarity> = {};
      for (const s of steps as unknown as { send?: { document?: { type?: unknown } }; emit?: { type?: unknown }; expect?: { disposition?: string; success?: boolean } }[]) {
        const own = taskOfType(s.send?.document?.type) ?? taskOfType(s.emit?.type);
        const d = s.expect?.disposition ?? "";
        for (const u of own === null ? named : [own]) {
          const e = (by[u] ??= { pos: false, neg: false, emit: false, strong: false, weak: false });
          if (POSITIVE.has(d)) { e.pos = true; if (isStrong(s)) e.strong = true; else e.weak = true; }
          if (NEGATIVE.has(d)) e.neg = true;
          if (s.emit !== undefined) e.emit = true;
        }
      }
      for (const e of Object.values(by)) e.weak = e.pos && !e.strong;
      const eff = vectorEffect({ effect: v["effect"] as never, steps: steps as never });
      rows.push({
        id: v["id"] as string, group: j.group ?? "", set, channel: src?.channel ?? "registry", tasks: named, by, skippedByDefault: eff === "mutating" || eff === "destructive",
        pos: ds.some((d) => POSITIVE.has(d)), neg: ds.some((d) => NEGATIVE.has(d)), edge: EDGE.test(String(v["title"] ?? "")),
        emit: steps.some((s) => s.emit !== undefined),
        strong, weak: posSteps.length > 0 && !strong,
      });
    }
  }
  return rows;
}

/** The polarity a row gives a task: the step-level credit, or for a row built without it (`by` absent) the row's own flags for every task it names. */
function polarityOf(r: VecRow, u: string): TaskPolarity | undefined {
  if (r.by !== undefined) return r.by[u];
  return r.tasks.includes(u) ? { pos: r.pos, neg: r.neg, emit: r.emit, strong: r.strong === true, weak: r.weak === true } : undefined;
}

export interface Ratio { n: number; of: number; pct: number }
const ratio = (n: number, of: number): Ratio => ({ n, of, pct: of === 0 ? 0 : Math.round((n / of) * 1000) / 10 });

export interface TaskCoverage { typeUri: string; family: string; vectors: number; pos: number; strong: number; weak: number; neg: number; gating: number; edge: number; emit: number; posRuns: number; negRuns: number }
export interface CeremonyStepInfo { ceremony: string; step: string; type: string; covered: boolean }
export interface Report {
  scope: Ratio; vtiServed: Ratio; kwRole: Ratio; both: Ratio;
  anyVector: Ratio; positive: Ratio; positiveSkippedByDefault: Ratio; negativeSkippedByDefault: Ratio; positiveAsserted: Ratio; positiveWeakOnly: Ratio; negative: Ratio; positiveAndNegative: Ratio; gating: Ratio; edge: Ratio;
  kwEmits: Ratio; kwEmitsWithEmitVector: Ratio;
  families: { family: string; tasks: number; anyVector: Ratio; positiveAndNegative: Ratio; gating: Ratio }[];
  noPositive: string[]; weakOnly: string[]; noNegative: string[]; noGating: string[]; kwEmitsWithoutEmitVector: string[];
  ceremonySteps: Ratio; ceremonyStepTypesPosNeg: Ratio; ceremoniesWithoutSteps: string[]; stepsWithoutVector: string[];
  tasks: TaskCoverage[];
}

export function analyse(scope: Scope, rows: VecRow[], steps: CeremonyStepInfo[] = [], ceremonyIds: string[] = []): Report {
  const by = new Map<string, VecRow[]>();
  for (const r of rows) for (const t of r.tasks) { const l = by.get(t); if (l) l.push(r); else by.set(t, [r]); }
  const tasks: TaskCoverage[] = scope.tasks.map((t) => {
    const v = by.get(t.typeUri) ?? [];
    const p = (r: VecRow): TaskPolarity | undefined => polarityOf(r, t.typeUri);
    return { typeUri: t.typeUri, family: t.family, vectors: v.length, pos: v.filter((r) => p(r)?.pos).length, strong: v.filter((r) => p(r)?.strong).length, weak: v.filter((r) => p(r)?.weak).length, neg: v.filter((r) => p(r)?.neg).length, gating: v.filter((r) => r.channel === "registry").length, edge: v.filter((r) => r.edge).length, emit: v.filter((r) => p(r)?.emit).length, posRuns: v.filter((r) => p(r)?.pos && r.skippedByDefault !== true).length, negRuns: v.filter((r) => p(r)?.neg && r.skippedByDefault !== true).length };
  });
  const N = tasks.length;
  const c = (f: (t: TaskCoverage) => boolean): number => tasks.filter(f).length;
  const kwEmitsTasks = scope.tasks.filter((t) => t.kw === "emits").map((t) => t.typeUri);
  const emitMissing = kwEmitsTasks.filter((u) => tasks.find((t) => t.typeUri === u)!.emit === 0);
  const fams = [...new Set(tasks.map((t) => t.family))].sort().map((family) => {
    const f = tasks.filter((t) => t.family === family);
    return { family, tasks: f.length, anyVector: ratio(f.filter((t) => t.vectors > 0).length, f.length), positiveAndNegative: ratio(f.filter((t) => t.pos > 0 && t.neg > 0).length, f.length), gating: ratio(f.filter((t) => t.gating > 0).length, f.length) };
  });
  const stepTypes = [...new Set(steps.map((s) => s.type))];
  const stepTypePN = stepTypes.filter((u) => { const v = by.get(u) ?? []; return v.some((r) => polarityOf(r, u)?.pos) && v.some((r) => polarityOf(r, u)?.neg); });
  const stepList = (s: CeremonyStepInfo): boolean => (by.get(s.type) ?? []).length > 0;
  return {
    scope: ratio(N, N), vtiServed: ratio(scope.tasks.filter((t) => t.vti.length > 0).length, N), kwRole: ratio(scope.tasks.filter((t) => t.kw !== null).length, N),
    both: ratio(scope.tasks.filter((t) => t.vti.length > 0 && t.kw !== null).length, N),
    anyVector: ratio(c((t) => t.vectors > 0), N), positive: ratio(c((t) => t.pos > 0), N), positiveSkippedByDefault: ratio(c((t) => t.pos > 0 && t.posRuns === 0), N), negativeSkippedByDefault: ratio(c((t) => t.neg > 0 && t.negRuns === 0), N), positiveAsserted: ratio(c((t) => t.strong > 0), N), positiveWeakOnly: ratio(c((t) => t.pos > 0 && t.strong === 0), N), negative: ratio(c((t) => t.neg > 0), N),
    positiveAndNegative: ratio(c((t) => t.pos > 0 && t.neg > 0), N), gating: ratio(c((t) => t.gating > 0), N), edge: ratio(c((t) => t.edge > 0), N),
    kwEmits: ratio(kwEmitsTasks.length, kwEmitsTasks.length), kwEmitsWithEmitVector: ratio(kwEmitsTasks.length - emitMissing.length, kwEmitsTasks.length),
    families: fams,
    noPositive: tasks.filter((t) => t.pos === 0).map((t) => t.typeUri), weakOnly: tasks.filter((t) => t.pos > 0 && t.strong === 0).map((t) => t.typeUri), noNegative: tasks.filter((t) => t.neg === 0).map((t) => t.typeUri),
    noGating: tasks.filter((t) => t.gating === 0).map((t) => t.typeUri), kwEmitsWithoutEmitVector: emitMissing,
    ceremonySteps: ratio(steps.filter(stepList).length, steps.length), ceremonyStepTypesPosNeg: ratio(stepTypePN.length, stepTypes.length),
    ceremoniesWithoutSteps: ceremonyIds.filter((id) => !steps.some((s) => s.ceremony === id)), stepsWithoutVector: steps.filter((s) => !stepList(s)).map((s) => `${s.ceremony}:${s.step}`),
    tasks,
  };
}

const fmt = (r: Ratio): string => `${r.pct}% [${r.n}/${r.of}]`;

/** Markdown for the inventory: percentages with denominators, per family, then the gap lists. */
export function renderReport(before: Report, after: Report | null, inputs: Record<string, string>): string {
  const L: string[] = [];
  const row = (name: string, k: keyof Report): void => { const b = before[k] as Ratio; const a = after === null ? null : (after[k] as Ratio); L.push(`| ${name} | ${fmt(b)} | ${a === null ? "-" : fmt(a)} |`); };
  L.push("| Measure (latest version of each task in scope) | Before | After |", "|---|---|---|");
  row("Tasks served by VTI", "vtiServed"); row("Tasks with a wallet role with code (emits, serves, names-only)", "kwRole"); row("Tasks in both", "both");
  row("Tasks covered by at least one vector", "anyVector"); row("Tasks with a positive vector (any kind)", "positive"); row("Tasks with a positive vector that asserts success (the task's own response, or an emitted document)", "positiveAsserted"); row("Tasks whose positive vectors are weak only (any non-envelope answer passes)", "positiveWeakOnly"); row("Tasks with a negative vector", "negative");
  row("Tasks whose positive vectors are all skipped for safety by default (covered, but not run without a disposable deployment)", "positiveSkippedByDefault"); row("Tasks whose negative vectors are all skipped for safety by default (covered, but not run without a disposable deployment)", "negativeSkippedByDefault");
  row("Tasks with positive and negative", "positiveAndNegative"); row("Tasks with a gating (registry) vector", "gating"); row("Tasks with an edge vector (title heuristic)", "edge");
  row("Wallet-emitted tasks with an emit vector", "kwEmitsWithEmitVector"); row("Ceremony steps whose task has a vector", "ceremonySteps"); row("Ceremony step task types with positive and negative", "ceremonyStepTypesPosNeg");
  L.push("", `Scope: ${before.scope.of} tasks (denominator for every row except the wallet-emit and ceremony rows). Inputs: ${Object.entries(inputs).map(([k, v]) => `${k} ${v}`).join("; ")}.`, "");
  L.push("| Family | Tasks | Any vector | Positive and negative | Gating |", "|---|---|---|---|---|");
  for (const f of (after ?? before).families) L.push(`| ${f.family} | ${f.tasks} | ${fmt(f.anyVector)} | ${fmt(f.positiveAndNegative)} | ${fmt(f.gating)} |`);
  return L.join("\n") + "\n";
}
