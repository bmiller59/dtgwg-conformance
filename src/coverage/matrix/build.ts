// SPDX-License-Identifier: Apache-2.0
// Assembles the coverage matrix from the gathered specs, the KW and VTI usage, the vectors and the recorded runs.
import { compareVersions } from "./frontmatter.ts";
import { FLOWS } from "./flows.ts";
import { classifyFocus, focusSummary, kwReachSummary, vectorFocus } from "./focus.ts";
import type { Gathered } from "./sources.ts";
import { urisInFiles, type KwUsage } from "./kw.ts";
import { PLATFORMS, detailsByPlatform, detailsByVtiSurface, statusesByPlatform, taskStatus, readRunResults, unmappedFolders, type RunRecord } from "./platforms.ts";
import { readCeremonyRecords, type CeremonyRecord } from "./ceremony-records.ts";
import { buildParticipation, WALLET_PLATFORMS, type ParticipationRow } from "./participation.ts";
import { deriveRoles, type RoleRow, type RoleRules } from "./roles.ts";
import { buildVtiParticipation, type VtiParticipationRow } from "./vti-participation.ts";
import { deriveVtiRoles, type VtiRoleRow, type VtiRoleRules, type VtiUsage as VtiRoleUsage } from "./vti-roles.ts";
import { entryOf, type RunMap } from "./runmap.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { VtiUsage } from "./vti.ts";
import type { ScenarioFile, VectorInfo } from "./vectors.ts";
import type { CeremonyEntry, Matrix, SpecSource, TaskVersion, VectorRef } from "./types.ts";

export interface BuildInput {
  gathered: Gathered;
  kw: KwUsage | null;
  vti: VtiUsage | null;
  vectors: VectorInfo[];
  scenarios: ScenarioFile[];
  /** Run-record roots (results directories or folders of run folders). */
  runsDirs: string[];
  /** The explicit run-folder-to-platform map (results/platform-run-map.json); required when run records are given. */
  runMap: RunMap | null;
  /** Inputs to the wallet role derivation (results/coverage/kw-role-rules.json); without them no roles are derived. */
  roleRules?: RoleRules | null;
  /** VTI roles (decision D420): the rules and the reads of the upstream checkout ; without them no VTI roles are derived. */
  vtiRoleRules?: VtiRoleRules | null;
  vtiRoleUsage?: VtiRoleUsage | null;
  suiteRoot: string;
  kwRoot: string | null;
  vtiRoot: string | null;
  inputs: Record<string, string>;
  generated: string;
}

const kindOrder = { main: 0, pr: 1, branch: 2 } as const;
const familyOf = (slug: string): string => slug.split("/")[0] as string;

export interface BuildOutput {
  matrix: Matrix;
  roles: RoleRow[];
  participation: ParticipationRow[];
  /** VTI roles per focus slug and surface for the upstream source. */
  vtiRoles: VtiRoleRow[];
  vtiParticipation: VtiParticipationRow[];
}

export function build(inp: BuildInput): Matrix {
  return buildAll(inp).matrix;
}

export function buildAll(inp: BuildInput): BuildOutput {
  const { gathered: g } = inp;
  const limits: string[] = [];
  const byUri = new Map<string, TaskVersion>();
  for (const { rec, source } of g.tasks) {
    let t = byUri.get(rec.typeUri);
    if (!t) {
      t = {
        typeUri: rec.typeUri, slug: rec.slug, version: rec.version, family: familyOf(rec.slug), title: rec.title, status: rec.status,
        sources: [], latest: false, focus: "older", supersededBy: rec.supersededBy, successors: [], vti: { pinned: false, served: [] }, kw: { referenced: false, serves: false, files: [] },
        vectors: [], platforms: {},
      };
      byUri.set(rec.typeUri, t);
    }
    t.sources.push(source);
  }
  for (const t of byUri.values()) {
    t.sources.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.ref.localeCompare(b.ref));
    const first = t.sources[0] as SpecSource;
    t.status = first.status;
    const firstRec = g.tasks.find((x) => x.rec.typeUri === t.typeUri && x.source.ref === first.ref)?.rec;
    t.title = firstRec?.title ?? t.title;
    t.supersededBy = firstRec?.supersededBy ?? t.supersededBy;
  }

  // latest version per slug: highest on main, or highest overall when the slug is not on main
  const bySlug = new Map<string, TaskVersion[]>();
  for (const t of byUri.values()) bySlug.set(t.slug, [...(bySlug.get(t.slug) ?? []), t]);
  for (const vs of bySlug.values()) {
    const onMain = vs.filter((v) => v.sources.some((s) => s.kind === "main"));
    const pool = onMain.length > 0 ? onMain : vs;
    pool.sort((a, b) => compareVersions(b.version, a.version));
    (pool[0] as TaskVersion).latest = true;
  }

  classifyFocus([...byUri.values()]);

  const unknown: Matrix["referencedButUnknown"] = [];
  if (inp.vti) {
    for (const u of inp.vti.pinned) {
      const t = byUri.get(u);
      if (t) t.vti.pinned = true;
      else unknown.push({ source: "vti-pinned", typeUri: u });
    }
    for (const [u, surfaces] of inp.vti.served) {
      const t = byUri.get(u);
      if (t) t.vti.served = [...surfaces].sort();
      else unknown.push({ source: "vti-served", typeUri: u });
    }
    const unres = [...new Set(inp.vti.unresolved)];
    if (unres.length) limits.push(`VTI: ${unres.length} dispatcher constants could not be resolved to a Type URI by the scanner (${unres.slice(0, 8).join(", ")}${unres.length > 8 ? ", ..." : ""}); the served list is a lower bound.`);
  } else limits.push("VTI source was not read.");
  if (inp.kw) {
    for (const [u, files] of inp.kw.referenced) {
      const t = byUri.get(u);
      if (t) { t.kw.referenced = true; t.kw.files = [...files].sort().slice(0, 3); }
      else unknown.push({ source: "kw-referenced", typeUri: u });
    }
    for (const u of inp.kw.serves) {
      const t = byUri.get(u);
      if (t) t.kw.serves = true;
    }
    for (const u of inp.kw.commentOnly) {
      const t = byUri.get(u);
      if (t) t.kw.commentOnly = true;
    }
    limits.push(...inp.kw.notes);
  } else limits.push("keyring-wallet source was not read.");

  // vectors
  const refs: VectorRef[] = [];
  for (const v of inp.vectors) {
    const known = v.tasks.filter((u) => byUri.has(u));
    for (const u of known) (byUri.get(u) as TaskVersion).vectors.push(v.id);
    const ts = known.map((u) => byUri.get(u) as TaskVersion);
    refs.push({
      id: v.id, group: v.group, set: v.set, channel: v.channel, tasks: known,
      focus: vectorFocus(ts),
      maturities: [...new Set(ts.map((t) => t.status))].sort(),
      sourceKinds: [...new Set(ts.flatMap((t) => t.sources.map((s) => s.kind)))].sort(),
    });
    for (const u of v.tasks) if (!byUri.has(u)) unknown.push({ source: `vector:${v.id}`, typeUri: u });
  }

  // platforms: run records are assigned by the explicit run map, never by folder name
  const records: RunRecord[] = [];
  const ceremonyRecords: CeremonyRecord[] = [];
  for (const d of inp.runsDirs) {
    for (const r of readRunResults(d)) records.push(r);
    for (const c of readCeremonyRecords(d)) ceremonyRecords.push(c);
  }
  if (inp.runsDirs.length > 0 && inp.runMap === null) throw new Error("run records were given without a run map (--run-map, default results/platform-run-map.json)");
  const map = inp.runMap ?? { format: "tt-platform-run-map/0.1" as const, about: "", runs: [], ceremonyRows: [], notPlatform: [] };
  const perPlatform = statusesByPlatform(records, map);
  const details = detailsByPlatform(records, map);
  for (const p of PLATFORMS) {
    const st = perPlatform.get(p.id) as Map<string, string>;
    for (const t of byUri.values()) t.platforms[p.id] = taskStatus(t.vectors, st);
  }
  if (inp.runsDirs.length === 0) limits.push("No run records were given (--runs <folder>), so every platform column reads `-` or `not run`.");
  else {
    const un = unmappedFolders(records, map);
    if (un.length > 0) limits.push(`${un.length} run folder(s) hold results that the run map neither assigns to a platform nor lists as not a platform, so they are read for nothing: ${un.slice(0, 6).join(", ")}${un.length > 6 ? ", ..." : ""}.`);
  }

  // ceremony overlay: scenario run records in rows the map says had the wallet, confirmed by the record's own participants
  const scenarioTasks = new Map<string, string[]>();
  for (const sc of inp.scenarios) for (const [id, uris] of Object.entries(sc.tasksById)) scenarioTasks.set(id, uris);
  for (const w of WALLET_PLATFORMS) {
    const rows = new Set(map.ceremonyRows.filter((c) => c.platform === w).map((c) => c.row));
    const per = new Map<string, { scenarios: Set<string>; rows: Set<string>; outcomes: Record<string, number> }>();
    for (const rec of ceremonyRecords) {
      if (!rows.has(rec.row) || !rec.adapters.includes("keyring-wallet")) continue;
      for (const u of scenarioTasks.get(rec.scenario) ?? []) {
        const e = per.get(u) ?? { scenarios: new Set<string>(), rows: new Set<string>(), outcomes: {} };
        e.scenarios.add(rec.scenario);
        e.rows.add(rec.row);
        e.outcomes[rec.status] = (e.outcomes[rec.status] ?? 0) + 1;
        per.set(u, e);
      }
    }
    for (const [u, e] of per) {
      const t = byUri.get(u);
      if (t) (t.ceremony ??= {})[w] = { scenarios: [...e.scenarios].sort(), rows: [...e.rows].sort(), outcomes: e.outcomes };
    }
  }

  const covered = (u: string) => (byUri.get(u)?.vectors.length ?? 0) > 0;
  const ceremonies: CeremonyEntry[] = [];
  const byId = new Map<string, CeremonyEntry>();
  for (const { rec, source } of g.ceremonies) {
    let c = byId.get(rec.id);
    if (!c) {
      const slug = rec.id.split("@")[0] as string;
      const e2e = inp.scenarios.filter((sc) => sc.ceremonyPaths.some((cp) => cp === slug || cp.startsWith(`${slug}/`))).flatMap((sc) => sc.ids);
      c = { kind: "spec", id: rec.id, title: rec.title, sources: [], steps: rec.steps.map((s) => ({ id: s.id, type: s.type, covered: covered(s.type) })), stepsWithVectors: 0, endToEndVectors: e2e, notes: "" };
      c.stepsWithVectors = c.steps.filter((s) => s.covered).length;
      byId.set(rec.id, c);
      ceremonies.push(c);
    }
    c.sources.push(source);
  }
  for (const f of FLOWS) {
    const root = f.platform === "kw" ? inp.kwRoot : inp.vtiRoot;
    if (!root) continue;
    const { uris, missing } = urisInFiles(root, f.files, f.platform === "vti" ? inp.vti?.consts : undefined);
    const pool = [...inp.vectors.map((v) => ({ id: v.id, group: v.group })), ...inp.scenarios.flatMap((sc) => sc.ids.map((id) => ({ id, group: sc.group })))];
    const e2e = pool.filter((v) => f.e2eGroups.some((g) => v.group === g || v.group.startsWith(`${g}-`))).map((v) => v.id);
    const steps = uris.map((u, i) => ({ id: String(i + 1), type: u, covered: covered(u) }));
    ceremonies.push({
      kind: f.platform === "kw" ? "kw-flow" : "vti-flow", id: f.id, title: f.title, sources: [], steps,
      stepsWithVectors: steps.filter((s) => s.covered).length, endToEndVectors: e2e,
      notes: [f.notes, missing.length ? `files not found: ${missing.join(", ")}` : ""].filter(Boolean).join(" "),
    });
  }

  // wallet roles (decision D301)
  let roles: RoleRow[] = [];
  if (inp.kw && inp.roleRules && inp.kwRoot) {
    const kwRoot = inp.kwRoot;
    roles = deriveRoles({
      tasks: [...byUri.values()], usage: inp.kw, rules: inp.roleRules,
      fileHas: (file, symbol) => { const p = join(kwRoot, file); return existsSync(p) && readFileSync(p, "utf8").includes(symbol); },
    });
    const bySlugRole = new Map(roles.map((r) => [r.slug, r.role]));
    for (const t of byUri.values()) if (t.latest && t.focus === "focus") t.kw.role = bySlugRole.get(t.slug) ?? null;
    const missing = inp.roleRules.serves.filter((r) => !roles.some((x) => x.slug === r.slug && x.role === "serves"));
    if (missing.length) limits.push(`Role rules: the handler symbol was not found for ${missing.map((m) => m.slug).join(", ")}; those slugs fall through to the code evidence.`);
    const un = roles.filter((r) => r.role === "unclassified");
    if (un.length) limits.push(`${un.length} focus slug(s) have no role (no code evidence and no prefix rule): ${un.slice(0, 6).map((r) => r.slug).join(", ")}.`);
  } else limits.push("Wallet roles were not derived (no keyring-wallet source or no role rules were given).");
  const participation = roles.length > 0 ? buildParticipation({ tasks: [...byUri.values()], roles, vectors: refs, details, scenarioTasks }) : [];

  // VTI roles (decision D420) and the participation table (D421)
  let vtiRoles: VtiRoleRow[] = [];
  let vtiParticipation: VtiParticipationRow[] = [];
  if (inp.vtiRoleRules && inp.vtiRoleUsage) {
    vtiRoles = deriveVtiRoles({ tasks: [...byUri.values()], usage: inp.vtiRoleUsage, rules: inp.vtiRoleRules });
    const surfaces = inp.vtiRoleRules.surfaces.map((x) => x.id);
    vtiParticipation = buildVtiParticipation({ tasks: [...byUri.values()], roles: vtiRoles, surfaces, vectors: refs, details: detailsByVtiSurface(records, map), scenarioTasks });
    const un = vtiRoles.filter((r) => Object.values(r.surfaces).some((x) => x.role === "unclassified"));
    if (un.length) limits.push(`${un.length} focus slug(s) have an unclassified VTI surface (no code and no prefix rule): ${un.slice(0, 6).map((r) => r.slug).join(", ")}.`);
    limits.push(...inp.vtiRoleUsage.notes.map((n) => `VTI roles: ${n}`));
    if (inp.vtiRoleUsage.unresolved.length) limits.push(`VTI roles: ${inp.vtiRoleUsage.unresolved.length} handler registration(s) did not resolve to a Type URI (${inp.vtiRoleUsage.unresolved.slice(0, 4).join(", ")}); the served roles are a lower bound.`);
  } else limits.push("VTI roles were not derived (no VTI source or no VTI role rules were given).");

  limits.push(
    "The maturity of each task is the `status` front-matter field of its spec.md (SPEC section 5.3: draft, candidate, standard, retired, withdrawn). A value of `unspecified` means the file declares none.",
    "Branch sources list only spec files added or changed against the merge base with main; a branch that has fallen behind main shows only its own changes.",
    "KW usage is every non-test source file (comments stripped, build output under lib/ and declaration files left out) that names the Type URI as a literal, imports its generated payload module, or builds it from a string constant holding the spec base; a version named only in a comment is `commentOnly`. Direction is derived in the role table (kw-participation): the inbound registry and the handler rules give `serves`, builder code `emits`. URIs built any other way are not found.",
    "VTI `pinned` comes from the trust-tasks.lock files; `served` from the dispatcher tables the code names. A vector referencing a task is counted by the Type URIs and spec paths it names.",
    "Focus (decision D245): the target is the latest version of each slug; a slug whose latest is retired is out of the target and its `supersededBy` successor is the target instead. Versions below the latest are `older` (non-focus): kept, runnable, never in a headline count. A platform skip of an older version is reach class `scope`, not `platform`.",
    "Run records are assigned to a platform by the explicit run map (results/platform-run-map.json), never by folder name. Platform columns replay every mapped run (several dates, and for keyring-wallet two checkouts): `covered` means at least one vector of the version executed in some mapped run, not that the latest run did.",
    "A task with `none` has no vector at all. `not-run` means a vector exists but no mapped run read includes it.",
    "A wallet is a client: the keyring-wallet figures against 862 slugs mix tasks it takes part in with service surfaces it cannot. The role-based figures (kwReach in matrix.json, results/coverage/kw-participation.md) use the slugs where the wallet has a role as denominator and report the rest as reach classes `not-built` and `not-involved`.",
  );
  const platformNote = (id: string): string => {
    const es = map.runs.filter((e) => e.platform === id && records.some((r) => entryOf(map, r.folder) === e));
    const folders = es.length;
    const checkouts = [...new Set(es.map((e) => e.checkout))].sort();
    return `${folders} run folders read${checkouts.length ? ` (checkouts: ${checkouts.join("; ")})` : ""}`;
  };
  const matrix: Matrix = {
    format: "dtgwg-conformance-coverage/0.1",
    generated: inp.generated,
    inputs: inp.inputs,
    statusField: "status (SPEC section 5.3, spec.meta.schema.json: draft, candidate, standard, retired, withdrawn)",
    platforms: PLATFORMS.map(({ id, label, note }) => ({ id, label, runs: [], note: `${note}; ${platformNote(id)}` })),
    tasks: [...byUri.values()].sort((a, b) => a.slug.localeCompare(b.slug) || compareVersions(a.version, b.version)),
    vectors: refs,
    ceremonies,
    focus: focusSummary([...byUri.values()], refs, PLATFORMS.map((p) => p.id)),
    limits,
    referencedButUnknown: unknown,
  };
  if (roles.length > 0) matrix.focus.kwReach = kwReachSummary(matrix.tasks, roles, [...WALLET_PLATFORMS]);
  return { matrix, roles, participation, vtiRoles, vtiParticipation };
}
