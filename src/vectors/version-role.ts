// SPDX-License-Identifier: Apache-2.0
// O-09: a vector on an older version of a task, or on a retired one, says so in the vector itself (`source.versionRole`), so a gating row on an older version is
// visible in the file and not only in the matrix. `older`: a later version of the same slug exists and is not retired. `retired`: the cited specification is retired.
// A specification the manifest lists as retired is labelled `retired` here and, from D901, excluded from every run (`excludedFromRun`) with the real successor named.
// (Until the manifest moved to bd0c05013 a side table, RETIRED_AFTER_PIN, carried the retirements the manifest did not yet show; the manifest now holds them and the table is gone.)
// D901 gives the effect on the published figures.
import { loadTfManifest } from "./tfref.ts";
import { loadSnapshot } from "../plain/snapshot.ts";
import { RETIRED_REASON } from "./source.ts";

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const cmp = (a: string, b: string): number => { const [a1, a2] = a.split(".").map(Number); const [b1, b2] = b.split(".").map(Number); return (a1! - b1!) || (a2! - b2!); };

let table: Map<string, { version: string; retired: boolean }[]> | undefined;
function versions(): Map<string, { version: string; retired: boolean }[]> {
  if (table !== undefined) return table;
  const m = new Map<string, { version: string; retired: boolean }[]>();
  const add = (slug: string, version: string, retired: boolean): void => { const l = m.get(slug) ?? []; if (!l.some((x) => x.version === version)) l.push({ version, retired }); m.set(slug, l); };
  for (const [p, e] of Object.entries(loadTfManifest().paths)) {
    const r = /^specs\/(.+)\/(\d+\.\d+)\/spec\.md$/.exec(p);
    if (r !== null) add(r[1]!, r[2]!, e.status === "retired");
  }
  for (const t of loadSnapshot().tasks) if (t.origin === undefined) add(t.slug, t.version, t.status === "retired");
  return (table = m);
}

/** The role of a cited task version, or undefined for the newest live version (and for anything that is not a task version). */
export function versionRoleOf(slug: string, version: string, status: string | undefined): "older" | "retired" | undefined {
  if (status === "pr") return undefined;
  if (status === "retired") return "retired";
  const l = versions().get(slug);
  if (l === undefined) return undefined;
  return l.some((x) => !x.retired && cmp(x.version, version) > 0) ? "older" : undefined;
}

/** Label every vector of the files (in place). Returns the counts. */
export function labelVersionRole(files: { vectors: unknown[] }[]): { older: number; retired: number } {
  const n = { older: 0, retired: 0 };
  for (const f of files) for (const v of f.vectors as J[]) {
    const s = v["source"];
    if (!isObj(s) || typeof s["slug"] !== "string" || typeof s["version"] !== "string") continue;
    const tf = isObj(s["tfRef"]) ? s["tfRef"] : undefined;
    if (tf === undefined || s["channel"] === "candidate") { delete s["versionRole"]; continue; }
    const role = versionRoleOf(s["slug"], s["version"], typeof tf["status"] === "string" ? tf["status"] : undefined);
    if (role === undefined) { delete s["versionRole"]; continue; }
    s["versionRole"] = role;
    n[role]++;
    // a retired spec whose exclusion names no real successor (or none at all) gets one that does: the manifest records supersededBy (D901)
    const successor = typeof tf["supersededBy"] === "string" ? tf["supersededBy"] : undefined;
    const ex = isObj(v["excludedFromRun"]) ? v["excludedFromRun"] : undefined;
    if (tf["status"] === "retired" && successor !== undefined && (ex === undefined || (ex["reason"] === RETIRED_REASON && !/\/0\.2$/.test(successor)))) {
      v["excludedFromRun"] = { reason: `cites a retired TF spec; successor ${successor} is draft on main`, note: `${String(s["slug"])} ${String(s["version"])} is retired (superseded by ${successor}); excluded from every run until the vector is re-sourced to the successor (D901).` };
    }
  }
  return n;
}
