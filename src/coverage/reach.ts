// SPDX-License-Identifier: Apache-2.0
// Where VTI's own source names a Trust Task version: the dispatcher that serves it, the client that sends it, a test that exercises it.
// Read only, from a VTI checkout. Spec-generated crates and documentation are left out: they hold every specification, so they say
// nothing about what VTI does. Complements the matrix scanner (served lists from the dispatch tables): this one also finds the senders,
// the versions of the same task VTI does serve, and (through the constants of vta-sdk) what a short constant name stands for.
import { constMap } from "./matrix/vti.ts";
import { isTestPath, rel, text, walk } from "./matrix/walk.ts";

export type RefKind = "dispatcher" | "client" | "test" | "declaration" | "other";

export interface ReachEntry {
  /** Files (relative) that name this version, by kind. */
  refs: Record<RefKind, string[]>;
  /** Other versions of the same task that VTI source names outside tests and generated crates (a version VTI serves or sends instead). */
  otherVersions: string[];
}

/** Generated specification crates, lock files, documentation and UI assets: they list every specification and so prove nothing. */
export function isGenerated(path: string): boolean {
  return /(^|\/)(vti-specs[a-z-]*|trust-tasks|docs|admin-ui|openapi|CHANGELOG)(\/|\.|$)/.test(path) || /\.(md|lock|json|toml|ya?ml)$/.test(path);
}

export function kindOf(path: string): RefKind {
  // The SDK's constant tables and retry-safety table name every task VTI declares; they say it exists, not that anything builds or serves it.
  if (/^vta-sdk\/src\/(trust_tasks|retry_safety)\.rs$/.test(path)) return "declaration";
  if (isTestPath(path) || /(^|\/)tests?\.rs$|\/test_support\.rs$|conformance\.rs$/.test(path)) return "test";
  if (/^(vta-sdk|vtc-client|pnm-cli|cnm-cli|vta-cli-common|vta-mobile-core|vta-mcp)\//.test(path)) return "client";
  if (/^(vta-service|vtc-service|vti-rooms|vti-trust-task-server|vti-vtn|vti-voting-service|vta-webvh|room-host)\//.test(path)) return "dispatcher";
  return "other";
}

/** `https://trusttasks.org/spec/a/b/0.1` as the Rust module path its generated crate uses: `a::b::v0_1`. */
export function modulePathOf(uri: string): string | null {
  const m = /^https:\/\/trusttasks\.org\/spec\/(.+)\/(\d+)\.(\d+)$/.exec(uri);
  if (m === null) return null;
  const segs = (m[1] as string).split("/").map((s) => s.replace(/-/g, "_"));
  return `${segs.join("::")}::v${m[2]}_${m[3]}`;
}

const slugOf = (uri: string): string => uri.replace(/^https:\/\/trusttasks\.org\/spec\//, "").replace(/\/\d+\.\d+$/, "");

/** Index every non-generated Rust file once, then answer per version. */
export function scanReach(root: string, uris: string[]): Map<string, ReachEntry> {
  const files = walk(root, [".rs"]).map((p) => ({ p, r: rel(root, p) })).filter((f) => !isGenerated(f.r));
  const consts = constMap(walk(root, [".rs"]));
  const byUri = new Map<string, string[]>();
  for (const [name, uri] of consts) {
    if (!byUri.has(uri)) byUri.set(uri, []);
    (byUri.get(uri) as string[]).push(name);
  }
  const wanted = new Set(uris);
  const bySlug = new Map<string, Set<string>>();
  const entries = new Map<string, ReachEntry>(uris.map((u) => [u, { refs: { dispatcher: [], client: [], test: [], declaration: [], other: [] }, otherVersions: [] }]));
  const mods = new Map<string, string>(uris.map((u) => [modulePathOf(u) ?? "", u]));
  mods.delete("");
  const allVersions = new Map<string, Set<string>>();
  for (const f of files) {
    // Code before the file's test module, without comments; what follows `#[cfg(test)]` counts as test.
    const whole = text(f.p);
    const cut = whole.search(/^#\[cfg\(test\)\]/m);
    const code = (cut < 0 ? whole : whole.slice(0, cut)).replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
    const testPart = cut < 0 ? "" : whole.slice(cut);
    for (const [src, kind] of [[code, kindOf(f.r)], [testPart, "test" as RefKind]] as [string, RefKind][]) {
      if (src === "") continue;
    const found = new Set<string>();
    for (const m of src.matchAll(/https:\/\/trusttasks\.org\/spec\/([a-z0-9][a-z0-9/_-]*?)\/(\d+\.\d+)(?![0-9.])/g)) found.add(`https://trusttasks.org/spec/${m[1]}/${m[2]}`);
    for (const [path, uri] of mods) if (src.includes(path.replace(/^/, "")) && new RegExp(`(^|[^a-z0-9_])${path.replace(/[$()*+.?[\]\\^{|}]/g, "\\$&")}\\b`).test(src.replace(/r#/g, ""))) found.add(uri);
    for (const [uri, names] of byUri) {
      if (wanted.has(uri) && names.some((n) => new RegExp(`\\b${n}\\b`).test(src)) && !/^vta-sdk\/src\/trust_tasks\.rs$/.test(f.r)) found.add(uri);
    }
    for (const u of found) {
      if (kind !== "test") {
        const s = slugOf(u);
        if (!allVersions.has(s)) allVersions.set(s, new Set());
        (allVersions.get(s) as Set<string>).add(u.replace(/^.*\//, ""));
      }
      const e = entries.get(u);
      if (e !== undefined && !e.refs[kind].includes(f.r)) e.refs[kind].push(f.r);
    }
    }
  }
  for (const [u, e] of entries) {
    const s = slugOf(u);
    e.otherVersions = [...(allVersions.get(s) ?? [])].filter((v) => !u.endsWith(`/${v}`)).sort();
    bySlug.set(s, new Set(e.otherVersions));
  }
  return entries;
}

/** How a version stands against one VTI source tree and the types its hosts declare at run time. */
export type ReachState =
  | "declared" // a host declares it (discovery list or the pre-session set): vectors can run
  | "feature-gated" // the dispatcher routes it, behind a cargo feature the host was built without
  | "sent-only" // VTI builds or sends it (client, outbound), and no dispatcher serves it
  | "other-version" // VTI serves or sends the same task at a different version
  | "absent"; // nothing outside the generated crates names the task

export interface ReachInput {
  uri: string;
  family: string;
  retired: boolean;
  /** Focus class of the version in the coverage matrix (decision D245); absent when the matrix is not at hand (then every version counts as focus). */
  focus?: "focus" | "older" | "retired";
}

/**
 * Why a version is not reached, in the two classes the reach pages use: `platform` (the platform does not serve or send a version that is in the
 * target) and `scope` (the version is outside the target: older than the latest, or retired). `reached` = a host declares it.
 */
export type ReachClass = "reached" | "platform" | "scope";

/** For `other-version`: VTI names only newer versions of the task (`superseded`: this version is older than what VTI speaks), only older ones (`behind`: VTI is below this version), or both. */
export type OtherDirection = "superseded" | "behind" | "mixed";

export interface ReachRow extends ReachInput {
  state: ReachState;
  reachClass: ReachClass;
  /** other-version only. */
  otherDirection?: OtherDirection;
  /** Cargo feature that gates it (feature-gated only). */
  feature?: string;
  /** The versions of the same task VTI names instead (other-version) . */
  otherVersions: string[];
  refs: ReachEntry["refs"];
}

/** The feature a served-in-source type needs. Read from `#[cfg(feature = ...)]` on the dispatch entries (vta-service and vtc-service trust_tasks/mod.rs). */
export function featureOf(uri: string): string | undefined {
  const s = uri.replace(/^https:\/\/trusttasks\.org\/spec\//, "");
  if (s.startsWith("vta/attestation/")) return "tee";
  if (s.startsWith("vtc/elections/")) return "voting";
  if (/^vtc\/vetting\/(hidden\/|vetters\/(pcs-|event-mode|pcs-binding)|pcs-)/.test(s)) return "vetting-pcs";
  return undefined;
}

/**
 * State per version. `declared` is what the hosts say they serve at run time (the truth for a build); `served` is what the source's
 * dispatchers route (a superset where a feature is off); `scan` is `scanReach`.
 */
export function otherDirection(uri: string, others: string[]): OtherDirection {
  const v = uri.replace(/^.*\//, "");
  const cmp = (a: string, b: string): number => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let k = 0; k < Math.max(pa.length, pb.length); k++) if ((pa[k] ?? 0) !== (pb[k] ?? 0)) return (pa[k] ?? 0) - (pb[k] ?? 0);
    return 0;
  };
  const newer = others.some((o) => cmp(o, v) > 0);
  const older = others.some((o) => cmp(o, v) < 0);
  return newer && older ? "mixed" : newer ? "superseded" : "behind";
}

/** `scope` for any version outside the target (older than its slug's latest, or retired), whatever the platform does; otherwise `reached` or `platform`. */
export function reachClassOf(i: ReachInput, state: ReachState): ReachClass {
  if (i.retired || (i.focus !== undefined && i.focus !== "focus")) return "scope";
  return state === "declared" ? "reached" : "platform";
}

export function classifyReach(inputs: ReachInput[], declared: Set<string>, served: Set<string>, scan: Map<string, ReachEntry>): ReachRow[] {
  return inputs.map((i) => {
    const e = scan.get(i.uri) as ReachEntry;
    const base = { ...i, otherVersions: e.otherVersions, refs: e.refs };
    const done = <S extends ReachState>(state: S, extra: object = {}): ReachRow => ({ ...base, state, reachClass: reachClassOf(i, state), ...extra });
    if (declared.has(i.uri)) return done("declared");
    if (served.has(i.uri)) {
      const feature = featureOf(i.uri);
      return done("feature-gated", feature === undefined ? {} : { feature });
    }
    if (e.refs.client.length > 0 || e.refs.dispatcher.length > 0 || e.refs.other.length > 0) return done("sent-only");
    if (e.otherVersions.length > 0) return done("other-version", { otherDirection: otherDirection(i.uri, e.otherVersions) });
    return done("absent");
  });
}
