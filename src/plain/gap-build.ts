// SPDX-License-Identifier: Apache-2.0
// The vectors of one gap task version: the shared mechanics vectors (build.ts) plus, derived from the specification itself, a negative for
// every required member, one for each constraint the payload schema states, the specification's own invalid payload examples, and its
// own valid request examples. Every negative is checked against the payload schema before it is written (negatives.ts, gap.ts).
import { build, isObj, RATIONALE_GOV, tokenizeRoles, type J } from "./build.ts";
import { validate } from "./schema.ts";
import type { GapTask } from "./gap.ts";
import { REFUSAL_CODES } from "../coverage/build.ts";
import { standingCodes } from "../coverage/standing.ts";
import { constraintViolations, hasRoleMember, missingRequired } from "./negatives.ts";
import type { Step, Vector } from "../vectors/types.ts";

/** One-line description of where a task's text comes from, cited in every vector. */
export function sourceText(g: GapTask, tfCommit: string): string {
  const s = g.snap;
  const where = s.origin === undefined ? `on main at ${tfCommit.slice(0, 9)}` : `on ${s.origin.label} (open, unmerged; ${s.origin.rev} at ${s.origin.sha.slice(0, 9)}; not on main)`;
  return `Trust Tasks specification ${s.slug} ${s.version} (status ${s.status}) ${where}; payload schema from ${g.schemaFrom === "package" ? "the pinned @openvtc/trust-tasks 0.29.0 package" : "payload.schema.json bundled by the gap snapshot (the pinned package predates this version)"}`;
}

const ROLE_TOKEN = /\$role\((\d)\)/g;
/**
 * Whether a `role`-named member of this task is an authority role the deployment names (any string the schema admits, so the vector
 * uses the token $role(n)), or a value the specification itself fixes (a key purpose, a closed enum): a closed value stays literal.
 */
export function rolesAreGovernance(root: J, valid: unknown): boolean {
  const used = { n: false };
  const tok = tokenizeRoles(valid, used);
  if (!used.n) return false;
  const sample = JSON.parse(JSON.stringify(tok).replace(ROLE_TOKEN, (_m, n: string) => (n === "0" ? "conformance-role-a" : "conformance-role-b"))) as unknown;
  return validate(root, sample).length === 0;
}

export function buildGap(g: GapTask, tfCommit: string): Vector[] {
  const t = g.task;
  const src = sourceText(g, tfCommit);
  const gov0 = rolesAreGovernance(t.payloadSchema as J, g.valid);
  const tokenize = (v: unknown, used: { n: boolean }): unknown => (gov0 ? tokenizeRoles(v, used) : v);
  const out = build(t, src, tokenize);
  const label = `${t.slug} ${t.version}`;
  const raw = (isObj(g.valid) ? g.valid : {}) as J;
  const root = t.payloadSchema as J;
  const tokenised = (p: unknown): { payload: J; roles: boolean } => {
    const used = { n: false };
    const payload = tokenize(p, used) as J;
    return { payload, roles: used.n };
  };
  // a constraint on a governance role member is the deployment's (the token stands for any role it names), so the suite does not test it
  const ROLE_KEYS = /^(role|fromRole|toRole|roles):/;
  const doc = (n: string, pl: J): J => ({ id: `$id(${n})`, type: t.typeUri, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s", payload: pl });
  const refuse = (n: string, pl: J): Step => ({ send: { document: doc(n, pl) }, expect: { disposition: "error", code: [...REFUSAL_CODES, ...standingCodes(t.typeUri, root, pl)], noSideEffect: true } });
  const answer = (n: string, pl: J): Step => ({ send: { document: doc(n, pl) }, expect: { disposition: "answered", plainType: t.typeUri } });
  const add = (title: string, spec: string[], steps: Step[], mutants: string[], roles: boolean, clarify: string | null = null): void => {
    out.push({ id: "", title, tier: 1, spec, clarify, requires: [t.typeUri, ...(roles ? ["optional:governance.roles"] : [])], mutants, steps } as unknown as Vector);
  };
  const gov = [RATIONALE_GOV];
  const order = "SPEC.md 7.2 items 2 and 10 do not order payload validation against the authorisation decision (O-03): malformedRequest, permissionDenied and the task's own standing codes (front matter errorCodes that say the caller lacks standing) are accepted; an object lookup or state code is not, so a consumer that never validates is still caught";
  const item2 = "SPEC.md:1012 (7.2 item 2: validate the payload against the schema of the type; framework SPEC.md status draft, spec/body.md:758)";

  // R: every required member
  const req = missingRequired(root, raw);
  if (req.length > 0) {
    let roles = false;
    const steps = req.map((n, i) => { const k = tokenised(n.payload); roles ||= k.roles; return refuse(`r${i + 1}`, k.payload); });
    add(`${label}: a request missing any one required payload member is refused (${req.map((n) => n.label.replace("missing required member ", "")).join(", ")})`,
      [item2, order, `payload schema of ${t.typeUri}: required ${JSON.stringify(root["required"])} (${src})`, ...(roles ? gov : [])], steps, ["noPayloadValidation"], roles);
  }

  // C: constraints
  const cons = constraintViolations(root, raw).filter((n) => !(gov0 && ROLE_KEYS.test(n.label)));
  if (cons.length > 0) {
    let roles = false;
    const steps = cons.map((n, i) => { const k = tokenised(n.payload); roles ||= k.roles; return refuse(`c${i + 1}`, k.payload); });
    add(`${label}: a payload that breaks a constraint of its schema is refused (${cons.map((n) => n.label).join("; ")})`,
      [item2, order, `payload schema constraints of ${t.typeUri} (${src})`, ...(roles ? gov : [])], steps, ["noPayloadValidation"], roles);
  }

  // I: the specification's own invalid examples
  const inv = g.invalid.filter((e) => !(gov0 && hasRoleMember(e.payload)) && isObj(e.payload));
  if (inv.length > 0) {
    const steps = inv.map((e, i) => refuse(`i${i + 1}`, e.payload as J));
    add(`${label}: the payload examples the specification lists as invalid are refused (${inv.length})`,
      [item2, order, `payload.invalid-examples.json of ${t.typeUri}: ${inv.map((e, i) => `(${i + 1}) ${e.note}`).join(" ").slice(0, 600)}`, src], steps, ["noPayloadValidation"], false);
  }

  // X: the specification's own valid request examples
  const ex = g.examples.slice(0, 3);
  if (ex.length > 0) {
    let roles = false;
    const steps = ex.map((e, i) => { const k = tokenised(e.payload); roles ||= k.roles; return answer(`x${i + 1}`, k.payload); });
    add(`${label}: the request examples in the specification are not refused for an envelope reason (${ex.length})`,
      ["SPEC.md:1011-1023 (7.2 consumer rules 1-13: none of the rejection grounds applies to this request, so a refusal must not carry their codes, section 8.3)", "SPEC.md 4.4.1 (the reply dispositions) and 7.1 item 3 (a response payload validates against the schema of its type)", `request examples in the specification of ${t.typeUri} (${src})`, "Mechanics only: this vector does not assert that the request is authorised or what it does (that is the deployment's governance)", ...(roles ? gov : [])], steps, [], roles);
  }
  return out;
}

/** The producer-class vector of a gap task: the implementation is asked to emit the document through its own builders, and the harness checks it against the payload schema and declared policy (as vectors/emit does for the plain families). */
export function buildGapEmit(g: GapTask, tfCommit: string): Vector {
  const t = g.task;
  const p = t.requestPolicy;
  const root = t.payloadSchema as J;
  const src = sourceText(g, tfCommit);
  const canMutate = g.valid !== undefined && (Array.isArray(root["required"]) ? (root["required"] as unknown[]).length > 0 : root["additionalProperties"] === false);
  const mutants = ["emitBadPayload", ...(p.isProofRequired ? ["emitNoProof"] : []), ...(p.isRecipientRequired ? ["emitNoRecipient"] : []), ...(p.isIssuedAtRequired ? ["emitNoIssuedAt"] : [])];
  return {
    id: "", title: `${t.slug} ${t.version}: the document the implementation emits for this task conforms to its payload schema and declared policy`, tier: 1,
    spec: [
      `payload schema of ${t.typeUri} (${src})`,
      `declared policy: isProofRequired=${p.isProofRequired}, isRecipientRequired=${p.isRecipientRequired}, isIssuedAtRequired=${p.isIssuedAtRequired}`,
      "SPEC.md:1015, 1017 and 1137 (7.2 items 5 and 7, 7.3 item 17: a document lacking a REQUIRED recipient, proof or issuedAt is not conforming); SPEC.md 7.2 item 8 (a proof with no recipient on a non-bearer task is malformed)",
      "Mechanics only: the suite does not check what the document asks for or whether anyone is authorised to ask (docs/02 section 5)",
    ],
    clarify: null, requires: ["optional:emit", `emit:${t.typeUri}`], ...(canMutate ? { mutants } : {}),
    steps: [{ emit: { type: t.typeUri, args: { recipient: "$X" } }, expect: { disposition: "emitted", plainType: t.typeUri } }],
  } as unknown as Vector;
}
