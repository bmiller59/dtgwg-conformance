// SPDX-License-Identifier: Apache-2.0
// The keyring-wallet participation table (decision D301): one row per focus slug, with the wallet's role and the evidence for it, the emit vector
// and the consumer vector for the latest version and what the runs say about them, and the ceremony overlay. Data-driven: the rows feed any
// roll-up (the number of slugs where the wallet has a role, and how many of them ran, is a count over `role` and `result`).
import { EXECUTED, type VectorSeen } from "./platforms.ts";
import { evidenceCell, reachOfRole, type RoleEvidence, type RoleRow } from "./roles.ts";
import type { CeremonyOverlay, TaskVersion, VectorRef } from "./types.ts";

export const WALLET_PLATFORMS = ["keyring-wallet"] as const;
/** Vector sets that send a document (the wallet is the producer): the rest are consumer vectors (the wallet answers a request). */
export const EMIT_SETS = new Set(["emit", "emit-more", "2l"]);

export type SlugResult = "ran-agree" | "ran-differs" | "role-skipped" | "role-not-run" | "role-no-vector" | "n/a";

export interface VecSummary {
  /** Vectors of the latest version in these sets. */
  n: number;
  /** Executed (PASS, FAIL, KNOWN-FAIL, CLARIFY) in some run. */
  ran: number;
  pass: number;
  /** Executed and not PASS. */
  differs: number;
  skipped: number;
  /** No record in any run read. */
  notRun: number;
  /** The first SKIP reason seen (the part before the colon), when every record is a skip. */
  skipReason?: string;
}

export interface ParticipationRow {
  slug: string;
  version: string;
  family: string;
  role: RoleRow["role"];
  basis: RoleRow["basis"];
  evidence: string;
  evidenceAt: RoleEvidence[];
  versionsNamed: string[];
  why?: string;
  emit: Record<string, VecSummary>;
  consumer: Record<string, VecSummary>;
  /** Scenario ids that name the latest version (any ceremony, run or not). */
  ceremonyNamed: string[];
  ceremony: Record<string, CeremonyOverlay | null>;
  result: Record<string, SlugResult>;
}

const reasonKind = (r: string | undefined): string | undefined => (r === undefined ? undefined : (r.split(":")[0] as string).trim());

export function summarise(ids: string[], seen: Map<string, VectorSeen>): VecSummary {
  const s: VecSummary = { n: ids.length, ran: 0, pass: 0, differs: 0, skipped: 0, notRun: 0 };
  let reason: string | undefined;
  for (const id of ids) {
    const v = seen.get(id);
    if (v === undefined) s.notRun++;
    else if (EXECUTED.has(v.status)) {
      s.ran++;
      if (v.status === "PASS") s.pass++;
      else s.differs++;
    } else {
      s.skipped++;
      reason ??= reasonKind(v.skipReason);
    }
  }
  if (s.ran === 0 && s.skipped > 0 && reason !== undefined) s.skipReason = reason;
  return s;
}

export function resultOf(role: RoleRow["role"], emit: VecSummary, consumer: VecSummary): SlugResult {
  const ran = emit.ran + consumer.ran;
  if (ran > 0) return emit.differs + consumer.differs > 0 ? "ran-differs" : "ran-agree";
  if (role === "unclassified" || reachOfRole(role) !== "role") return "n/a";
  const n = emit.n + consumer.n;
  if (n === 0) return "role-no-vector";
  return emit.skipped + consumer.skipped > 0 ? "role-skipped" : "role-not-run";
}

export function buildParticipation(input: {
  tasks: TaskVersion[];
  roles: RoleRow[];
  vectors: VectorRef[];
  details: Map<string, Map<string, VectorSeen>>;
  scenarioTasks: Map<string, string[]>;
}): ParticipationRow[] {
  const latest = new Map<string, TaskVersion>();
  for (const t of input.tasks) if (t.latest && t.focus === "focus") latest.set(t.slug, t);
  const setOf = new Map(input.vectors.map((v) => [v.id, v.set]));
  const named = new Map<string, string[]>();
  for (const [sc, uris] of input.scenarioTasks) for (const u of uris) named.set(u, [...(named.get(u) ?? []), sc]);
  const rows: ParticipationRow[] = [];
  for (const r of input.roles) {
    const t = latest.get(r.slug);
    if (t === undefined) continue;
    const emitIds = t.vectors.filter((v) => EMIT_SETS.has(setOf.get(v) ?? ""));
    const consIds = t.vectors.filter((v) => !EMIT_SETS.has(setOf.get(v) ?? ""));
    const row: ParticipationRow = {
      slug: r.slug, version: r.version, family: r.family, role: r.role, basis: r.basis, evidence: evidenceCell(r), evidenceAt: r.evidence, versionsNamed: r.versionsNamed,
      ...(r.why !== undefined ? { why: r.why } : {}),
      emit: {}, consumer: {}, ceremonyNamed: [...new Set(named.get(t.typeUri) ?? [])].sort(), ceremony: {}, result: {},
    };
    for (const p of WALLET_PLATFORMS) {
      const seen = input.details.get(p) ?? new Map<string, VectorSeen>();
      row.emit[p] = summarise(emitIds, seen);
      row.consumer[p] = summarise(consIds, seen);
      row.ceremony[p] = t.ceremony?.[p] ?? null;
      row.result[p] = resultOf(r.role, row.emit[p] as VecSummary, row.consumer[p] as VecSummary);
    }
    rows.push(row);
  }
  return rows;
}

const cell = (s: string): string => s.replace(/\|/g, "\\|");
const vec = (v: VecSummary): string => {
  if (v.n === 0) return "none";
  if (v.ran > 0) return `${v.ran} of ${v.n} ran${v.differs > 0 ? `, ${v.differs} differ` : ", all pass"}`;
  if (v.skipped > 0) return `${v.n}: skipped${v.skipReason ? ` (${v.skipReason})` : ""}`;
  return `${v.n}: not run`;
};
const cer = (c: CeremonyOverlay | null, named: string[]): string => (c === null ? (named.length > 0 ? `named in ${named.length}, not run with the wallet` : "-") : `${c.scenarios.length} scenario(s) in ${c.rows.join(", ")}`);

/** Counts of the table for the headline: slugs with a role, how many ran, by result and by role. */
export function participationCounts(rows: ParticipationRow[], platform: string): { withRole: number; ran: number; byResult: Record<string, number>; byRole: Record<string, { n: number; ran: number }> } {
  const byResult: Record<string, number> = {};
  const byRole: Record<string, { n: number; ran: number }> = {};
  let withRole = 0;
  let ran = 0;
  for (const r of rows) {
    const res = (r.result[platform] ?? "n/a") as string;
    byResult[res] = (byResult[res] ?? 0) + 1;
    const b = (byRole[r.role] ??= { n: 0, ran: 0 });
    b.n++;
    if (res.startsWith("ran-")) b.ran++;
    if (r.role !== "unclassified" && reachOfRole(r.role) === "role") {
      withRole++;
      if (res.startsWith("ran-")) ran++;
    }
  }
  return { withRole, ran, byResult, byRole };
}

export function renderParticipation(rows: ParticipationRow[], meta: { inputs: Record<string, string>; generated: string; runInfo: Record<string, string> }): string {
  const L: string[] = [];
  L.push("# keyring-wallet participation: what the wallet does with each target task", "");
  L.push("> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. Nothing here has been filed with or sent to any project.", "");
  L.push("Generated by `npm run coverage-matrix` from the keyring-wallet source, the vectors and the run records (decision D301; machine-readable copy: [kw-participation.json](kw-participation.json), roles and evidence: [kw-roles.json](kw-roles.json)). One row per focus slug (the latest non-retired version of each task). Inputs: " + Object.entries(meta.inputs).map(([k, v]) => `${k} \`${v}\``).join("; ") + ".", "");
  L.push("## How to read it", "");
  L.push("A wallet is a client, so most of the 862 target slugs are not its business. The role says what the wallet does with the slug: `serves` (it answers or receives the task: inbound registry or handler), `emits` (it builds and sends it), `older-version` (it sends or serves only a lower version), `names-only` (the source names it in a rule list or a comment, with no builder or handler). The other three roles have no code in the wallet and are judgement by prefix rule, stated per rule in `results/coverage/kw-role-rules.json`: `wallet-relevant-not-named` (a client or member-facing family the wallet does not name), `client-capable-not-built` (a VTA-facing family a wallet could call) and `not-involved` (a service, operator or infrastructure surface, no wallet role by design). Reach classes: `not-built` covers `wallet-relevant-not-named` and `client-capable-not-built`, `not-involved` covers `not-involved`; both sit beside `platform` (a skip at the latest version) and `scope` (a skip of an older version). A role-level figure uses only the four roles with code as its denominator; the 862 is the target universe, shown with its split.", "");
  L.push("The emit vector is a vector of sets `emit`, `emit-more` or `2l` for the latest version (the wallet is the producer); the consumer vector is any other set (the wallet answers). `ran` means the vector was executed (PASS, FAIL, KNOWN-FAIL or CLARIFY) in at least one run read for that platform; `differs` counts executed results that are not PASS. The ceremony column is an overlay: ceremony scenarios that name the version and have a run record with the wallet as a participant (an upper bound: a scenario naming a task is not proof the wallet played that step). Ceremony outcomes are never conformance counts. Result: `ran-agree` (executed, all PASS), `ran-differs` (executed, at least one not PASS), `role-skipped` (the wallet has a role, every record is a SKIP), `role-not-run` (a role, vectors exist, no record), `role-no-vector` (a role, no vector exists), `n/a` (no wallet role and nothing ran).", "");
  L.push("Runs read: " + Object.entries(meta.runInfo).map(([k, v]) => `${k}: ${v}`).join("; ") + ".", "");
  for (const p of WALLET_PLATFORMS) {
    const c = participationCounts(rows, p);
    L.push(`## Roles and results: keyring-wallet`, "");
    L.push(`${c.ran} of ${c.withRole} slugs where the wallet has a role ran (at least one vector executed), ${rows.filter((r) => (r.ceremony[p] ?? null) !== null).length} slugs appear in a ceremony row run with the wallet.`, "");
    L.push("| Role | Slugs | Ran | Role skipped | Role not run | No vector | Differs |", "|---|---|---|---|---|---|---|");
    const roles = [...new Set(rows.map((r) => r.role))];
    for (const role of roles) {
      const rs = rows.filter((r) => r.role === role);
      const n = (res: SlugResultLike) => rs.filter((r) => r.result[p] === res).length;
      L.push(`| ${role} | ${rs.length} | ${n("ran-agree") + n("ran-differs")} | ${n("role-skipped")} | ${n("role-not-run")} | ${n("role-no-vector")} | ${n("ran-differs")} |`);
    }
    L.push("");
  }
  L.push("## Slugs where the wallet has a role", "");
  const head = ["Slug", "Version", "Role", "Evidence", "Emit vector", "Consumer vector", "Ceremony", "Result"];
  L.push(`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`);
  const U = "keyring-wallet";
  for (const r of rows.filter((x) => x.role !== "unclassified" && reachOfRole(x.role) === "role")) {
    L.push(`| ${cell(`\`${r.slug}\``)} | ${r.version} | ${r.role} | ${cell(r.evidence)} | ${vec(r.emit[U] as VecSummary)} | ${vec(r.consumer[U] as VecSummary)} | ${cer(r.ceremony[U] ?? null, r.ceremonyNamed)} | ${r.result[U]} |`);
  }
  L.push("");
  L.push("## Slugs where the wallet has no role in code", "", "Grouped by family; the reason is the prefix rule's. Where a vector of such a slug ran anyway, the result column of the data file says so (`ran-agree`).", "");
  L.push("| Family | Role | Slugs | Ran anyway (upstream) |", "|---|---|---|---|");
  const grp = new Map<string, ParticipationRow[]>();
  for (const r of rows.filter((x) => x.role === "unclassified" || reachOfRole(x.role) !== "role")) grp.set(`${r.family}|${r.role}`, [...(grp.get(`${r.family}|${r.role}`) ?? []), r]);
  for (const [k, rs] of [...grp].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [fam, role] = k.split("|") as [string, string];
    L.push(`| \`${fam}\` | ${role} | ${rs.length} | ${rs.filter((r) => String(r.result[U]).startsWith("ran-")).length} |`);
  }
  L.push("");
  return L.join("\n");
}
type SlugResultLike = SlugResult;
