// SPDX-License-Identifier: Apache-2.0
// The reference adapter's governance model (docs/17). It exists so the governance probes can be validated: a platform that takes a
// declaration and honours it, and mutants that do not. It decides nothing about which governance is right: every role name, every
// authority rule and every consent value comes from the declaration the caller gives it. Without a declaration it handles nothing
// (the plain-task family keeps its canned answers).
import type { GovernanceDeclaration } from "../../adapter/contract.ts";

export const GOV_MUTANTS = {
  govIgnoreDeclaration: "applies a built-in role set (admin, member) and a built-in consent value instead of the declaration",
  govAssertDefault: "grants an unrecognised role as a built-in default role instead of refusing",
  govFixedAuthority: "applies a built-in positional authority rule instead of the declared one",
  govImpliedPrincipal: "treats a principal that holds no entry as holding the first declared role",
  govConsentOmitted: "states a consent decision without minApprovals and excludeRequester, leaving a receiver to supply values",
  govConsentFixedOne: "states a consent decision with minApprovals 1 and excludeRequester false whatever was declared",
  govListsOtherRole: "accepts a grant of a declared role but holds the entry under a built-in role",
} as const;
export type GovMutantId = keyof typeof GOV_MUTANTS;
export const isGovMutantId = (x: string): x is GovMutantId => x in GOV_MUTANTS;

export const GRANT_TYPE = "https://trusttasks.org/spec/acl/grant/0.3";
export const LIST_TYPE = "https://trusttasks.org/spec/acl/list/0.4";
export const EVALUATE_TYPE = "https://trusttasks.org/spec/policy/evaluate/0.4";
export const GOV_TYPES: readonly string[] = [GRANT_TYPE, LIST_TYPE, EVALUATE_TYPE];

export type GovOutcome =
  | { kind: "response"; payload: Record<string, unknown> }
  | { kind: "error"; code: string; message: string; details?: Record<string, unknown> };

const BUILT_IN_ROLES = ["admin", "member"];
const DEFAULT_ROLE = "member";

const entryOf = (subject: string, role: string, by?: string): Record<string, unknown> => ({
  subject, role, act: { scope: "all" }, keys: { scope: "all" }, capabilities: { scope: "ceiling" }, purposes: { scope: "any" },
  ...(by === undefined ? {} : { createdBy: by }),
});

export class GovernanceModel {
  private decl: GovernanceDeclaration | undefined;
  private entries = new Map<string, string>();
  private readonly mutants: ReadonlySet<GovMutantId>;
  constructor(mutants: ReadonlySet<GovMutantId>) {
    this.mutants = mutants;
  }

  declare(d: GovernanceDeclaration): { status: "applied" } | { status: "rejected"; reason: string } {
    if (!Array.isArray(d.roles) || d.roles.length === 0 || d.roles.some((r) => typeof r !== "string" || r === "")) return { status: "rejected", reason: "roles must be a non-empty list of names" };
    if (new Set(d.roles).size !== d.roles.length) return { status: "rejected", reason: "role names must be distinct" };
    for (const p of d.principals ?? []) if (!d.roles.includes(p.role)) return { status: "rejected", reason: `principal holds a role that is not declared: ${p.role}` };
    this.decl = d;
    this.entries = new Map();
    for (const p of d.principals ?? []) this.entries.set(p.vid, this.m("govIgnoreDeclaration") ? "admin" : p.role);
    return { status: "applied" };
  }

  reset(): void {
    this.decl = undefined;
    this.entries = new Map();
  }

  get declared(): boolean {
    return this.decl !== undefined;
  }

  private m(id: GovMutantId): boolean {
    return this.mutants.has(id);
  }

  private vocabulary(): string[] {
    return this.m("govIgnoreDeclaration") ? BUILT_IN_ROLES : this.decl!.roles;
  }

  /** Whether a holder of `from` may grant `to`, under the declared rule or (mutant) a built-in positional one. */
  private mayGrant(from: string, to: string): boolean {
    const d = this.decl!;
    if (this.m("govIgnoreDeclaration")) return from === "admin";
    if (this.m("govFixedAuthority")) return d.roles.indexOf(to) <= d.roles.indexOf(from);
    return (d.authority?.[from] ?? []).includes(to);
  }

  /** Handle one accepted task; undefined: not a governance task, or nothing declared (the carrier answers as it always did). */
  handle(type: string, issuer: string, payload: Record<string, unknown>): GovOutcome | undefined {
    if (this.decl === undefined) return undefined;
    if (type === GRANT_TYPE) return this.grant(issuer, payload);
    if (type === LIST_TYPE) return { kind: "response", payload: { entries: [...this.entries].map(([s, r]) => entryOf(s, r)) } };
    if (type === EVALUATE_TYPE) return this.evaluate(payload);
    return undefined;
  }

  private grant(issuer: string, payload: Record<string, unknown>): GovOutcome {
    const entry = (payload.entry ?? {}) as Record<string, unknown>;
    const subject = String(entry.subject);
    const role = String(entry.role);
    const vocab = this.vocabulary();
    let effective = role;
    if (!vocab.includes(role)) {
      if (!this.m("govAssertDefault")) {
        return { kind: "error", code: "acl/grant:roleNotRecognized", message: "role not recognised", details: { offendingRole: role, knownRoles: vocab } };
      }
      effective = DEFAULT_ROLE;
    }
    let granterRole = this.entries.get(issuer);
    if (granterRole === undefined && this.m("govImpliedPrincipal")) granterRole = this.decl!.roles[0];
    // a substituted default role is assigned without consulting the authority rule (the mutant's reading of "least privilege needs no authority")
    if (granterRole === undefined || (effective === role && !this.mayGrant(granterRole, effective))) {
      return { kind: "error", code: "permissionDenied", message: "not permitted" };
    }
    const held = this.m("govListsOtherRole") ? "member" : effective;
    this.entries.set(subject, held);
    return { kind: "response", payload: { entry: entryOf(subject, held, issuer) } };
  }

  private evaluate(payload: Record<string, unknown>): GovOutcome | undefined {
    const c = this.decl!.consent;
    const typeUri = ((payload.input as Record<string, unknown> | undefined)?.request as Record<string, unknown> | undefined)?.typeUri;
    if (c === undefined || typeUri !== c.task) return undefined;
    let rc: Record<string, unknown> = { approverSet: c.approverSet, minApprovals: c.minApprovals, excludeRequester: c.excludeRequester };
    if (this.m("govIgnoreDeclaration") || this.m("govConsentFixedOne")) rc = { approverSet: c.approverSet, minApprovals: 1, excludeRequester: false };
    if (this.m("govConsentOmitted")) rc = { approverSet: c.approverSet };
    return { kind: "response", payload: { decision: { decision: "requireConsent", requireConsent: rc } } };
  }
}
