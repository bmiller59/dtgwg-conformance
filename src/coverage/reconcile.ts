// SPDX-License-Identifier: Apache-2.0
// Reconciles the two keyring-wallet (KW) figures the suite prints: the task-grain list (results/task-scope.json plus the named-types
// file it points at, counted by slug) and the census (vectors-src/coverage/task-census.tsv, counted by slug and by type). Every number
// and every list is computed from those files; nothing here is typed in. See docs/22.
import type { CensusRow } from "./families.ts";

export interface SlugRoles { slug: string; family: string; versions: string[]; roles: string[]; sends: boolean }
export interface Reconciliation {
  /** Slugs in the task list (task-scope.json plus the named-types file). */
  taskList: number;
  /** Of those, slugs listed in task-scope.json itself, and slugs added from the named-types file. */
  inScopeFile: number; fromNamedFile: number;
  /** Distinct slugs of the census rows KW uses, and the census rows (types) KW uses. */
  censusSlugs: number; censusTypes: number;
  /** Slugs of the census KW rows in which KW sends at least one version. */
  censusSentSlugs: number; censusSentTypes: number;
  /** Slugs with more than one KW version in the census (the step-down lists): they are one task at task grain and several types at version grain. */
  multiVersionSlugs: number;
  both: number;
  censusOnly: SlugRoles[]; listOnly: { slug: string; censusRows: string[] }[];
  /** Named-types file entries (slug and version) that are not a census KW row, with the census rows of that type if any. */
  namedNotKwRow: { type: string; censusUsedBy: string | undefined }[];
  /** `censusSlugs = taskList - listOnly + censusOnly` holds. */
  balances: boolean;
  /** Slugs the census marks as sent by KW that the task list lacks. */
  sentNotInList: number;
  /** Slugs in the task list that KW does not send at any version (received only or named only), by the census. */
  listNotSent: number;
}

export function reconcile(census: CensusRow[], scopeFileSlugs: string[], namedTypes: string[]): Reconciliation {
  const kw = census.filter((r) => r.kw);
  const bySlug = new Map<string, CensusRow[]>();
  for (const r of kw) bySlug.set(r.slug, [...(bySlug.get(r.slug) ?? []), r]);
  const namedSlugs = namedTypes.map((t) => t.replace(/\/\d+(\.\d+)*$/, ""));
  const list = new Set<string>([...scopeFileSlugs, ...namedSlugs]);
  const summary = (slug: string): SlugRoles => {
    const rs = bySlug.get(slug)!;
    return { slug, family: rs[0]!.family, versions: rs.map((r) => r.version), roles: [...new Set(rs.map((r) => r.kwRole!))], sends: rs.some((r) => r.kwSends) };
  };
  const censusOnly = [...bySlug.keys()].filter((s) => !list.has(s)).sort().map(summary);
  const listOnly = [...list].filter((s) => !bySlug.has(s)).sort().map((slug) => ({ slug, censusRows: census.filter((r) => r.slug === slug).map((r) => `${r.type} (${r.usedBy.join("+")})`) }));
  const kwTypes = new Set(kw.map((r) => r.type));
  const sentSlugs = [...bySlug.keys()].filter((s) => bySlug.get(s)!.some((r) => r.kwSends));
  return {
    taskList: list.size, inScopeFile: new Set(scopeFileSlugs).size, fromNamedFile: [...new Set(namedSlugs)].filter((s) => !scopeFileSlugs.includes(s)).length,
    censusSlugs: bySlug.size, censusTypes: kw.length, censusSentSlugs: sentSlugs.length, censusSentTypes: kw.filter((r) => r.kwSends).length,
    multiVersionSlugs: [...bySlug.values()].filter((rs) => rs.length > 1).length,
    both: [...list].filter((s) => bySlug.has(s)).length,
    censusOnly, listOnly,
    namedNotKwRow: namedTypes.filter((t) => !kwTypes.has(t)).map((type) => ({ type, censusUsedBy: census.find((r) => r.type === type)?.usedBy.join("+") })),
    balances: bySlug.size === list.size - listOnly.length + censusOnly.length,
    sentNotInList: sentSlugs.filter((s) => !list.has(s)).length,
    listNotSent: [...list].filter((s) => bySlug.has(s) && !bySlug.get(s)!.some((r) => r.kwSends)).length,
  };
}
