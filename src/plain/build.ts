// SPDX-License-Identifier: Apache-2.0
// The mechanics vectors of one plain task version (payload schema, declared policy, issuedAt, a valid request answered), shared by
// scripts/generate-plain.ts and scripts/generate-gap.ts. Every rule is read from the task's schemas and declared policy (the pinned
// @openvtc/trust-tasks package, or for a version newer than the package the gap snapshot) plus the framework SPEC.md 7.2 consumer
// pipeline. No role, role meaning or authority rule is fixed here (docs/02 section 5): a role value is the token $role(n).
import { badResponsePayload, type PlainTask } from "./catalog.ts";
import { resolveRef } from "./schema.ts";
import type { Step, Vector } from "../vectors/types.ts";
import { REFUSAL_CODES, REFUSAL_NOTE } from "../coverage/build.ts";
import { standingCodes } from "../coverage/standing.ts";

export const RATIONALE_GOV = "Governance is the deployment's choice, never the suite's (docs/02 section 5): this vector fixes no role name, role meaning or authority rule; a role value is taken from the adapter's declared governance.roles.";

export type J = Record<string, unknown>;
export const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);

/** Replace role-valued members by `$role(n)` tokens; returns whether any was replaced. */
export function tokenizeRoles(v: unknown, used: { n: boolean }): unknown {
  if (Array.isArray(v)) return v.map((x) => tokenizeRoles(x, used));
  if (!isObj(v)) return v;
  const o: J = {};
  for (const [k, x] of Object.entries(v)) {
    if ((k === "role" || k === "fromRole") && typeof x === "string") { o[k] = "$role(0)"; used.n = true; }
    else if (k === "toRole" && typeof x === "string") { o[k] = "$role(1)"; used.n = true; }
    // O-17: only a string entry is a role value; an entry that is an object (vtn/memberships/join `roles[0]`) keeps its shape and has its own role members tokenised
    else if (k === "roles" && Array.isArray(x)) { o[k] = x.map((i) => (typeof i === "string" ? (used.n = true, "$role(0)") : tokenizeRoles(i, used))); }
    else o[k] = tokenizeRoles(x, used);
  }
  return o;
}

export function simpleType(root: J, s: unknown): string | undefined {
  if (!isObj(s)) return undefined;
  const t = typeof s["$ref"] === "string" ? resolveRef(root, s["$ref"]) : s;
  return isObj(t) && typeof t["type"] === "string" ? t["type"] : undefined;
}
export const WRONG: Record<string, unknown> = { string: 5, object: "x", array: "x", boolean: "x", integer: "x", number: "x" };

function citePolicy(t: PlainTask, what: string, PKG: string): string[] {
  return [`${what}: ${t.typeUri} (${PKG}), SPEC policy isProofRequired=${t.requestPolicy.isProofRequired}, isRecipientRequired=${t.requestPolicy.isRecipientRequired}, isIssuedAtRequired=${t.requestPolicy.isIssuedAtRequired}`];
}

export function build(t: PlainTask, PKG: string, tokenize: (v: unknown, used: { n: boolean }) => unknown = tokenizeRoles): Vector[] {
  const used = { n: false };
  const payload = tokenize(t.validPayload, used) as J;
  const content = t.slug.startsWith("policy/upsert");
  const requires = [t.typeUri, ...(used.n ? ["optional:governance.roles"] : []), ...(content ? ["optional:governance.content"] : [])];
  const gov = used.n || content ? [RATIONALE_GOV] : [];
  const doc = (n: string, over: J = {}, pl: J = payload): J => ({ id: `$id(${n})`, type: t.typeUri, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s", payload: pl, ...over });
  const refuse = (n: string, document: J, code: string | string[], sign?: null): Step => ({ send: { document, ...(sign === null ? { sign: null } : {}) }, expect: { disposition: "error", code, noSideEffect: true } });
  const base = (id: string): { id: string } => ({ id });
  void base;
  const out: { title: string; tier: 1; spec: string[]; clarify: string | null; steps: Step[]; mutants: string[]; rest?: Partial<Vector> }[] = [];
  // the reference adapter serves a task only when the generator can build both its request and its response; a vector for another task names no mutant (nothing to mutate)
  const served = t.responseSchema === undefined || t.validResponse !== undefined;
  const root = t.payloadSchema as J;
  const label = `${t.slug} ${t.version}`;

  // O-02: the task's own standing codes are refusals a consumer may give before it reads the payload (src/coverage/standing.ts)
  const codesFor = (pl: unknown): string[] => [...REFUSAL_CODES, ...standingCodes(t.typeUri, t.payloadSchema, pl)];
  // P: payload schema
  const pSteps: Step[] = [];
  const pMut = new Set<string>();
  const req0 = Array.isArray(root["required"]) ? (root["required"] as string[])[0] : undefined;
  if (req0 !== undefined && isObj(payload)) {
    const { [req0]: _x, ...rest } = payload;
    pSteps.push(refuse("p1", doc("p1", {}, rest), codesFor(rest)));
    pMut.add("noPayloadValidation");
  }
  if (root["additionalProperties"] === false) {
    pSteps.push(refuse("p2", doc("p2", {}, { ...payload, conformanceUnknownMember: true }), codesFor(payload)));
    pMut.add("openPayload");
  }
  const props = isObj(root["properties"]) ? root["properties"] : {};
  const wrongKey = Object.keys(payload).find((k) => k in props && WRONG[simpleType(root, props[k]) ?? ""] !== undefined && !(typeof payload[k] === "string" && String(payload[k]).startsWith("$role")));
  if (wrongKey !== undefined) {
    pSteps.push(refuse("p3", doc("p3", {}, { ...payload, [wrongKey]: WRONG[simpleType(root, props[wrongKey])!] }), codesFor(payload)));
    pMut.add("noPayloadValidation");
  }
  if (pSteps.length > 0) {
    out.push({ title: `${label}: the payload is validated against the task's payload schema (${[req0 !== undefined ? `missing required member ${req0}` : "", root["additionalProperties"] === false ? "unknown member in a closed payload" : "", wrongKey !== undefined ? `wrong type for ${wrongKey}` : ""].filter((x) => x !== "").join("; ")})`, tier: 1,
      spec: ["SPEC.md:1012 (7.2 item 2: validate the payload against the schema of the type; framework SPEC.md status draft, dtgwg-trust-tasks-spec e392d70, spec/body.md:758)", `payload schema of ${t.typeUri} (${PKG}): required ${JSON.stringify(root["required"] ?? [])}, additionalProperties ${JSON.stringify(root["additionalProperties"])}`, REFUSAL_NOTE, ...gov],
      clarify: null, steps: pSteps, mutants: [...pMut] });
  }

  // E: declared policy
  const eSteps: Step[] = [];
  const eMut = new Set<string>();
  if (t.requestPolicy.isRecipientRequired) {
    const { recipient: _r, ...noRecipient } = doc("e1");
    eSteps.push(refuse("e1", noRecipient, "malformedRequest"));
    eMut.add("recipientOptional");
  }
  if (t.requestPolicy.isProofRequired) {
    eSteps.push(refuse("e2", doc("e2"), "proofRequired", null));
    eMut.add("proofOptional");
  }
  if (eSteps.length > 0) {
    out.push({ title: `${label}: the policy the specification declares is enforced (${[t.requestPolicy.isRecipientRequired ? "recipient REQUIRED" : "", t.requestPolicy.isProofRequired ? "proof REQUIRED" : ""].filter((x) => x !== "").join(", ")})`, tier: 1,
      spec: ["SPEC.md:1015 (7.2 item 5: a document lacking an in-band recipient the specification declares REQUIRED is rejected with malformedRequest; spec/body.md:761)", "SPEC.md:1017 (7.2 item 7: proof declared REQUIRED and absent is rejected with proofRequired; spec/body.md:763)", ...citePolicy(t, "declared policy", PKG), ...gov],
      clarify: null, steps: eSteps, mutants: [...eMut] });
  }

  // I: issuedAt required
  if (t.requestPolicy.isIssuedAtRequired) {
    const { issuedAt: _i, ...noIssuedAt } = doc("i1");
    out.push({ title: `${label}: a request without issuedAt is not executed (issuedAt REQUIRED by the specification)`, tier: 1,
      spec: ["SPEC.md:1137 (7.3 item 17: a consequential task's specification MUST require issuedAt; spec/body.md:864)", ...citePolicy(t, "declared policy", PKG), ...gov],
      clarify: "The text makes issuedAt a MUST of the specification but no consumer rule names the rejection or its code (inference: the pinned runtime enforceSpecPolicy rejects with malformedRequest). Any refusal or silence with no side effect is accepted. Not gating.",
      steps: [{ send: { document: noIssuedAt }, expect: { disposition: "any-refusal", noSideEffect: true } }], mutants: ["noFreshnessWindow"] });
  }

  // A: a valid request is answered conformingly (omitted where the generator cannot build a conforming response for the reference to give)
  if (!served) return out.map(finish);
  const bad = badResponsePayload(t) !== undefined;
  out.push({ title: `${label}: a schema-valid, signed, addressed request is not refused for an envelope reason, and any response conforms to the response schema`, tier: 1,
    spec: ["SPEC.md:1011-1023 (7.2 consumer rules 1-13: none of the rejection grounds applies to this request, so a refusal must not carry their codes, section 8.3)", "SPEC.md 4.4.1 (the reply dispositions) and 7.1 item 3 (a response payload validates against the schema of its type)", "SPEC.md:246, :1069 (a consumer MAY require its own ext namespace and then rejects a document lacking it with malformedRequest) and SPEC.md:388 (MAY reject a non-canonical VID-typed member with malformedRequest): where the payload schema admits ext, a malformedRequest here is recorded as a note and is not escalated on the attested profile", `payload and response schemas of ${t.typeUri} (${PKG})`, ...(t.responseSchema === undefined ? ["the version declares no response variant: silence is accepted"] : [`response type ${t.responseTypeUri}`]), "Mechanics only: this vector does not assert that the request is authorised or what it does (that is the deployment's governance)", ...gov],
    clarify: null, steps: [{ send: { document: doc("a1") }, expect: { disposition: "answered", plainType: t.typeUri } }], mutants: bad ? ["plainBadResponse"] : [] });

  return out.map(finish);
  function finish(o: (typeof out)[number]): Vector {
    return ({ id: "", title: o.title, tier: 1, spec: o.spec, clarify: o.clarify, requires, mutants: o.mutants, steps: o.steps }) as unknown as Vector;
  }
}

