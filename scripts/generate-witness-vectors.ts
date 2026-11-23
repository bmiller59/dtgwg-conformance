// SPDX-License-Identifier: Apache-2.0
// Authoring source for vectors/witness/ (docs/13-didcomm-carrier-and-witness-server.md), targeting the latest versions: witness/session 0.2,
// witness/session/submit 0.2 and trust-task-discovery 0.4 (decision D290; the 0.1 texts are not tested here). Run:
//   node --experimental-strip-types scripts/generate-witness-vectors.ts [outDir]
// Separate from generate-vectors.ts on purpose: these vectors target one implementation family reachable over DIDComm and are loaded with
// `--vectors vectors/witness`. Every vector quotes the rule it derives from. The kit specifications are drafts: status is `draft` for
// all three (kit commit 0dbc98f1c, origin/main of dtgwg-trust-tasks-tf, 2026-11-14; the 0.2 and 0.4 texts are the same at origin/main bd0c05013). Governance and deployment choices (locality policy,
// event window, issuer identity, session lifetime) are never asserted; a vector that a deployment choice can change says so and is not hard-coded.
import { labelVersionRole } from "../src/vectors/version-role.ts";
import { applyErrorReply } from "../src/vectors/error-reply.ts";
import { loadTaskFacts, requireAuthorisedWhereStanding } from "../src/coverage/reachable.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coreSource, loadPins, withSource } from "../src/vectors/source.ts";
import type { Manifest, Step, Vector, VectorFile } from "../src/vectors/types.ts";
import { applyClarifyMeta, loadClarifyMeta } from "../src/vectors/clarify.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const T0 = "2026-11-15T12:00:00Z";
const BASE = "https://trusttasks.org/spec/";
const DISC = `${BASE}trust-task-discovery/0.4`;
const SESS = `${BASE}witness/session/0.2`;
const SUBM = `${BASE}witness/session/submit/0.2`;
const DS = "specs/trust-task-discovery/0.4/spec.md (draft)";
const DP = "specs/trust-task-discovery/0.4/payload.schema.json (draft)";
const SS = "specs/witness/session/0.2/spec.md (draft)";
const SP = "specs/witness/session/0.2/payload.schema.json (draft)";
const BS = "specs/witness/session/submit/0.2/spec.md (draft)";
const BP = "specs/witness/session/submit/0.2/payload.schema.json (draft)";
const FW = "SPEC.md (framework, draft; the target is 0.6.0, the snapshot prose is WD 0.7.0: docs/04 Framework target)";
const REQ = ["binding:didcomm"];

const pins = loadPins();
function file(group: string, vectors: Vector[]): VectorFile {
  // every vector names its source (docs/04 section 18); the kit specifications cited are in the registry channel
  return { format: "tt-conformance-vectors/0.1", group, family: "witness", clock: { start: T0 }, vectors: vectors.map((x) => withSource(requireAuthorisedWhereStanding(x, loadTaskFacts(fileURLToPath(new URL("..", import.meta.url)))), coreSource(x.spec, group, pins))) };
}
const v = (id: string, title: string, spec: string[], steps: Step[], rest: Partial<Vector> = {}): Vector => ({
  id, title, tier: 1, spec, clarify: null, requires: [...REQ], ...rest, steps,
});
const doc = (type: string, idName: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}): NonNullable<Step["send"]> => ({
  document: { id: `$id(${idName})`, type, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s", payload, ...extra },
  sign: null,
});
const drop = (s: NonNullable<Step["send"]>, ...members: string[]): NonNullable<Step["send"]> => {
  const d = { ...(s.document as Record<string, unknown>) };
  for (const m of members) delete d[m];
  return { ...s, document: d };
};
const err = (code: string | string[]): Step["expect"] => ({ disposition: "error", code });
const respType = (t: string): string => `${t}#response`;

// ------------------------------------------------------------------ discovery 0.4
const dreq = (payload: Record<string, unknown> = {}, id = "d1") => doc(DISC, id, payload);
const disc = (matches: string[]): NonNullable<Step["expect"]> => ({ disposition: "response", type: respType(DISC), discovery: { matches } });
const wsd = file("WSD", [
  v("WSD-001", "discovery without patterns lists exactly the types the witness declares, as bare Type URIs without duplicates",
    [`${DS} Conformance responder 2 (no patterns is the single pattern *)`, `${DS} Conformance responder 3 and 4 (bare Type URIs, no duplicates)`, `${DP} (response schema)`],
    [{ send: dreq(), expect: disc([]) }]),
  v("WSD-002", "an empty patterns array is the same as *", [`${DS} Conformance responder 2`, `${DP} (patterns: omitted or empty means *)`],
    [{ send: dreq({ patterns: [] }), expect: disc([]) }]),
  v("WSD-003", "the pattern witness/* lists the witness types", [`${DP} (pattern grammar: <prefix>/* matches slugs starting with the prefix and the slash)`, `${DS} Conformance responder 2`],
    [{ send: dreq({ patterns: ["witness/*"] }), expect: disc(["witness/*"]) }]),
  v("WSD-004", "a pattern that matches nothing yields an empty list, not an error", [`${DS} Conformance responder 2 (the matching subset, possibly empty)`, `${DP} (supportedTypes: an array)`],
    [{ send: dreq({ patterns: ["no-such-family/*"] }), expect: disc(["no-such-family/*"]) }]),
  v("WSD-005", "more than 16 patterns are refused", [`${DP} (patterns maxItems 16)`, `${FW} 8.3 (malformedRequest: the task-specific payload schema)`],
    [{ send: dreq({ patterns: Array.from({ length: 17 }, (_, i) => `family${i}/*`) }), expect: err("malformedRequest") }]),
  v("WSD-006", "an unknown payload member is refused", [`${DP} (additionalProperties false)`, `${FW} 8.3 (malformedRequest)`],
    [{ send: dreq({ patterns: ["*"], unknownMember: true }), expect: err("malformedRequest") }]),
  v("WSD-007", "a request that names no recipient is refused: the specification declares recipient REQUIRED",
    [`${DS} front matter parties (Responder: recipient REQUIRED)`, `${FW} 7.3 (parties) and 8.3 (malformedRequest)`],
    [{ send: drop(dreq(), "recipient"), expect: err("malformedRequest") }]),
  v("WSD-008", "a request whose recipient is not the witness is refused wrongRecipient (or identityMismatch)",
    [`${FW} 7.2 item 5 (a recipient that does not identify the consumer: wrongRecipient, 8.3) and item 6 (inconsistent with the transport-authenticated identity: identityMismatch)`, "bindings/didcomm-v1/0.2 spec.md section 3 (draft)"],
    [{ send: { ...dreq(), document: { ...(dreq().document as object), recipient: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" } }, expect: err(["wrongRecipient", "identityMismatch"]) }]),
  v("WSD-010", "an expanded supportedTypes entry carries no member the 0.4 schema does not define (only type, requiredExt and acceptanceWindow)",
    [`${DP} Response supportedTypes items (the object form: additionalProperties false; properties type, requiredExt and acceptanceWindow)`, `${DS} Conformance responder 1 (the payload validates against the response sub-schema)`],
    [{ send: dreq(), expect: { disposition: "response", type: respType(DISC), forbidInReply: ["offeredExt", "optionalExt"] } }]),
  v("WSD-009", "the response also lists the discovery type itself, which the responder acts on",
    [`${DS} Conformance responder 2 ("the subset of Type URIs the responder can act upon")`],
    [{ send: dreq({ patterns: ["trust-task-discovery"] }), expect: { disposition: "response", type: respType(DISC), match: { "/payload/supportedTypes/0": "^https://trusttasks\\.org/spec/trust-task-discovery/\\d+\\.\\d+$" } } }],
    { clarify: "The specification text says a responder lists what it can act upon, but the witness-server documents its served set as the two witness types; whether a responder must list the discovery type it answers is not stated." }),
]);

// ------------------------------------------------------------------ witness/session 0.2
const sreq = (id: string, parties: unknown, extra: Record<string, unknown> = {}, as = "$A") =>
  doc(SESS, id, { parties }, { threadId: `$id(${id})`, issuer: as, ...extra });
const sessOk = (): NonNullable<Step["expect"]> => ({
  disposition: "response", type: respType(SESS),
  match: { "/payload/challenge": "^.{16,}$", "/payload/domain": "^.+$" },
});
const sessStep = (id: string, parties: unknown, cap: string, as = "$A", from?: string): Step => ({
  send: { ...sreq(id, parties, {}, as), ...(from === undefined ? {} : { from }) },
  capture: { [cap]: "/payload/challenge", [`${cap}Domain`]: "/payload/domain" },
  expect: sessOk(),
});
const wss = file("WSS", [
  v("WSS-001", "a session opened by a party named in parties is answered with a challenge and a domain",
    [`${SS} Conformance witness 3 (a fresh, unpredictable challenge and its domain)`, `${SP} Response (challenge minLength 16, domain minLength 1)`],
    [sessStep("s1", ["$A", "$X"], "ch")]),
  v("WSS-002", "the response to a session carries a proof (the response proof is REQUIRED)",
    [`${SS} front matter proofRequirement (response REQUIRED)`, `${SS} Conformance witness 3 (under the REQUIRED proof)`],
    [{ send: sreq("s1", ["$A", "$X"]), expect: { disposition: "response", type: respType(SESS), match: { "/proof/type": "^.+$", "/proof/proofValue": "^.+$" } } }]),
  v("WSS-003", "two sessions never share a challenge",
    [`${SP} Response challenge ("A witness MUST NOT reuse a challenge across sessions")`, `${SS} One session per participating party`],
    [sessStep("s1", ["$A", "$X"], "ch"), { send: sreq("s2", ["$A", "$X"]), expect: { ...sessOk(), notEqual: { "/payload/challenge": ["$cap(ch)"] } } }]),
  v("WSS-004", "the two parties of one exchange each open their own session, each with its own challenge",
    [`${SS} One session per participating party ("the two sessions are separate exchanges, so each carries its own challenge")`],
    [sessStep("s1", ["$A", "$X"], "ch"), { send: { ...sreq("s2", ["$A", "$X"], {}, "$X"), from: "X" }, expect: { ...sessOk(), notEqual: { "/payload/challenge": ["$cap(ch)"] } } }]),
  v("WSS-005", "a session opened by a party that is not named in parties is refused witness/session:refused",
    [`${SS} Conformance witness 2`, `${SS} errorCodes (witness/session:refused)`],
    [{ send: sreq("s1", ["$X", "$S"]), expect: err("witness/session:refused") }]),
  v("WSS-006", "parties with one entry are refused", [`${SP} (parties minItems 2, maxItems 2)`, `${FW} 8.3 (malformedRequest)`],
    [{ send: sreq("s1", ["$A"]), expect: err("malformedRequest") }]),
  v("WSS-007", "parties with three entries are refused", [`${SP} (parties maxItems 2)`, `${FW} 8.3 (malformedRequest)`],
    [{ send: sreq("s1", ["$A", "$X", "$S"]), expect: err("malformedRequest") }]),
  v("WSS-008", "a party that is not a DID is refused", [`${SP} (parties items pattern ^did:)`, `${FW} 8.3 (malformedRequest)`],
    [{ send: sreq("s1", ["$A", "not-a-did"]), expect: err("malformedRequest") }]),
  v("WSS-009", "a session with no issuedAt is not accepted",
    [`${SS} front matter issuedAtRequirement (REQUIRED)`, `${FW} 7.3 item 17 and 7.2 item 13 (a refusal; the code is not stated)`],
    [{ send: drop(sreq("s1", ["$A", "$X"]), "issuedAt"), expect: { disposition: "any-refusal" } }]),
  v("WSS-010", "a replay of the same session document does not open a second session",
    [`${SS} front matter issuedAtRequirement rationale ("Replayed, it opens a second session against a witness who agreed to one")`, `${SS}:39-41 (sideEffects level: mutating)`, `${FW}:92 (mutating is consequential)`, `${FW}:1021 (7.2 item 11: a second receipt MUST NOT repeat the consequential effect)`, `${FW}:1055 (return the prior result; never taskFailed)`],
    [sessStep("s1", ["$A", "$X"], "ch"), { send: { same: "previous" }, expect: { disposition: "duplicate" } }]),
  v("WSS-011", "a session request without a recipient is refused",
    [`${SS} front matter parties (witness: recipient REQUIRED)`, `${FW} 8.3 (malformedRequest)`],
    [{ send: drop(sreq("s1", ["$A", "$X"]), "recipient"), expect: err("malformedRequest") }]),
]);

// ------------------------------------------------------------------ witness/session/submit 0.2
const vp = (challenge: string, domain: string): Record<string, unknown> => ({
  "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiablePresentation"], verifiableCredential: [],
  proof: { type: "DataIntegrityProof", cryptosuite: "eddsa-jcs-2022", proofPurpose: "authentication", challenge, domain, verificationMethod: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK#z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", proofValue: "z3FXQjecWufY46yg5abdVZsXqLhxhueuSoZgNRxoJxoKyM8XqjvNgDBiUbqWqLqhYBVyNXBCvmNRSCbkiaZbP1DGu" },
});
const subm = (id: string, thread: string, vpDoc: unknown, extra: Record<string, unknown> = {}): NonNullable<Step["send"]> => ({ ...doc(SUBM, id, { vp: vpDoc }, { threadId: thread, ...extra }), sign: { purpose: "assertionMethod" } });
const wsb = file("WSB", [
  v("WSB-001", "a submission on a session that was never opened is refused",
    [`${BS} Conformance witness (a submission is accepted only on a session; the code for an unknown session is not stated)`, `${BS} Conformance participating party 1`],
    [{ send: subm("m1", "$id(nosession)", vp("0".repeat(32), "unknown")), expect: { disposition: "any-refusal" } }]),
  v("WSB-002", "a presentation bound to another challenge is refused challengeMismatch, before any other check",
    [`${BS} Conformance witness 2 (binding verified before any other check; challengeMismatch, distinct from presentationInvalid)`, `${BS} errorCodes (challengeMismatch)`],
    [sessStep("s1", ["$A", "$X"], "ch"), { send: subm("m1", "$id(s1)", vp("not-the-session-challenge-0123456789", "$cap(chDomain)")), expect: err("witness/session/submit:challengeMismatch") }]),
  v("WSB-003", "a submission by a party other than the one that opened the session is refused challengeMismatch",
    [`${BS} Conformance witness 3`, `${BS} errorCodes (challengeMismatch)`, `${BS} Conformance participating party 1 (only on a session it opened itself)`],
    // O-06: the presentation is built by party X for this session's challenge and domain (the witnessPresentation trigger, variant valid), so it verifies and the
    // only thing wrong is who submits it; a fixed presentation whose proof cannot verify would let a witness that verifies the proof first answer presentationInvalid
    [sessStep("s1", ["$A", "$X"], "ch"),
      { trigger: { action: "witnessPresentation", args: { holder: "$X", partner: "$A", challenge: "$cap(ch)", domain: "$cap(chDomain)", variant: "valid" } }, capture: { vpX: "/vp" } },
      { send: { ...subm("m1", "$id(s1)", "$capJson(vpX)", { issuer: "$X" }), from: "X" }, expect: err("witness/session/submit:challengeMismatch") }],
    { requires: [...REQ, "optional:witness.presentation"] }),
  v("WSB-004", "a presentation bound to the right challenge that does not verify is refused presentationInvalid",
    [`${BS}:59-61 (presentationInvalid: own proof, holder binding or party bindings fail)`, `${BS}:293 (binding checked first)`, `${BS}:323-326 (minting is the witness's own policy)`],
    [sessStep("s1", ["$A", "$X"], "ch"), { send: subm("m1", "$id(s1)", vp("$cap(ch)", "$cap(chDomain)")), expect: err("witness/session/submit:presentationInvalid") }],
    { clarify: "The submit specification maps a failure of the presentation's own proof, its holder binding or its party bindings to presentationInvalid (specs/witness/session/submit/0.2/spec.md:59-61) and fixes only the challenge binding as the first check (spec.md:293). This vector's presentation also carries no credential and no holder. The specification does not state the order of the checks after the binding, nor the code a witness returns when it declines a submission under its own policy (spec.md:323-326), so a refusal on another ground before the proof is checked is also acceptable. The code is observed, not gating." }),
  v("WSB-006", "a submission without a proof is refused proofRequired: the request proof is REQUIRED",
    [`${BS} front matter proofRequirement (request REQUIRED)`, `${FW} 7.2 item 7 (a REQUIRED proof that is absent: proofRequired)`],
    [sessStep("s1", ["$A", "$X"], "ch"), { send: { ...subm("m1", "$id(s1)", vp("$cap(ch)", "$cap(chDomain)")), sign: null }, expect: err("proofRequired") }]),
  v("WSB-007", "a proof made for the authentication purpose by an authentication key is not refused proofInvalid",
    [`${FW} 4.7.3 (the proofPurpose names the relationship to check; the key must be listed under it)`, `${BS} (names no proofPurpose for the request)`],
    [sessStep("s1", ["$A", "$X"], "ch"), { send: { ...subm("m1", "$id(s1)", vp("not-the-session-challenge-0123456789", "$cap(chDomain)")), sign: { purpose: "authentication" } }, expect: err("witness/session/submit:challengeMismatch") }],
    { clarify: "Neither the submit specification nor SPEC.md 4.7.3 pins a purpose for this request, so a consumer that accepts only one purpose is stricter than the text; whether that is a defect or a profile choice needs a task-force reading." }),
  v("WSB-005", "a submission with no vp is refused", [`${BP} (vp required)`, `${FW} 8.3 (malformedRequest)`],
    [sessStep("s1", ["$A", "$X"], "ch"), { send: { ...subm("m1", "$id(s1)", {}), document: { id: "$id(m1)", type: SUBM, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s", threadId: "$id(s1)", payload: {} } }, expect: err("malformedRequest") }]),
]);

// Mutants of the witness oracle (src/adapters/reference/witness-oracle.ts, docs/13 section 6): each must make its vector fail.
const MUTANTS_OF: Record<string, string[]> = {
  "WSD-001": ["discoveryNoDefaultStar", "discoveryDuplicates", "discoveryFragmentsListed"],
  "WSD-002": ["discoveryNoDefaultStar"],
  "WSD-003": ["discoveryIgnoresPatterns"],
  "WSD-004": ["discoveryIgnoresPatterns", "discoveryEmptyAsError"],
  "WSD-005": ["discoveryNoPatternBound"],
  "WSD-006": ["discoveryOpenPayload"],
  "WSD-007": ["recipientOptional"],
  "WSD-008": ["noRecipientCheck"],
  "WSD-009": ["witnessDiscoveryOmitsSelf"],
  "WSD-010": ["witnessOffersExt"],
  "WSS-001": ["witnessShortChallenge"],
  "WSS-002": ["unsignedReplies"],
  "WSS-003": ["witnessChallengeReuse"],
  "WSS-004": ["witnessChallengeReuse"],
  "WSS-005": ["witnessSessionAnyIssuer"],
  "WSS-006": ["noPayloadValidation"],
  "WSS-007": ["noPayloadValidation"],
  "WSS-008": ["noPayloadValidation"],
  "WSS-009": ["noFreshnessWindow"],
  "WSS-010": ["noReplayRecord"],
  "WSS-011": ["recipientOptional"],
  "WSB-001": ["witnessNoSessionCheck"],
  "WSB-002": ["witnessBindingAfterVerification"],
  "WSB-003": ["witnessAnyPartySubmits"],
  "WSB-004": ["witnessSkipsPresentationVerification"],
  "WSB-005": ["noPayloadValidation"],
  "WSB-006": ["proofOptional", "proofRequiredAsInvalid"],
  "WSB-007": ["witnessPurposeAssertionOnly"],
};
for (const f of [wsd, wss, wsb]) for (const x of f.vectors) { const m = MUTANTS_OF[x.id]; if (m !== undefined) x.mutants = m; }

const files: Record<string, VectorFile> = { "wsd.json": wsd, "wss.json": wss, "wsb.json": wsb };
const manifest: Manifest = { format: "tt-conformance-manifest/0.1", files: Object.keys(files) };
const out = resolve(root, process.argv[2] ?? "vectors/witness");
mkdirSync(out, { recursive: true });
applyClarifyMeta(Object.values(files), loadClarifyMeta(resolve(here, "..")));
applyErrorReply(Object.values(files));
labelVersionRole(Object.values(files));
for (const [name, f] of Object.entries(files)) writeFileSync(join(out, name), JSON.stringify(f, null, 2) + "\n");
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${Object.values(files).reduce((a, f) => a + f.vectors.length, 0)} vectors in ${Object.keys(files).length} files`);
