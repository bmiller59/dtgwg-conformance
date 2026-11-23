// SPDX-License-Identifier: Apache-2.0
// Builds the "at a glance" model from the recorded run folders. Everything numeric is computed here from
// <results dir>/runs/*/**/results*.json (src/results-dir.ts); hand-written text lives in results/at-a-glance.config.json and results/skip-classes.json.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { specPinOf } from "./spec-pin.ts";
import { hasRuns, resultsDir, runSetId, runsDir } from "../results-dir.ts";

export type Status = "PASS" | "CLARIFY" | "SKIP" | "KNOWN-FAIL" | "FAIL" | "QUARANTINED" | "SPEC-CHANGED";
export type SkipClass = "not-applicable" | "not-reached" | "version-mismatch" | "out-of-tier" | "unclassified";
export type Channel = "registry" | "proposed" | "candidate";

export interface CatalogVector { excludedFromRun: boolean; synthetic: boolean; id: string; family: string; group: string; tier: number; channel: Channel; slug: string; version: string; kind: string }
export interface RawResult { id: string; family?: string; group?: string; tier: number; channel?: string; status: Status; reason?: string; evidence?: string }
/** `notApplicableRule`: the block was recorded under the rule that a SKIP is not applicable only with `evidence` (a cited notOffered entry). */
export interface RunBlock { run: string; file: string; date: string; hasChannel: boolean; impl: string; tier: number; results: RawResult[]; notApplicableRule?: string; /** ids recorded under excludedByTier (runs since the tier split) */ excludedByTier?: string[] }
/** A SKIP reason of the tier selection, as runs recorded before the tier split hold it (later runs list these under excludedByTier). */
/** The reason the runner gives a vector that passes although a KNOWN-FAIL exception names it (src/runner/suite.ts). */
export const STALE_EXCEPTION = /^KNOWN-FAIL exception is stale: the vector now passes/;
export const TIER_SKIP = /^(tier [0-9] not selected|only runs at tier [0-9])$/;

export interface Result { id: string; status: Status; reason: string; family: string; group: string; channel: Channel; kind: string; run: string; cls: SkipClass | null; slug: string; version: string }

export interface Counts { total: number; pass: number; clarify: number; knownFail: number; fail: number; ran: number; skip: number; notApplicable: number; notReached: number; versionMismatch: number; unclassified: number; outOfTier: number; applicable: number; /** flaky vectors recorded QUARANTINED (docs/04 section 18.9): advisory, outside every other count */ quarantined: number; /** vectors flagged SPEC-CHANGED (docs/23): the cited spec moved, not re-checked; advisory, outside every other count */ specChanged: number }

export interface SkipRule { id: string; match: string; surfaces?: string[]; class: string; note: string; /** the coverage name of the rule (docs/22), shown on the coverage page */ label?: string }
export interface Row { id: string; label: string; plain: string; families: string[]; channel: Channel; groupPrefix?: string[]; excludeGroupPrefix?: string[] }
/**
 * A measurement of the surface that is shown only as a generated note, never as a row or in a total: `folder` (under results/runs/) holds
 * the results of implementation `impl`, compared vector by vector with `compareWith` (the surface's own folder for the same vectors).
 */
export interface ExperimentalCfg { label: string; impl: string; folder: string; compareWith: string; why: string }
/** `aliases`: earlier implementation names under which this surface's listed runs were recorded (results are read under them too; exceptions and findings are keyed on `impl`). */
export interface SurfaceCfg { id: string; label: string; impl: string; aliases?: string[]; how: string; headline?: boolean; runs?: string[]; experimental?: ExperimentalCfg[] }
export interface SubjectCfg {
  id: string; name: string; role: "platform" | "self-check" | "stand-in"; whatItIs: string; surfaces: SurfaceCfg[]; next: string[];
  notReachable?: { run: string; text: string };
  declared?: Record<string, { class: SkipClass; reason: string }>;
  /** Run folders whose draft-issues/ belong to this subject (listed on its platform page). */
  draftIssueRuns?: string[];
}
export interface Config { /** Run folders that hold probes, oracles and experiments: listed in the run index as supporting records. A run folder that no part of this configuration names is not listed. */ supportingRuns?: string[]; supersededBy?: Record<string, string[] | string>; milestones?: { prefix: string; label: string }[]; rows: Row[]; subjects: SubjectCfg[]; how: Record<string, { name: string; plain: string }>; findingTitles: { match: string; title: string }[] }

export interface Finding { title: string; category: string; cls: string; vectors: string[]; link: string; linkLabel: string }
/** An explained, not excused FAIL (results/findings.json): still FAIL in every count; shown as a recorded finding, not as unexplained. */
export interface RecordedFinding { vector: string; cls: string; explanation: string; link: string; linkLabel: string }
export interface SurfaceModel {
  cfg: SurfaceCfg; runs: string[]; newestRun: string; recordedEarlier: boolean; earlierWhy: string[];
  results: Result[]; byRow: Record<string, Counts>; byMeasure: Record<string, Counts>;
  /** Vectors that pass although a recorded exception still names them (the runner's "exception is stale" FAIL, counted here as PASS): the exception describes behaviour this surface no longer has. */
  staleExceptions: string[];
  findings: Finding[]; recorded: RecordedFinding[]; unexplained: string[]; reasons: { cls: SkipClass; reason: string; count: number; note: string }[];
  types: { total: number; ran: number; notApplicable: number; other: number };
  governanceNotes: number;
  /** Vectors outside the headline tier in the surface's Tier 1 runs (excludedByTier, or a tier SKIP in older runs): shown apart, never SKIP. */
  excludedByTier: number;
  /** The essential governance E the adapter declared, from the run's run.json (decision 39); null where no run of the surface records it. */
  essential: EssentialSummary | null;
}
/** The recorded E of a surface: single-party when the declared authority set has one member. */
export interface EssentialSummary {
  run: string; source: string; members: number; minApprovals: number | null; singleParty: boolean; finding?: string; reason?: string;
  /** The adapter honesty check (run.json implementations[].essentialProbe); absent for runs recorded before it. */
  probe?: { result: string; observed?: string; reason?: string };
}
export interface Subject { cfg: SubjectCfg; surfaces: SurfaceModel[] }
export interface Interop { ledgerEntries: number; ledgerLines: string[]; pairs: { label: string; ran: number; both: number }[]; pairSources: string[] }
export interface Model {
  config: Config; subjects: Subject[]; catalog: { total: number; byKind: Record<string, number> };
  runFolders: string[]; newestDate: string; unclassified: { surface: string; reason: string; count: number }[]; interop: Interop;
  skipRules: SkipRule[];
  /** The results directory the model was built from, and its run set (src/results-dir.ts). */
  results: string; runSet: string;
  /** The Trust Tasks pin date and how many flagged vectors need re-checking (docs/23). */
  specPin: { date: string; flagged: number };
  /** Focus class of each task version (`slug/version`) from the coverage matrix (decision D245); empty when the matrix is absent. */
  focus: Record<string, "focus" | "older" | "retired">;
  /** keyring-wallet reach against role-based denominators (decision D301) from the coverage matrix; null when the matrix has none. */
  kwReach: KwReachGlance | null;
  vtiRoles: VtiRolesGlance | null;
}

export interface KwReachGlance {
  focusSlugs: number;
  roles: Record<string, number>;
  withRole: number;
  /** Per wallet platform: slugs with a role that had a vector executed, and slugs named in a ceremony row run with the wallet. */
  platforms: { id: string; label: string; covered: number; platform: number; ceremonySlugs: number }[];
  notBuilt: number;
  notInvolved: number;
}

export interface VtiRolesGlance {
  focusSlugs: number;
  inputs: { vti: string };
  /** Per surface: slugs by role, the slugs where the surface has a role (serves, emits, older-version), and per VTI platform how many of them ran. */
  surfaces: { id: string; label: string; roles: Record<string, number>; withRole: number; ran: Record<string, number | null> }[];
}

/** VTI's role per surface from results/coverage/vti-roles.json and vti-participation.json (generated by `npm run coverage-matrix`, D420, D421). */
export function loadVtiRoles(root: string): VtiRolesGlance | null {
  const p = join(root, "results", "coverage", "vti-roles.json");
  const q = join(root, "results", "coverage", "vti-participation.json");
  if (!existsSync(p) || !existsSync(q)) return null;
  const r = rd(p) as { inputs: Record<string, string>; surfaces: { id: string; label: string }[]; rows: { surfaces: Record<string, { role: string }> }[] };
  const part = rd(q) as { rows: { result: Record<string, Record<string, string>> }[] };
  const WITH = new Set(["serves", "emits", "older-version"]);
  const RUNS = new Set(["vta", "vtc", "client"]);
  return {
    focusSlugs: r.rows.length,
    inputs: { vti: r.inputs["verifiable-trust-infrastructure (upstream main)"] ?? "?" },
    surfaces: r.surfaces.map((s) => {
      const roles: Record<string, number> = {};
      for (const x of r.rows) roles[x.surfaces[s.id]?.role ?? "unclassified"] = (roles[x.surfaces[s.id]?.role ?? "unclassified"] ?? 0) + 1;
      const ran = Object.fromEntries(["vti"].map((pl) => [pl, RUNS.has(s.id) ? r.rows.filter((x, i) => WITH.has(x.surfaces[s.id]?.role ?? "") && String(part.rows[i]?.result[pl]?.[s.id] ?? "").startsWith("ran-")).length : null]));
      return { id: s.id, label: s.label, roles, withRole: [...WITH].reduce((n, k) => n + (roles[k] ?? 0), 0), ran };
    }),
  };
}

/** The wallet's role-based reach from results/coverage/matrix.json (`focus.kwReach`, generated by `npm run coverage-matrix`). */
export function loadKwReach(root: string): KwReachGlance | null {
  const p = join(root, "results", "coverage", "matrix.json");
  if (!existsSync(p)) return null;
  const m = rd(p) as { platforms: { id: string; label: string }[]; focus: { focusVersions: number; kwReach?: { roles: Record<string, number>; withRole: number; platforms: Record<string, { reach: Record<string, number>; ceremonySlugs: number }> } } };
  const k = m.focus.kwReach;
  if (k === undefined) return null;
  return {
    focusSlugs: m.focus.focusVersions, roles: k.roles, withRole: k.withRole,
    platforms: Object.entries(k.platforms).map(([id, v]) => ({ id, label: m.platforms.find((x) => x.id === id)?.label ?? id, covered: v.reach["covered"] ?? 0, platform: v.reach["platform"] ?? 0, ceremonySlugs: v.ceremonySlugs })),
    notBuilt: (k.roles["wallet-relevant-not-named"] ?? 0) + (k.roles["client-capable-not-built"] ?? 0), notInvolved: k.roles["not-involved"] ?? 0,
  };
}

/** The focus class of every task version in results/coverage/matrix.json (generated by `npm run coverage-matrix`), keyed `slug/version`. */
export function loadFocus(root: string): Record<string, "focus" | "older" | "retired"> {
  const p = join(root, "results", "coverage", "matrix.json");
  const out: Record<string, "focus" | "older" | "retired"> = {};
  if (!existsSync(p)) return out;
  for (const t of (rd(p) as { tasks: { slug: string; version: string; focus?: "focus" | "older" | "retired" }[] }).tasks) if (t.focus !== undefined) out[`${t.slug}/${t.version}`] = t.focus;
  return out;
}

export const MEASURES: { id: string; label: string; plain: string; kinds: string[]; channel: Channel }[] = [
  { id: "core", label: "Core, registry specifications", plain: "Checks against specifications published in the registry. The headline.", kinds: ["core"], channel: "registry" },
  { id: "core-candidate", label: "Core, candidates (advisory)", plain: "Checks for behaviour with no home in the Trust Tasks repository, implemented by one or a few platforms. Advisory only; not an endorsement.", kinds: ["core"], channel: "candidate" },
  { id: "core-proposed", label: "Core, suite design (proposed, advisory)", plain: "The suite's own ceremony and two-phase design choices (profile ceremony-design: deadlines, abort and failure codes, the details vocabulary, the status task), not framework text. Advisory only, outside the gating counts.", kinds: ["core"], channel: "proposed" },
  { id: "plain", label: "Single tasks", plain: "One check per task type and version.", kinds: ["plain"], channel: "registry" },
  { id: "emit", label: "What the platform sends", plain: "Checks of the documents the platform produces.", kinds: ["emit"], channel: "registry" },
  { id: "twol", label: "2L profiles (proposed, advisory)", plain: "Second-layer profile checks: the suite's own proposal (profile 2L), advisory, outside the gating counts.", kinds: ["2l", "2l-emit"], channel: "proposed" },
  { id: "witness", label: "Witness server", plain: "Witness server over DIDComm.", kinds: ["witness"], channel: "registry" },
];

const rd = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));

/** Vector catalog from the manifests: the top-level manifest is the core set; every other vectors/<dir>/manifest.json is its own set. */
export function loadCatalog(root: string, opts: { coverage?: boolean } = {}): Map<string, CatalogVector> {
  const out = new Map<string, CatalogVector>();
  const vroot = join(root, "vectors");
  const take = (dir: string, files: string[], kind: string | null): void => {
    for (const f of files) {
      const p = join(dir, f);
      if (!existsSync(p)) continue;
      const d = rd(p) as { group: string; family: string; vectors: { id: string; tier: number | string; excludedFromRun?: unknown; retired?: unknown; synthetic?: unknown; source?: { slug?: string; version?: string; channel?: string } }[] };
      for (const v of d.vectors) {
        out.set(v.id, {
          // a retired id (docs/04 section 20.3) is not measured either: it counts with the vectors excluded from run
          excludedFromRun: v.excludedFromRun !== undefined || v.retired !== undefined, synthetic: v.synthetic === true,
          id: v.id, family: d.family, group: d.group, tier: Number(v.tier), channel: v.source?.channel === "proposed" ? "proposed" : v.source?.channel === "candidate" ? "candidate" : "registry",
          slug: v.source?.slug ?? "", version: v.source?.version ?? "", kind: kind ?? kindOfFamily(d.family),
        });
      }
    }
  };
  const top = rd(join(vroot, "manifest.json")) as { files: string[] };
  take(vroot, top.files, "core");
  for (const d of readdirSync(vroot).sort()) {
    const m = join(vroot, d, "manifest.json");
    // the coverage families (docs/22), the gap families (docs/28) and the seeded-state probe (vectors/probe) are advisory and kept out of every headline and catalog count; their own pages ask for them
    if ((d === "coverage" || d === "probe" || d === "gap") && opts.coverage !== true) continue;
    if (d === "alignment") continue; // the advisory alignment set (docs/tf-alignment.md) is in no headline, catalog or coverage figure
    if (statSync(join(vroot, d)).isDirectory() && existsSync(m)) take(join(vroot, d), (rd(m) as { files: string[] }).files, null);
  }
  return out;
}

export function kindOfFamily(family: string): string {
  if (family === "plain" || family === "emit" || family === "witness" || family === "2l" || family === "2l-emit") return family;
  // the coverage families (docs/22) are advisory and outside every headline count and measure
  if (family === "coverage" || family === "coverage-emit") return "coverage";
  return "core";
}

/**
 * The essential governance recorded for `impl` in the run.json files of the given run folders (newest run first), as the runner writes
 * it (implementations[].essentialGovernance). Runs recorded before E was recorded have none, and the surface shows "E not recorded".
 */
export function loadEssential(results: string, runs: string[], impl: string): EssentialSummary | null {
  const base = runsDir(results);
  for (const run of [...runs].sort().reverse()) {
    const found: string[] = [];
    const walk = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const name of readdirSync(dir).sort()) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== "draft-issues") walk(p); } else if (name === "run.json") found.push(p);
      }
    };
    walk(join(base, run));
    for (const p of found) {
      type Probe = { result: string; reason?: string; checks?: { result: string; observed: string }[] };
      const r = rd(p) as { implementations?: { capabilities?: { name?: string }; essentialGovernance?: { source: string; authority: string[]; minApprovals: number | null; singleParty: boolean; finding?: string; reason?: string }; essentialProbe?: Probe }[] };
      const i = (r.implementations ?? []).find((x) => x.capabilities?.name === impl);
      const e = i?.essentialGovernance;
      const pr = i?.essentialProbe;
      const observed = (pr?.checks ?? []).filter((c) => c.result === "mismatch").map((c) => c.observed).join("; ");
      const probe = pr === undefined ? undefined : { result: pr.result, ...(observed === "" ? {} : { observed }), ...(pr.reason === undefined ? {} : { reason: pr.reason }) };
      if (e !== undefined) return { run, source: e.source, members: e.authority.length, minApprovals: e.minApprovals, singleParty: e.singleParty, ...(e.finding === undefined ? {} : { finding: e.finding }), ...(e.reason === undefined ? {} : { reason: e.reason }), ...(probe === undefined ? {} : { probe }) };
    }
  }
  return null;
}

/**
 * The platform an implementation declared (`capabilities.platform`) in the run.json files under the given run folders or sub-folders,
 * newest first; undefined where no run.json records one (runs recorded before run.json, or an implementation that declares no platform).
 * A surface whose implementation declares a platform carries that platform's exceptions (src/runner/suite.ts) and gates it.
 */
export function recordedPlatform(results: string, folders: string[], impl: string): string | undefined {
  const base = runsDir(results);
  for (const folder of [...folders].sort().reverse()) {
    const found: string[] = [];
    const walk = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const name of readdirSync(dir).sort()) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== "draft-issues") walk(p); } else if (name === "run.json") found.push(p);
      }
    };
    walk(join(base, folder));
    for (const p of found) {
      const r = rd(p) as { implementations?: { capabilities?: { name?: string; platform?: string } }[] };
      const pl = (r.implementations ?? []).find((x) => x.capabilities?.name === impl)?.capabilities?.platform;
      if (pl !== undefined) return pl;
    }
  }
  return undefined;
}

/** Every results file under the run folders of the results directory (src/results-dir.ts), as per-implementation blocks. */
export function loadRuns(results: string): RunBlock[] {
  const base = runsDir(results);
  const out: RunBlock[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== "draft-issues") walk(p); continue; }
      if (name !== "results.json" && name !== "results-advisory.json") continue;
      const data = rd(p);
      if (!Array.isArray(data)) continue;
      const rel = relative(base, p).split("/");
      const run = rel[0]!;
      const date = /^\d{4}-\d{2}-\d{2}/.exec(run)?.[0] ?? "0000-00-00";
      for (const b of data as { impl: string; tier: number; results: RawResult[]; notApplicableRule?: string; excludedByTier?: { id: string }[] }[]) {
        out.push({ run, file: relative(results, p).split("\\").join("/"), date, hasChannel: b.results.some((r) => r.channel !== undefined), impl: b.impl, tier: b.tier, results: b.results, ...(b.notApplicableRule === undefined ? {} : { notApplicableRule: b.notApplicableRule }), ...(b.excludedByTier === undefined ? {} : { excludedByTier: b.excludedByTier.map((e) => e.id) }) });
      }
    }
  };
  walk(base);
  return out;
}

const cmpBlocks = (a: RunBlock, b: RunBlock): number =>
  a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.hasChannel !== b.hasChannel ? (a.hasChannel ? -1 : 1) : a.run < b.run ? 1 : a.run > b.run ? -1 : a.file < b.file ? -1 : 1;

export function emptyCounts(): Counts {
  return { total: 0, pass: 0, clarify: 0, knownFail: 0, fail: 0, ran: 0, skip: 0, notApplicable: 0, notReached: 0, versionMismatch: 0, unclassified: 0, outOfTier: 0, applicable: 0, quarantined: 0, specChanged: 0 };
}

export function tally(rs: Result[]): Counts {
  const c = emptyCounts();
  for (const r of rs) {
    if (r.cls === "out-of-tier") { c.outOfTier++; continue; }
    if (r.status === "QUARANTINED") { c.quarantined++; continue; }
    if (r.status === "SPEC-CHANGED") { c.specChanged++; continue; }
    c.total++;
    if (r.status === "PASS") c.pass++;
    else if (r.status === "CLARIFY") c.clarify++;
    else if (r.status === "KNOWN-FAIL") c.knownFail++;
    else if (r.status === "FAIL") c.fail++;
    else {
      c.skip++;
      if (r.cls === "not-applicable") c.notApplicable++;
      else if (r.cls === "not-reached") c.notReached++;
      else if (r.cls === "version-mismatch") c.versionMismatch++;
      else c.unclassified++;
    }
  }
  c.ran = c.pass + c.clarify + c.knownFail + c.fail;
  c.applicable = c.total - c.notApplicable;
  return c;
}

const typeSlug = (url: string): string => url.replace(/^https?:\/\/[^/]+\/spec\//, "").replace(/\/[0-9][^/]*$/, "");

export function classify(reason: string, surfaceId: string, rules: SkipRule[], servedSlugs: Set<string>): SkipClass {
  for (const r of rules) {
    if (r.surfaces !== undefined && !r.surfaces.includes(surfaceId)) continue;
    if (!new RegExp(r.match, "i").test(reason)) continue;
    if (r.class === "by-served-slug") {
      const u = /^type not declared: (\S+)/.exec(reason)?.[1] ?? "";
      return servedSlugs.has(typeSlug(u)) ? "version-mismatch" : "not-applicable";
    }
    return r.class as SkipClass;
  }
  return "unclassified";
}

/**
 * The class of a recorded SKIP. A block recorded under the cited-notOffered rule (docs/04 section 8) is not applicable only where the
 * result carries evidence; a rule that would class it not applicable otherwise gives not reached. Blocks recorded before the rule keep
 * the class their reason gives (results/skip-classes.json), so older run folders read as they were recorded.
 */
export function skipClassOf(r: RawResult, b: Pick<RunBlock, "notApplicableRule">, surfaceId: string, rules: SkipRule[], servedSlugs: Set<string>): SkipClass {
  if (b.notApplicableRule !== undefined && r.evidence !== undefined && r.evidence !== "") return "not-applicable";
  const cls = classify(r.reason ?? "", surfaceId, rules, servedSlugs);
  return b.notApplicableRule !== undefined && cls === "not-applicable" ? "not-reached" : cls;
}

const sanitize = (s: string): string => s.replace(/(^|[\s("'])\/(?:srv|home|var|tmp|usr|etc|Users)\/[^\s)"']*/g, "$1[path]");

/** The review class of an exception: the structured `class` field, else the "class X" tag in its reason text (older entries). */
export function classOf(e: { reason: string; class?: string }): string {
  return e.class ?? /class ([A-D])\b/.exec(e.reason)?.[1] ?? "";
}

function categoryOf(reason: string, cls: string): string {
  if (cls === "A") return "Differs from the specification text";
  if (cls === "B") return "Our check may expect more than the text says";
  if (cls === "C") return "The text is open here (a question for the task force)";
  if (/^\[shim carrier\]/.test(reason)) return "Limit of our stand-in carrier, not a platform difference";
  if (/Suite over-assertion/.test(reason)) return "Our check may expect more than the text says";
  if (/Profile difference|Tier 2 attested/.test(reason)) return "Difference from the stricter attested profile";
  if (/Unconfirmed/.test(reason)) return "Cause not yet confirmed";
  if (/Known upstream gap/.test(reason)) return "Known gap in a library the platform builds on";
  return "Under review";
}

function titleOf(reason: string, titles: { match: string; title: string }[]): string {
  for (const t of titles) if (new RegExp(t.match, "i").test(reason)) return t.title;
  const s = sanitize(reason.replace(/^\[[^\]]*\]\s*/, "")).split(/\.\s/)[0] ?? "";
  return s.length > 150 ? s.slice(0, 147) + "..." : s;
}

function linkOf(root: string, ref: string, fallbackRun: string): { link: string; label: string } {
  for (const part of ref.split(";")) {
    const p = part.trim().replace(/\s+(section|item|#).*$/, "").replace(/#.*$/, "");
    const run = /^(?:results\/)?runs\/([^/]+)\/([\w./-]+\.md)$/.exec(p);
    if (run !== null) return { link: `runs/${run[1]}/${run[2]}`, label: run[2] === "README.md" ? "README" : run[2]!.split("/").pop()!.replace(/\.md$/, "") };
    if (/^(results|docs)\/[\w./-]+\.md$/.test(p) && existsSync(join(root, p))) return { link: p.startsWith("results/") ? p.slice(8) : "../" + p, label: p.split("/").pop()!.replace(/\.md$/, "") };
  }
  return { link: `runs/${fallbackRun}/README.md`, label: `run ${fallbackRun}` };
}

/**
 * A reference as Markdown: a link for a page in this repository (`link` is relative to results/; `prefix` leads there from the
 * page being written), or a code span for a file in a run folder, which lives in the results directory, not in the repository.
 */
export function refMd(link: string, label: string, prefix: string): string {
  return link.startsWith("runs/") ? `${label} (\`${link}\` in the results directory)` : `[${label}](${prefix}${link})`;
}

/** A run folder as Markdown: a code span naming the folder in the results directory (run folders are not in the repository). */
export const runRef = (run: string, sub = ""): string => `\`runs/${run}/${sub}\``;

interface Exc { impl: string; vector: string; reason: string; ref?: string; class?: string; notOn?: Record<string, string> }
function loadExceptions(root: string): Exc[] {
  const dir = join(root, "exceptions");
  const out: Exc[] = [];
  for (const f of readdirSync(dir).sort()) if (f.endsWith(".json")) out.push(...((rd(join(dir, f)) as { exceptions: Exc[] }).exceptions ?? []));
  return out;
}

/**
 * `inherited`: where the entry was measured when no recorded run folder of the surface holds the FAIL yet (the next recorded run decides it; the
 * stale-finding test skips it, and the pages show nothing until a recorded FAIL matches). `evidence`: vector ids (the seeded probe, docs/22) behind the explanation.
 */
export interface FindingEntry { impl: string; vector: string; class: string | null; explanation: string; ref?: string; excused: false; inherited?: string; evidence?: string[] }
/** results/findings.json (hand input; absent means none). */
export function loadFindings(root: string): FindingEntry[] {
  const p = join(root, "results", "findings.json");
  return existsSync(p) ? ((rd(p) as { findings?: FindingEntry[] }).findings ?? []) : [];
}

function rowMatches(row: Row, r: Result): boolean {
  if (r.channel !== row.channel) return false;
  if (!row.families.includes(r.family)) return false;
  if (row.groupPrefix !== undefined && !row.groupPrefix.some((p) => r.group.startsWith(p))) return false;
  if (row.excludeGroupPrefix !== undefined && row.excludeGroupPrefix.some((p) => r.group.startsWith(p))) return false;
  return true;
}

function countLines(path: string): number {
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "").length;
}

export function buildModel(root: string, results: string = resultsDir(root)): Model {
  if (!hasRuns(results)) throw new Error(`no run folders at ${runsDir(results)}: set SUITE_RESULTS_DIR or pass --results-dir (docs/04 section 21)`);
  const config = rd(join(root, "results", "at-a-glance.config.json")) as Config;
  const skipRules = (rd(join(root, "results", "skip-classes.json")) as { rules: SkipRule[] }).rules;
  const catalog = loadCatalog(root);
  const blocks = loadRuns(results).filter((b) => b.tier === 1).sort(cmpBlocks);
  const exceptions = loadExceptions(root);
  const runFolders = [...new Set(loadRuns(results).map((b) => b.run))].sort();
  const allRunDirs = readdirSync(runsDir(results)).filter((d) => statSync(join(runsDir(results), d)).isDirectory()).sort();
  const newestDate = allRunDirs.map((d) => /^\d{4}-\d{2}-\d{2}/.exec(d)?.[0] ?? "").sort().pop() ?? "";
  const byKind: Record<string, number> = {};
  for (const v of catalog.values()) if (!v.excludedFromRun) byKind[v.kind] = (byKind[v.kind] ?? 0) + 1;
  const govFiles = allRunDirs.map((d) => join(runsDir(results), d, "governance-evidence.jsonl")).filter((p) => existsSync(p));

  const subjects: Subject[] = config.subjects.map((cfg) => ({
    cfg,
    surfaces: cfg.surfaces.map((s) => buildSurface(root, results, s, blocks, catalog, skipRules, exceptions, config, newestDate, govFiles)),
  }));
  const unclassified: Model["unclassified"] = [];
  for (const s of subjects) for (const sf of s.surfaces) for (const r of sf.reasons) if (r.cls === "unclassified") unclassified.push({ surface: sf.cfg.id, reason: sanitize(r.reason), count: r.count });
  return { config, subjects, catalog: { total: [...catalog.values()].filter((v) => !v.excludedFromRun).length, byKind }, runFolders, newestDate, unclassified, interop: loadInterop(root, results), skipRules, results, runSet: runSetId(results), specPin: specPinOf(root), focus: loadFocus(root), kwReach: loadKwReach(root), vtiRoles: loadVtiRoles(root) };
}

function buildSurface(root: string, rdir: string, cfg: SurfaceCfg, blocks: RunBlock[], catalog: Map<string, CatalogVector>, rules: SkipRule[], exceptions: Exc[], config: Config, newestDate: string, govFiles: string[]): SurfaceModel {
  const mine = blocks.filter((b) => (b.impl === cfg.impl || (cfg.aliases ?? []).includes(b.impl)) && (cfg.runs === undefined || cfg.runs.includes(b.run)));
  const chosen = new Map<string, { r: RawResult; b: RunBlock }>();
  // vectors excluded from every run (retired TF spec) are not measured: older recorded results for them are left out
  for (const b of mine) for (const r of b.results) if (r.tier === 1 && !chosen.has(r.id) && catalog.get(r.id)?.excludedFromRun !== true) chosen.set(r.id, { r, b });
  const raw = [...chosen.values()].sort((x, y) => (x.r.id < y.r.id ? -1 : 1));
  // Tasks (slug) for which some vector ran: used to tell "other version ran" from "task not served at all".
  const served = new Set<string>();
  for (const { r } of raw) { if (r.status !== "SKIP") { const c = catalog.get(r.id); if (c) served.add(c.slug); } }
  const staleExceptions: string[] = [];
  const results: Result[] = raw.map(({ r, b }) => {
    const c = catalog.get(r.id);
    const reason = r.reason ?? "";
    // The runner reports a recorded exception that no longer applies as a FAIL ("the vector now passes"), so the exception gets deleted. The vector passed: it is a PASS here, listed apart.
    const stale = r.status === "FAIL" && STALE_EXCEPTION.test(reason);
    if (stale) staleExceptions.push(r.id);
    const family = r.family ?? c?.family ?? "";
    return {
      id: r.id, status: stale ? "PASS" : r.status, reason: stale ? "" : reason, family, group: r.group ?? c?.group ?? "", channel: c?.channel ?? (r.channel === "proposed" ? "proposed" : r.channel === "candidate" ? "candidate" : "registry"),
      kind: c?.kind ?? kindOfFamily(family), run: b.run, slug: c?.slug ?? "", version: c?.version ?? "",
      cls: r.status === "SKIP" ? skipClassOf(r, b, cfg.id, rules, served) : null,
    };
  });
  const runs = [...new Set(raw.map((x) => x.b.run))].sort();
  const newestRun = runs.length > 0 ? runs[runs.length - 1]! : "";
  const earlierWhy: string[] = [];
  if (runs.length > 0) {
    const newestRunDate = /^\d{4}-\d{2}-\d{2}/.exec(newestRun)?.[0] ?? "";
    if (newestRunDate < newestDate) earlierWhy.push(`run folders end on ${newestRunDate}, before the newest recorded run (${newestDate})`);
    if (raw.some((x) => !x.b.hasChannel)) earlierWhy.push("run predates the channel split (channel taken from the vector catalog)");
    const kinds = new Set(results.map((r) => r.kind));
    const missing = [...catalog.values()].filter((v) => v.tier === 1 && !v.excludedFromRun && kinds.has(v.kind) && !chosen.has(v.id)).length; // vectors excluded from run are never run, so they are not "missing"
    if (missing > 0) earlierWhy.push(`${missing} checks added to the suite since the run were not run`);
  }
  const byRow: Record<string, Counts> = {};
  for (const row of config.rows) byRow[row.id] = tally(results.filter((r) => rowMatches(row, r)));
  const byMeasure: Record<string, Counts> = {};
  for (const m of MEASURES) byMeasure[m.id] = tally(results.filter((r) => m.kinds.includes(r.kind) && r.channel === m.channel));

  // Task types (slug + version), among the checks the surface has results for.
  const tmap = new Map<string, { ran: boolean; na: boolean }>();
  for (const r of results) {
    if (catalog.get(r.id)?.synthetic === true || r.slug === "" || r.slug === "trust-task-framework" || r.slug === "trust-task-control" || r.slug.startsWith("bindings/") || r.cls === "out-of-tier") continue;
    const k = `${r.slug}@${r.version}`;
    const t = tmap.get(k) ?? { ran: false, na: true };
    if (r.status !== "SKIP") t.ran = true;
    if (r.status !== "SKIP" || r.cls !== "not-applicable") t.na = false;
    tmap.set(k, t);
  }
  const tv = [...tmap.values()];
  const types = { total: tv.length, ran: tv.filter((t) => t.ran).length, notApplicable: tv.filter((t) => !t.ran && t.na).length, other: tv.filter((t) => !t.ran && !t.na).length };

  // Findings: recorded exceptions whose vector is KNOWN-FAIL in the chosen results; FAIL results are listed apart.
  const status = new Map(results.map((r) => [r.id, r]));
  const groups = new Map<string, Exc[]>();
  const platform = recordedPlatform(rdir, runs, cfg.impl);
  for (const e of exceptions) {
    if (e.impl !== cfg.impl && (platform === undefined || e.impl !== platform || (e.notOn !== undefined && Object.hasOwn(e.notOn, cfg.impl)))) continue;
    if (status.get(e.vector)?.status !== "KNOWN-FAIL") continue;
    const g = groups.get(e.reason) ?? [];
    g.push(e);
    groups.set(e.reason, g);
  }
  const findings: Finding[] = [...groups.entries()].map(([reason, es]) => {
    const l = linkOf(root, es[0]!.ref ?? "", newestRun);
    const cls = classOf(es[0]!);
    return { title: titleOf(reason, config.findingTitles), category: categoryOf(reason, cls), cls, vectors: es.map((e) => e.vector).sort(), link: l.link, linkLabel: l.label };
  }).sort((a, b) => b.vectors.length - a.vectors.length || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  const known = loadFindings(root).filter((f) => f.impl === cfg.impl && f.excused === false);
  const recorded: RecordedFinding[] = [];
  for (const r of results.filter((x) => x.status === "FAIL")) {
    const f = known.find((k) => k.vector === r.id);
    if (f === undefined) continue;
    const l = linkOf(root, f.ref ?? "", newestRun);
    recorded.push({ vector: r.id, cls: f.class ?? "", explanation: f.explanation, link: l.link, linkLabel: l.label === "README" ? `run ${l.link.split("/").slice(-2, -1)[0] ?? ""}` : l.label });
  }
  const unexplained = results.filter((r) => r.status === "FAIL" && !recorded.some((x) => x.vector === r.id)).map((r) => r.id);

  const rc = new Map<string, { cls: SkipClass; reason: string; count: number; note: string }>();
  for (const r of results) if (r.status === "SKIP" && r.cls !== null) {
    const key = `${r.cls}|${r.reason}`;
    const e = rc.get(key) ?? { cls: r.cls, reason: r.reason, count: 0, note: rules.find((x) => (x.surfaces === undefined || x.surfaces.includes(cfg.id)) && new RegExp(x.match, "i").test(r.reason))?.note ?? "" };
    e.count++; rc.set(key, e);
  }
  const reasons = [...rc.values()].sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1));
  // Governance evidence: emitted documents that rely on values the platform's builder chose. Counted from the newest recorded file, for the wallet only.
  const governanceNotes = cfg.impl === "keyring-wallet" && govFiles.length > 0 ? countLines(govFiles[govFiles.length - 1]!) : 0;
  const essential = loadEssential(rdir, runs, cfg.impl);
  const tierOut = new Set<string>();
  for (const b of mine) {
    for (const id of b.excludedByTier ?? []) tierOut.add(id);
    for (const r of b.results) if (r.status === "SKIP" && TIER_SKIP.test(r.reason ?? "")) tierOut.add(r.id);
  }
  return { cfg, runs, newestRun, recordedEarlier: earlierWhy.length > 0, earlierWhy, results, byRow, byMeasure, staleExceptions: staleExceptions.sort(), findings, recorded, unexplained, reasons, types, governanceNotes, excludedByTier: tierOut.size, essential };
}

function loadInterop(root: string, results: string): Interop {
  const ledger = rd(join(root, "results", "interop", "ledger.json")) as { entries: { id: string; date: string; task: string; version: string; carrier: string; outcome: string; sender: { platform: string }; receiver: { platform: string } }[] };
  const pm = rd(join(results, "interop", "pair-matrix.json")) as { sources: { id: string; label: string; run: string }[]; pairs: { pair: string[]; total: { ran: number; bothPass: number } }[] };
  const label = (id: string): string => pm.sources.find((s) => s.id === id)?.label ?? id;
  return {
    ledgerEntries: ledger.entries.length,
    ledgerLines: ledger.entries.map((e) => `${e.id}, ${e.date}: ${e.sender.platform} to ${e.receiver.platform}, ${e.task} ${e.version}, ${e.carrier}, outcome ${e.outcome}`),
    pairs: pm.pairs.map((p) => ({ label: p.pair.map(label).join(" and "), ran: p.total.ran, both: p.total.bothPass })),
    pairSources: pm.sources.map((s) => s.run),
  };
}

// ---------- plain-language cell status ----------

export type CellKind = "agrees" | "agrees-open" | "differences" | "unexplained" | "not-applicable" | "not-reached" | "version-mismatch" | "none" | "not-reachable";
export const CELL_WORD: Record<CellKind, { word: string; glyph: string; mean: string }> = {
  "agrees": { word: "Agrees", glyph: "\u2713", mean: "Everything that ran did what the specification expects." },
  "agrees-open": { word: "Agrees, open points", glyph: "\u2713?", mean: "Everything that ran agrees, except points the specifications leave open." },
  "differences": { word: "Differences found", glyph: "!", mean: "At least one check ran and the platform differs from what the check expects; each is recorded and explained." },
  "unexplained": { word: "Needs a look", glyph: "\u2717", mean: "A difference that is not yet explained or recorded." },
  "not-applicable": { word: "Not applicable", glyph: "\u2013", mean: "The platform does not implement this, so the check does not apply." },
  "not-reached": { word: "Not reached yet", glyph: "\u25CB", mean: "Our test setup cannot drive this yet. Not a statement about the platform." },
  "version-mismatch": { word: "Different version", glyph: "\u2248", mean: "The platform offers the task at a different version than the checks need." },
  "none": { word: "No run recorded", glyph: "\u25CB", mean: "No result has been recorded for this part." },
  "not-reachable": { word: "Cannot be reached", glyph: "\u25CB", mean: "The suite cannot talk to this platform yet." },
};

export function cellKind(c: Counts | undefined): CellKind {
  if (c === undefined || c.total === 0) return "none";
  if (c.ran === 0) {
    // Nothing ran: name the biggest reason, so a row that is almost all "not applicable" reads that way.
    const nr = c.notReached + c.unclassified;
    if (c.notApplicable >= nr && c.notApplicable >= c.versionMismatch) return "not-applicable";
    return c.versionMismatch > nr ? "version-mismatch" : "not-reached";
  }
  if (c.fail > 0) return "unexplained";
  if (c.knownFail > 0) return "differences";
  if (c.clarify > 0) return "agrees-open";
  return "agrees";
}

export const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${Math.round((100 * n) / d)}%`);
export const reachText = (c: Counts): string => `${c.ran} of ${c.applicable}`;

export function sanitizeText(s: string): string { return sanitize(s); }

/** Platform order required wherever platforms are listed; the suite's own adapter comes last. */
export const PLATFORM_ORDER = ["vti", "keyring-wallet", "truststackers-original", "reference"];
export function ordered(model: Model): Subject[] {
  const rank = (s: Subject): number => { const i = PLATFORM_ORDER.indexOf(s.cfg.id); return i < 0 ? PLATFORM_ORDER.length : i; };
  return [...model.subjects].sort((a, b) => rank(a) - rank(b));
}

/** The measure a surface is summarised by: core registry where it has results, else the first gating measure it has. */
export function headlineMeasure(sf: SurfaceModel): string | undefined {
  for (const m of ["core", "emit", "witness", "plain"]) if ((sf.byMeasure[m]?.total ?? 0) > 0) return m;
  return undefined;
}
