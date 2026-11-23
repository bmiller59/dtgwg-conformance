// SPDX-License-Identifier: Apache-2.0
// Authoring source for the WIT vector group (witness/session and witness/session/submit; the focus is 0.2, with 0.1 kept as two labelled older vectors; docs/29-witness-tasks.md). Imported by
// generate-vectors.ts, which writes vectors/ceremony-witness/witness.json. Kept in its own file so the group can be read and extended on its own.
import { fileURLToPath } from "node:url";
import { loadTaskFacts, requireAuthorisedWhereStanding } from "../src/coverage/reachable.ts";
import type { Step, Vector, VectorFile } from "../src/vectors/types.ts";

const SESSION = (ver: string): string => `https://trusttasks.org/spec/witness/session/${ver}`;
const SUBMIT = (ver: string): string => `https://trusttasks.org/spec/witness/session/submit/${ver}`;
const SPEC_S = "dtgwg-trust-tasks-tf specs/witness/session/0.2/spec.md";
const SPEC_U = "dtgwg-trust-tasks-tf specs/witness/session/submit/0.2/spec.md";
const SPEC_S1 = "dtgwg-trust-tasks-tf specs/witness/session/0.1/spec.md";
const SPEC_U1 = "dtgwg-trust-tasks-tf specs/witness/session/submit/0.1/spec.md";
const FW = "SPEC.md";
const REFUSED = "witness/session:refused";
const MISMATCH = "witness/session/submit:challengeMismatch";
const INVALID = "witness/session/submit:presentationInvalid";
const OPT = "optional:witness.presentation";

type Send = NonNullable<Step["send"]>;

/** The session request of party `who` (default A) naming the pair A and X; `over` replaces top-level members, `payload` the payload. */
const sessionSend = (ver = "0.2", who = "A", id = "ses", over: Record<string, unknown> = {}, more: Partial<Send> = {}): Send => ({
  document: { id: `$id(${id})`, threadId: `$id(${id})`, type: SESSION(ver), issuer: `$${who}`, recipient: "$iut", issuedAt: "$now+0s", payload: { parties: ["$A", "$X"] }, ...over },
  from: who,
  ...more,
});
/** The submit request of party `who` on the session `id`, carrying the presentation captured as `vp<id>`. The envelope is signed for assertionMethod, the purpose the keyring-wallet witness's own signer and verifier use. */
const submitSend = (ver = "0.2", who = "A", id = "ses", sub = "sub", over: Record<string, unknown> = {}, more: Partial<Send> = {}): Send => ({
  document: { id: `$id(${sub})`, threadId: `$id(${id})`, type: SUBMIT(ver), issuer: `$${who}`, recipient: "$iut", issuedAt: "$now+0s", payload: { vp: `$capJson(vp${id})` }, ...over },
  sign: { as: who, purpose: "assertionMethod" },
  from: who,
  ...more,
});

const sessionOk = (ver = "0.2", id = "ses", handled = 1): NonNullable<Step["expect"]> => ({
  disposition: "response", type: `${SESSION(ver)}#response`, pointer: { "/threadId": `$id(${id})` },
  match: { "/payload/challenge": "^.{16,}$", "/payload/domain": "^.+$" }, state: { handled },
});
/** Open the session `id` and capture its challenge and domain (as `challenge<id>`, `domain<id>`). */
const open = (ver = "0.2", who = "A", id = "ses", handled = 1, over: Record<string, unknown> = {}): Step => ({
  send: sessionSend(ver, who, id, over), capture: { [`challenge${id}`]: "/payload/challenge", [`domain${id}`]: "/payload/domain" }, expect: sessionOk(ver, id, handled),
});
/** The presentation `holder` builds for session `id`, as `vp<id>`; `variant` breaks one thing; `partner` is the other party. */
const present = (holder = "A", id = "ses", variant = "valid", partner = "X", at?: string, session = id): Step => ({
  ...(at === undefined ? {} : { at }),
  trigger: { action: "witnessPresentation", args: { holder: `$${holder}`, partner: `$${partner}`, challenge: `$cap(challenge${session})`, domain: `$cap(domain${session})`, variant } },
  capture: { [`vp${id}`]: "/vp" },
});
const issued = (ver = "0.2", id = "ses", handled = 2): NonNullable<Step["expect"]> => ({
  disposition: "response", type: `${SUBMIT(ver)}#response`, pointer: { "/threadId": `$id(${id})` }, match: { "/payload/vwcDigestMultibase": "^z", "/proof/proofValue": "^z" },
  state: { storedVwc: 1, handled },
});
const refusedAs = (code: string | string[], vwc = 0): NonNullable<Step["expect"]> => ({ disposition: "error", code, retryable: false, noSideEffect: true, state: { storedVwc: vwc } });

const wv = (id: string, title: string, spec: string[], steps: Step[], rest: Partial<Vector> = {}): Vector => ({
  id, title, tier: 1, spec, clarify: null, requires: [SESSION("0.2"), SUBMIT("0.2"), OPT], ...rest, steps,
});
/** A vector that needs only the session task. */
const sv = (id: string, title: string, spec: string[], steps: Step[], rest: Partial<Vector> = {}): Vector => wv(id, title, spec, steps, { requires: [SESSION("0.2")], ...rest });
/** The happy path up to the submit: open, present, submit; `checks` are the evidence rules the response is held to. */
const ceremony = (checks: string[], ver = "0.2"): Step[] => [open(ver), present("A", "ses", "valid", "X", "+1s"), { at: "+2s", send: submitSend(ver), expect: { ...issued(ver), evidence: { session: 1, checks } } }];

export function witnessFile(start: string): VectorFile {
  const vectors: Vector[] = [
    // ---- witness/session ------------------------------------------------------------------------------------------------------------
    sv("WIT-001", "a session opened by a named party is answered with a fresh challenge of at least 16 characters and a domain, on the session's thread", [`${SPEC_S} (Conformance, witness item 3; response schema)`],
      [{ send: sessionSend(), expect: sessionOk() }], { mutants: ["wsShortChallenge"] }),
    sv("WIT-002", "the session response is signed (the proof is REQUIRED on it)", [`${SPEC_S} (front matter proofRequirement.response REQUIRED)`],
      [{ send: sessionSend(), expect: { ...sessionOk(), match: { "/proof/proofValue": "^z", "/payload/challenge": "^.{16,}$" } } }], { mutants: ["wsNoResponseProof"] }),
    sv("WIT-003", "a session response carries the request's parentThreadId (every document of the session does)", [`${SPEC_S} ("The nesting", rule 2: parentThreadId on every document including responses)`],
      [{ send: sessionSend("0.2", "A", "ses", { parentThreadId: "$id(rel)" }), expect: { ...sessionOk(), pointer: { "/threadId": "$id(ses)", "/parentThreadId": "$id(rel)" } } }], { mutants: ["wsDropsParentThreadId"] }),
    sv("WIT-004", "a session opened by an issuer that is not one of the named parties is refused witness/session:refused", [`${SPEC_S} (Conformance, witness item 2)`, `${SPEC_S} (Authorization)`],
      [{ send: sessionSend("0.2", "S"), expect: { disposition: "error", code: REFUSED, retryable: false, noSideEffect: true, state: { stored: 0 } } }], { mutants: ["wsNoMembershipCheck"] }),
    sv("WIT-005", "parties that are not exactly two DIDs (one, three, not DIDs, missing) are malformed", [`${SPEC_S} (payload schema: parties minItems 2, maxItems 2, pattern ^did:)`, `${SPEC_S} (payload.invalid-examples.json)`, `${FW} (7.2 item 2)`],
      [{ send: sessionSend("0.2", "A", "ses", { payload: { parties: ["$A"] } }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true } },
       { send: sessionSend("0.2", "A", "ses3", { payload: { parties: ["$A", "$X", "$R"] } }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true } },
       { send: sessionSend("0.2", "A", "sesn", { payload: { parties: ["alice", "bob"] } }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true } },
       { send: sessionSend("0.2", "A", "sesm", { payload: {} }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true } }], { mutants: ["wsNoPartiesCheck"] }),
    sv("WIT-006", "a session payload with an unknown member is malformed", [`${SPEC_S} (payload.invalid-examples.json: unknown member; additionalProperties false)`, `${FW} (4.5.1, 7.2 item 2)`],
      [{ send: sessionSend("0.2", "A", "ses", { payload: { parties: ["$A", "$X"], location: "Cambridge, MA" } }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true } }], { mutants: ["openPayload"] }),
    sv("WIT-007", "the two sessions of one witnessed exchange get different challenges (a shared value would let either presentation satisfy the other's session)", [`${SPEC_S} ("One session per participating party"; response schema, challenge)`],
      [open("0.2", "A", "ses", 1), { send: sessionSend("0.2", "X", "sesX"), expect: { ...sessionOk("0.2", "sesX", 2), notEqual: { "/payload/challenge": ["$cap(challengeses)"] } } }], { mutants: ["wsSharedChallenge"] }),
    sv("WIT-008", "a session request without an envelope proof is accepted (its proof is OPTIONAL)", [`${SPEC_S} (front matter proofRequirement.request OPTIONAL)`],
      [{ send: sessionSend("0.2", "A", "ses", {}, { sign: null }), expect: sessionOk() }]),
    sv("WIT-009", "a session request without issuedAt is refused (REQUIRED, framework 7.3 item 17)", [`${SPEC_S} (front matter issuedAtRequirement REQUIRED)`, `${FW} (SPEC.md:1137, 7.3 item 17)`],
      [{ send: sessionSend("0.2", "A", "ses", { issuedAt: undefined }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true } }], { clarify: "SPEC.md 7.3 item 17 makes issuedAt a MUST of the task specification, but no consumer rule names the rejection or its code for a missing issuedAt; malformedRequest is the closest reading. The single-task template vector for the same case accepts any refusal (O-07, spec-silent, class C, recorded, nothing filed). Not gating.", mutants: ["noFreshnessWindow"] }),
    sv("WIT-010", "a session addressed to another recipient is refused wrongRecipient", [`${FW} (7.2 item 5)`, `${SPEC_S} (Conformance, witness item 1)`],
      [{ send: sessionSend("0.2", "A", "ses", { recipient: "$R" }), expect: { disposition: "error", code: "wrongRecipient", noSideEffect: true } }], { mutants: ["noRecipientCheck"] }),
    sv("WIT-011", "a session whose issuer is not the transport-authenticated sender is refused identityMismatch", [`${FW} (7.2 item 6)`, `${SPEC_S} (Conformance, witness item 1)`],
      [{ send: sessionSend("0.2", "A", "ses", {}, { from: "X" }), expect: { disposition: "error", code: "identityMismatch", noSideEffect: true } }], { requires: [SESSION("0.2"), "optional:transportIdentity"], mutants: ["ignoreTransportIdentity"] }),
    sv("WIT-012", "a future-dated session (beyond the clock allowance) is refused", [`${FW} (7.3 item 17, the freshness floor)`, `${SPEC_S} (front matter issuedAtRequirement: a replayed session opens a second session)`],
      [{ send: sessionSend("0.2", "A", "ses", { issuedAt: "$now+3600s" }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true } }], { mutants: ["noTimeChecks"] }),
    sv("WIT-013", "a byte-identical resend of a session request is absorbed as a duplicate: it opens no second session and the first response is returned", [`${FW} (7.2 item 11, Disposition of a duplicate)`, `${SPEC_S} (front matter issuedAtRequirement rationale; sideEffects mutating)`],
      [{ send: sessionSend(), expect: sessionOk() }, { at: "+5s", send: { same: "previous" }, expect: { disposition: "duplicate", state: { handled: 1 } } }], { mutants: ["noReplayRecord"] }),
    sv("WIT-014", "the same session id with different content is idConflict, not a second session", [`${FW} (7.2 item 11, Keying and comparison)`],
      [{ send: sessionSend(), expect: sessionOk() }, { at: "+5s", send: sessionSend("0.2", "A", "ses", { payload: { parties: ["$X", "$A"] } }), expect: { disposition: "error", code: "idConflict", noSideEffect: true } }], { mutants: ["idOnlyDuplicateKey"] }),
    // ---- the version pairing, the older 0.1 pair, and the member presentation (0.2) -----------------------------------------------------
    sv("WIT-015", "older version (non-focus): a session in 0.1 is answered like 0.2 (the payload is unchanged between the two)", [`${SPEC_S1} (Conformance, witness item 3; response schema)`, `${SPEC_S} (What changed from 0.1: the payload is unchanged)`],
      [{ send: sessionSend("0.1"), expect: sessionOk("0.1") }], { requires: [SESSION("0.1")] }),
    wv("WIT-016", "a submission in 0.1 on a 0.2 session, and in 0.2 on a 0.1 session, is refused challengeMismatch (the versions pair one to one)", [`${SPEC_S} ("What changed from 0.1, and how the versions pair")`],
      [open("0.2", "A", "ses", 1), present("A", "ses", "valid", "X", "+1s"), { at: "+2s", send: submitSend("0.1"), expect: refusedAs(MISMATCH) },
       open("0.1", "A", "ses2", 2), present("A", "ses2", "valid", "X", "+3s"), { at: "+4s", send: submitSend("0.2", "A", "ses2", "sub2"), expect: refusedAs(MISMATCH) }],
      { requires: [SESSION("0.1"), SUBMIT("0.1"), SESSION("0.2"), SUBMIT("0.2"), OPT], mutants: ["wsAcceptWrongVersion"] }),
    wv("WIT-017", "a submit that carries a member presentation (a second presentation by a member DID that is neither party, bound to the same challenge and domain) is answered with the credential, and the member DID is not in the reply (the witness may ignore it, and the credential must not carry it)",
      [`${SPEC_U} ("The member presentation": rules 1 to 4; "The VWC does not carry it"; Conformance, witness item 5)`],
      [open(), present("A", "ses", "valid", "X", "+1s"), present("R", "mp", "member", "X", "+1s", "ses"),
       { at: "+2s", send: submitSend("0.2", "A", "ses", "sub", { payload: { vp: "$capJson(vpses)", memberPresentation: "$capJson(vpmp)" } }), expect: { ...issued(), forbidInReply: ["$R"], evidence: { session: 1, checks: ["taskContext", "taskDigest", "vwcDigest", "subjectIsOpener"] } } }],
      { mutants: ["wsMemberInVwc"] }),
    wv("WIT-018", "a memberPresentation that is not a presentation object (a bare DID), or a submit that carries only a memberPresentation, is malformed",
      [`${SPEC_U} (payload.invalid-examples.json: memberPresentation is a presentation object, never a bare DID or a string; it does not replace vp)`, `${FW} (7.2 item 2)`],
      [open(), { at: "+1s", send: submitSend("0.2", "A", "ses", "sub", { payload: { vp: {}, memberPresentation: "did:webvh:QmAlice:alice.example.com" } }), expect: refusedAs("malformedRequest") },
       { at: "+2s", send: submitSend("0.2", "A", "ses", "sub2", { payload: { memberPresentation: {} } }), expect: refusedAs("malformedRequest") }], { mutants: ["wsMemberUntyped"] }),
    // ---- witness/session/submit ------------------------------------------------------------------------------------------------------
    wv("WIT-020", "a presentation bound to the session's challenge and domain is answered with a signed response carrying the credential and its digest, and one credential is issued", [`${SPEC_U} (Conformance, witness item 5)`],
      ceremony([])),
    wv("WIT-021", "the delivered credential's taskContext is the id of the session document, as a top-level member", [`${SPEC_U} ("This response is the outcome evidence", item 1)`, `${FW} (4.9.1)`],
      ceremony(["taskContext"]), { mutants: ["wsWrongTaskContext"] }),
    wv("WIT-022", "the delivered credential's taskDigestMultibase is the task digest of the session document, as a top-level member", [`${SPEC_U} ("This response is the outcome evidence", item 1)`, `${FW} (4.9.3)`],
      ceremony(["taskDigest"]), { mutants: ["wsNoTaskDigest", "wsTaskDigestWithProof"] }),
    wv("WIT-023", "vwcDigestMultibase is the RFC 8785 digest of the delivered credential, proof included", [`${SPEC_U} (response schema, vwcDigestMultibase)`],
      ceremony(["vwcDigest"]), { mutants: ["wsWrongVwcDigest"] }),
    wv("WIT-024", "the credential's issuer is the witness that answered (the session's recipient and the response's issuer)", [`${SPEC_U} ("This response is the outcome evidence", item 2: the VWC's issuer is the session document's recipient)`, `${FW} (4.9.4 item 4)`],
      ceremony(["issuerIsResponder"]), { mutants: ["wsVwcIssuerNotResponder"] }),
    wv("WIT-025", "the credential subject is the party that opened the session", [`${SPEC_U} ("The credential delivered": credentialSubject.id is the issuer of the credential, the submitting party)`],
      ceremony(["subjectIsOpener"]), { mutants: ["wsSubjectNotOpener"] }),
    wv("WIT-026", "the credential is a StatementCredential under the witnessed predicate", [`${SPEC_U} ("The credential delivered")`],
      ceremony(["statementType"])),
    wv("WIT-027", "a presentation bound to another challenge is refused challengeMismatch and no credential is issued", [`${SPEC_U} (Conformance, witness item 2; errorCodes challengeMismatch)`],
      [open(), present("A", "ses", "wrongChallenge", "X", "+1s"), { at: "+2s", send: submitSend(), expect: refusedAs(MISMATCH) }], { mutants: ["wsNoChallengeCheck"] }),
    wv("WIT-028", "a presentation bound to another domain is refused challengeMismatch", [`${SPEC_U} (Conformance, witness item 2: bound to this session's challenge and domain)`],
      [open(), present("A", "ses", "wrongDomain", "X", "+1s"), { at: "+2s", send: submitSend(), expect: refusedAs(MISMATCH) }], { mutants: ["wsNoDomainCheck"] }),
    wv("WIT-029", "a presentation whose relationship credential does not verify is refused presentationInvalid, distinct from challengeMismatch", [`${SPEC_U} (errorCodes presentationInvalid; Conformance, witness item 2: a replay versus a defect)`],
      [open(), present("A", "ses", "tamperedCredential", "X", "+1s"), { at: "+2s", send: submitSend(), expect: refusedAs(INVALID) }], { clarify: "No rule of witness/session/submit says that the witness verifies the relationship credential inside the presentation; only the text at :262 implies it, and it names no consequence for one that does not verify. Whether a witness that issues anyway is non-conforming is spec-open (class C, O-14), recorded only, nothing filed. Not gating.", mutants: ["wsNoCredentialVerify", "wsMismatchForAll"] }),
    wv("WIT-030", "a presentation with no proof is refused (it cannot be bound to the challenge)", [`${SPEC_U} (Conformance, witness item 2; party item 2: bound to the challenge)`],
      [open(), present("A", "ses", "unsigned", "X", "+1s"), { at: "+2s", send: submitSend(), expect: refusedAs([MISMATCH, INVALID]) }], { mutants: ["wsAcceptUnsignedVp"] }),
    wv("WIT-031", "a presentation held by someone who is not a party to the session is refused presentationInvalid (its party bindings fail)", [`${SPEC_U} (errorCodes presentationInvalid: its party bindings against the session)`],
      [open(), present("A", "ses", "outsiderHolder", "X", "+1s"), { at: "+2s", send: submitSend(), expect: refusedAs(INVALID) }], { mutants: ["wsNoHolderCheck", "wsMismatchForAll"] }),
    wv("WIT-032", "a submission by the other party on a session it did not open is refused challengeMismatch", [`${SPEC_U} (Conformance, witness item 3; Authorization)`],
      [open(), present("X", "ses", "valid", "A", "+1s"), { at: "+2s", send: submitSend("0.2", "X"), expect: refusedAs(MISMATCH) }], { mutants: ["wsNoSubmitterCheck"] }),
    wv("WIT-033", "a submission by a party outside the exchange on someone else's session is refused (challengeMismatch, or proofInvalid where the witness attributes the envelope proof first)", [`${SPEC_U} (Conformance, witness item 3; Authorization)`],
      [open(), present("S", "ses", "valid", "A", "+1s"), { at: "+2s", send: submitSend("0.2", "S"), expect: refusedAs([MISMATCH, "proofInvalid"]) }],
      { mutants: ["wsNoSubmitterCheck"] }),
    wv("WIT-034", "the challenge is single-use: a second submission on a completed session (new envelope id, same presentation) is refused and issues no second credential (challengeMismatch, or proofInvalid where the witness holds no session to attribute the envelope proof to)", [`${SPEC_S} (response schema, challenge: single-use)`, `${SPEC_U} ("Retention" of the witness's session state: once submit has consumed the challenge it is spent)`],
      [...ceremony([]), { at: "+3s", send: submitSend("0.2", "A", "ses", "sub2", { issuedAt: "$now+3s" }), expect: refusedAs([MISMATCH, "proofInvalid"], 1) }], { mutants: ["wsChallengeReusable"] }),
    wv("WIT-035", "a byte-identical resend of a completed submit (a redelivery) is absorbed as a duplicate and returns the first response, with one credential issued", [`${FW} (7.2 item 11, Disposition of a duplicate)`, `${SPEC_U} (sideEffects mutating, the response is retained evidence)`],
      [...ceremony([]), { at: "+3s", send: { same: "previous" }, expect: { disposition: "duplicate", state: { storedVwc: 1 } } }], { mutants: ["noReplayRecord"] }),
    wv("WIT-036", "a submission on a thread with no open session is refused challengeMismatch", [`${SPEC_U} (Authorization: a submission that cannot produce the challenge is not entitled to be witnessed)`],
      [{ send: submitSend("0.2", "A", "ses", "sub", { payload: { vp: { type: ["VerifiablePresentation"] } } }), expect: refusedAs(MISMATCH) }],
      { requires: [SESSION("0.2"), SUBMIT("0.2")], mutants: ["wsUnknownThreadAsInvalid"], clarify: "The specification names no code for a thread on which no session was opened; challengeMismatch is the closest reading of its Authorization section (a submission that cannot produce the challenge)." }),
    wv("WIT-037", "a submit payload without vp, or with an unknown member, is malformed", [`${SPEC_U} (payload.invalid-examples.json)`, `${FW} (7.2 item 2)`],
      [open(), { at: "+1s", send: submitSend("0.2", "A", "ses", "sub", { payload: {} }), expect: refusedAs("malformedRequest") },
       { at: "+2s", send: submitSend("0.2", "A", "ses", "sub2", { payload: { vp: {}, attestation: "secure-enclave" } }), expect: refusedAs("malformedRequest") }], { requires: [SESSION("0.2"), SUBMIT("0.2")], mutants: ["openPayload"] }),
    wv("WIT-038", "a submit without an envelope proof is refused proofRequired (the proof is REQUIRED on it)", [`${SPEC_U} (front matter proofRequirement; Authorization: the envelope proof is REQUIRED)`, `${FW} (7.2 item 7)`],
      [open(), present("A", "ses", "valid", "X", "+1s"), { at: "+2s", send: submitSend("0.2", "A", "ses", "sub", {}, { sign: null }), expect: refusedAs("proofRequired") }], { mutants: ["proofOptional"] }),
    wv("WIT-039", "a submit whose envelope proof was made by a key that is not the issuer's is refused", [`${FW} (7.2 item 7)`, `${SPEC_U} (Authorization: the envelope proof attributes the outer document to its sender)`],
      [open(), present("A", "ses", "valid", "X", "+1s"), { at: "+2s", send: submitSend("0.2", "A", "ses", "sub", {}, { sign: { as: "X", purpose: "assertionMethod", allowIssuerMismatch: true } }), expect: refusedAs(["proofInvalid", "identityMismatch"]) }], { mutants: ["acceptUnverifiedProof"] }),
    wv("WIT-040", "a submit whose envelope proof has proofPurpose authentication (the suite's default) is accepted", [`${FW} (4.7: the specifications do not fix the proofPurpose of the envelope proof)`],
      [open(), present("A", "ses", "valid", "X", "+1s"), { at: "+2s", send: submitSend("0.2", "A", "ses", "sub", {}, { sign: { as: "A", purpose: "authentication" } }), expect: issued() }],
      { clarify: "The submit specification requires a proof but not a particular proofPurpose; whether a verifier may insist on assertionMethod is not stated." }),
    wv("WIT-041", "a submission after the witness's session window has passed is refused", [`${SPEC_S} (Security & Privacy, Retention: the session ends when it terminates or expires; the expiry is the witness's own, published under its policy)`],
      [open(), present("A", "ses", "valid", "X", "+11m"), { at: "+11m", send: submitSend(), expect: { disposition: "any-refusal", noSideEffect: true, state: { storedVwc: 0 } } }],
      { exactClock: true, clarify: "The specifications leave the session expiry to the witness's own policy and state no number or error code; a witness that never expires a session is measured here and reported as a difference, not a failure.", mutants: ["wsNoExpiry"] }),
    // ---- the ceremony, end to end ----------------------------------------------------------------------------------------------------
    wv("WIT-050", "both parties of a witnessed exchange open their own sessions and submit: two challenges, two credentials, each bound to its own session and naming its own party", [`${SPEC_S} ("One session per participating party")`, `${SPEC_U} ("This response is the outcome evidence"; "A witnessed relationship exchange produces two of these responses")`],
      [open("0.2", "A", "ses", 1), present("A", "ses", "valid", "X", "+1s"),
       { at: "+2s", send: submitSend("0.2", "A", "ses", "sub"), expect: { ...issued("0.2", "ses", 2), evidence: { session: 1, checks: ["taskContext", "taskDigest", "vwcDigest", "issuerIsResponder", "subjectIsOpener", "statementType", "responseSigned"] } } },
       { at: "+3s", send: sessionSend("0.2", "X", "sesX", { issuedAt: "$now+3s" }), capture: { challengesesX: "/payload/challenge", domainsesX: "/payload/domain" }, expect: { ...sessionOk("0.2", "sesX", 3), notEqual: { "/payload/challenge": ["$cap(challengeses)"] } } },
       present("X", "sesX", "valid", "A", "+4s"),
       { at: "+5s", send: submitSend("0.2", "X", "sesX", "subX", { issuedAt: "$now+5s" }), expect: { ...issued("0.2", "sesX", 4), state: { storedVwc: 2, handled: 4 }, evidence: { session: 4, checks: ["taskContext", "taskDigest", "vwcDigest", "issuerIsResponder", "subjectIsOpener", "statementType", "responseSigned"] } } }],
      { mutants: ["wsSharedChallenge", "wsWrongTaskContext", "wsSubjectNotOpener"] }),
    wv("WIT-051", "a credential issued on one party's session cannot be obtained by replaying the other party's presentation into it", [`${SPEC_S} ("Distinct challenges also mean neither party's presentation can be replayed into the other's session")`],
      [open("0.2", "A", "ses", 1), open("0.2", "X", "sesX", 2), present("A", "ses", "valid", "X", "+1s"),
       { at: "+2s", send: submitSend("0.2", "X", "sesX", "subX", { payload: { vp: "$capJson(vpses)" } }), expect: refusedAs([MISMATCH, INVALID]) }],
      { mutants: ["wsNoChallengeCheck", "wsSharedChallenge"] }),
    wv("WIT-052", "older version (non-focus): the 0.1 pair still works end to end: a presentation bound to the session's challenge on a 0.1 session, submitted in 0.1, is answered with the credential citing the session document",
      [`${SPEC_U1} (Conformance, witness item 4; "This response is the outcome evidence")`, `${SPEC_S1} (Conformance, witness item 3)`],
      ceremony(["taskContext", "taskDigest", "vwcDigest", "issuerIsResponder", "subjectIsOpener", "statementType"], "0.1"), { requires: [SESSION("0.1"), SUBMIT("0.1"), OPT] }),
  ];
  return { format: "tt-conformance-vectors/0.1", group: "WIT", family: "witness-session", clock: { start }, vectors: vectors.map((x) => requireAuthorisedWhereStanding(x, loadTaskFacts(fileURLToPath(new URL("..", import.meta.url))))) };
}
