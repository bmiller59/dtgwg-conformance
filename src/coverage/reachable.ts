// SPDX-License-Identifier: Apache-2.0
// The reachable-code rule (R-01, S-01) for every set: a step that asserts a task's own response (`response`, or `answered` with `success`) must not
// FAIL a conforming implementation that answers the vector's request with one of the task's own front-matter `errorCodes`. A code is covered when the
// step accepts it (`orRefusal`, `acceptCodes`), when it is a standing code and the vector requires `optional:authorised`, or when it cannot fire for
// the request (it needs a request member the vector does not send). Otherwise the step is a finding: add the code, require `optional:authorised`, or
// make the vector weak.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRunnableVectors } from "./completeness.ts";
import { templateDocument } from "../runner/build.ts";
import { taskOfType } from "../vectors/effects.ts";
import { loadTask } from "../plain/catalog.ts";
import type { TaskFacts } from "./task-facts.ts";

type J = Record<string, unknown>;
const isObj = (x: unknown): x is J => typeof x === "object" && x !== null && !Array.isArray(x);

/** Standing codes: administrator or membership standing, or no permission at all. `optional:authorised` says the harness actors hold the standing (R-06). */
export const STANDING_CODES = /^(notAdministrator|notMember|notAMember|permissionDenied)$/;
/** Policy standing: the witness's own policy accepts the harness actors' session (`witness/session:refused`, spec.md "policy, capacity"); `optional:authorised` says it does (S-01). */
const STANDING_FULL = new Set(["witness/session:refused"]);
export const isStanding = (code: string): boolean => STANDING_CODES.test(localCode(code)) || STANDING_FULL.has(code);
export const STATE_OVERRIDES: Record<string, { reachable: boolean; why: string }> = {
  "vtc/rooms/usage:invalidRange": { reachable: true, why: "the default range (the last 30 days) may begin before the community's oldest retained day" },
  "vtc/rooms/usage:memberUsageUnavailable": { reachable: false, why: "only for grouping or filtering by member; the vector groups by room" },
  "witness/session/submit:challengeMismatch": { reachable: false, why: "the vector builds the presentation for this session's challenge and domain (a witnessPresentation trigger with variant valid)" },
  "witness/session/submit:presentationInvalid": { reachable: false, why: "the vector builds a valid presentation (variant valid); the code arises only for one the vector breaks" },
};
/** A code that needs a payload value the vector does not send (read from the code's own text). */
const NEEDS_VALUE: Record<string, { member: string; value: string }> = {
  "git-ns/namespace/bind:noBridge": { member: "mode", value: "bridge" },
};
/**
 * F3-01: codes a TEMPLATE step does not need to accept. The templates drive the hand-written ceremony and consent flows (vectors/ceremony-vrc, vectors/dtg): the harness builds the
 * precondition in the steps before (the pending consent the decision answers, the echoed challenge and digest, the configured approver) and configures the implementation to complete
 * the ceremony (capability `ceremony.proposerApproves`, `optional:ceremony`, `optional:trigger.consent`), so the code does not arise for the request; where the code is a participant's
 * own decision (`declined`, `notAccepted`) the vector asks the implementation to take the role that accepts. Each entry is a recorded limit, not a finding closed: a conforming party
 * that declines by its own policy is not covered, and the test (test/older-sets-fixes.test.ts) fails when an entry no longer matches a template step.
 */
export const TEMPLATE_EXEMPT: Record<string, string> = {
  "vrc/relationships/propose:declined": "the receiving party's own decision; the ceremony vectors configure the implementation to approve (ceremony.proposerApproves, optional:trigger.consent)",
  "vrc/relationships/issue:notAccepted": "the receiving party's decision on the delivered credential; the vectors deliver the credential the accepted proposal names (the ceremony's happy path)",
  "credential-exchange/query:consentRequired": "the holder's consent policy; CEX-025 pre-trusts the verifier (trigger.verifierTrust)",
  "credential-exchange/query:noMatch": "CEX-025 first makes the holder hold a matching credential (trigger.holdCredential)",
  "task-consent/decision:noPending": "the decision answers the request the earlier step raised (captured challenge and digest)",
  "task-consent/decision:challengeMismatch": "the decision echoes the challenge the earlier step captured",
  "task-consent/decision:notAnApprover": "the decision is signed by the approver the vector configures (trigger.consentBinding)",
  "task-consent/decision:requesterExcluded": "the approver is not the requester",
  "task-consent/decision:actionMismatch": "the decision echoes the payload digest of the pending request",
  "task-consent/decision:evidenceRequired": "the vectors that approve carry the evidence the policy names, and the others run under a policy with none",
  "task-consent/request:untrustedIssuer": "TC-012 trusts the harness issuer first",
  "task-consent/request:notEligible": "TC-012 sends from a device that belongs to the approver set",
  "task-consent/request:noSurface": "TC-012 runs against an implementation with a consent surface (optional:ceremony)",
};

export interface StateCode { code: string; line: number; reachable: boolean; why: string }
export const localCode = (c: string): string => (c.includes(":") ? c.slice(c.lastIndexOf(":") + 1) : c);

export function stateCodes(fact: TaskFacts, payloadSchema: unknown, payload: unknown): StateCode[] {
  const props = isObj(payloadSchema) && isObj(payloadSchema["properties"]) ? Object.keys(payloadSchema["properties"] as J) : [];
  const sent = new Set(isObj(payload) ? Object.keys(payload) : []);
  return fact.errorCodes.map((e) => {
    const local = localCode(e.code);
    if (isStanding(e.code)) return { code: e.code, line: e.line, reachable: false, why: "standing (administrator, membership or the witness's own policy): covered by optional:authorised" };
    const ov = STATE_OVERRIDES[e.code];
    if (ov !== undefined) return { code: e.code, line: e.line, ...ov };
    if (/^(alreadyBound|alreadyExists)$/.test(local) && JSON.stringify(payload ?? null).includes("$mint(")) return { code: e.code, line: e.line, reachable: false, why: "the identifier is minted per run ($mint), so no earlier run holds it" };
    const nv = NEEDS_VALUE[e.code];
    if (nv !== undefined && isObj(payload) && payload[nv.member] !== nv.value) return { code: e.code, line: e.line, reachable: false, why: `needs \`${nv.member}\` = \`${nv.value}\`, which the vector does not send` };
    const mentioned = [...e.meaning.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((m) => m[1]!).filter((x) => props.includes(x));
    if (mentioned.length > 0 && mentioned.every((x) => !sent.has(x))) return { code: e.code, line: e.line, reachable: false, why: `needs request member ${mentioned.map((x) => `\`${x}\``).join(", ")}, which the vector does not send` };
    if (/cursor/i.test(local) && !sent.has("cursor")) return { code: e.code, line: e.line, reachable: false, why: "a cursor code, and the vector sends no cursor" };
    return { code: e.code, line: e.line, reachable: true, why: "the specification lets a conforming implementation return it for a valid request, depending on state" };
  });
}

export function loadTaskFacts(root: string): Map<string, TaskFacts> {
  const j = JSON.parse(readFileSync(join(root, "vectors-src", "complete", "task-facts.json"), "utf8")) as { tasks: TaskFacts[] };
  return new Map(j.tasks.map((t) => [t.typeUri, t]));
}

export interface ReachFinding { set: string; id: string; step: number; task: string; code: string; line: number; standing: boolean }

/** The codes (full and local names) a step accepts besides the task's own response. */
export function acceptedBy(expect: J): Set<string> {
  const out = new Set<string>();
  for (const k of ["orRefusal", "acceptCodes"]) for (const c of Array.isArray(expect[k]) ? (expect[k] as string[]) : []) { out.add(c); out.add(localCode(c)); }
  return out;
}

/**
 * The document a step sends: its literal `document`, or the one its `template` builds (F3-01) with the step's `params` laid over it. A `mutate` list is NOT applied: it can only
 * change members, so the audit reads the template's own payload (a mutate that adds a member a code needs would make that code reachable; the audit over-approximates by
 * treating every code its mention filter cannot rule out as reachable, which is the safe side). Limit tested in test/older-sets-fixes.test.ts.
 */
export function stepDocument(step: J): J | undefined {
  const send = isObj(step["send"]) ? step["send"] : undefined;
  if (send === undefined) return undefined;
  if (isObj(send["document"])) return send["document"];
  if (typeof send["template"] !== "string") return undefined;
  const t = templateDocument(send["template"]);
  return t === undefined ? undefined : { ...t, ...(isObj(send["params"]) ? send["params"] : {}) };
}

export function auditStep(step: J, requires: string[], facts: Map<string, TaskFacts>, opts: { exempt?: Record<string, string> } = {}): { task: string; code: string; line: number; standing: boolean }[] {
  const exempt = opts.exempt ?? TEMPLATE_EXEMPT;
  const sendOf = isObj(step["send"]) ? step["send"] : undefined;
  const templated = sendOf !== undefined && typeof sendOf["template"] === "string" && !isObj(sendOf["document"]);
  const expect = isObj(step["expect"]) ? step["expect"] : undefined;
  if (expect === undefined) return [];
  const asserts = expect["disposition"] === "response" || (expect["disposition"] === "answered" && expect["success"] === true);
  if (!asserts) return [];
  const doc = stepDocument(step);
  const task = doc === undefined ? null : taskOfType(doc["type"]);
  const fact = task === null ? undefined : facts.get(task);
  if (task === null || fact === undefined) return [];
  const accepted = acceptedBy(expect);
  const authorised = requires.includes("optional:authorised");
  const tk = loadTask(task);
  const out: { task: string; code: string; line: number; standing: boolean }[] = [];
  for (const c of stateCodes(fact, tk?.payloadSchema, doc?.["payload"])) {
    const local = localCode(c.code);
    const standing = isStanding(c.code);
    if (accepted.has(c.code) || accepted.has(local)) continue;
    if (templated && c.code in exempt) continue;
    if (standing ? authorised : !c.reachable) continue;
    // a standing code that is not reachable under optional:authorised is only a finding when the vector does not require it
    if (!standing && c.reachable === false) continue;
    out.push({ task, code: c.code, line: c.line, standing });
  }
  return out;
}

/** Every asserting step of every runnable vector in every set that a conforming implementation's own error code would FAIL. */
export function auditReachable(root: string): ReachFinding[] {
  const facts = loadTaskFacts(root);
  const out: ReachFinding[] = [];
  for (const { set, vector: v } of loadRunnableVectors(root)) {
    const requires = Array.isArray(v["requires"]) ? (v["requires"] as string[]) : [];
    const steps = (Array.isArray(v["steps"]) ? v["steps"] : []) as J[];
    steps.forEach((s, i) => { for (const f of auditStep(s, requires, facts)) out.push({ set, id: v["id"] as string, step: i + 1, ...f }); });
  }
  return out;
}

/** S-01: a vector that asserts a task's own response while a standing code of that task can fire (administrator or membership standing, a witness's own policy) requires `optional:authorised`. */
export function requireAuthorisedWhereStanding<V extends { requires?: string[]; steps: unknown[] }>(v: V, facts: Map<string, TaskFacts>): V {
  const needs = (v.steps as J[]).some((s) => auditStep(s, [], facts).some((f) => f.standing));
  if (!needs || (v.requires ?? []).includes("optional:authorised")) return v;
  return { ...v, requires: [...(v.requires ?? []), "optional:authorised"] };
}

export interface AuditCoverage { set: string; vectors: number; asserting: number; response: number; answeredSuccess: number; templated: number; audited: number; unaudited: string[] }

/**
 * What the audit looks at, per set (F3-01 to F3-03): how many runnable vectors, how many steps assert a task's own response (`response`, or `answered` with `success`), how many of those send a
 * template, and how many name a task whose front-matter codes are known (audited). A step that names a task with no facts, or a template with no task, is listed in `unaudited` by what it names.
 */
export function auditCoverage(root: string): AuditCoverage[] {
  const facts = loadTaskFacts(root);
  const by = new Map<string, AuditCoverage>();
  for (const { set, vector: v } of loadRunnableVectors(root)) {
    const c = by.get(set) ?? { set, vectors: 0, asserting: 0, response: 0, answeredSuccess: 0, templated: 0, audited: 0, unaudited: [] };
    by.set(set, c);
    c.vectors++;
    for (const s of (Array.isArray(v["steps"]) ? v["steps"] : []) as J[]) {
      const ex = isObj(s["expect"]) ? s["expect"] : undefined;
      if (ex === undefined) continue;
      const resp = ex["disposition"] === "response", ok = ex["disposition"] === "answered" && ex["success"] === true;
      if (!resp && !ok) continue;
      c.asserting++;
      if (resp) c.response++; else c.answeredSuccess++;
      const send = isObj(s["send"]) ? s["send"] : undefined;
      if (send !== undefined && typeof send["template"] === "string" && !isObj(send["document"])) c.templated++;
      const doc = stepDocument(s);
      const task = doc === undefined ? null : taskOfType(doc["type"]);
      if (task !== null && facts.has(task)) c.audited++;
      else c.unaudited.push(task ?? (send !== undefined && typeof send["template"] === "string" ? `template ${send["template"]}` : doc === undefined ? "no document" : String(doc["type"])));
    }
  }
  return [...by.values()].sort((a, b) => a.set.localeCompare(b.set));
}
