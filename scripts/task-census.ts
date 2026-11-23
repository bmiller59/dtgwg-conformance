// SPDX-License-Identifier: Apache-2.0
// Census of the trust task types keyring-wallet (KW) or VTI use, joined to the vectors the suite holds, at version grain (docs/22).
//   node --experimental-strip-types scripts/task-census.ts [--json] [--runs <run folder>...]
// The list of used types is vectors-src/coverage/task-census.tsv (derived from the platforms' source by a human-run survey; see docs/22).
// A type counts as having a vector when some vector's source names the same slug and version; as ran on a surface when a result of
// such a vector on that surface is anything other than SKIP.
import { loadCatalog } from "../src/glance/model.ts";
import { KW_ROLES, loadCensus } from "../src/coverage/families.ts";
import { SUITE_ROOT } from "../src/vectors/source.ts";

export interface CensusSummary { types: number; withVector: number; withoutVector: number; byFamily: Record<string, { types: number; withVector: number }>; usedBy: { kw: number; vti: number; both: number }; kwRoles: Record<string, number>; kwSends: number; kwWithVector: { sends: number; used: number }; candidateOnly: number }

export function summarize(root = SUITE_ROOT): CensusSummary {
  const cat = [...loadCatalog(root).values()].filter((v) => v.slug !== "");
  const have = new Set(cat.map((v) => `${v.slug}/${v.version}`));
  const rows = loadCensus();
  const byFamily: CensusSummary["byFamily"] = {};
  for (const r of rows) {
    const f = (byFamily[r.family] ??= { types: 0, withVector: 0 });
    f.types++;
    if (have.has(r.type)) f.withVector++;
  }
  const withVector = rows.filter((r) => have.has(r.type)).length;
  return {
    types: rows.length, withVector, withoutVector: rows.length - withVector, byFamily,
    usedBy: { kw: rows.filter((r) => r.kw).length, vti: rows.filter((r) => r.vti).length, both: rows.filter((r) => r.kw && r.vti).length },
    // KW headline: the types KW sends (role sent or both); `usedBy.kw` is the earlier all-used figure (every type its source names).
    kwRoles: Object.fromEntries(KW_ROLES.map((k) => [k, rows.filter((r) => r.kwRole === k).length])), kwSends: rows.filter((r) => r.kwSends).length,
    kwWithVector: { sends: rows.filter((r) => r.kwSends && have.has(r.type)).length, used: rows.filter((r) => r.kw && have.has(r.type)).length },
    candidateOnly: rows.filter((r) => r.tfStatus === "none").length,
  };
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("task-census.ts")) {
  const s = summarize();
  if (process.argv.includes("--json")) console.log(JSON.stringify(s, null, 2));
  else {
    console.log(`${s.types} used types (KW sends ${s.kwSends} of ${s.usedBy.kw} it uses [${KW_ROLES.map((k) => `${k} ${s.kwRoles[k]}`).join(", ")}], VTI ${s.usedBy.vti}, both platforms ${s.usedBy.both}); ${s.withVector} with a vector, ${s.withoutVector} without; ${s.candidateOnly} without a Trust Tasks specification`);
    console.log(`  keyring-wallet (headline: types it sends): ${s.kwWithVector.sends} of ${s.kwSends} with a vector; earlier figure (every type it uses): ${s.kwWithVector.used} of ${s.usedBy.kw}`);
    for (const [k, v] of Object.entries(s.byFamily)) console.log(`  ${k}: ${v.withVector} of ${v.types}`);
  }
}
