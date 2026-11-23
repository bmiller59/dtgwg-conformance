// SPDX-License-Identifier: Apache-2.0
// PROTOTYPE (design proposal, not wired into `npm run regen`): which suites each platform attempts, how complete each attempt is, and
// how well the attempted part agrees with the specification text.
//
// A suite is a task-force family (the first segment of the task slug); a family with more than `splitAbove` focus tasks is split by its
// second segment, and sub-prefixes with fewer than `minSubSuite` tasks are kept together as "<family> (other)". The framework rule groups and
// the five framework tasks (trust-task-control, -discovery, -error, -next-step, trust-ceremony-receipt) form the suite "core".
//
// Scope comes from CODE EVIDENCE first (decision D380): the tasks a platform's code serves (dispatcher or handler) or sends (builder),
// united with what its adapter declares at the measured build (run.json, read through the roll-up prototype). Names without a builder or
// handler are shown, never counted as implemented. An optional override file may classify suites with no evidence or annotate attempted
// ones; it can never remove a suite that has evidence.
//
// Per attempted suite two numbers (D381): COMPLETENESS = implemented tasks at the latest version / focus tasks of the suite, and
// CONFORMANCE = conformance-implied agreement (gating checks only) on the implemented part, printed with its measured share. Suites with no
// role by design (NOT ATTEMPTED) and suites the platform could build but does not (NOT YET BUILT) are shown and never scored (D382).
//
// Usage (read-only on its inputs; writes only the --out and --md files):
//   node --experimental-strip-types scripts/suite-attempt-prototype.ts --rollup <rollup.json> --kw-roles <kw-roles.json>
//        [--vti-roles results/coverage/vti-roles.json] [--matrix results/coverage/matrix.json] [--overrides results/scope] [--out f.json] [--md f.md]
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------- catalogue

export interface CatalogueCfg { splitAbove: number; minSubSuite: number; core: string[] }
export const DEFAULT_CATALOGUE: CatalogueCfg = {
  splitAbove: 30, minSubSuite: 3,
  core: ["trust-task-control", "trust-task-discovery", "trust-task-error", "trust-task-next-step", "trust-ceremony-receipt"],
};
export interface Suite { id: string; family: string; tasks: string[]; ceremonies: string[] }

/** Suite id of a slug, given the families that are split and the sub-prefixes that stand on their own. */
export function suiteOf(slug: string, split: Map<string, Set<string>>, cfg: CatalogueCfg = DEFAULT_CATALOGUE): string {
  const seg = slug.split("/");
  const fam = seg[0] ?? slug;
  if (fam === "framework" || cfg.core.includes(fam)) return "core";
  const subs = split.get(fam);
  if (subs === undefined) return fam;
  const sub = seg.length > 1 ? `${fam}/${seg[1]}` : fam;
  return subs.has(sub) ? sub : `${fam} (other)`;
}

/** Builds the suites from the focus slugs (one per slug) and the ceremony groups (group to slugs). */
export function buildCatalogue(focusSlugs: string[], ceremonies: Map<string, string[]>, frameworkGroups: string[], cfg: CatalogueCfg = DEFAULT_CATALOGUE): { suites: Map<string, Suite>; split: Map<string, Set<string>> } {
  const byFam = new Map<string, string[]>();
  for (const s of focusSlugs) { const f = s.split("/")[0] ?? s; byFam.set(f, [...(byFam.get(f) ?? []), s]); }
  const split = new Map<string, Set<string>>();
  for (const [f, slugs] of byFam) {
    if (cfg.core.includes(f) || slugs.length <= cfg.splitAbove) continue;
    const n = new Map<string, number>();
    for (const s of slugs) { const p = s.split("/").slice(0, 2).join("/"); n.set(p, (n.get(p) ?? 0) + 1); }
    split.set(f, new Set([...n].filter(([, c]) => c >= cfg.minSubSuite).map(([p]) => p)));
  }
  const suites = new Map<string, Suite>();
  const add = (slug: string): void => {
    const id = suiteOf(slug, split, cfg);
    const s = suites.get(id) ?? { id, family: id === "core" ? "core" : (slug.split("/")[0] ?? slug), tasks: [], ceremonies: [] };
    if (!s.tasks.includes(slug)) s.tasks.push(slug);
    suites.set(id, s);
  };
  for (const g of frameworkGroups) add(`framework/${g}`);
  for (const s of focusSlugs) add(s);
  for (const [g, slugs] of ceremonies) for (const sl of slugs) { const s = suites.get(suiteOf(sl, split, cfg)); if (s !== undefined && !s.ceremonies.includes(g)) s.ceremonies.push(g); }
  for (const s of suites.values()) { s.tasks.sort(); s.ceremonies.sort(); }
  return { suites, split };
}

// ---------------------------------------------------------------- evidence

export type Role = "receive" | "send";
/** Kinds of evidence that a task is included, strongest first. `named` never makes a task implemented. */
export type EvidenceKind = "served-code" | "sent-code" | "declared-run" | "older-code" | "older-run" | "named";
export interface TaskEvidence { slug: string; role: Role; atLatest: boolean; kind: EvidenceKind; source: string }
/** Role classes from a judgement rule (no code evidence): used only to split NOT ATTEMPTED from NOT YET BUILT. */
export type RuleClass = "not-involved" | "not-built";

export type Band = "attempts" | "not-attempted" | "not-yet-built" | "not-classified";
export type Confidence = "high" | "medium" | "low";
export type Mark = "clear" | "insufficient" | "none";

/** Gating states from the roll-up (see scripts/rollup-prototype.ts); `not-measured-build` = code evidence the measured run did not declare. */
export type ItemState = "agrees" | "unsettled" | "differs" | "unexplained" | "behind" | "not-reached" | "declared-not-offered" | "no-check" | "not-run" | "not-measured-build";
const MEASURED: ItemState[] = ["agrees", "unsettled", "differs", "unexplained"];

export interface Thresholds { minMeasuredShare: number; minDecided: number }
/** Per-suite reading: a percentage needs half the attempted items measured and at least 3 decided (the headline keeps 50% and 10: D330). */
export const SUITE_THRESHOLDS: Thresholds = { minMeasuredShare: 0.5, minDecided: 3 };

export interface Reading { items: number; measured: number; decided: number; agrees: number; differs: number; unexplained: number; byState: Partial<Record<ItemState, number>>; measuredShare: number; agreement: number | null; mark: Mark }

export function reading(states: ItemState[], t: Thresholds = SUITE_THRESHOLDS): Reading {
  const byState: Partial<Record<ItemState, number>> = {};
  for (const s of states) byState[s] = (byState[s] ?? 0) + 1;
  const n = (s: ItemState): number => byState[s] ?? 0;
  const measured = MEASURED.reduce((a, s) => a + n(s), 0);
  const decided = n("agrees") + n("differs") + n("unexplained");
  const measuredShare = states.length === 0 ? 0 : measured / states.length;
  const mark: Mark = measured === 0 ? "none" : measuredShare >= t.minMeasuredShare && decided >= t.minDecided ? "clear" : "insufficient";
  return { items: states.length, measured, decided, agrees: n("agrees"), differs: n("differs"), unexplained: n("unexplained"), byState, measuredShare, agreement: mark === "clear" ? n("agrees") / decided : null, mark };
}

export interface OverrideEntry { suite: string; band?: Exclude<Band, "attempts" | "not-classified">; note: string; basis: "declared" | "inferred" | "unconfirmed"; confirmedBy?: string; confirmedOn?: string; evidence?: string[] }
export interface OverrideFile { format: "tt-scope-override/0.1"; component: string; extends?: string; review: { status: "unreviewed" | "confirmed"; by?: string; on?: string }; entries: OverrideEntry[] }

/** Schema check of an override file; returns the problems (empty = valid). */
export function validateOverride(f: unknown, suiteIds: Set<string>): string[] {
  const e: string[] = [];
  const o = f as Partial<OverrideFile>;
  if (o.format !== "tt-scope-override/0.1") e.push("format must be tt-scope-override/0.1");
  if (typeof o.component !== "string" || o.component === "") e.push("component is required");
  if (o.review === undefined || !["unreviewed", "confirmed"].includes(o.review.status)) e.push("review.status must be unreviewed or confirmed");
  if (o.review?.status === "confirmed" && (o.review.by === undefined || o.review.on === undefined)) e.push("a confirmed file names who confirmed it and when");
  if (!Array.isArray(o.entries)) { e.push("entries must be a list"); return e; }
  const seen = new Set<string>();
  for (const [i, x] of o.entries.entries()) {
    const at = `entries[${i}] (${x.suite})`;
    if (!isPattern(x.suite) && !suiteIds.has(x.suite)) e.push(`${at}: unknown suite`);
    if (seen.has(x.suite)) e.push(`${at}: duplicate suite`);
    seen.add(x.suite);
    if (x.band !== undefined && !["not-attempted", "not-yet-built"].includes(x.band)) e.push(`${at}: band may only be not-attempted or not-yet-built (an override never adds or removes an attempt)`);
    if (typeof x.note !== "string" || x.note.trim() === "") e.push(`${at}: note (the reason) is required`);
    if (!["declared", "inferred", "unconfirmed"].includes(x.basis)) e.push(`${at}: basis must be declared, inferred or unconfirmed`);
    if (x.basis === "declared" && (x.confirmedBy === undefined || x.confirmedOn === undefined)) e.push(`${at}: basis declared needs confirmedBy and confirmedOn`);
    if (x.basis === "inferred" && (x.evidence === undefined || x.evidence.length === 0)) e.push(`${at}: basis inferred needs an evidence link`);
  }
  return e;
}
const isPattern = (s: string): boolean => s.endsWith("/*") || s === "*";
/** The override entry for a suite: an exact entry beats a pattern; a longer pattern beats a shorter one. */
export function overrideFor(entries: OverrideEntry[], suite: string): OverrideEntry | undefined {
  const exact = entries.find((x) => x.suite === suite);
  if (exact !== undefined) return exact;
  const fam = (suite.split("/")[0] ?? suite).replace(/ \(other\)$/, "");
  const m = entries.filter((x) => isPattern(x.suite) && (x.suite === "*" || x.suite.slice(0, -2) === fam));
  return m.sort((a, b) => b.suite.length - a.suite.length)[0];
}

export interface SuiteStatus {
  suite: string; band: Band; confidence: Confidence | null;
  evidenceKinds: EvidenceKind[]; basis: string;
  /** completeness: implemented at the latest version over the suite's focus tasks; older-only and named-only listed apart */
  implemented: number; total: number; olderOnly: number; namedOnly: number; couldBuild: number;
  completeness: number | null;
  conformance: Reading | null;
  flags: string[]; note?: string;
}

/**
 * Classifies one suite for one component.
 * Evidence of an implemented task (served or sent in code, or declared by the adapter at the measured build) makes the suite ATTEMPTS;
 * an override can annotate it but never remove it. Without such evidence: older-version-only evidence is still ATTEMPTS (behind the
 * latest; completeness 0 at the latest); otherwise the override, then the rule class, then a sibling surface, decide; else NOT CLASSIFIED.
 */
export function classifySuite(suite: Suite, ev: TaskEvidence[], states: Map<string, ItemState>, rules: Map<string, RuleClass>, override: OverrideEntry | undefined, sibling: string | undefined): SuiteStatus {
  const mine = ev.filter((e) => suite.tasks.includes(e.slug));
  const impl = mine.filter((e) => e.kind === "served-code" || e.kind === "sent-code" || e.kind === "declared-run");
  const implLatest = new Set(impl.filter((e) => e.atLatest).map((e) => e.slug));
  const older = new Set(mine.filter((e) => !e.atLatest && e.kind !== "named").map((e) => e.slug).filter((s) => !implLatest.has(s)));
  const named = new Set(mine.filter((e) => e.kind === "named").map((e) => e.slug).filter((s) => !implLatest.has(s) && !older.has(s)));
  const kinds = [...new Set(mine.map((e) => e.kind))].sort() as EvidenceKind[];
  const couldBuild = suite.tasks.filter((t) => !implLatest.has(t) && !older.has(t) && rules.get(t) === "not-built").length;
  const flags: string[] = [];
  const base = { suite: suite.id, evidenceKinds: kinds, implemented: implLatest.size, total: suite.tasks.length, olderOnly: older.size, namedOnly: named.size, couldBuild };
  if (implLatest.size > 0 || older.size > 0) {
    const code = mine.some((e) => e.kind === "served-code" || e.kind === "sent-code" || e.kind === "older-code");
    const run = mine.some((e) => e.kind === "declared-run" || e.kind === "older-run");
    const confidence: Confidence = code && run ? "high" : "medium";
    if (code && !run) flags.push("code evidence only: not declared by the measured build (newer checkout or under-declaring adapter)");
    if (run && !code && kinds.every((k) => k === "declared-run" || k === "older-run")) flags.push("adapter declaration only: no code scan for this surface");
    if (override?.band !== undefined) flags.push(`override says ${override.band} (${override.note}); the code evidence keeps it attempted`);
    // conformance: every implemented item of this suite, in its role, at the focus version
    const keys = new Set(impl.map((e) => `${e.role}:${e.slug}`));
    for (const s of older) for (const e of mine.filter((x) => x.slug === s)) keys.add(`${e.role}:${e.slug}`);
    const st = [...keys].map((k) => states.get(k) ?? "not-measured-build");
    return { ...base, band: "attempts", confidence, basis: code && run ? "code and run declaration agree" : code ? "code" : "run declaration", completeness: suite.tasks.length === 0 ? null : implLatest.size / suite.tasks.length, conformance: reading(st), flags, ...(override?.note !== undefined && override.band === undefined ? { note: override.note } : {}) };
  }
  const tail = { ...base, confidence: null, completeness: null, conformance: null };
  if (named.size > 0) flags.push(`named in code only (${named.size}): no builder or handler found`);
  if (override?.band !== undefined) {
    const ruleBand = ruleBandOf(suite, rules);
    if (ruleBand !== null && ruleBand !== override.band) flags.push(`rule reading disagrees: ${ruleBand}`);
    return { ...tail, band: override.band, basis: `override (${override.basis})`, flags, note: override.note };
  }
  const rb = ruleBandOf(suite, rules);
  if (rb !== null) return { ...tail, band: named.size > 0 ? "not-yet-built" : rb, basis: named.size > 0 ? "names in code, no builder or handler" : "role rule (judgement)", flags };
  if (sibling !== undefined) return { ...tail, band: "not-attempted", basis: `another surface of the platform serves it (${sibling})`, flags };
  if (named.size > 0) return { ...tail, band: "not-yet-built", basis: "names in code, no builder or handler", flags };
  return { ...tail, band: "not-classified", basis: "no evidence and no role reading", flags: [...flags, "missing: role classification for this platform"] };
}
function ruleBandOf(suite: Suite, rules: Map<string, RuleClass>): "not-attempted" | "not-yet-built" | null {
  const r = suite.tasks.map((t) => rules.get(t)).filter((x): x is RuleClass => x !== undefined);
  if (r.length === 0) return null;
  return r.includes("not-built") ? "not-yet-built" : "not-attempted";
}

// ---------------------------------------------------------------- strip, headline, derived line

export interface Strip { component: string; name: string; statuses: SuiteStatus[]; counts: Record<Band, number>; headline: string; scope: Reading; flags: string[] }
export const pct = (x: number | null): string => (x === null ? "n/a" : `${Math.round(100 * x)}%`);

/** Headline reading over all attempted suites: the same items and thresholds as the roll-up headline (50% measured, 10 decided). */
export function headlineReading(st: SuiteStatus[]): Reading {
  const states: ItemState[] = [];
  for (const s of st) if (s.conformance !== null) for (const [k, n] of Object.entries(s.conformance.byState)) for (let i = 0; i < (n ?? 0); i++) states.push(k as ItemState);
  return reading(states, { minMeasuredShare: 0.5, minDecided: 10 });
}

/** One line per platform or surface. Never "conformant" or the bare "interoperable" (claims lint, docs/14). */
export function headline(name: string, st: SuiteStatus[]): string {
  const c = (b: Band): number => st.filter((s) => s.band === b).length;
  const r = headlineReading(st);
  const att = st.filter((s) => s.band === "attempts");
  const full = att.filter((s) => s.implemented === s.total).length;
  const fig = r.agreement === null
    ? `conformance-implied agreement withheld (measured ${r.measured} of ${r.items} tasks, ${pct(r.measuredShare)}; ${r.agrees} agree)`
    : `${pct(r.agreement)} conformance-implied agreement on the measured part of those (${r.agrees} of ${r.decided} decided tasks; measured ${r.measured} of ${r.items}, ${pct(r.measuredShare)})`;
  const nm = st.filter((s) => s.band === "not-yet-built" && s.namedOnly > 0).length;
  const more = c("not-yet-built") > 0 ? `; ${c("not-yet-built")} more it could build${nm > 0 ? ` (${nm} named in code only)` : ""}` : "";
  const nc = c("not-classified") > 0 ? `; ${c("not-classified")} not yet classified` : "";
  const byOv = st.filter((s) => s.band === "not-attempted" && s.basis.startsWith("override")).length;
  return `${name}: attempts ${att.length} of ${att.length + c("not-yet-built")} suites it could take part in (${full} in full); ${fig}${more}; ${c("not-attempted")} not its role${byOv > 0 ? ` (${byOv} by an override)` : ""}${nc}.`;
}

export function strip(component: string, name: string, statuses: SuiteStatus[], flags: string[] = []): Strip {
  const counts = { attempts: 0, "not-attempted": 0, "not-yet-built": 0, "not-classified": 0 } as Record<Band, number>;
  for (const s of statuses) counts[s.band]++;
  return { component, name, statuses, counts, headline: headline(name, statuses), scope: headlineReading(statuses), flags };
}

/**
 * The derived platform line (D332): a suite is attempted if any surface attempts it; completeness counts a task once if any surface
 * implements it; conformance pools the surfaces' items (each kept under its surface, so nothing is merged away); the weakest surface is named.
 */
export function derivedStatus(suite: Suite, perSurface: { surface: string; s: SuiteStatus }[]): SuiteStatus & { weakest: string | null } {
  const att = perSurface.filter((x) => x.s.band === "attempts");
  if (att.length === 0) {
    // not yet built if any surface could build it; else not attempted if any surface says so (by a rule or an override); else not classified
    const order: Band[] = ["not-yet-built", "not-attempted", "not-classified"];
    const b = order.find((o) => perSurface.some((x) => x.s.band === o && !x.s.basis.startsWith("another surface"))) ?? "not-classified";
    return { ...perSurface[0]!.s, band: b, basis: "derived from the surfaces", flags: [], weakest: null };
  }
  const states: ItemState[] = [];
  for (const x of att) for (const [k, n] of Object.entries(x.s.conformance?.byState ?? {})) for (let i = 0; i < (n ?? 0); i++) states.push(k as ItemState);
  const implemented = Math.max(...att.map((x) => x.s.implemented)); // lower bound of the union without the task lists; exact union in derivedFromEvidence
  let weakest: string | null = null; let low = 2;
  for (const x of att) { const r = x.s.conformance; const v = r === null ? 1.5 : r.agreement ?? 1.2; if (v < low) { low = v; weakest = x.surface; } }
  const conf = att.map((x) => x.s.confidence);
  return { ...att[0]!.s, suite: suite.id, band: "attempts", implemented, completeness: implemented / suite.tasks.length, conformance: reading(states), confidence: conf.includes("high") ? "high" : "medium", basis: `derived from ${att.map((x) => x.surface).join(", ")}`, flags: [], weakest };
}

/**
 * The weakest surface of a derived platform (D423): the attempting surface with the least conformance evidence, that is the lowest measured share of
 * its attempted tasks (no measurement counts as 0%), then the lower clear agreement, then the larger attempted scope. A surface with no attempts is not a candidate.
 * Other surfaces with no measurement at all are named beside it.
 * Returns null when no surface attempts anything.
 */
export function weakestSurface(surfaces: { id: string; name: string; strip: Strip }[]): { id: string; name: string; text: string } | null {
  const cand = surfaces.filter((x) => x.strip.counts.attempts > 0);
  if (cand.length === 0) return null;
  const key = (x: { strip: Strip }): [number, number, number] => [x.strip.scope.items === 0 ? 0 : x.strip.scope.measuredShare, x.strip.scope.agreement ?? 2, -x.strip.scope.items];
  const w = [...cand].sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1] || key(a)[2] - key(b)[2])[0] as (typeof cand)[number];
  const r = w.strip.scope;
  const alsoNone = cand.filter((x) => x.id !== w.id && x.strip.scope.measured === 0).map((x) => x.name);
  const text = r.measured === 0 ? `no measurement of its ${r.items} attempted tasks${alsoNone.length > 0 ? `; also with no measurement: ${alsoNone.join(", ")}` : ""}` : `measured ${r.measured} of ${r.items} attempted tasks, ${pct(r.measuredShare)}${r.agreement === null ? "; agreement withheld" : `; ${pct(r.agreement)} agreement`}`;
  return { id: w.id, name: w.name, text };
}

// ---------------------------------------------------------------- inputs (CLI only)

interface MatrixTask { slug: string; version: string; typeUri: string; focus?: string; vti: { pinned: boolean; served: string[] } }
interface RollupJson { inputs: Record<string, unknown>; components: { id: string; name: string; kind: string; items?: { key: string; declared: string[]; gating: ItemState }[]; ceremony?: unknown; scope?: { ceremonyRoles?: { ceremony: string }[] } }[]; pairs: { row: string; parties: string[]; originalPair: boolean; groups: Record<string, { scenarios: number; completed: number; asSpecified: number; skipped: number }> }[] }
interface KwRole { slug: string; role: string; basis: string; versionsNamed: string[] }
/** One row of results/coverage/vti-roles.json (D420): the role on each VTI surface. */
export interface VtiRoleJson { slug: string; surfaces: Record<string, { role: string; basis: string; also?: string[]; evidence?: { file: string; line: number; use?: string }[] }> }

/** Components the strip is computed for (platform order: VTI, keyring-wallet). */
/** `vtiSurfaces` are the surfaces of the VTI role file (results/coverage/vti-roles.json, D420) this component reads; without that file `vtiServed` (the matrix's dispatcher tables) is the fallback. */
export interface ComponentCfg { id: string; name: string; platform: string; rollup?: string; vtiServed?: string; vtiSurfaces?: string[]; kwCode?: boolean; siblings?: string[]; note?: string }
export const COMPONENTS: ComponentCfg[] = [
  { id: "vti-agent", name: "VTI agent service (VTA)", platform: "vti", rollup: "vti-agent", vtiServed: "vta", vtiSurfaces: ["vta"], siblings: ["vti-community", "vti-witness"] },
  { id: "vti-community", name: "VTI community service (VTC)", platform: "vti", rollup: "vti-community", vtiServed: "vtc", vtiSurfaces: ["vtc"], siblings: ["vti-agent", "vti-witness"] },
  { id: "vti-client", name: "VTI client builders (sending side: SDK, CLI, community client, mobile core, mcp)", platform: "vti", rollup: "vti-client", vtiSurfaces: ["client", "mobile", "mcp"] },
  { id: "vti-witness", name: "VTI witness service", platform: "vti", vtiServed: "witness", vtiSurfaces: ["witness"], siblings: ["vti-agent", "vti-community"], note: "no run recorded at the latest version (needs the agent and a mediator)" },
  { id: "vti-voting", name: "VTI voting service", platform: "vti", vtiSurfaces: ["voting"], note: "no run recorded for the voting service" },
  { id: "kw-wallet", name: "keyring-wallet (wallet logic)", platform: "kw", rollup: "kw", kwCode: true },
  { id: "kw-witness", name: "keyring-wallet witness server", platform: "kw", rollup: "kw-witness" },
];
export const PLATFORMS: { id: string; name: string; surfaces: string[] }[] = [
  { id: "vti", name: "VTI (derived from its surfaces)", surfaces: ["vti-agent", "vti-community", "vti-client", "vti-witness", "vti-voting"] },
  { id: "kw", name: "keyring-wallet (derived from its surfaces)", surfaces: ["kw-wallet", "kw-witness"] },
];

const rd = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));
const parseKey = (k: string): { role: Role; slug: string; version: string } => {
  const [role, rest] = k.split(":") as [Role, string];
  const [slug, version] = rest.split("@") as [string, string | undefined];
  return { role, slug, version: version ?? "" };
};

/** Evidence per component: code (VTI dispatcher tables, wallet roles) united with the adapter declaration of the measured build. */
export function evidenceFor(c: ComponentCfg, focus: Map<string, MatrixTask>, tasks: MatrixTask[], rollupItems: { key: string; declared: string[]; gating: ItemState }[], kwRoles: KwRole[], vtiRoles: VtiRoleJson[] | null = null): TaskEvidence[] {
  const ev: TaskEvidence[] = [];
  for (const it of rollupItems) {
    const { role, slug, version } = parseKey(it.key);
    const atLatest = slug.startsWith("framework/") || it.declared.includes(version);
    ev.push({ slug, role, atLatest, kind: atLatest ? "declared-run" : "older-run", source: "adapter run.json at the measured build" });
  }
  if (c.vtiSurfaces !== undefined && vtiRoles !== null) {
    for (const r of vtiRoles) for (const sid of c.vtiSurfaces) {
      const x = r.surfaces[sid];
      if (x === undefined) continue;
      const service = sid === "vta" || sid === "vtc" || sid === "witness" || sid === "voting";
      const at = x.evidence?.[0] === undefined ? "" : ` ${x.evidence[0].file}:${x.evidence[0].line}`;
      const src = (what: string): string => `VTI ${sid}: ${what}${at}`;
      const send = (atLatest: boolean, kind: EvidenceKind, what: string): void => { ev.push({ slug: r.slug, role: "send", atLatest, kind, source: src(what) }); };
      const recv = (atLatest: boolean, kind: EvidenceKind, what: string): void => { ev.push({ slug: r.slug, role: "receive", atLatest, kind, source: src(what) }); };
      if (x.role === "serves") { recv(true, "served-code", x.basis === "dispatch" ? "handler registration" : "read from a received document"); if (x.also?.includes("emits")) send(true, "sent-code", "builder or send call"); }
      else if (x.role === "emits") { send(true, "sent-code", "builder or send call"); if (x.also?.includes("serves")) recv(true, "served-code", "read from a received document"); }
      else if (x.role === "older-version") (service ? recv : send)(false, "older-code", "only a lower version");
      else if (x.role === "named-only") (service ? recv : send)(true, "named", x.basis === "pin" ? "pinned in the spec crate, no handler" : "named in code only");
    }
  } else if (c.vtiServed !== undefined) {
    for (const t of tasks) {
      if (!t.vti.served.includes(c.vtiServed)) continue;
      const f = focus.get(t.slug);
      const atLatest = f !== undefined && f.typeUri === t.typeUri;
      if (!atLatest && ev.some((e) => e.slug === t.slug && e.kind === "served-code" && e.atLatest)) continue;
      ev.push({ slug: t.slug, role: "receive", atLatest, kind: atLatest ? "served-code" : "older-code", source: `VTI dispatcher table (${c.vtiServed}), VTI main` });
    }
    for (const t of tasks) if (t.vti.pinned && t.vti.served.length === 0 && focus.get(t.slug)?.typeUri === t.typeUri && c.id.endsWith("agent")) ev.push({ slug: t.slug, role: "receive", atLatest: true, kind: "named", source: "VTI pins it (trust-tasks.lock), no dispatcher serves it" });
  }
  if (c.kwCode === true) for (const r of kwRoles) {
    if (r.role === "serves") ev.push({ slug: r.slug, role: "receive", atLatest: true, kind: "served-code", source: `wallet ${r.basis} (comment-stripped scan)` });
    else if (r.role === "emits") ev.push({ slug: r.slug, role: "send", atLatest: true, kind: "sent-code", source: "wallet builder (comment-stripped scan)" });
    else if (r.role === "older-version") ev.push({ slug: r.slug, role: "send", atLatest: false, kind: "older-code", source: `wallet names only older versions (${r.versionsNamed.join(", ")})` });
    else if (r.role === "names-only") ev.push({ slug: r.slug, role: "send", atLatest: true, kind: "named", source: "wallet names it, no builder or handler" });
  }
  return ev;
}

export function rulesFor(c: ComponentCfg, kwRoles: KwRole[], vtiRoles: VtiRoleJson[] | null = null): Map<string, RuleClass> {
  const m = new Map<string, RuleClass>();
  if (c.vtiSurfaces !== undefined && vtiRoles !== null) {
    // a slug on several surfaces (the client card unions client, mobile core and mcp): not-built if any surface could build it, else not-involved
    for (const r of vtiRoles) {
      const roles = c.vtiSurfaces.map((sid) => r.surfaces[sid]?.role);
      if (roles.includes("not-built") || roles.includes("named-only")) m.set(r.slug, "not-built");
      else if (roles.includes("not-involved")) m.set(r.slug, "not-involved");
    }
    return m;
  }
  if (c.kwCode === true) for (const r of kwRoles) {
    if (r.role === "not-involved") m.set(r.slug, "not-involved");
    else if (r.role === "client-capable-not-built" || r.role === "wallet-relevant-not-named") m.set(r.slug, "not-built");
  }
  return m;
}

export function loadOverrides(dir: string | undefined, suiteIds: Set<string>): Map<string, OverrideEntry[]> {
  const out = new Map<string, OverrideEntry[]>();
  if (dir === undefined || !existsSync(dir)) return out;
  const files = new Map<string, OverrideFile>();
  for (const n of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const f = rd(join(dir, n)) as OverrideFile;
    const errs = validateOverride(f, suiteIds);
    if (errs.length > 0) throw new Error(`${n}: ${errs.join("; ")}`);
    files.set(f.component, f);
  }
  const resolve = (id: string, depth = 0): OverrideEntry[] => {
    const f = files.get(id);
    if (f === undefined || depth > 4) return [];
    const parent = f.extends === undefined ? [] : resolve(f.extends, depth + 1);
    return [...f.entries, ...parent.filter((p) => !f.entries.some((e) => e.suite === p.suite))];
  };
  for (const id of files.keys()) out.set(id, resolve(id));
  return out;
}

// ---------------------------------------------------------------- rendering

const BAND_LABEL: Record<Band, string> = { attempts: "Attempts", "not-attempted": "Not attempted (not its role)", "not-yet-built": "Not yet built (could build)", "not-classified": "Not yet classified" };
const MARK_LABEL: Record<Mark, string> = { clear: "clear reading", insufficient: "insufficient evidence", none: "no measurement" };
export function cellText(s: SuiteStatus): string {
  if (s.band !== "attempts") return "";
  const comp = `${s.implemented}/${s.total}${s.olderOnly > 0 ? ` (+${s.olderOnly} older)` : ""}`;
  const r = s.conformance;
  const conf = r === null || r.mark === "none" ? "no measurement" : r.mark === "insufficient" ? `insufficient (${r.agrees} of ${r.decided} agree, ${pct(r.measuredShare)} measured)` : `${pct(r.agreement)} (${r.agrees}/${r.decided}, ${pct(r.measuredShare)} measured)`;
  return `${comp} · ${conf}`;
}

export function renderMd(strips: Strip[]): string {
  const md: string[] = [];
  for (const s of strips) {
    md.push(`### ${s.name}`, "", s.headline, "");
    for (const b of ["attempts", "not-yet-built", "not-attempted", "not-classified"] as Band[]) {
      const list = s.statuses.filter((x) => x.band === b);
      if (list.length === 0) continue;
      if (b === "attempts") {
        md.push(`**${BAND_LABEL[b]} (${list.length})**`, "", "| Suite | Completeness (latest) | Conformance (gating) | Mark | Evidence | Confidence |", "|---|---|---|---|---|---|");
        for (const x of list) md.push(`| ${x.suite} | ${x.implemented} of ${x.total}${x.olderOnly > 0 ? ` (+${x.olderOnly} at an older version only)` : ""} | ${x.conformance?.agreement === null || x.conformance === null ? "n/a" : pct(x.conformance.agreement)} (${x.conformance?.agrees ?? 0} of ${x.conformance?.decided ?? 0}; ${pct(x.conformance?.measuredShare ?? 0)} measured) | ${MARK_LABEL[x.conformance?.mark ?? "none"]} | ${x.evidenceKinds.join(", ")} | ${x.confidence ?? ""} |`);
        md.push("");
      } else md.push(`**${BAND_LABEL[b]} (${list.length}):** ${list.map((x) => x.suite).join(", ")}`, "");
    }
    if (s.flags.length > 0) md.push(...s.flags.map((f) => `- ${f}`), "");
  }
  return md.join("\n");
}

// ---------------------------------------------------------------- CLI

async function main(argv: string[]): Promise<void> {
  const arg = (k: string): string | undefined => { const i = argv.indexOf(k); return i < 0 ? undefined : argv[i + 1]; };
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const rollupPath = arg("--rollup");
  const kwPath = arg("--kw-roles");
  if (rollupPath === undefined || kwPath === undefined) throw new Error("--rollup <rollup.json from scripts/rollup-prototype.ts> and --kw-roles <kw-roles.json> are required");
  const matrix = rd(arg("--matrix") ?? join(root, "results", "coverage", "matrix.json")) as { tasks: MatrixTask[]; vectors: { set: string; group: string; tasks: string[] }[]; inputs: Record<string, string> };
  const roll = rd(rollupPath) as RollupJson;
  const kwRoles = (rd(kwPath) as { rows: KwRole[] }).rows;
  const vtiRolesPath = arg("--vti-roles") ?? join(root, "results", "coverage", "vti-roles.json");
  const vtiRolesFile = existsSync(vtiRolesPath) ? (rd(vtiRolesPath) as { rows: VtiRoleJson[]; inputs: Record<string, string> }) : null;
  const vtiRolesFor = (c: ComponentCfg): VtiRoleJson[] | null => (vtiRolesFile === null || c.vtiSurfaces === undefined ? null : vtiRolesFile.rows);
  const focus = new Map(matrix.tasks.filter((t) => t.focus === "focus").map((t) => [t.slug, t]));
  const fwGroups = [...new Set(matrix.vectors.filter((v) => v.set === "framework" && v.tasks.length === 0).map((v) => v.group))].sort();
  const cerDir = join(root, "vectors", "ceremony-scenarios");
  const ceremonies = new Map<string, string[]>();
  for (const n of readdirSync(cerDir).filter((x) => /^fc-.*\.json$/.test(x))) {
    const t = readFileSync(join(cerDir, n), "utf8");
    const g = (JSON.parse(t) as { group: string }).group;
    ceremonies.set(g, [...new Set([...t.matchAll(/https:\/\/trusttasks\.org\/spec\/([a-z0-9/-]+?)\/\d+\.\d+/g)].map((m) => m[1]!))]);
  }
  const { suites, split } = buildCatalogue([...focus.keys()], ceremonies, fwGroups);
  const ids = new Set(suites.keys());
  const overrides = loadOverrides(arg("--overrides") ?? join(root, "results", "scope"), ids);

  const perComp = new Map<string, Strip>();
  const evBy = new Map<string, TaskEvidence[]>();
  for (const c of COMPONENTS) {
    const items = roll.components.find((x) => x.id === c.rollup)?.items ?? [];
    const ev = evidenceFor(c, focus, matrix.tasks, items, kwRoles, vtiRolesFor(c));
    evBy.set(c.id, ev);
  }
  for (const c of COMPONENTS) {
    const items = roll.components.find((x) => x.id === c.rollup)?.items ?? [];
    const states = new Map<string, ItemState>(items.map((i) => { const k = parseKey(i.key); return [`${k.role}:${k.slug}`, i.gating]; }));
    const ev = evBy.get(c.id)!;
    const rules = rulesFor(c, kwRoles, vtiRolesFor(c));
    const ov = overrides.get(c.id) ?? [];
    const statuses = [...suites.values()].map((s) => {
      const sib = (c.siblings ?? []).find((o) => (evBy.get(o) ?? []).some((e) => s.tasks.includes(e.slug) && e.kind !== "named"));
      return classifySuite(s, ev, states, rules, overrideFor(ov, s.id), sib);
    });
    const flags: string[] = [];
    if (c.rollup === undefined || items.length === 0) flags.push("missing: no measured run at the latest version for this surface");
    const named = statuses.filter((x) => x.band === "not-yet-built" && x.namedOnly > 0).length;
    if (named > 0) flags.push(`${named} of the suites it could build are named in code only (a pin, a list or a table, no handler or builder): shown as not yet built, never as attempted (D408)`);
    const viaRoles = vtiRolesFor(c) !== null;
    if (viaRoles && vtiRolesFile !== null) {
      flags.push(`code scan is the VTI role file (D420; handler registrations and the sending side, comments stripped): VTI main ${vtiRolesFile.inputs["verifiable-trust-infrastructure (upstream main)"] ?? "?"}; the measured build is older (commit skew)`);
      if (c.vtiSurfaces !== undefined && c.vtiSurfaces.length > 1) flags.push(`this card reads the surfaces ${c.vtiSurfaces.join(", ")} together; only the client builders have run records (the emit surface)`);
    } else if (c.vtiServed !== undefined) flags.push(`code scan is VTI main ${matrix.inputs["verifiable-trust-infrastructure (upstream main)"] ?? "?"}; the measured build is older (commit skew)`);
    if (c.kwCode === true) flags.push(`code scan is keyring-wallet ${String((rd(kwPath) as { inputs: Record<string, string> }).inputs["keyring-wallet"])}`);
    if (c.vtiServed === undefined && c.vtiSurfaces === undefined && c.kwCode !== true) flags.push("missing: no code scan for this surface; scope is the adapter declaration only");
    if (c.note !== undefined) flags.push(c.note);
    if (statuses.some((s) => s.band === "not-classified")) flags.push(`missing: no role classification for this surface (not attempted versus not yet built)${c.platform.startsWith("vti") && !viaRoles ? "; no VTI role file was given (D305)" : ""}`);
    perComp.set(c.id, strip(c.id, c.name, statuses, flags));
  }
  const platforms: Strip[] = PLATFORMS.map((p) => {
    const st = [...suites.values()].map((s) => {
      const per = p.surfaces.map((x) => ({ surface: x, s: perComp.get(x)!.statuses.find((y) => y.suite === s.id)! }));
      const d = derivedStatus(s, per);
      const implUnion = new Set(p.surfaces.flatMap((x) => (evBy.get(x) ?? []).filter((e) => s.tasks.includes(e.slug) && e.atLatest && e.kind !== "named").map((e) => e.slug)));
      return d.band === "attempts" ? { ...d, implemented: implUnion.size, completeness: implUnion.size / s.tasks.length } : d;
    });
    const out = strip(p.id, p.name, st, p.surfaces.length > 1 ? ["derived line (D332): surfaces are listed apart below; the conformance figure pools their items and names the weakest surface"] : []);
    const weak = p.surfaces.length > 1 ? weakestSurface(p.surfaces.map((id) => ({ id, name: COMPONENTS.find((c) => c.id === id)?.name ?? id, strip: perComp.get(id)! }))) : null;
    if (weak !== null) { out.headline += ` Weakest surface: ${weak.name} (${weak.text}).`; out.flags.push(`weakest surface (D423: least conformance evidence, then lowest agreement): ${weak.name}`); }
    return out;
  });
  // ceremony groups per component: ran with a platform partner / role declared / none
  const cer: Record<string, Record<string, string>> = {};
  for (const c of COMPONENTS) {
    const rc = roll.components.find((x) => x.id === c.rollup);
    const roles = new Set((rc?.scope?.ceremonyRoles ?? []).map((r) => r.ceremony));
    const rows = roll.pairs.filter((r) => c.rollup !== undefined && r.parties.includes(c.rollup));
    const row: Record<string, string> = {};
    for (const g of ceremonies.keys()) {
      const mine = rows.filter((r) => r.groups[g] !== undefined);
      const fmt = (t: { scenarios: number; completed: number; asSpecified: number; skipped: number }): string => `${t.completed + t.asSpecified}/${t.scenarios - t.skipped}${t.skipped > 0 ? ` (${t.skipped} skipped)` : ""}`;
      const un = mine.filter((r) => r.originalPair);
      if (un.length > 0) row[g] = `ran with platform partner: ${un.map((r) => fmt(r.groups[g]!)).join(" · ")}`;
      else if (roles.has(g)) row[g] = "role declared, not run";
    }
    cer[c.id] = row;
  }
  // VTI x keyring-wallet overlap (original): suites both attempt, the sender/receiver pairings, and shared ceremony groups
  const att = (p: string): Set<string> => new Set(platforms.find((x) => x.component === p)!.statuses.filter((s) => s.band === "attempts").map((s) => s.suite));
  const roleSet = (ids2: string[], role: Role): Set<string> => new Set(ids2.flatMap((x) => (evBy.get(x) ?? []).filter((e) => e.role === role && e.kind !== "named").map((e) => suiteOf(e.slug, split))));
  const vti = att("vti"); const kw = att("kw");
  const both = [...vti].filter((s) => kw.has(s)).sort();
  const kwSendVtiServe = both.filter((s) => roleSet(["kw-wallet"], "send").has(s) && roleSet(["vti-agent", "vti-community"], "receive").has(s));
  const sharedCer = [...ceremonies.keys()].filter((g) => cer["kw-wallet"]?.[g] !== undefined && (cer["vti-agent"]?.[g] !== undefined || cer["vti-community"]?.[g] !== undefined)).sort();
  const venn = { vtiOnly: [...vti].filter((s) => !kw.has(s)).sort(), kwOnly: [...kw].filter((s) => !vti.has(s)).sort(), both, kwSendsVtiServes: kwSendVtiServe, sharedCeremonyGroups: sharedCer, originalPairCeremonyGroups: sharedCer.filter((g) => (cer["kw-wallet"]?.[g] ?? "").startsWith("ran with original")) };

  const out = {
    format: "tt-suite-attempt-prototype/0.1", generated: new Date().toISOString().slice(0, 10),
    inputs: { rollup: rollupPath, vtiRoles: vtiRolesFile === null ? null : { inputs: vtiRolesFile.inputs }, rollupInputs: roll.inputs, kwRoles: kwPath, kwRolesInputs: (rd(kwPath) as { inputs: unknown }).inputs, matrix: matrix.inputs, overrides: [...overrides.keys()] },
    catalogue: { cfg: DEFAULT_CATALOGUE, suites: [...suites.values()].map((s) => ({ id: s.id, family: s.family, tasks: s.tasks.length, ceremonies: s.ceremonies })) },
    thresholds: { suite: SUITE_THRESHOLDS, headline: { minMeasuredShare: 0.5, minDecided: 10 } },
    platforms, surfaces: [...perComp.values()], ceremonies: cer, ceremonyTasks: Object.fromEntries(ceremonies), venn,
  };
  const o = arg("--out"); if (o !== undefined) writeFileSync(o, JSON.stringify(out, null, 1) + "\n");
  const m = arg("--md"); if (m !== undefined) writeFileSync(m, renderMd([...platforms, ...perComp.values()]) + "\n");
  if (o === undefined && m === undefined) process.stdout.write([...platforms, ...perComp.values()].map((s) => s.headline).join("\n") + "\n");
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
}
