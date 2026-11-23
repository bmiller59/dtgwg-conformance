// SPDX-License-Identifier: Apache-2.0
// VTI's role per task slug and surface (decision D420): what each VTI surface does with each focus slug, from its source.
// Surfaces: services (agent/VTA, community/VTC, witness, voting service) answer a task through a handler registration; client surfaces
// (client builders = SDK, CLI and community client crates; mobile core; mcp) send it through a builder or send call, or read it from a received document.
// Direction is by call role (rust-source.ts `useOf`), never by presence: a name in a list, a re-export or a constant definition is `named-only`.
// A slug with no code on a surface gets its role from a prefix rule with a stated reason (results/coverage/vti-role-rules.json); those are judgement.
// Pure functions except `scanVtiRoles`, which reads one checkout.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blockAfter } from "./vti.ts";
import { buildConstTable, constDefs, extractRefs, flatTable, lineOf, rustCode, type RefUse } from "./rust-source.ts";
import type { TaskVersion } from "./types.ts";
import { isTestPath, rel, text, walk } from "./walk.ts";

export const VTI_ROLES = ["serves", "emits", "older-version", "named-only", "not-built", "not-involved"] as const;
export type VtiRole = (typeof VTI_ROLES)[number];
/** Roles in which a surface takes part in the task (attempts). `named-only` is shown as not yet built with a flag (D408). */
export const VTI_WITH_ROLE: ReadonlySet<VtiRole> = new Set<VtiRole>(["serves", "emits", "older-version"]);

export interface SurfaceRule {
  id: string;
  label: string;
  kind: "service" | "client";
  /** Crates (top-level folders) whose non-test Rust source is read. */
  crates: string[];
  /** For a service: where its handler registrations are. `dispatch_table` and `served-const` read a block after `marker`; `on` reads every `on!(..)` in the files matching `pattern`. */
  serve?: { file?: string; pattern?: string; kind: "dispatch_table" | "served-const" | "on" | "uri-macro-table"; marker?: string }[];
}
export interface FamilyRule {
  /** A slug prefix ending in `/`, or an exact slug; the longest match wins. */
  match: string;
  /** Service surfaces that would answer the family. */
  owners: string[];
  /** Client surfaces that could send it. */
  callers: string[];
  why: string;
}
export interface VtiRoleRules {
  format: "tt-vti-role-rules/0.1";
  about: string;
  surfaces: SurfaceRule[];
  /** Files that only list tasks (the constant catalogue, retry and budget tables, the OpenAPI index): a reference there is `named-only`. */
  catalogueFiles: string[];
  families: FamilyRule[];
}

export interface VtiRef { file: string; line: number; use: RefUse; token: string }
export interface VtiUsage {
  /** Per surface: Type URI to references. */
  surfaces: Record<string, Map<string, VtiRef[]>>;
  /** Spec pins: Type URI to the lock file and line. */
  pinned: Map<string, { file: string; line: number }>;
  filesScanned: Record<string, number>;
  /** Registration entries that did not resolve to a Type URI. */
  unresolved: string[];
  notes: string[];
}

const SKIP_DIR = /(^|\/)(tests?|benches|examples|fixtures)\//;
const isProductSource = (r: string): boolean => !SKIP_DIR.test(r) && !isTestPath(r) && !/(^|\/)tests?\.rs$/.test(r) && !/_tests?\.rs$/.test(r) && !/(^|\/)(test_support|testing)\//.test(r) && !/(^|\/)test_support\.rs$/.test(r);

function window(code: string, start: number, end: number): string {
  return code.slice(0, start).replace(/[^\n]/g, " ") + code.slice(start, end) + code.slice(end).replace(/[^\n]/g, " ");
}

/** `uri!(election::register::v0_4)` (the voting service's table macro) read as the payload path it expands to. */
const expandUriMacro = (code: string): string => code.replace(/\buri!\s*\(\s*([a-z0-9_:]+)\s*\)/g, "vti_specs::voting::$1::Payload");

export function onRegistrationRefs(code: string, file: string, table: ReturnType<typeof buildConstTable>): { refs: { uri: string; line: number; token: string }[]; unresolved: string[] } {
  const refs: { uri: string; line: number; token: string }[] = [];
  const un: string[] = [];
  const all = extractRefs(code, file, table);
  const onLines = new Set<number>();
  for (const m of code.matchAll(/\bon!\s*\(\s*[A-Za-z_]\w*\s*,\s*([A-Za-z0-9_:#]+?)(?:::Payload)?\s*=>/g)) onLines.add(lineOf(code, m.index ?? 0));
  const seen = new Set<number>();
  for (const r of all) if (r.use === "dispatch") { refs.push({ uri: r.uri, line: r.line, token: r.token }); seen.add(r.line); }
  for (const l of onLines) if (!seen.has(l)) un.push(`${file}:${l}`);
  return { refs, unresolved: un };
}

/** Reads every surface of `rules` from one VTI checkout. Read-only. */
export function scanVtiRoles(root: string, rules: VtiRoleRules): VtiUsage {
  const out: VtiUsage = { surfaces: {}, pinned: new Map(), filesScanned: {}, unresolved: [], notes: [] };
  for (const f of walk(root, ["trust-tasks.lock"])) {
    if (!f.endsWith("trust-tasks.lock")) continue;
    const lines = text(f).split("\n");
    lines.forEach((l, i) => {
      const m = /type_uri\s*=\s*"([^"]+)"/.exec(l);
      if (m) { const u = (m[1] as string).replace(/#response$/, ""); if (!out.pinned.has(u)) out.pinned.set(u, { file: rel(root, f), line: i + 1 }); }
    });
  }
  // every crate any surface reads, once: stripped code per file
  const crates = [...new Set(rules.surfaces.flatMap((s) => s.crates))];
  const code = new Map<string, string>();
  for (const c of [...crates, "vti-common"]) for (const f of walk(join(root, c), [".rs"])) {
    const r = rel(root, f);
    if (!isProductSource(r)) continue;
    code.set(r, rustCode(text(f)));
  }
  let known = new Map<string, string>();
  let table = buildConstTable([]);
  for (let pass = 0; pass < 2; pass++) { // constants that name other constants resolve on the second pass
    table = buildConstTable([...code].flatMap(([r, c]) => constDefs(c, r, known)));
    known = flatTable(table);
  }
  const cat = new Set(rules.catalogueFiles);
  for (const s of rules.surfaces) {
    const m = new Map<string, VtiRef[]>();
    out.surfaces[s.id] = m;
    out.filesScanned[s.id] = 0;
    const add = (uri: string, ref: VtiRef): void => { const l = m.get(uri) ?? []; if (!l.some((x) => x.file === ref.file && x.line === ref.line && x.use === ref.use)) l.push(ref); m.set(uri, l); };
    if (s.kind === "client") {
      for (const [r, c] of code) {
        if (!s.crates.some((k) => r.startsWith(`${k}/`))) continue;
        out.filesScanned[s.id] = (out.filesScanned[s.id] ?? 0) + 1;
        for (const x of extractRefs(c, r, table, { catalogue: cat.has(r) })) if (x.use !== "definition") add(x.uri, { file: r, line: x.line, use: x.use, token: x.token });
      }
      continue;
    }
    for (const sv of s.serve ?? []) {
      const files = sv.file !== undefined ? [sv.file] : [...code.keys()].filter((r) => new RegExp(sv.pattern as string).test(r));
      for (const r of files) {
        const c0 = code.get(r);
        if (c0 === undefined) { if (sv.file !== undefined) out.notes.push(`${s.id}: ${r} not found`); continue; }
        out.filesScanned[s.id] = (out.filesScanned[s.id] ?? 0) + 1;
        const c = sv.kind === "uri-macro-table" ? expandUriMacro(c0) : c0;
        if (sv.kind === "on") {
          if (!/\bon!\s*\(/.test(c)) continue;
          const reg = onRegistrationRefs(c, r, table);
          for (const x of reg.refs) add(x.uri, { file: r, line: x.line, use: "dispatch", token: x.token });
          out.unresolved.push(...reg.unresolved.map((u) => `${s.id}:${u}`));
          continue;
        }
        const marker = new RegExp(sv.marker as string);
        const mm = marker.exec(c);
        if (mm === null) { out.notes.push(`${s.id}: marker ${sv.marker} not found in ${r}`); continue; }
        const block = blockAfter(c, marker);
        if (block === null) continue;
        const start = c.indexOf(block, mm.index);
        const w = window(c, start, start + block.length);
        for (const x of extractRefs(w, r, table, { registration: true })) if (x.use !== "definition") add(x.uri, { file: r, line: x.line, use: "dispatch", token: x.token });
      }
    }
  }
  return out;
}

export type VtiRoleBasis = "dispatch" | "code" | "pin" | "rule" | "none";

export interface SurfaceRole {
  role: VtiRole | "unclassified";
  basis: VtiRoleBasis;
  /** For a surface with code: the other direction also found (a client that both sends and reads a task). */
  also: ("serves" | "emits")[];
  evidence: { file: string; line: number; use: RefUse; token?: string }[];
  /** The rule's reason, or the flag for a named-only role. */
  why?: string;
  /** Versions of the slug this surface names in code. */
  versionsNamed: string[];
}

export interface VtiRoleRow {
  slug: string;
  /** The latest (focus) version. */
  version: string;
  family: string;
  surfaces: Record<string, SurfaceRole>;
}

export function familyRule(rules: FamilyRule[], slug: string): FamilyRule | undefined {
  let best: FamilyRule | undefined;
  for (const r of rules) {
    const hit = r.match.endsWith("/") ? slug.startsWith(r.match) || `${slug}/` === r.match : slug === r.match;
    if (hit && (best === undefined || r.match.length > best.match.length)) best = r;
  }
  return best;
}

const REAL: ReadonlySet<RefUse> = new Set<RefUse>(["dispatch", "compare", "send", "build"]);

export function deriveVtiRoles(inp: { tasks: TaskVersion[]; usage: VtiUsage; rules: VtiRoleRules }): VtiRoleRow[] {
  const { usage, rules } = inp;
  const bySlug = new Map<string, TaskVersion[]>();
  for (const t of inp.tasks) bySlug.set(t.slug, [...(bySlug.get(t.slug) ?? []), t]);
  const out: VtiRoleRow[] = [];
  for (const [slug, vs] of [...bySlug].sort((a, b) => a[0].localeCompare(b[0]))) {
    const latest = vs.find((v) => v.latest);
    if (latest === undefined || latest.focus !== "focus") continue;
    const fam = familyRule(rules.families, slug);
    const row: VtiRoleRow = { slug, version: latest.version, family: latest.family, surfaces: {} };
    for (const s of rules.surfaces) {
      const refsOf = (u: string): VtiRef[] => usage.surfaces[s.id]?.get(u) ?? [];
      const mine = refsOf(latest.typeUri);
      const real = mine.filter((r) => REAL.has(r.use));
      const named = vs.filter((v) => refsOf(v.typeUri).length > 0).map((v) => v.version).sort();
      const ev = (l: VtiRef[]): SurfaceRole["evidence"] => l.slice(0, 4).map((r) => ({ file: r.file, line: r.line, use: r.use, token: r.token }));
      const sr: SurfaceRole = { role: "unclassified", basis: "none", also: [], evidence: [], versionsNamed: named };
      const receives = real.filter((r) => r.use === "dispatch" || r.use === "compare");
      const sends = real.filter((r) => r.use === "send" || r.use === "build");
      if (s.kind === "service" ? receives.length > 0 : real.length > 0) {
        if (s.kind === "service" || (receives.length > 0 && sends.length === 0)) {
          sr.role = "serves";
          sr.basis = receives.some((r) => r.use === "dispatch") ? "dispatch" : "code";
          sr.evidence = ev(receives);
          if (sends.length > 0) sr.also = ["emits"];
        } else {
          sr.role = "emits";
          sr.basis = "code";
          sr.evidence = ev(sends);
          if (receives.length > 0) sr.also = ["serves"];
        }
      } else if (mine.length > 0) {
        sr.role = "named-only";
        sr.basis = "code";
        sr.evidence = ev(mine);
        sr.why = "named in code only (a list, a re-export or a table), no handler or builder";
      } else {
        const olderReal = vs.filter((v) => !v.latest).flatMap((v) => refsOf(v.typeUri).filter((r) => REAL.has(r.use)));
        const olderAny = vs.filter((v) => !v.latest).flatMap((v) => refsOf(v.typeUri));
        if (olderReal.length > 0) {
          sr.role = "older-version";
          sr.basis = "code";
          sr.evidence = ev(olderReal);
        } else if (olderAny.length > 0) {
          sr.role = "named-only";
          sr.basis = "code";
          sr.evidence = ev(olderAny);
          sr.why = "an older version named in code only, no handler or builder";
        } else if (fam !== undefined) {
          const involved = s.kind === "service" ? fam.owners.includes(s.id) : fam.callers.includes(s.id);
          const pin = vs.map((v) => usage.pinned.get(v.typeUri)).find((p) => p !== undefined);
          if (involved && s.kind === "service" && pin !== undefined) {
            sr.role = "named-only";
            sr.basis = "pin";
            sr.evidence = [{ file: pin.file, line: pin.line, use: "reexport" }];
            sr.why = "pinned in the spec crate (trust-tasks.lock), no handler";
          } else {
            sr.role = involved ? "not-built" : "not-involved";
            sr.basis = "rule";
            sr.why = fam.why;
          }
        }
      }
      row.surfaces[s.id] = sr;
    }
    out.push(row);
  }
  return out;
}

export const evidenceCellOf = (r: SurfaceRole): string => {
  const e = r.evidence[0];
  if (e === undefined) return r.basis === "rule" ? "rule (judgement)" : "-";
  const where = e.line > 0 ? `${e.file}:${e.line}` : e.file;
  return e.use === "dispatch" ? `${where} (handler)` : e.use === "compare" ? `${where} (read)` : e.use === "reexport" ? `${where} (named)` : `${where}${r.also.length > 0 ? ` (+ ${r.also.join(", ")})` : ""}`;
};

export interface VtiRoleCounts { total: number; bySurface: Record<string, Record<VtiRole | "unclassified", number>> }
export function countVtiRoles(rows: VtiRoleRow[], surfaces: string[]): VtiRoleCounts {
  const bySurface: VtiRoleCounts["bySurface"] = {};
  for (const s of surfaces) {
    const c = Object.fromEntries([...VTI_ROLES, "unclassified"].map((r) => [r, 0])) as Record<VtiRole | "unclassified", number>;
    for (const r of rows) c[r.surfaces[s]?.role ?? "unclassified"]++;
    bySurface[s] = c;
  }
  return { total: rows.length, bySurface };
}

/** The rules file is read through here so a missing file is one clear error. */
export function loadVtiRoleRules(path: string): VtiRoleRules {
  if (!existsSync(path)) throw new Error(`VTI role rules not found: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as VtiRoleRules;
}
