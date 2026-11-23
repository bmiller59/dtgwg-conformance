// SPDX-License-Identifier: Apache-2.0
// The VTI participation table (decision D421): one row per focus slug with VTI's role on each surface, the evidence, and what the runs say on the
// three surfaces that have runs (agent, community, client builders). Data-driven like the keyring-wallet table (participation.ts): no percentage is
// defined here; the roll-up counts over `role` and `result`. The denominator of a surface is the slugs where that surface has a role (serves, emits,
// older-version); `named-only` is shown as not yet built with a flag (D408), `not-built` and `not-involved` are reach classes, never a skip.
import { EMIT_SETS, resultOf as kwResultOf, summarise, type SlugResult, type VecSummary } from "./participation.ts";
import type { VectorSeen } from "./platforms.ts";
import { evidenceCellOf, VTI_WITH_ROLE, type VtiRole, type VtiRoleRow, type VtiRoleRules } from "./vti-roles.ts";
import type { TaskVersion, VectorRef } from "./types.ts";

export const VTI_PLATFORMS = ["vti"] as const;
/** The surfaces that have run records (the run map's agent, community and emit surfaces); the others have a role but no runs. */
export const RUN_SURFACES = ["vta", "vtc", "client"] as const;
const hasRole = (r: VtiRole | "unclassified"): boolean => r !== "unclassified" && VTI_WITH_ROLE.has(r);

export interface VtiParticipationRow {
  slug: string;
  version: string;
  family: string;
  roles: Record<string, { role: VtiRole | "unclassified"; evidence: string; also: string[]; why?: string }>;
  /** Vector counts for the latest version on a run surface, per platform: the emit side for client builders, the consumer side for the services. */
  vectors: Record<string, Record<string, VecSummary>>;
  ceremonyNamed: string[];
  result: Record<string, Record<string, SlugResult>>;
}

export function buildVtiParticipation(input: {
  tasks: TaskVersion[];
  roles: VtiRoleRow[];
  surfaces: string[];
  vectors: VectorRef[];
  /** Keyed `<platform>/<surface>` (see detailsByVtiSurface). */
  details: Map<string, Map<string, VectorSeen>>;
  scenarioTasks: Map<string, string[]>;
}): VtiParticipationRow[] {
  const latest = new Map<string, TaskVersion>();
  for (const t of input.tasks) if (t.latest && t.focus === "focus") latest.set(t.slug, t);
  const setOf = new Map(input.vectors.map((v) => [v.id, v.set]));
  const named = new Map<string, string[]>();
  for (const [sc, uris] of input.scenarioTasks) for (const u of uris) named.set(u, [...(named.get(u) ?? []), sc]);
  const rows: VtiParticipationRow[] = [];
  for (const r of input.roles) {
    const t = latest.get(r.slug);
    if (t === undefined) continue;
    const emitIds = t.vectors.filter((v) => EMIT_SETS.has(setOf.get(v) ?? ""));
    const consIds = t.vectors.filter((v) => !EMIT_SETS.has(setOf.get(v) ?? ""));
    const row: VtiParticipationRow = { slug: r.slug, version: r.version, family: r.family, roles: {}, vectors: {}, ceremonyNamed: [...new Set(named.get(t.typeUri) ?? [])].sort(), result: {} };
    for (const s of input.surfaces) { const x = r.surfaces[s]; row.roles[s] = { role: x?.role ?? "unclassified", evidence: x === undefined ? "-" : evidenceCellOf(x), also: x?.also ?? [], ...(x?.why !== undefined ? { why: x.why } : {}) }; }
    for (const p of VTI_PLATFORMS) {
      row.vectors[p] = {};
      row.result[p] = {};
      for (const s of input.surfaces) {
        const role = r.surfaces[s]?.role ?? "unclassified";
        if (!(RUN_SURFACES as readonly string[]).includes(s)) { row.result[p]![s] = hasRole(role) ? "role-not-run" : "n/a"; continue; }
        const seen = input.details.get(`${p}/${s}`) ?? new Map<string, VectorSeen>();
        const emit = summarise(s === "client" ? emitIds : [], seen);
        const cons = summarise(s === "client" ? [] : consIds, seen);
        row.vectors[p]![s] = s === "client" ? emit : cons;
        // a surface the run records say nothing about reads like the wallet table: ran when a vector executed there, else by role
        row.result[p]![s] = hasRole(role) ? kwResultOf("emits", emit, cons) : emit.ran + cons.ran > 0 ? kwResultOf("emits", emit, cons) : "n/a";
      }
    }
    rows.push(row);
  }
  return rows;
}

export interface SurfaceCounts {
  /** Slugs where the surface has a role (serves, emits, older-version): the denominator. */
  withRole: number;
  /** Of those, slugs with at least one vector executed on the surface in the runs read. */
  ran: number;
  byRole: Record<string, number>;
  byResult: Record<string, number>;
}

export function vtiSurfaceCounts(rows: VtiParticipationRow[], platform: string, surface: string): SurfaceCounts {
  const c: SurfaceCounts = { withRole: 0, ran: 0, byRole: {}, byResult: {} };
  for (const r of rows) {
    const role = r.roles[surface]?.role ?? "unclassified";
    c.byRole[role] = (c.byRole[role] ?? 0) + 1;
    const res = r.result[platform]?.[surface] ?? "n/a";
    c.byResult[res] = (c.byResult[res] ?? 0) + 1;
    if (hasRole(role)) { c.withRole++; if (res.startsWith("ran-")) c.ran++; }
  }
  return c;
}

const cell = (s: string): string => s.replace(/\|/g, "\\|");
const SHORT: Record<string, string> = { serves: "serves", emits: "emits", "older-version": "older", "named-only": "named only", "not-built": "not built", "not-involved": "-", unclassified: "?" };

export function renderVtiParticipation(rows: VtiParticipationRow[], rules: VtiRoleRules, meta: { inputs: Record<string, string>; generated: string; runInfo: Record<string, string> }): string {
  const surfaces = rules.surfaces.map((s) => s.id);
  const label = new Map(rules.surfaces.map((s) => [s.id, s.label]));
  const L: string[] = [];
  L.push("# VTI participation: what each VTI surface does with each target task", "");
  L.push("> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. Nothing here has been filed with or sent to any project.", "");
  L.push("Generated by `npm run coverage-matrix` from the VTI source, the vectors and the run records (decision D421; machine-readable copy: [vti-participation.json](vti-participation.json), roles and evidence: [vti-roles.json](vti-roles.json), rules: [vti-role-rules.json](vti-role-rules.json)). One row per focus slug (the latest non-retired version of each task). Inputs: " + Object.entries(meta.inputs).map(([k, v]) => `${k} \`${v}\``).join("; ") + ".", "");
  L.push("## How to read it", "");
  L.push("Seven surfaces are read: " + surfaces.map((s) => `\`${s}\` (${label.get(s)})`).join(", ") + ". The four services answer a task through a handler registration (`serves`). The three client surfaces are read for every non-test reference to a task, comments stripped and constants and module aliases resolved, and classified by call role: a reference handed to a sender or builder is `emits`; one compared with or matched against a received document is read as `serves`; a name in a list, a re-export or a table is `named-only`. A surface that names only a lower version has role `older-version`. A slug with no code on a surface gets its role from a prefix rule with a stated reason (`not-built`: the surface could take part and nothing was found; `not-involved`: no role by design). Those rules are judgement and each carries its reason in the rules file; the code evidence is not judgement.", "");
  L.push("A role-based denominator is the slugs where a surface has a role (`serves`, `emits`, `older-version`). `named-only` is shown as not yet built with a `named only` flag (D408), never as an attempt. `not-built` and `not-involved` are reach classes: neither is a skip nor a failure. Results are read per run surface: the agent and community services against the consumer vectors of the runs of that service, the client builders against the emit vectors; the other surfaces have no runs, so a role there reads `role-not-run`. `ran` means a vector of the latest version was executed (PASS, FAIL, KNOWN-FAIL or CLARIFY) in a run of that surface.", "");
  L.push("Runs read: " + Object.entries(meta.runInfo).map(([k, v]) => `${k}: ${v}`).join("; ") + ".", "");
  L.push("## Roles by surface", "");
  L.push(`| Surface | ${["serves", "emits", "older-version", "named-only", "not-built", "not-involved"].join(" | ")} | With a role | Ran on the surface |`, `|${Array(9).fill("---").join("|")}|`);
  for (const s of surfaces) {
    const u = vtiSurfaceCounts(rows, "vti", s);
    const runs = (RUN_SURFACES as readonly string[]).includes(s);
    L.push(`| \`${s}\` ${label.get(s)} | ${["serves", "emits", "older-version", "named-only", "not-built", "not-involved"].map((r) => u.byRole[r] ?? 0).join(" | ")} | ${u.withRole} | ${runs ? `${u.ran} of ${u.withRole}` : "no runs"} |`);
  }
  L.push("");
  L.push("<!-- lint:skip -->", "", "## Slugs where at least one surface has a role", "");
  const head = ["Slug", "Version", ...surfaces.map((s) => `\`${s}\``), "Evidence (first surface with code)", "Result (agent, community, client)"];
  L.push(`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`);
  const rs = (r: VtiParticipationRow, p: string): string => RUN_SURFACES.map((s) => (r.result[p]?.[s] ?? "n/a").replace("n/a", "-")).join(", ");
  for (const r of rows.filter((x) => surfaces.some((s) => hasRole(x.roles[s]?.role ?? "unclassified")))) {
    const first = surfaces.find((s) => hasRole(r.roles[s]?.role ?? "unclassified")) as string;
    L.push(`| ${cell(`\`${r.slug}\``)} | ${r.version} | ${surfaces.map((s) => SHORT[r.roles[s]?.role ?? "unclassified"]).join(" | ")} | ${cell(`${first}: ${r.roles[first]?.evidence ?? "-"}`)} | ${rs(r, "vti")} |`);
  }
  L.push("");
  L.push("## Slugs with no role on any surface", "", "Grouped by family; named-only slugs are the ones a surface names (a pin, a list or a table) and does not build.", "");
  L.push("| Family | Slugs | Named only on some surface | Not built on some surface | Not involved on every surface |", "|---|---|---|---|---|");
  const grp = new Map<string, VtiParticipationRow[]>();
  for (const r of rows.filter((x) => !surfaces.some((s) => hasRole(x.roles[s]?.role ?? "unclassified")))) grp.set(r.family, [...(grp.get(r.family) ?? []), r]);
  for (const [fam, g] of [...grp].sort((a, b) => a[0].localeCompare(b[0]))) {
    const any = (role: string): number => g.filter((r) => surfaces.some((s) => r.roles[s]?.role === role)).length;
    L.push(`| \`${fam}\` | ${g.length} | ${any("named-only")} | ${any("not-built")} | ${g.filter((r) => surfaces.every((s) => r.roles[s]?.role === "not-involved")).length} |`);
  }
  L.push("", "<!-- /lint:skip -->", "");
  return L.join("\n");
}
