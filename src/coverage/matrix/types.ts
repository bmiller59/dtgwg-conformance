// SPDX-License-Identifier: Apache-2.0
// Shapes of the coverage matrix (results/coverage/matrix.json).

export type SourceKind = "main" | "pr" | "branch";
export interface SpecSource {
  kind: SourceKind;
  /** `main`, `pr#904` or `branch:<name>`. */
  ref: string;
  /** Maturity as declared in that source's copy of the spec; `unspecified` when the field is absent. */
  status: string;
  /** Draft PRs are flagged; null when not a PR. */
  draft: boolean | null;
}

/**
 * Where a version stands against the latest-version direction (decision D245): `focus` = the latest non-retired version of its slug (the target);
 * `older` = any version below the latest of its slug (kept, runnable, never in a headline count); `retired` = the latest version of its slug is
 * retired, so the slug is out of the target and its `supersededBy` successor is the target instead.
 */
export type FocusClass = "focus" | "older" | "retired";

import type { KwRole } from "./roles.ts";

export type PlatformStatus = "covered" | "skip" | "none" | "not-run";

export interface TaskVersion {
  /** Full Type URI, no `#response`. */
  typeUri: string;
  slug: string;
  version: string;
  family: string;
  title: string;
  /** Maturity from the best source (main when present, otherwise the first other source). */
  status: string;
  sources: SpecSource[];
  /** Highest version of the slug among main sources (or, when absent from main, among all). */
  latest: boolean;
  /** `focus`, `older` (non-focus) or `retired` (latest, but retired: out of the target). */
  focus: FocusClass;
  /** The `supersededBy` field of the best source, or null. */
  supersededBy: string | null;
  /** For a retired latest version: the target versions that replace it (the latest of its successor slug, chained through retired successors); empty when none. */
  successors: string[];
  vti: { pinned: boolean; served: string[] };
  kw: {
    /** Named in non-test source code (comments ignored). */
    referenced: boolean;
    serves: boolean;
    files: string[];
    /** Named only in comments, never in code. */
    commentOnly?: boolean;
    /** On the latest (focus) version of a slug: the wallet's role in the task (decision D301); null elsewhere or when the source was not read. */
    role?: KwRole | "unclassified" | null;
  };
  vectors: string[];
  platforms: Record<string, PlatformStatus>;
  /** Ceremony overlay per wallet platform: ceremony scenarios that name this version and have a run record with the wallet as a participant. Outcomes of parties run together, never conformance counts. */
  ceremony?: Record<string, CeremonyOverlay>;
}

export interface CeremonyOverlay {
  /** Scenario ids that name the version and have a run record with the wallet taking part. */
  scenarios: string[];
  /** Ceremony rows (folders of ceremony run records) those records come from. */
  rows: string[];
  /** Record status counts (completed, ended-as-specified, failed, skipped ...). */
  outcomes: Record<string, number>;
}

export interface CeremonyStep {
  id: string;
  type: string;
  covered: boolean;
}

export interface CeremonyEntry {
  /** `spec` = a definition in the task force repository; `kw-flow` / `vti-flow` = a multi-step flow read from that platform's source. */
  kind: "spec" | "kw-flow" | "vti-flow";
  id: string;
  title: string;
  sources: SpecSource[];
  steps: CeremonyStep[];
  stepsWithVectors: number;
  /** Vectors that name this ceremony or are the end-to-end vectors for the flow (ids). */
  endToEndVectors: string[];
  notes: string;
}

export interface VectorRef {
  id: string;
  group: string;
  set: string;
  channel: string;
  tasks: string[];
  /** Distinct maturity values of the tasks it references. */
  maturities: string[];
  /** Distinct source kinds of the tasks it references (main, pr, branch). */
  sourceKinds: string[];
  /** `focus` = touches a latest non-retired version; `older` = touches only older versions; `retired` = only latest retired ones (out of the target); `none` = no registry task. */
  focus: FocusClass | "none";
}

export interface PlatformInfo {
  id: string;
  label: string;
  runs: string[];
  note: string;
}

export interface Matrix {
  format: "dtgwg-conformance-coverage/0.1";
  generated: string;
  inputs: Record<string, string>;
  statusField: string;
  platforms: PlatformInfo[];
  tasks: TaskVersion[];
  vectors: VectorRef[];
  ceremonies: CeremonyEntry[];
  /** Latest-version summary (decision D245), computed from `tasks` and `vectors`. */
  focus: FocusSummary;
  limits: string[];
  referencedButUnknown: { source: string; typeUri: string }[];
}

/** State of one slug on one platform against its latest version. */
export type SlugState = "latest" | "behind" | "pinned-latest" | "pinned-older" | "not-named";

export interface FocusSummary {
  slugs: number;
  versions: number;
  latestVersions: number;
  focusVersions: number;
  olderVersions: number;
  retiredLatest: { slug: string; version: string; supersededBy: string | null; successors: string[]; state: "successor" | "none" | "unresolved" }[];
  /** Focus slugs by their state on VTI (served at latest, served only below it, latest pinned with no handler, only an older version pinned, not named) and on keyring-wallet (latest, behind, not-named). */
  vti: Record<SlugState, number>;
  kw: { latest: number; behind: number; "not-named": number };
  /** Versions with a vector, by focus class. */
  withVector: Record<FocusClass, number>;
  /** Vectors by focus class (`none` = names no registry task). */
  vectors: Record<FocusClass | "none", number>;
  /** Per platform: focus versions by run status, and older versions by run status. */
  platforms: Record<string, { focus: Record<PlatformStatus, number>; older: Record<PlatformStatus, number> }>;
  /** keyring-wallet reach against role-based denominators (decision D301); absent when the wallet source was not read. */
  kwReach?: KwReachSummary;
}

/** The reach class of a focus slug on a wallet platform: the wallet has a role (covered, platform = skipped, not run, no vector) or it has none (not-built, not-involved). */
export type SlugReach = "covered" | "platform" | "not-run" | "no-vector" | "not-built" | "not-involved";

export interface KwReachSummary {
  /** Focus slugs by wallet role. */
  roles: Record<KwRole | "unclassified", number>;
  /** Slugs where the wallet has a role: serves, emits, older-version, names-only. */
  withRole: number;
  /** Per wallet platform: the status of the latest version of each focus slug, counted by role, and the slugs by reach class. */
  platforms: Record<string, { byRole: Record<string, Record<PlatformStatus, number>>; reach: Record<SlugReach, number>; ranOutsideRole: number; ceremonySlugs: number }>;
}
