// SPDX-License-Identifier: Apache-2.0
// Spec-maturity channels and spec-drift detection (docs/04 section 18).
//
// Every vector carries `source`: where the rule it tests comes from, how mature that source is (its channel), and a digest of the
// source text or schema as it stood when the vector was derived (`pinnedDigest`). `spec` (the citation list) keeps the line-level
// citations; `source` names the document they point into, so the two do not duplicate each other.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "@openvtc/trust-tasks/runtime";
import { loadTask as pkgLoad } from "../plain/catalog.ts";
import { deriveImplementedBy, deriveImplementedByGovernance } from "./implemented-by.ts";
import { tfRefFor } from "./tfref.ts";

/**
 * `registry`: the spec is in the Trust Tasks registry on main (every registry spec is status draft: "registry" says where the text lives, not that it is ratified).
 * `pr`: the spec is an open, unmerged pull request (the number and head SHA are recorded).
 * `proposed`: a suite-defined profile or grouping (the 2L profiles, `profile` names it) over tasks that DO exist in the Trust Tasks repository; `tfRef` names them. Advisory.
 * `candidate`: no home in the Trust Tasks repository, implemented by one or a few platforms and possibly adoptable later (decision 79 by the project owner). Advisory, never an endorsement;
 *   carries `candidate: {implementedBy, localText, adoptionNote}`.
 * Every vector that is not a `candidate` must also carry `tfRef` (the Trust Tasks repository artifact it cites).
 */
export const CHANNELS = ["registry", "pr", "proposed", "candidate"] as const;
export type Channel = (typeof CHANNELS)[number];
/** Channels whose results are advisory: never gating, never in a headline total. */
export const ADVISORY_CHANNELS: readonly Channel[] = ["pr", "proposed", "candidate"];
export const DEFAULT_CHANNELS: readonly Channel[] = ["registry"];
/**
 * The class a vector is counted under where channel counts are shown: its channel, except that a suite instrument marked `probe: true`
 * (the governance probes, docs/17) is counted as `probe`, apart from the candidates, so the candidate figures hold only adoptable behaviour.
 */
export type CountedClass = Channel | "probe";
export const countedClassOf = (v: { probe?: unknown; source?: { channel?: string } }): CountedClass =>
  v.probe === true ? "probe" : ((v.source?.channel as Channel | undefined) ?? "registry");
/** Errors of the `probe` marker: only `true`, and only on a `candidate` vector (an instrument never gates; docs/04 section 18.1). */
export function probeMarkerErrors(v: { probe?: unknown; source?: unknown }, path: string): string[] {
  if (v.probe === undefined) return [];
  if (v.probe !== true) return [`${path}.probe: only true is allowed`];
  const channel = typeof v.source === "object" && v.source !== null ? (v.source as { channel?: unknown }).channel : undefined;
  return channel === "candidate" ? [] : [`${path}.probe: a probe must be in channel candidate (got ${String(channel)})`];
}

/** Status of the cited Trust Tasks repository artifact: `draft` (a registry spec, front matter status draft, on main), `main` (a non-spec document on main: SPEC.md, a binding, a schema), `pr` (open, unmerged pull request), `retired`. */
export const TF_STATUSES = ["main", "draft", "pr", "retired"] as const;
export type TfStatus = (typeof TF_STATUSES)[number];

/** The Trust Tasks repository artifact a vector cites: `{repoPath, commit}` for a file on main (the commit it was resolved at), or `{pr, head}` for an open pull request. */
export interface TfRef {
  status: TfStatus;
  /** Path inside the Trust Tasks repository, for example `specs/acl/grant/0.3/spec.md`, `SPEC.md`. Absent only for status `pr`. */
  repoPath?: string;
  /** Full SHA of the Trust Tasks commit (main) the path was resolved at. */
  commit?: string;
  /** Status `pr` only: the open pull request number and its head SHA. */
  pr?: number;
  head?: string;
  /** Status `retired` only: the path of the successor. */
  supersededBy?: string;
}

/** What a `candidate` vector rests on (decision 79 by the project owner). */
export interface CandidateInfo {
  /** Platforms that implement it, derived from the recorded results (see `deriveImplementedBy`); not hard-coded to one. */
  implementedBy: string[];
  /** Required when `implementedBy` is empty: why no platform implements it yet. */
  implementedByNote?: string;
  /** Repository path of the suite-local text the vector rests on (for example `docs/10-witness-share-profile.md`). */
  localText: string;
  /** Where adoption stands: a Trust Tasks issue or PR when one exists, else `none filed`. */
  adoptionNote: string;
}

export interface VectorSource {
  /** Registry slug (`credential-exchange/issue`), or a name for a non-task document (`trust-task-framework`, `bindings/https`). */
  slug: string;
  version: string;
  channel: Channel;
  /** Where the source text lives, with a scheme: `kit:<path>` (task-force checkout), `suite:<path>` (this repository), `pkg:<name>@<version>#<type URI>` (the pinned package). */
  ref: string;
  /** `sha256:<hex>` of the source as it stood when the vector was derived; null until pinned (flagged as spec-drift). */
  pinnedDigest: string | null;
  /** Channel `pr` only: the open pull request the text comes from. */
  pr?: { number: number; headSha: string };
  /** Required on every vector that is not a `candidate`: the Trust Tasks repository artifact the vector cites. Optional on a candidate (the TF text it exercises in part). */
  tfRef?: TfRef;
  /** Channel `candidate` only: see CandidateInfo. */
  candidate?: CandidateInfo;
  /** Channel `proposed` only: the suite-defined profile the vector belongs to (for example `2L`); advisory by this flag. */
  profile?: string;
  /** Free text, for example why a vector carries a channel its source text would not suggest. */
  note?: string;
  /** Registry only: the vector was promoted from an advisory channel (vectors-src/promotions.json, docs/33). `was` keeps the former tags so a demotion is exact. */
  promotion?: { batch: string; rule: "standard" | "single-implementer"; provisional: boolean; decision?: string; was: { channel: string; profile?: string } };
  /** The Trust Tasks commit `specHash` and `schemaHash` were taken at (equals `tfRef.commit`). Spec drift, docs/23. */
  tfCommit?: string;
  /** `sha256:<hex>` of the NORMALISED text of the cited Trust Tasks file (src/vectors/spec-hash.ts). Catches change in the cited text, not correctness. */
  specHash?: string;
  /** `sha256:<hex>` of the canonical `payload.schema.json` of the task the vector exercises (task specs only). */
  schemaHash?: string;
}

const HASH = /^sha256:[0-9a-f]{64}$/;

export function isChannel(x: unknown): x is Channel {
  return typeof x === "string" && (CHANNELS as readonly string[]).includes(x);
}

export function parseChannels(arg: string): Channel[] {
  const out: Channel[] = [];
  for (const raw of arg.split(",")) {
    const c = raw.trim();
    if (!isChannel(c)) throw new Error(`unknown channel "${c}" (one of ${CHANNELS.join(", ")})`);
    if (!out.includes(c)) out.push(c);
  }
  if (out.length === 0) throw new Error("--channels needs at least one channel");
  return out;
}

export function validateSource(s: unknown, p: string): string[] {
  const errs: string[] = [];
  if (typeof s !== "object" || s === null || Array.isArray(s)) return [`${p}: required object {slug, version, channel, ref, pinnedDigest}`];
  const o = s as Record<string, unknown>;
  for (const k of ["slug", "version", "ref"]) if (typeof o[k] !== "string" || o[k] === "") errs.push(`${p}.${k}: non-empty string required`);
  if (!isChannel(o.channel)) errs.push(`${p}.channel: one of ${CHANNELS.join(", ")}`);
  if (o.pinnedDigest !== null && !(typeof o.pinnedDigest === "string" && /^sha256:[0-9a-f]{64}$/.test(o.pinnedDigest))) errs.push(`${p}.pinnedDigest: sha256:<hex> or null`);
  if (typeof o.ref === "string" && !/^(kit|suite|pkg):/.test(o.ref)) errs.push(`${p}.ref: must start with kit:, suite: or pkg:`);
  for (const k of ["specHash", "schemaHash"] as const) if (o[k] !== undefined && !(typeof o[k] === "string" && HASH.test(o[k] as string))) errs.push(`${p}.${k}: sha256:<hex> when given`);
  if (o.tfCommit !== undefined && !(typeof o.tfCommit === "string" && /^[0-9a-f]{40}$/.test(o.tfCommit))) errs.push(`${p}.tfCommit: full 40-hex Trust Tasks commit when given`);
  if ((o.specHash !== undefined || o.schemaHash !== undefined) && o.tfCommit === undefined) errs.push(`${p}.tfCommit: required with specHash or schemaHash`);
  if (o.schemaHash !== undefined && o.specHash === undefined) errs.push(`${p}.specHash: required with schemaHash`);
  const pr = o.pr as Record<string, unknown> | undefined;
  if (o.channel === "pr") {
    if (typeof pr !== "object" || pr === null || !Number.isInteger(pr.number) || typeof pr.headSha !== "string" || !/^[0-9a-f]{7,40}$/.test(pr.headSha)) errs.push(`${p}.pr: channel pr requires {number, headSha}`);
  } else if (o.pr !== undefined) errs.push(`${p}.pr: only allowed with channel pr`);
  if (o.channel === "candidate") {
    const c = o.candidate as Record<string, unknown> | undefined;
    if (typeof c !== "object" || c === null || Array.isArray(c)) errs.push(`${p}.candidate: channel candidate requires {implementedBy, localText, adoptionNote}`);
    else {
      if (!Array.isArray(c.implementedBy) || !c.implementedBy.every((x) => typeof x === "string" && x !== "")) errs.push(`${p}.candidate.implementedBy: list of platform names`);
      else if (c.implementedBy.length === 0 && (typeof c.implementedByNote !== "string" || c.implementedByNote === "")) errs.push(`${p}.candidate.implementedByNote: required when implementedBy is empty`);
      if (typeof c.localText !== "string" || c.localText === "") errs.push(`${p}.candidate.localText: non-empty repository path required`);
      else if (!existsSync(join(SUITE_ROOT, c.localText))) errs.push(`${p}.candidate.localText: ${c.localText} does not exist in the suite repository`);
      if (typeof c.adoptionNote !== "string" || c.adoptionNote === "") errs.push(`${p}.candidate.adoptionNote: non-empty string required`);
    }
    if (o.tfRef !== undefined) errs.push(...validateTfRef(o.tfRef, `${p}.tfRef`));
  } else {
    if (o.candidate !== undefined) errs.push(`${p}.candidate: only allowed with channel candidate`);
    if (o.tfRef === undefined) errs.push(`${p}.tfRef: required ({repoPath, commit, status} or {pr, head, status pr}): every vector must cite a Trust Tasks repository artifact, or be channel candidate`);
    else {
      errs.push(...validateTfRef(o.tfRef, `${p}.tfRef`));
      const t = o.tfRef as Record<string, unknown>;
      if ((o.channel === "pr") !== (t.status === "pr")) errs.push(`${p}.tfRef.status: pr exactly when channel is pr`);
      if (o.channel === "pr" && typeof pr === "object" && pr !== null && (t.pr !== pr.number || t.head !== pr.headSha)) errs.push(`${p}.tfRef: pr/head must equal source.pr {number, headSha}`);
    }
  }
  if (o.promotion !== undefined) {
    const pm = o.promotion as Record<string, unknown>;
    const was = pm.was as Record<string, unknown> | undefined;
    if (o.channel !== "registry") errs.push(`${p}.promotion: only allowed with channel registry`);
    if (typeof pm !== "object" || pm === null || typeof pm.batch !== "string" || !["standard", "single-implementer"].includes(String(pm.rule)) || typeof pm.provisional !== "boolean") errs.push(`${p}.promotion: {batch, rule (standard|single-implementer), provisional, was}`);
    else if (typeof was !== "object" || was === null || !["proposed", "candidate"].includes(String(was.channel))) errs.push(`${p}.promotion.was.channel: proposed or candidate`);
    else if (pm.rule === "single-implementer" && typeof pm.decision !== "string") errs.push(`${p}.promotion.decision: required with rule single-implementer (the decision that amended the rule)`);
  }
  if (o.channel === "proposed") {
    if (typeof o.profile !== "string" || o.profile === "") errs.push(`${p}.profile: channel proposed requires the profile name (it is the profile that is advisory; the tasks it groups are in tfRef)`);
  } else if (o.profile !== undefined) errs.push(`${p}.profile: only allowed with channel proposed`);
  return errs;
}

export function validateTfRef(t: unknown, p: string): string[] {
  const errs: string[] = [];
  if (typeof t !== "object" || t === null || Array.isArray(t)) return [`${p}: object required`];
  const o = t as Record<string, unknown>;
  if (!(TF_STATUSES as readonly string[]).includes(o.status as string)) { errs.push(`${p}.status: one of ${TF_STATUSES.join(", ")}`); return errs; }
  if (o.status === "pr") {
    if (!Number.isInteger(o.pr) || typeof o.head !== "string" || !/^[0-9a-f]{7,40}$/.test(o.head)) errs.push(`${p}: status pr requires {pr: number, head: sha}`);
    if (o.repoPath !== undefined || o.commit !== undefined) errs.push(`${p}: status pr takes pr/head, not repoPath/commit`);
  } else {
    if (typeof o.repoPath !== "string" || o.repoPath === "" || o.repoPath.startsWith("/") || o.repoPath.includes("..")) errs.push(`${p}.repoPath: repository-relative path required`);
    if (typeof o.commit !== "string" || !/^[0-9a-f]{40}$/.test(o.commit)) errs.push(`${p}.commit: full 40-hex Trust Tasks commit required`);
    if (o.pr !== undefined || o.head !== undefined) errs.push(`${p}: pr/head only with status pr`);
  }
  if (o.status === "retired") { if (typeof o.supersededBy !== "string" || o.supersededBy === "") errs.push(`${p}.supersededBy: required for status retired`); }
  else if (o.supersededBy !== undefined) errs.push(`${p}.supersededBy: only with status retired`);
  return errs;
}

// ---------------------------------------------------------------- digests

const sha = (b: Uint8Array | string): string => createHash("sha256").update(b).digest("hex");

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(relative(base, p));
  }
  return out;
}

/** Digest of a file (its bytes) or a directory (every file under it, sorted, by relative path and content). */
export function digestPath(path: string): string | null {
  if (!existsSync(path)) return null;
  if (statSync(path).isFile()) return `sha256:${sha(readFileSync(path))}`;
  const lines = listFiles(path).map((f) => `${f}\0${sha(readFileSync(join(path, f)))}\n`);
  return `sha256:${sha(lines.join(""))}`;
}

export interface DigestRoots {
  /** A checkout of the task-force repository (kit:). Absent: kit sources are missing. */
  kit?: string | undefined;
  /** This repository (suite:). */
  suite: string;
  /** Resolve a pkg: ref; default reads the pinned package. */
  pkg?: (ref: string) => string | null;
}

const here = dirname(fileURLToPath(import.meta.url));
export const SUITE_ROOT = resolve(here, "../..");

/** Where a task-force checkout is expected: `--kit`, else `TT_KIT`, else a sibling directory `dtgwg-trust-tasks-tf` of the suite checkout. */
export function defaultKitRoot(explicit?: string): string | undefined {
  const cands = [explicit, process.env["TT_KIT"], resolve(SUITE_ROOT, "..", "dtgwg-trust-tasks-tf")];
  return cands.find((c) => c !== undefined && c !== "" && existsSync(c));
}

/** Digest of a package task version's payload schema, response schema and policy (what the vectors are derived from). */
export function digestPackageTask(task: { payloadSchema: unknown; responseSchema: unknown; requestPolicy: unknown; responsePolicy: unknown }): string {
  return `sha256:${sha(canonicalJson({ payload: task.payloadSchema, response: task.responseSchema ?? null, requestPolicy: task.requestPolicy, responsePolicy: task.responsePolicy ?? null }))}`;
}

/** The current digest of a source, or null when it is not available locally. */
export function currentDigest(ref: string, roots: DigestRoots): string | null {
  if (ref.startsWith("kit:")) return roots.kit === undefined ? null : digestPath(join(roots.kit, ref.slice(4)));
  if (ref.startsWith("suite:")) return digestPath(join(roots.suite, ref.slice(6)));
  if (ref.startsWith("pkg:")) return (roots.pkg ?? defaultPkgDigest)(ref);
  return null;
}

function defaultPkgDigest(ref: string): string | null {
  const m = /^pkg:[^#]+#(.+)$/.exec(ref);
  if (m === null) return null;
  const t = pkgLoad(m[1]!);
  return t === undefined ? null : digestPackageTask(t);
}


// ---------------------------------------------------------------- drift

export interface DriftFinding {
  /** Always `spec-drift`: an advisory finding that needs human review; never a failure. */
  kind: "spec-drift";
  ref: string;
  slug: string;
  channel: Channel;
  reason: "changed" | "missing-source" | "unpinned";
  pinned: string | null;
  current: string | null;
  vectors: string[];
}

/** Compare every vector's pinned digest with the source as available now; one finding per source (ref), listing its vectors. */
export function detectDrift(vectors: { id: string; source: VectorSource }[], roots: DigestRoots): DriftFinding[] {
  const byRef = new Map<string, { slug: string; channel: Channel; pinned: Set<string | null>; ids: string[] }>();
  for (const v of vectors) {
    const k = `${v.source.channel}\0${v.source.ref}`;
    const e = byRef.get(k) ?? { slug: v.source.slug, channel: v.source.channel, pinned: new Set(), ids: [] };
    e.pinned.add(v.source.pinnedDigest);
    e.ids.push(v.id);
    byRef.set(k, e);
  }
  const out: DriftFinding[] = [];
  const cache = new Map<string, string | null>();
  for (const [k, e] of byRef) {
    const ref = k.slice(k.indexOf("\0") + 1);
    if (!cache.has(ref)) cache.set(ref, currentDigest(ref, roots));
    const current = cache.get(ref)!;
    for (const pinned of e.pinned) {
      const ids = e.ids;
      let reason: DriftFinding["reason"] | null = null;
      if (current === null) reason = "missing-source";
      else if (pinned === null) reason = "unpinned";
      else if (pinned !== current) reason = "changed";
      if (reason !== null) out.push({ kind: "spec-drift", ref, slug: e.slug, channel: e.channel, reason, pinned, current, vectors: ids });
    }
  }
  return out.sort((a, b) => a.ref.localeCompare(b.ref));
}

// ---------------------------------------------------------------- pins (generation time)

export const PINS_FILE = join(SUITE_ROOT, "vectors", "pins.json");
export interface PinsFile { format: "tt-conformance-pins/0.1"; pins: Record<string, string> }

export function loadPins(path = PINS_FILE): Record<string, string> {
  if (!existsSync(path)) return {};
  return (JSON.parse(readFileSync(path, "utf8")) as PinsFile).pins ?? {};
}

export function pinFor(ref: string, pins: Record<string, string> = loadPins()): string | null {
  return pins[ref] ?? null;
}

// ---------------------------------------------------------------- classification of the core families

/** Where a citation list points: the primary source of a vector, by the first citation that names a document of the registry or the suite. */
export interface Classified { slug: string; version: string; ref: string; note?: string; candidate?: CandidateInfo; tfRef?: TfRef }

const WSH_TEXT = "docs/10-witness-share-profile.md";
/** The witness-share candidate: implemented by whichever platforms the recorded results show executing it (keyring-wallet, truststackers via a stand-in at the time of writing). */
export function witnessShareCandidate(idPrefix: "WSH-" | "TD-"): CandidateInfo {
  return {
    implementedBy: deriveImplementedBy((id) => id.startsWith(idPrefix)),
    localText: WSH_TEXT,
    adoptionNote: "No Trust Tasks task, branch, issue or pull request for witness-share exists (checked 2026-11-15); the nearest registry neighbours are vrc/relationships/{propose,issue} and witness/session. Not yet proposed to the task force.",
  };
}
/** The governance-declaration candidate (the probes' tasks are TF drafts; the declaration they probe, docs/17, is suite-local). */
export function governanceCandidate(): CandidateInfo {
  const implementedBy = deriveImplementedByGovernance();
  return {
    implementedBy,
    ...(implementedBy.length === 0 ? { implementedByNote: "No platform has a declaration path the adapters can reach: every recorded platform run reports GOV-NOT-PROBED; only the suite's reference adapter (declareGovernance) exercises the probes." } : {}),
    localText: "docs/17-governance-probes.md",
    adoptionNote: "The tasks probed are Trust Tasks drafts (acl/grant 0.3, acl/list 0.4, policy/evaluate 0.4); the declaration {roles, principals, authority} has no Trust Tasks home (governance/capability/* is a different artifact). None filed.",
  };
}

const FRAMEWORK = { slug: "trust-task-framework", version: "0.6.0", ref: "kit:SPEC.md" } as const;

export function classifyCitations(spec: string[], group: string, suiteHas: (p: string) => boolean = (p) => existsSync(join(SUITE_ROOT, p))): Classified & { channel: Channel } {
  if (group === "WSH" || group === "TD") {
    const tf = group === "TD" ? tfRefFor("kit:SPEC.md") : null;
    return {
      slug: "vrc/relationships/witness-share", version: "0.1", ref: `suite:${WSH_TEXT}`, channel: "candidate", candidate: witnessShareCandidate(group === "WSH" ? "WSH-" : "TD-"),
      ...(tf === null ? {} : { tfRef: tf }),
      note: group === "WSH"
        ? "suite-local profile (docs/10), no Trust Tasks home; channel candidate per decision 79 by the project owner (supersedes 78's proposed)"
        : "exercises the framework task-digest pairing rule (SPEC.md 4.9.3, tfRef) through the suite-local witness-share task (docs/10), which has no Trust Tasks home, so the vector is a candidate (decision 79 by the project owner / audit 2.A)",
    };
  }
  for (const c of spec) {
    let m = /^specs\/(.+?)\/(\d+\.\d+)\//.exec(c);
    if (m !== null) return { slug: m[1]!, version: m[2]!, ref: `kit:specs/${m[1]}/${m[2]}`, channel: "registry" };
    m = /^bindings\/(\w+)\/(\d+\.\d+)\//.exec(c);
    if (m !== null) return { slug: `bindings/${m[1]}`, version: m[2]!, ref: `kit:bindings/${m[1]}/${m[2]}`, channel: "registry" };
    m = /^(ceremonies\/ceremony\.meta\.schema\.json)/.exec(c);
    if (m !== null) return { slug: "ceremony-meta-schema", version: "0.1", ref: `kit:${m[1]}`, channel: "registry" };
    m = /^fixtures\/(consume|proof)\/([\w.\-]+\.json)/.exec(c);
    if (m !== null && suiteHas(`vectors/imported/${m[1]}/${m[2]}`)) return { slug: FRAMEWORK.slug, version: FRAMEWORK.version, ref: `suite:vectors/imported/${m[1]}`, channel: "registry" };
  }
  return { ...FRAMEWORK, channel: "registry" };
}

// ---------------------------------------------------------------- spec hashes (docs/23)

export const SPEC_HASHES_FILE = join(SUITE_ROOT, "vectors-src", "spec-hashes.json");
export interface SpecHashesFile {
  format: "tt-spec-hashes/0.1";
  /** The Trust Tasks commit the entries were hashed at, unless an entry names its own (a path re-pinned later, scripts/repin.ts). */
  tfCommit: string;
  /** Keyed by Trust Tasks path (`specs/acl/grant/0.3/spec.md`, `SPEC.md`). */
  paths: Record<string, { specHash: string; schemaHash?: string; tfCommit?: string }>;
}
let specHashes: SpecHashesFile | null | undefined;
/** The committed table of hashes by Trust Tasks path (written by scripts/backfill-spec-hashes.ts), so generation stays offline and deterministic. Null when absent. */
export function loadSpecHashes(path = SPEC_HASHES_FILE): SpecHashesFile | null {
  if (path === SPEC_HASHES_FILE && specHashes !== undefined) return specHashes;
  const t = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as SpecHashesFile) : null;
  if (path === SPEC_HASHES_FILE) specHashes = t;
  return t;
}

/** `source` with `tfCommit`, `specHash` and `schemaHash` from the table, when the source cites a Trust Tasks path on main that the table holds. After a re-pin `tfCommit` may differ from `tfRef.commit` (the vector's text was re-checked against a newer commit). */
export function withSpecHashes(source: VectorSource, table: SpecHashesFile | null = loadSpecHashes()): VectorSource {
  const t = source.tfRef;
  if (table === null || t === undefined || t.status === "pr" || t.repoPath === undefined) return source;
  const e = table.paths[t.repoPath];
  if (e === undefined) return source;
  return { ...source, tfCommit: e.tfCommit ?? table.tfCommit, specHash: e.specHash, ...(e.schemaHash === undefined ? {} : { schemaHash: e.schemaHash }) };
}

/** Attach `source` to a vector, placing it right after `spec` so the key order stays readable. */
export function withSource<T extends object>(vec: T, rawSource: VectorSource): T & { source: VectorSource } {
  const source = withSpecHashes(rawSource);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vec)) {
    if (k === "source" || k === "synthetic" || k === "excludedFromRun") continue;
    out[k] = v;
    if (k === "spec") out["source"] = source;
  }
  if (out["source"] === undefined) out["source"] = source;
  if (usesSyntheticType(vec)) out["synthetic"] = true;
  if (source.tfRef?.status === "retired") out["excludedFromRun"] = excludedFromRunRetired((vec as { id?: string }).id ?? "");
  return out as T & { source: VectorSource };
}

/** Task types that are not in the Trust Tasks repository: the suite's own carrier types (`conformance/*`) and the deliberately unknown receipt version. */
const SYNTHETIC_TYPE = /trusttasks\.org\/spec\/(conformance\/|trust-ceremony-receipt\/1\.0)/;
/** Whether a vector's carrier task type is synthetic (a stand-in for "any task"; the vector still tests a rule whose `source` resolves). Such a vector is kept, marked `synthetic`, and not counted as a tested task. */
export function usesSyntheticType(vec: object): boolean {
  return SYNTHETIC_TYPE.test(JSON.stringify(vec, (k, v) => (k === "source" ? undefined : v)));
}

export const RETIRED_REASON = "cites a retired TF spec; successor 0.2 is draft on main";
/** The `excludedFromRun` marker of a vector whose cited TF spec is retired. The emit vectors (EM-*) test what the keyring-wallet sends, and the wallet still emits the retired 0.1 versions: recorded in the note. */
export function excludedFromRunRetired(id: string): { reason: string; note: string } {
  return {
    reason: RETIRED_REASON,
    note: id.startsWith("EM-")
      ? "The keyring-wallet still emits the retired 0.1 version of this task (recorded finding, not a verdict of this suite); excluded from every run until the vector is re-sourced to the draft 0.2 successor."
      : "The pinned package 0.29.0 still ships the retired 0.1 version of this task; excluded from every run until the vector is re-sourced to the draft 0.2 successor.",
  };
}

export function coreSource(spec: string[], group: string, pins: Record<string, string>): VectorSource {
  const c = classifyCitations(spec, group);
  const tfRef = c.tfRef ?? (c.channel === "candidate" ? null : tfRefFor(c.ref));
  if (tfRef === null && c.channel !== "candidate") throw new Error(`no Trust Tasks reference for ${c.ref}: it is not in vectors/tf-manifest.json (refresh with scripts/tf-manifest.ts) or not a TF artifact`);
  return {
    slug: c.slug, version: c.version, channel: c.channel, ref: c.ref, pinnedDigest: pinFor(c.ref, pins),
    ...(tfRef === null ? {} : { tfRef }), ...(c.candidate === undefined ? {} : { candidate: c.candidate }), ...(c.note === undefined ? {} : { note: c.note }),
  };
}

/** `source` of a vector derived from the pinned @openvtc/trust-tasks package (the registry package; every registry specification is status draft). */
export function pkgSource(task: { slug: string; version: string; typeUri: string }, pkgVersion: string, pins: Record<string, string>): VectorSource {
  const ref = `pkg:@openvtc/trust-tasks@${pkgVersion}#${task.typeUri}`;
  const tfRef = tfRefFor(ref);
  if (tfRef === null) throw new Error(`no Trust Tasks reference for ${ref}: not in vectors/tf-manifest.json`);
  return { slug: task.slug, version: task.version, channel: "registry", ref, pinnedDigest: pinFor(ref, pins), tfRef };
}
