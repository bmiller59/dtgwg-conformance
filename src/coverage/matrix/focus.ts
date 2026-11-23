// SPDX-License-Identifier: Apache-2.0
// The latest-version direction (decision D245): which version of each slug is the target, what replaces a retired latest, and the counts the
// matrix quotes. Pure functions over the matrix rows; nothing here reads a platform or the task force repository.
import { KW_ROLES, reachOfRole, type RoleRow } from "./roles.ts";
import type { FocusClass, FocusSummary, KwReachSummary, PlatformStatus, SlugReach, SlugState, TaskVersion, VectorRef } from "./types.ts";

/** `slug` or `slug/1.0`: the slug a `supersededBy` value names (a trailing `<major>.<minor>` is a version, never part of a slug). */
export function slugOfSuperseded(v: string): string {
  return v.replace(/\/\d+\.\d+$/, "");
}

/**
 * Sets `focus` and `successors` on every row. `latest` must already be set. A latest version that is not retired is `focus`; a latest retired one
 * is `retired` and takes its successor from `supersededBy` (the latest of the successor slug, followed through retired successors, at most 8 hops);
 * every version below the latest is `older`.
 */
export function classifyFocus(tasks: TaskVersion[]): void {
  const latestOf = new Map<string, TaskVersion>();
  for (const t of tasks) if (t.latest) latestOf.set(t.slug, t);
  const successorsOf = (t: TaskVersion): string[] => {
    const seen = new Set<string>([t.slug]);
    let cur: TaskVersion = t;
    for (let hop = 0; hop < 8; hop++) {
      if (cur.supersededBy === null) return [];
      const slug = slugOfSuperseded(cur.supersededBy);
      if (seen.has(slug)) return [];
      seen.add(slug);
      const next = latestOf.get(slug);
      if (next === undefined) return [];
      if (next.status !== "retired") return [next.typeUri];
      cur = next;
    }
    return [];
  };
  for (const t of tasks) {
    t.successors = [];
    if (!t.latest) t.focus = "older";
    else if (t.status === "retired") {
      t.focus = "retired";
      t.successors = successorsOf(t);
    } else t.focus = "focus";
  }
}

/** How a vector stands: it is focus when it names any focus version, older when it names only versions below the latest, retired when only a retired latest. */
export function vectorFocus(tasks: TaskVersion[]): FocusClass | "none" {
  if (tasks.length === 0) return "none";
  if (tasks.some((t) => t.focus === "focus")) return "focus";
  if (tasks.some((t) => t.focus === "older")) return "older";
  return "retired";
}

const bySlug = (tasks: TaskVersion[]): Map<string, TaskVersion[]> => {
  const m = new Map<string, TaskVersion[]>();
  for (const t of tasks) m.set(t.slug, [...(m.get(t.slug) ?? []), t]);
  return m;
};

/** VTI state of one focus slug: the latest served, an older one served, the latest pinned, only an older one pinned, or none of it named. */
export function vtiSlugState(vs: TaskVersion[]): SlugState {
  const latest = vs.find((v) => v.latest) as TaskVersion;
  if (latest.vti.served.length > 0) return "latest";
  if (vs.some((v) => v.vti.served.length > 0)) return "behind";
  if (latest.vti.pinned) return "pinned-latest";
  if (vs.some((v) => v.vti.pinned)) return "pinned-older";
  return "not-named";
}

/** keyring-wallet state of one focus slug: the latest named, only an older one named, or none. */
export function kwSlugState(vs: TaskVersion[]): "latest" | "behind" | "not-named" {
  const latest = vs.find((v) => v.latest) as TaskVersion;
  if (latest.kw.referenced) return "latest";
  return vs.some((v) => v.kw.referenced) ? "behind" : "not-named";
}

const zeroStatus = (): Record<PlatformStatus, number> => ({ covered: 0, skip: 0, none: 0, "not-run": 0 });

export function focusSummary(tasks: TaskVersion[], vectors: VectorRef[], platformIds: string[]): FocusSummary {
  const slugs = bySlug(tasks);
  const out: FocusSummary = {
    slugs: slugs.size,
    versions: tasks.length,
    latestVersions: tasks.filter((t) => t.latest).length,
    focusVersions: tasks.filter((t) => t.focus === "focus").length,
    olderVersions: tasks.filter((t) => t.focus === "older").length,
    retiredLatest: [],
    vti: { latest: 0, behind: 0, "pinned-latest": 0, "pinned-older": 0, "not-named": 0 },
    kw: { latest: 0, behind: 0, "not-named": 0 },
    withVector: { focus: 0, older: 0, retired: 0 },
    vectors: { focus: 0, older: 0, retired: 0, none: 0 },
    platforms: Object.fromEntries(platformIds.map((id) => [id, { focus: zeroStatus(), older: zeroStatus() }])),
  };
  for (const t of tasks) {
    if (t.vectors.length > 0) out.withVector[t.focus]++;
    if (t.focus === "retired") {
      out.retiredLatest.push({ slug: t.slug, version: t.version, supersededBy: t.supersededBy, successors: t.successors, state: t.successors.length > 0 ? "successor" : t.supersededBy === null ? "none" : "unresolved" });
    }
    for (const id of platformIds) {
      const st = t.platforms[id] as PlatformStatus | undefined;
      if (st === undefined) continue;
      if (t.focus === "focus") (out.platforms[id] as FocusSummary["platforms"][string]).focus[st]++;
      else if (t.focus === "older") (out.platforms[id] as FocusSummary["platforms"][string]).older[st]++;
    }
  }
  for (const vs of slugs.values()) {
    const latest = vs.find((v) => v.latest);
    if (latest === undefined || latest.focus !== "focus") continue;
    out.vti[vtiSlugState(vs)]++;
    out.kw[kwSlugState(vs)]++;
  }
  for (const v of vectors) out.vectors[v.focus]++;
  out.retiredLatest.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

/**
 * keyring-wallet reach against role-based denominators (decision D301). The wallet is a client: most of the 862 target slugs are service or
 * operator surfaces it has no role in. Per wallet platform, each focus slug takes the status of its latest version; a slug where the wallet has a
 * role is covered, skipped (reach class `platform`), not run or without a vector; any other slug is `not-built` (a family a wallet could use and
 * the source does not) or `not-involved` (no wallet role by design). Ceremony overlay slugs are counted apart: never conformance.
 */
export function kwReachSummary(tasks: TaskVersion[], roles: RoleRow[], platformIds: string[]): KwReachSummary {
  const latest = new Map<string, TaskVersion>();
  for (const t of tasks) if (t.latest && t.focus === "focus") latest.set(t.slug, t);
  const rolesCount = Object.fromEntries([...KW_ROLES, "unclassified"].map((r) => [r, 0])) as KwReachSummary["roles"];
  for (const r of roles) rolesCount[r.role]++;
  const out: KwReachSummary = {
    roles: rolesCount,
    withRole: KW_ROLES.filter((r) => reachOfRole(r) === "role").reduce((n, r) => n + rolesCount[r], 0),
    platforms: {},
  };
  for (const id of platformIds) {
    const byRole: Record<string, Record<PlatformStatus, number>> = Object.fromEntries([...KW_ROLES, "unclassified"].map((r) => [r, zeroStatus()]));
    const reach: Record<SlugReach, number> = { covered: 0, platform: 0, "not-run": 0, "no-vector": 0, "not-built": 0, "not-involved": 0 };
    let ranOutsideRole = 0;
    let ceremonySlugs = 0;
    for (const r of roles) {
      const t = latest.get(r.slug);
      if (t === undefined) continue;
      const st = (t.platforms[id] ?? "none") as PlatformStatus;
      (byRole[r.role] as Record<PlatformStatus, number>)[st]++;
      if (t.ceremony?.[id] !== undefined) ceremonySlugs++;
      if (r.role === "unclassified") continue;
      const kind = reachOfRole(r.role);
      if (kind === "role") reach[st === "covered" ? "covered" : st === "skip" ? "platform" : st === "not-run" ? "not-run" : "no-vector"]++;
      else {
        reach[kind]++;
        if (st === "covered") ranOutsideRole++;
      }
    }
    out.platforms[id] = { byRole, reach, ranOutsideRole, ceremonySlugs };
  }
  return out;
}
