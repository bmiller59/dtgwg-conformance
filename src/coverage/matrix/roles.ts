// SPDX-License-Identifier: Apache-2.0
// The wallet's role per task slug, derived from evidence (decision D301). A slug the wallet's source names gets its role from where and how it is
// named (registry or handler: serves; builder code: emits; only a lower version: older-version; only a rule list or a comment: names-only).
// A slug the source does not name gets its role from a prefix rule with a stated reason (results/coverage/kw-role-rules.json): the rules are
// judgement and say so; the evidence for the named slugs is code. Pure functions: nothing here reads a checkout (callers pass what they read).
import type { KwUsage } from "./kw.ts";
import type { TaskVersion } from "./types.ts";


export const KW_ROLES = ["serves", "emits", "older-version", "names-only", "wallet-relevant-not-named", "client-capable-not-built", "not-involved"] as const;
export type KwRole = (typeof KW_ROLES)[number];
/** Roles in which the wallet takes part in the task (the denominator of a role-level figure). */
export const WITH_ROLE: ReadonlySet<KwRole> = new Set<KwRole>(["serves", "emits", "older-version", "names-only"]);
/** The reach class a role stands for beside `platform` and `scope`: `not-built` (a family the wallet could use and does not) and `not-involved` (no wallet role by design). */
export type RoleReach = "role" | "not-built" | "not-involved";
export const reachOfRole = (r: KwRole): RoleReach => (WITH_ROLE.has(r) ? "role" : r === "not-involved" ? "not-involved" : "not-built");

export interface RoleRule {
  /** A slug prefix ending in `/`, or an exact slug (no trailing `/`); the longest match wins. */
  match: string;
  role: "wallet-relevant-not-named" | "client-capable-not-built" | "not-involved";
  why: string;
}
export interface ServesRule {
  slug: string;
  /** Source file (relative to the checkout) holding the inbound handler, and a symbol that must appear in it. */
  file: string;
  symbol: string;
}
export interface RoleRules {
  format: "tt-kw-role-rules/0.1";
  about: string;
  serves: ServesRule[];
  /** File base names that only list tasks (approval rules, trusted approvers): a version named only there is `names-only`. */
  namesOnlyFiles: string[];
  unnamed: RoleRule[];
}

export interface RoleEvidence {
  file: string;
  line: number;
  kind: "code" | "comment" | "handler" | "registry";
  note?: string;
}

export interface RoleRow {
  slug: string;
  /** The latest (focus) version. */
  version: string;
  family: string;
  role: KwRole | "unclassified";
  /** Where the evidence comes from: `code` (a named version), `handler`, `registry`, `rule` (a prefix rule, judgement). */
  basis: "code" | "handler" | "registry" | "comment" | "rule" | "none";
  evidence: RoleEvidence[];
  /** Versions of the slug the source names as code. */
  versionsNamed: string[];
  /** For a rule-based role: the reason the rule gives. */
  why?: string;
}

const base = (f: string): string => f.slice(f.lastIndexOf("/") + 1);
const short = (u: string): string => u.replace("https://trusttasks.org/spec/", "");

export function ruleFor(rules: RoleRule[], slug: string): RoleRule | undefined {
  let best: RoleRule | undefined;
  for (const r of rules) {
    const hit = r.match.endsWith("/") ? slug.startsWith(r.match) : slug === r.match;
    if (hit && (best === undefined || r.match.length > best.match.length)) best = r;
  }
  return best;
}

export interface RoleInput {
  tasks: TaskVersion[];
  usage: KwUsage;
  rules: RoleRules;
  /** True when `symbol` appears in `file` of the checkout (evidence for a handler rule). */
  fileHas: (file: string, symbol: string) => boolean;
}

export function deriveRoles(inp: RoleInput): RoleRow[] {
  const { usage, rules } = inp;
  const bySlug = new Map<string, TaskVersion[]>();
  for (const t of inp.tasks) bySlug.set(t.slug, [...(bySlug.get(t.slug) ?? []), t]);
  const out: RoleRow[] = [];
  for (const [slug, vs] of [...bySlug].sort((a, b) => a[0].localeCompare(b[0]))) {
    const latest = vs.find((v) => v.latest);
    if (latest === undefined || latest.focus !== "focus") continue;
    const named = vs.filter((v) => usage.referenced.has(v.typeUri));
    const namedLatest = usage.referenced.has(latest.typeUri);
    const codeEvidence = (v: TaskVersion): RoleEvidence[] => (usage.evidence.get(v.typeUri) ?? []).filter((e) => e.kind === "code").map((e) => ({ ...e }));
    const row: RoleRow = { slug, version: latest.version, family: latest.family, role: "unclassified", basis: "none", evidence: [], versionsNamed: named.map((v) => v.version).sort() };
    const handler = rules.serves.find((s) => s.slug === slug);
    const listOnly = (v: TaskVersion): boolean => [...(usage.referenced.get(v.typeUri) ?? [])].every((f) => rules.namesOnlyFiles.includes(base(f)));
    if (usage.serves.has(latest.typeUri)) {
      row.role = "serves";
      row.basis = "registry";
      row.evidence = [...(usage.evidence.get(latest.typeUri) ?? []).filter((e) => base(e.file) === "ceremony.ts").map((e): RoleEvidence => ({ file: e.file, line: e.line, kind: "registry" as const, note: "trustTaskRegistry.register" })), ...codeEvidence(latest)].slice(0, 4);
    } else if (handler !== undefined && inp.fileHas(handler.file, handler.symbol)) {
      row.role = "serves";
      row.basis = "handler";
      row.evidence = [{ file: handler.file, line: 0, kind: "handler" as const, note: handler.symbol }, ...codeEvidence(latest)].slice(0, 4);
    } else if (namedLatest) {
      row.role = listOnly(latest) ? "names-only" : "emits";
      row.basis = "code";
      row.evidence = codeEvidence(latest).slice(0, 4);
      if (row.role === "names-only") row.why = "named only in approval-rule or trusted-approver lists, no builder or handler";
    } else if (named.length > 0) {
      const older = named.filter((v) => !listOnly(v));
      row.role = older.length > 0 ? "older-version" : "names-only";
      row.basis = "code";
      row.evidence = named.flatMap(codeEvidence).slice(0, 4);
    } else if (vs.some((v) => usage.commentOnly.has(v.typeUri))) {
      row.role = "names-only";
      row.basis = "comment";
      row.evidence = vs.flatMap((v) => (usage.evidence.get(v.typeUri) ?? []).filter((e) => e.kind === "comment")).slice(0, 4);
      row.why = "named only in a comment";
    } else {
      const rule = ruleFor(rules.unnamed, slug);
      if (rule !== undefined) {
        row.role = rule.role;
        row.basis = "rule";
        row.why = rule.why;
      }
    }
    out.push(row);
  }
  return out;
}

export const evidenceCell = (r: RoleRow): string => {
  const e = r.evidence[0];
  if (e === undefined) return r.basis === "rule" ? "rule (judgement)" : "-";
  const where = e.line > 0 ? `${e.file}:${e.line}` : e.file;
  return e.kind === "handler" ? `${where} (${e.note ?? "handler"})` : e.kind === "comment" ? `${where} (comment)` : e.kind === "registry" ? `${where} (registry)` : where;
};

export interface RoleCounts {
  total: number;
  roles: Record<KwRole | "unclassified", number>;
  withRole: number;
}

export function countRoles(rows: RoleRow[]): RoleCounts {
  const roles = Object.fromEntries([...KW_ROLES, "unclassified"].map((r) => [r, 0])) as RoleCounts["roles"];
  for (const r of rows) roles[r.role]++;
  return { total: rows.length, roles, withRole: KW_ROLES.filter((r) => WITH_ROLE.has(r)).reduce((n, r) => n + roles[r], 0) };
}

/** Short Type URI form for tables. */
export const shortUri = short;
