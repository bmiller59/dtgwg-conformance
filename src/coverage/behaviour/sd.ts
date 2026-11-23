// SPDX-License-Identifier: Apache-2.0
// Behavioural rules of coverage family SD (docs/22, phase 4). Only refusals the Trust Tasks text states, reachable from one document.
import type { BehaviourRule, J } from "./types.ts";
import { ACTOR, base64urlCanonical, memberValueRule, retire, unknownIdRule } from "./types.ts";

const F = "SD";
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const sp = (slug: string, version: string, words: string): string => `specs/${slug}/${version}/spec.md: "${words}"`;

/** An identifier the text says names nothing, built with the shared helper (a free-form string identifier). */
const unknown = (slug: string, version: string, member: string, code: string, words: string): BehaviourRule =>
  unknownIdRule({ family: F, slug, version, member, code, quote: [sp(slug, version, words)] });
/** An identifier whose schema is a pattern: the value that names nothing is given explicitly. */
const unknownValue = (slug: string, version: string, member: string, value: string, code: string, words: string): BehaviourRule =>
  memberValueRule({ family: F, slug, version, member, value, code, quote: [sp(slug, version, words)] });
const HEX32 = "fedcba9876543210fedcba9876543210";
const KEY_A = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH";

const KEYS_REASON = "the consumer list refuses an unknown key with keys:notFound (item 3) before it checks the request's own members, so the stated code needs a key the custodian holds: prior state";
const hasControl = (v: unknown): boolean => typeof v === "string" ? /[\u0000-\u001f\u007f]/.test(v) : isObj(v) ? Object.values(v).some(hasControl) : Array.isArray(v) ? v.some(hasControl) : false;

export const RULES: BehaviourRule[] = [
  // acl: amending an entry that does not exist
  unknown("acl/update", "0.1", "subject", "acl/update:notFound", "This task amends; use acl/grant to create."),
  unknown("acl/update", "0.2", "subject", "acl/update:notFound", "This task amends; use acl/grant to create."),
  // auth: sessions, tokens, enrolments
  unknown("auth/authenticate", "0.3", "sessionId", "auth/authenticate:challengeNotFound", "does not refer to any challenge the auth service issued"),
  unknown("auth/refresh", "0.2", "refreshToken", "auth/refresh:tokenNotFound", "does not refer to any session the auth service issued"),
  unknown("auth/passkey/enroll/finish", "0.2", "enrollmentId", "auth/passkey/enroll/finish:enrollmentNotFound", "does not refer to any active enrollment ceremony"),
  unknown("auth/passkey/enroll/redeem/finish", "0.1", "enrollmentId", "auth/passkey/enroll/redeem/finish:enrollmentNotFound", "refers to no active redemption ceremony"),
  unknownValue("auth/oob/cancel", "0.1", "requestId", HEX32, "auth/oob:requestNotFound", "No request has this"),
  // claim: the text refuses a document whose parentThreadId is not payload.requestId with malformedRequest, so the document carries it and only the handle is unknown
  ...(["0.1", "0.2"] as const).map((v) => memberValueRule({ family: F, slug: "auth/oob/claim", version: v, member: "requestId", value: HEX32, code: "auth/oob:requestNotFound", quote: [sp("auth/oob/claim", v, "No request has this")], envelope: (_t, p) => ({ parentThreadId: p["requestId"] }) })),
  unknownValue("auth/oob/redeem", "0.2", "requestId", HEX32, "auth/oob:requestNotFound", "No request has this"),
  retire({
    key: "auth/authenticate/0.3:delegationEvidenceRequired", family: F, slug: "auth/authenticate", version: "0.3",
    title: "auth/authenticate 0.3: a principal with no delegationEvidence (a proxied authenticate without its evidence) is refused with auth/authenticate:delegationEvidenceRequired",
    quote: [sp("auth/authenticate", "0.3", "A proxied authenticate MUST carry both.")], codes: ["auth/authenticate:delegationEvidenceRequired"],
    trigger: (t) => (isObj(t.validPayload) ? { ...t.validPayload, principal: "did:web:conformance-principal.example" } : undefined),
    refuses: (p) => p["principal"] !== undefined && p["delegationEvidence"] === undefined,
  }, "the consumer list looks up the challenge by sessionId (item 2, challengeNotFound), compares it (item 3), checks expiry (item 4) and the subject (item 5) and consumes it (item 6) before it reaches the proxied case (item 7), so delegationEvidenceRequired needs an open challenge: prior state"),
  // auth/signing-key/enroll: refusals decided by the document alone
  {
    key: "auth/signing-key/enroll/0.2:selfDelegation", family: F, slug: "auth/signing-key/enroll", version: "0.2",
    title: "auth/signing-key/enroll 0.2: signingKeyDid equal to identityDid is refused with auth/signing-key/enroll:selfDelegation",
    quote: [sp("auth/signing-key/enroll", "0.2", "A delegation names a separate key; an identity already signs as itself.")], codes: ["auth/signing-key/enroll:selfDelegation"],
    // item 1 refuses keyNotIssuer unless signingKeyDid is the issuer, so the key is the document's issuer and is also the identity
    trigger: (t) => (isObj(t.validPayload) && typeof t.validPayload["signingKeyDid"] === "string" ? { ...t.validPayload, signingKeyDid: ACTOR, identityDid: ACTOR } : undefined),
    refuses: (p) => typeof p["signingKeyDid"] === "string" && p["signingKeyDid"] === p["identityDid"],
  },
  {
    key: "auth/signing-key/enroll/0.2:expiryInPast", family: F, slug: "auth/signing-key/enroll", version: "0.2",
    title: "auth/signing-key/enroll 0.2: an expiresAt that is not in the future is refused with auth/signing-key/enroll:expiryInPast",
    quote: [sp("auth/signing-key/enroll", "0.2", "is not in the future, so the delegation would authorize nothing")], codes: ["auth/signing-key/enroll:expiryInPast"],
    trigger: (t) => (isObj(t.validPayload) ? { ...t.validPayload, signingKeyDid: ACTOR, expiresAt: "2001-01-01T00:00:00Z" } : undefined),
    refuses: (p) => typeof p["expiresAt"] === "string" && Date.parse(p["expiresAt"]) <= Date.now(),
  },
  retire(unknownValue("auth/signing-key/enroll", "0.2", "replaces", KEY_A, "auth/signing-key/enroll:replaceNotFound", "names no active delegation of"),
    "item 14 says replaceNotFound is checked only after the authority evidence is accepted, so the code needs an enrolment whose evidence the consumer accepts: prior state"),
  // keys: a key identifier that names no key record
  unknown("keys/export-secret", "0.1", "keyId", "keys:notFound", "No key record on this custodian carries the named"),
  unknown("keys/rename", "0.1", "keyId", "keys:notFound", "No key record on this custodian carries the named"),
  unknown("keys/set-exportability", "0.1", "keyId", "keys:notFound", "No key record on this custodian carries the named"),
  unknown("keys/sign-csr", "0.1", "keyId", "keys:notFound", "No key record on this custodian carries the named"),
  unknown("keys/sign-document", "0.1", "keyId", "keys:notFound", "No key record on this custodian carries the named"),
  unknown("keys/sign-jws", "0.1", "keyId", "keys:notFound", "No key record on this custodian carries the named"),
  retire({
    key: "keys/sign-csr/0.1:subjectInvalid", family: F, slug: "keys/sign-csr", version: "0.1",
    title: "keys/sign-csr 0.1: a subject attribute value holding a control character is refused with keys/sign-csr:subjectInvalid",
    quote: [sp("keys/sign-csr", "0.1", "or a control character")], codes: ["keys/sign-csr:subjectInvalid"],
    trigger: (t) => (isObj(t.validPayload) ? { ...t.validPayload, subject: [{ type: "CN", value: "example\u0001name" }] } : undefined),
    refuses: (p) => hasControl(p["subject"]) || hasControl(p["subjectAltNames"]),
  }, KEYS_REASON),
  {
    key: "keys/sign-document/0.1:proofPresent", family: F, slug: "keys/sign-document", version: "0.1",
    title: "keys/sign-document 0.1: a document that already carries a proof member is refused with keys/sign-document:proofPresent",
    quote: [sp("keys/sign-document", "0.1", "The document already carries a")], codes: ["keys/sign-document:proofPresent"],
    trigger: (t) => (isObj(t.validPayload) ? { ...t.validPayload, document: { proof: { type: "DataIntegrityProof" } } } : undefined),
    refuses: (p) => isObj(p["document"]) && p["document"]["proof"] !== undefined,
  },
  retire({
    key: "keys/sign-jws/0.1:headerMemberForbidden", family: F, slug: "keys/sign-jws", version: "0.1",
    title: "keys/sign-jws 0.1: a header naming alg is refused with keys/sign-jws:headerMemberForbidden",
    quote: [sp("keys/sign-jws", "0.1", "names a member the custodian sets or refuses itself")], codes: ["keys/sign-jws:headerMemberForbidden"],
    trigger: (t) => (isObj(t.validPayload) ? { ...t.validPayload, header: { alg: "none" } } : undefined),
    refuses: (p) => isObj(p["header"]) && ["alg", "crit", "b64", "jwk", "jku", "x5u"].some((k) => (p["header"] as J)[k] !== undefined),
  }, KEYS_REASON),
  retire({
    key: "keys/sign-jws/0.1:payloadInvalid", family: F, slug: "keys/sign-jws", version: "0.1",
    title: "keys/sign-jws 0.1: a payloadBase64Url that is not canonical unpadded base64url is refused with keys/sign-jws:payloadInvalid",
    quote: [sp("keys/sign-jws", "0.1", "is not the canonical unpadded base64url encoding of any byte string")], codes: ["keys/sign-jws:payloadInvalid"],
    trigger: (t) => { if (!isObj(t.validPayload)) return undefined; const { payload: _drop, ...rest } = t.validPayload; return { ...rest, payloadBase64Url: "AB" }; },
    refuses: (p) => typeof p["payloadBase64Url"] === "string" && !base64urlCanonical(p["payloadBase64Url"]),
  }, KEYS_REASON),
  retire({
    key: "keys/sign-jws/0.1:invalidArgument", family: F, slug: "keys/sign-jws", version: "0.1",
    title: "keys/sign-jws 0.1: a JOSE-registered header member (typ) that is not a string is refused with keys:invalidArgument",
    quote: [sp("keys/sign-jws", "0.1", "a JOSE-registered member whose value is not of the type RFC 7515 defines for it")], codes: ["keys:invalidArgument"],
    trigger: (t) => (isObj(t.validPayload) ? { ...t.validPayload, header: { typ: 7 } } : undefined),
    refuses: (p) => isObj(p["header"]) && ["typ", "kid", "cty"].some((k) => (p["header"] as J)[k] !== undefined && typeof (p["header"] as J)[k] !== "string"),
  }, KEYS_REASON),
  // vault: a credential handle that names nothing the consumer may reach
  unknown("vault/credentials/get", "0.2", "id", "vault/credentials/get:notFound", "holds no credential under this identifier that this consumer may read"),
  unknown("vault/credentials/present", "0.1", "id", "vault/credentials/present:notFound", "holds no credential under this identifier that this consumer may present"),
  unknown("vault/credentials/archive", "0.1", "id", "vault/credentials/archive:notFound", "holds no credential under this identifier that this consumer may act on"),
  unknown("vault/credentials/unarchive", "0.1", "id", "vault/credentials/unarchive:notFound", "holds no credential under this identifier that this consumer may act on"),
];
