// SPDX-License-Identifier: Apache-2.0
// Authoring source for the vector files under vectors/. Run:
//   node --experimental-strip-types scripts/generate-vectors.ts
// The generated JSON is what implementations consume; a test asserts the committed JSON equals
// this script's output. Imported rows are read from vectors/imported (see import-fixtures.ts).
import { labelVersionRole } from "../src/vectors/version-role.ts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { witnessFile } from "./vectors-witness.ts";
import type { Manifest, ReceiptSpec, Step, Vector, VectorFile, WitnessSpec } from "../src/vectors/types.ts";
import { coreSource, currentDigest, loadPins, withSource } from "../src/vectors/source.ts";
import type { VectorSource } from "../src/vectors/source.ts";
import { deriveImplementedBy } from "../src/vectors/implemented-by.ts";
import { tfRefFor } from "../src/vectors/tfref.ts";
import { applyClarifyMeta, loadClarifyMeta } from "../src/vectors/clarify.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const T0 = "2026-11-12T10:00:00Z";
const FW = "framework";

const req = (extra: Record<string, unknown> = {}, more: Partial<Step["send"] & object> = {}): NonNullable<Step["send"]> => ({
  template: "carrier.request",
  ...(Object.keys(extra).length > 0 ? { params: extra } : {}),
  ...more,
});
const ok = (extra: Record<string, unknown> = {}): Step => ({ send: req(extra), expect: { disposition: "response", state: { handled: 1 } } });
/**
 * A refusal: one error with `code`, nothing executed. `errorReply: "should"` marks a rejection whose reply the framework
 * makes a SHOULD (SPEC.md:1071 for a rejection under any rule of 7.2, MAY at :1196): a missing reply is an advisory, a sent
 * reply is still checked. Leave it off where the reply is mandatory (SPEC.md:756 and the HTTPS binding).
 */
const refuse = (code: string | string[], send: NonNullable<Step["send"]>, at?: string, errorReply?: "should"): Step => ({
  ...(at === undefined ? {} : { at }),
  send,
  expect: { disposition: "error", code, noSideEffect: true, ...(errorReply === undefined ? {} : { errorReply }) },
});
/** `refuse` for a rejection under SPEC.md 7.2, where the error reply is a SHOULD (SPEC.md:1071). */
const refuseShould = (code: string | string[], send: NonNullable<Step["send"]>, at?: string): Step => refuse(code, send, at, "should");
const SR = { errorReply: "should" as const };
const omit = { $omit: true };
/** Carrier-independent payload variants, resolved against the carrier's declared valid payload when the document is built. */
const CARRIER_BAD = { $carrierInvalid: true };
const CARRIER_EXTRA = { $carrierExtra: true };

function file(group: string, vectors: Vector[], family = FW): VectorFile {
  return { format: "tt-conformance-vectors/0.1", group, family, clock: { start: T0 }, vectors };
}
const v = (id: string, title: string, tier: 1 | 2, spec: string[], steps: Step[], rest: Partial<Vector> = {}): Vector => ({
  id, title, tier, spec, clarify: null, ...rest, steps,
});

// ---------------------------------------------------------------- ENV and RSP
const env = file("ENV", [
  v("ENV-001", "minimal valid carrier request is accepted and answered", 1, ["framework 4.1 to 4.4", "SPEC.md:1011-1023 (7.2)"], [ok()],
    { mutants: [] }),
  v("ENV-002", "undecodable bytes get no invented reply", 1, ["SPEC.md:1011 and SPEC.md:1070 (7.2 item 1 and the closing paragraph: nothing to address)"],
    [{ send: req({}, { mutate: [{ op: "truncate", bytes: 12 }] }), expect: { disposition: "any-refusal", noSideEffect: true } }],
    { mutants: ["acceptGarbage"] }),
  v("ENV-003", "missing id is refused or ignored, never executed", 1, ["framework 4.4 (id REQUIRED)", "SPEC.md:1011 (7.2 item 1)"],
    [{ send: req({ id: omit }, { sign: null }), expect: { disposition: "any-refusal", noSideEffect: true } }], { mutants: ["lenientEnvelope"] }),
  v("ENV-004", "missing type is refused or ignored, never executed", 1, ["framework 4.4 (type REQUIRED)", "SPEC.md:1011 (7.2 item 1)"],
    [{ send: req({ type: omit }, { sign: null }), expect: { disposition: "any-refusal", noSideEffect: true } }], { mutants: ["lenientEnvelope"] }),
  v("ENV-005", "missing payload is refused", 1, ["framework 4.4 (payload REQUIRED)", "SPEC.md:1011 (7.2 item 1)"],
    [{ send: req({ payload: omit }, { sign: null }), expect: { disposition: "any-refusal", noSideEffect: true } }], { mutants: ["lenientEnvelope"] }),
  v("ENV-006", "Type URI with a non-https scheme that is not the served type", 1, ["framework 6.1", "SPEC.md:870 (the scheme MUST NOT be http)", "SPEC.md:1013 (7.2 item 3)", "SPEC.md:1071 (the error reply is a SHOULD)"],
    [refuseShould(["unsupportedType", "malformedRequest"], req({ type: "http://trusttasks.org/spec/conformance/widget/0.1" }))], { mutants: ["noTypeCheck"] }),
  v("ENV-007", "Type URI with an upper-case slug", 1, ["framework 6.1", "SPEC.md:871 (the slug MUST match the lower-case grammar)", "SPEC.md:1013 (7.2 item 3)", "SPEC.md:1071 (the error reply is a SHOULD)"],
    [refuseShould(["unsupportedType", "malformedRequest"], req({ type: "https://trusttasks.org/spec/conformance/Widget/0.1" }))], { mutants: ["noTypeCheck"] }),
  v("ENV-008", "a type URI under /spec/ whose slug names no served task is refused", 1, ["SPEC.md:866 (types compare by exact string equality)", "SPEC.md:1013 (7.2 item 3)", "SPEC.md:1071 (the error reply is a SHOULD)"],
    [refuseShould(["unsupportedType", "malformedRequest"], req({ type: "https://trusttasks.org/spec/bindings/https/0.3" }))], { mutants: ["noTypeCheck"] }),
  v("ENV-009", "unknown type", 1, ["SPEC.md:1013 (7.2 item 3)", "SPEC.md:1299 (unsupportedType: the type URI is not recognized)", "SPEC.md:1071 (the error reply is a SHOULD)"],
    [refuseShould("unsupportedType", req({ type: "https://trusttasks.org/spec/conformance/gadget/0.1" }))], { mutants: ["noTypeCheck"] }),
  v("ENV-010", "wrong MAJOR version of a served specification", 1, ["SPEC.md:756 (5.2)", "SPEC.md:1013 (7.2 item 3)"],
    [refuse("unsupportedVersion", req({ type: "$carrierMajor" }))], { mutants: ["noTypeCheck"] }),
  v("ENV-011", "payload that violates the payload schema", 1, ["SPEC.md:1012 (7.2 item 2)", "SPEC.md:1071 (the error reply is a SHOULD)"],
    [refuseShould("malformedRequest", req({ payload: CARRIER_BAD }))], { mutants: ["noPayloadValidation"] }),
  v("ENV-012", "unknown top-level member is preserved and not acted on", 1, ["SPEC.md:1067 (7.2 consumer rules: a conforming consumer SHOULD preserve, but MUST NOT act upon, members it does not recognize)", "SPEC.md:142 (a Trust Task document MAY contain additional top-level members)", "SPEC.md:1011-1023 (7.2)"],
    [ok({ "x-unrecognised": { anything: 1 } })]),
  v("ENV-013", "closed payload: an unknown payload member is refused", 2, ["profile:attested (closed payloads)"],
    [refuse("malformedRequest", req({ payload: CARRIER_EXTRA }))], { mutants: ["openPayload"] }),
  v("ENV-014", "timestamps in any RFC 3339 spelling are accepted and verified over the received bytes", 1,
    ["framework 4.2", "fixtures/proof eddsa-jcs-2022-timestamp-spellings"],
    [ok({ issuedAt: "2026-11-12T10:00:00.000Z" })]),
]);

const rsp = file("RSP", [
  v("RSP-001", "success response: type, thread, parties, fresh id", 1, ["framework 4.4.1", "framework 4.9"],
    [ok()], { mutants: ["reuseRequestIdInReply", "wrongReplyThread", "swapRecipientInReply"] }),
  v("RSP-002", "response continues the request's thread", 1, ["framework 4.9"],
    [{ send: req({ threadId: "$id(thread)" }), expect: { disposition: "response", pointer: { "/threadId": "$id(thread)" }, state: { handled: 1 } } }],
    { mutants: ["wrongReplyThread"] }),
  v("RSP-004", "tier 2: the response is signed by the IUT with purpose authentication, whole-second timestamps", 2,
    ["profile:attested (proof on every response)", "framework 7.3"], [ok()],
    { mutants: ["unsignedReplies", "wholeMillisecondTimestamps"] }),
]);

// ---------------------------------------------------------------- ERR, ID, LIF
const err = file("ERR", [
  v("ERR-001", "error shape, threading, inResponseTo and bounded details", 1, ["framework 8.2", "framework 8.2.2", "framework 8.4"],
    [{
      at: "+0s",
      send: req({ expiresAt: "$nowAt(-windowSkew,-10s)", issuedAt: "$nowAt(-windowSkew,-20s)" }),
      expect: { disposition: "error", code: "expired", retryable: false, noSideEffect: true,
        pointer: { "/payload/inResponseTo/typeUri": "$carrier", "/payload/inResponseTo/id": "$id(req)" } },
    }],
    { mutants: ["errorWithoutRetryable", "wrongReplyThread", "reuseRequestIdInReply", "oversizedDetails", "expiredAsMalformed"] }),
  v("ERR-002", "an inbound error is never answered", 1, ["docs/05 section 1.1 (VTI precedent: an inbound error is dropped, not answered); no specification sentence states it"],
    [{ send: { template: "error.inbound" }, expect: { disposition: "silence", noSideEffect: true } }],
    { mutants: ["answerInboundErrors"] }),
  v("ERR-003", "tier 2: errors are signed by the IUT", 2, ["profile:attested (proof on every error)"],
    [refuse("malformedRequest", req({ payload: CARRIER_BAD }))], { mutants: ["unsignedReplies"] }),
]);

const id = file("ID", [
  v("ID-001", "wrong recipient", 1, ["SPEC.md:1015 (7.2 item 5)", "SPEC.md:1071 (the error reply is a SHOULD)"],
    [refuseShould("wrongRecipient", req({ recipient: "$X" }))], { mutants: ["noRecipientCheck", "replyIssuerFromRequest"] }),
  v("ID-002", "transport sender differs from issuer: identityMismatch to the sender, no leak, no echoed id", 1,
    ["SPEC.md:1016 (7.2 item 6)", "SPEC.md:1071 (the error reply is a SHOULD)", "SPEC.md:1221 (no identityMismatch error without a transport sender)", "framework 8.1", "framework 8.2", "framework 8.2.1"],
    [refuseShould("identityMismatch", req({}, { from: { spoof: "X" } }))], { requires: ["carrier:consequential", "optional:transportIdentity"], mutants: ["ignoreTransportIdentity", "leakIdentityInMessage"] }),
]);

const lif = file("LIF", [
  v("LIF-001", "a responded document stays responded; an inbound error does not change it", 1, ["framework 4.12 (responded is terminal)"],
    [ok(), { send: { template: "error.inbound" }, expect: { disposition: "silence", state: { handled: 1, documentState: { "$id(req)": "responded" } } } }],
    { mutants: ["errorFlipsState", "answerInboundErrors"] }),
  v("LIF-002", "a document refused before acceptance writes no record: a corrected resend under the same id is accepted", 1,
    ["framework 4.12 (the record is written at accepted)", "SPEC.md:1021 (7.2 item 11)", "SPEC.md:1071 (the error reply is a SHOULD)"],
    [{ send: req({ payload: CARRIER_BAD }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true, ...SR } },
     { at: "+1s", send: req(), expect: { disposition: "response", state: { handled: 1 } } }],
    { mutants: ["burnIdOnRefusal"] }),
  v("LIF-003", "task control not supported: unsupportedType, nothing cancelled", 1, ["SPEC.md:1700 (11.8 a consumer that does not implement control rejects it with unsupportedType)", "SPEC.md:1013 (7.2 item 3)", "SPEC.md:1071 (the error reply is a SHOULD)"],
    [{ send: { template: "control.cancel" }, expect: { disposition: "error", code: "unsupportedType", noSideEffect: true, ...SR } }],
    { skipIfOptional: ["control"], mutants: ["controlAccepted"] }),
]);

// ---------------------------------------------------------------- PRF (native wire vectors + imported fixtures)
const prf: Vector[] = [];
const proofManifest = JSON.parse(readFileSync(join(root, "vectors/imported/proof/manifest.json"), "utf8")) as {
  entries: { file: string; cryptosuite: string; expect: "valid" | "invalid"; why: string; exceptions?: unknown }[];
};
const PROVENANCE_SRC_RCPT = "dtgwg-trust-tasks-tf specs/trust-ceremony-receipt/0.1 (see vectors/imported/PROVENANCE.json)";
const PROVENANCE_SRC = "dtgwg-trust-tasks-tf fixtures/proof (see vectors/imported/PROVENANCE.json)";
// Fixture rows whose "invalid" verdict goes beyond the text the fixture cites. Each is reported as CLARIFY and never gates
// (docs/04 section 8); the vector, its fixture and its mutants are unchanged. The basis is quoted in results/vector-review.md.
const PROOF_CLARIFY: Record<string, string> = {
  "eddsa-jcs-2022-expires-hour-24.json":
    "The proof's expires is a W3C Data Integrity dateTimeStamp, which is an XML Schema 1.1 dateTime: its lexical form admits endOfDayFrag (24:00:00), so 2999-01-01T24:00:00Z is lexically valid there; the fixture note 'hours run 00-23' is the RFC 3339 range that SPEC.md applies to issuedAt and expiresAt, not to proof members. A task-force decision is needed on which range governs proof timestamps. Not gating.",
  "eddsa-jcs-2022-created-hour-24.json":
    "The proof's created is a W3C Data Integrity dateTimeStamp, which is an XML Schema 1.1 dateTime: its lexical form admits endOfDayFrag (24:00:00), so 2026-09-15T24:00:00Z is lexically valid there; the fixture treats hour 24 as malformed under the RFC 3339 range that SPEC.md applies to issuedAt and expiresAt, not to proof members. A task-force decision is needed on which range governs proof timestamps. Not gating.",
  "eddsa-jcs-2022-small-order-key.json":
    "RFC 8032 section 5.1.7 step 3 checks [8][S]B = [8]R + [8][k]A' and says it is 'sufficient, but not required, to instead check [S]B = R + [k]A''; neither decoding (section 5.1.3) nor verification requires rejecting a public key of small order, and this signature satisfies both equations. Refusing it is the stricter verify_strict practice, which neither SPEC.md nor the Data Integrity EdDSA text requires. A task-force decision is needed on whether the baseline requires strict verification. Not gating.",
  "eddsa-jcs-2022-mixed-order-r.json":
    "RFC 8032 section 5.1.7 step 3 lets a verifier check either the cofactored equation [8][S]B = [8]R + [8][k]A' or, 'sufficient, but not required', the cofactorless one, and section 8.8 notes the choice changes which signatures are valid. This fixture satisfies only the cofactored equation, so a verifier that follows the RFC's primary equation accepts it. Neither SPEC.md nor the Data Integrity EdDSA text requires the cofactorless check. A task-force decision is needed on whether the baseline fixes one equation. Not gating.",
};
let n = 1;
for (const e of proofManifest.entries) {
  const rest: Partial<Vector> = {
    requires: ["optional:proofVerify", `cryptosuite:${e.cryptosuite}`],
    origin: { source: PROVENANCE_SRC, fixture: `proof/${e.file}` },
  };
  if (e.expect === "invalid") rest.mutants = ["acceptUnverifiedProof"];
  if (PROOF_CLARIFY[e.file] !== undefined) rest.clarify = PROOF_CLARIFY[e.file];
  prf.push(v(`PRF-${String(n++).padStart(3, "0")}`, `${e.file.replace(".json", "")}: must be ${e.expect}`, 1,
    ["framework 4.7", "framework 4.7.1", "framework 4.7.3", `fixtures/proof/${e.file}`],
    [{ verifyProof: { file: `proof/${e.file}`, expect: e.expect } }], rest));
}
const signedAs = (purpose: string) => ({ as: "A", purpose });
prf.push(
  v("PRF-101", "payload tampered after signing", 1, ["framework 4.7", "SPEC.md:1017 (7.2 item 7)"],
    [refuseShould("proofInvalid", req({}, { mutate: [{ op: "set", path: "/threadId", value: "urn:uuid:tampered", afterSign: true }] }))],
    { mutants: ["acceptUnverifiedProof"] }),
  v("PRF-102", "proofPurpose keyAgreement never authorises a signature", 1, ["framework 4.7.3"],
    [refuseShould("proofInvalid", req({}, { sign: signedAs("keyAgreement") }))], { mutants: ["acceptUnverifiedProof"] }),
  v("PRF-103", "tier 2: proofPurpose is pinned to authentication", 2, ["profile:attested (purpose pin)", "framework 4.7.3"],
    [refuse("proofInvalid", req({}, { sign: signedAs("assertionMethod") }))], { mutants: ["anyProofPurpose"] }),
  v("PRF-104", "unknown cryptosuite is refused, never processed as unsigned", 1, ["framework 4.7.1"],
    [refuseShould("proofInvalid", req({}, { mutate: [{ op: "set", path: "/proof/cryptosuite", value: "unknown-suite-2099", afterSign: true }] }))],
    { mutants: ["acceptUnverifiedProof"] }),
  v("PRF-105", "verification method controlled by a party other than issuer", 1, ["framework 4.7", "SPEC.md:1017 (7.2 item 7)"],
    [refuseShould("proofInvalid", req({}, { sign: { as: "X", allowIssuerMismatch: true } }))], { mutants: ["acceptUnverifiedProof"] }),
  v("PRF-106", "proof without a recipient on a non-bearer task", 1, ["framework 4.8.2", "SPEC.md:1018 (7.2 item 8)"],
    [refuseShould("malformedRequest", req({ recipient: omit }))], { mutants: ["ignoreAudienceBinding"] }),
  v("PRF-107", "tier 2: a request without proof is refused", 2, ["profile:attested (proof on every request)", "SPEC.md:1017 (7.2 item 7)"],
    [refuse("proofRequired", req({}, { sign: null }))], { mutants: ["proofOptional", "proofRequiredAsInvalid"] }),
  v("PRF-108", "tier 1: an unsigned request to a task that does not require proof is accepted", 1, ["framework 7.3 (proof only where the task requires it)"],
    [{ send: req({}, { sign: null }), expect: { disposition: "response", state: { handled: 1 } } }], { exactTier: true, skipIfOptional: ["attested"] }),
);

// ---------------------------------------------------------------- TIME (rows of fixtures/consume/freshness.json, consequential policy)
interface FRow { name: string; policy: string; now: string; issuedAt?: string; expiresAt?: string; verdict: string }
const fresh = JSON.parse(readFileSync(join(root, "vectors/imported/consume/freshness.json"), "utf8")) as { cases: FRow[] };
const time: Vector[] = [];
let tn = 1;
const EDGE = /exactly|one millisecond/;
for (const row of fresh.cases.filter((c) => c.policy === "consequential")) {
  const params: Record<string, unknown> = {
    issuedAt: row.issuedAt ?? omit,
    ...(row.expiresAt === undefined ? {} : { expiresAt: row.expiresAt }),
  };
  const accept = row.verdict === "accept";
  const code = row.verdict;
  const step: Step = accept
    ? { send: req(params), expect: { disposition: "response", state: { handled: 1 } } }
    : refuseShould(code, req(params));
  const mutants = accept ? undefined : /calendar-invalid/.test(row.name) ? ["noTimeChecks", "rollOverDates"] : EDGE.test(row.name) && !/past it/.test(row.name) && code === "expired" ? ["noTimeChecks", "windowOffByOne"] : ["noTimeChecks"];
  time.push(v(`TIME-${String(tn++).padStart(3, "0")}`, row.name, 1, ["SPEC.md:1014 and SPEC.md:1023 (7.2 items 4 and 13)", "fixtures/consume/freshness.json"], [step], {
    clockStart: row.now,
    // the fixture row states absolute instants for the profile window; within seconds of an edge it needs exact clock control
    profileWindow: true,
    ...(EDGE.test(row.name) || /issuedAt with an offset/.test(row.name) ? { exactClock: true } : {}),
    origin: { source: PROVENANCE_SRC.replace("fixtures/proof", "fixtures/consume"), fixture: "consume/freshness.json", row: row.name },
    ...(mutants === undefined ? {} : { mutants }),
  }));
}

// The window numbers are not framework text. These vectors take the implementation's declared window (else the profile pins):
// windowMaxAge, windowSkew and windowHorizon below are that window's members (docs/04 section 6).
time.push(v("TIME-101", "issuedAt two minutes past the declared maximum age plus skew, no expiresAt: expired (8 minutes at the profile window)", 1, ["SPEC.md:1014 (7.2 item 4)", "SPEC.md:1035 (a consumer MUST NOT accept a document older than its own window)", "SPEC.md:1043 (no default maximum age is named; the window is the implementation's declared one)"],
  [refuseShould("expired", req({ issuedAt: "$nowAt(-windowMaxAge,-windowSkew,-120s)" }))], { requires: ["window:declared"], mutants: ["wideWindow10min", "noTimeChecks"] }));

time.push(v("TIME-102", "issuedAt four minutes beyond the declared skew in the future is malformed, not expired", 1, ["SPEC.md:1023 (7.2 item 13)", "fixtures/consume/freshness.json (future issuedAt rows)"],
  [refuseShould("malformedRequest", req({ issuedAt: "$nowAt(+windowSkew,+240s)" }))], { mutants: ["futureIssuedAtAsExpired", "noTimeChecks"] }));

time.push(v("TIME-104", "issuedAt inside the declared maximum age is accepted", 1, ["SPEC.md:1014 and SPEC.md:1023 (7.2 items 4 and 13)"],
  [{ send: req({ issuedAt: "$nowAt(-windowMaxAge,+30s)" }), expect: { disposition: "response", state: { handled: 1 } } }]));

time.push(v("TIME-105", "issuedAt thirty seconds past the declared maximum age plus skew is expired", 1, ["SPEC.md:1014 and SPEC.md:1023 (7.2 items 4 and 13)"],
  [refuseShould("expired", req({ issuedAt: "$nowAt(-windowMaxAge,-windowSkew,-30s)" }))], { requires: ["window:declared"], mutants: ["wideWindow10min", "noTimeChecks"] }));

// ---------------------------------------------------------------- DUP
const dup: Vector[] = [
  v("DUP-001", "byte-identical resend is absorbed and the prior response returned", 1, ["SPEC.md:1055 (7.2 item 11, Disposition of a duplicate)"],
    [ok(), { at: "+5s", send: { same: "previous" }, expect: { disposition: "duplicate", state: { handled: 1 } } }],
    { mutants: ["noReplayRecord", "duplicateAsFailure"] }),
  v("DUP-002", "same id, re-signed proof: idConflict", 1, ["SPEC.md:1033 (7.2 item 11, Keying and comparison)"],
    [ok(), { at: "+5s", send: { same: "previous", sign: { as: "A", created: "+0s" } }, expect: { disposition: "error", code: "idConflict", retryable: false, noSideEffect: true, ...SR } }],
    { mutants: ["idOnlyDuplicateKey"] }),
  v("DUP-003", "same id, different payload: idConflict, not a duplicate and not taskFailed", 1, ["SPEC.md:1033 (7.2 item 11, Keying and comparison)"],
    [ok(), { at: "+5s", send: { same: "previous", mutate: [{ op: "set", path: "/threadId", value: "urn:uuid:other-content" }], sign: { as: "A" } },
      expect: { disposition: "error", code: "idConflict", noSideEffect: true, ...SR } }],
    { mutants: ["idOnlyDuplicateKey"] }),
  v("DUP-004", "same members in another order and whitespace are the same document", 1, ["SPEC.md:1033 (7.2 item 11, Keying and comparison: RFC 8785)"],
    [ok(), { at: "+5s", send: { same: "previous", mutate: [{ op: "reorder" }] }, expect: { disposition: "duplicate", state: { handled: 1 } } }],
    { mutants: ["noReplayRecord"] }),
  v("DUP-005", "resend after the record window is refused expired and never re-executed", 1, ["SPEC.md:1035 (7.2, Bounding the record)", "SPEC.md:1043 (the window is the consumer's own)", "SPEC.md:1071 (the error reply is a SHOULD)"],
    [ok(), { at: "+windowMaxAge+windowSkew+0s", send: { same: "previous" }, expect: { disposition: "error", code: "expired", noSideEffect: true, ...SR } }],
    { requires: ["window:declared"], mutants: ["noReplayRecord", "noFreshnessWindow"] }),
  v("DUP-009", "same id after the first attempt was refused for its proof: the corrected resend under the same id", 1,
    ["SPEC.md:1021 (7.2 item 11: keyed on id; the record is written at accepted, 4.12)", "docs/05 V9 (VTI claims the id only after the proof verifies and releases a refused claim)"],
    [{ send: req({}, { mutate: [{ op: "set", path: "/threadId", value: "urn:uuid:tampered", afterSign: true }] }), expect: { disposition: "error", code: "proofInvalid", noSideEffect: true, ...SR } },
     { at: "+1s", send: req(), expect: { disposition: "response", state: { handled: 1 } } }],
    { clarify: "The framework keys the duplicate record on id and writes it at accepted; it does not say whether an attempt refused before acceptance (here for its proof) leaves the id free for a corrected resend. VTI releases a refused claim, so an unauthenticated sender cannot squat an id; an implementation that burns the id also keeps within the text. Not gating.", mutants: ["burnIdOnRefusal"] }),
  v("DUP-010", "same id from another issuer: the second document is a different document under the same id", 1,
    ["SPEC.md:1033 (7.2 item 11, Keying and comparison: the key is the id)", "docs/05 V9"],
    [ok(), { at: "+1s", send: req({ issuer: "$X" }, { from: "X", sign: { as: "X" } }), expect: { disposition: "error", code: "idConflict", noSideEffect: true, ...SR } }],
    { clarify: "Item 11 keys the record on id alone; whether the issuer is part of the key (so another issuer's reuse of the id is a new document) is not stated, and implementations differ. The vector asserts the id-only reading (idConflict). Not gating.", mutants: ["idOnlyDuplicateKey"] }),
];
const item11 = JSON.parse(readFileSync(join(root, "vectors/imported/consume/item11-digest.json"), "utf8")) as {
  consumer: string; now: string; first: string;
  cases: { name: string; first?: string; second: string; secondAt?: string; expect: string }[];
};
let dn = 101;
for (const c of item11.cases) {
  const send = (raw: string): NonNullable<Step["send"]> => ({ raw, substitute: { [item11.consumer]: "$iut" }, from: "none" });
  const first = c.first ?? item11.first;
  const secondStep: Step = {
    ...(c.secondAt === undefined ? {} : { atAbsolute: c.secondAt }),
    send: send(c.second),
    expect: c.expect === "duplicate"
      ? { disposition: "duplicate", state: { handled: 1 } }
      : { disposition: "error", code: c.expect, noSideEffect: true, ...SR },
  };
  const rest: Partial<Vector> = {
    exactTier: true,
    skipIfOptional: ["attested"],
    clockStart: item11.now,
    ...(c.secondAt === undefined ? {} : { profileWindow: true }),
    origin: { source: PROVENANCE_SRC.replace("fixtures/proof", "fixtures/consume"), fixture: "consume/item11-digest.json", row: c.name },
  };
  if (/extra payload member/.test(c.name)) rest.requires = ["carrier:openPayload"];
  if (c.expect === "idConflict") rest.mutants = ["idOnlyDuplicateKey"];
  else if (c.expect === "expired") rest.mutants = ["windowOffByOne", "noReplayRecord"];
  else rest.mutants = ["noReplayRecord"];
  dup.push(v(`DUP-${dn++}`, `${c.name} (unsigned, as the shared fixture states it)`, 1, ["SPEC.md:1021 (7.2 item 11)", "fixtures/consume/item11-digest.json"],
    [{ send: send(first), expect: { disposition: "response", state: { handled: 1 } } }, secondStep], rest));
}


// ---------------------------------------------------------------- VRC-PRO and VRC-ISS (the IUT is the counterparty / receiving party)
const PRO_T = "https://trusttasks.org/spec/vrc/relationships/propose/0.1";
const ISS_T = "https://trusttasks.org/spec/vrc/relationships/issue/0.1";
const PS = "specs/vrc/relationships/propose/0.1/spec.md";
const IS = "specs/vrc/relationships/issue/0.1/spec.md";
const FWS = "SPEC.md";
const VRC_PRO_FAMILY = "vrc-propose";
const VRC_ISS_FAMILY = "vrc-issue";
const VRC_REQ = [PRO_T, "optional:trigger.consent"];
const policy = (propose: "accept" | "decline" | "hold", witnessed = false): Step => ({
  trigger: { action: "policy", args: { propose, ...(witnessed ? { witnessed: true } : {}) } },
});
type SendOver = Partial<NonNullable<Step["send"]>>;
const prop = (extra: Record<string, unknown> = {}, more: SendOver = {}): NonNullable<Step["send"]> => ({
  template: "propose.request", ...(Object.keys(extra).length > 0 ? { params: extra } : {}), ...more,
});
const issue = (vrc: NonNullable<NonNullable<Step["send"]>["vrc"]> | null = {}, extra: Record<string, unknown> = {}, more: SendOver = {}): NonNullable<Step["send"]> => ({
  template: "issue.request", ...(vrc === null ? {} : { vrc }), ...(Object.keys(extra).length > 0 ? { params: extra } : {}), ...more,
});
const proposeAccepted = (): Step => ({
  send: prop(), capture: { ibr: "/payload/relationshipDid" },
  expect: { disposition: "response", type: `${PRO_T}#response`, match: { "/payload/relationshipDid": "^did:" }, state: { handled: 1 } },
});
/** Accepted exchange: the human has pre-accepted, the proposal is answered, the IUT's relationship DID is captured as `ibr`. */
const accepted = (): Step[] => [policy("accept"), proposeAccepted()];
const receipt = (digestName = "vrc"): NonNullable<Step["expect"]> => ({
  disposition: "response", type: `${ISS_T}#response`, pointer: { "/payload/vrcDigestMultibase": `$digest(${digestName})` },
});
const notAccepted = (): NonNullable<Step["expect"]> => ({
  disposition: "error", code: "vrc/relationships/issue:notAccepted", retryable: false, noSideEffect: true, state: { stored: 0 },
  pointer: { "/payload/inResponseTo/typeUri": ISS_T, "/payload/inResponseTo/id": "$id(iss)" },
});
const pv = (id: string, title: string, tier: 1 | 2, spec: string[], steps: Step[], rest: Partial<Vector> = {}): Vector =>
  v(id, title, tier, spec, steps, { requires: VRC_REQ, ...rest });
const iv = (id: string, title: string, tier: 1 | 2, spec: string[], steps: Step[], rest: Partial<Vector> = {}): Vector =>
  v(id, title, tier, spec, steps, { requires: [ISS_T, ...VRC_REQ], ...rest });
/** A hold is a next step (framework 8.6): the originating type with continuation resubmit, since propose offers no status task. */
const held = (reqName = "req"): NonNullable<Step["expect"]> => ({
  disposition: "next-step", noSideEffect: true,
  pointer: {
    "/threadId": "$id(req)",
    "/payload/expects/0/typeUri": PRO_T,
    "/payload/continuation": "resubmit",
    "/payload/inResponseTo/typeUri": PRO_T,
    "/payload/inResponseTo/id": `$id(${reqName})`,
  },
});
const HOLD_MUTANTS = ["holdAnswersError", "holdAutoAccepts", "silentHold", "holdEmptyExpects", "holdExpectsOtherType", "holdContinuationProceed", "holdNoInResponseTo", "holdNextStepOpenPayload"];

const vrcPro = file("VRC-PRO", [
  pv("VRC-PRO-001", "an accepted proposal is answered with a #response: accept true and the counterparty's own relationshipDid", 1,
    [`${PS}:82-85 (counterparty items 1-2)`, `${PS}:76-79 (proposer items 1-2)`, `${FWS}:1009-1015 (7.2 pipeline)`],
    [policy("accept"), { send: prop(), expect: { disposition: "response", type: `${PRO_T}#response`, pointer: { "/payload/accept": true }, match: { "/payload/relationshipDid": "^did:" }, state: { handled: 1 } } }]),
  pv("VRC-PRO-002", "the acceptance names the counterparty's own relationship DID, not the proposer's", 1,
    [`${PS}:85 (returns a #response with its own relationshipDid)`, "specs/vrc/relationships/propose/0.1/payload.schema.json (Response.relationshipDid: the DID the counterparty will use)"],
    [policy("accept"), { send: prop(), expect: { disposition: "response", type: `${PRO_T}#response`, notEqual: { "/payload/relationshipDid": ["$R", "$A", "$iut"] }, match: { "/payload/relationshipDid": "^did:" }, state: { handled: 1 } } }],
    { mutants: ["echoProposerDid"] }),
  pv("VRC-PRO-003", "a decline is a trust-task-error vrc/relationships/propose:declined, not a response", 1,
    [`${PS}:87 (counterparty item 4)`, `${PS}:38-41 (errorCodes)`, "specs/vrc/relationships/propose/0.1/payload.schema.json (Response.accept const true)", `${FWS}:1350-1356 (8.5 extended codes)`],
    [policy("decline"), { send: prop(), expect: { disposition: "error", code: "vrc/relationships/propose:declined", retryable: false, noSideEffect: true,
      pointer: { "/payload/inResponseTo/typeUri": PRO_T, "/payload/inResponseTo/id": "$id(req)", "/threadId": "$id(req)" } } }],
    { mutants: ["declineAsResponse", "declineWrongCode"] }),
  pv("VRC-PRO-004", "a proposal naming no relationshipDid is refused", 1,
    ["specs/vrc/relationships/propose/0.1/payload.invalid-examples.json example 1", `${FWS}:1012 (7.2 item 2)`, `${FWS}:1071 (the error reply is a SHOULD)`],
    [{ send: prop({ payload: { witnessed: true } }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true, ...SR } }], { mutants: ["noPayloadValidation"] }),
  pv("VRC-PRO-005", "a relationshipDid that is not a DID is refused", 1,
    ["specs/vrc/relationships/propose/0.1/payload.invalid-examples.json example 2", "specs/vrc/relationships/propose/0.1/payload.schema.json (pattern ^did:)", `${FWS}:1012 (7.2 item 2)`, `${FWS}:1071 (the error reply is a SHOULD)`],
    [{ send: prop({ payload: { relationshipDid: "alice-relationship-1" } }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true, ...SR } }], { mutants: ["noPayloadValidation"] }),
  pv("VRC-PRO-006", "an unknown payload member is refused (the payload is closed)", 1,
    ["specs/vrc/relationships/propose/0.1/payload.invalid-examples.json example 3", "specs/vrc/relationships/propose/0.1/payload.schema.json (additionalProperties false)", `${FWS}:1012 (7.2 item 2)`, `${FWS}:1071 (the error reply is a SHOULD)`],
    [{ send: prop({ payload: { relationshipDid: "did:key:z6MkRelationshipProposer", nickname: "Alice from the workshop" } }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true, ...SR } }],
    { mutants: ["openPayload"] }),
  pv("VRC-PRO-007", "witnessed is a request: an acceptance that does not agree does not claim a witnessed exchange", 1,
    [`${PS}:86 (silence accepts an unwitnessed exchange)`, `${PS}:103-108 (witnessing is agreed, not assumed)`],
    [policy("accept", false), { send: prop({ payload: { relationshipDid: "$R", witnessed: true } }), expect: { disposition: "response", type: `${PRO_T}#response`, notEqual: { "/payload/witnessed": [true] }, state: { handled: 1 } } }],
    { mutants: ["mirrorWitnessed"] }),
  pv("VRC-PRO-008", "while the human decides the proposal is answered with a next-step that names a resubmission, never an error, a terminal reply or silence", 1,
    [`${FWS}:1414 (8.6: a hold is a next step, never an error)`, `${FWS}:1416-1418 (expects names the originating Type URI with continuation resubmit where the consumer offers no status task)`, `${FWS}:682 (4.12 accepted row)`, `${PS}:97-101 (acceptance is not issuance)`, "specs/trust-task-next-step/0.1/payload.schema.json"],
    [policy("hold"), { send: prop(), expect: { ...held(), state: { documentState: { "$id(req)": "accepted" } } } }],
    { mutants: HOLD_MUTANTS }),
  pv("VRC-PRO-009", "a held proposal the human then accepts is answered with the acceptance on the proposal's thread", 1,
    [`${PS}:82-85`, `${FWS}:450-462 (4.9 threadId)`, `${FWS}:672-690 (4.12 lifecycle)`],
    [policy("hold"), { send: prop(), expect: held() },
     { trigger: { action: "consent", args: { exchangeId: "$id(req)", decision: "accept" } }, expect: { disposition: "response", type: `${PRO_T}#response`, pointer: { "/threadId": "$id(req)", "/payload/accept": true }, state: { handled: 1, documentState: { "$id(req)": "responded" } } } }],
    { mutants: ["holdAutoAccepts"] }),
  pv("VRC-PRO-010", "a held proposal the human then declines is answered with the decline", 1,
    [`${PS}:87`, `${FWS}:1414-1420 (a declined hold is refused as a refusal)`],
    [policy("hold"), { send: prop(), expect: held() },
     { trigger: { action: "consent", args: { exchangeId: "$id(req)", decision: "decline" } }, expect: { disposition: "error", code: "vrc/relationships/propose:declined", retryable: false, noSideEffect: true, pointer: { "/threadId": "$id(req)" }, state: { documentState: { "$id(req)": "errored" } } } }],
    { mutants: ["declineWrongCode", "declineAsResponse"] }),
  pv("VRC-PRO-011", "tier 1: an unsigned proposal is accepted (propose declares proof OPTIONAL)", 1,
    [`${PS}:23-31 (proofRequirement request OPTIONAL)`, `${FWS}:1017 (7.2 item 7: proofRequired only where the specification requires proof)`],
    [policy("accept"), { send: prop({}, { sign: null }), expect: { disposition: "response", type: `${PRO_T}#response`, state: { handled: 1 } } }],
    { exactTier: true, skipIfOptional: ["attested"] }),
  pv("VRC-PRO-012", "tier 2: an unsigned proposal is refused proofRequired", 2,
    ["profile:attested (proof on every request)", `${PS}:23-31 (OPTIONAL in the specification; strengthened by the profile)`],
    [policy("accept"), { send: prop({}, { sign: null }), expect: { disposition: "error", code: "proofRequired", noSideEffect: true } }], { mutants: ["proofOptional", "proofRequiredAsInvalid"] }),
  pv("VRC-PRO-013", "tier 2: the acceptance is signed by the IUT, purpose authentication, whole-second timestamps", 2,
    ["profile:attested (proof on every response)", `${PS}:23-31 (response proof OPTIONAL in the specification)`],
    [policy("accept"), { send: prop(), expect: { disposition: "response", type: `${PRO_T}#response`, state: { handled: 1 } } }], { mutants: ["unsignedReplies", "wholeMillisecondTimestamps"] }),
  pv("VRC-PRO-014", "the proposal goes through the framework pipeline: wrong recipient", 1,
    [`${PS}:84 (counterparty item 1: SPEC.md 7.2 pipeline)`, `${FWS}:1015 (7.2 item 5)`, `${FWS}:1071 (the error reply is a SHOULD)`],
    [policy("accept"), { send: prop({ recipient: "$X" }), expect: { disposition: "error", code: "wrongRecipient", noSideEffect: true, ...SR } }], { mutants: ["noRecipientCheck"] }),
  pv("VRC-PRO-015", "the proposal goes through the framework pipeline: transport sender differs from issuer", 1,
    [`${PS}:84`, `${FWS}:1016 (7.2 item 6)`, `${FWS}:1071 (the error reply is a SHOULD)`, `${FWS}:1221 (no identityMismatch error without a transport sender)`],
    [policy("accept"), { send: prop({}, { from: { spoof: "X" } }), expect: { disposition: "error", code: "identityMismatch", noSideEffect: true, ...SR } }], { requires: [...VRC_REQ, "optional:transportIdentity"], mutants: ["ignoreTransportIdentity"] }),
  pv("VRC-PRO-016", "profile: a relationshipDid equal to the proposer's connection identifier is refused", 1,
    [`${PS}:79 ("not a long-term identifier": inequality with the connection DID is a checkable inference, not specification text)`, "docs/06 section 2.2 and 3.10", "docs/07 O17, O26"],
    [policy("accept"), { send: prop({ payload: { relationshipDid: "$A" } }), expect: { disposition: "any-refusal", noSideEffect: true } }],
    { clarify: "Profile rule, not specification text: nothing normative says the relationship DID must differ from the connection DID (docs/07 O26; relationship DIDs unique per VRC is the user's decision, stricter than the specifications). Not gating.", mutants: ["acceptConnectionDid"] }),
  pv("VRC-PRO-017", "profile: a relationshipDid already used in an earlier exchange is refused (unique per VRC)", 1,
    [`${PS}:79 (minted for this relationship)`, "docs/06 section 3.10 (per-VRC uniqueness)", "docs/07 O17, O21, O26"],
    [policy("accept"), proposeAccepted(),
     { at: "+10s", send: prop({ id: "$id(req2)", threadId: "$id(req2)" }), expect: { disposition: "any-refusal", noSideEffect: true } }],
    { clarify: "Per-VRC uniqueness is stricter than the specifications' per-relationship wording (docs/07 O26, O21); the specifications do not forbid reuse with the same counterparty. Not gating.", mutants: ["noRelationshipDidReuseCheck"] }),
  pv("VRC-PRO-018", "a relationshipDid already recorded for another counterparty is refused", 1,
    [`${PS}:79`, "specs credential: a pairwise identifier MUST NOT be used with more than one counterparty (CRED/body.md:381)", "docs/07 O26"],
    [policy("accept"), proposeAccepted(),
     { at: "+10s", send: prop({ issuer: "$X", id: "$id(req2)", threadId: "$id(req2)" }, { from: "X" }), expect: { disposition: "any-refusal", noSideEffect: true } }],
    { clarify: "The credential specification forbids using a pairwise identifier with a second counterparty; what the propose receiver must do on seeing one is not stated (docs/07 O26). Not gating.", mutants: ["noRelationshipDidReuseCheck"] }),
  pv("VRC-PRO-019", "tier 2: the next-step answering a hold is signed by the IUT, purpose authentication, whole-second timestamps", 2,
    [`${FWS}:1414-1418 (8.6 a hold is a next step)`, "specs/trust-task-next-step/0.1/spec.md (proof RECOMMENDED; the attested profile requires it on every reply)", "profile:attested (proof on every response)"],
    [policy("hold"), { send: prop(), expect: held() }],
    { mutants: ["silentHold", "unsignedReplies", "wholeMillisecondTimestamps"] }),
  pv("VRC-PRO-020", "a resubmission (fresh id, same thread) while the human still decides is answered with a further next-step", 1,
    [`${FWS}:1417 (the consumer answers a resubmission in the same thread with a further next step while the act is awaited)`, "specs/trust-task-next-step/0.1/spec.md (consumer rule 5: resubmission is a new document with a fresh id and the same threadId)"],
    [policy("hold"), { send: prop(), expect: held() },
     { at: "+10s", send: prop({ id: "$id(req2)", threadId: "$id(req)" }), expect: held("req2") }],
    { mutants: ["noResubmitThread", "silentHold"] }),
  pv("VRC-PRO-021", "a resubmission after the human accepted is answered with the acceptance on the proposal's thread, without a second execution", 1,
    [`${FWS}:1417 (the consumer answers a resubmission in the same thread with the outcome once it is known)`, `${PS}:85 (acceptance with its own relationshipDid)`],
    [policy("hold"), { send: prop(), expect: held() },
     { trigger: { action: "consent", args: { exchangeId: "$id(req)", decision: "accept" } }, expect: { disposition: "response", type: `${PRO_T}#response`, state: { handled: 1 } } },
     { at: "+10s", send: prop({ id: "$id(req2)", threadId: "$id(req)" }), expect: { disposition: "response", type: `${PRO_T}#response`, pointer: { "/threadId": "$id(req)", "/payload/accept": true }, match: { "/payload/relationshipDid": "^did:" }, state: { handled: 1, documentState: { "$id(req)": "responded" } } } }],
    { mutants: ["noResubmitThread"] }),
], VRC_PRO_FAMILY);

const vrcIss = file("VRC-ISS", [
  iv("VRC-ISS-001", "a credential delivered inside an accepted exchange is stored and receipted with the digest of the stored credential", 1,
    [`${IS}:98-109 (issuing party items 1-3, receiving party items 1-3)`, `${IS}:83-89 (receipt names the stored artifact)`, `${IS}:49-52`],
    [...accepted(), { send: issue({}), expect: { ...receipt(), pointer: { "/payload/vrcDigestMultibase": "$digest(vrc)", "/threadId": "$id(req)" }, state: { handled: 2, stored: 1 } } }]),
  iv("VRC-ISS-002", "the receipt digest is computed over the stored credential when the request carries none", 1,
    [`${IS}:83-89 (MUST compute the digest over the credential it stored)`, `${IS}:102 (vrcDigestMultibase SHOULD)`, `${IS}:109`],
    [...accepted(), { send: issue({ digest: "none" }), expect: { ...receipt(), state: { stored: 1 } } }], { mutants: ["copyDigest"] }),
  iv("VRC-ISS-003", "a request digest that does not match the credential is not copied into the receipt", 1,
    [`${IS}:86-89 (a copied digest attests nothing about what was stored)`, `${IS}:109`],
    [...accepted(), { send: issue({ digest: "wrong" }), expect: { ...receipt(), state: { stored: 1 } } }],
    { clarify: "The specification says the receipt carries the computed digest but not whether a request digest that disagrees is refused or ignored; the vector accepts only the ignore reading (design docs/04 section 11). Not gating.", mutants: ["copyDigest"] }),
  iv("VRC-ISS-004", "an unsolicited delivery is refused notAccepted however well it verifies", 1,
    [`${IS}:115-122 (authorization is the accepted proposal)`, `${IS}:49-52`, `${FWS}:1020 (7.2 item 10: validation is not authorization)`],
    [{ send: issue({ subject: "$S", issuer: "$R" }), expect: notAccepted() }], { mutants: ["acceptUnsolicited"] }),
  iv("VRC-ISS-005", "a delivery for a proposal that is still held is refused notAccepted", 1,
    [`${IS}:115-122`, `${PS}:97-101 (acceptance is not issuance; a held proposal is not accepted)`],
    [policy("hold"), { send: prop(), expect: held() },
     { send: issue({ subject: "$S" }), expect: notAccepted() }], { mutants: ["acceptUnsolicited"] }),
  iv("VRC-ISS-006", "a delivery for a declined proposal is refused notAccepted", 1,
    [`${IS}:115-122`, `${PS}:87`],
    [policy("decline"), { send: prop(), expect: { disposition: "error", code: "vrc/relationships/propose:declined" } },
     { send: issue({ subject: "$S" }), expect: notAccepted() }], { mutants: ["acceptUnsolicited"] }),
  iv("VRC-ISS-007", "a credential whose issuer is not the relationship DID the proposal exchanged is refused", 1,
    [`${IS}:101 (issuing party item 2)`, `${IS}:108 (party bindings checked before storing)`, `${IS}:50-51`],
    [...accepted(), { send: issue({ issuer: "$Q" }), expect: notAccepted() }], { mutants: ["noPartyBindingCheck"] }),
  iv("VRC-ISS-008", "a credential whose subject is not the receiving party's relationship DID is refused", 1,
    [`${IS}:101`, `${IS}:108`, `${IS}:50-51`],
    [...accepted(), { send: issue({ subject: "$Q" }), expect: notAccepted() }], { mutants: ["noPartyBindingCheck"] }),
  iv("VRC-ISS-009", "a credential whose own proof does not verify is refused", 1,
    [`${IS}:108 (verifies the credential's own proof before storing or receipting)`, `${IS}:146-150 (two proofs, two jobs)`],
    [...accepted(), { send: issue({ corrupt: true }), expect: notAccepted() }], { mutants: ["noVcProofCheck"] }),
  iv("VRC-ISS-010", "a credential proven by a key its issuer does not control is refused", 1,
    [`${IS}:108`, "the credential and Data Integrity specification (the credential proof key is controlled by the issuer; SPEC.md 4.7.3 governs Trust Task document proofs only)"],
    [...accepted(), { send: issue({ signer: "Q" }), expect: notAccepted() }], { mutants: ["noVcProofCheck"] }),
  iv("VRC-ISS-011", "a delivery without an envelope proof is refused proofRequired even when the credential verifies", 1,
    [`${IS}:23-31 (request proof REQUIRED)`, `${IS}:148-150 (never accept an unproofed envelope because the credential verifies)`, `${FWS}:1017 (7.2 item 7)`],
    [...accepted(), { send: issue({}, {}, { sign: null }), expect: { disposition: "error", code: "proofRequired", noSideEffect: true, state: { stored: 0 } } }], { mutants: ["proofOptional", "proofRequiredAsInvalid"] }),
  iv("VRC-ISS-012", "a delivery without issuedAt is refused (issuedAt REQUIRED)", 1,
    [`${IS}:33-35 (issuedAtRequirement REQUIRED)`, `${FWS}:1023 (7.2 item 13) and 7.3 item 17`],
    [...accepted(), { send: issue({}, { issuedAt: omit }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true, state: { stored: 0 } } }], { mutants: ["noFreshnessWindow", "noTimeChecks"] }),
  iv("VRC-ISS-013", "an expired delivery is refused and nothing is stored", 1,
    [`${FWS}:1014 (7.2 item 4)`],
    [...accepted(), { send: issue({}, { issuedAt: "$nowAt(-windowSkew,-20s)", expiresAt: "$nowAt(-windowSkew,-10s)" }), expect: { disposition: "error", code: "expired", noSideEffect: true, state: { stored: 0 } } }], { mutants: ["noTimeChecks", "expiredAsMalformed"] }),
  iv("VRC-ISS-014", "an identical resend is absorbed: the first receipt again, stored once, not executed twice", 1,
    [`${FWS}:1021 (7.2 item 11)`, `${FWS}:1055 (disposition of a duplicate)`, `${IS}:36-38 (sideEffects mutating)`],
    [...accepted(), { send: issue({}), expect: { ...receipt(), state: { stored: 1 } } },
     { at: "+5s", send: { same: "previous" }, expect: { disposition: "duplicate", state: { stored: 1 } } }], { mutants: ["noReplayRecord"] }),
  iv("VRC-ISS-015", "the same id with a different credential is idConflict, nothing new is stored", 1,
    [`${FWS}:1021 (7.2 item 11)`, `${FWS}:1033 (keying and comparison)`],
    [...accepted(), { send: issue({ name: "first" }), expect: { ...receipt("first"), state: { stored: 1 } } },
     { at: "+5s", send: issue({ name: "second", nonce: "other" }), expect: { disposition: "error", code: "idConflict", retryable: false, noSideEffect: true, state: { stored: 1 } } }],
    { mutants: ["idOnlyDuplicateKey"] }),
  iv("VRC-ISS-016", "the same id re-signed over identical content is idConflict", 1,
    [`${FWS}:1033 (a re-signed proof over identical content is a different document sharing an id)`, `${FWS}:1021`],
    [...accepted(), { send: issue({}), expect: { ...receipt(), state: { stored: 1 } } },
     { at: "+5s", send: { same: "previous", sign: { created: "+5s" } }, expect: { disposition: "error", code: "idConflict", retryable: false, noSideEffect: true, state: { stored: 1 } } }],
    { mutants: ["idOnlyDuplicateKey"] }),
  iv("VRC-ISS-017", "tier 2: the receipt is signed by the IUT, purpose authentication, whole-second timestamps", 2,
    ["profile:attested (proof on every response)", `${IS}:23-31 (response proof OPTIONAL in the specification)`],
    [...accepted(), { send: issue({}), expect: { ...receipt(), state: { stored: 1 } } }], { mutants: ["unsignedReplies", "wholeMillisecondTimestamps"] }),
  iv("VRC-ISS-018", "tier 2: an envelope whose issuer is the relationship DID is refused (issuer, signer and sender are the connection DID)", 2,
    ["docs/04 section 10: envelope issuer and proof under the connection DID; the relationship DID only in the VRC inner proof (profile attested)", `${FWS}:394-423 (4.8.1 precedence of in-band identity)`, `${FWS}:1016 (7.2 item 6)`],
    [...accepted(), { send: issue({}, { issuer: "$R" }), expect: { disposition: "error", code: "identityMismatch", noSideEffect: true, state: { stored: 0 } } }], { mutants: ["ignoreTransportIdentity"] }),
  iv("VRC-ISS-019", "tier 2: an envelope issued as the connection DID but proven by the relationship DID's key is refused", 2,
    ["docs/04 section 10 (profile attested): issuer == proof signer == transport sender", `${FWS}:1017 (7.2 item 7)`, `${IS}:124-132 (the envelope proof attributes the delivery)`],
    [...accepted(), { send: issue({}, {}, { sign: { as: "R", allowIssuerMismatch: true } }), expect: { disposition: "error", code: "proofInvalid", noSideEffect: true, state: { stored: 0 } } }], { mutants: ["acceptUnverifiedProof"] }),
  iv("VRC-ISS-020", "a second delivery of the same credential under a new envelope id leaves one stored credential", 1,
    [`${FWS}:1062 (creating something SHOULD be refused when it exists) versus ${IS}:83-89 (receipt names the stored artifact)`, "docs/04 section 11 (digest-idempotent store)", "docs/07 O21"],
    [...accepted(), { send: issue({}), expect: { ...receipt(), state: { stored: 1 } } },
     { at: "+5s", send: issue({}, { id: "$id(iss2)", issuedAt: "$now+5s" }), expect: { ...receipt(), orRefusal: ["vrc/relationships/issue:alreadyIssued", "vrc/relationships/issue:notAccepted"], state: { stored: 1 } } }],
    { clarify: "Whether a redelivery of an existing credential under a new envelope is a refusal (framework 'creating something') or an idempotent receipt (design) is unsettled (docs/07 O21); the vector asserts the design reading (one stored credential, same digest). Not gating.", mutants: ["storeDuplicates"] }),
  iv("VRC-ISS-021", "a second, different credential for one exchange is not stored", 1,
    ["docs/06 section 2.2 (issue:alreadyIssued)", `${FWS}:1062 (creating something)`, "docs/07 O21"],
    [...accepted(), { send: issue({ name: "first" }), expect: { ...receipt("first"), state: { stored: 1 } } },
     { at: "+5s", send: issue({ name: "second", nonce: "other" }, { id: "$id(iss2)", issuedAt: "$now+5s" }), expect: { disposition: "error", code: ["vrc/relationships/issue:alreadyIssued", "vrc/relationships/issue:notAccepted"], noSideEffect: true, state: { stored: 1 } } }],
    { clarify: "Second VRC for one exchange: the specifications say nothing; the plan refuses with issue:alreadyIssued (docs/07 O21). Not gating.", mutants: ["noSecondVrcGuard"] }),
  iv("VRC-ISS-022", "a second exchange between the same parties, with a fresh relationship DID, stores a second credential", 1,
    ["docs/07 section 1 (relationship DID unique per VRC exchanged)", `${PS}:64-66 (a propose id names the exchange)`, "docs/07 O21"],
    [...accepted(), { send: issue({}), expect: { ...receipt(), state: { stored: 1 } } },
     { at: "+10s", send: prop({ id: "$id(req2)", threadId: "$id(req2)", payload: { relationshipDid: "$S" } }), capture: { ibr: "/payload/relationshipDid" }, expect: { disposition: "response", type: `${PRO_T}#response`, state: { handled: 3 } } },
     { at: "+15s", send: issue({ issuer: "$S", name: "second" }, { id: "$id(iss2)", threadId: "$id(req2)", issuedAt: "$now+15s" }), expect: { ...receipt("second"), state: { stored: 2 } } }],
    { clarify: "Whether a second VRC for the same connection pair is allowed at all is open (docs/07 O21); docs/07 section 1 (unique per VRC) makes it a new exchange with a new relationship DID. Not gating.", mutants: [] }),
  iv("VRC-ISS-023", "profile: the credential's inner proof is made with purpose assertionMethod", 1,
    ["credential specification CRED/body.md:85-86 and :249-250 (examples sign with proofPurpose assertionMethod; the VRC example elides the proof, :359-361)", "docs/06 section 3.10 (inference: inner proof key listed under assertionMethod)", "docs/07 O17"],
    [...accepted(), { send: issue({ purpose: "authentication" }), expect: notAccepted() }],
    { clarify: "Which key and verification relationship sign a VRC's inner proof is not stated normatively (the credential specification's examples use assertionMethod; docs/07 O17). Not gating.", mutants: ["anyVcPurpose"] }),
], VRC_ISS_FAMILY);

// ---------------------------------------------------------------- framework groups added after the benchmark (ERR, ID, RSP, CTRL, DUP restart and fail-closed)
const S = "SPEC.md";
err.vectors.push(
  v("ERR-004", "the error code is a standard code (or a namespaced extended code), never an invented one", 1,
    [`${S}:1237 (8.2 code MUST be a standard or extended code)`, `${S}:1294 (8.3 the standard set)`, `${S}:1071 (the error reply is a SHOULD; a reply that is sent is checked)`],
    [refuseShould("malformedRequest", req({ payload: CARRIER_BAD })), refuseShould("unsupportedType", req({ id: "$id(req2)", type: "https://trusttasks.org/spec/conformance/gadget/0.1" }))],
    { mutants: ["nonStandardCode"] }),
  v("ERR-005", "retryable defaults: refusals the producer cannot cure by resending are not marked retryable", 1,
    [`${S}:1315 (8.3 default retryable, SHOULD unless task-specific knowledge dictates otherwise)`, `${S}:1342-1346 (8.4 retry means the identical document)`],
    [{ ...refuse("wrongRecipient", req({ recipient: "$X" })), expect: { disposition: "error", code: "wrongRecipient", retryable: false, noSideEffect: true } },
     { ...refuse("malformedRequest", req({ id: "$id(req2)", payload: CARRIER_BAD })), expect: { disposition: "error", code: "malformedRequest", retryable: false, noSideEffect: true } },
     { ...refuse("unsupportedType", req({ id: "$id(req3)", type: "https://trusttasks.org/spec/conformance/gadget/0.1" })), expect: { disposition: "error", code: "unsupportedType", retryable: false, noSideEffect: true } },
     { ...refuse("proofInvalid", req({ id: "$id(req4)" }, { mutate: [{ op: "set", path: "/threadId", value: "urn:uuid:tampered", afterSign: true }] })), expect: { disposition: "error", code: "proofInvalid", retryable: false, noSideEffect: true } }],
    { clarify: "The default retryable column is a SHOULD that yields to task-specific knowledge; the carrier has none, so the vector asserts the default (docs/04 section 11). Not gating.", mutants: ["retryableAlways"] }),
  v("ERR-006", "no leak: a message names neither the contested recipient nor the verification method it tried", 1,
    [`${S}:1274-1281 (8.2.1 a message MUST NOT carry the contested value or key-status internals)`, `${S}:1282 (applies to every code)`],
    [refuse("wrongRecipient", req({ recipient: "$X" })), refuse("proofInvalid", req({ id: "$id(req2)" }, { mutate: [{ op: "set", path: "/threadId", value: "urn:uuid:tampered", afterSign: true }] }))],
    { mutants: ["leakRecipientInMessage", "leakVerificationMethod"] }),
  v("ERR-007", "bounded details on every error path: at most 4096 bytes and 16 members", 1,
    [`${S}:1284-1289 (8.2.2 unbounded details MUST NOT be emitted)`],
    [refuse("wrongRecipient", req({ recipient: "$X" })), refuse("proofInvalid", req({ id: "$id(req2)" }, { mutate: [{ op: "set", path: "/threadId", value: "urn:uuid:tampered", afterSign: true }] }))],
    { mutants: ["oversizedDetails", "tooManyDetailMembers"] }),
  v("ERR-008", "an inbound error carrying an extended code and oversized details is not answered", 1,
    [`${S}:1290 (8.2.2 a receiver ignores oversized details and still honours the code)`, "docs/04 section 13 (error hygiene: an inbound error is answered with nothing)"],
    [{ send: { template: "error.inbound", params: { payload: { code: "vrc/relationships/issue:notAccepted", message: "refused", retryable: false, details: { pad: "x".repeat(5000) }, inResponseTo: { typeUri: "$carrier", id: "$id(req)" } } } }, expect: { disposition: "silence", noSideEffect: true } }],
    { clarify: "The specification does not state in a sentence that an error is never answered; the vector asserts the design rule (docs/04 section 13). Not gating.", mutants: ["answerInboundErrors"] }),
);
rsp.vectors.push(
  v("RSP-005", "tier 2: the response verifies under the identifier the request was addressed to, and no other", 2,
    ["profile:attested (response signed by the request's recipient)", `${S}:1015 (7.2 item 5 recipient)`, `${S}:424-433 (4.8.2 audience binding)`],
    [ok()], { mutants: ["replySignedByOtherKey", "unsignedReplies"] }),
);
id.vectors.push(
  v("ID-003", "tier 2: the issuer and the proof signer are one identity", 2,
    [`${S}:394-423 (4.8.1 in-band identity is authoritative)`, `${S}:1017 (7.2 item 7)`, "profile:attested (pinned as one identity)"],
    [refuse("proofInvalid", req({}, { sign: { as: "X", allowIssuerMismatch: true } })),
     { send: req({ id: "$id(req3)" }), expect: { disposition: "response", state: { handled: 1 } } }],
    { mutants: ["acceptUnverifiedProof"] }),
  v("ID-004", "tier 2: the issuer and the transport-authenticated sender are one identity", 2,
    [`${S}:394-423 (4.8.1 the transport identity is a cross-check)`, `${S}:1016 (7.2 item 6, only where the transport authenticates the sender)`, "profile:attested (pinned as one identity)"],
    [refuse("identityMismatch", req({ id: "$id(req2)", issuer: "$X" })),
     { send: req({ id: "$id(req3)" }), expect: { disposition: "response", state: { handled: 1 } } }],
    { requires: ["carrier:consequential", "optional:transportIdentity"], mutants: ["ignoreTransportIdentity"] }),
);
const ctl = (op: string, id = "ctl"): NonNullable<Step["send"]> => ({ template: "control.cancel", params: { id: `$id(${id})`, payload: { operation: op, target: { id: "$id(req)" } } } });
const ctrl = file("CTRL", [
  v("CTRL-001", "cancel of a task that was answered: unsupportedType, the task keeps its state", 1,
    [`${S}:1700 (11.8 a consumer that does not implement control rejects it with unsupportedType)`, `${S}:1013 (7.2 item 3)`, `${S}:1071 (the error reply is a SHOULD)`],
    [ok(), { send: ctl("cancel"), expect: { disposition: "error", code: "unsupportedType", noSideEffect: true, ...SR, state: { handled: 1, documentState: { "$id(req)": "responded" } } } }],
    { skipIfOptional: ["control"], mutants: ["controlAccepted"] }),
  v("CTRL-002", "suspend and resume are refused like cancel", 1,
    [`${S}:1700 (11.8)`, `${S}:1013 (7.2 item 3)`, `${S}:1071 (the error reply is a SHOULD)`],
    [{ send: ctl("suspend", "ctl1"), expect: { disposition: "error", code: "unsupportedType", noSideEffect: true, ...SR } },
     { send: ctl("resume", "ctl2"), expect: { disposition: "error", code: "unsupportedType", noSideEffect: true, ...SR } }],
    { skipIfOptional: ["control"], mutants: ["controlAccepted"] }),
  v("CTRL-003", "an unrecognised control operation is refused, not defaulted to a known one", 1,
    [`${S}:1700 (11.8)`, `${S}:1013 (7.2 item 3)`, `${S}:1071 (the error reply is a SHOULD)`, "specs/trust-task-control/0.1/payload.schema.json (operation: a consumer that does not recognise a value MUST reject the document; binds a consumer that implements control)"],
    [{ send: ctl("freeze"), expect: { disposition: "error", code: ["unsupportedType", "malformedRequest"], noSideEffect: true, ...SR } }],
    { skipIfOptional: ["control"], mutants: ["controlAccepted"] }),
  v("CTRL-004", "an unsigned control document is refused unsupportedType: the type is checked before the proof", 1,
    [`${S}:1698 (11.8)`, `${S}:1013 (7.2 item 3 type before item 7 proof)`, `${S}:1641 (11.1 a control document MUST carry a proof, for a consumer that implements control)`],
    [{ send: { ...ctl("cancel"), sign: null }, expect: { disposition: "error", code: "unsupportedType", noSideEffect: true } }],
    { skipIfOptional: ["control"], clarify: "SPEC.md 7.2 lists the checks (type at item 3, proof at item 7) but no sentence makes the order of the list normative. An implementation that refuses an unsigned document of a type it does not serve with proofRequired, before it routes the type, tells an unauthenticated caller nothing about what it serves (VTI does). The document is refused either way and never executed. Not gating.", mutants: ["controlProofFirst", "controlAccepted"] }),
]);
const REST = ["optional:restart"];
dup.push(
  v("DUP-006", "restart: the duplicate record is durable, an identical resend after a restart is still absorbed", 1,
    ["SPEC.md:1021 (7.2 item 11: a document accepted once is not executed again; nothing limits that to one process lifetime)", "docs/04 section 13 (restart, optional)"],
    [ok(), { restart: true }, { at: "+5s", send: { same: "previous" }, expect: { disposition: "duplicate", state: { handled: 1 } } }],
    { requires: REST, mutants: ["restartForgetsClaims"] }),
  v("DUP-007", "fail closed: an unreadable duplicate record gives unavailable, retryable, and nothing is executed", 1,
    ["docs/04 section 12 (duplicate-record store unreadable: unavailable, retryable, fail closed)", `${S}:1021 (7.2 item 11 cannot be honoured without the record)`, `${S}:1311 (8.3 unavailable)`],
    [{ trigger: { action: "fault", args: { claimStore: "unreadable" } } }, { send: req(), expect: { disposition: "error", code: "unavailable", retryable: true, noSideEffect: true, state: { handled: 0 } } }],
    { requires: ["optional:fault.claimStore"], clarify: "The framework does not say what an unreadable duplicate record yields; fail-closed with unavailable is the design rule (docs/04 section 12). Not gating.", mutants: ["claimStoreFailOpen", "claimStoreFailsAsTaskFailed"] }),
  v("DUP-008", "fail closed is never taskFailed, and the refused id is not burned: the identical resend executes once after the store returns", 1,
    ["docs/04 section 12 (outcome unknown is never guessed)", `${S}:1021 (7.2 item 11)`, `${S}:1342-1346 (8.4 retry is the identical document)`],
    [{ trigger: { action: "fault", args: { claimStore: "unreadable" } } },
     { send: req(), expect: { disposition: "error", code: ["unavailable", "indeterminate", "internalError"], retryable: true, noSideEffect: true } },
     { trigger: { action: "fault", args: { claimStore: "ok" } } },
     { at: "+5s", send: { same: "previous" }, expect: { disposition: "response", state: { handled: 1 } } }],
    { requires: ["optional:fault.claimStore"], clarify: "Design rule (docs/04 section 12), not specification text. Not gating.", mutants: ["claimStoreFailsAsTaskFailed", "claimStoreFaultBurnsId"] }),
);

// ---------------------------------------------------------------- NS and AUTHZ (the hold and issue paths of the VRC tasks)
const nsv = (id: string, title: string, spec: string[], rest: Partial<Vector> = {}): Vector =>
  pv(id, title, 1, spec, [policy("hold"), { send: prop(), expect: held() }], rest);
const ns = file("NS", [
  nsv("NS-001", "the next-step payload is a closed object: no member outside expects, continuation, inResponseTo, message, ext",
    ["specs/trust-task-next-step/0.1/payload.schema.json (additionalProperties false)", `${S}:1414 (8.6 a hold is a next step)`], { mutants: ["holdNextStepOpenPayload"] }),
  nsv("NS-002", "every expects entry names a Type URI",
    ["specs/trust-task-next-step/0.1/payload.schema.json (expects[].typeUri required)", `${S}:1416-1418 (expects names the originating Type URI where no status task exists)`], { mutants: ["holdExpectsNoTypeUri", "holdEmptyExpects"] }),
  nsv("NS-003", "message is at most 1024 characters",
    ["specs/trust-task-next-step/0.1/payload.schema.json (message maxLength 1024)", `${S}:1414`], { mutants: ["holdMessageTooLong"] }),
  nsv("NS-004", "a hold is answered with trust-task-next-step, not the deprecated trust-task-ok and not silence",
    [`${S}:1414 (8.6 a consumer holding a task MUST answer with a next step)`, `${S}:1427 (trust-task-ok SHOULD NOT be emitted)`], { mutants: ["holdAnswersOk", "silentHold"] }),
  nsv("NS-005", "the next-step is addressed to the producer on the request's thread with a fresh id and names the held document",
    [`${S}:450-462 (4.9 threadId, a response never reuses the request id)`, "specs/trust-task-next-step/0.1/spec.md (inResponseTo names the document answered)"],
    { mutants: ["swapRecipientInReply", "wrongReplyThread", "reuseRequestIdInReply", "holdNoInResponseTo"] }),
], VRC_PRO_FAMILY);
const authz = file("AUTHZ", [
  iv("AUTHZ-001", "a delivery on another party's accepted thread is indistinguishable from one on an unknown thread", 1,
    [`${S}:1020 (7.2 item 10 validation is not authorization)`, `${IS}:115-122 (authorization is the accepted proposal)`, `${S}:1282 (an error that varies with a consumer-internal fact is an oracle)`],
    [...accepted(),
     { send: issue({}, { issuer: "$X", id: "$id(iss)" }, { from: "X" }), expect: { disposition: "error", code: "vrc/relationships/issue:notAccepted", noSideEffect: true, state: { stored: 0 } } },
     { at: "+5s", send: issue({}, { id: "$id(iss2)", threadId: "$id(nothing)" }), expect: { disposition: "error", code: "vrc/relationships/issue:notAccepted", noSideEffect: true, state: { stored: 0 }, sameErrorAs: 3 } }],
    { clarify: "Step 4 compares the refusal for a delivery by the wrong party on an accepted thread with the refusal for an unknown thread (vrc/relationships/issue spec.md:51: authorisation is the accepted proposal). The text does not say that the two refusals must be indistinguishable; the 'oracle' reading rests on a privacy note of the framework, not on a rule that names this case. Spec-open (class C, O-14), recorded only, nothing filed. Not gating.", mutants: ["foreignThreadDistinct", "acceptUnsolicited"] }),
  pv("AUTHZ-002", "a proposal resubmitted by a party other than the proposer is refused permissionDenied and learns nothing of the outcome", 1,
    [`${S}:1020 (7.2 item 10)`, `${S}:1414-1420 (a resubmission is answered in the same thread, for the producer that held it)`, "docs/06 section 2.2 (AUTHZ-001 design: contested identity gives permissionDenied)"],
    [policy("accept"), proposeAccepted(),
     { at: "+5s", send: prop({ id: "$id(req2)", threadId: "$id(req)", issuer: "$X", payload: { relationshipDid: "$S" } }, { from: "X" }), expect: { disposition: "error", code: "permissionDenied", noSideEffect: true } }],
    { clarify: "Which code a contested thread yields is a design rule (permissionDenied), not specification text; the specification only forbids treating validation as authorization (item 10). Not gating.", mutants: ["proposeLeaksForeignOutcome"] }),
], VRC_ISS_FAMILY);

// ---------------------------------------------------------------- WSH and TD (witness-share, docs/10)
const WSH_T = "https://trusttasks.org/spec/vrc/relationships/witness-share/0.1";
const WSH_NA = "vrc/relationships/witness-share:notAccepted";
const WSH_FAMILY = "vrc-witness-share";
const D10 = "docs/10-witness-share-profile.md";
const sv = (id: string, title: string, tier: 1 | 2, spec: string[], steps: Step[], rest: Partial<Vector> = {}): Vector =>
  v(id, title, tier, spec, steps, { requires: [WSH_T, ...VRC_REQ], ...rest });
const share = (w: WitnessSpec = {}, extra: Record<string, unknown> = {}, more: SendOver = {}): NonNullable<Step["send"]> => ({
  template: "witness-share.request", witness: w, ...(Object.keys(extra).length > 0 ? { params: extra } : {}), ...more,
});
const wReceipt = (n = 1): NonNullable<Step["expect"]> => ({
  disposition: "response", type: `${WSH_T}#response`, pointer: { "/payload/vwcDigestMultibase": "$digest(vwc)" },
  state: { storedVwc: n, storedVwcDigest: { digest: "$digest(vwc)", count: 1 } },
});
/** The success of a share without the receipt digest: the task-digest vectors test the framework's pairing rule (SPEC.md 4.9.3), not the profile's choice of receipt digest encoding (docs/10 section 5.1). */
const wAccepted = (n = 1): NonNullable<Step["expect"]> => ({ disposition: "response", type: `${WSH_T}#response`, state: { storedVwc: n } });
const wRefused = (idName = "wsh", stored = 0): NonNullable<Step["expect"]> => ({
  disposition: "error", code: WSH_NA, retryable: false, noSideEffect: true, state: { storedVwc: stored },
  pointer: { "/payload/inResponseTo/typeUri": WSH_T, "/payload/inResponseTo/id": `$id(${idName})` },
});
const refusedShare = (w: WitnessSpec, idName = "wsh"): Step => ({ send: share(w, idName === "wsh" ? {} : { id: `$id(${idName})` }), expect: wRefused(idName) });
const OK_SHARE: Step = { send: share(), expect: wReceipt() };

const wsh = file("WSH", [
  sv("WSH-001", "a conforming bundle is stored and receipted with the digest of the stored credential", 1,
    [`${D10} section 4, 5.1`, `${D10} section 11 WSH-001`, `${S}:545-557 (4.9.3 task digest)`],
    [...accepted(), OK_SHARE], { mutants: ["wshDigestOverPresentation"] }),
  sv("WSH-002", "a presentation whose challenge is not this exchange (replay across exchanges) is refused", 1,
    [`${D10} section 4 step 4.1`, `${D10} section 11 WSH-002`],
    [...accepted(), refusedShare({ challenge: "urn:uuid:another-exchange" })], { mutants: ["noChallengeCheck"] }),
  sv("WSH-003", "a presentation whose domain is not vrc:witness-share is refused", 1,
    [`${D10} section 3.3 (domain constant)`, `${D10} section 11 WSH-003`],
    [...accepted(), refusedShare({ domain: "vrc:something-else" })], { mutants: ["noDomainCheck"] }),
  sv("WSH-004", "a witnessed credential about the receiver (its own VWC bounced back) is refused", 1,
    [`${D10} section 4 step 6`, `${D10} section 11 WSH-004`],
    [...accepted(), refusedShare({ subject: "$cap(ibr)" })], { mutants: ["noSubjectBinding"] }),
  sv("WSH-005", "parties that do not name both relationship DIDs are refused", 1,
    [`${D10} section 4 step 7`, `${D10} section 11 WSH-005`],
    [...accepted(), refusedShare({ parties: ["$R"] }), { send: share({ parties: ["$R", "$Q"] }, { id: "$id(wsh2)" }), expect: wRefused("wsh2") }],
    { mutants: ["noPartiesBinding"] }),
  sv("WSH-006", "a foreign terminal (other thread) or a terminal that is an error response is refused", 1,
    [`${D10} section 4 step 4.7 and 4.8`, `${D10} section 11 WSH-006`, `${S}:1020`],
    [...accepted(), refusedShare({ terminalThread: "urn:uuid:foreign-session" }), { send: share({ terminalType: "error" }, { id: "$id(wsh2)" }), expect: wRefused("wsh2") }],
    { mutants: ["noTerminalThread", "terminalErrorAccepted"] }),
  sv("WSH-007", "a task digest that does not reproduce over the initiating document (document altered, digest wrong, taskContext wrong) is refused", 1,
    [`${S}:545-557 (4.9.3 recompute, compare)`, `${D10} section 4 step 4.5 and 4.6`, `${D10} section 11 WSH-007`],
    [...accepted(), refusedShare({ alterInitiating: true }),
     { send: share({ digest: "wrong" }, { id: "$id(wsh2)" }), expect: wRefused("wsh2") },
     { send: share({ taskContext: "urn:uuid:another-session" }, { id: "$id(wsh3)" }), expect: wRefused("wsh3") }],
    { mutants: ["noCitationDigest", "noTaskContextCheck"] }),
  sv("WSH-008", "a terminal signed by someone other than the initiating document's recipient is refused", 1,
    ["framework 4.9.4 item 4 (the outcome evidence is signed by the party the initiating document was addressed to)", `${D10} section 11 WSH-008`],
    [...accepted(), refusedShare({ terminalSigner: "X" })], { mutants: ["terminalSignedByIssuerOnly"] }),
  sv("WSH-009", "a terminal of a type other than the declared outcome-evidence type is refused", 1,
    ["framework 4.9.4 item 3 (the declared outcome-evidence type)", `${D10} section 11 WSH-009`],
    [...accepted(), refusedShare({ terminalType: "session" })], { mutants: ["anyResponseType"] }),
  sv("WSH-010", "a terminal with its proof stripped is refused", 1,
    [`${D10} section 4 step 4.9`, `${D10} section 11 WSH-010`],
    [...accepted(), refusedShare({ terminalProof: "none" })], { mutants: ["noTerminalProof"] }),
  sv("WSH-011", "the citation in another multibase spelling of the same digest is accepted (decoded bytes are compared)", 1,
    [`${S}:557-558 (4.9.3 compare decoded multihash bytes, not strings)`, `${D10} section 11 WSH-011`],
    [...accepted(), { send: share({ digest: "u" }), expect: wReceipt() }], { mutants: ["compareDigestStrings"] }),
  sv("WSH-012", "a citation naming a hash the verifier does not implement is not evidence of completion", 1,
    [`${S}:552 (4.9.3 the algorithm is named by the multihash prefix)`, `${S}:557 (4.9.3 a consumer that does not implement the algorithm MUST NOT recompute under another and MUST NOT fall back to id comparison; one that does implement it recomputes and compares)`, `${D10} section 5.1`, `${D10} section 11 WSH-012`],
    [...accepted(), refusedShare({ digest: "sha512", alterInitiating: true })], { mutants: ["noCitationDigest", "unknownMultihashFallsBackToId"] }),
  sv("WSH-013", "an unsolicited share (no accepted exchange with this sender) is refused notAccepted, not proofInvalid", 1,
    [`${D10} section 4 step 3 and 6.1`, `${D10} section 11 WSH-013`, `${S}:1020 (7.2 item 10)`],
    [refusedShare({})], { mutants: ["acceptUnsolicited"] }),
  sv("WSH-014", "a share without an envelope proof is refused proofRequired", 1,
    [`${D10} section 1 (proof required on the request)`, `${D10} section 11 WSH-014`, `${S}:1017 (7.2 item 7)`],
    [...accepted(), { send: share({}, {}, { sign: null }), expect: { disposition: "error", code: "proofRequired", noSideEffect: true, state: { storedVwc: 0 } } }],
    { mutants: ["proofOptional", "proofRequiredAsInvalid"] }),
  sv("WSH-015", "an envelope proof made by a key that is not the issuer's is refused", 1,
    [`${D10} section 6.2`, `${D10} section 11 WSH-015`, `${S}:1017 (7.2 item 7)`],
    [...accepted(), { send: share({}, {}, { sign: { as: "X", allowIssuerMismatch: true } }), expect: { disposition: "error", code: ["proofInvalid", "identityMismatch"], noSideEffect: true, state: { storedVwc: 0 } } }],
    { mutants: ["acceptUnverifiedProof"] }),
  sv("WSH-016", "an unknown payload member, or a missing presentation, initiating or terminal, is malformed", 1,
    [`${D10} section 3.2 (closed payload, required members)`, `${D10} section 11 WSH-016`, `${S}:1012 (7.2 item 2)`],
    [...accepted(),
     { send: share({}, {}, { mutate: [{ op: "set", path: "/payload/note", value: "extra" }] }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true, state: { storedVwc: 0 } } },
     { send: share({}, { id: "$id(wsh2)" }, { mutate: [{ op: "remove", path: "/payload/presentation" }] }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true } },
     { send: share({}, { id: "$id(wsh3)" }, { mutate: [{ op: "remove", path: "/payload/outcomeEvidence/initiating" }] }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true } },
     { send: share({}, { id: "$id(wsh4)" }, { mutate: [{ op: "remove", path: "/payload/outcomeEvidence/terminal" }] }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true } }],
    { mutants: ["openPayload", "bundleShapeAsNotAccepted"] }),
  sv("WSH-017", "a redelivery of the same bundle under a new envelope id leaves one stored credential and a receipt with the same digest", 1,
    [`${D10} section 8 (idempotent on the credential digest)`, `${D10} section 11 WSH-017`],
    [...accepted(), OK_SHARE, { at: "+5s", send: share({}, { id: "$id(wsh2)", issuedAt: "$now+5s" }), expect: wReceipt() }],
    { mutants: ["wshStoresDuplicates"] }),
  sv("WSH-018", "the same id with changed content is idConflict and nothing new is stored", 1,
    [`${S}:1021 (7.2 item 11)`, `${S}:1033`, `${D10} section 8`, `${D10} section 11 WSH-018`],
    [...accepted(), OK_SHARE,
     { at: "+5s", send: { same: "previous", mutate: [{ op: "set", path: "/payload/ext", value: { changed: true } }], sign: { as: "A" } }, expect: { disposition: "error", code: "idConflict", retryable: false, noSideEffect: true, state: { storedVwc: 1 } } }],
    { mutants: ["idOnlyDuplicateKey"] }),
  sv("WSH-019", "a share arriving after the counterparty's issue is accepted too (no order is enforced)", 1,
    [`${D10} section 7 (no order is determined by the reference implementation)`, `${D10} section 11 WSH-019`],
    [...accepted(), { send: issue({}), expect: { ...receipt(), state: { stored: 1 } } }, { at: "+5s", send: share({}, { issuedAt: "$now+5s" }), expect: wReceipt() }],
    { clarify: "Whether a share must follow the session and precede the issue, follow the issue, or be unordered is open (docs/07 O7); the vector asserts the unordered reading for the issue-then-share order. Not gating.", requires: [WSH_T, ISS_T, ...VRC_REQ], mutants: [] }),
  sv("WSH-020", "tier 2: the receipt is signed and verifies under the request's recipient", 2,
    [`${D10} section 6.3`, `${D10} section 11 WSH-020`, "profile:attested (proof on every response)"],
    [...accepted(), OK_SHARE], { mutants: ["unsignedReplies", "replySignedByOtherKey"] }),
  sv("WSH-021", "tier 2: the envelope is issued, signed and sent as the connection DID; the relationship DID as issuer or as the signing key is refused", 2,
    [`${D10} section 6.3`, `${D10} section 11 WSH-021`, "docs/04 section 10 (issuer, signer and sender are the connection DID)", `${S}:1016-1017 (7.2 items 6 and 7)`],
    [...accepted(),
     { send: share({}, { issuer: "$R" }), expect: { disposition: "error", code: "identityMismatch", noSideEffect: true, state: { storedVwc: 0 } } },
     { send: share({}, { id: "$id(wsh2)" }, { sign: { as: "R", allowIssuerMismatch: true } }), expect: { disposition: "error", code: "proofInvalid", noSideEffect: true, state: { storedVwc: 0 } } }],
    { mutants: ["ignoreTransportIdentity", "acceptUnverifiedProof"] }),
], WSH_FAMILY);

wsh.vectors.push(
  sv("WSH-025", "a witnessed credential whose own proof does not verify, or is made by a key its issuer does not control, is refused", 1,
    [`${D10} section 4 step 4.3 (the credential's own proof verifies independently of the evidence)`, `${S}:359-376 (4.7.3 a key controlled by the issuer)`],
    [...accepted(), refusedShare({ corruptVwc: true }), { send: share({ vwcSigner: "Q" }, { id: "$id(wsh2)" }), expect: wRefused("wsh2") }],
    { mutants: ["noCredentialProof"] }),
);

wsh.vectors.push(
  sv("WSH-024", "a second, different share on the same exchange is accepted and stored (the permissive reading)", 1,
    [`${D10} section 12 (whether a second, different share on the same thread must be refused is not determined)`, `${D10} section 8 (the receiver processes a second share on its merits)`],
    [...accepted(), { send: share({ digest: "u", name: "vwcU" }), expect: { ...wReceipt(1), pointer: { "/payload/vwcDigestMultibase": "$digest(vwcU)" }, state: { storedVwc: 1 } } },
     { at: "+5s", send: share({ name: "vwcZ" }, { id: "$id(wsh2)", issuedAt: "$now+5s" }), expect: { disposition: "response", type: `${WSH_T}#response`, pointer: { "/payload/vwcDigestMultibase": "$digest(vwcZ)" }, state: { storedVwc: 2 } } }],
    { clarify: "Whether a receiver must refuse a second, different share on one exchange is not determined (docs/10 section 12); the vector asserts the permissive reading. Not gating.", mutants: [] }),
);

const TDS = `${S}:545-557`;
const td = file("TD", [
  sv("TD-001", "a cited document that carries a proof pairs with the digest computed without its top-level proof", 1,
    [`${TDS} (4.9.3 the top-level proof is removed before hashing)`], [...accepted(), { send: share({ initiating: "signed" }), expect: wAccepted() }],
    { mutants: ["digestIncludesProof"] }),
  sv("TD-002", "a cited document that carries no proof pairs with the digest of the document unchanged (no placeholder)", 1,
    [`${TDS} (4.9.3 where the document carries no proof the input is the document unchanged; no placeholder is substituted)`],
    [...accepted(), { send: share({ initiating: "unsigned" }), expect: wAccepted() }], { mutants: ["digestPlaceholderProof"] }),
  sv("TD-003", "a cited document signed again after the citation was made is the same document with the same task digest", 1,
    [`${TDS} (4.9.3 a document has one task digest whether or not, or how often, it was signed)`, `${S}:559-561 (task digest versus step digest)`],
    [...accepted(), { send: share({ initiating: "resigned" }), expect: wAccepted() }], { mutants: ["digestIncludesProof"] }),
  sv("TD-004", "a proof nested inside the payload is part of the content and stays in the digest input", 1,
    [`${TDS} (4.9.3 a proof within payload MUST NOT be removed)`],
    [...accepted(), { send: share({ nestedProof: true }), expect: wAccepted() }], { mutants: ["digestStripsNestedProof"] }),
  sv("TD-005", "the base64url spelling of a digest pairs: the decoded bytes are compared, not the encoded strings", 1,
    [`${S}:553 (4.9.3 the result is a multibase-encoded multihash per DigestMultibase; the shared schema admits base58btc z and base64url u, SPEC.md:2195)`, `${S}:557-558 (4.9.3 compare the decoded multihash bytes, not the encoded strings)`],
    [...accepted(), { send: share({ digest: "u", name: "vwcU" }), expect: wAccepted() }], { mutants: ["compareDigestStrings"] }),
  sv("TD-006", "a citation naming an unimplemented hash never pairs, and the id alone is never enough", 1,
    [`${S}:557 (4.9.3 MUST NOT recompute under a different algorithm and MUST NOT fall back to id comparison alone)`],
    [...accepted(), refusedShare({ digest: "sha512", alterInitiating: true })], { mutants: ["unknownMultihashFallsBackToId", "noCitationDigest"] }),
], WSH_FAMILY);

// ---------------------------------------------------------------- DIS (trust-task-discovery 0.4)
// The version the vectors run against is the one the implementation serves (0.4, else 0.3): `requires` names the pseudo-type `discovery`.
const DIS_T = "discovery";
const DS = "specs/trust-task-discovery/0.4/spec.md";
const DP = "specs/trust-task-discovery/0.4/payload.schema.json";
/** The same rules as run against a 0.3-only implementation (the lines named are those of 0.3; the 0.3 payload schema differs from 0.4 only in the window). */
const DS3 = "specs/trust-task-discovery/0.3/spec.md";
const D3 = (lines: string, what = "same text in 0.3"): string => `${DS3}:${lines} (${what})`;
const DIS_FAMILY = "trust-task-discovery";
const dreq = (payload?: Record<string, unknown>, extra: Record<string, unknown> = {}, more: SendOver = {}): NonNullable<Step["send"]> => ({
  template: "discovery.request", ...(payload === undefined && Object.keys(extra).length === 0 ? {} : { params: { ...(payload === undefined ? {} : { payload }), ...extra } }), ...more,
});
const disc = (matches: string[], sorted = false): NonNullable<Step["expect"]> => ({
  disposition: "response", type: "$discoveryResponse", noSideEffect: true, discovery: { matches, ...(sorted ? { sorted: true } : {}) },
});
const dv = (id: string, title: string, tier: 1 | 2, spec: string[], steps: Step[], rest: Partial<Vector> = {}): Vector =>
  v(id, title, tier, spec, steps, { requires: [DIS_T], ...rest });
const WINDOW = ["optional:discovery.acceptanceWindow"];
const dis = file("DIS", [
  dv("DIS-001", "a query with no patterns lists exactly the task types the implementation declares, as bare Type URIs without duplicates", 1,
    [`${DS}:77 (an absent or empty patterns list is the single pattern *)`, `${DS}:78-79 (bare Type URIs, no duplicates)`, `${DP} (response schema)`, "docs/04 section 11.2 (the list is the declared supportedTypes)", D3("77-79"), `${DS}:162 (a responder SHOULD answer in the version it was asked; a discoverer SHOULD ask 0.4 and MAY fall back to 0.3)`, D3("148", "the same rule for 0.3")],
    [{ send: dreq(), expect: disc([]) }],
    { mutants: ["discoveryNoDefaultStar", "discoveryListsUnserved", "discoveryOmitsServed", "discoveryFragmentsListed", "discoveryDuplicates", "discoveryTwoPartVersion"] }),
  dv("DIS-002", "an empty patterns array is the same as *", 1, [`${DS}:77`, `${DP} (patterns: omitted or empty means *)`, D3("77")],
    [{ send: dreq({ patterns: [] }), expect: disc([]) }], { mutants: ["discoveryNoDefaultStar"] }),
  dv("DIS-003", "the pattern * lists every supported type", 1, [`${DS}:164-170 (pattern grammar: * matches every slug)`, D3("156")],
    [{ send: dreq({ patterns: ["*"] }), expect: disc(["*"]) }], { mutants: ["discoveryOmitsServed", "discoveryListsUnserved"] }),
  dv("DIS-004", "a <prefix>/* pattern lists the types whose slug starts with the prefix and the slash", 1, [`${DS}:171 (<prefix>/* matches slugs starting with the literal <prefix>/)`, D3("157")],
    [{ send: dreq({ patterns: ["vrc/*"] }), expect: disc(["vrc/*"]) }, { send: dreq({ patterns: ["trust-task-discovery"] }, { id: "$id(d2)" }), expect: disc(["trust-task-discovery"]) }],
    { requires: [DIS_T, PRO_T], mutants: ["discoveryIgnoresPatterns"] }),
  dv("DIS-005", "the prefix includes its slash: vrc/relationships/p/* matches nothing although vrc/relationships/propose exists", 1,
    [`${DS}:171 (the literal <prefix>/ including the slash)`, D3("157")], [{ send: dreq({ patterns: ["vrc/relationships/p/*"] }), expect: disc(["vrc/relationships/p/*"]) }],
    { requires: [DIS_T, PRO_T], mutants: ["discoveryPrefixNoSlash"] }),
  dv("DIS-006", "an exact slug lists only that slug, and a partial slug is not a prefix", 1, [`${DS}:172 ("<slug>" is an exact match)`, `${DS}:174 (any other shape is an exact slug match)`, D3("158-160")],
    [{ send: dreq({ patterns: ["vrc/relationships/prop"] }), expect: disc(["vrc/relationships/prop"]) },
     { send: dreq({ patterns: ["vrc/relationships/issue"] }, { id: "$id(d2)" }), expect: disc(["vrc/relationships/issue"]) }],
    { requires: [DIS_T, ISS_T], mutants: ["discoveryExactAsPrefix", "discoveryIgnoresPatterns"] }),
  dv("DIS-007", "a wildcard anywhere but the trailing /* is literal and matches no slug", 1, [`${DS}:174 (wildcards elsewhere are matched literally; acl/*-handoff matches no slug)`, D3("160")],
    [{ send: dreq({ patterns: ["vrc/relationships/pro*se"] }), expect: disc(["vrc/relationships/pro*se"]) },
     { send: dreq({ patterns: ["vrc/*/issue"] }, { id: "$id(d2)" }), expect: disc(["vrc/*/issue"]) }],
    { requires: [DIS_T, PRO_T], mutants: ["discoveryWildcardInterpreted"] }),
  dv("DIS-008", "several patterns combine with OR", 1, [`${DS}:176 (multiple patterns are combined with OR semantics)`, D3("162")],
    [{ send: dreq({ patterns: ["vrc/relationships/issue", "trust-task-discovery"] }), expect: disc(["vrc/relationships/issue", "trust-task-discovery"]) },
     { send: dreq({ patterns: ["no/such/*", "trust-task-discovery"] }, { id: "$id(d2)" }), expect: disc(["no/such/*", "trust-task-discovery"]) }],
    { requires: [DIS_T, ISS_T], mutants: ["discoveryAndSemantics", "discoveryFirstPatternOnly"] }),
  dv("DIS-009", "a query that matches nothing is answered with an empty list, not an error", 1,
    [`${DS}:77 (the subset the responder supports that matches)`, "SPEC.md:1594 (a response with supportedTypes [] is conformant)", D3("77")],
    [{ send: dreq({ patterns: ["no/such/*"] }), expect: disc(["no/such/*"]) }], { mutants: ["discoveryEmptyAsError"] }),
  dv("DIS-010", "sixteen patterns are accepted and seventeen are refused malformedRequest", 1, [`${DS}:178 (the array is bounded at 16 entries)`, `${DP} (patterns maxItems 16)`, D3("164")],
    [{ send: dreq({ patterns: Array.from({ length: 16 }, (_, i) => `p${i}/*`) }), expect: disc(Array.from({ length: 16 }, (_, i) => `p${i}/*`)) },
     refuseShould("malformedRequest", dreq({ patterns: Array.from({ length: 17 }, (_, i) => `p${i}/*`) }, { id: "$id(d2)" }))],
    { mutants: ["discoveryNoPatternBound", "discoveryBoundOffByOne", "noPayloadValidation"] }),
  dv("DIS-011", "the request payload is a closed object of non-empty string patterns: an unknown member, a non-array or an empty pattern is malformedRequest", 1,
    [`${DP} (additionalProperties false; patterns items minLength 1)`, "SPEC.md:1012 (7.2 item 2 payload validation)", "SPEC.md:1071 (the error reply is a SHOULD)", D3("172-178", "the request payload is the same in 0.3")],
    [refuseShould("malformedRequest", dreq({ patterns: ["*"], extra: true })),
     refuseShould("malformedRequest", dreq({ patterns: "*" }, { id: "$id(d2)" })),
     refuseShould("malformedRequest", dreq({ patterns: [""] }, { id: "$id(d3)" })),
     refuseShould("malformedRequest", dreq({ patterns: [5] }, { id: "$id(d4)" }))],
    { mutants: ["discoveryOpenPayload", "noPayloadValidation"] }),
  dv("DIS-012", "the response states a window no wider than the one enforced: a document at the advertised maximum age, and one at the advertised skew ahead, are accepted", 1,
    [`${DS}:130-133 (responder rules, the MUST sentences at 132: a responder MUST state a window no wider than the one it applies)`, `${DS}:124 (refuses past acceptance end plus skew, or issuedAt beyond now plus skew)`, D3("121-123", "responder rule 1: a responder MUST state a window no wider than the one it applies"), D3("117", "the refusal rule: now > issuedAt + maxAgeSeconds + clockSkewSeconds, or issuedAt > now + clockSkewSeconds")],
    [{ send: dreq(), capture: { maxAge: "/payload/acceptanceWindow/maxAgeSeconds", skew: "/payload/acceptanceWindow/clockSkewSeconds" }, expect: disc([]) },
     { at: "+0s", send: req({ id: "$id(old)", issuedAt: "$nowAt(-maxAge)" }), expect: { disposition: "response", state: { handled: 1 } } },
     { send: req({ id: "$id(ahead)", issuedAt: "$nowAt(+skew)" }), expect: { disposition: "response", state: { handled: 2 } } }],
    { requires: [DIS_T, ...WINDOW], mutants: ["discoveryWindowWiderMaxAge", "discoveryWindowWiderSkew"] }),
  dv("DIS-013", "an advertised expiry horizon is honoured: a document issued almost a horizon ago with an expiresAt inside it is accepted", 1,
    [`${DS}:118-122 (acceptance end with expiryHorizonSeconds)`, `${DS}:130-133 (responder rules, the MUST sentences at 132: a responder MUST NOT state a wider horizon than it applies; window rows at 118-124)`, `${DS}:156 (0.4 adds one thing: the optional expiryHorizonSeconds member; the 0.3 window is closed, so this vector runs against discovery 0.4 only)`],
    [{ send: dreq(), capture: { horizon: "/payload/acceptanceWindow/expiryHorizonSeconds" }, expect: disc([]) },
     { send: req({ id: "$id(old)", issuedAt: "$nowAt(-horizon,+300s)", expiresAt: "$nowAt(+300s)" }), expect: { disposition: "response", state: { handled: 1 } } }],
    { requires: ["https://trusttasks.org/spec/trust-task-discovery/0.4", "optional:discovery.expiryHorizon"], mutants: ["discoveryHorizonWide"] }),
  dv("DIS-014", "the list is sorted lexicographically by Type URI", 1, [`${DS}:88 (a conforming responder SHOULD sort supportedTypes)`, D3("88")],
    [{ send: dreq(), expect: disc([], true) }],
    { clarify: "Sorting is a SHOULD of the discovery specification, not a MUST. Not gating.", mutants: ["discoveryUnsorted"] }),
  dv("DIS-015", "a discovery request without a proof is answered at Tier 1 (the proof is RECOMMENDED, not required)", 1,
    [`${DS}:24-25 (proofRequirement RECOMMENDED)`, "SPEC.md:1610 (10.5 item 1: RECOMMENDED, not OPTIONAL and not REQUIRED)", D3("24-25")],
    [{ send: dreq(undefined, {}, { sign: null }), expect: disc([]) }],
    { clarify: "The proof is RECOMMENDED on the request, but the specification does not say a responder must answer an unsigned query: a responder may refuse it by its own permission policy (VTI answers discovery only to signed callers). Not gating; the Tier 2 profile signs.", skipIfOptional: ["attested"], mutants: ["discoveryProofRequired"] }),
  dv("DIS-016", "tier 2: the discovery response is signed by the IUT under the request's recipient", 2, ["profile:attested (proof on every response)", `${DS}:24-25`, D3("24-25")],
    [{ send: dreq(), expect: disc([]) }], { mutants: ["unsignedReplies", "replySignedByOtherKey"] }),
  dv("DIS-017", "a discovery request addressed to another recipient is wrongRecipient", 1, ["SPEC.md:1015 (7.2 item 5)", `${DS}:17-23 (the parties: the responder is the recipient)`, D3("17-23")],
    [refuseShould("wrongRecipient", dreq(undefined, { recipient: "$X" }))], { mutants: ["noRecipientCheck"] }),
], DIS_FAMILY);

// ---------------------------------------------------------------- BND (HTTPS binding 0.3)
const BS = "bindings/https/0.3/spec.md";
const BND_FAMILY = "https-binding";
const bv = (id: string, title: string, spec: string[], steps: Step[], rest: Partial<Vector> = {}): Vector =>
  v(id, title, 1, spec, steps, { requires: ["binding:https"], ...rest });
const H = {};
const httpReq = (extra: Record<string, unknown> = {}, more: SendOver = {}): NonNullable<Step["send"]> => req(extra, { http: H, ...more });
const wireJson = { httpBody: "json" } as const;
const bnd = file("BND", [
  bv("BND-001", "only POST /trust-tasks is accepted: another method is 405 and another path is 404, neither with a framework error document", [`${BS}:52 (reject every other method/path combination with 405 / 404; not framework error documents)`],
    [{ send: req({}, { http: { method: "GET" } }), expect: { disposition: "silence", noSideEffect: true, httpStatus: 405, httpBody: "none" } },
     { send: req({ id: "$id(r2)" }, { http: { method: "PUT" } }), expect: { disposition: "silence", noSideEffect: true, httpStatus: 405, httpBody: "none" } },
     { send: req({ id: "$id(r3)" }, { http: { method: "DELETE" } }), expect: { disposition: "silence", noSideEffect: true, httpStatus: 405, httpBody: "none" } },
     { send: req({ id: "$id(r4)" }, { http: { path: "/trust-task" } }), expect: { disposition: "silence", noSideEffect: true, httpStatus: [404, 405], httpBody: "none" } },
     { send: req({ id: "$id(r5)" }, { http: H }), expect: { disposition: "response", httpStatus: 200, state: { handled: 1 } } }],
    { mutants: ["httpAnyMethod", "httpAnyPath", "httpMethodStatus400", "httpRefusalAsErrorDoc"] }),
  bv("BND-002", "the bearer-authenticated sender is the transport identity: a different in-band issuer is identityMismatch (422), routed to the authenticated sender", [`${BS}:53 (map the bearer token to a VID)`, `${BS}:124 (the in-band issuer is cross-checked against it; mismatch is identityMismatch)`, `${BS}:131 (route the error to the sender actually authenticated, never to the contested issuer)`, `${BS}:129 (the token-to-VID mapping is deployment-defined, so the vector runs where the transport authenticates the sender)`, `${BS}:135 (the status mapping is a SHOULD)`],
    [{ send: httpReq({}, { from: { spoof: "X" } }), expect: { disposition: "error", code: "identityMismatch", noSideEffect: true, httpStatusShould: 422, ...wireJson } },
     { send: httpReq({ id: "$id(r2)" }), expect: { disposition: "response", httpStatusShould: 200, state: { handled: 1 } } }],
    { requires: ["binding:https", "optional:transportIdentity"], mutants: ["ignoreTransportIdentity", "mismatchRoutedToIssuer", "leakIdentityInMessage", "httpStatusFlat"] }),
  bv("BND-003", "a request with no Authorization header has no transport-authenticated sender and is judged on its proof", [`${BS}:53 (no Authorization: no transport-authenticated sender)`, `${BS}:124 (absent for requests with no Authorization header)`],
    [{ send: httpReq({}, { from: "none" }), expect: { disposition: "response", httpStatus: 200, ...wireJson, state: { handled: 1 } } }],
    { skipIfOptional: ["binding.requireBearer"], mutants: ["httpNoAuthIs401"] }),
  bv("BND-004", "the single-document answers: 200 with the response, and every answer, error documents included, carries Content-Type application/json", [`${BS}:161 (Content-Type application/json for every single-document answer)`, `${BS}:135 (the status mapping is a SHOULD; the codes themselves are BND-007)`, `${BS}:139 (200 for a response)`],
    [{ send: httpReq(), expect: { disposition: "response", httpStatusShould: 200, ...wireJson, state: { handled: 1 } } },
     { send: httpReq({ id: "$id(r2)", payload: CARRIER_BAD }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true, ...wireJson } },
     { send: httpReq({ id: "$id(r3)", type: "https://trusttasks.org/spec/conformance/gadget/0.1" }), expect: { disposition: "error", code: "unsupportedType", noSideEffect: true, ...wireJson } },
     { send: httpReq({ id: "$id(r4)", issuedAt: "$nowAt(-windowSkew,-20s)", expiresAt: "$nowAt(-windowSkew,-10s)" }), expect: { disposition: "error", code: "expired", noSideEffect: true, ...wireJson } },
     { send: httpReq({ id: "$id(r5)" }, { mutate: [{ op: "set", path: "/threadId", value: "urn:uuid:tampered", afterSign: true }] }), expect: { disposition: "error", code: "proofInvalid", noSideEffect: true, ...wireJson } },
     { send: httpReq({ id: "$id(r6)", recipient: "$X" }), expect: { disposition: "error", code: "wrongRecipient", noSideEffect: true, ...wireJson } },
     { send: httpReq({ id: "$id(r7)" }), expect: { disposition: "response", httpStatusShould: 200, state: { handled: 2 } } },
     { send: { same: "previous", mutate: [{ op: "set", path: "/threadId", value: "urn:uuid:other-content" }], sign: { as: "A" }, http: H }, expect: { disposition: "error", code: "idConflict", noSideEffect: true, ...wireJson } }],
    { mutants: ["httpWrongContentType"] }),
  bv("BND-005", "a duplicate of a completed execution is answered with the retained response under 200", [`${BS}:159 (a duplicate is answered with the response the first execution produced, under 200 OK)`, "SPEC.md:1021 (7.2 item 11)"],
    [{ send: httpReq(), expect: { disposition: "response", httpStatus: 200, state: { handled: 1 } } },
     { at: "+5s", send: { same: "previous", http: H }, expect: { disposition: "duplicate", httpStatus: 200, ...wireJson, state: { handled: 1 } } }],
    { mutants: ["httpDuplicateStatusSwapped", "duplicateAsFailure"] }),
  bv("BND-006", "the proof is verified over the received JSON object: unknown members, key order and layout are preserved", [`${BS}:54 (keep the received JSON object; the proof is verified over it, not over a re-serialisation of the typed document)`],
    [{ send: httpReq({ "x-unrecognised": { anything: 1 } }, { mutate: [{ op: "reorder" }] }), expect: { disposition: "response", httpStatus: 200, state: { handled: 1 } } }],
    { mutants: ["httpVerifyOverTypedDoc"] }),
  bv("BND-007", "the status table (attested profile): 200 with the response, 400 malformedRequest, 409 idConflict, and the flat 422 bucket, every body application/json", [`${BS}:139-156 (status mapping: SHOULD, spec.md:135)`, "profile:attested (the status table)"],
    [{ send: httpReq(), expect: { disposition: "response", httpStatus: 200, ...wireJson, state: { handled: 1 } } },
     { send: httpReq({ id: "$id(r2)", payload: CARRIER_BAD }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true, httpStatus: 400, ...wireJson } },
     { send: httpReq({ id: "$id(r3)", type: "https://trusttasks.org/spec/conformance/gadget/0.1" }), expect: { disposition: "error", code: "unsupportedType", noSideEffect: true, httpStatus: 422, ...wireJson } },
     { send: httpReq({ id: "$id(r4)", issuedAt: "$nowAt(-windowSkew,-20s)", expiresAt: "$nowAt(-windowSkew,-10s)" }), expect: { disposition: "error", code: "expired", noSideEffect: true, httpStatus: 422, ...wireJson } },
     { send: httpReq({ id: "$id(r5)" }, { mutate: [{ op: "set", path: "/threadId", value: "urn:uuid:tampered", afterSign: true }] }), expect: { disposition: "error", code: "proofInvalid", noSideEffect: true, httpStatus: 422, ...wireJson } },
     { send: httpReq({ id: "$id(r6)", recipient: "$X" }), expect: { disposition: "error", code: "wrongRecipient", noSideEffect: true, httpStatus: 422, ...wireJson } },
     { send: httpReq({ id: "$id(r7)" }), expect: { disposition: "response", httpStatus: 200, state: { handled: 2 } } },
     { send: { same: "previous", mutate: [{ op: "set", path: "/threadId", value: "urn:uuid:other-content" }], sign: { as: "A" }, http: H }, expect: { disposition: "error", code: "idConflict", noSideEffect: true, httpStatus: 409, ...wireJson } }],
    { tier: 2, subgroup: "attested", mutants: ["httpStatusFlat", "httpErrorAs200"] } as Partial<Vector>),
], BND_FAMILY);

// ---------------------------------------------------------------- 2PC (docs/04 section 12)
const D4 = "docs/04-suite-design.md";
const TWO_FAMILY = "two-phase-commit";
const TPC_REQ = [ISS_T, ...VRC_REQ, "optional:trigger.twoPhase"];
const tpc = (id: string, title: string, spec: string[], steps: Step[], rest: Partial<Vector> = {}): Vector =>
  v(id, title, 1, spec, steps, { requires: TPC_REQ, ...rest });
const twoPhase = (outcome: string, args: Record<string, unknown> = {}): Step => ({ trigger: { action: "twoPhase", args: { outcome, ...args } } });
const issueN = (n: number): NonNullable<Step["send"]> => issue({}, { id: `$id(iss${n})` }, { http: H });
const twopc = file("2PC", [
  tpc("2PC-001", "an aborted transaction or a no vote is an error, never a receipt; nothing is stored and the document ends errored", [`${D4} section 12 (a vote no, or the transaction aborted: errored, taskFailed)`, `${D4} section 12 assertion 1 (a #response only after the observable outcome is committed)`, "SPEC.md:1310 (8.3 taskFailed; 1311 is unavailable)"],
    [...accepted(), twoPhase("abort", { reason: "storeFailed" }),
     { send: issueN(1), expect: { disposition: "error", code: "taskFailed", noSideEffect: true, httpStatus: 422, state: { stored: 0, documentState: { "$id(iss1)": "errored" } } } },
     twoPhase("voteNo"),
     { send: issueN(2), expect: { disposition: "error", code: "taskFailed", noSideEffect: true, state: { stored: 0, documentState: { "$id(iss2)": "errored" } } } },
     { at: "+5s", send: issueN(3), expect: { ...receipt(), state: { stored: 1, documentState: { "$id(iss3)": "responded" } } } }],
    { mutants: ["respondOnPrepare", "abortStillStores"] }),
  tpc("2PC-002", "an abort reaches the wire as a short closed-vocabulary reason; an internal fact does not", [`${D4} section 12 (details.reason from a closed vocabulary)`, "SPEC.md:1282 (8.2.1 a message must not disclose internal state)"],
    [...accepted(), twoPhase("abort", { reason: "storeFailed" }),
     { send: issueN(1), expect: { disposition: "error", code: "taskFailed", retryable: false, noSideEffect: true, match: { "/payload/details/reason": "^[a-z][A-Za-z0-9]{1,63}$" } } },
     twoPhase("abort", { internal: "constraint violation at row 42 secret-ref" }),
     { send: issueN(2), expect: { disposition: "error", code: ["taskFailed", "internalError"], noSideEffect: true, forbidInReply: ["secret-ref", "row 42"] } }],
    { clarify: "The closed vocabulary of details.reason and the use of taskFailed for an abort are the design of docs/04 section 12, not specification text (docs/01: assumed). Not gating.", mutants: ["abortLeaksInternalReason", "abortReasonFreeText"] }),
  tpc("2PC-006", "a transaction that committed but whose reply was lost is not executed again: the resend is absorbed or answered with the receipt, and the effect count stays 1", [`${D4} section 12 assertion 4 (after commit a duplicate returns the same receipt or nothing and the effect count stays 1)`, "SPEC.md:1021 (7.2 item 11)", `${BS}:143 (completed execution, no retained response: 204)`],
    [...accepted(), twoPhase("commit", { deliver: false }),
     { send: issueN(1), expect: { disposition: "silence", state: { stored: 1, documentState: { "$id(iss1)": "responded" } } } },
     { at: "+5s", send: { same: "previous", http: H }, expect: { disposition: "duplicate", priorReplyLost: true, httpStatus: [200, 204], state: { stored: 1 } } }],
    { mutants: ["noReplayRecord", "duplicateAsFailure"] }),
  tpc("2PC-007", "while the outcome is not known the document stays accepted: no receipt, a resend is absorbed (202), other bytes under the id are idConflict, and the receipt follows the commit", [`${D4} section 12 (duplicate while in flight; outcome unknown is never guessed as responded)`, `${BS}:142 (in-progress duplicate: 202, empty body)`, "SPEC.md:1021 (7.2 item 11; the idConflict rejection is a MUST)", `${BS}:154 (idConflict 409 Conflict: status mapping is a SHOULD, spec.md:137; asserted as an advisory)`],
    [...accepted(), twoPhase("unknown"),
     { send: issueN(0), expect: { disposition: "any-refusal", noSideEffect: true, state: { stored: 0, documentState: { "$id(iss0)": "accepted" } } } },
     { trigger: { action: "settle", args: { outcome: "abort", reason: "storeFailed" } }, expect: { disposition: "error", code: "taskFailed", state: { stored: 0, documentState: { "$id(iss0)": "errored" } } } },
     twoPhase("inflight"),
     { at: "+5s", send: issueN(1), expect: { disposition: "silence", noSideEffect: true, state: { stored: 0, documentState: { "$id(iss1)": "accepted" } } } },
     { at: "+6s", send: { same: "previous", http: H }, expect: { disposition: "duplicate", httpStatus: 202, httpBody: "none", state: { stored: 0 } } },
     { at: "+7s", send: { same: "previous", mutate: [{ op: "set", path: "/payload/ext", value: { changed: true } }], sign: { as: "A" }, http: H }, expect: { disposition: "error", code: "idConflict", retryable: false, noSideEffect: true, httpStatus: 409 } },
     { trigger: { action: "settle", args: { outcome: "commit" } }, expect: { disposition: "response", type: `${ISS_T}#response`, state: { stored: 1, documentState: { "$id(iss1)": "responded" } } } }],
    { mutants: ["inflightAsResponded", "duplicateAsFailure", "idOnlyDuplicateKey", "httpDuplicateStatusSwapped"] }),
  tpc("2PC-008", "fail closed on the ceremony path: an unreadable duplicate record refuses the issue as unavailable (retryable), nothing is stored, and the resend executes once", [`${D4} section 12 (duplicate-record store unreadable: unavailable, retryable)`, `${BS}:155 (unavailable: 503)`, "SPEC.md:1021 (7.2 item 11 cannot be honoured without the record)"],
    [...accepted(), { trigger: { action: "fault", args: { claimStore: "unreadable" } } },
     { send: issueN(1), expect: { disposition: "error", code: "unavailable", retryable: true, noSideEffect: true, httpStatus: 503, state: { stored: 0 } } },
     { trigger: { action: "fault", args: { claimStore: "ok" } } },
     { at: "+5s", send: { same: "previous", http: H }, expect: { ...receipt(), state: { stored: 1 } } }],
    { requires: [ISS_T, ...VRC_REQ, "optional:fault.claimStore"], clarify: "The framework does not say what an unreadable duplicate record yields; fail closed with unavailable is the design rule (docs/04 section 12), as for DUP-007. Not gating.", mutants: ["claimStoreFailOpen", "claimStoreFailsAsTaskFailed", "claimStoreFaultBurnsId", "httpStatusFlat"] }),
], TWO_FAMILY);

// ---------------------------------------------------------------- CER (ceremony documents), 2PC-003..005, TIME-103
const NS = "specs/trust-task-next-step/0.1/spec.md";
const NSP = "specs/trust-task-next-step/0.1/payload.schema.json";
const CER_FAMILY = "ceremony-doc";
const CER_REQ = ["optional:ceremony"];
const cer = (id: string, title: string, spec: string[], steps: Step[], rest: Partial<Vector> = {}): Vector =>
  v(id, title, 1, spec, steps, { requires: CER_REQ, ...rest });
type CerSend = Partial<NonNullable<Step["send"]>>;
/** Ceremony documents come from the implementation's declared family: A begins and resets, X approves (both are administrators); `p` overrides members. */
const cBegin = (p: Record<string, unknown> = {}, more: CerSend = {}): NonNullable<Step["send"]> => ({ template: "ceremony.begin", from: "A", ...(Object.keys(p).length > 0 ? { params: p } : {}), ...more });
const cApprove = (p: Record<string, unknown> = {}, more: CerSend = {}): NonNullable<Step["send"]> => ({ template: "ceremony.approve", from: "X", ...(Object.keys(p).length > 0 ? { params: p } : {}), ...more });
const cReset = (p: Record<string, unknown> = {}, more: CerSend = {}): NonNullable<Step["send"]> => ({ template: "ceremony.reset", from: "A", ...(Object.keys(p).length > 0 ? { params: p } : {}), ...more });
const CER_HOLD: NonNullable<Step["expect"]> = { disposition: "next-step", hold: true, noSideEffect: true, state: { effects: 0 } };
const cHold = (thread = "$id(begin)"): NonNullable<Step["expect"]> => ({ ...CER_HOLD, pointer: { "/threadId": thread } });
const cDone = (kind: "begin" | "approve" | "reset", effects: number): NonNullable<Step["expect"]> => ({ disposition: "response", type: `$cerResponse(${kind})`, state: { effects } });
const cStatus = (p: Record<string, unknown> = {}, more: CerSend = {}): NonNullable<Step["send"]> => ({ template: "ceremony.status", from: "A", ...(Object.keys(p).length > 0 ? { params: p } : {}), ...more });
/**
 * The proposer's own approval, sent only where the implementation declares that a begin does not count as one (`ceremony.proposerApproves`
 * false; docs/04 section 11.4). It is held (the other administrator is still awaited). `name` keeps the document ids of repeats apart;
 * `thread` names another ceremony.
 */
const cProposer = (at: string, name = "appA", thread?: string): Step => ({
  at, when: { proposerApproves: false },
  send: cApprove({ id: `$id(${name})`, issuer: "$A", ...(thread === undefined ? {} : { threadId: thread }) }, { from: "A" }),
  expect: thread === undefined ? cHold() : { ...CER_HOLD, pointer: { "/threadId": thread } },
});
const NON_ADMIN = { issuer: "$Q", id: "$id(app0)" };
const deadline = (seconds: number): Step => ({ trigger: { action: "ceremonyDeadline", args: { seconds } } });
const effect = (outcome: string, args: Record<string, unknown> = {}): Step => ({ trigger: { action: "ceremonyEffect", args: { outcome, ...args } } });
const GATE_DEADLINE = "optional:trigger.ceremonyDeadline";
const GATE_EFFECT = "optional:trigger.ceremonyEffect";
const LAPSED: NonNullable<Step["expect"]> = { disposition: "error", code: "taskFailed", retryable: false, noSideEffect: true, pointer: { "/payload/details/reason": "deadlineLapsed" }, state: { effects: 0 } };
const HOLD_SPEC = ["SPEC.md:1414 (8.6: a held task is answered with a next step, never an error)", "SPEC.md:1417 (an approval by someone else: expects names a task to learn the outcome or, where there is none, the originating Type URI with continuation resubmit)"];
const DOC_BASIS = `${D4} section 11.4`;

const cerFile = file("CER", [
  cer("CER-001", "a ceremony that still needs approvals is answered with a next-step: in the begin's thread, naming the begin, never an error or silence; nothing is established", [...HOLD_SPEC, `${NS}:82-84 (threadId; expects at least one entry; inResponseTo)`, `${NSP}:42 (continuation: resubmit is the default; proceed means the expected task is the continuation)`, `${DOC_BASIS} (the continuation of a hold that names a status task is an open question; asserted only where expects names the request's own type)`],
    [{ quorum: "begin" }],
    { mutants: ["cerHoldAnswersError", "cerHoldSilent", "cerHoldContinuationProceed", "cerHoldNoInResponseTo"] }),
  cer("CER-002", "where the implementation offers no status task, a resubmitted begin (fresh id, same thread) gets a further next-step while the approvals are awaited and the outcome once it is known, without a second effect", [...HOLD_SPEC, "SPEC.md:1417 (the consumer answers a resubmission in the same thread with the outcome once it is known, or with a further next step)", `${NS}:94 (resubmit: a new document with a fresh id and the same threadId)`],
    [{ quorum: "begin" },
     { at: "+5s", send: cBegin({ id: "$id(begin2)", threadId: "$id(begin)", issuer: "$E1" }, { from: "E1" }), expect: cHold() },
     { at: "+10s", quorum: "rest" },
     { at: "+15s", send: cBegin({ id: "$id(begin3)", threadId: "$id(begin)", issuer: "$E1" }, { from: "E1" }), expect: cDone("begin", 1) }],
    { skipIfOptional: ["ceremony.status"], mutants: ["cerResubmitError", "cerResubmitSecondEffect", "cerHoldSilent"] }),
  cer("CER-003", "an approval that completes the quorum is answered with the response, and the effect exists when it is", [`${D4} section 12 assertion 1 (a #response only after the observable outcome is committed and the effect exists)`, "SPEC.md:1022 (7.2 item 12: conditions re-evaluated before each irreversible effect)", `${DOC_BASIS}`],
    [{ send: cBegin(), expect: cHold() },
     cProposer("+3s"),
     { at: "+5s", send: cApprove(), expect: { ...cDone("approve", 1), state: { effects: 1, handled: 1, documentState: { "$id(app)": "responded" } } } }],
    { mutants: ["cerRespondWithoutEffect", "cerRespondOnFirstApproval"] }),
  cer("CER-004", "approving twice is idempotent: a repeat by the same administrator does not count as another's, and a repeat after the commit is answered with the outcome again, without a second effect", ["SPEC.md:1061 (setting a state: an operation SHOULD succeed when the target is already in that state)", `${D4} section 11.4 (re-approve is a no-op, also after the commit)`],
    [{ send: cBegin(), expect: cHold() },
     { at: "+5s", send: cApprove({ id: "$id(app0)", issuer: "$A" }, { from: "A" }), expect: cHold() },
     // Where a begin is not the proposer's approval the first approval above was the proposer's own: repeat it.
     cProposer("+7s", "appA2"),
     { at: "+10s", send: cApprove(), expect: cDone("approve", 1) },
     { at: "+15s", send: cApprove({ id: "$id(app2)" }), expect: cDone("approve", 1) }],
    { clarify: "Idempotent approval rests on a SHOULD about setting a state (SPEC.md 1061) and a profile rule; the framework does not say what a repeated approval yields. Not gating.", mutants: ["cerDoubleApproveCountsTwice", "cerReapproveAfterCommitError", "cerReapproveSecondEffect"] }),
  cer("CER-005", "the same approval document delivered again after the commit is absorbed: the first reply again, and the effect count stays 1", ["SPEC.md:1021 (7.2 item 11: the same consequential document is not executed twice)", "SPEC.md:1055 (disposition of a duplicate: the previously determined result)"],
    [{ quorum: "complete" },
     { at: "+10s", send: { same: "previous" }, expect: { disposition: "duplicate", state: { effects: 1, handled: 1 } } }],
    { mutants: ["noReplayRecord", "duplicateAsFailure"] }),
  cer("CER-006", "an approval by a party that is not an administrator is permissionDenied, records nothing, and leaves the ceremony able to commit", ["SPEC.md:1305 (8.3 permissionDenied: the requesting party is not authorized)", "SPEC.md:1020 (7.2 item 10: a verified proof is not authorization)", `${D4} section 11.4 (admins named in the begin are the approvers)`],
    [{ send: cBegin(), expect: cHold() },
     { at: "+5s", send: cApprove(NON_ADMIN, { from: "Q" }), expect: { disposition: "error", code: "permissionDenied", retryable: false, noSideEffect: true, state: { effects: 0 } } },
     cProposer("+7s"),
     { at: "+10s", send: cApprove(), expect: cDone("approve", 1) }],
    { mutants: ["cerNonAdminApproves", "cerNonAdminTaskFailed"] }),
  cer("CER-007", "a non-administrator's approval of a ceremony gets the same refusal as an approval of a ceremony that does not exist", ["SPEC.md:1063 (a missing target: the same code MAY serve a target that exists but which the requester may not see, so the answer reveals nothing)", `${DOC_BASIS}`],
    [{ send: cApprove(NON_ADMIN, { from: "Q" }), expect: { disposition: "error", code: "permissionDenied", noSideEffect: true } },
     { at: "+5s", send: cBegin(), expect: cHold() },
     { at: "+10s", send: cApprove({ ...NON_ADMIN, id: "$id(app1)" }, { from: "Q" }), expect: { disposition: "error", code: "permissionDenied", sameErrorAs: 1, noSideEffect: true } }],
    { clarify: "The framework permits (MAY) one code for 'missing' and 'not allowed to see'; it does not require the two answers to be identical. Not gating.", mutants: ["cerOracle"] }),
  cer("CER-008", "an approval after the ceremony's deadline is refused as taskFailed with details.reason deadlineLapsed (not the framework's expired), and nothing is established", [`${D4} section 12 (deadline lapses while pending: taskFailed, details.reason deadlineLapsed; settled; a late approval is refused)`, "docs/decisions/README.md section Holds, ceremonies and relationship credentials (expired is reserved for the envelope's expiresAt)", "SPEC.md:1045 (a ceremony's window is a lifetime set by policy, not an acceptance window)"],
    [deadline(3600), { send: cBegin(), expect: cHold() }, { at: "+3601s", send: cApprove(), expect: LAPSED }],
    { requires: [...CER_REQ, GATE_DEADLINE], mutants: ["cerNoDeadline", "cerDeadlineExpiredCode"] }),
  cer("CER-009", "a reset is refused while the ceremony is pending and after it committed, and changes nothing", [`${D4} section 12 (reset after commit is refused or reported with its effects, never a clean cancel)`, "docs/06-truststackers-conformance-plan.md section 3.9 (reset only from failed or expired)", "SPEC.md:1022 (7.2 item 12: an irreversible effect is not undone by a later request)"],
    [{ send: cBegin(), expect: cHold() },
     { at: "+5s", send: cReset(), expect: { disposition: "error", code: ["taskFailed", "permissionDenied"], noSideEffect: true, state: { effects: 0 } } },
     cProposer("+7s"),
     { at: "+10s", send: cApprove(), expect: cDone("approve", 1) },
     { at: "+15s", send: cReset({ id: "$id(rst2)" }), expect: { disposition: "error", code: ["taskFailed", "permissionDenied"], noSideEffect: true, state: { effects: 1 } } }],
    { mutants: ["cerResetPending", "cerResetAfterCommit"] }),
  cer("CER-010", "a refused effect ends the ceremony failed: an error with a closed details.reason and no effect; a reset from failed is allowed", [`${D4} section 12 (a vote no, or the transaction aborted: errored, taskFailed, details.reason from a closed vocabulary)`, "docs/06-truststackers-conformance-plan.md section 3.9 (reset from failed or expired is allowed)", "SPEC.md:1310 (8.3 taskFailed)"],
    [effect("fail", { reason: "nameTaken" }), { send: cBegin(), expect: cHold() },
     cProposer("+3s"),
     { at: "+5s", send: cApprove(), expect: { disposition: "error", code: "taskFailed", noSideEffect: true, match: { "/payload/details/reason": "^[a-z][A-Za-z0-9]{1,63}$" }, state: { effects: 0, documentState: { "$id(app)": "errored" } } } },
     { at: "+10s", send: cReset(), expect: cDone("reset", 0) }],
    { requires: [...CER_REQ, GATE_EFFECT], clarify: "The closed vocabulary of details.reason and the use of taskFailed for a refused effect are the design of docs/04 section 12, not specification text (as for 2PC-002). Not gating.", mutants: ["cerFailAsInternalError", "cerResetFailedRefused"] }),
  cer("CER-011", "while the effect's outcome is unknown the answer is a retryable indeterminate: not the response, not a refusal, nothing established; the response follows the commit", ["SPEC.md:1312 (8.3 indeterminate: could not decide; neither refused nor found invalid; retryable)", "SPEC.md:1317 (indeterminate is a result of its own)", `${D4} section 12 (outcome unknown: indeterminate (retryable) or still accepted; never guessed as responded)`],
    [effect("unknown"), { send: cBegin(), expect: cHold() },
     cProposer("+3s"),
     { at: "+5s", send: cApprove(), expect: { disposition: "error", code: "indeterminate", retryable: true, noSideEffect: true, state: { effects: 0, documentState: { "$id(app)": "accepted" } } } },
     { trigger: { action: "settle", args: { outcome: "commit" } }, expect: cDone("approve", 1) }],
    { requires: [...CER_REQ, GATE_EFFECT, "optional:trigger.twoPhase"], mutants: ["cerUnknownAsResponded", "cerUnknownAsTaskFailed", "cerUnknownNotRetryable"] }),
  cer("CER-012", "a reset after the commit is refused with details.reason alreadyCommitted", [`${D4} section 12 (reset after commit is refused)`, "docs/06-truststackers-conformance-plan.md section 3.9 (reset after commit gives alreadyCommitted)", "docs/06-truststackers-conformance-plan.md section 12.1 (closed reason vocabulary)"],
    [{ send: cBegin(), expect: cHold() }, cProposer("+3s"), { at: "+5s", send: cApprove(), expect: cDone("approve", 1) },
     { at: "+10s", send: cReset(), expect: { disposition: "error", code: "taskFailed", noSideEffect: true, pointer: { "/payload/details/reason": "alreadyCommitted" }, state: { effects: 1 } } }],
    { clarify: "The reason token alreadyCommitted is truststackers' closed vocabulary (docs/06 section 3.9), not framework text. Not gating.", mutants: ["cerResetAfterCommit", "cerResetReasonWrong"] }),
  cer("CER-013", "a ceremony document is retained verbatim: the request as received (key order and layout kept) and the reply as sent", ["docs/06-truststackers-conformance-plan.md section 3.7 (raw document retained: store verbatim every accepted document and every one refused after verification)", "docs/06-truststackers-conformance-plan.md section 12.2 (why verified documents are retained verbatim)", "SPEC.md:1342-1346 (8.4: a retry is the bit-for-bit identical document; the proof is over those bytes)"],
    [{ send: cBegin({}, { mutate: [{ op: "reorder" }] }), expect: { ...cHold(), state: { effects: 0, retained: { id: "$id(begin)", request: 1, reply: 1 } } } }],
    { requires: [...CER_REQ, "optional:observe.retained"], clarify: "Verbatim retention is a profile rule (docs/06 section 3.7); the framework asks only for outcome evidence of cited exchanges (SPEC.md 4.9.4). Not gating.", mutants: ["cerRetainNormalised", "cerRetainNothing"] }),
  cer("CER-014", "the declared ceremony.proposerApproves is what the implementation does: where a begin counts as the proposer's approval, one approval by the other administrator completes the quorum; where it does not, that approval alone leaves the ceremony held and the proposer's own approval completes it", [`${DOC_BASIS} (the declared property proposerApproves)`, "SPEC.md:1417 (a quorum: an approval by someone else holds the task until the approvals are in)"],
    [{ send: cBegin(), expect: cHold() },
     { at: "+5s", when: { proposerApproves: true }, send: cApprove(), expect: cDone("approve", 1) },
     { at: "+5s", when: { proposerApproves: false }, send: cApprove(), expect: { ...cHold(), state: { effects: 0, handled: 0, documentState: { "$id(begin)": "accepted" } } } },
     { at: "+10s", when: { proposerApproves: false }, send: cApprove({ id: "$id(appA)", issuer: "$A" }, { from: "A" }), expect: cDone("approve", 1) }],
    { mutants: ["cerProposerApprovalFlip", "cerRespondOnFirstApproval"] }),
  cer("CER-015", "where the implementation offers a status task, a ceremony held for approvals is answered with a next-step that names it in expects, in the begin's thread and naming the begin, and the begin stays open (accepted); the continuation value is not asserted", [...HOLD_SPEC, `${NS}:82-84 (threadId; expects at least one entry; inResponseTo)`, `${NSP}:42 (continuation: neither value is defined for a status task; not asserted)`, `${DOC_BASIS} (the continuation of a hold that names a status task is an open question)`],
    [{ quorum: "begin", expect: { ...cHold(), state: { effects: 0, handled: 0, documentState: { "$id(begin)": "accepted" } } } }],
    { requires: [...CER_REQ, "optional:ceremony.status"], mutants: ["cerHoldStatusNotNamed", "cerHoldAnswersError", "cerHoldSilent"] }),
  cer("CER-016", "where the implementation offers a status task, asking it about a held ceremony is answered with a response of its own type in the ceremony's thread and records no approval and no effect; asked again after the commit it answers again, without a second effect", ["SPEC.md:1417 (expects names a task by which the producer can learn the outcome)", `${DOC_BASIS} (the status task)`],
    [{ send: cBegin(), expect: cHold() },
     cProposer("+3s"),
     { at: "+5s", send: cStatus({ issuer: "$X" }, { from: "X" }), expect: { disposition: "response", type: "$cerResponse(status)", pointer: { "/threadId": "$id(begin)" }, state: { effects: 0, handled: 0, documentState: { "$id(begin)": "accepted" } } } },
     { at: "+10s", send: cApprove(), expect: cDone("approve", 1) },
     { at: "+15s", send: cStatus({ id: "$id(sts2)" }), expect: { disposition: "response", type: "$cerResponse(status)", pointer: { "/threadId": "$id(begin)" }, state: { effects: 1, handled: 1 } } }],
    { requires: [...CER_REQ, "optional:ceremony.status"], clarify: "The status task's own behaviour is the implementation's design. SPEC.md 8.6 says only that expects names a task by which the producer can learn the outcome; that a query of a held ceremony is answered with a response of the task's own type, without recording an approval or running the effect, is the minimal reading of that and not stated text. Not gating.", mutants: ["cerStatusSilent", "cerStatusError", "cerStatusAsNextStep", "cerStatusApproves", "cerStatusSecondEffect"] }),
  // Behaves per declared E (decision 39, docs/04 section 11.4): the steps are expanded from the authority set and k the adapter declares.
  cer("CER-017", "behaves per declared E: the ceremony completes exactly at the k-th distinct approval from the declared authority set; each earlier one is held with no effect, and the k-th is answered with the response and the effect (runs at k = 1 too)", [...HOLD_SPEC, "SPEC.md:1022 (7.2 item 12: conditions re-evaluated before each irreversible effect)", `${DOC_BASIS} (the declared essential governance: authority set and minApprovals)`],
    [{ quorum: "exact" }],
    { mutants: ["cerQuorumEarly", "cerQuorumLate", "cerRespondOnFirstApproval"] }),
  cer("CER-018", "behaves per declared E: an approval from a party outside the declared authority set is refused and not counted; the ceremony still completes only at the k-th distinct approval from the set", ["SPEC.md:1020 (7.2 item 10: a verified proof is not authorization)", "SPEC.md:1305 (8.3 permissionDenied: the requesting party is not authorized)", `${DOC_BASIS} (the declared essential governance: authority set and minApprovals)`],
    [{ quorum: "outsider" }],
    { mutants: ["cerNonAdminApproves"] }),
  cer("CER-019", "behaves per declared E: a repeat approval by the same member of the authority set (a fresh document) is not counted as another member's; completion still takes k distinct members (needs k of at least 2)", ["SPEC.md:1061 (setting a state: an operation SHOULD succeed when the target is already in that state)", `${DOC_BASIS} (the declared essential governance: k distinct approvals)`],
    [{ quorum: "repeat" }],
    { mutants: ["cerDoubleApproveCountsTwice"] }),
], CER_FAMILY);

twopc.vectors.push(
  tpc("2PC-003", "a ceremony short of its quorum is visible to the producer only as a next-step: the begin document stays accepted (neither responded nor errored) and nothing is established", [`${D4} section 12 (more approvals needed: accepted and blocked; trust-task-next-step)`, ...HOLD_SPEC, "docs/06-truststackers-conformance-plan.md section 3.9 (2PC-003: pending proposals visible only through next-step)"],
    [{ send: cBegin(), expect: { ...cHold(), state: { effects: 0, handled: 0, documentState: { "$id(begin)": "accepted" } } } },
     cProposer("+3s"),
     { at: "+5s", send: cApprove(), expect: { ...cDone("approve", 1), state: { effects: 1, handled: 1 } } }],
    { requires: CER_REQ, mutants: ["cerHoldPendingResponded", "cerHoldAnswersError", "cerRespondOnFirstApproval"] }),
  tpc("2PC-004", "the deadline is enforced on the participant path: a late approval is refused deadlineLapsed, the begin document ends errored, and a second late approval gets the same refusal", [`${D4} section 12 (deadline lapses while pending: errored, taskFailed, details.reason deadlineLapsed)`, "docs/decisions/README.md section Holds, ceremonies and relationship credentials (deadlineLapsed, not expired)", "docs/06-truststackers-conformance-plan.md section 3.9 (2PC-004: expiry enforced on the participant path)"],
    [deadline(3600), { send: cBegin(), expect: cHold() },
     { at: "+3601s", send: cApprove(), expect: { ...LAPSED, state: { effects: 0, handled: 0, documentState: { "$id(begin)": "errored" } } } },
     { at: "+3700s", send: cApprove({ id: "$id(app2)", issuer: "$A" }, { from: "A" }), expect: { ...LAPSED, sameErrorAs: 3 } }],
    { requires: [...CER_REQ, GATE_DEADLINE], mutants: ["cerNoDeadline", "cerLateErrorUnstable", "cerDeadlineExpiredCode"] }),
  tpc("2PC-005", "a reset is allowed from an expired ceremony and refused after a commit, which keeps its effect", [`${D4} section 12 (reset after commit is refused or reported with its effects, never a clean cancel)`, "docs/06-truststackers-conformance-plan.md section 3.9 (2PC-005: reset guarded to failed or expired; reset after commit refused)"],
    [deadline(3600), { send: cBegin(), expect: cHold() },
     { at: "+3601s", send: cApprove(), expect: LAPSED },
     { at: "+3602s", send: cReset(), expect: cDone("reset", 0) },
     { at: "+4000s", send: cBegin({ id: "$id(begin2)", threadId: "$id(begin2)" }), expect: cHold("$id(begin2)") },
     cProposer("+4005s", "appA2", "$id(begin2)"),
     { at: "+4010s", send: cApprove({ id: "$id(app2)", threadId: "$id(begin2)" }), expect: cDone("approve", 1) },
     { at: "+4020s", send: cReset({ id: "$id(rst2)", threadId: "$id(begin2)" }), expect: { disposition: "error", code: ["taskFailed", "permissionDenied"], noSideEffect: true, state: { effects: 1 } } }],
    { requires: [...CER_REQ, GATE_DEADLINE], mutants: ["cerResetExpiredRefused", "cerResetAfterCommit"] }),
);
time.push(v("TIME-103", "a ceremony's deadline is half-open: an approval one second before it commits, one made exactly at it is refused", 1,
  [`${D4} section 11.4 (late approvals are refused at the deadline instant)`, "docs/06-truststackers-conformance-plan.md section 3.8 (half-open at expiresAt)", "SPEC.md:1045 (a ceremony window is policy, not a framework rule: the half-open deadline is the suite design)"],
  [deadline(3600), { send: cBegin(), expect: cHold() },
   cProposer("+10s"),
   { at: "+3599s", send: cApprove(), expect: cDone("approve", 1) },
   { at: "+4000s", send: cBegin({ id: "$id(begin2)", threadId: "$id(begin2)" }), expect: { ...cHold("$id(begin2)"), state: { effects: 1 } } },
   { at: "+7600s", send: cApprove({ id: "$id(app2)", threadId: "$id(begin2)" }), expect: { ...LAPSED, state: { effects: 1 } } }],
  { requires: [...CER_REQ, GATE_DEADLINE], mutants: ["cerDeadlineInclusive", "cerNoDeadline"] }));

// ---------------------------------------------------------------- 3b-DTG: TC (task-consent) and CEX (credential-exchange), docs/04 section 11.5
const TC_REQ_T = "https://trusttasks.org/spec/task-consent/request/0.1";
const TC_DEC_T = "https://trusttasks.org/spec/task-consent/decision/0.2";
const CEX_ISS_T = "https://trusttasks.org/spec/credential-exchange/issue/0.1";
const CEX_PRE_T = "https://trusttasks.org/spec/credential-exchange/present/0.1";
const CEX_QRY_T0 = "https://trusttasks.org/spec/credential-exchange/query/0.1";
const CEX_OFF_T = "https://trusttasks.org/spec/credential-exchange/offer/0.1";
const CEX_RQ_T = "https://trusttasks.org/spec/credential-exchange/request/0.1";
const TC_GRT_T = "https://trusttasks.org/spec/task-consent/granted/0.1";
const TC_DEC01_T = "https://trusttasks.org/spec/task-consent/decision/0.1";
const QRY_CRED = "https://example.org/conformance#ConformanceCredential";
const CXQ_S = "specs/credential-exchange/query/0.1/spec.md";
const CXO_S = "specs/credential-exchange/offer/0.1/spec.md";
const CXR_S = "specs/credential-exchange/request/0.1/spec.md";
const TCG_S = "specs/task-consent/granted/0.1/spec.md";
const TCD1_S = "specs/task-consent/decision/0.1/spec.md";
const TCR_S = "specs/task-consent/request/0.1/spec.md";
const TCD_S = "specs/task-consent/decision/0.2/spec.md";
const CXI_S = "specs/credential-exchange/issue/0.1/spec.md";
const CXP_S = "specs/credential-exchange/present/0.1/spec.md";
const CXP2_S = "specs/credential-exchange/present/0.2/spec.md";
const CXP2_P = "specs/credential-exchange/present/0.2/payload.schema.json";
const CEX_PRE2_T = "https://trusttasks.org/spec/credential-exchange/present/0.2";
const TC_FAMILY = "dtg-task-consent";
const CEX_FAMILY = "dtg-credential-exchange";

const TCD_REQ = [TC_DEC_T, "optional:ceremony", "optional:trigger.consentBinding"];
const TCR_REQ = [TC_REQ_T, "optional:trigger.consentEnrol"];
const tcv = (id: string, title: string, spec: string[], steps: Step[], rest: Partial<Vector> = {}): Vector => v(id, title, 1, spec, steps, rest);

/** The ceremony the decision answers: held for approvals, then its consent binding is read from the implementation (docs/04 section 4.5). */
// The pending request is a ceremony held one approval short of the declared k (docs/04 section 19): the `pending` quorum step sends the
// begin and every approval before the k-th from the authority set; the k-th member (`EK`) decides. `E1` is the proposer, `EN` a member
// other than the deciding one, `EO` a harness actor outside the set. Where E is unreadable the two-administrator scenario stands in.
const tcSetup = (): Step[] => [
  { quorum: "pending" },
  { at: "+4s", trigger: { action: "consentBinding", args: { thread: "$id(begin)" } }, capture: { consentChallenge: "/challenge", consentDigest: "/payloadDigest" } },
];
const decPayload = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ challenge: "$cap(consentChallenge)", payloadDigest: "$cap(consentDigest)", decision: "approve", ...over });
const dec = (over: Record<string, unknown> = {}, more: CerSend = {}, who = "EK", extra: Record<string, unknown> = {}): NonNullable<Step["send"]> => ({
  template: "consent.decision", from: who, params: { issuer: `$${who}`, payload: decPayload(over), ...extra }, sign: { purpose: "assertionMethod" }, ...more,
});
const TC_ERR = (code: string): NonNullable<Step["expect"]> => ({ disposition: "error", code: `task-consent/decision:${code}`, retryable: false, noSideEffect: true, state: { effects: 0 } });
const GRANTED: NonNullable<Step["expect"]> = {
  disposition: "response", type: `${TC_DEC_T}#response`, state: { effects: 1 },
  pointer: { "/payload/status": "granted", "/payload/payloadDigest": "$cap(consentDigest)" },
};
const BAD_DIGEST = "zQmb1XVvHqbCe5nUPFxpJcRz3RtP4pQyKgTsWJgNBzVhE7d";
const MALFORMED: NonNullable<Step["expect"]> = { disposition: "error", code: "malformedRequest", retryable: false, noSideEffect: true, state: { effects: 0 } };

const enrol: Step = { trigger: { action: "enrolExecutor", args: { vid: "$A" } } };
const creq = (over: Record<string, unknown> = {}, more: CerSend = {}): NonNullable<Step["send"]> => ({
  template: "consent.request", ...(Object.keys(over).length > 0 ? { params: over } : {}), ...more,
});
/** A request payload with members overridden: the template's payload members are reproduced so a vector can change one. */
const REQ_PAYLOAD = (over: Record<string, unknown>): Record<string, unknown> => ({
  challenge: "9c1f4b7a2e6d80f35a4c9b1e7d2f6083", taskType: "https://trusttasks.org/spec/conformance/widget/0.1",
  payloadDigest: BAD_DIGEST, sideEffects: "mutating", exposure: { discloses: "none", actsAsSubject: false },
  effects: [{ kind: "documentChange", summary: "Changes one record." }], requester: "$Q", approverSet: "operators", minApprovals: 1,
  excludeRequester: false, expiresAt: "$nowAt(+600s)", ...over,
});
const NO_PROMPT = { handled: 0 } as const;

const TCD01_REQ = [TC_DEC01_T, "optional:ceremony", "optional:trigger.consentBinding"];
const dec01 = (over: Record<string, unknown> = {}, more: CerSend = {}, who = "EK", extra: Record<string, unknown> = {}): NonNullable<Step["send"]> => dec(over, more, who, { type: TC_DEC01_T, ...extra });
const GRANTED01: NonNullable<Step["expect"]> = { ...GRANTED, type: `${TC_DEC01_T}#response` };
const grt = (extra: Record<string, unknown> = {}, more: CerSend = {}): NonNullable<Step["send"]> => ({ template: "consent.granted", ...(Object.keys(extra).length > 0 ? { params: extra } : {}), ...more });

const tcFile = file("TC", [
  // ---- decision (the IUT is the executor with a pending request: a ceremony held for approvals)
  tcv("TC-001", "an approver's decision under assertionMethod, echoing the challenge and digest of the pending request, completes the quorum: the response of the decision type carries status granted and the echoed digest, and the effect exists", [`${TCD_S} (consumer 1 to 3, 10; Response)`, `${DOC_BASIS} (the pending request is a ceremony held for approvals)`],
    [...tcSetup(), { at: "+5s", send: dec(), expect: GRANTED }],
    { requires: TCD_REQ }),
  tcv("TC-002", "a decision whose proof purpose is authentication is refused and records nothing", [`${TCD_S} (producer 1: proofPurpose MUST be assertionMethod; consumer 1: refuse any other purpose)`],
    [...tcSetup(), { at: "+5s", send: dec({}, { sign: { purpose: "authentication" } }), expect: { disposition: "any-refusal", noSideEffect: true, state: { effects: 0 } } }],
    { requires: TCD_REQ, mutants: ["consentAnyProofPurpose"] }),
  tcv("TC-003", "a decision whose payloadDigest names no pending request is refused with task-consent/decision:noPending", [`${TCD_S} (consumer 2; errorCodes noPending)`],
    [...tcSetup(), { at: "+5s", send: dec({ payloadDigest: BAD_DIGEST }), expect: TC_ERR("noPending") }],
    { requires: TCD_REQ, mutants: ["consentNoDigestCheck"] }),
  tcv("TC-004", "a decision whose challenge is not the one issued for the pending request is refused with task-consent/decision:challengeMismatch", [`${TCD_S} (consumer 3; errorCodes challengeMismatch)`],
    [...tcSetup(), { at: "+5s", send: dec({ challenge: "0123456789abcdef0123456789abcdef" }), expect: TC_ERR("challengeMismatch") }],
    { requires: TCD_REQ, mutants: ["consentNoChallengeCheck"] }),
  tcv("TC-005", "a decision whose actionId names another action than the pending request is refused with task-consent/decision:actionMismatch", [`${TCD_S} (consumer 4; errorCodes actionMismatch)`],
    [...tcSetup(), { at: "+5s", send: dec({ actionId: "act_no-such-action" }), expect: TC_ERR("actionMismatch") }],
    { requires: TCD_REQ, mutants: ["consentNoActionCheck"] }),
  tcv("TC-006", "a decision by a signer that is not an approver is refused with task-consent/decision:notAnApprover and records nothing; the approver's own decision still completes the quorum", [`${TCD_S} (consumer 5; errorCodes notAnApprover)`, `${TCD_S} (Authorization: membership of the approver set held by the approver's own DID)`],
    [...tcSetup(), { at: "+5s", send: dec({}, {}, "EO", { id: "$id(decQ)" }), expect: TC_ERR("notAnApprover") }, { at: "+8s", send: dec(), expect: GRANTED }],
    { requires: TCD_REQ, mutants: ["consentNonApproverWrongCode", "consentNonApproverApproves"] }),
  tcv("TC-007", "evidence that does not verify is refused with task-consent/decision:evidenceInvalid; the pending request is not decided", [`${TCD_S} (consumer 7; errorCodes evidenceInvalid)`],
    [...tcSetup(), { at: "+5s", send: dec({ evidence: { kind: "approverSigned", statement: { id: "$id(stmt)" } } }), expect: TC_ERR("evidenceInvalid") }],
    { requires: TCD_REQ, mutants: ["consentEvidenceIgnored"] }),
  tcv("TC-008", "a decision payload that the schema does not allow is malformedRequest: a decision outside the enum, an unknown member, evidence outside the tagged union", [`${TCD_S} payload.invalid-examples.json (decision outside the closed enum; unknown property; evidence kind outside the union)`, "SPEC.md:1011 (7.2 item 1: the payload is validated against the task's schema)"],
    [...tcSetup(),
     { at: "+5s", send: dec({ decision: "maybe" }, {}, "EK", { id: "$id(dec1)" }), expect: MALFORMED },
     { at: "+6s", send: dec({ approverSet: "operators" }, {}, "EK", { id: "$id(dec2)" }), expect: MALFORMED },
     { at: "+7s", send: dec({ evidence: { kind: "didSigned", statement: {} } }, {}, "EK", { id: "$id(dec3)" }), expect: MALFORMED }],
    { requires: TCD_REQ, mutants: ["noPayloadValidation", "openPayload"] }),
  tcv("TC-009", "a denial closes the pending request for every approver: it is answered with status denied, and a later approval by the other approver is refused and runs no effect", [`${TCD_S} (consumer 9: on deny, close the pending request for every approver; Response status denied)`],
    [...tcSetup(),
     { at: "+5s", send: dec({ decision: "deny" }), expect: { disposition: "response", type: `${TC_DEC_T}#response`, pointer: { "/payload/status": "denied" }, state: { effects: 0 } } },
     { at: "+8s", send: dec({}, {}, "EN", { id: "$id(decA)" }), expect: { disposition: "any-refusal", noSideEffect: true, state: { effects: 0 } } }],
    { requires: TCD_REQ, mutants: ["consentDenyKeepsPending"] }),
  tcv("TC-010", "a decision without a proof is refused with proofRequired", [`${TCD_S} (proofRequirement REQUIRED: the proof is the authorization)`],
    [...tcSetup(), { at: "+5s", send: dec({}, { sign: null }), expect: { disposition: "error", code: "proofRequired", noSideEffect: true, state: { effects: 0 } } }],
    { requires: TCD_REQ, mutants: ["proofOptional"] }),
  tcv("TC-011", "an approval repeated by the same approver after the commit does not run a second effect and is answered like the first", [`${TCD_S} (consumer 10: record the approval idempotently per approver)`],
    [...tcSetup(), { at: "+5s", send: dec(), expect: GRANTED }, { at: "+9s", send: dec({}, {}, "EK", { id: "$id(dec2)" }), expect: GRANTED }],
    { requires: TCD_REQ, clarify: "The specification asks for idempotent recording but also says a request that was already decided is noPending; which answer a repeat after the commit gets is not stated. The vector asserts the repeated answer and no second effect. Not gating.", mutants: ["consentReapproveSecondEffect"] }),
  // ---- request (the IUT is the approver device)
  tcv("TC-012", "a request from an enrolled executor is answered with a response of the request type carrying status prompted, and one prompt is raised", [`${TCR_S} (consumer 7: return a response with status prompted or refused)`],
    [enrol, { at: "+1s", send: creq(), expect: { disposition: "response", type: `${TC_REQ_T}#response`, pointer: { "/payload/status": "prompted" }, state: { handled: 1 } } }],
    { requires: TCR_REQ, clarify: "Vector over-reads: the text is clear (consumer 6, spec.md:154: refuse with notEligible when the device is not a member of approverSet; consumer 7, spec.md:155: #response with status prompted or refused), but membership of the named approverSet is set by the policy (spec.md:197), which the harness does not declare; the vector asserts prompted, which presumes membership. The suite can fix this by declaring membership (governance declaration, docs/04 section 19, consent.approverSet) and gating on it, or by asserting only a #response with status prompted or refused. Not gating." }),
  tcv("TC-013", "a request signed by an executor this device is not enrolled with is refused with task-consent/request:untrustedIssuer, and no prompt is raised", [`${TCR_S} (consumer 1: untrustedIssuer; the device MUST NOT prompt)`],
    [enrol, { at: "+1s", send: creq({ issuer: "$Q" }, { from: "Q" }), expect: { disposition: "error", code: "task-consent/request:untrustedIssuer", retryable: false, noSideEffect: true, state: NO_PROMPT } }],
    { requires: TCR_REQ, mutants: ["consentRequestTrustsAnyone"] }),
  tcv("TC-014", "a request without a proof is refused with proofRequired, and no prompt is raised", [`${TCR_S} (proofRequirement REQUIRED; consumer 1: an unverifiable request does not prompt)`],
    [enrol, { at: "+1s", send: creq({}, { sign: null }), expect: { disposition: "error", code: "proofRequired", noSideEffect: true, state: NO_PROMPT } }],
    { requires: TCR_REQ, mutants: ["proofOptional"] }),
  tcv("TC-015", "a request whose expiresAt has passed raises no prompt", [`${TCR_S} (consumer 6: refuse to prompt when expiresAt has passed)`],
    [enrol, { at: "+1s", send: creq({ payload: REQ_PAYLOAD({ expiresAt: "$nowAt(-10s)" }) }), expect: { disposition: "error", code: "expired", noSideEffect: true, state: NO_PROMPT } }],
    { requires: TCR_REQ, clarify: "The specification says the device refuses to prompt and names `expired`, and also allows a response with status refused; which of the two is the refusal is not stated. Not gating.", mutants: ["consentRequestPromptsExpired"] }),
  tcv("TC-016", "a request naming this device itself as the requester while excludeRequester is set is refused with task-consent/request:notEligible, and no prompt is raised", [`${TCR_S} (consumer 6: notEligible when the device is the requester and excludeRequester is set; errorCodes notEligible)`],
    [enrol, { at: "+1s", send: creq({ payload: REQ_PAYLOAD({ requester: "$iut", excludeRequester: true }) }), expect: { disposition: "error", code: "task-consent/request:notEligible", noSideEffect: true, state: NO_PROMPT } }],
    { requires: TCR_REQ, mutants: ["consentRequestNoSelfExclusion"] }),
  tcv("TC-017", "a request payload that the schema does not allow is malformedRequest, and no prompt is raised: effects missing, a challenge under 128 bits, an unknown member, minApprovals below 1", [`${TCR_S} payload.invalid-examples.json (missing effects; challenge too short; unknown property; minApprovals below 1)`, "SPEC.md:1011 (7.2 item 1)"],
    [enrol,
     { at: "+1s", send: creq({ id: "$id(c1)", payload: (() => { const p = REQ_PAYLOAD({}); delete p.effects; return p; })() }), expect: { ...MALFORMED, state: NO_PROMPT } },
     { at: "+2s", send: creq({ id: "$id(c2)", payload: REQ_PAYLOAD({ challenge: "abc" }) }), expect: { ...MALFORMED, state: NO_PROMPT } },
     { at: "+3s", send: creq({ id: "$id(c3)", payload: REQ_PAYLOAD({ origin2: "x" }) }), expect: { ...MALFORMED, state: NO_PROMPT } },
     { at: "+4s", send: creq({ id: "$id(c4)", payload: REQ_PAYLOAD({ minApprovals: 0 }) }), expect: { ...MALFORMED, state: NO_PROMPT } }],
    { requires: TCR_REQ, mutants: ["noPayloadValidation", "openPayload"] }),
  tcv("TC-018", "a decision that leaves the quorum short is answered with a response of the decision type (status pending) or with a hold (trust-task-next-step), and a repeat by the same approver is not another approver's approval: the quorum is completed only by the other approver's decision", [`${TCD_S} (consumer 10: record the approval idempotently per approver, and at the threshold of distinct approvers...; Response status pending; framework 8.6, a held task is answered with trust-task-next-step)`],
    [...tcSetup(),
     { at: "+5s", send: dec({}, {}, "E1", { id: "$id(decA1)" }), expect: { disposition: "response", type: `${TC_DEC_T}#response`, orHold: true, pointer: { "/payload/status": "pending" }, state: { effects: 0 } } },
     { at: "+6s", send: dec({}, {}, "E1", { id: "$id(decA2)" }), expect: { disposition: "response", type: `${TC_DEC_T}#response`, orHold: true, pointer: { "/payload/status": "pending" }, state: { effects: 0 } } },
     { at: "+8s", send: dec(), expect: GRANTED }],
    { requires: TCD_REQ, clarify: "A decision that leaves the threshold unmet is answered with the specification's `pending` status or, equally, with a trust-task-next-step hold (the framework's own vocabulary for a held task; the hold rule of 8.6 is checked); the two differ in form only. Which one an implementation uses is not asserted. Not gating.", mutants: ["consentDoubleApproveCounts"] }),
  // ---- granted 0.1 (the IUT is the requester) and decision 0.1 (the IUT is the executor; same ceremony as above)
  tcv("TC-019", "a granted notice for a payloadDigest the requester holds no pending task for is dropped silently, never answered with an error", [`${TCG_S} (consumer 3: Handle redelivery and spurious notices idempotently: a notice for an unknown or already-resolved \`payloadDigest\` is dropped, not an error; There is no \`#response\` form)`],
    [{ send: grt(), expect: { disposition: "silence" } }],
    { requires: [TC_GRT_T], mutants: ["grantedUnknownIsError"] }),
  tcv("TC-020", "a granted notice the schema does not allow is refused or ignored and changes nothing: a status other than granted, a missing payloadDigest, a missing taskType, an unknown member", [`${TCG_S} payload.invalid-examples.json (wrong status, only granted exists; missing payloadDigest; missing taskType; unknown property)`, `${TCG_S} (Payload: status REQUIRED, always \`granted\`; payloadDigest REQUIRED; taskType REQUIRED)`],
    [{ send: grt({ id: "$id(g1)" }, { mutate: [{ op: "set", path: "/payload/status", value: "denied" }] }), expect: { disposition: "any-refusal", noSideEffect: true } },
     { send: grt({ id: "$id(g2)" }, { mutate: [{ op: "remove", path: "/payload/payloadDigest" }] }), expect: { disposition: "any-refusal", noSideEffect: true } },
     { send: grt({ id: "$id(g3)" }, { mutate: [{ op: "remove", path: "/payload/taskType" }] }), expect: { disposition: "any-refusal", noSideEffect: true } },
     { send: grt({ id: "$id(g4)" }, { mutate: [{ op: "set", path: "/payload/extra", value: true }] }), expect: { disposition: "any-refusal", noSideEffect: true } }],
    { requires: [TC_GRT_T], mutants: ["noPayloadValidation", "openPayload", "grantedAnyStatus"] }),
  tcv("TC-021", "a decision of version 0.1 under assertionMethod, echoing the challenge and digest of the pending request, completes the quorum: the response is of the 0.1 decision type with status granted", [`${TCD1_S} (producer 1: proofPurpose MUST be assertionMethod; consumer: verify the proof and take the approver's identity from it; at the threshold authorizes the pending task)`, `${DOC_BASIS} (the pending request is a ceremony held for approvals)`],
    [...tcSetup(), { at: "+5s", send: dec01(), expect: GRANTED01 }],
    { requires: TCD01_REQ }),
  tcv("TC-022", "a version 0.1 decision whose challenge is not the one issued for the pending request is refused with task-consent/decision:challengeMismatch", [`${TCD1_S} (errorCodes: challengeMismatch, The \`challenge\` does not match the pending request for this digest)`],
    [...tcSetup(), { at: "+5s", send: dec01({ challenge: "0123456789abcdef0123456789abcdef" }), expect: TC_ERR("challengeMismatch") }],
    { requires: TCD01_REQ, mutants: ["consentNoChallengeCheck"] }),
  tcv("TC-023", "a version 0.1 decision without a proof is refused with proofRequired and records nothing", [`${TCD1_S} (proofRequirement REQUIRED: The decision IS the authorization, so the proof is the only thing that carries it)`],
    [...tcSetup(), { at: "+5s", send: dec01({}, { sign: null }), expect: { disposition: "error", code: "proofRequired", noSideEffect: true, state: { effects: 0 } } }],
    { requires: TCD01_REQ, mutants: ["proofOptional"] }),
  tcv("TC-024", "a version 0.1 decision carrying evidence or actionId, the members added in 0.2, is malformedRequest: the 0.1 payload is closed", [`${TCD1_S} payload.schema.json (additionalProperties false; members challenge, payloadDigest, decision, reason, ext)`, `${TCD1_S} (the 0.1 payload has no evidence and no actionId; both are additions of 0.2)`],
    [...tcSetup(), { at: "+5s", send: dec01({ evidence: { kind: "approverSigned", statement: { id: "$id(stmt)" } } }, {}, "EK", { id: "$id(d1)" }), expect: { ...MALFORMED, state: { effects: 0 } } },
     { at: "+6s", send: dec01({ actionId: "act_1" }, {}, "EK", { id: "$id(d2)" }), expect: { ...MALFORMED, state: { effects: 0 } } }],
    { requires: TCD01_REQ, mutants: ["dec01TakesNewMembers", "noPayloadValidation", "openPayload"] }),
], TC_FAMILY);

// ---- CEX
const CXI_REQ = [CEX_ISS_T];
const PRES_REQ = [CEX_PRE_T, "optional:trigger.presentationNonce"];
const cxi = (cred: NonNullable<Step["send"]>["credential"] | null = {}, extra: Record<string, unknown> = {}, more: CerSend = {}): NonNullable<Step["send"]> => ({
  template: "cex.issue", ...(Object.keys(extra).length > 0 ? { params: extra } : {}), ...(cred === null ? {} : { credential: cred }), ...more,
});
const ACCEPTED = (n: number): NonNullable<Step["expect"]> => ({ disposition: "silence", state: { storedCredential: n } });
const REFUSED_CRED: NonNullable<Step["expect"]> = { disposition: "any-refusal", noSideEffect: true, state: { storedCredential: 0 } };
const nonceStep: Step = { trigger: { action: "presentationNonce" }, capture: { presNonce: "/nonce", presThread: "/threadId" } };
const cxp = (pres: NonNullable<Step["send"]>["presentation"] | null = {}, extra: Record<string, unknown> = {}, more: CerSend = {}): NonNullable<Step["send"]> => ({
  template: "cex.present", ...(Object.keys(extra).length > 0 ? { params: extra } : {}), ...(pres === null ? {} : { presentation: pres }), ...more,
});
const PRES_ERR = (code: string): NonNullable<Step["expect"]> => ({ disposition: "error", code: `credential-exchange/present:${code}`, retryable: false, noSideEffect: true, state: { storedPresentation: 0 } });
const PRES_REFUSED: NonNullable<Step["expect"]> = { disposition: "any-refusal", noSideEffect: true, state: { storedPresentation: 0 } };
// present 0.2: the helper also names the thread's credential query id, the key of a keyed vp_token (OpenID4VP 1.0 section 8.1)
const PRES2_REQ = [CEX_PRE2_T, "optional:trigger.presentationNonce"];
const nonceStep2: Step = { trigger: { action: "presentationNonce" }, capture: { presNonce: "/nonce", presThread: "/threadId", presQuery: "/credentialQueryId" } };
const cxp2 = (pres: NonNullable<Step["send"]>["presentation"] | null = {}, extra: Record<string, unknown> = {}, more: CerSend = {}): NonNullable<Step["send"]> =>
  cxp(pres === null ? null : { keyed: "$cap(presQuery)", ...pres }, { type: CEX_PRE2_T, ...extra }, more);
const PRES2_KEPT = (n: number): NonNullable<Step["expect"]> => ({ disposition: "silence", state: { storedPresentation: n } });
// The 0.2 text (spec.md:94) requires the refusal of a disagreeing or missing value but names no code for it; any refusal is accepted
// (an open question on the code: trustoverip/dtgwg-trust-tasks-tf#1358).
const PRES2_HOLDER = `${CXP2_S}:94 ("A consumer **MUST** accept either placement, for each of the two values independently. Where a value is stated in both places, the two **MUST** agree, and a consumer **MUST** refuse the presentation when they do not. A consumer **MUST** refuse a presentation that states the value in neither place.")`;
const PRES2_PLACES = `${CXP2_S}:90-92 ("**Data Integrity.** The nonce and the audience have two accepted placements: the holder proof's \`challenge\` (the nonce) and \`domain\` (the audience) ... or \`nonce\` and \`domain\` members of the presentation itself, which the holder proof signs.")`;

const QRY_REQ = [CEX_QRY_T0, "optional:trigger.holdCredential", "optional:observe.deferred"];
const holdStep: Step = { trigger: { action: "holdCredential", args: { type: QRY_CRED } } };
const cxq = (extra: Record<string, unknown> = {}, more: CerSend = {}): NonNullable<Step["send"]> => ({ template: "cex.query", ...(Object.keys(extra).length > 0 ? { params: extra } : {}), ...more });
const cxo = (extra: Record<string, unknown> = {}, more: CerSend = {}): NonNullable<Step["send"]> => ({ template: "cex.offer", ...(Object.keys(extra).length > 0 ? { params: extra } : {}), ...more });
const cxrq = (extra: Record<string, unknown> = {}, more: CerSend = {}): NonNullable<Step["send"]> => ({ template: "cex.request", ...(Object.keys(extra).length > 0 ? { params: extra } : {}), ...more });
const QRY_MAL: NonNullable<Step["expect"]> = { disposition: "error", code: "malformedRequest", retryable: false, noSideEffect: true, ...SR, state: { deferred: 0 } };
const QRY_NONE: NonNullable<Step["expect"]> = { disposition: "any-refusal", noSideEffect: true, state: { deferred: 0 } };
const OFFER_MAL: NonNullable<Step["expect"]> = { disposition: "error", code: "malformedRequest", retryable: false, noSideEffect: true };
const REQ_MAL: NonNullable<Step["expect"]> = OFFER_MAL;
const PRESENTED: NonNullable<Step["expect"]> = {
  disposition: "response", type: CEX_PRE_T,
  pointer: { "/threadId": "$id(qry)", "/payload/vp_token/proof/challenge": "qry-nonce-0001", "/payload/vp_token/proof/domain": "$A" },
};

const cexFile = file("CEX", [
  // ---- issue (the IUT is the holder)
  tcv("CEX-001", "a cleartext credential delivered by its issuer to its subject is accepted: no reply document, and the holder keeps the credential", [`${CXI_S} (Conformance, consumer: verify the credential's own issuer signature; Retention: the holder keeps the credential)`, `${CXI_S} (the task defines no response document)`, `${S}:217-223 (4.4.2 a courtesy acknowledgement #response with payload {} is allowed; its absence carries no information)`],
    [{ send: cxi(), expect: { disposition: "silence", acknowledgement: "allowed", state: { storedCredential: 1, handled: 1 } } }],
    { requires: CXI_REQ, mutants: ["cexNeverStores"] }),
  tcv("CEX-002", "a payload carrying neither credential_response nor sealed, and one carrying both, are malformedRequest, and nothing is kept", [`${CXI_S} (consumer: reject a payload carrying both members or neither)`, `${CXI_S} payload.invalid-examples.json (neither; both)`],
    [{ send: cxi(null), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true, state: { storedCredential: 0 } } },
     { at: "+1s", send: cxi({}, { id: "$id(cxi2)", payload: { sealed: "-----BEGIN VTA SEALED-----\nAAAA\n-----END VTA SEALED-----" } }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true, state: { storedCredential: 0 } } }],
    { requires: CXI_REQ, mutants: ["cexAcceptsBoth"] }),
  tcv("CEX-003", "a credential whose issuer signature does not verify is refused and not kept: a flipped proof value, and a proof made by another key than the issuer's", [`${CXI_S} (consumer: verify the credential's own issuer signature; the envelope proving who delivered it says nothing about who issued it)`],
    [{ send: cxi({ corrupt: true }), expect: REFUSED_CRED },
     { at: "+1s", send: cxi({ signer: "X" }, { id: "$id(cxi2)" }), expect: REFUSED_CRED }],
    { requires: CXI_REQ, mutants: ["cexNoCredentialProofCheck"] }),
  tcv("CEX-004", "a sealed bundle the holder cannot process or open is refused with unsupportedFormat or unopenableBundle and nothing is kept", [`${CXI_S} (errorCodes unsupportedFormat, unopenableBundle; sealed: verify the out-of-band digest before opening)`],
    [{ send: cxi(null, { payload: { sealed: "-----BEGIN VTA SEALED-----\nAAAA\n-----END VTA SEALED-----" } }), expect: { disposition: "error", code: ["credential-exchange/issue:unsupportedFormat", "credential-exchange/issue:unopenableBundle"], retryable: false, noSideEffect: true, state: { storedCredential: 0 } } }],
    { requires: CXI_REQ, mutants: ["cexSealedStored"] }),
  tcv("CEX-005", "a credential given as a compact string that does not verify is refused and not kept", [`${CXI_S} (Format-agnostic: a JSON string is an SD-JWT-VC; consumer: verify the credential's own issuer signature)`],
    [{ send: cxi(null, { payload: { credential_response: { credential: "eyJhbGciOiJFZERTQSJ9.eyJpc3MiOiJ4In0.c2ln~" } } }), expect: REFUSED_CRED }],
    { requires: CXI_REQ, mutants: ["cexStringStored"] }),
  tcv("CEX-006", "an issue document without a proof is refused with proofRequired and nothing is kept", [`${CXI_S} (proofRequirement REQUIRED: the delivery is attributed by an envelope proof)`],
    [{ send: cxi({}, {}, { sign: null }), expect: { disposition: "error", code: "proofRequired", noSideEffect: true, state: { storedCredential: 0 } } }],
    { requires: CXI_REQ, mutants: ["proofOptional"] }),
  tcv("CEX-007", "an issue payload the schema does not allow is malformedRequest: credential_response as a string, an empty sealed, an unknown member", [`${CXI_S} payload.invalid-examples.json (credential_response must be an object; sealed must be non-empty; unknown member)`],
    [{ send: cxi(null, { id: "$id(cxi1)", payload: { credential_response: "eyJhbGciOiJF" } }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true, state: { storedCredential: 0 } } },
     { at: "+1s", send: cxi(null, { id: "$id(cxi2)", payload: { sealed: "" } }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true, state: { storedCredential: 0 } } },
     { at: "+2s", send: cxi({}, { id: "$id(cxi3)" }, { mutate: [{ op: "set", path: "/payload/extra", value: true }] }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true, state: { storedCredential: 0 } } }],
    { requires: CXI_REQ, mutants: ["noPayloadValidation", "openPayload"] }),
  tcv("CEX-008", "the same credential delivered again in a second document is kept once", [`${CXI_S} (Retention: the holder keeps the credential)`],
    [{ send: cxi(), expect: ACCEPTED(1) }, { at: "+5s", send: cxi({}, { id: "$id(cxi2)" }), expect: ACCEPTED(1) }],
    { requires: CXI_REQ, clarify: "The specification does not say whether a second delivery of a credential already held is stored again. The vector asserts one copy. Not gating.", mutants: ["cexStoresDuplicates"] }),
  tcv("CEX-009", "a credential whose proof purpose is authentication rather than assertionMethod is refused and not kept", [`${CXI_S} (consumer: verify the credential's own issuer signature)`, "W3C Data Integrity (a credential is an assertion: assertionMethod)"],
    [{ send: cxi({ purpose: "authentication" }), expect: REFUSED_CRED }],
    { requires: CXI_REQ, clarify: "The task specification does not name the proof purpose of the carried credential; assertionMethod is the Data Integrity reading and VRC-ISS asserts it for relationship credentials. Not gating.", mutants: ["cexAnyCredentialPurpose"] }),
  tcv("CEX-010", "a credential about another party than the holder is refused and not kept", [`${CXI_S} (Authorization: the consumer's own decision; the specification does not name this rule)`, "docs/04-suite-design.md section 10 (profile:attested)"],
    [{ send: cxi({ subject: "$Q" }), expect: REFUSED_CRED }],
    { tier: 2, requires: CXI_REQ, mutants: ["cexAcceptsOtherSubject"] } as Partial<Vector>),
  // ---- present (the IUT is the verifier)
  tcv("CEX-011", "a presentation bound to the nonce the verifier issued and to the verifier as audience, made by the holder over a genuine credential, is accepted: no reply document, and the presentation is kept", [`${CXP_S} (Holder binding is mandatory; consumer: verify holder binding, freshness and audience before reading any claim)`],
    [nonceStep, { at: "+1s", send: cxp(), expect: { disposition: "silence", state: { storedPresentation: 1, handled: 1 } } }],
    { requires: PRES_REQ, clarify: "The specification says the proof carries the verifier's nonce and domain; Data Integrity names the first member `challenge`, and where the verifier's nonce comes from (the query task) is outside this suite. The vector sends `challenge` and takes the nonce from the helper `presentationNonce`. Not gating.", mutants: ["cexNeverStores"] }),
  tcv("CEX-012", "a presentation bound to a nonce the verifier did not issue is refused with credential-exchange/present:staleNonce", [`${CXP_S} (errorCodes staleNonce; consumer MUST verify the nonce and reject with staleNonce)`],
    [nonceStep, { at: "+1s", send: cxp({ nonce: "zNeverIssuedNonce" }), expect: PRES_ERR("staleNonce") }],
    { requires: PRES_REQ, clarify: "As CEX-011: the nonce member name and the nonce's source are not fixed by the specification. Not gating.", mutants: ["cexNoNonceCheck", "cexCodesSwapped"] }),
  tcv("CEX-013", "a presentation bound to another audience than the verifier is refused with credential-exchange/present:audienceMismatch", [`${CXP_S} (errorCodes audienceMismatch; consumer MUST verify the audience and reject with audienceMismatch)`],
    [nonceStep, { at: "+1s", send: cxp({ audience: "$Q" }), expect: PRES_ERR("audienceMismatch") }],
    { requires: PRES_REQ, clarify: "As CEX-011: the audience is the proof's `domain` in the Data Integrity reading; the specification names it only as the audience. Not gating.", mutants: ["cexNoAudienceCheck", "cexCodesSwapped"] }),
  tcv("CEX-014", "a nonce is good for one presentation: a second presentation on the same thread with the same nonce is refused with staleNonce", [`${CXP_S} (errorCodes staleNonce: the nonce the verifier no longer considers fresh)`],
    [nonceStep, { at: "+1s", send: cxp(), expect: { disposition: "silence", state: { storedPresentation: 1 } } }, { at: "+2s", send: cxp({}, { id: "$id(cxp2)" }), expect: { ...PRES_ERR("staleNonce"), state: { storedPresentation: 1 } } }],
    { requires: PRES_REQ, clarify: "Whether a nonce is single use is the verifier's policy; the specification says only that a nonce it no longer considers fresh is stale. Not gating.", mutants: ["cexNonceReusable"] }),
  tcv("CEX-015", "a presentation carrying a credential whose issuer signature does not verify is refused and not kept", [`${CXP_S} (consumer: verify the underlying credential's issuer signature)`],
    [nonceStep, { at: "+1s", send: cxp({ credential: { corrupt: true } }), expect: PRES_REFUSED }],
    { requires: PRES_REQ, mutants: ["cexNoPresentedCredentialCheck"] }),
  tcv("CEX-016", "a vp_token that is neither a string nor an object, a payload without it, and a payload with an unknown member are malformedRequest, and nothing is kept", [`${CXP_S} payload.invalid-examples.json (vp_token required; array; number; unknown member)`],
    [nonceStep,
     { at: "+1s", send: cxp(null, { id: "$id(cxp1)", payload: { vp_token: 42 } }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true, state: { storedPresentation: 0 } } },
     { at: "+2s", send: cxp(null, { id: "$id(cxp2)", payload: { vp_token: ["a", "b"] } }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true, state: { storedPresentation: 0 } } },
     { at: "+3s", send: cxp(null, { id: "$id(cxp3)", payload: {} }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true, state: { storedPresentation: 0 } } },
     { at: "+4s", send: cxp({}, { id: "$id(cxp4)" }, { mutate: [{ op: "set", path: "/payload/extra", value: true }] }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true, state: { storedPresentation: 0 } } }],
    { requires: PRES_REQ, mutants: ["cexVpTokenUnchecked", "openPayload"] }),
  tcv("CEX-017", "a presentation made by a holder that is not the sender of the document is refused and not kept", [`${CXP_S} (Authorization: holder binding, that the presenting party controls the credential it presents; the specification does not name this rule)`, "docs/04-suite-design.md section 10 (profile:attested)"],
    [nonceStep, { at: "+1s", send: cxp({ holder: "X" }), expect: PRES_REFUSED }],
    { tier: 2, requires: PRES_REQ, mutants: ["cexHolderNotSender"] } as Partial<Vector>),
  tcv("CEX-018", "a presentation of a credential about another party than the holder is refused and not kept", [`${CXP_S} (Authorization: holder binding; the specification does not name this rule)`, "docs/04-suite-design.md section 10 (profile:attested)"],
    [nonceStep, { at: "+1s", send: cxp({ credential: { subject: "$Q" } }), expect: PRES_REFUSED }],
    { tier: 2, requires: PRES_REQ, mutants: ["cexAcceptsOtherSubject"] } as Partial<Vector>),
  // ---- query (the IUT is the holder), offer (the IUT is the holder) and request (the IUT is the issuer)
  tcv("CEX-019", "a query whose purpose is missing, empty, not a string or longer than 500 characters is malformedRequest, and nothing is deferred", [`${CXQ_S} ("\`purpose\` is REQUIRED and MUST be non-empty. A verifier cannot ask for a credential without stating why.")`, `${CXQ_S} payload.invalid-examples.json (purpose is required; purpose must be non-empty)`, `${CXQ_S} (Security & Privacy: "\`purpose\` ... is bounded at 500 characters ... It is **REQUIRED**")`],
    [holdStep,
     { send: cxq({ id: "$id(q1)" }, { mutate: [{ op: "remove", path: "/payload/purpose" }] }), expect: QRY_MAL },
     { send: cxq({ id: "$id(q2)" }, { mutate: [{ op: "set", path: "/payload/purpose", value: "" }] }), expect: QRY_MAL },
     { send: cxq({ id: "$id(q3)" }, { mutate: [{ op: "set", path: "/payload/purpose", value: 42 }] }), expect: QRY_MAL },
     { send: cxq({ id: "$id(q4)" }, { mutate: [{ op: "set", path: "/payload/purpose", value: "x".repeat(501) }] }), expect: QRY_MAL }],
    { requires: QRY_REQ, mutants: ["qryPurposeOptional", "qryPurposeUnbounded", "noPayloadValidation"] }),
  tcv("CEX-020", "a query payload the schema does not allow is malformedRequest, and nothing is deferred: no dcql_query, no nonce, an empty nonce, a dcql_query that is not an object, an unknown member", [`${CXQ_S} payload.invalid-examples.json (dcql_query is required; nonce is required; nonce must be non-empty; unknown top-level member is rejected)`, `${CXQ_S} payload.schema.json (additionalProperties false; dcql_query is an object)`],
    [holdStep,
     { send: cxq({ id: "$id(q1)" }, { mutate: [{ op: "remove", path: "/payload/dcql_query" }] }), expect: QRY_MAL },
     { send: cxq({ id: "$id(q2)" }, { mutate: [{ op: "remove", path: "/payload/nonce" }] }), expect: QRY_MAL },
     { send: cxq({ id: "$id(q3)" }, { mutate: [{ op: "set", path: "/payload/nonce", value: "" }] }), expect: QRY_MAL },
     { send: cxq({ id: "$id(q4)" }, { mutate: [{ op: "set", path: "/payload/dcql_query", value: "credentials" }] }), expect: QRY_MAL },
     { send: cxq({ id: "$id(q5)" }, { mutate: [{ op: "set", path: "/payload/extra", value: true }] }), expect: QRY_MAL }],
    { requires: QRY_REQ, mutants: ["noPayloadValidation", "openPayload"] }),
  tcv("CEX-021", "a query that names no credential type contributes no candidates: nothing is presented and nothing is deferred, although the holder holds a credential", [`${CXQ_S} ("a query carrying no type discriminator contributes **no** candidates. It does not mean \"everything\". A holder MUST NOT blind-scan its wallet to answer a query")`],
    [holdStep,
     { send: cxq({ id: "$id(q1)" }, { mutate: [{ op: "set", path: "/payload/dcql_query", value: { credentials: [{ id: "any", format: "ldp_vc" }] } }] }), expect: QRY_NONE },
     { send: cxq({ id: "$id(q2)" }, { mutate: [{ op: "set", path: "/payload/dcql_query", value: { credentials: [{ id: "any", format: "ldp_vc", meta: { type_values: [] } }] } }] }), expect: QRY_NONE }],
    { requires: QRY_REQ, mutants: ["qryEnumerates"] }),
  tcv("CEX-022", "a query for a credential the holder holds, from a verifier it does not pre-trust, is deferred: the holder keeps the query for a decision, tells the verifier credential-exchange/query:consentRequired, and presents nothing", [`${CXQ_S} ("Any other verifier is **deferred**: the query is persisted, the verifier is told \`consentRequired\`, and the decision moves out of band")`, `${CXQ_S} (errorCodes: consentRequired, The holder deferred the query for an out-of-band decision; retryable: true)`],
    [holdStep, { send: cxq(), expect: { disposition: "error", code: "credential-exchange/query:consentRequired", retryable: true, state: { deferred: 1 } } }],
    { requires: QRY_REQ, mutants: ["qryAutoPresents", "qryNoDeferral"] }),
  tcv("CEX-023", "a query for a credential type the holder does not hold is answered credential-exchange/query:noMatch, and nothing is deferred", [`${CXQ_S} (errorCodes: noMatch, The holder holds no credential satisfying the query; retryable: false)`, `${CXQ_S} (Conformance: "Expect three outcomes: a presentation, \`consentRequired\`, or \`noMatch\`.")`],
    [{ trigger: { action: "holdCredential", args: { type: "https://example.org/conformance#OtherCredential" } } },
     { send: cxq(), expect: { disposition: "error", code: "credential-exchange/query:noMatch", retryable: false, noSideEffect: true, state: { deferred: 0 } } }],
    { requires: QRY_REQ, clarify: "For a verifier the holder does not pre-trust, the query specification tells the holder to defer a matched query and tell the verifier consentRequired (spec.md:73-76), defines noMatch for a query nothing satisfies (errorCodes), and requires that noMatch and \"held but not consented\" be indistinguishable to the verifier (spec.md:84 and 141-142; pending/deny 105-106: a denial is indistinguishable from silence). An immediate noMatch for an unheld type is distinguishable from the immediate consentRequired a held type gets, so the text admits both noMatch and a consentRequired-style answer (or a deferral) for an unmatched query; the vector asserts noMatch with nothing deferred. No sentence obliges the holder to send noMatch at all (SPEC.md:1196 MAY, 1071 SHOULD). Same question as CEX-024; for the task force. Not gating.", mutants: ["qryDefersUnmatched"] }),
  tcv("CEX-024", "the verifier cannot tell a credential the holder holds but will not present from one it does not hold: both queries get the same refusal", [`${CXQ_S} ("Never disclose which credentials are held in a refusal — \`noMatch\` and \"held but not consented\" MUST be indistinguishable to the verifier, or refusal itself becomes an enumeration primitive.")`, `${CXQ_S} (Correlation: "a refusal that discriminates between them is an enumeration primitive wearing an error code")`],
    [holdStep,
     { send: cxq({ id: "$id(q1)", threadId: "$id(q1)" }, { mutate: [{ op: "set", path: "/payload/dcql_query", value: { credentials: [{ id: "u", format: "ldp_vc", meta: { type_values: [["https://example.org/conformance#UnheldCredential"]] } }] } }] }), expect: { disposition: "error", code: ["credential-exchange/query:noMatch", "credential-exchange/query:consentRequired"] } },
     { send: cxq({ id: "$id(q2)", threadId: "$id(q2)" }), expect: { disposition: "error", code: ["credential-exchange/query:noMatch", "credential-exchange/query:consentRequired"], sameErrorAs: 2 } }],
    { requires: QRY_REQ, clarify: "The specification asks for two things that cannot both hold for a held credential and a verifier that is not pre-trusted: the deferred query is answered \`consentRequired\` (errorCodes and \"Answer, defer, or refuse\") and \`noMatch\` and \"held but not consented\" MUST be indistinguishable. Which reading governs (consentRequired for a deferral and the indistinguishability rule for a refusal after a decision, or one code for both) is a question for the task force. The vector asserts the second reading. Not gating.", mutants: ["qryRefusalDiscriminates"] }),
  tcv("CEX-025", "a verifier the holder pre-trusts is answered at once: the holder presents on the query's thread, bound to the query's nonce and to the verifier", [`${CXQ_S} ("A **pre-trusted** verifier is auto-consented; the holder answers immediately with present on the same thread.")`, `${CXQ_S} (nonce: "Verifier freshness value, bound into the resulting presentation so it cannot be replayed to another verifier or at another time")`],
    [holdStep, { trigger: { action: "verifierTrust", args: { vid: "$A" } } }, { send: cxq(), expect: PRESENTED }],
    { requires: [CEX_QRY_T0, "optional:trigger.holdCredential", "optional:trigger.verifierTrust"], clarify: "Which verifiers are pre-trusted is the holder's policy and the helper only states it. The specification says the presentation carries the query's nonce and the verifier as audience; Data Integrity names the first member \`challenge\` and the audience \`domain\` (as for CEX-011). Not gating.", mutants: ["qryPresentNoNonce"], advisoryMutants: ["qryPresentOtherThread"] }),
  tcv("CEX-026", "a deferred query that the holder's human approves is presented on the query's original thread, bound to the query's nonce and to the verifier", [`${CXQ_S} ("If approved, the holder presents on the original thread.")`, `${CXQ_S} (nonce: bound into the resulting presentation)`],
    [holdStep, { send: cxq(), expect: { disposition: "any-refusal", state: { deferred: 1 } } }, { trigger: { action: "queryDecision", args: { thread: "$id(qry)", decision: "approve" } }, expect: PRESENTED }],
    { requires: [CEX_QRY_T0, "optional:trigger.holdCredential", "optional:trigger.queryDecision", "optional:observe.deferred"], clarify: "The decision is out of band (pending/approve); the helper stands for it. The nonce member and the audience member are as for CEX-025. Not gating.", mutants: ["qryNoDeferral", "qryPresentNoNonce"], advisoryMutants: ["qryPresentOtherThread"] }),
  tcv("CEX-027", "a query without a proof is not refused for that: the proof of a query is OPTIONAL, so the holder defers it as it would a signed one", [`${CXQ_S} (proofRequirement OPTIONAL: An authcrypted transport proves which DID is asking ... A document proof is permitted where the envelope's authentication does not survive relaying.)`],
    [holdStep, { send: cxq({}, { sign: null }), expect: { disposition: "any-refusal", state: { deferred: 1 } } }],
    { requires: QRY_REQ, mutants: ["qryProofRequired"] }),
  tcv("CEX-028", "an offer payload the schema does not allow is malformedRequest: no credential_offer, a credential_offer that is a string, an unknown member", [`${CXO_S} payload.invalid-examples.json (credential_offer is required; must be an object, not a string; unknown top-level member is rejected)`],
    [{ send: cxo({ id: "$id(o1)" }, { mutate: [{ op: "remove", path: "/payload/credential_offer" }] }), expect: OFFER_MAL },
     { send: cxo({ id: "$id(o2)" }, { mutate: [{ op: "set", path: "/payload/credential_offer", value: "https://issuer.example/offer" }] }), expect: OFFER_MAL },
     { send: cxo({ id: "$id(o3)" }, { mutate: [{ op: "set", path: "/payload/extra", value: true }] }), expect: OFFER_MAL }],
    { requires: [CEX_OFF_T], mutants: ["noPayloadValidation", "openPayload"] }),
  tcv("CEX-029", "an offer that names only credential configurations the holder cannot accept is answered credential-exchange/offer:unsupportedCredential rather than abandoned", [`${CXO_S} (Conformance, consumer: "A holder that supports none of the offered configurations SHOULD say so with \`unsupportedCredential\` rather than abandoning the thread silently")`, `${CXO_S} (errorCodes: unsupportedCredential, The holder cannot accept any credential configuration named in the offer)`],
    [{ send: cxo({}, { mutate: [{ op: "set", path: "/payload/credential_offer/credential_configuration_ids", value: ["https://example.org/conformance#UnsupportedCredential"] }] }), expect: { disposition: "error", code: "credential-exchange/offer:unsupportedCredential", retryable: false, noSideEffect: true } }],
    { requires: [CEX_OFF_T], clarify: "The specification says SHOULD, and which configurations a holder supports is its own. An implementation that supports the vector's configuration, or one that stays silent, is within the text. Not gating.", mutants: ["offerNoUnsupportedCode"] }),
  tcv("CEX-030", "a request payload the schema does not allow is malformedRequest: no credential_request, a credential_request that is an array, an unknown member", [`${CXR_S} payload.invalid-examples.json (credential_request is required; must be an object, not an array; unknown top-level member is rejected)`],
    [{ send: cxrq({ id: "$id(r1)" }, { mutate: [{ op: "remove", path: "/payload/credential_request" }] }), expect: REQ_MAL },
     { send: cxrq({ id: "$id(r2)" }, { mutate: [{ op: "set", path: "/payload/credential_request", value: [] }] }), expect: REQ_MAL },
     { send: cxrq({ id: "$id(r3)" }, { mutate: [{ op: "set", path: "/payload/extra", value: true }] }), expect: REQ_MAL }],
    { requires: [CEX_RQ_T], mutants: ["noPayloadValidation", "openPayload"] }),
  tcv("CEX-031", "a request that corresponds to no offer the issuer made is refused with credential-exchange/request:unknownOffer (or invalidProof, the key-binding proof not verifying) and nothing is issued", [`${CXR_S} (errorCodes: unknownOffer, The request does not correspond to an offer this issuer made; invalidProof, The key-binding proof is missing, malformed, or does not verify)`, `${CXR_S} (Conformance, consumer: "verify the key-binding proof before minting anything, and reject with \`invalidProof\` if it does not verify")`, `${CXR_S} payload.schema.json (credential_request is a bare object: no member is required of it)`, `${S}:1196 (an error reply is a MAY, :1071 a SHOULD)`],
    [{ send: cxrq(), expect: { disposition: "error", code: ["credential-exchange/request:unknownOffer", "credential-exchange/request:invalidProof"], retryable: false, noSideEffect: true, ...SR } }],
    { requires: [CEX_RQ_T], mutants: ["reqAcceptsUnknownOffer"] }),
  tcv("CEX-032", "a request without a document proof is refused with proofRequired and nothing is issued", [`${CXR_S} (proofRequirement REQUIRED: The document proof is required because execution acts with the subject's authority to obtain a credential in their name)`],
    [{ send: cxrq({}, { sign: null }), expect: { disposition: "error", code: "proofRequired", noSideEffect: true } }],
    { requires: [CEX_RQ_T], mutants: ["proofOptional"] }),
  // ---- present 0.2 (the IUT is the verifier); the 0.1 vectors above stay as written
  tcv("CEX-040", "present 0.2: a keyed vp_token (credential query id to an array of presentations) whose Data Integrity presentation binds the verifier's nonce and audience as the holder proof's challenge and domain is accepted: no reply document, and the presentation is kept", [`${CXP2_S}:73 ("**Keyed (canonical).** A JSON object whose every member name is the \`id\` of a credential query in the query's \`dcql_query\`, and whose value is an array of one or more presentations answering that credential query")`, PRES2_PLACES, `${CXP2_S}:106 ("Consumer: accept the keyed shape, and the bare SD-JWT-VC string for compatibility.")`, `${CXP2_P} (vp_token oneOf KeyedVpToken or string)`],
    [nonceStep2, { at: "+1s", send: cxp2(), expect: { disposition: "silence", state: { storedPresentation: 1, handled: 1 } } }],
    { requires: PRES2_REQ, mutants: ["cex2PresentationPlacementOnly", "cexNeverStores"] }),
  tcv("CEX-041", "present 0.2: a bare SD-JWT-VC presentation string, the shape 0.1 producers send, with a key-binding JWT over the verifier's nonce and audience, is accepted for compatibility", [`${CXP2_S}:74 ("**Bare string (compatibility).** A JSON string holding a single SD-JWT-VC presentation, the shape \`0.1\` producers send. A consumer **SHOULD** accept it, as an answer to the query's only credential query; a producer **MUST NOT** send it.")`, `${CXP2_S}:64 ("A bare SD-JWT-VC string is still accepted, for compatibility with \`0.1\` producers")`, `${CXP2_S}:89 ("**SD-JWT-VC.** The key-binding JWT carries \`nonce\` equal to the verifier's nonce and \`aud\` equal to the audience.")`],
    [nonceStep2, { at: "+1s", send: cxp({ format: "sd-jwt" }, { type: CEX_PRE2_T }), expect: PRES2_KEPT(1) }],
    { requires: PRES2_REQ, clarify: "The text says a consumer SHOULD accept the compatibility string; a verifier that refuses it is within the text. Not gating.", mutants: ["cex2NoCompatString"] }),
  tcv("CEX-042", "present 0.2: a bare Data Integrity presentation object as the vp_token (the 0.1 shape) is malformedRequest, and nothing is kept", [`${CXP2_S}:64 ("\`0.1\` defined a bare string or a bare Data Integrity presentation object ... A bare SD-JWT-VC string is still accepted, for compatibility with \`0.1\` producers; a bare Data Integrity presentation object is not.")`, `${CXP2_P} (vp_token oneOf: a KeyedVpToken, whose member names match ^[A-Za-z0-9_-]+$ and whose values are arrays, or a string)`, "SPEC.md:1131 (7.2 item 2: \"Validate the document's payload member against the JSON Schema\")"],
    [nonceStep2, { at: "+1s", send: cxp({}, { type: CEX_PRE2_T }), expect: { disposition: "error", code: "malformedRequest", noSideEffect: true, state: { storedPresentation: 0 } } }],
    { requires: PRES2_REQ, mutants: ["cex2BareObjectAccepted"] }),
  tcv("CEX-043", "present 0.2: a Data Integrity presentation that states the nonce and the audience as its own signed nonce and domain members is accepted, and so is one that states the nonce in the proof and the audience on the presentation", [PRES2_PLACES, PRES2_HOLDER],
    [nonceStep2, { at: "+1s", send: cxp2({ nonceAt: "presentation", audienceAt: "presentation" }), expect: PRES2_KEPT(1) },
     nonceStep2, { at: "+2s", send: cxp2({ nonceAt: "proof", audienceAt: "presentation" }, { id: "$id(cxp2)" }), expect: PRES2_KEPT(2) }],
    { requires: PRES2_REQ, mutants: ["cex2ProofPlacementOnly"] }),
  tcv("CEX-044", "present 0.2: a Data Integrity presentation that states the same nonce and audience both in the holder proof and on the presentation is accepted", [PRES2_HOLDER, `${CXP2_S}:94 ("during the transition it **MAY** state the same values on the presentation as well")`, `${CXP2_S}:213 ("A presentation that also states \`"nonce": "n-0S6_WzA2Mj"\` and \`"domain": "did:example:verifier"\` beside \`holder\` is accepted too")`],
    [nonceStep2, { at: "+1s", send: cxp2({ nonceAt: "both", audienceAt: "both" }), expect: PRES2_KEPT(1) }],
    { requires: PRES2_REQ, mutants: ["cexNeverStores"] }),
  tcv("CEX-045", "present 0.2: a Data Integrity presentation whose own nonce, or own domain, disagrees with the holder proof's challenge or domain is refused, and nothing is kept (the refusal's code is not asserted)", [PRES2_HOLDER, `${CXP2_S}:213 ("one whose members disagree with the proof's \`challenge\` or \`domain\` is refused")`, `${CXP2_S}:106 ("Verify holder binding, freshness and audience — in either Data Integrity placement, refusing values that disagree — before reading any claim.")`],
    [nonceStep2, { at: "+1s", send: cxp2({ nonceAt: "both", presentationNonce: "zNotTheVerifiersNonce" }), expect: PRES_REFUSED },
     { at: "+2s", send: cxp2({ audienceAt: "both", presentationAudience: "$Q" }, { id: "$id(cxp2)" }), expect: PRES_REFUSED }],
    { requires: PRES2_REQ, mutants: ["cex2NoAgreementCheck"] }),
  tcv("CEX-046", "present 0.2: a Data Integrity presentation that states the nonce in neither place, or the audience in neither place, is refused, and nothing is kept (the refusal's code is not asserted)", [PRES2_HOLDER, `${CXP2_S}:98 ("A consumer MUST verify both, for every presentation in the \`vp_token\`")`],
    [nonceStep2, { at: "+1s", send: cxp2({ nonceAt: "neither" }), expect: PRES_REFUSED },
     { at: "+2s", send: cxp2({ audienceAt: "neither" }, { id: "$id(cxp2)" }), expect: PRES_REFUSED }],
    { requires: PRES2_REQ, mutants: ["cex2NeitherSkipsCheck"] }),
], CEX_FAMILY);

// The 3b-DTG vectors need no clock control: every step runs at the vector's clock start, so a peer whose clock cannot be set (rebase mode) measures them.
for (const f of [tcFile, cexFile]) for (const vec of f.vectors) for (const st of vec.steps) delete st.at;

// ---------------------------------------------------------------- RCPT (trust-ceremony-receipt 0.1: verifier rules; optional capability receiptVerify)
// The receipt specification has no wire output for a verifier, so these vectors use the helper method `verifyReceipt` (docs/04 sections 4.2 and 11.6).
// Tier 1 asserts a MUST of the receipt specification or of the framework it applies; every point the text leaves open is CLARIFY (never gating).
const RS = "specs/trust-ceremony-receipt/0.1/spec.md";
const RP = "specs/trust-ceremony-receipt/0.1/payload.schema.json";
const PE = "specs/trust-ceremony-receipt/0.1/payload.invalid-examples.json";
const CM = "ceremonies/ceremony.meta.schema.json";
const RCPT_FAMILY = "ceremony-receipt";
const OTHER_DIGEST = "zQmb1XVvHqbCe5nUPFxpJcRz3RtP4pQyKgTsWJgNBzVhE7d";
const OTHER_ENACTMENT = "urn:uuid:8f21b0c4-7d3e-4a91-b5c2-1e6f0a9d4b83";
type Outcome = "complete" | "incomplete" | "unverifiable" | "invalid";
const rcpt: Vector[] = [];
const rc = (title: string, cites: string[], scenario: ReceiptSpec, outcome: Outcome | Outcome[], rest: Partial<Vector> = {}): void => {
  const id = `RCPT-${String(rcpt.length + 1).padStart(3, "0")}`;
  rcpt.push(v(id, title, 1, cites, [{ verifyReceipt: { scenario, expect: { outcome } } }], { requires: ["optional:receiptVerify"], ...rest }));
};
const pending = (title: string, cites: string[], steps: Step[], rest: Partial<Vector> = {}): void => {
  const id = `RCPT-${String(rcpt.length + 1).padStart(3, "0")}`;
  rcpt.push(v(id, title, 1, cites, steps, { requires: ["optional:receiptVerify"], ...rest }));
};
const vr = (scenario: ReceiptSpec, outcome: Outcome | Outcome[]): Step => ({ verifyReceipt: { scenario, expect: { outcome } } });

// shape and the conforming enactments
rc("a conforming enactment with every step document held verifies complete", [`${RS}:119-124 (recorder rules)`, `${RS}:128-138 (verifier rules 1 to 11)`, `${RS}:98-109 (the step digest)`], {}, "complete");
rc("an enactment of perRole steps that meets a threshold verifies complete", [`${RS}:131 (perRole: one instance per bound issuer)`, `${RS}:132 (the verifier evaluates the completion rule)`, `${CM}:190 (perRole)`], { ceremony: "approve" }, "complete");
rc("an optional step that did not happen is not required for completion", [`${RS}:132 (completion evaluated by the verifier)`, `${CM}:182 (an optional step may be absent from a complete enactment)`], { instances: ["apply", "decide"] }, "complete");
rc("a verifier holding only the terminal step document verifies complete; a predecessor it does not hold is not a failure", [`${RS}:137 (a prev entry naming a document the verifier does not hold is not a failure)`, `${RS}:134 (the terminal marker is confirmed in a held document)`], { hold: ["decide"] }, "complete");
rc("a receipt issued by the second recorder the definition names verifies", [`${RS}:130 (the recorder is one the definition names)`, `${RS}:80 (a definition SHOULD name more than one recorder)`], { receipt: { issuer: "Q" } }, "complete", { mutants: ["rcptFirstRecorderOnly"] });
rc("an unrecognised top-level member on the receipt is preserved and not acted on", ["SPEC.md:1067 (a consumer MUST NOT act on members it does not recognise)", `${RS}:128 (the SPEC.md 7.2 pipeline applies)`], { receipt: { mutate: [{ op: "set", path: "/x-unrecognised", value: { anything: 1 } }] } }, "complete", { mutants: ["rcptStrictEnvelope"] });
rc("an unrecognised ext namespace in the receipt payload is ignored", ["SPEC.md:1069 (a consumer MUST ignore an ext namespace it does not recognise)", `${RP}:97-99 (ext)`], { receipt: { mutate: [{ op: "set", path: "/payload/ext", value: { "org.example.audit": { note: "x" } } }] } }, "complete");

// closed payload: the registry's own invalid examples
const receiptExamples = JSON.parse(readFileSync(join(root, "vectors/imported/receipt/payload.invalid-examples.json"), "utf8")) as { note: string }[];
const exampleLines = [3, 7, 17, 34, 52, 69, 86, 105, 124, 143, 161, 180];
const exampleSchema = [`${RP}:8-14 (required members)`, `${RP}:45-48 (steps: at least one)`, `${RP}:26-31 (definition)`, `${RP}:32-35 (definitionDigest)`, `${RP}:52-58 (step required members)`, `${RP}:52-58 (step required members)`, `${RP}:65-69 (round minimum 1)`, `${RP}:51 (step additionalProperties false)`, `${RP}:40-44 (salt minLength 22)`, `${RP}:36-39 (complete is a boolean)`, `${RP}:7 (additionalProperties false)`, `${RP}:97-99 (ext keys)`];
receiptExamples.forEach((ex, i) => {
  rc(`invalid payload: ${ex.note.replace(/`/g, "").split(/(?<=\.)\s/)[0]}`.slice(0, 180), [`${PE}:${exampleLines[i]} (registry invalid example ${i + 1})`, exampleSchema[i]!, "SPEC.md:1012 (7.2 item 2: the payload is validated against its schema)"],
    { receipt: { payloadFrom: { file: "receipt/payload.invalid-examples.json", index: i } } }, "invalid", { mutants: ["rcptNoSchema"], origin: { source: PROVENANCE_SRC_RCPT, fixture: "receipt/payload.invalid-examples.json", row: String(i + 1) } });
});

// the document: type, proof, signature
rc("a receipt of another MAJOR version of the type is rejected", ["SPEC.md:756 (a MAJOR mismatch is never forward-compatible)", "SPEC.md:1013 (7.2 item 3)"], { receipt: { type: "https://trusttasks.org/spec/trust-ceremony-receipt/1.0" } }, "invalid", { mutants: ["rcptNoTypeCheck"] });
rc("a document whose type is rooted at /ceremony/ is not a receipt", ["SPEC.md:980 (a document whose type is rooted at /ceremony/ is malformed and MUST be rejected)"], { receipt: { type: "https://trusttasks.org/ceremony/conformance/receipt-linear/0.1" } }, "invalid", { mutants: ["rcptNoTypeCheck"] });
rc("a receipt without a proof is rejected", [`${RS}:24-31 (proof REQUIRED)`, `${RS}:119 (a recorder MUST carry a proof)`, "SPEC.md:1017 (7.2 item 7: proofRequired)"], { receipt: { sign: null } }, "invalid", { mutants: ["rcptProofOptional"] });
rc("a receipt whose signature does not verify is rejected", [`${RS}:128 (the receipt's own proof is verified against its issuer)`, "SPEC.md:1017 (7.2 item 7: proofInvalid)"], { receipt: { corrupt: true } }, "invalid", { mutants: ["rcptNoProofCheck"] });
rc("a receipt signed by a key that is not its issuer's is rejected", ["SPEC.md:305 (the verificationMethod MUST resolve to material controlled by the issuer)", `${RS}:128`], { receipt: { signer: "X" } }, "invalid", { mutants: ["rcptNoProofCheck"] });
rc("a receipt whose step digest was changed after signing is rejected", [`${RS}:128`, "SPEC.md:309 (the proof is verified over the document as received)"], { hold: "none", receipt: { mutate: [{ op: "set", path: "/payload/steps/0/digestMultibase", value: OTHER_DIGEST, afterSign: true }] } }, "invalid", { mutants: ["rcptNoProofCheck"] });
rc("a receipt from which an enumerated step was removed after signing is rejected", [`${RS}:128`, "SPEC.md:309 (the proof is verified over the document as received)"], { hold: "none", receipt: { mutate: [{ op: "remove", path: "/payload/steps/1", afterSign: true }] } }, "invalid", { mutants: ["rcptNoProofCheck"] });

// issuer and role bindings
rc("a receipt issued by a party the definition does not name as recorder is rejected", [`${RS}:119-120 (a recorder MUST be named by the definition)`, `${RS}:130 (verifier rule 3)`], { receipt: { issuer: "X" } }, "invalid", { mutants: ["rcptAnyIssuerRecorder"] });
rc("without the enactment's role bindings the verifier reports it could not verify", [`${RS}:135 (where the bindings are not available the verifier MUST report that it could not verify)`, `${RS}:130 (rule 3: the same)`], { bindings: "none" }, "unverifiable", { mutants: ["rcptBindingsAssumed"] });
rc("a step issued by a party not bound to the step's issuer role is rejected", [`${RS}:135 (each step's issuer is a VID the enactment bound to the issuer role)`], { bindings: { initiator: ["Q"] }, hold: "none" }, "invalid", { mutants: ["rcptNoIssuerRoleCheck"] });
rc("a held step addressed to a party not bound to its recipient role is rejected", [`${RS}:135 (for a held document its recipient is bound to the recipient role)`], { docMutate: { apply: [{ op: "set", path: "/recipient", value: "$S" }] } }, "invalid", { mutants: ["rcptNoRecipientRoleCheck"] });

// the definition
rc("an unresolvable definition: the verifier could not verify, the receipt is not invalid", [`${RS}:129 (an unresolvable definition means the receipt cannot be verified, not that it is invalid)`, `${RS}:162`], { definition: "unresolvable" }, "unverifiable", { mutants: ["rcptUnresolvableAsInvalid"] });
rc("a resolved definition that is not the pinned one cannot verify the receipt, however complete it would make it look", [`${RS}:129 (a digest mismatch means the receipt cannot be verified, not that it is invalid)`, `${RS}:91 (definitionDigest pins the completion rule)`], { ceremony: "approve", instances: ["propose", "approve@X"], definition: "altered" }, "unverifiable", { mutants: ["rcptNoDefinitionDigestCheck", "rcptDigestMismatchAsInvalid"] });
rc("a step that pins another definition is a step of another ceremony", [`${RS}:136 (a document that disagrees on definitionDigest is a step of a different ceremony)`, `${RS}:121 (steps pinning different digests are steps of different ceremonies)`], { docMutate: { decide: [{ op: "set", path: "/ceremony/definitionDigest", value: OTHER_DIGEST }] } }, "invalid", { mutants: ["rcptNoStepDefinitionCheck"] });

// de-duplication and the completion rule
rc("the same step document enumerated twice is rejected", [`${RS}:131 (two steps sharing a document id are one document listed twice)`, "SPEC.md:174 (an id is globally unique)"], { enumerate: ["apply", "review", "decide", "decide"] }, "invalid", { mutants: ["rcptNoDedupe"] });
rc("two documents for one step at one round are rejected", [`${RS}:131 (reject two entries for one step at one round)`], { instances: ["apply", "review", "decide", "decide#1"] }, "invalid", { mutants: ["rcptNoDedupe"] });
rc("one approver's approvals listed twice do not reach a threshold", [`${RS}:131 (two entries at one round from one issuer MUST be rejected; otherwise a threshold is met by listing one party n times)`], { ceremony: "approve", instances: ["propose", "approve@X", "approve@X#1"] }, "invalid", { mutants: ["rcptNoDedupe"] });
rc("a threshold the enumerated steps do not meet is not complete, whatever complete says", [`${RS}:132 (the verifier MUST NOT rely on payload.complete)`, `${RP}:36-38 (a receipt whose steps do not satisfy the rule is incomplete however complete is set)`], { ceremony: "approve", instances: ["propose", "approve@X"] }, ["incomplete", "invalid"], { mutants: ["rcptTrustCompleteFlag"] });
rc("a recorder that says incomplete over steps that satisfy the rule", [`${RS}:132 (the verifier evaluates the rule itself)`, `${RP}:38 (a mistaken recorder and a lying one are both visible)`], { receipt: { complete: false } }, "complete",
  { clarify: "The verifier MUST evaluate the completion rule itself and MUST NOT rely on payload.complete (spec.md:132), which says the enactment is complete; the schema description says both a mistaken and a lying recorder are visible, so a verifier may also report the disagreement as invalid. Which verdict is meant is not stated." });

// the terminal step
rc("a receipt enumerating no terminal step is a prefix, not complete", [`${RS}:88 (at least one enumerated step MUST have carried ceremony.terminal)`, `${RS}:133 (verifier rule 6: a receipt enumerating none is a prefix)`], { ceremony: "prefix", instances: ["open", "middle"] }, ["incomplete", "invalid"], { mutants: ["rcptNoTerminalCheck"] });
rc("a recorder that leaves the terminal step out of the receipt gives a prefix even where the verifier holds the terminal document", [`${RS}:88-91 (truncation: the terminal marker is what makes a prefix visible)`, `${RS}:133`], { ceremony: "prefix", enumerate: ["open", "middle"] }, ["incomplete", "invalid"], { mutants: ["rcptNoTerminalCheck"] });
rc("terminal echoed on a step the definition does not declare terminal is rejected", [`${RS}:133 (steps[].terminal on a step the definition does not so declare MUST be rejected)`], { receipt: { mutate: [{ op: "set", path: "/payload/steps/0/terminal", value: true }] } }, "invalid", { mutants: ["rcptNoTerminalDeclaredCheck"] });
rc("with the terminal step document not held the verifier reports it could not verify completion", [`${RS}:134 (where the verifier holds no document for a terminal step it MUST report that it could not verify completion)`, `${RS}:140`], { hold: ["apply", "review"] }, "unverifiable", { mutants: ["rcptTrustTerminalEcho"] });
rc("holding no step document the verifier reports it could not verify completion, not that the enactment completed", [`${RS}:140 (a verifier holding none of the step documents MUST report that completion could not be verified)`], { hold: "none" }, "unverifiable", { mutants: ["rcptNoDocsAsComplete", "rcptTrustTerminalEcho"] });
rc("a terminal echo the held document contradicts is rejected", [`${RS}:134 (a steps[].terminal the held document contradicts MUST be rejected)`, `${RS}:88-91 (the echo is the recorder's, the signed marker is the issuer's)`], { docMutate: { decide: [{ op: "remove", path: "/ceremony/terminal" }] }, receipt: { echo: "declared" } }, "invalid", { mutants: ["rcptTrustTerminalEcho"] });
rc("a held terminal document without the marker is not complete even where the receipt does not echo it", [`${RS}:134 (the held document's ceremony.terminal MUST be true for the enactment to be reported complete)`], { docMutate: { decide: [{ op: "remove", path: "/ceremony/terminal" }] } }, ["incomplete", "invalid"], { mutants: ["rcptTrustTerminalEcho"] });

// the digest binds the enactment
rc("a digest computed with the salt as a prefix is rejected", [`${RS}:109 (the salt is a suffix, not a prefix)`, `${RS}:98 (the formula)`], { digest: { saltAt: "prefix" } }, "invalid", { mutants: ["rcptSaltPrefix"] });
rc("a digest computed without the document's proof (the task digest) is rejected", [`${RS}:103-105 (the step digest includes the proof and is not the task digest)`, "SPEC.md:559 (the task digest excludes the top-level proof)"], { digest: { withoutProof: true } }, "invalid", { mutants: ["rcptDigestExcludesProof"] });
rc("a held step document altered after the receipt enumerated it is rejected even when its issuer signed the alteration", [`${RS}:136 (for every held step document the verifier recomputes the digest and rejects on mismatch)`], { heldMutate: { apply: [{ op: "set", path: "/payload/note", value: "changed" }] }, heldResign: ["apply"] }, "invalid", { mutants: ["rcptNoDigestRecompute"] });
rc("a held step document signed again with the same content is another document", [`${RS}:103-105 (two documents differing only in signature are two different steps)`, `${RS}:136`], { heldResign: ["apply"] }, "invalid", { mutants: ["rcptNoDigestRecompute"] });
rc("a receipt that carries a salt other than the one the digests used is rejected", [`${RS}:107 (the salt of the digest is the enactment salt)`, `${RS}:136`], { receipt: { salt: "wrong" } }, "invalid", { mutants: ["rcptNoDigestRecompute"] });
rc("a receipt whose digests use another multihash function", [`${RS}:108 (H is any hash function expressible in multihash; the prefix declares which)`], { digest: { hash: "sha2-512" } }, ["complete", "unverifiable"],
  { clarify: "The hash function is not fixed by the specification (spec.md:108), so a verifier may implement the one the multihash names (complete) or report that it does not (unverifiable); the text does not require a minimum set. Not gating." });
rc("a receipt without a salt where the steps carry prev", [`${RS}:123 (a recorder MUST populate salt wherever any step carried ceremony.prev)`, `${RP}:40-44 (salt is required whenever any step carried prev)`], { receipt: { salt: "omit" } }, ["unverifiable", "invalid", "incomplete"],
  { clarify: "The recorder's duty to populate the salt is stated (spec.md:123) but the payload schema does not require it, and the verifier rules do not say what a verifier holding documents does when the salt is absent (the digests cannot be recomputed). Not gating." });

// replay and mismatching enactment
rc("a step document of another enactment is rejected: replay of a step into this receipt", [`${RS}:136 (a document that disagrees on enactment is a step of a different ceremony)`], { docMutate: { decide: [{ op: "set", path: "/ceremony/enactment", value: OTHER_ENACTMENT }] } }, "invalid", { mutants: ["rcptNoEnactmentCheck"] });
rc("a receipt that reports another enactment than the steps it enumerates is rejected", [`${RS}:136 (the document's ceremony.enactment agrees with what the receipt enumerates for it)`, `${RS}:121`], { receipt: { mutate: [{ op: "set", path: "/payload/enactment", value: OTHER_ENACTMENT }] } }, "invalid", { mutants: ["rcptNoEnactmentCheck"] });
rc("an earlier enactment's receipt presented with the documents of a later one is not complete", [`${RS}:136 (a document of another enactment is a step of a different ceremony)`, `${RS}:140 (with no step document of this enactment held the verifier cannot report complete)`], { heldEnactment: "other" }, ["unverifiable", "invalid"], { mutants: ["rcptTrustTerminalEcho"] });
rc("a held step document that names another step than the receipt enumerates is rejected", [`${RS}:136 (the document's ceremony.step agrees with what the receipt enumerates for it)`], { docMutate: { decide: [{ op: "set", path: "/ceremony/step", value: "review" }] } }, "invalid", { mutants: ["rcptNoStepFieldCheck"] });
rc("a held step document at another round than the receipt enumerates is rejected", [`${RS}:136 (the document's ceremony.round agrees with what the receipt enumerates for it)`], { docMutate: { decide: [{ op: "set", path: "/ceremony/round", value: 2 }] } }, "invalid", { mutants: ["rcptNoStepFieldCheck"] });

// the chain
rc("a held step that follows a document the receipt does not enumerate shows an omitted step", [`${RS}:137 (a predecessor a held document commits to but the receipt does not enumerate is an omitted intermediate step: reject)`, `${RS}:74 (omitting an intermediate step is detected by its successor)`], { enumerate: ["apply", "decide"] }, "invalid", { mutants: ["rcptNoChainWalk"] });
rc("a predecessor whose digest differs from the one the successor committed to is rejected", [`${RS}:137 (the receipt MUST enumerate the named id with the same digestMultibase)`], { docMutate: { decide: [{ op: "set", path: "/ceremony/prev/0/digestMultibase", value: OTHER_DIGEST }] } }, "invalid", { mutants: ["rcptChainDigestIgnored", "rcptNoChainWalk"] });
rc("a predecessor that is not an ancestor of the step in the definition is rejected", [`${RS}:137 (the predecessor's step MUST be an ancestor in the definition's prev graph, or the same step at an earlier round)`],
  { ceremony: "approve", docMutate: { "approve@S": [{ op: "set", path: "/ceremony/prev", value: [{ id: "$stepId(approve@X)", digestMultibase: "$stepDigest(approve@X)" }] }] } }, "invalid", { mutants: ["rcptNoAncestorCheck"] });
rc("a held step document whose own proof does not verify is rejected", [`${RS}:138 (verify each held step document's own proof against its issuer)`], { docProof: { apply: "corrupt" } }, "invalid", { mutants: ["rcptNoStepProofCheck"] });

// points the specification leaves open (CLARIFY)
rc("a held step document without a proof", [`${RS}:103 (this specification requires each step to carry its own proof)`, `${RS}:138 (rule 11 verifies a held document's proof)`], { docProof: { apply: "none" } }, "invalid",
  { clarify: "The text says each step carries its own proof (spec.md:103) but rule 11 states only that a held document's proof is verified; what a verifier reports for a held document that has none is not stated." });
rc("a receipt addressed to another party", [`${RS}:150-154 (bearer: no member depends on the receiving party's identity)`, "SPEC.md:1015 (7.2 item 5: reject a document whose recipient is not the consumer)"], { receipt: { mutate: [{ op: "set", path: "/recipient", value: "$S" }] } }, "complete",
  { clarify: "The specification is a bearer specification, so any verifier may rely on a receipt (spec.md:150-154), but it also says a receipt addressed to one verifier is one that SPEC.md 7.2 item 5 requires every other verifier to reject (spec.md:152); whether a receipt that carries a recipient naming someone else is rejected is not settled." });
rc("a receipt that carries a threadId no step has", ["SPEC.md:649 (enactment does not replace threadId; threadId scopes one step's exchange)", `${RS}:17-23 (the receipt's parties: recorder issuer, optional verifier recipient)`], { receipt: { mutate: [{ op: "set", path: "/threadId", value: "$id(receipt-thread)" }] } }, "complete",
  { clarify: "The receipt is not a step of the enactment it reports on and the specification says nothing about its threadId; a verifier should neither need nor require one. Not stated, so not gating." });
rc("steps of one enactment that share a single threadId", ["SPEC.md:649 (threadId scopes one step's request/response exchange; the steps of an enactment are typically siblings)"],
  { docMutate: { apply: [{ op: "set", path: "/threadId", value: "$id(shared-thread)" }], review: [{ op: "set", path: "/threadId", value: "$id(shared-thread)" }], decide: [{ op: "set", path: "/threadId", value: "$id(shared-thread)" }] } }, "complete",
  { clarify: "SPEC.md 4.11.2 describes the steps as typically separate exchanges but states no rule on their threadIds, and the verifier rules (spec.md:128-138) do not mention them; a verifier that rejected shared or distinct threads would invent a rule. Not gating." });
rc("a receipt whose parentEnactment is its own enactment", ["SPEC.md:658 (a producer MUST NOT set parentEnactment equal to the document's own enactment)", `${RP}:21-25 (the receipt's parentEnactment is one level, as on the envelope member)`], { receipt: { mutate: [{ op: "set", path: "/payload/parentEnactment", value: "$id(enactment)" }] } }, "invalid",
  { clarify: "The producer rule is stated for the envelope member (SPEC.md:658) and the receipt's parentEnactment is described as the same member's counterpart; what a verifier does with a receipt that breaks it is not stated." });
pending("the same receipt presented twice verifies the same way both times", [`${RS}:34 (side effects none: a receipt creates no state at the recipient)`, `${RS}:152 (bearer: evidence only its first recipient may act on is not evidence)`, "SPEC.md:1021 (7.2 item 11 binds the execution of a consequential task)"],
  [vr({}, "complete"), vr({}, "complete")],
  { clarify: "SPEC.md 7.2 item 11 keeps a consequential task from executing twice; verifying a receipt executes nothing, and the receipt's side-effect class is none, but the text does not say a verifier must treat a re-presented receipt as a retry rather than a duplicate. Not gating." });
rc("a step name the definition does not declare", [`${RP}:60-64 (step is the name from the definition)`, `${RS}:131-133 (the rules name no check for an undeclared step)`], { receipt: { mutate: [{ op: "set", path: "/payload/steps/0/step", value: "ghost" }] }, hold: "none" }, "invalid",
  { clarify: "The receipt text states no rule that an enumerated step name must be one the definition declares (the Rust verifier crate rejects it); the schema only says the name is the definition's. Not gating." });
rc("a step whose typeUri differs from the one the definition declares", [`${RP}:70-74 (typeUri is checked against the definition's declared type for that step)`, `${RS}:131-133 (the verifier rules name no such check)`], { receipt: { mutate: [{ op: "set", path: "/payload/steps/0/typeUri", value: "https://trusttasks.org/spec/conformance/receipt/other/0.1" }] }, hold: "none" }, "invalid",
  { clarify: "The schema description says the typeUri is checked against the definition, but no verifier rule states it. Not gating." });
rc("a step at a round beyond the definition's maxRounds", [`${RP}:65-69 (enumerating rounds separately lets a verifier check the repetition bound)`, `${CM}:190 (maxRounds bounds repetition)`], { ceremony: "approve", instances: ["propose", "approve@X#3", "approve@S"] }, "invalid",
  { clarify: "The schema says enumerating rounds lets a verifier check the bound, but no verifier rule states that a round beyond maxRounds is rejected. Not gating." });
const files: Record<string, VectorFile> = {
  "framework/ctrl.json": ctrl, "ceremony-vrc/ns.json": ns, "ceremony-vrc/authz.json": authz, "ceremony-vrc/td.json": td, "ceremony-vrc/witness-share.json": wsh,
  "framework/env.json": env, "framework/rsp.json": rsp, "framework/err.json": err, "framework/id.json": id, "framework/lif.json": lif,
  "framework/prf.json": file("PRF", prf), "framework/time.json": file("TIME", time), "framework/dup.json": file("DUP", dup),
  "framework/dis.json": dis, "framework/bnd.json": bnd, "ceremony-vrc/2pc.json": twopc, "ceremony-doc/cer.json": cerFile,
  "ceremony-vrc/propose.json": vrcPro, "ceremony-vrc/issue.json": vrcIss,
  "dtg/tc.json": tcFile, "dtg/cex.json": cexFile,
  "ceremony-witness/witness.json": witnessFile(T0),
  "ceremony-receipt/rcpt.json": file("RCPT", rcpt, RCPT_FAMILY),
};
// ---------------------------------------------------------------- Tier 1 audit applied (docs/decisions/02-specs-tiers-and-channels.md#d47; docs/21 section 1)
// Tier 1 is the framework MUSTs and nothing stricter. Everything the audit found to be stricter than the specifications, or a profile
// choice, is a named Tier 2 sub-group (docs/04 section 3.1) or CLARIFY. The table is the single place where those calls are made.
const SUBGROUP_OF: Record<string, NonNullable<Vector["subgroup"]>> = {};
for (let i = 1; i <= 11; i++) SUBGROUP_OF[`TIME-${String(i).padStart(3, "0")}`] = "profile-window";
for (const i of [15, 17, 18, 19, 20]) SUBGROUP_OF[`TIME-0${i}`] = "profile-window";
for (const i of [110, 111, 112, 113]) SUBGROUP_OF[`DUP-${i}`] = "profile-window";
for (const id of ["TIME-012", "TIME-016", "TIME-021"]) SUBGROUP_OF[id] = "attested";
for (const id of ["2PC-001", "2PC-004", "2PC-005", "CER-003", "CER-008", "CER-009", "CER-014", "TIME-103"]) SUBGROUP_OF[id] = "profile-ceremony";
for (const id of ["WSH-001", "WSH-002", "WSH-003", "WSH-004", "WSH-005", "WSH-013", "WSH-017", "WSH-025"]) SUBGROUP_OF[id] = "profile-witness-share";
for (const id of ["PRF-003", "PRF-005"]) SUBGROUP_OF[id] = "profile-p384";
const CLARIFY_OF: Record<string, string> = {
  "WSH-017": "The witness-share profile says a receiver SHOULD be idempotent on the credential digest (docs/10 section 8: one stored credential, a receipt each time). The framework does not decide the case: a redelivery under a new id is a different document, so SPEC.md 7.2 item 11 (SPEC.md:1021, 1033) does not apply. The vector asserts the SHOULD as a requirement (one stored credential after the second delivery). Not gating.",
  "PRF-108": "Proof is OPTIONAL on the request where the task declares it so, but that does not oblige a consumer to accept an unsigned request: acceptance is consumer policy (SPEC.md 8.3 proofRequired). VTI accepts unsigned requests only for public tasks. Not gating, as DIS-015.",
  "VRC-PRO-011": "Propose declares proof OPTIONAL, which does not oblige a consumer to accept an unsigned proposal (consumer policy, SPEC.md 8.3); VTI refuses it unless the task is public. Not gating, as DIS-015 and PRF-108.",
  "LIF-002": "The framework writes the duplicate record at accepted (4.12), so a refusal before acceptance need not burn the id, and VTI releases a refused claim; but the text does not state the corrected-resend behaviour (the same scenario as DUP-009, which is CLARIFY). Not gating.",
  "ERR-002": "No sentence of the specifications says an inbound error is answered with nothing. VTI does that (docs/05 section 1.1) and ERR-008, the same behaviour, is CLARIFY. Not gating.",
  "LIF-001": "A responded document stays responded (4.12) is stated, but the second half, an inbound error answered with nothing, is not stated by any sentence; the same behaviour as ERR-008. Not gating.",
  "CER-011": "SPEC.md 8.3 describes indeterminate as something the task needed and does not control that could not be obtained or checked (schema, key material, a status list, a referenced document); using it for an unknown effect outcome is an extension of that reading. Not gating.",
  "VRC-PRO-009": "The vector expects the implementation to emit the acceptance on its own once the human decides; SPEC.md 8.6 requires the answer only when the producer next asks (a resubmission). A push is not stated. Not gating.",
  "VRC-PRO-010": "SPEC.md 8.6 says a declined hold is answered permissionDenied when the producer next asks, while the propose specification allows the extended code propose:declined; and the vector expects a push (as VRC-PRO-009). Not gating.",
  "RSP-002": "A response SHOULD set threadId to the originating thread (SPEC.md 4.9, no normative validation semantics); the whole vector asserts a SHOULD. A mismatch is reported as an advisory on every reply. Not gating.",
};
// Mutants that violate a SHOULD, not a MUST, are caught by an advisory (docs/04 section 3.2), not by a Tier 1 failure.
const ADVISORY_MUTANTS: Record<string, string[]> = {
  "DUP-001": ["duplicateEquivalentResponse"], "CER-001": ["cerHoldNoInResponseTo"], "CER-005": ["noReplayRecord"], "CER-011": ["cerUnknownNotRetryable"], "CER-015": ["cerHoldStatusNotNamed"],
  "ERR-001": ["wrongReplyThread"], "ERR-005": ["retryableAlways"], "ID-001": ["replyIssuerFromRequest"],
  "NS-005": ["holdNoInResponseTo", "swapRecipientInReply"], "RSP-001": ["swapRecipientInReply", "wrongReplyThread"], "RSP-002": ["wrongReplyThread"],
  "VRC-PRO-008": ["holdNoInResponseTo"], "BND-002": ["httpStatusFlat"],
};
const TIME_FLAG_DROPPED = ["TIME-013", "TIME-014", "TIME-022", "TIME-023", "TIME-024"];
for (const f of Object.values(files)) {
  for (const vec of f.vectors) {
    const sg = SUBGROUP_OF[vec.id];
    if (sg !== undefined) {
      vec.tier = 2;
      vec.subgroup = sg;
      if (vec.id.startsWith("DUP-11")) delete vec.exactTier; // runs for a server that does not claim attested: the carrier is unsigned (skipIfOptional attested stays)
    } else if (vec.tier === 2 && vec.subgroup === undefined) vec.subgroup = "attested";
    const cl = CLARIFY_OF[vec.id];
    if (cl !== undefined) vec.clarify = cl;
    // citations: the proof fixtures rest on the Data Integrity specifications, which the framework only incorporates (SPEC.md 4.7)
    if (/^PRF-(006|007|008|009|010|011|018)$/.test(vec.id)) vec.spec = vec.spec.map((x) => (/^framework 4\.7(\.\d)?$/.test(x) ? "vc-di-eddsa section 3.3 and VC Data Integrity section 2.1 (per fixtures/proof/manifest.json; incorporated by SPEC.md 4.7)" : x)).filter((x, i, a2) => a2.indexOf(x) === i);
    if (vec.id === "WSH-006" || vec.id === "WSH-010") vec.spec.push("SPEC.md:589-591 (4.9.4 items 2 to 4)");
    if (vec.id === "WSH-007") vec.spec.push("SPEC.md:588 (4.9.4 item 1)");
    const adv = ADVISORY_MUTANTS[vec.id];
    if (adv !== undefined) {
      vec.advisoryMutants = adv;
      vec.mutants = (vec.mutants ?? []).filter((m) => !adv.includes(m));
      if (vec.mutants.length === 0) delete vec.mutants;
    }
    if (TIME_FLAG_DROPPED.includes(vec.id)) delete vec.profileWindow;
    if (vec.id === "2PC-007") {
      // the 409 for idConflict is the status table's SHOULD (bindings/https/0.3 spec.md:135, 154); the MUST is the idConflict rejection itself (SPEC.md:1021)
      for (const st of vec.steps) {
        const ex = st.expect;
        if (ex !== undefined && ex.code === "idConflict" && ex.httpStatus === 409) {
          delete ex.httpStatus;
          ex.httpStatusShould = 409;
        }
      }
      vec.advisoryMutants = ["httpStatusFlat"];
    }
    // O-11: the status table is the binding's SHOULD (bindings/https/0.3 spec.md:135 "The server SHOULD map ..."; 5.1 item 4 SHOULD answer a duplicate with the retained result), so a
    // status asserted on these rows is `httpStatusShould` (advisory at Tier 1, failing under attested), and the mutant that only swaps a status is advisory
    if (vec.id === "2PC-006" || vec.id === "2PC-007" || vec.id === "BND-005") {
      for (const st of vec.steps) {
        const ex = st.expect as Record<string, unknown> | undefined;
        if (ex !== undefined && ex["httpStatus"] !== undefined) { ex["httpStatusShould"] = ex["httpStatus"]; delete ex["httpStatus"]; }
      }
      const swap = "httpDuplicateStatusSwapped";
      if ((vec.mutants ?? []).includes(swap)) {
        vec.advisoryMutants = [...new Set([...(vec.advisoryMutants ?? []), swap])];
        vec.mutants = (vec.mutants ?? []).filter((m) => m !== swap);
      }
    }
    if (vec.id === "PRF-003" || vec.id === "PRF-005") vec.requires = (vec.requires ?? []).map((r) => (r === "cryptosuite:ecdsa-jcs-2019" ? "cryptosuite:ecdsa-jcs-2019:P-384" : r));
  }
}

// Vectors that put documents on the wire need a consequential carrier; declare it so gating is explicit.
for (const f of Object.values(files)) {
  for (const vec of f.vectors) {
    if (vec.steps.some((s) => s.send !== undefined) && !(vec.requires ?? []).includes("carrier:consequential") && !vec.id.startsWith("WIT-")) {
      vec.requires = ["carrier:consequential", ...(vec.requires ?? [])];
    }
  }
}
// The ceremony family split (decision 39, docs/04 sections 11.4 and 18.2). `registry` keeps only what the framework states for any
// held task (CER-001, 002, 005, 015: the next-step hold and its resubmission, duplicate absorption; 2PC-006, 007). The vectors that
// measure behaviour relative to the declared essential governance are `candidate`: the ceremony family runs on the suite's synthetic
// conformance/ceremony types, which have no Trust Tasks home. The suite's own ceremony and two-phase design (the seven-day deadline,
// deadlineLapsed, abort as taskFailed, the closed details.reason vocabulary, the every-named-administrator quorum, reset rules,
// verbatim retention, the status task, the declared proposerApproves) is `proposed`, profile `ceremony-design`: advisory.
const CEREMONY_DESIGN = new Set(["CER-003", "CER-004", "CER-006", "CER-007", "CER-008", "CER-009", "CER-010", "CER-011", "CER-012", "CER-013", "CER-014", "CER-016", "2PC-001", "2PC-002", "2PC-003", "2PC-004", "2PC-005", "2PC-008", "TIME-103"]);
const PER_DECLARED_E = new Set(["CER-017", "CER-018", "CER-019"]);
function ceremonyChannel(id: string, src: VectorSource): VectorSource {
  if (CEREMONY_DESIGN.has(id)) {
    return { ...src, channel: "proposed", profile: "ceremony-design", note: "suite ceremony and two-phase design (docs/04 sections 11.4 and 12), not framework text: advisory under decision 39 (essential versus extended governance)" };
  }
  if (PER_DECLARED_E.has(id)) {
    const implementedBy = deriveImplementedBy((x) => PER_DECLARED_E.has(x));
    // A candidate rests on suite-local text (the essential-governance declaration, docs/04 section 19), so its drift tracks that
    // document; tfRef keeps naming the framework text the hold rules come from.
    const ref = "suite:docs/04-suite-design.md";
    return {
      ...src, channel: "candidate", ref, pinnedDigest: currentDigest(ref, { suite: root }),
      candidate: {
        implementedBy,
        ...(implementedBy.length === 0 ? { implementedByNote: "No recorded platform run declares its essential governance yet; only the suite's reference adapter runs these vectors." } : {}),
        localText: "docs/04-suite-design.md",
        adoptionNote: "Runs on the suite's synthetic ceremony family (conformance/ceremony), which has no Trust Tasks home; the essential-governance declaration is suite-local (docs/04 section 19). None filed.",
      },
      note: "behaves per declared essential governance (decision 39): candidate because the ceremony family has no Trust Tasks home",
    };
  }
  return src;
}

// Spec-maturity channel and pinned digest (docs/04 section 18): derived from each vector's citations; pins come from vectors/pins.json.
{
  const pins = loadPins();
  for (const f of Object.values(files)) f.vectors = f.vectors.map((vec) => withSource(vec, ceremonyChannel(vec.id, coreSource(vec.spec, f.group, pins))));
}
// Hand-authored, not generated: the pushed-document vectors (docs/20) are authored in vectors-src/dtg/cex-push.json and emitted to
// vectors/dtg/cex-push.json. Only `source.tfRef` (derived from the source ref) and the synthetic/excludedFromRun markers are refreshed on the
// way through; nothing else in the file is touched.
{
  const pushed = JSON.parse(readFileSync(resolve(root, "vectors-src/dtg/cex-push.json"), "utf8")) as VectorFile;
  pushed.vectors = pushed.vectors.map((vec) => {
    const tfRef = tfRefFor(vec.source!.ref);
    if (tfRef === null) throw new Error(`${vec.id}: no Trust Tasks reference for ${vec.source!.ref}`);
    return withSource(vec, { ...vec.source!, tfRef });
  });
  files["dtg/cex-push.json"] = pushed;
}
const manifest: Manifest = { format: "tt-conformance-manifest/0.1", files: Object.keys(files) };
const out = resolve(root, process.argv[2] ?? "vectors");
mkdirSync(join(out, "framework"), { recursive: true });
mkdirSync(join(out, "ceremony-vrc"), { recursive: true });
mkdirSync(join(out, "ceremony-doc"), { recursive: true });
mkdirSync(join(out, "dtg"), { recursive: true });
mkdirSync(join(out, "ceremony-witness"), { recursive: true });
mkdirSync(join(out, "ceremony-receipt"), { recursive: true });
applyClarifyMeta(Object.values(files), loadClarifyMeta(resolve(here, "..")));
labelVersionRole(Object.values(files));
for (const [name, f] of Object.entries(files)) writeFileSync(join(out, name), JSON.stringify(f, null, 2) + "\n");
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${Object.values(files).reduce((a, f) => a + f.vectors.length, 0)} vectors in ${Object.keys(files).length} files`);
