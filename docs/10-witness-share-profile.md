---
slug: vrc/relationships/witness-share
version: "0.1"
title: VRC Relationships - Witness Share (suite-local profile)
summary: After a witnessed relationship exchange, a party delivers its own Verifiable Witness Credential to its counterparty as a challenge-bound presentation plus the matching outcome-evidence pair; the receiver verifies the pairing and only then stores the credential, and returns a receipt naming the stored credential by digest.
status: draft (suite-local profile; not a registry specification)
targetFrameworkVersion: "0.6.0"
category: credentials
parties:
  - role: sharing party
    requirement: REQUIRED
    member: issuer
  - role: receiving party
    requirement: REQUIRED
    member: recipient
proofRequirement:
  request: REQUIRED
  response: OPTIONAL
  rationale: >-
    The reference implementation declares the request proof required and the
    response proof not required (witnessShareSpec.ts:30-34, 63-66). The
    receiving party stores a credential and marks it verified on the strength
    of the request, so the request is attributed; the receipt is consumed by
    the connected peer.
issuedAtRequirement:
  requirement: REQUIRED
  rationale: >-
    Not declared by the reference implementation's spec object. The sender
    always sets it (ceremony.ts:1721). Required here because the task mutates
    state; see section 9.
sideEffects:
  level: mutating
  rationale: "The receiving party stores a credential tagged as witness-verified (ceremony.ts:1829-1835). Not compensatable by this exchange."
errorCodes:
  - code: vrc/relationships/witness-share:notAccepted
    meaning: The receiving party refuses the share - the bundle is incomplete, arrives outside an accepted relationship exchange, fails the outcome-evidence pairing or the presentation checks, or the credential is not about the sender or this exchange.
    retryable: false
related:
  - vrc/relationships/propose
  - vrc/relationships/issue
  - witness/session
  - witness/session/submit
---

# vrc/relationships/witness-share 0.1 (suite-local profile)

Status: DRAFT. This is a conformance-suite profile specification, not a registry specification and not a proposal to the task force. The registry contains no `witness-share` task (it has `vrc/relationships/{propose,issue}` and `witness/{_shared,session}`); the only definition is a local specification inside the keyring-wallet bifold module. This text is written from that code and states what it does. Where the code does not determine a rule, the text says "not determined by the reference implementation" and does not fill the gap.

Conventions: KW is keyring-wallet at bifold commit `a9babcf13`. Citations are `file:line` in that commit, relative to `packages/core/src/modules/trust-tasks/` unless a path is given: `ceremony.ts`, `witnessShareSpec.ts`, `outcomeEvidence.ts`, `witnessCeremony.ts`, `services/TrustTasksService.ts`, `services/TrustTaskDocumentRepository.ts`, and `packages/trust-tasks/src/documentProof.ts` (written `documentProof.ts` below). Keywords MUST, SHOULD and MAY are used only for rules taken from a framework or registry specification (named) or for rules this profile adopts (marked "profile"). Statements of what KW does are in the indicative.

## 1. Identity of the task

| Item | Value | Source |
|---|---|---|
| Request type URI | `https://trusttasks.org/spec/vrc/relationships/witness-share/0.1` | `witnessShareSpec.ts:22` |
| Response type URI | the request URI with `#response` | `witnessShareSpec.ts:23` |
| Slug | `vrc/relationships/witness-share` | derived (`ceremony.ts:184-186`) |
| Version | 0.1 | `witnessShareSpec.ts:22` |
| Bearer | no | `witnessShareSpec.ts:30` |
| Proof required (request) | yes | `witnessShareSpec.ts:31` |
| Proof required (response) | no | `witnessShareSpec.ts:66` |
| Recipient required | yes, request and response | `witnessShareSpec.ts:32, 67` |
| Advertised in discovery | yes (`SUPPORTED_TASK_TYPES`) | `ceremony.ts:176-181` |

Authority: the `trusttasks.org` authority is used by KW although the slug is not published there. Publishing the slug, or moving it to a distinct authority, is outside this profile (docs/07 O1 and the upstream offer).

## 2. Purpose

Within a witnessed relationship exchange (`vrc/relationships/propose` with `witnessed: true`), each party runs its own `witness/session` with the witness and receives a Verifiable Witness Credential (VWC) about itself. This task lets that party hand the VWC to its counterparty as holder-controlled disclosure: the VWC wrapped in a signed Verifiable Presentation, plus the retained pair of documents that evidences the witnessing. The receiver runs the outcome-interpretability pairing (framework 4.9.3 and 4.9.4) and stores the credential only if it passes (`witnessShareSpec.ts:1-18`, `ceremony.ts:1730-1735`). The share is performed once in each direction, one share per party, because each party has its own VWC (`ceremony.ts:1395-1423`).

The credential is "earned by verification, never granted on receipt": a failed check stores nothing (`ceremony.ts:1730-1735`, `witnessShare.test.ts:1-14`).

## 3. Request

### 3.1 Envelope members as KW sends them

Built in `sendWitnessShareForExchange` (`ceremony.ts:1715-1724`):

| Member | Value | Source |
|---|---|---|
| `id` | a fresh UUID | `ceremony.ts:1716` |
| `type` | the request type URI | `ceremony.ts:1717` |
| `threadId` | the relationship exchange id (the `propose` document's id) | `ceremony.ts:1718` |
| `issuer` | the sender's connection DID (`connection.did`) | `ceremony.ts:1719` |
| `recipient` | the counterparty's connection DID (`connection.theirDid`) | `ceremony.ts:1720` |
| `issuedAt` | `new Date().toISOString()` (millisecond precision) | `ceremony.ts:1721` |
| `payload` | see 3.2 | `ceremony.ts:1722` |
| `proof` | eddsa-jcs-2022 DataIntegrityProof, see section 6 | `ceremony.ts:1724` |

KW sets no `expiresAt`, no `parentThreadId` and no `ext` on the envelope. Whether a receiver must accept or refuse those is not determined by the reference implementation beyond the framework envelope rules.

### 3.2 Payload

Closed object (`additionalProperties: false`) (`witnessShareSpec.ts:40`). Required: `presentation`, `outcomeEvidence` (`witnessShareSpec.ts:41`).

| Member | Req | Type and constraints | Source |
|---|---|---|---|
| `presentation` | yes | Object. A signed W3C Verifiable Presentation wrapping exactly the sender's VWC. The schema constrains nothing inside it. | `witnessShareSpec.ts:43-47` |
| `outcomeEvidence` | yes | Closed object with required `initiating` and `terminal`. | `witnessShareSpec.ts:48-58` |
| `outcomeEvidence.initiating` | yes | Object (open). The `witness/session` document that opened the sender's witness session, as retained. | `witnessShareSpec.ts:55`, `witnessCeremony.ts:324-335` |
| `outcomeEvidence.terminal` | yes | Object (open). The `witness/session/submit#response` that closed the session, with the witness's proof, as retained. | `witnessShareSpec.ts:56`, `outcomeEvidence.ts:138-141` |
| `ext` | no | Object. | `witnessShareSpec.ts:59` |

Evidence member names differ from the registry. The registry's shared evidence definition (`witness/_shared/0.1`, `OutcomeEvidence`) names the two members `session` and `outcome` and requires each to have at least one member. KW names them `initiating` and `terminal` and sets no `minProperties`. This profile follows KW (what is sent today). Whether a later registry specification should adopt the shared names is for the upstream offer, not decided here.

### 3.3 The presentation

Assembled by `assembleVwcPresentation` (`outcomeEvidence.ts:97-143`):

- `@context`: one entry, `https://www.w3.org/ns/credentials/v2` if the VWC's context list contains it, else `https://www.w3.org/2018/credentials/v1` (`outcomeEvidence.ts:109-114`).
- `type`: `["VerifiablePresentation"]`, `holder`: the DID part of the signing verification method (the sender's relationship DID), `verifiableCredential`: a one-element array holding the VWC (`outcomeEvidence.ts:115-122`).
- Signed as a W3C Linked Data Proof of type `Ed25519Signature2018`, with `challenge` = the exchange id and `domain` = `vrc:witness-share`, under the sender's relationship DID's first verification method (`outcomeEvidence.ts:126-134`, `ceremony.ts:1409-1414`). The proof purpose is not set by KW; the signing library derives an authentication-purpose proof from challenge and domain (comment at `outcomeEvidence.ts:124-125`).

Domain constant: `vrc:witness-share` (`witnessShareSpec.ts:26`).

The VP proof type (`Ed25519Signature2018`) differs from the envelope proof (`eddsa-jcs-2022`, section 6). Whether other VP cryptosuites must be accepted is not determined by the reference implementation.

### 3.4 The credential carried

The VWC is whatever the witness issued in `witness/session/submit#response` (`witnessCeremony.ts:508-511`). Properties the receiver reads:

- `credentialSubject.id` (or the first element if `credentialSubject` is an array): the sharing party's relationship DID (`ceremony.ts:1807-1811`).
- `taskContext` and `taskDigestMultibase`: read from the credential's top level or from `credentialSubject`, both placements accepted (`outcomeEvidence.ts:40-67`, `taskCitationOf`). The current DTG shape places them at top level; the nested placement is KW's older read path.
- `parties`: read from `credentialSubject.parties` if present, otherwise from the cited session document's `payload.parties` (`ceremony.ts:1812-1815`). A VWC of the newer `witnessed/1` shape carries no `parties`; they are in the session document (`ceremony.ts:1797-1803`, `witnessShare.test.ts:399-440`).

### 3.5 Preconditions on the sender (KW behaviour, not receiver rules)

KW sends a share only when all hold (`ceremony.ts:1356-1436`, `1672-1712`):

1. the exchange's retained `propose` document has `payload.witnessed === true`, a witness connection is connected, and witnessing is enabled in the user's settings;
2. this party's witness session completed and the VWC was stored;
3. the bundle assembled (the session pair is present) and a local self-check of the same pairing passed (`completionEvidenced`); a failed self-check withholds the share with a warning, and the exchange continues unwitnessed;
4. the peer's `trust-task-discovery` answer lists the share type, waiting up to 24 attempts of 5 s (2 minutes); with no answer, or an answer that omits the type, the share is silently skipped;
5. no earlier share request from this issuer is retained for this thread (`priorForExchange`, `ceremony.ts:515-521`, `1706-1712`).

These gates are sender-side behaviour. They are not receiver conformance rules and the suite does not encode them (docs/05 K7).

## 4. Receiver processing

Entry: `handleInboundWitnessShare` (`ceremony.ts:1736-1854`), registered for the type (`ceremony.ts:2037-2044`). Order of checks:

1. **Framework pipeline** (`services/TrustTasksService.ts:96-114`): schema validation of envelope and payload (closed payload, required members), type and version, recipient, identity cross-check against the transport sender (the connection's counterparty DID), proof policy, freshness. See sections 6 and 8 for which of these KW makes stateful.
2. **Bundle shape**: `presentation`, `outcomeEvidence.initiating` and `outcomeEvidence.terminal` all present, else `notAccepted` "payload is not a presentation bundle" (`ceremony.ts:1767-1769`).
3. **Accepted exchange**: a relationship record exists for the sending connection DID with both relationship DIDs set, else `notAccepted` "no accepted relationship exchange with this sender" (`ceremony.ts:1771-1775`). The record is looked up by the sender's connection DID only; KW does not compare the share's `threadId` with an accepted `propose` id here. Whether the share's `threadId` must equal the id of an accepted `propose` is not determined by the reference implementation. (The challenge check below makes the thread id load-bearing only by being the VP's challenge.)
4. **Outcome Interpretability pairing and presentation checks** (`verifyVwcPresentationBundle`, `outcomeEvidence.ts:164-302`), run with expected challenge = the share's `threadId` (or its `id` if no `threadId`) and expected domain = `vrc:witness-share` (`ceremony.ts:1781-1792`). Failures are collected; any failure refuses with `notAccepted` "bundle failed verification: ..." (`ceremony.ts:1793-1795`):
   1. The VP verifies under the expected challenge and domain. The credential-subject-authentication check is disabled because the presenter is the VRC issuer side and the subject is the counterparty (`outcomeEvidence.ts:195-210`).
   2. The VP carries a credential (`outcomeEvidence.ts:215-221`).
   3. The VWC's own proof verifies independently of the evidence (`outcomeEvidence.ts:223-238`).
   4. The VWC carries `taskContext` and `taskDigestMultibase` (`outcomeEvidence.ts:265-266`).
   5. `initiating.id` equals `taskContext` (`outcomeEvidence.ts:267-269`).
   6. `taskDigestMultibase` reproduces over `initiating`: the digest is `multibase(base58btc, multihash(sha-256, JCS(document without top-level proof)))`, and equality is compared on decoded multihash bytes, not strings (`outcomeEvidence.ts:270-273`, `documentProof.ts:55-89`).
   7. `terminal.threadId` equals `initiating.threadId`, or `initiating.id` where `threadId` is absent (`outcomeEvidence.ts:274-277`).
   8. `terminal.type` is not a `trust-task-error` type and ends in `#response` (`outcomeEvidence.ts:278-283`).
   9. `terminal` carries a `proof` (`outcomeEvidence.ts:284-285`) and that proof verifies under `terminal.issuer` (`outcomeEvidence.ts:286-288`).
5. **Credential present**: the VP's first credential exists, else `notAccepted` "presentation carries no credential" (`ceremony.ts:1804-1806`).
6. **Subject binding**: `credentialSubject.id` equals the relationship record's counterparty relationship DID (the sender's relationship DID), else `notAccepted` "VWC subject is not the sender relationship DID" (`ceremony.ts:1807-1811`). The test case is "your own VWC bounced back" (`witnessShare.test.ts:248-264`).
7. **Parties binding**: the parties list (from the VWC subject or the session document) contains both this party's and the counterparty's relationship DID, else `notAccepted` "VWC parties do not name this exchange relationship DIDs" (`ceremony.ts:1812-1818`).
8. **Store**: unless an equal credential is already stored (section 9), store the VWC as a credential record tagged `WITNESS_VERIFIED_TAG = true` (`ceremony.ts:1820-1836`).
9. **Receipt** (section 5).

Checks the reference implementation does NOT make (each is "not determined by the reference implementation" for the profile, and the suite design lists the stronger rules separately in section 11):

- That the terminal's proof verifies under the initiating document's `recipient` (the witness). KW verifies under `terminal.issuer` (`outcomeEvidence.ts:286`). Framework 4.9.4 item 4 requires the recipient. A terminal re-signed by the holder of the initiating document would pass KW.
- That the terminal's `type` equals the type the initiating document's specification declares as outcome evidence (`witness/session/submit#response`); KW accepts any non-error `#response` type (`outcomeEvidence.ts:278-283`). Framework 4.9.4 item 3 requires the declared type.
- That the terminal's declared binding to the initiating document holds (`payload.vwc.taskContext` and `payload.vwc.taskDigestMultibase`, `witness/session/0.2` `outcomeEvidence.binding`), nor that the terminal's delivered VWC is the VWC in the presentation. KW checks id and digest of the initiating document against the presented VWC, and the terminal only by thread, type and proof.
- That the presentation's `holder` or proof verification method is the sender's relationship DID.
- That the VWC's issuer is a witness the receiver trusts. The verdict records this as a residual: "witness identity legibility" (`outcomeEvidence.ts:300`).
- Revocation status (`outcomeEvidence.ts:300`).
- That the exchange was agreed as witnessed (`witnessed: true` on the `propose` and its acceptance). The sender checks it; the receiver does not.
- That the session documents are the 0.2 versions. KW imports `witness/session` 0.1 and `witness/session/submit` 0.1 (`witnessCeremony.ts:33-34`); the registry also holds 0.2.

## 5. Response and errors

### 5.1 Success response

Type: the request URI plus `#response` (`witnessShareSpec.ts:23`). Built with `respondWith(request, freshUuid, payload, issuedAtFn)` (`ceremony.ts:1838-1840`), which sets `threadId` to the request's thread, swaps issuer and recipient and sets a fresh `id` and `issuedAt` (framework 4.4.1; KW's reply helper is the registry runtime's). It is sent unsigned: KW does not sign the receipt (docs/05 K3).

Payload (closed): `{ "vwcDigestMultibase": string }`, optional `ext` (`witnessShareSpec.ts:77-88`).

| Member | Req | Constraints | Source |
|---|---|---|---|
| `vwcDigestMultibase` | yes | string, `minLength` 16, pattern `^(z[1-9A-HJ-NP-Za-km-z]+|u[A-Za-z0-9_-]+)$`; digest over the RFC 8785 canonicalization of the VWC as stored | `witnessShareSpec.ts:81-86` |
| `ext` | no | object | `witnessShareSpec.ts:87` |

The digest is computed by the receiver over the credential it holds (`digestMultibase(vwc)`, `ceremony.ts:1820, 1838`), not copied from the request, and it is the digest of the VWC object inside the presentation (not of the presentation, not of a re-serialised stored record). A receiver MUST compute it over the credential as stored (profile; same rule as `vrc/relationships/issue`).

Digest algorithm: SHA-256, base58btc multibase (`z` prefix) (`documentProof.ts:55-58`). The schema also admits a `u` (base64url) prefix; whether KW would accept a share or receipt using another multihash algorithm is not determined by the reference implementation (the digest comparison decodes both values and compares bytes, `documentProof.ts:78-89`, so an unknown algorithm is simply unequal).

A failed verification is never reported as a success receipt: "a failed verification is a trust-task-error, never a receipt reporting failure" (`witnessShareSpec.ts:75-77`).

### 5.2 Error response

Refusals are `trust-task-error` documents built by `rejectWith(request, freshUuid, {code, message, retryable})` (`ceremony.ts:1761-1766`) and sent on the same connection (`ceremony.ts:1847-1853`).

| Code | When | `retryable` | Source |
|---|---|---|---|
| `vrc/relationships/witness-share:notAccepted` (extended code, framework 8.5; local part `notAccepted`) | every handler-level refusal in section 4 steps 2 to 7 | `false` | `ceremony.ts:1763-1765` |
| framework codes (framework 8.3) | pipeline refusals in section 4 step 1: `malformedRequest` (schema, unknown payload member), `unsupportedType`, `unsupportedVersion`, `proofRequired`, `proofInvalid`, `wrongRecipient`, `identityMismatch`, `expired`/freshness | per framework default | produced by the registry runtime's `consumeInbound` (`services/TrustTasksService.ts:101-114`); not exercised by a KW witness-share test |

The wire spelling of the extended code is `<slug>:<local>`; KW builds it with `extendedCode(TYPE_URI, 'notAccepted')` (`ceremony.ts:1763`) and its test asserts only that the code contains `notAccepted` (`witnessShare.test.ts:263`). The expected full string is therefore taken from the registry's convention (`vrc/relationships/issue:notAccepted`) and the error specification's extended-code rule, not from a KW test.

Message wording is free text and not normative; the messages in section 4 are KW's.

Which `notAccepted` condition applies when several fail at once is not determined by the reference implementation beyond the order in section 4 (the order is KW's; the suite should not pin it).

The error carries no `inResponseTo`-specific rule beyond the framework's. A refused share stores nothing (section 9). A rejected inbound document is nonetheless retained verbatim as diagnostic state (`services/TrustTasksService.ts:116-118`).

### 5.3 Receipt handling by the sender

`handleInboundWitnessShareReceipt` (`ceremony.ts:1860-1902`) consumes the receipt against the response spec, then finds the sender's own retained share (by issuer) and compares the receipt's `vwcDigestMultibase` with the digest of the VWC it sent. A match logs success; a mismatch, or a receipt with no matching share, only logs a warning. KW takes no other action (no retry, no error). What a sender must do on a mismatch is not determined by the reference implementation. The registry `vrc/relationships/issue` has the equivalent rule: the sender MUST NOT treat a receipt whose digest matches no delivery of its own as acknowledging one.

## 6. Authorisation and proof requirements

### 6.1 Authorisation

Authorisation evidence is the accepted relationship exchange, as for `vrc/relationships/issue`. KW checks this as "a relationship record exists with both relationship DIDs for this sender connection DID" (`ceremony.ts:1771-1775`). A share from a connection with no such record is refused `notAccepted`, however well it verifies. Both proofs and the pairing establish attribution and integrity, not entitlement. Proof of a witnessed credential is not authorisation to share it; the subject binding (4.6) and parties binding (4.7) tie the share to the accepted exchange.

If `findByConnectionDid` finds no record, KW's proof policy falls back to `acceptUnverified` and the handler then refuses `notAccepted` (`ceremony.ts:1467-1475`). So an unauthorised sender's proof is not verified; the refusal comes first from authorisation. A conformance vector for an unsolicited share should therefore expect `notAccepted` and not `proofInvalid`.

### 6.2 Tier 1 (framework core)

| Rule | KW behaviour | Source |
|---|---|---|
| Request proof REQUIRED; missing is `proofRequired` | spec object declares it; enforced by the pipeline | `witnessShareSpec.ts:31` |
| Request proof verifies under the sender's relationship DID, a DataIntegrityProof `eddsa-jcs-2022` over the document without `proof`, `proofPurpose` `assertionMethod`, `verificationMethod` belonging to the expected controller | verifier is `verifyDocumentProof(agent, doc, counterpartyRelationshipDid)` | `ceremony.ts:1467-1481, 1751`; `documentProof.ts:403-456` |
| `recipient` present and equal to the receiving party's identifier on that connection | recipient required; checked by the pipeline | `witnessShareSpec.ts:32`; `ceremony.ts:1743-1748` |
| `issuer` consistent with the transport-authenticated sender | the pipeline cross-check uses the connection's `theirDid` | `services/TrustTasksService.ts:97-99` |
| Outcome evidence pairing, section 4 step 4 | partially (see the "not made" list) | `outcomeEvidence.ts:256-289` |
| Receipt: proof OPTIONAL | unsigned | `witnessShareSpec.ts:66`, `ceremony.ts:1838` |

### 6.3 Tier 2 (`attested` profile, proposed in docs/04 section 10)

| Rule | KW behaviour |
|---|---|
| Envelope `issuer`, proof signer and transport sender are the same identifier (the connection DID); the relationship DID appears only inside the credential and presentation | KW sets `issuer` to the connection DID (`ceremony.ts:1719`) but signs the envelope proof under the relationship DID (`ceremony.ts:1724`). KW does not meet this rule; the same mismatch exists on `issue` (docs/04 section 10, VRC-ISS-018). |
| `proofPurpose` pinned (`authentication` for operational documents) | KW uses the default `assertionMethod` for the share (`documentProof.ts:412`) |
| Receipt signed, verifying under the request's `recipient` | KW sends the receipt unsigned |
| Terminal evidence proof verifies under the initiating document's `recipient` | KW verifies under `terminal.issuer` |
| Closed payload | already in the spec object |

Tier 2 rows are suite assertions (`profile:attested`), not statements about what KW does.

## 7. Ordering relative to issue and session

Within one witnessed exchange, KW's sender produces this order (`ceremony.ts:1356-1450`):

1. `witness/session` and `witness/session/submit` with the witness (nested threads, `parentThreadId` = the exchange id, `witnessCeremony.ts:324-333, 377-386`);
2. `witness-share` to the counterparty;
3. `vrc/relationships/issue` to the counterparty.

The share is sent from inside the delivery routine, after the witness session completes and before the issue document is built and sent. This matches the registry's `vrc/relationships/issue` text, which says that each party's session completes before the deliveries (the share is not an issue delivery, so that text does not itself order the share against the issue).

KW's receiver does not enforce any order: the share handler does not require that an `issue` from the same sender has been received or sent, and the issue handler does not require a prior share. Because the two parties run the sequence independently, a share can arrive before, between or after the counterparty's own issue.

Open question O7 (docs/07): whether the specification should require the share to follow the session and precede the issue, to follow the issue, or to be unordered. The reference implementation sends share-then-issue but does not determine a rule, so this profile makes none: receivers MUST accept the share whenever the section 4 checks pass and an accepted exchange exists, regardless of whether an `issue` has been exchanged. Vector WSH-001 asserts the sequence session, share, issue only as the IUT-initiated happy path of one implementation, with a CLARIFY tag on any assertion about the order.

## 8. Duplicate and idempotency behaviour

Framework layer. KW consumes every document with `notConsequentialChecks()` plus a 5 minute freshness skew, and no duplicate record and no acceptance window (`services/TrustTasksService.ts:81-84`). So KW does not detect a repeated `id`, does not return `idConflict` for a repeated `id` with different content, and does not absorb an identical resend at the framework level. The framework rule (7.2 item 11, keyed on `id`) would apply to a consequential task; whether `witness-share` is consequential for the framework's purposes is not determined by the reference implementation. The suite applies item 11 to this task as a profile rule (`DUP-*`), and KW is expected to fail those vectors (docs/05 K2).

Application layer (what KW does determine):

- **Receiver, identical credential**: if a stored credential has the same digest as the shared VWC (compared with `digestMultibase` over every credential in the wallet), the VWC is not stored a second time, and the receipt is still returned (`ceremony.ts:1820-1840`, test `witnessShare.test.ts:303-316`). A redelivery of the same VWC therefore yields a second identical receipt and one stored credential. This comparison is over the whole credential store, not only previously shared credentials.
- **Receiver, same thread, different VWC**: the second share is processed on its merits and stored if valid. KW has no "one share per direction per thread" rule on the receive side. Whether a receiver must refuse it is not determined by the reference implementation.
- **Sender**: sends at most one share per issuer and thread (`priorForExchange`, `ceremony.ts:1706-1712`); a concurrent duplicate delivery trigger is ignored by an in-memory guard (`inFlightVrcDeliveries`, `ceremony.ts:1272-1301`), and an already-issued exchange returns before the share is attempted (`ceremony.ts:1316-1321`). The guard is per process and per run; after a restart the retained-document check is the only protection.
- **Receipt**: the receipt for a redelivered share names the same digest.

Profile rule on duplicates, derived from the framework and the application behaviour above: a receiver SHOULD be idempotent on the credential digest (one stored credential, a receipt each time); duplicate `id` handling follows framework 7.2 item 11. The case "same `id` after the first share was refused" is the open clarification already recorded for DUP-009.

## 9. Evidence stored

By KW as receiver:

| Artefact | Stored | Source |
|---|---|---|
| The share request, verbatim, role `request` (this contains the presentation and the evidence pair) | yes, every inbound document, including one later refused | `services/TrustTasksService.ts:116-118` |
| The receipt or error reply, verbatim, role `response` (receipt) or `error` | receipt: yes; error: whether the outbound error is retained is not determined by the reference implementation (the retain call covers only a handled outcome's response) | `services/TrustTasksService.ts:119-121` |
| The VWC | as a W3C credential record, tagged `WITNESS_VERIFIED_TAG = true`, only after all checks pass | `ceremony.ts:1829-1835` |
| The presentation and evidence pair as separate records | no; they remain only inside the retained request document | not stored separately |

By KW as sender: the share request is retained before sending (`ceremony.ts:1725`) and later matched against the receipt (`ceremony.ts:1885-1894`). The evidence pair itself is the session `request` and the submit `#response` retained during the witness session, found by session id; the terminal is the latest `#response` on that thread (`services/TrustTaskDocumentRepository.ts:36-50`, `witnessCeremony.ts:334, 388`).

Retention period and deletion are not determined by the reference implementation. The registry's `witness/session` 0.2 declares its documents `durable` for the life of the credential because a verifier cannot recompute the task digest without the initiating document; a receiver that stores only the credential and discards the pair cannot show the pairing later. This profile therefore treats retaining the pair verbatim as the expected behaviour for a receiver that wants to re-evidence the credential (profile; KW keeps it only inside the retained request).

Observable by the harness: the stored credential count and the receipt digest, which equals the digest of the VWC as stored. Receipt-by-read-back is the check; the digest in the request is never trusted.

## 10. Exposure, side effects

Side effects: mutating (a stored credential). Exposure classification (what the share discloses and to whom) is not determined by the reference implementation. The task delivers a credential naming the two relationship DIDs to the counterparty that is already a party to them, and the witness session documents, which name the witness; no further classification is asserted here.

## 11. Conformance vector outline

Ids WSH-001 to WSH-012 are the design ids (docs/04 section 11); the mapping of design items to numbers below is this profile's, since the design lists the items without numbering them individually. WSH-013 onward are additions this profile proposes. The implementation under test is the receiving party (the harness sends the share). Tier 1 = framework MUST or a rule in this profile's request or response spec; Tier 2 = `profile:attested`. "KW expected" is the outcome predicted from the code read, not a run.

| Id | Case | Tier | Expected | KW expected | Basis |
|---|---|---|---|---|---|
| WSH-001 | happy path: a conforming bundle (VP challenge = thread id, domain `vrc:witness-share`, evidence pair paired, subject and parties correct) is stored and receipted; receipt digest equals digest of the stored VWC read back | 2 `profile-witness-share` | success `#response`, one credential stored | pass | section 4, 5.1; `witnessShare.test.ts:230-246` |
| WSH-002 | VP challenge differs from the share's `threadId` (replay across exchanges) | 2 `profile-witness-share` | `notAccepted`, nothing stored | pass (VP verification with expected challenge) | section 4 step 4.1; `ceremony.ts:1781` |
| WSH-003 | VP domain is not `vrc:witness-share` | 2 `profile-witness-share` | `notAccepted`, nothing stored | pass | `ceremony.ts:1791` |
| WSH-004 | VWC subject is not the sender's relationship DID (own VWC bounced back) | 2 `profile-witness-share` | `notAccepted` | pass | `ceremony.ts:1807-1811`; test `:248-264` |
| WSH-005 | parties do not name both relationship DIDs (from the VWC subject, or from the cited session document for the newer credential shape) | 2 `profile-witness-share` | `notAccepted` | pass | `ceremony.ts:1812-1818`; test `:412-431` |
| WSH-006 | foreign terminal: terminal `threadId` does not pair with the initiating document (and a terminal that is an error response) | 1 | `notAccepted` | pass | `outcomeEvidence.ts:274-283`; test `:266-283` |
| WSH-007 | task digest does not reproduce over the initiating document (initiating altered; or citation altered) | 1 | `notAccepted` | pass | `outcomeEvidence.ts:270-273`; tests `:285-301`, `:433` onward |
| WSH-008 | terminal signed by a non-recipient: a valid proof whose signer is the terminal's `issuer` but not the initiating document's `recipient` | 1 (framework 4.9.4 item 4) | `notAccepted` | FAIL (KW verifies under `terminal.issuer`) -> KNOWN-FAIL | section 4 "not made" list |
| WSH-009 | wrong terminal type: a non-error `#response` of a type other than the one the initiating specification declares | 1 (framework 4.9.4 item 3) | `notAccepted` | FAIL (accepts any non-error `#response`) -> KNOWN-FAIL | section 4 "not made" list |
| WSH-010 | stripped proof: terminal with its `proof` removed | 1 | `notAccepted` | pass | `outcomeEvidence.ts:284-285` |
| WSH-011 | decoded-bytes compare: `taskDigestMultibase` in a different multibase encoding of the same digest (`u` instead of `z`) is accepted | 1 | success | pass for equality (bytes compared; whether the surrounding schema and VWC path accept it is untested) | `documentProof.ts:78-89`; framework 4.9.3 |
| WSH-012 | unknown multihash: a digest with an algorithm the verifier does not implement | 1 | not treated as evidencing completion; `notAccepted` | not determined by the reference implementation (decoded bytes simply compare unequal) | section 5.1 |
| WSH-013 | unsolicited share: no accepted relationship exchange with the sender | 2 `profile-witness-share` | `notAccepted` (not `proofInvalid`) | pass | `ceremony.ts:1771-1775`, 6.1 |
| WSH-014 | request proof missing | 1 | `proofRequired` | expected pass (spec object) | `witnessShareSpec.ts:31` |
| WSH-015 | request proof signed by a key that is not the sender's relationship DID | 1 | `proofInvalid` | pass when a relationship record exists | `ceremony.ts:1467-1481` |
| WSH-016 | unknown payload member, or missing `presentation` or either evidence member | 1 | `malformedRequest` | pass (closed schema) | `witnessShareSpec.ts:40-58` |
| WSH-017 | redelivery of an identical share: one stored credential, receipt each time with the same digest | 2 `profile-witness-share` | success, no second credential | pass | `ceremony.ts:1820-1840`; test `:303-316` |
| WSH-018 | same `id`, changed content | 1 (framework item 11) | `idConflict` | FAIL (no duplicate record) -> KNOWN-FAIL | section 8 |
| WSH-019 | share arrives before the counterparty's `issue` / after it | CLARIFY (O7) | accepted in both orders | accepted (no order enforced) | section 7 |
| WSH-020 | receipt signed and verifying under the request's `recipient` | 2 | signed receipt | FAIL (unsigned) -> KNOWN-FAIL | section 6.3 |
| WSH-021 | envelope proof under the connection DID (issuer = signer = sender) | 2 | accepted; relationship-DID-signed envelope refused | FAIL for the sender side -> KNOWN-FAIL | section 6.3 |

A negative vector is accepted only when shown to fail a named mutant (design principle, docs/04 section 9).

## 12. Not determined by the reference implementation (summary)

- Whether `expiresAt`, `parentThreadId` or `ext` on the envelope may be accepted or refused.
- Whether the share's `threadId` must equal an accepted `propose` id.
- Whether a second, different share on the same thread must be refused.
- What a sender must do on a receipt-digest mismatch.
- Behaviour on an unknown multihash algorithm.
- Retained-error behaviour for refused shares.
- Retention period of the evidence pair on the receiver.
- Exposure classification.
- The ordering of the share relative to `issue` (O7).
- Whether other VP cryptosuites than `Ed25519Signature2018` must be accepted.
- Whether this task is consequential for the framework's duplicate rule.
