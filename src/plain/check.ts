// SPDX-License-Identifier: Apache-2.0
// Checks the plain-task family applies to documents, from the task's own specification as shipped in the pinned @openvtc/trust-tasks
// (payload schema, response schema, policy). Nothing here is a rule the package does not state; the package's `enforceSpecPolicy`
// supplies the policy semantics and error codes (SPEC.md 7.2 items 2, 5, 8; 7.3 item 17).
import { isObject } from "../util/json.ts";
import { loadTask, type PlainTask } from "./catalog.ts";
import { verifyDocumentProof } from "../crypto/proof.ts";
import { validate } from "./schema.ts";

/** Codes that name an envelope, policy or addressing problem. A valid request is never refused with one of them. */
export const ENVELOPE_CODES = ["proofRequired", "proofInvalid", "wrongRecipient", "unsupportedType", "unsupportedVersion", "identityMismatch", "expired", "idConflict"] as const;

export interface AnsweredOptions {
  /** Record a SHOULD (advisory at Tier 1, a failure under `attested`). */
  should: (m: string) => void;
  /** Record an observation the text permits (a MAY): never a failure, not escalated on the attested profile. Defaults to `should`. */
  note?: (m: string) => void;
  /**
   * Success asserted: the one reply is the task's own `#response` and validates against the response schema. Anything else (an error of
   * any code, a next-step, silence) fails. Used only where the task specification defines the response and neither authorisation nor
   * prior state decides it (the vector then requires `optional:authorised`).
   */
  success?: boolean;
  /** Envelope codes the task's own specification requires or permits at the payload level (for example idConflict, proofInvalid, unsupportedType); they are not a failure of a valid request. */
  acceptCodes?: readonly string[];
  /** Type URIs of documents that follow the answer on the same delivery (the task's event stream): the first reply is the answer, the others are noted. */
  followOn?: readonly string[];
}

/**
 * The reply to a valid, signed, in-window request of `task`. Accepts a conforming response, a next-step (a hold), an error whose code
 * is not an envelope code, and, when the task declares no response variant, silence. A `malformedRequest` for a payload the schema
 * accepts is recorded as an advisory (the schema is the specification's definition of a valid payload, but an implementation may
 * refuse content the schema cannot express).
 */
function admitsExt(task: PlainTask): boolean {
  const props = isObject(task.payloadSchema) ? task.payloadSchema["properties"] : undefined;
  return isObject(props) && "ext" in props;
}

export function answeredErrors(task: PlainTask, replies: string[], opts: AnsweredOptions): string[] {
  const errs: string[] = [];
  if (replies.length === 0) {
    if (opts.success === true) errs.push(`no answer: success is asserted for ${task.slug} ${task.version}, so its ${task.responseTypeUri} response is expected`);
    // SPEC.md 7.2 closing paragraph ("SHOULD return an error response") and section 8 ("MAY"): a consumer may decline silently, and authorisation is the deployment's (7.2 item 10), so silence is an advisory, never a failure
    else if (task.responseSchema !== undefined) (opts.note ?? opts.should)(`${task.typeUri}: no reply to a request that declares a response variant (silence is permitted: SPEC.md 7.2 closing paragraph, section 8)`);
    return errs;
  }
  if (replies.length > 1) {
    const types = replies.slice(1).map((r) => { try { const d = JSON.parse(r) as { type?: unknown }; return typeof d.type === "string" ? d.type : ""; } catch { return ""; } });
    const allowed = (opts.followOn ?? []).map((x) => (x.startsWith("https://") ? x : `https://trusttasks.org/spec/${x}`));
    if (allowed.length === 0 || !types.every((t) => allowed.includes(t))) return [`expected one answer, got ${replies.length}`];
    (opts.note ?? opts.should)(`${task.typeUri}: ${replies.length - 1} follow-on document(s) of the task's event stream after the answer (${[...new Set(types)].join(", ")}); the first reply is the answer`);
  }
  let doc: unknown;
  try {
    doc = JSON.parse(replies[0]!);
  } catch {
    return ["the answer is not JSON"];
  }
  if (!isObject(doc)) return ["the answer is not a JSON object"];
  const type = typeof doc.type === "string" ? doc.type : "";
  const errCode = type.startsWith("https://trusttasks.org/spec/trust-task-error/") && isObject(doc.payload) ? String(doc.payload.code) : "";
  // a code the vector accepts (the task's own text names it for a valid request: R-01) is honoured under `success` too, never a failure
  const accepted = (code: string): boolean => (opts.acceptCodes ?? []).some((c) => c === code || code.endsWith(`:${c}`) || c.endsWith(`:${code}`));
  if (opts.success === true && type !== task.responseTypeUri) {
    if (errCode !== "" && accepted(errCode)) { (opts.note ?? opts.should)(`${task.typeUri}: ${errCode}, a code the task's own specification names for a valid request; success asserted but this answer is accepted, not a failure`); return errs; }
    errs.push(`success asserted: expected ${task.responseTypeUri}, got ${type}${errCode === "" ? "" : ` (${errCode})`}`);
    return errs;
  }
  if (type.startsWith("https://trusttasks.org/spec/trust-task-next-step/")) return errs;
  if (type.startsWith("https://trusttasks.org/spec/trust-task-error/")) {
    const code = isObject(doc.payload) ? String(doc.payload.code) : "";
    if (accepted(code)) (opts.note ?? opts.should)(`${task.typeUri}: ${code}, a code the task's own specification requires or permits at the payload level; not a failure`);
    else if ((ENVELOPE_CODES as readonly string[]).includes(code)) errs.push(`a valid request was refused with ${code}, an envelope or addressing code`);
    else if (code === "internalError") opts.should(`${task.typeUri}: a valid request was refused with internalError (a refusal that names no cause; the vector asserts mechanics only, so it is not a failure here)`);
    else if (code === "malformedRequest" && admitsExt(task)) (opts.note ?? opts.should)(`${task.typeUri}: malformedRequest for a schema-valid payload; permitted where the consumer requires its own ext namespace (SPEC.md:246, :1069) or a canonical VID (SPEC.md:388); not escalated`);
    else if (code === "malformedRequest") opts.should(`${task.typeUri}: a schema-valid payload was refused as malformedRequest (the payload schema is the specification's definition of a valid payload)`);
    return errs;
  }
  if (type !== task.responseTypeUri && task.responseSchema === undefined && opts.success !== true) {
    // the task declares no response variant, so there is no anchor to compare the reply with. Its specification may say to answer "on-thread" with the next task of the
    // flow (credential-exchange request answers with issue); whether that is a reply under SPEC.md 4.4.1's three dispositions is open (C-1): observed, never failed
    (opts.note ?? opts.should)(`${task.typeUri}: the reply is ${type}, not a response of this task (the version declares none); a follow-on task document is observed, neither accepted nor refused as a reply (SPEC.md 4.4.1)`);
    return errs;
  }
  if (type !== task.responseTypeUri) {
    errs.push(`answer type ${type} is neither ${task.responseTypeUri}, a next-step nor a trust-task-error`);
    return errs;
  }
  if (task.responseSchema === undefined) return errs;
  for (const m of validate(task.responseSchema, doc.payload)) errs.push(`response payload: ${m}`);
  if (task.responsePolicy?.isProofRequired === true && doc.proof === undefined) opts.should(`${task.responseTypeUri}: the specification declares proof REQUIRED on the response and the response carries none`);
  return errs;
}

export { loadTask };

export interface EmittedOptions {
  should: (m: string) => void;
  /** The VID the harness asked the document to be addressed to, when it gave one. */
  recipient?: string;
}

const WHOLE_SECOND = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * The document an implementation emitted through its own builders (producer class). Checks only what the task's own specification and
 * the framework state: the type is the asked type; the envelope has an id; the payload satisfies the payload schema of the request
 * variant (or the response schema of a `#response`); and the declared policy holds (recipient, proof and issuedAt present where
 * REQUIRED; a proof-bearing document of a non-bearer task names a recipient, SPEC.md 7.2 item 8). A proof by a did:key issuer is
 * verified. It does not check that the content is what the person meant, or that any authority allows it.
 */
export function emittedErrors(task: PlainTask, requestedType: string, documents: string[], opts: EmittedOptions): string[] {
  const errs: string[] = [];
  const isResponse = requestedType.endsWith("#response");
  for (const text of documents) {
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      errs.push("an emitted document is not JSON");
      continue;
    }
    if (!isObject(doc)) {
      errs.push("an emitted document is not a JSON object");
      continue;
    }
    if (doc.type !== requestedType) { errs.push(`emitted type ${String(doc.type)}, asked ${requestedType}`); continue; }
    if (typeof doc.id !== "string" || doc.id === "") errs.push("emitted document has no id");
    const schema = isResponse ? task.responseSchema : task.payloadSchema;
    const policy = isResponse ? task.responsePolicy : task.requestPolicy;
    if (schema === undefined || policy === undefined) { errs.push(`${requestedType} has no schema in the pinned package`); continue; }
    for (const m of validate(schema, doc.payload)) errs.push(`payload: ${m}`);
    if (policy.isRecipientRequired && doc.recipient === undefined) errs.push("recipient is REQUIRED by the specification and the emitted document has none (SPEC.md 7.2 item 5)");
    if (policy.isProofRequired && doc.proof === undefined) errs.push("proof is REQUIRED by the specification and the emitted document has none (SPEC.md 7.2 item 7)");
    if (policy.isIssuedAtRequired && doc.issuedAt === undefined) errs.push("issuedAt is REQUIRED by the specification and the emitted document has none (SPEC.md Specification Requirements item 17)");
    if (doc.proof !== undefined && doc.recipient === undefined && !policy.isBearer) errs.push("the document carries a proof and no recipient on a non-bearer task (SPEC.md 7.2 item 8, audience binding)");
    if (doc.proof !== undefined && typeof doc.issuer !== "string") errs.push("the document carries a proof and no issuer to verify it against");
    if (typeof doc.issuedAt === "string" && !WHOLE_SECOND.test(doc.issuedAt)) opts.should(`issuedAt ${doc.issuedAt} is not whole-second RFC 3339 Z (docs/04 section 3: producers emit whole seconds)`);
    if (opts.recipient !== undefined && doc.recipient !== undefined && doc.recipient !== opts.recipient) opts.should(`the document is addressed to ${String(doc.recipient)}, not the recipient the harness hinted (${opts.recipient}); the adapter chooses its own addressee`);
    if (isObject(doc.proof) && typeof doc.issuer === "string" && doc.issuer.startsWith("did:key:")) {
      const v = verifyDocumentProof(doc, { nowMs: typeof doc.issuedAt === "string" ? Date.parse(doc.issuedAt) : Date.now(), skewMs: 24 * 3600_000 });
      if (!v.valid) errs.push(`the proof does not verify against the issuer: ${v.detail ?? v.failure ?? "invalid"}`);
    }
  }
  return errs;
}
