// SPDX-License-Identifier: Apache-2.0
// Scope-relative roll-up per platform component.
//
// For each component (one platform surface or a group of surfaces that run the same code in one role) it derives a declared scope from
// evidence that does not depend on results (the adapter's declared supportedTypes / emits / ceremonyRoles in run.json, normalised to the
// latest non-retired version of each task: decision D245), then reads the recorded results against that scope:
//   P  conformance-implied agreement on the measured part of the declared scope (gating, registry-channel checks only);
//   M  measured share of the declared scope (how much of P's scope the suite actually reached);
//   F  shown-agreeing share of the declared scope (P's numerator over the whole declared scope: a floor, never a headline alone);
//   C  ceremony completion on shared flows (separate evidence kind; never added to P: docs/26 section 1, decision D22 / CV-15).
// P is withheld ("insufficient evidence") when M is below the threshold or too few items were measured.
//
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { activePromotions } from "../vectors/promotion.ts";
import type { PromotionFile } from "../vectors/promotion.ts";

// ---------------------------------------------------------------- types

export type Role = "receive" | "send";
export type Status = "PASS" | "CLARIFY" | "SKIP" | "KNOWN-FAIL" | "FAIL" | "QUARANTINED" | "SPEC-CHANGED" | "SKIPPED-SAFETY";
export type SkipClass = "not-applicable" | "not-reached" | "version-mismatch" | "out-of-tier" | "unclassified";
export type Evidence = "gating" | "advisory";

/** One task (at its focus version) or one framework rule group, in one role. */
export interface ScopeItem {
  key: string; // `${role}:${slug}@${focusVersion}` or `receive:framework/<GROUP>`
  role: Role;
  slug: string;
  focusVersion: string;
  /** versions of this slug the platform declares (empty for framework items) */
  declaredVersions: string[];
  /** true when one declared version is the focus version (or a framework item) */
  atLatest: boolean;
  maturity: string; // draft, candidate, standard, retired, framework
  sourceKind: string; // main, pr, branch, framework
  why: string[]; // which declaration put it in scope
}

/** `diffClass`: the vector-review class (A to D) of a KNOWN-FAIL's exception or of a FAIL's recorded finding (results/findings.json); absent = unclassed. */
export interface Outcome { id: string; status: Status; cls: SkipClass | null; evidence: Evidence; itemKeys: string[]; diffClass?: string; finding?: boolean }

/**
 * How a ran check counts. A and B (and an unclassed exception) are a recorded difference; C (unsettled in the specification) counts as
 * CLARIFY; D (harness or stand-in limit, docs/14 section 9 rule 4) is a limit of the suite, so the check is treated as not reached.
 * A FAIL with no recorded finding is unexplained.
 */
export function effective(o: Outcome): "pass" | "clarify" | "differs" | "unexplained" | "suite-limit" | "skip" {
  if (o.status === "PASS") return "pass";
  if (o.status === "CLARIFY") return "clarify";
  if (o.status === "SKIP") return "skip";
  if (o.status === "FAIL" && o.finding !== true) return "unexplained";
  if (o.diffClass === "C") return "clarify";
  if (o.diffClass === "D") return "suite-limit";
  return "differs";
}

export type ItemState =
  | "agrees" // every decided check that ran is PASS (CLARIFY beside PASS allowed)
  | "unsettled" // only CLARIFY ran: the specification is open; outside P's denominator
  | "differs" // a recorded difference (KNOWN-FAIL), no unexplained FAIL
  | "unexplained" // a FAIL with no recorded exception
  | "behind" // the platform declares only another version of the task than the latest
  | "not-reached" // checks exist at the latest, the platform was not driven (suite limit)
  | "declared-not-offered" // declared in scope, but the run says not applicable: a contradiction to look at
  | "no-check" // the suite holds no check for this item in this role
  | "not-run"; // checks exist but no recorded run of this component includes them

export const MEASURED: ItemState[] = ["agrees", "unsettled", "differs", "unexplained"];
export const DECIDED: ItemState[] = ["agrees", "differs", "unexplained"];

export interface Thresholds { minMeasuredShare: number; minMeasuredItems: number }
export const DEFAULT_THRESHOLDS: Thresholds = { minMeasuredShare: 0.5, minMeasuredItems: 10 };

export interface Rollup {
  declared: number; measured: number; decided: number;
  byState: Record<ItemState, number>;
  /** P, null when withheld */
  agreement: number | null; withheld: string | null;
  measuredShare: number; floor: number;
  /** vector-level detail */
  vectors: { pass: number; clarify: number; knownFail: number; fail: number; failWithFinding: number; skip: number; knownFailByClass: Record<string, number> };
  /** check-level agreement on the same scope: PASS over PASS + recorded differences (A, B, unclassed) + unexplained FAIL; C and D outside (detail line, never the headline) */
  checkAgreement: number | null;
}

// ---------------------------------------------------------------- pure core

const STATES: ItemState[] = ["agrees", "unsettled", "differs", "unexplained", "behind", "not-reached", "declared-not-offered", "no-check", "not-run"];

/** The state of one scope item from the outcomes that touch it (one evidence kind at a time). */
export function itemState(item: ScopeItem, outcomes: Outcome[], hasCheck: boolean): ItemState {
  const e = outcomes.map(effective);
  if (e.includes("unexplained")) return "unexplained";
  if (e.includes("differs")) return "differs";
  if (e.includes("pass")) return "agrees";
  if (e.includes("clarify")) return "unsettled";
  if (!item.atLatest) return "behind";
  if (!hasCheck) return "no-check";
  if (e.includes("suite-limit")) return "not-reached";
  const skips = outcomes.filter((o) => o.status === "SKIP");
  if (skips.length === 0) return "not-run";
  if (skips.some((o) => o.cls === "version-mismatch")) return "behind";
  if (skips.every((o) => o.cls === "not-applicable")) return "declared-not-offered";
  return "not-reached";
}

export function rollup(items: ScopeItem[], states: Map<string, ItemState>, outcomes: Outcome[], t: Thresholds = DEFAULT_THRESHOLDS): Rollup {
  const byState = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<ItemState, number>;
  for (const it of items) byState[states.get(it.key) ?? "not-run"]++;
  const declared = items.length;
  const measured = MEASURED.reduce((n, s) => n + byState[s], 0);
  const decided = DECIDED.reduce((n, s) => n + byState[s], 0);
  const measuredShare = declared === 0 ? 0 : measured / declared;
  let withheld: string | null = null;
  if (declared === 0) withheld = "no declared scope";
  else if (measured < t.minMeasuredItems) withheld = `fewer than ${t.minMeasuredItems} items measured`;
  else if (measuredShare < t.minMeasuredShare) withheld = `measured share below ${Math.round(100 * t.minMeasuredShare)}%`;
  else if (decided === 0) withheld = "nothing decided (all measured items unsettled)";
  const agreement = withheld === null ? byState.agrees / decided : null;
  const floor = declared === 0 ? 0 : byState.agrees / declared;
  const keys = new Set(items.map((i) => i.key));
  const seen = new Set<string>();
  const v = { pass: 0, clarify: 0, knownFail: 0, fail: 0, failWithFinding: 0, skip: 0, knownFailByClass: {} as Record<string, number> };
  for (const o of outcomes) {
    if (seen.has(o.id) || !o.itemKeys.some((k) => keys.has(k))) continue;
    seen.add(o.id);
    if (o.status === "PASS") v.pass++;
    else if (o.status === "CLARIFY") v.clarify++;
    else if (o.status === "KNOWN-FAIL") { v.knownFail++; const c = o.diffClass ?? "unclassed"; v.knownFailByClass[c] = (v.knownFailByClass[c] ?? 0) + 1; }
    else if (o.status === "FAIL") { v.fail++; if (o.finding === true) v.failWithFinding++; }
    else if (o.status === "SKIP") v.skip++;
  }
  let ok = 0, against = 0;
  const seen2 = new Set<string>();
  for (const o of outcomes) {
    if (seen2.has(o.id) || !o.itemKeys.some((k) => keys.has(k))) continue;
    seen2.add(o.id);
    const e = effective(o);
    if (e === "pass") ok++;
    else if (e === "differs" || e === "unexplained") against++;
  }
  const checkAgreement = ok + against === 0 ? null : ok / (ok + against);
  return { declared, measured, decided, byState, agreement, withheld, measuredShare, floor, vectors: v, checkAgreement };
}

/** Assigns each outcome to items and computes item states for one evidence kind. */
export function statesFor(items: ScopeItem[], outcomes: Outcome[], checkKeys: Set<string>, evidence: Evidence | "both"): Map<string, ItemState> {
  const by = new Map<string, Outcome[]>();
  for (const o of outcomes) {
    if (evidence !== "both" && o.evidence !== evidence) continue;
    for (const k of o.itemKeys) { const a = by.get(k) ?? []; a.push(o); by.set(k, a); }
  }
  return new Map(items.map((it) => [it.key, itemState(it, by.get(it.key) ?? [], checkKeys.has(it.key))]));
}

export interface CeremonyTally { scenarios: number; completed: number; asSpecified: number; failed: number; incomplete: number; inconclusive: number; skipped: number }
export const emptyTally = (): CeremonyTally => ({ scenarios: 0, completed: 0, asSpecified: 0, failed: 0, incomplete: 0, inconclusive: 0, skipped: 0 });
export function addTally(t: CeremonyTally, status: string): void {
  t.scenarios++;
  if (status === "completed") t.completed++;
  else if (status === "ended-as-specified") t.asSpecified++;
  else if (status === "failed") t.failed++;
  else if (status === "incomplete") t.incomplete++;
  else if (status === "inconclusive") t.inconclusive++;
  else if (status === "skipped") t.skipped++;
  else throw new Error(`unknown scenario status ${status}`);
}
/** Ceremony completion: (completed + ended as specified) over the scenarios that ran (skipped are outside the denominator, shown apart). */
export function completion(t: CeremonyTally): number | null {
  const ran = t.scenarios - t.skipped;
  return ran === 0 ? null : (t.completed + t.asSpecified) / ran;
}

export const pct = (x: number | null): string => (x === null ? "n/a" : `${Math.round(100 * x)}%`);

/** The ceremony clause of a headline: partner kinds are never summed together (platform, oracle). */
export function ceremonyPhrase(v: CeremonyView | null, kind: string): string {
  if (v === null) return "";
  const ran = (t: CeremonyTally): number => t.scenarios - t.skipped;
  const say = (t: CeremonyTally, who: string): string => `ceremonies ${who}: ${pct(completion(t))} completed or ended as specified (${t.completed + t.asSpecified} of ${ran(t)} scenarios run${t.skipped > 0 ? `, ${t.skipped} skipped` : ""}; ran together, never counted as conformance)`;
  if (kind === "platform" && ran(v.originalPartner) > 0) return ` ${say(v.originalPartner, "with a platform partner")}.`;
  if (kind !== "platform" && ran(v.originalPartner) > 0) {
    return ` ${say(v.anyPlatformPartner, "with platform partners")}.`;
  }
  return " No ceremony with a real platform partner recorded.";
}

/** The one-line headline. Never uses the bare word "interoperable"; P is always next to M and the scope size. */
export function headline(name: string, r: Rollup, c: CeremonyView | null, kind = "platform"): string {
  const cer = ceremonyPhrase(c, kind);
  if (r.agreement === null) {
    return `${name}: insufficient evidence for a conformance-implied figure (${r.withheld}). Declared scope ${r.declared} items; measured ${r.measured} (${pct(r.measuredShare)}), of which ${r.byState.agrees} agree.${cer}`;
  }
  return `${name}: ${pct(r.agreement)} conformance-implied agreement on the measured part of its declared scope (${r.byState.agrees} of ${r.decided} decided items agree; measured ${r.measured} of ${r.declared} declared items, ${pct(r.measuredShare)}).${cer}`;
}

/**
 * Promotion (docs/33): the vectors vectors-src/promotions.json lists are registry-channel vectors. `promoteInMatrix` sets that channel on
 * a (possibly older) matrix.json so the items they measure count as having a gating check; `evidenceOfAdvisoryRecord` says whether a
 * result read from an advisory run root is gating: the vector is promoted AND the record was made after the promotion (its own channel
 * is registry), or the run asks for a projection (`projected`), which reads pre-promotion records as if they had been gating.
 */
export function promoteInMatrix(matrix: Matrix, ids: ReadonlySet<string>): number {
  let n = 0;
  for (const v of matrix.vectors) if (ids.has(v.id) && v.channel !== "registry") { v.channel = "registry"; n += 1; }
  return n;
}
export function evidenceOfAdvisoryRecord(id: string, recordChannel: string | undefined, promoted: ReadonlySet<string>, projected: boolean): Evidence {
  return promoted.has(id) && (recordChannel === "registry" || projected) ? "gating" : "advisory";
}

/** The advisory reading: the same scope with the advisory families (coverage, gap, probe, 2L) added. Never the headline (channel rule). */
export function advisoryLine(r: Rollup): string {
  const p = r.agreement === null ? `no figure (${r.withheld})` : `${pct(r.agreement)} (${r.byState.agrees} of ${r.decided})`;
  return `Advisory reading, adding the suite's spec-derived advisory checks (not gating): ${p}; measured ${r.measured} of ${r.declared} (${pct(r.measuredShare)}).`;
}

// ---------------------------------------------------------------- inputs

export interface MatrixTask { typeUri: string; slug: string; version: string; focus?: "focus" | "older" | "retired"; status: string; sources: { kind: string }[]; successors: string[]; vti: { pinned: boolean; served: string[] }; kw: { referenced: boolean; serves: boolean } }
export interface MatrixVector { id: string; group: string; set: string; channel: string; tasks: string[] }
export interface Matrix { tasks: MatrixTask[]; vectors: MatrixVector[]; inputs: Record<string, string> }

export const SEND_GROUP = /^(EM|EX|GE|CE|TE)-/;
export const roleOfVector = (id: string): Role => (SEND_GROUP.test(id) ? "send" : "receive");

/** Focus version of a slug, following a retired latest to its successor (as the matrix resolved it). */
export function focusIndex(m: Matrix): { focusOf: (slug: string) => MatrixTask | undefined; byUri: Map<string, MatrixTask> } {
  const byUri = new Map(m.tasks.map((t) => [t.typeUri, t]));
  const focus = new Map<string, MatrixTask>();
  for (const t of m.tasks) if (t.focus === "focus") focus.set(t.slug, t);
  const retired = new Map<string, MatrixTask>();
  for (const t of m.tasks) if (t.focus === "retired") retired.set(t.slug, t);
  const focusOf = (slug: string): MatrixTask | undefined => {
    const f = focus.get(slug);
    if (f !== undefined) return f;
    const r = retired.get(slug);
    const s = r?.successors[0];
    return s === undefined ? undefined : byUri.get(s);
  };
  return { focusOf, byUri };
}

/** Normalises declared Type URIs (one role) to scope items at the focus version. Non-registry URIs are returned apart. */
export function scopeFromDeclared(m: Matrix, role: Role, uris: string[], why: string): { items: ScopeItem[]; outside: string[] } {
  const { focusOf, byUri } = focusIndex(m);
  const out = new Map<string, ScopeItem>();
  const outside: string[] = [];
  for (const u of uris) {
    const t = byUri.get(u);
    if (t === undefined) { outside.push(u); continue; }
    const f = focusOf(t.slug);
    if (f === undefined) { outside.push(u); continue; }
    const key = `${role}:${f.slug}@${f.version}`;
    const it = out.get(key) ?? { key, role, slug: f.slug, focusVersion: f.version, declaredVersions: [], atLatest: false, maturity: f.status, sourceKind: f.sources[0]?.kind ?? "main", why: [] };
    if (!it.declaredVersions.includes(t.version)) it.declaredVersions.push(t.version);
    if (t.typeUri === f.typeUri) it.atLatest = true;
    if (!it.why.includes(why)) it.why.push(why);
    out.set(key, it);
  }
  return { items: [...out.values()], outside: [...new Set(outside)].sort() };
}

export function frameworkItems(groups: string[]): ScopeItem[] {
  return groups.map((g) => ({ key: `receive:framework/${g}`, role: "receive" as Role, slug: `framework/${g}`, focusVersion: "", declaredVersions: [], atLatest: true, maturity: "framework", sourceKind: "framework", why: ["receives trust tasks: framework rules apply"] }));
}

export function mergeItems(...lists: ScopeItem[][]): ScopeItem[] {
  const out = new Map<string, ScopeItem>();
  for (const l of lists) for (const it of l) {
    const e = out.get(it.key);
    if (e === undefined) { out.set(it.key, { ...it, declaredVersions: [...it.declaredVersions], why: [...it.why] }); continue; }
    for (const v of it.declaredVersions) if (!e.declaredVersions.includes(v)) e.declaredVersions.push(v);
    e.atLatest ||= it.atLatest;
    for (const w of it.why) if (!e.why.includes(w)) e.why.push(w);
  }
  return [...out.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Item keys a vector touches: its tasks normalised to focus, in the vector's role; framework vectors by group. */
export function vectorItemKeys(m: Matrix, v: MatrixVector | undefined, id: string, group: string): string[] {
  const role = roleOfVector(id);
  if (v === undefined || v.tasks.length === 0) return [`receive:framework/${group}`];
  const { byUri, focusOf } = focusIndex(m);
  const keys = new Set<string>();
  for (const u of v.tasks) {
    const t = byUri.get(u);
    if (t === undefined) continue;
    // only a vector at the focus version measures the focus item; an older-version vector measures an older (non-focus) item
    const f = focusOf(t.slug);
    if (f !== undefined && f.typeUri === t.typeUri) keys.add(`${role}:${f.slug}@${f.version}`);
    else keys.add(`${role}:${t.slug}@${t.version}#older`);
  }
  return [...keys];
}

// ---------------------------------------------------------------- reading the records (CLI only)

export interface RunJsonCaps { name?: string; supportedTypes?: string[]; unlistedTypes?: string[]; emits?: string[]; ceremonyRoles?: { ceremony: string; roles: string[] }[] }
export const rd = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));
export function walkFiles(dir: string, name: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "draft-issues" ? [] : walkFiles(p, name);
    return n === name ? [p] : [];
  });
}
export function declaredCaps(runsRoot: string, folders: string[], impl: string): RunJsonCaps {
  const acc: Required<RunJsonCaps> = { name: impl, supportedTypes: [], unlistedTypes: [], emits: [], ceremonyRoles: [] };
  for (const f of folders) for (const p of walkFiles(join(runsRoot, f), "run.json")) {
    const r = rd(p) as { implementations?: { capabilities?: RunJsonCaps & { implementation?: string } }[] };
    for (const i of r.implementations ?? []) {
      const c = i.capabilities;
      if (c === undefined || (c.name !== impl && c.implementation !== impl)) continue;
      acc.supportedTypes.push(...(c.supportedTypes ?? []));
      acc.unlistedTypes.push(...(c.unlistedTypes ?? []));
      acc.emits.push(...(c.emits ?? []));
      acc.ceremonyRoles.push(...(c.ceremonyRoles ?? []));
    }
  }
  return { ...acc, supportedTypes: [...new Set(acc.supportedTypes)], unlistedTypes: [...new Set(acc.unlistedTypes)], emits: [...new Set(acc.emits)] };
}

/** Number-free component table: which at-a-glance surfaces, which advisory matrix-set folders, which ceremony party id. */
export interface ComponentCfg {
  id: string; name: string; kind: "platform" | "stand-in" | "self-check" | "not-reachable";
  surfaces: { subject: string; surface: string }[]; advisory: string[];
  /**
   * Gating run folders named by the run map (results/platform-run-map.json): entries of this platform with one of these surfaces.
   * `notPlatform` instead takes the run map's notPlatform folders whose name matches the pattern (the reference adapter).
   */
  runMap?: { platform: string; surfaces: string[] } | { notPlatform: string };
  /** source-scan comparison (matrix): which served-table name or KW flag reads as this component's source scope */
  sourceScan?: { vtiServed?: string; kw?: boolean };
  note?: string;
}
export const COMPONENTS: ComponentCfg[] = [
  { id: "vti-agent", name: "VTI agent service (VTA)", kind: "platform", surfaces: [{ subject: "vti", surface: "vti-inprocess" }], advisory: ["vti-upstream-agent", "vti-upstream-gap-agent", "vti-up-agent"], runMap: { platform: "vti", surfaces: ["agent-gating"] }, sourceScan: { vtiServed: "vta" } },
  { id: "vti-community", name: "VTI community service (VTC)", kind: "platform", surfaces: [{ subject: "vti", surface: "vti-vtc-inprocess" }], advisory: ["vti-upstream-community", "vti-upstream-gap-community", "vti-up-community"], runMap: { platform: "vti", surfaces: ["community-gating"] }, sourceScan: { vtiServed: "vtc" } },
  { id: "vti-client", name: "VTI client builders (sending side)", kind: "platform", surfaces: [{ subject: "vti", surface: "vti-emit" }], advisory: ["vti-upstream-emit", "vti-upstream-gap-emit", "vti-up-emit"] },
  { id: "kw", name: "keyring-wallet (wallet logic, stand-in carrier)", kind: "platform", surfaces: [{ subject: "keyring-wallet", surface: "keyring-wallet-shim" }], advisory: ["kw-upstream-shim", "kw-upstream-gap-shim", "kw-up-shim"], runMap: { platform: "keyring-wallet", surfaces: ["shim-gating"] }, sourceScan: { kw: true } },
  { id: "kw-witness", name: "keyring-wallet witness server (real DIDComm)", kind: "platform", surfaces: [{ subject: "keyring-wallet", surface: "keyring-wallet-witness" }], advisory: [] },
  { id: "ts-original", name: "truststackers (original)", kind: "not-reachable", surfaces: [], advisory: [], note: "not reachable by the suite: no trust-task boundary upstream" },
  { id: "reference", name: "Reference adapter (the suite checking itself, not a platform)", kind: "self-check", surfaces: [{ subject: "reference", surface: "reference" }], advisory: ["reference", "reference-gap", "reference-gap-advisory"], runMap: { notPlatform: "-promote-b\\d+-gating-reference$" } },
];

/** Ceremony rows: folder name to the two parties (component ids). */
export const CEREMONY_PARTIES: Record<string, string[]> = {
  "oracle": ["reference"], "kwo.up": ["kw", "reference"],
  "avl.up.ref": ["kw", "reference"], "avl.up.vti-up": ["kw", "vti-agent"],
  "kvx.up": ["kw", "vti-community"], "kvh.up": ["kw", "reference"],
  "per-oracle": ["reference"], "dir-oracle": ["reference"], "vote-oracle": ["reference"],
};

export interface CeremonyRow { row: string; parties: string[]; groups: Map<string, CeremonyTally>; scenarios: Map<string, string>; root: string }
export function readCeremonyRows(dirs: string[]): { rows: CeremonyRow[]; unmapped: string[] } {
  const rows: CeremonyRow[] = [];
  const unmapped: string[] = [];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (!statSync(p).isDirectory() || name === "oracle-mutants") continue;
      const parties = CEREMONY_PARTIES[name];
      const files = walkFiles(p, "scenario-result.json");
      if (files.length === 0) continue;
      if (parties === undefined) { unmapped.push(name); continue; }
      const scenarios = new Map<string, string>();
      for (const f of files) for (const r of (rd(f) as { results: { id: string; status: string }[] }).results) scenarios.set(r.id, r.status);
      rows.push({ row: name, parties, groups: groupTallies(scenarios), scenarios, root: d });
    }
  }
  return { rows, unmapped };
}

export function groupTallies(scenarios: Map<string, string>): Map<string, CeremonyTally> {
  const groups = new Map<string, CeremonyTally>();
  for (const [id, st] of scenarios) {
    const g = /^(FC-[A-Z]+)-/.exec(id)?.[1] ?? id;
    const t = groups.get(g) ?? emptyTally();
    addTally(t, st);
    groups.set(g, t);
  }
  return groups;
}

/** Parties that are original platform code (every other id is the oracle). */
export const ORIGINAL = new Set(["vti-agent", "vti-community", "vti-client", "kw", "kw-witness"]);

/**
 * One outcome per distinct scenario across several rows (partners): completed or ended as specified only if it did so with every partner
 * it ran with; failed, incomplete or inconclusive if it did so with any; skipped only if skipped with every partner. Conservative, and a
 * scenario run against several partners counts once, not once per partner.
 */
export function combineScenarios(rows: CeremonyRow[]): Map<string, string> {
  const seen = new Map<string, string[]>();
  for (const r of rows) for (const [id, st] of r.scenarios) { const a = seen.get(id) ?? []; a.push(st); seen.set(id, a); }
  const out = new Map<string, string>();
  const bad = ["failed", "incomplete", "inconclusive"];
  for (const [id, sts] of seen) {
    const ran = sts.filter((x) => x !== "skipped");
    if (ran.length === 0) { out.set(id, "skipped"); continue; }
    const worst = bad.find((b) => ran.includes(b));
    if (worst !== undefined) { out.set(id, worst); continue; }
    out.set(id, ran.includes("completed") ? "completed" : "ended-as-specified");
  }
  return out;
}

export interface CeremonyView { anyPlatformPartner: CeremonyTally; originalPartner: CeremonyTally; referencePartner: CeremonyTally; partners: Record<string, CeremonyTally>; groups: Record<string, CeremonyTally> }
const sumTally = (m: Map<string, CeremonyTally>): CeremonyTally => { const t = emptyTally(); for (const x of m.values()) for (const k of Object.keys(t) as (keyof CeremonyTally)[]) t[k] += x[k]; return t; };

/** Ceremony outcomes for one component, by kind of partner (never summed with conformance, never summed across partner kinds). */
export function ceremonyFor(component: string, rows: CeremonyRow[]): CeremonyView {
  const mine = rows.filter((r) => r.parties.includes(component) && r.parties.length === 2);
  const partnerOf = (r: CeremonyRow): string => r.parties.find((p) => p !== component) ?? component;
  const pick = (f: (p: string) => boolean): CeremonyTally => sumTally(groupTallies(combineScenarios(mine.filter((r) => f(partnerOf(r))))));
  const partners: Record<string, CeremonyTally> = {};
  for (const p of [...new Set(mine.map(partnerOf))].sort()) partners[p] = sumTally(groupTallies(combineScenarios(mine.filter((r) => partnerOf(r) === p))));
  const real = mine.filter((r) => partnerOf(r) !== "reference");
  return {
    anyPlatformPartner: pick((p) => p !== "reference"),
    originalPartner: pick((p) => ORIGINAL.has(p)),
    referencePartner: pick((p) => p === "reference"),
    partners,
    groups: Object.fromEntries(groupTallies(combineScenarios(real))),
  };
}


// ---------------------------------------------------------------- default inputs: run map and promotions

/** The parts of the run map the roll-up reads (results/platform-run-map.json; the matrix reads the same file). */
export interface RunMapLike { runs: { folder: string; platform: string; surface: string }[]; notPlatform: string[] }

/** Run folders (relative to the results directory, `runs/<name>`) the run map names as this component's gating runs, in map order. */
export function gatingRunFolders(map: RunMapLike, c: ComponentCfg): string[] {
  const m = c.runMap;
  if (m === undefined) return [];
  if ("notPlatform" in m) { const re = new RegExp(m.notPlatform); return map.notPlatform.filter((f) => re.test(f)); }
  return map.runs.filter((r) => r.platform === m.platform && m.surfaces.includes(r.surface)).map((r) => r.folder);
}

/** The ids vectors-src/promotions.json promotes (active batches, amended rule applied). A missing file means nothing is promoted. */
export function loadPromotedIds(root: string): Set<string> {
  const p = join(root, "vectors-src", "promotions.json");
  if (!existsSync(p)) return new Set();
  return new Set(activePromotions(rd(p) as PromotionFile).keys());
}

export interface RecordReadCtx {
  promoted: ReadonlySet<string>; projected: boolean;
  /** vector ids already read (first record wins); updated here */
  have: Set<string>;
  skipClass: (reason: string) => SkipClass;
  keysOf: (id: string, group: string) => string[];
  diffClassOf: (id: string, status: Status) => { diffClass?: string; finding?: boolean };
}

/** Tier 1 records of results files (`results.json` / `results-advisory.json`) as outcomes; evidence per `evidenceOfAdvisoryRecord`. */
export function outcomesFromFiles(files: string[], ctx: RecordReadCtx): Outcome[] {
  const out: Outcome[] = [];
  for (const p of files) {
    for (const b of rd(p) as { tier: number; results: { id: string; group?: string; status: Status; reason?: string; channel?: string }[] }[]) {
      if (b.tier !== 1) continue;
      for (const r of b.results) {
        if (ctx.have.has(r.id)) continue;
        ctx.have.add(r.id);
        const cls = r.status === "SKIP" ? ctx.skipClass(r.reason ?? "") : null;
        if (cls === "out-of-tier") continue;
        out.push({ id: r.id, status: r.status, cls, evidence: evidenceOfAdvisoryRecord(r.id, r.channel, ctx.promoted, ctx.projected), itemKeys: ctx.keysOf(r.id, r.group ?? ""), ...ctx.diffClassOf(r.id, r.status) });
      }
    }
  }
  return out;
}
