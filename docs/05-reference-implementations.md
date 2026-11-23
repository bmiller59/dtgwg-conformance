# Reference implementations: the models to emulate, and where each measurably differs

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

**Read this first.** This document is a **best-effort reading of source code**, except section 2.3, which holds measured results of the keyring-wallet adapter. No live peer was involved. Statements carry a confidence mark. Both implementations are actively developed and may already differ from what is described. **Each maintainer should review their own section before this document is shared outside the project.** Findings are stated factually and cite code so they can be checked or refuted; they are not a verdict on either project.

## 0. Why these two, and what "model" means

The suite uses two existing implementations as the models that new implementations are brought up to:

- **VTI**, the Verifiable Trust Infrastructure (Rust): the server side, with a trust agent (VTA) and a community service (VTC). Strongest on the framework's consumer pipeline.
- **keyring-wallet** (TypeScript, React Native): an independent wallet client and peer, the only one of the three that already speaks the VRC issue and witness-share ceremonies on the wire.

"Model" means: where the suite needs a concrete behaviour that the specifications leave open or state loosely, the suite looks first at how these two behave when they agree, then at the specification. It does **not** mean "whatever they do is correct". Where either accepts something the specification refuses, the suite encodes the specification's behaviour and records the implementation as KNOWN-FAIL (document 04, section 8). Where the two disagree, the suite flags the item and asks the specification (CLARIFY).

| | VTI | keyring-wallet |
|---|---|---|
| Commit examined | `62ce9ca22` | `d0e4e770`; trust-task code is in its `bifold` submodule at `a9babcf13` |
| Date examined | 2026-11-12 | 2026-11-12 |
| Method | read of a snapshot of `main`; no build or run | read of a snapshot of `main`, plus the submodule at its pinned commit; no build or run |
| Role in the suite | reference for framework, approvers, vetting, membership | reference for VRC propose, issue, witness-share, task digests and outcome evidence |

Confidence marks: **H** = the code path was read directly; **M** = taken from reading notes of a neighbouring path or earlier pass, not re-read for this document; **L** = inference. Line numbers refer to the examined commits and drift; where a symbol name is given, prefer it.

## 1. VTI

### 1.1 Behaviour the suite treats as the model (H unless marked)

| Behaviour | Where (VTI repo) | Spec basis |
|---|---|---|
| One ordered consumer pipeline, a single `now` for every temporal decision: size gate; parse, keeping the received JSON for verification; freshness; expiry and recipient; the task spec's declared policy (proof, recipient, `issuedAt` REQUIRED); proof; sender binding; admission; duplicate claim; dispatch; sign; settle | `vti-trust-task-server/src/spine.rs` (`Spine::receive`) | framework 7.2 |
| Proof verified over the received bytes, never a re-serialisation; present-and-failing proof is always fatal; issuer must equal the proven signer | `spine.rs`, `verify.rs` | 4.7, 7.2 items 7 |
| Sender binding on authenticated transports: a document must carry a proof, and `issuer` must equal the transport sender | `spine.rs` (DIDComm, TSP) | 4.8.1, 7.2 item 6 |
| Durable duplicate record keyed by `id`, digest compared over RFC 8785 canonical form; claimed after proof (so an unauthenticated sender cannot burn another sender's ids), before dispatch; fails closed (`unavailable`); a duplicate is never an error (recorded response 200, in flight 202, no recorded body 204) | `vti-trust-task-server/src/accepted.rs`, `accepted_store.rs` | 7.2 item 11 |
| Freshness: future `issuedAt` and `expiresAt <= issuedAt` give `malformedRequest`, not `expired`; `expiresAt` clamped to a 30-day horizon | `vti-common/src/trust_task/acceptance.rs` | 7.2 item 13, "Bounding the record" |
| Every refusal is a signed `trust-task-error` (0.6) with bounded `details` (4096 bytes, 16 members), opaque internal-error messages, HTTP status a function of the code only; a duplicate is never `taskFailed`; an inbound error is not routed and is answered `unsupportedType` (measured, V21) | `reject.rs`, `sign.rs`, `http.rs` | 8.2 to 8.4, 12.6 |
| Responses are signed with the service key; the service's advertised acceptance window is single-sourced with the enforced one so they cannot drift | `sign.rs`, `vti-common/src/trust_task/discovery.rs` | 7.3, 10.3 |
| Held operations are answered with `trust-task-next-step` and a poll task; the stored copy is executed past the pipeline and every check is re-run at execution; one decline closes the action for everyone; expiry decided lazily plus a sweeper | `vtc-service/src/admin_actions/mod.rs`; `vtc-service/src/trust_tasks/helpers.rs` | 7.2 item 12, 8.6 |
| Approver attestations signed `assertionMethod` by a key the signer lists under `assertionMethod`; delegated keys never approve; operational documents and every `#response` use `authentication` | `vta-sdk/src/trust_task_sign.rs`; verifier with an approval hook in `vti-trust-task-server/src/verify.rs` | 4.7.3 |
| Documented lifecycle mapping (which framework state occurs where) | `vta-service/src/trust_tasks/mod.rs`, `mod lifecycle_mapping` | 4.12 |
| Tests that serve as fixtures: pipeline tests (stale, missing `issuedAt`, wrong recipient, missing/tampered proof, duplicate answered with first result, refused dispatch releases its id, unsupported version names served versions, oversize refused before parse); a schema sweep that injects an unknown member and requires refusal (a non-vacuity mutant) | `vti-trust-task-server/tests/spine.rs`; `vta-service/src/trust_tasks/conformance.rs`, `vtc-service/src/trust_tasks/conformance.rs` | |
| Unsupported type versus version: the family served at another version gives `unsupportedVersion` with `details.servedVersions` | `reject.rs` | 5.2, 8.3 |

### 1.2 Specific caveats and differences

| # | Item | What the suite does | Handling (suite side) | Confidence |
|---|---|---|---|---|
| V1 | **`idempotencyKey`** top-level member (key-based deduplication across attempts, because its client mints a new `id` per attempt) | Treated as an extension: group IDK-* is profile `vti-ext`, optional capability, SKIP elsewhere, never core. The framework's stable-retry rule is the bit-identical same-document resend. | None to pass; keep the extension out of anything the suite calls core. | H |
| V2 | **Closed payloads** (generated types deny unknown members) | Tier 2 `attested` only (ENV-013). The framework leaves unknown payload members to each task specification. The adapter does not declare the carrier class `openPayload`, so DUP-103 (an extra payload member inside a duplicate comparison) is SKIP for it. | None. | H |
| V3 | **Acceptance window 10 min** (`VTI_ACCEPTANCE_WINDOW`) versus the profile pin of 5 min | The framework text sets no window numbers; 5 min max age, 60 s skew and 30 d horizon are the profile pins (the registry fixtures' defaults). The suite measures an implementation against the window it declares (`capabilities.window`, or `--window`), and the matrix reports the difference from the pins; the matrix always prints the declared window. The fixture rows that pin 5 min are the Tier 2 `profile-window` sub-group and are SKIP for a different window; no Tier 1 vector requires 5 min. | None for VTI: declare 10 min (600 / 60 / 2592000). Keep advertised and enforced values single-sourced (DIS-012 checks this). | H |
| V4 | **Hosts no `vrc/relationships/*`** (no VRC propose, issue or witness-share) | VRC groups require those types, so they are SKIP for VTI, not FAIL. Analogues exist (`vta/witness/{open,present,accept,list}/0.2`, `vtc/relationships/publish`) but are different tasks. | None; VTI is not asked to implement peer VRC. | H |
| V5 | **HTTPS paths** `POST /v1/trust-tasks` (VTC, VTN) and `POST /api/trust-tasks` (VTA), and no `Authorization` header, versus the binding's `POST /trust-tasks` and its authentication mapping | The adapter maps paths. BND-002 (the bearer maps to the transport identity) is stated by the binding, so a VTI that reads no bearer is a measured finding: one KNOWN-FAIL entry in `exceptions/exceptions.json` (implementation `verifiable-trust-infrastructure`, vector BND-002, owner `unassigned`, expiry 2026-12-15), for that implementation's row only; the reference adapter passes BND-002. The binding states the mapping (`bindings/https/0.3/spec.md:53`); the status table, which the binding states as a SHOULD, is the Tier 2 `attested` vector BND-007, and BND-004 keeps only the Content-Type MUST and the 200 case. | Recorded as a difference; maintainers may confirm against the binding. No change is requested. | M |
| V6 | **`issuedAt` required on every document**, including reads (stricter than framework 7.3 item 17, which requires it for consequential tasks) | Tier 1 requires it only where the task specification does. Tier 2 requires it everywhere, which VTI already does. Producers of tasks that leave it optional must still send it to VTI. | None. | H |
| V7 | **No `trust-task-control`**; `suspended` and `cancelled` unimplemented | Matches the specification: control is optional (framework 11.8) and `unsupportedType` is the expected refusal (LIF-003). | None. | H |
| V8 | **Auth and ACL refusals on the DIDComm path historically a DIDComm `problem-report`**, not a `trust-task-error` | Explicit transport-matrix exception; HTTPS vectors unaffected. | Recorded as a transport-matrix exception; no change is requested. | M |
| V9 | **Releasing a refused claim** (`Claim::release()` lets a corrected resend under the same `id` proceed) | DUP-009 (same `id` after a first attempt refused for its proof) and DUP-010 (same `id` from another issuer) are Tier 1 CLARIFY vectors, never gating; LIF-002 rests on the same point. The framework keys on `id` alone and records "at accept" (SPEC.md 7.2 item 11). VTI claims after proof, so an unauthenticated sender cannot squat an id. | None until the specification is clarified. | H |
| V10 | **`notFound`, `conflict`, `gone` carried as `taskFailed` plus `details.reason`**, because the framework has no such codes | Accepted as spec-compatible; the suite's closed `details.reason` vocabulary for ceremony failures follows the same pattern. | None. | H |
| V11 | **Pre-parse refusals are not signed** (size gate, rate-limit 429, unparseable body) | Outside the vectors; there is no trustworthy recipient to sign for. Tier 2 "every error signed" applies to refusals of parsed documents. | None. | H |
| V12 | **Duplicate-record lock is process-wide, not cross-replica** (documented limit) | Not testable through the black box; noted for operators. | Document the limit for multi-replica deployments. | M |
| V13 | **Two pipelines**: the shared crate (VTC, VTN) and an older, separate one in the VTA | The suite exercises whichever is deployed; divergence would show as different results per service. | Consider converging on the shared crate. | M |
| V14 | **Bearer-secret responses are not recorded** (a redelivery is answered 204) | Consistent with the framework (the response is not replayable). Tier 2 signed-response assertions skip documents with no body. | None. | H |
| V15 | **Discovery is answered to signed callers only** (`caller_is_identified`); an unsigned query gets `permissionDenied` | The discovery specification makes the request proof RECOMMENDED and does not oblige a responder to answer an unsigned query, so DIS-015 is CLARIFY. Signed discovery vectors run with a signed query. | None. | H |
| V16 | **No settable clock** (`Utc::now()` in the pipeline; no injection point) | The adapter declares `clockFree`. The runner uses rebase mode (real time is each vector's clock start); vectors that need exact, millisecond-boundary or multi-offset clock control are SKIP with a reason, never PASS. | None: handled suite side (docs/04 section 7). | H |

### 1.3 Predicted results (best effort, nothing executed)

Framework groups ENV, TIME, DUP, PRF, ID, RSP, ERR: pass (H), except: the `profile-window` rows of TIME and DUP, which are SKIP for a declared 10 minute window (V3, H); DUP-103, SKIP for a closed payload (V2, H); BND-002 (V5, M); ERR on DIDComm auth refusals (M). Tier 1 asserts no window number and VTI's differences are at most Tier 2 profile choices or CLARIFY: PRF-108, VRC-PRO-011 and DIS-015 (unsigned requests, V15) are CLARIFY. IDK: pass (extension). LIF-003: pass. VRC-*, WSH: SKIP. 2PC: not applicable (VTI does not run a 2PC boundary).

### 1.4 Measured against a live service

Measured 2026-11-14 against a running `vtc` from the buildathon kit pinned to VTI ref `26d0da81` (vtc-service 0.20.0), Tiers 1 and 2, over `POST /v1/trust-tasks`, carrier `notifications/notify/0.1`, adapter `src/adapters/vti/`; results in `<results dir>/runs/2026-11-14-vti-26d0da81/` (294 vectors) and `2026-11-14-26d0da81-rcpt/` (rerun on the 364-vector set: the same statuses, the 70 RCPT vectors SKIP); adapter setup in section 7. Nothing in VTI was changed. Vector-set sizes in this paragraph are historical (on the 294- and 364-vector sets, 2026-11-14; superseded); current figures for every VTI surface are generated in Coverage and on results/platforms/vti.md. Where this section and 1.3 differ, this section is the measurement and 1.3 the earlier reading.

| # | Measured | Handling |
|---|---|---|
| V17 | **A proof that is present and fails verification is answered `permissionDenied` (HTTP 403), not `proofInvalid`.** (`vti-trust-task-server/src/spine.rs:349-352` maps the verifier error through `reject.rs:59-61 and verify.rs:37`, Unauthorized to permissionDenied, so an anonymous caller cannot learn whether a DID resolves.) SPEC.md 7.2 item 7 (SPEC.md:1017) says `proofInvalid`. A proof that verifies under a key the issuer does not control is `proofInvalid` (`spine.rs:335`). | KNOWN-FAIL, owner unassigned, expiry 2026-12-15: PRF-101, PRF-102, PRF-104, ERR-006, ERR-007, BND-004, BND-007. Review before any change request. |
| V18 | **Discovery is 0.3 only at this ref** (`vtc-service/src/trust_tasks/discovery.rs`), answered to signed callers only (`caller_is_identified`, `discovery.rs:44`); 0.4 gets `unsupportedVersion` naming 0.3. The pattern grammar and response are the same in 0.3 and 0.4; 0.4 adds `expiryHorizonSeconds`. | The DIS vectors run against whichever version is declared (`$discovery`); DIS-013 (horizon) is SKIP; the answer states `acceptanceWindow` 600 s and 60 s (`discovery.acceptanceWindow` declared). DIS-015 stays CLARIFY and SKIP under `attested`. |
| V19 | **The HTTPS door authenticates no transport sender** (no `Authorization` read, `routes/trust_tasks.rs`). A spoofed `from` changes nothing. | BND-002 KNOWN-FAIL (the binding states the bearer mapping). ID-002 and the new ID-004 need the optional capability `transportIdentity`, which VTI does not declare: SKIP, since framework 7.2 item 6 applies only to an identity the transport authenticates. |
| V20 | **A POST to any path other than `/v1/trust-tasks` is 405, not 404**, because the VTC serves its website at every other path for GET, so the path exists for another method. | BND-001 accepts 404 or 405 for another path (the binding says "the appropriate status"). |
| V21 | **An inbound `trust-task-error` is answered**, with `unsupportedType` (error documents are not routed); 1.1 and V9's neighbours read this as "answered with nothing". | ERR-002, ERR-008 and LIF-001 stay CLARIFY (the specifications do not say an inbound error is answered with nothing); observed: fail. |
| V22 | **An unsigned document of a type VTI does not serve is refused `proofRequired`**, before the type is checked; a signed one is `unsupportedType` or `unsupportedVersion` (with `details.servedVersions`). | CTRL-004 became CLARIFY: no sentence makes the order of the 7.2 list normative. |
| V23 | **Any purpose its signer lists the key under is accepted**, and a did:key lists its key under every purpose (VTI-KEY-022), so a harness actor can sign operational documents with `assertionMethod`. SPEC.md:375 says the consumer checks the relationship the proof names. | PRF-103 (Tier 2 `attested` purpose pin) KNOWN-FAIL: a profile difference, not a specification violation. |
| V24 | **Rate limits**: documents from a signer with no ACL entry, and every unsigned or unverifiable document, share a per-address budget of 10 then one every 5 s (`routing/trust_task_admission.rs`). | The adapter waits out HTTP 429 (Retry-After) and resends the same bytes; the harness actors are seeded as `member` entries offline (`scripts/vti-seed-acl.ts`) so signed traffic uses the larger signer bucket. |
| V25 | **Duplicate record is durable across a restart** (DUP-006 passes with the container restarted, data volume kept). A refused claim is released (DUP-010 observed pass). | None. |

Not measurable on this service: the 31 verifyProof rows (no proof-verification entry on the wire; `proofVerify` not declared), the VRC, witness-share, task-consent, credential-exchange, 2PC and ceremony groups (types not served, no trigger surface), the 12 unsigned rows that run only against a non-attested server (PRF-108, DUP-101..109, DIS-015, VRC-PRO-011: the carrier requires a proof), and the clock-boundary rows (no settable clock; the TIME and DUP fixture rows that pin the 5 min window are SKIP for the declared 10 min window).

### 1.5 Measured in process (the VTA handlers)

Measured 2026-11-15 on the same ref, `vta-service` 0.72.0, by running VTI's own VTA code (the `MockVta` test-support constructor: router, dispatcher, handlers, signer) inside one process, adapter `src/adapters/vti-inprocess/`; results in `<results dir>/runs/2026-11-15-vti-inprocess-26d0da81/`. A second VTI row: the agent, not the community service. It reaches proof verification (VTI's own `verify_trust_task_proof_value`), the `credential-exchange/issue` handler and a bearer-authenticated sender, and cannot restart the service. Findings:

| # | Measured | Handling |
|---|---|---|
| V26 | **The agent answers a failed proof `proofInvalid`** (HTTP 422), unlike the community service (V17). Payload schema is checked before the proof (SPEC 7.2 item 2 before item 7), so a tamper step that adds a member to a closed payload gets `malformedRequest`. | PRF-101, PRF-102, PRF-104, ERR-006, ERR-007 pass; BND-004 and BND-007 step 5 are suite over-assertions, recorded as known-fail and reported. The vector review (results/vector-review.md) reads the same two vectors as class A on the community service (V17); both readings are kept and flagged there, and no vector was edited |
| V27 | **The door maps the bearer to the sender, and refuses a request with no bearer** (HTTP 401, not a framework error document). | `transportIdentity` and `binding.requireBearer` declared (BND-003 SKIP) |
| V28 | **An `identityMismatch` refusal is addressed to the in-band issuer**, not to the bearer-authenticated sender (the shared library routes it). | ID-002, ID-004, BND-002 known-fail; draft 01 |
| V29 | **The proof verifier accepts three fixtures the manifest says are invalid** (proof `@context` not a prefix, proof-only `@context`, a leap-second `created`) and refuses two it says are valid (single-string `@context`, future `expires`; the manifest lists these as rust-runtime gaps). | PRF-010, 011, 029 known-fail (draft 02); PRF-008, 019 known-fail |
| V30 | **`credential-exchange/issue`**: a cleartext credential is stored and acknowledged with an empty `#response` (a permitted courtesy acknowledgement); a sealed bundle is answered `malformedRequest`; a credential about another party is stored. | CEX-001 known-fail (suite over-assertion), CEX-004 (draft 03), CEX-010 profile difference |
| V31 | **A completed duplicate is re-signed**, same id and payload, new proof. | DUP-001, DUP-004, BND-005 known-fail at Tier 2 only |

Not offered by VTI (skip reason says so): the `vrc/relationships` tasks, witness-share, the receipt verifier, the ceremony-document family, two-phase issue and an inbound `task-consent/request`. Not reachable by this adapter: `credential-exchange/present` (served by the community service as the answer to a join query), restart, the claim-store fault hook and a settable clock.

The figures in this paragraph are historical (on the 391- and 384-vector sets, 2026-11-15; superseded by the final2 runs, whose figures are generated in Coverage and on results/platforms/vti.md). Final merge (391-vector set, `<results dir>/runs/2026-11-15-final-vti-inprocess/`, `...-final-vtc-inprocess/`, `...-final-vti-emit/`): VTA in process Tier 1 83 / 18 / 277 / 13 / 0 (114 run; PRF-002, PRF-004 and DUP-006 are new, the seven CEX-033 to 039 are SKIP), VTC in process (the live adapter against VTI's MockVtc) 73 / 18 / 287 / 13 / 0 (104 run), plain 135 and 149 run, emit 47 and emit-more 22 PASS. Re-run 2026-11-15 on the 384-vector set (`<results dir>/runs/2026-11-15-vti-inprocess-query/`, same host binary; Tier 1 80 / 18 / 273 / 13 / 0, 111 run): the agent is the holder of `credential-exchange/query` and `offer` 0.1. The adapter makes it hold a credential through its own `credential-exchange/issue` handler and counts deferrals with its own `credential-exchange/pending/list`. Query payload checks pass (CEX-019 to 021) and the offer schema passes (CEX-028). The query handler reads DCQL `meta.type_values` as a flat list of strings, so a type query in the DCQL form (an array of string arrays) gathers nothing and is answered `taskFailed` (`not_found`), where the text asks for a deferral with `consentRequired` (CEX-022), `noMatch` (CEX-023), or a deferral of an unsigned query (CEX-027); class A, one draft issue, not filed. An offer it cannot accept is declined `permissionDenied` when no holder identifier is configured (CEX-029, CLARIFY: the text is a SHOULD). Not offered: inbound `request` 0.1 (the agent sends it; the community service dispatches it), `task-consent/granted` 0.1 (sent only) and `decision` 0.1 (0.2 only). Not reachable honestly in process: pre-trusted verifiers (start-up configuration) and an approved presentation (pushed over a mediator).

## 2. keyring-wallet

Paths below are in the `bifold` submodule at `a9babcf13` under `packages/core/src/modules/trust-tasks/` unless stated, and are abbreviated as `tt/`.

### 2.1 Behaviour the suite treats as the model (H unless marked)

| Behaviour | Where | Spec basis |
|---|---|---|
| Accept path for **VRC issue**: proof verified under the counterparty's relationship identifier; an accepted proposal must exist for the sender (else `vrc/relationships/issue:notAccepted`); the credential's issuer equals the counterparty's relationship identifier and its subject equals ours; the credential's own proof verifies; only then is it stored | `tt/ceremony.ts` (issue handler, near lines 1498 to 1590) | `vrc/relationships/issue/0.1` conformance items |
| **Receipt computed, not copied**: the response digest is recomputed over the credential as stored; the issuing side correlates receipts by digest | `tt/ceremony.ts` (near 1596; `handleInboundIssueReceipt` near 1622 to 1665) | issue specification, issuing-party items |
| **Witness-share** accept path: outcome-evidence pairing (initiating `id` equals the credential's `taskContext`; recomputed digest equals `taskDigestMultibase`; terminal thread matches; terminal is a non-error `#response`; terminal proof verifies under the terminal's own `issuer`; the profile requires the declared terminal type and the initiating document's recipient as signer, see document 10 WSH-008 and WSH-009); presentation challenge equals the share's `threadId`; domain `vrc:witness-share`; subject equals the sender's relationship identifier; both parties named | `tt/ceremony.ts` (near 1782 to 1832) | framework 4.9.3, 4.9.4; `witness/session/0.2` |
| **Task digest** compared on decoded multihash bytes, not strings | `packages/trust-tasks/src/documentProof.ts` (`digestBytesEqual`, M) | 4.9.3 |
| **Whole-second timestamps** on emission (`wireTimestamp`) to avoid verifier failures on `.000Z` | `packages/trust-tasks/src/documentProof.ts` | 4.2 |
| Every inbound document and every response retained verbatim with its role, so outcome evidence can be supplied | `tt/services/TrustTasksService.ts` (`TrustTaskDocumentRecord`, near 119 to 125) | 4.9.4 |
| Receive path with schema, recipient, identity mismatch, proof policy and future-date checks via the registry's TypeScript `consumeInbound` | `tt/services/TrustTasksService.ts` (`KEYRING_CONSUME_CHECKS`) | 7.2 |
| Send side of membership requests signs with a purpose chosen per document type; approver attestation slugs use `assertionMethod` | `tt/module/proofPurpose.ts` (`purposeForDocumentType`) | 4.7.3 |

### 2.2 Specific caveats and differences

| # | Item | What the suite does | Action for keyring-wallet | Confidence |
|---|---|---|---|---|
| K1 | **Default proof policy is `acceptUnverified`** (`TrustTasksService.ts` near line 104). Only `issue` and `witness-share` install a verifier (`issueProofPolicy`, `ceremony.ts` near 1467). | Vectors expect proof failures to be refused everywhere a proof is present. Wherever the default applies, those vectors are expected to FAIL (KNOWN-FAIL with this reason). A verify path that, with no required purpose, falls back to the first signing verification method (`documentProof.ts` near 451) would also fail PRF-007..010; **not yet confirmed on the ceremony legs**. | Install a verifying policy as the module default; pass the required purpose on every verify. | H (policy); M (fallback) |
| K2 | **No duplicate-execution record and no acceptance window** (deliberate: an offline mailbox can deliver late; `TrustTasksService.ts` near 69 to 81; freshness skew 5 min versus the suite's 60 s) | The Tier 1 duplicate vectors (DUP-001 to 006 and the imported rows) and the declared-window stale vectors (TIME-101, 105) stay gating; DUP-007 and 008 are CLARIFY and the window-pinning TIME rows are Tier 2 `profile-window`. Recorded KNOWN-FAIL with the reason. The vectors are not weakened. Idempotence today is only by credential digest on store (`ceremony.ts` near 1578 to 1588) plus a sender-side query. | Add a digest record bounded by the framework's retention rule (`issuedAt` plus max age plus skew, clamped to the horizon) rather than a window counted from mailbox pickup; a late-delivered document is then `expired` rather than executed. | H |
| K3 | **Replies and errors are unsigned** (built by the registry runtime's `respondWith` / `rejectWith` and sent as is; `issuedAt` is `new Date().toISOString()`, so it can carry `.000Z`) | Tier 2 RSP-004/005 and signed-error vectors fail. Tier 1 reply shape is fine. | Sign replies and errors with the connection identifier's `authentication` key; emit whole-second timestamps. | H |
| K4 | **Ceremony request legs signed with `assertionMethod`** (the default purpose of `signDocumentProof`, `ceremony.ts` near 1447 and 1724; default at `documentProof.ts` near 224). Only the VTI client path chooses the purpose per type. | Tier 2 PRF-103 pins `authentication` for operational documents; KW fails it. Tier 1 accepts either listed purpose. | Pass the purpose from `purposeForDocumentType`. | H |
| K5 | **Envelope `issuer` is the connection identifier (`did:peer:4`) but the proof's verification method belongs to the relationship identifier** (`ceremony.ts` near 1438 to 1447). The receiver verifies under the expected counterparty relationship identifier, not under `issuer`. | **Settled for the suite:** envelope `issuer` and the proof are both under the connection identifier; the relationship identifier appears only inside the VRC's own inner proof. KW fails ID-003 and PRF-010 until changed (KNOWN-FAIL). | Sign with a key of the connection identifier; verify under `issuer`. | H |
| K6 | **Weak accept paths that must not be encoded as expected behaviour**: a silent hold on `propose` with no reply (the framework requires a `next-step`, with `continuation: resubmit` where there is no status task); vetting request, decline/error and statement paths; credentials delivered by a community accepted on type and subject only; a mismatching issue receipt only logged | Vectors expect refusals; KW is KNOWN-FAIL on those groups when they exist. | Per item, as vetting and membership groups arrive (document 04, roadmap). | M |
| K7 | **Witness-share is a KW-local specification** (`witnessShareSpec.ts`), not in the registry; its request proof is required, the response's is not; the sender silently skips after a 2 minute discovery wait | The suite bundles the share as a **suite-local profile specification** until a registry specification exists, and does not treat KW's behaviour as normative. The sender-side skip is not encoded. | Offer the specification upstream with the `vrc/*` batch. | H |
| K8 | **Unknown types are retained and logged, not answered** | ENV-010 requires `unsupportedType` / `unsupportedVersion` replies; KW fails it for a reply. | Answer with `trust-task-error` on unrecognised types. | M |
| K9 | **Discovery 0.1, unsigned**; a precondition KW enforces before sending | Suite discovery vectors target 0.4 (`acceptanceWindow`). Interop with KW needs a discovery answer first. | Move to a current discovery version; sign at Tier 2. | M |
| K10 | **Every inbound document is retained, including those rejected unauthenticated** | Not testable black box; a growth and abuse concern, not a vector. | Consider retaining refused bodies only after proof verification. | M |
| K11 | **ES256**: signs Ed25519 only; whether it verifies P-256 was not confirmed | ES256 (P-256) is a SHOULD in the framework (4.7.1): PRF-002 and PRF-004 are Tier 1 and SKIP if the cryptosuite is not declared; the P-384 proofs PRF-003 and PRF-005 are Tier 2 `profile-p384`, behind `cryptosuite:ecdsa-jcs-2019:P-384`. | Optional. | L |
| K12 | **Transport is DIDComm via the agent framework**, not HTTPS | An HTTPS carrier needs a thin adapter shim (document 04, section 4). | Supply the shim in the adapter, not the product. | M |

### 2.3 Measured results (logic over a shim carrier)

Source: `<results dir>/runs/2026-11-15-kw-shim-wider/` (the wider run, re-run after the vector review; the earlier `<results dir>/runs/2026-11-14-kw-shim/` is kept as a dated record) (adapter `src/adapters/keyring-wallet/`). The row measures keyring-wallet's trust-task code over a shim carrier (an in-memory stand-in for the DIDComm message sender and registry, with the process `Date` faked by the shim so the harness can set the clock); it does not exercise the real wire. Wallet runtime `@openvtc/trust-tasks` 0.28.1. The figures that follow are historical (on the 384- and 364-vector sets, 2026-11-15 and 2026-11-14; superseded by the final2 runs, whose figures are generated in Coverage and on results/platforms/keyring-wallet.md). The query run of 2026-11-15 (`<results dir>/runs/2026-11-15-kw-shim-query/`, 384 vectors): Tier 1 PASS 41, KNOWN-FAIL 93, CLARIFY 30, SKIP 220. Wider run of 2026-11-15 against the 364-vector set (reviewed state). Tier 1: PASS 39, KNOWN-FAIL 89, CLARIFY 28, SKIP 208 (70 of them the RCPT group: `receiptVerify` not declared), 8 advisories. The earlier run of 2026-11-14 was 35 / 22 / 230 / 77 (PASS / CLARIFY / SKIP / KNOWN-FAIL); the rows below describe the earlier run's reach and differences, and the wider run adds witness-share (the K5 proof-identifier rule applies there too), ID-002 and DUP-006. The vector review ([results/vector-review.md](../results/vector-review.md)) moved PRF-021, 027, 031 and 033 from KNOWN-FAIL to CLARIFY. No Tier 2 vector applies (attested is not claimed).

| Area | Result |
|---|---|
| ENV, ID, RSP, ERR (shape) | pass except: no answer to an unregistered or unsupported type (K8: ENV-006 to 010, ERR-004, LIF-003, CTRL-001 to 003; CTRL-004 is CLARIFY and observes the same silence); a message with no `id` is handled (runtime 0.28.1: ENV-003) |
| TIME | future and empty-interval pass; stale (TIME-101, 105) and calendar-invalid timestamps (TIME-023, 024) fail (K2, runtime 0.28.1) |
| DUP | DUP-001 to 005 fail (K2: no duplicate record); DUP-101 to 109 (sent with no authenticated sender) are unreachable on a DIDComm carriage and are recorded as a shim carrier limitation |
| PRF | the verifier accepts 17 fixtures marked invalid (expires, timestamp members, context, key validity); carrier-level proof failures (PRF-101, 102, 104, 105, ERR-006, 007) are executed under the default `acceptUnverified` policy (K1) and pass when the carrier installs the verifier |
| VRC-PRO | consent accept and decline pass (VRC-PRO-001 to 003); a held proposal gets no next-step (K6: VRC-PRO-008, 020, 021, NS-001 to 005); propose pipeline rejections are unanswered (VRC-PRO-004 to 006, 014, 015); the acceptance echoes `witnessed: true` (VRC-PRO-007) |
| VRC-ISS | the issue proof is verified under the relationship DID, not the issuer (K5): delivery is refused `proofInvalid`, so no credential is stored (VRC-ISS-001, 002, 007 to 012, 014 to 016, AUTHZ-001) |
| WSH, TD | reached in `<results dir>/runs/2026-11-15-kw-shim-wider/`: the envelope proof is checked under the relationship DID (K5) so 18 Tier 1 vectors stop at the first gate; WSH-014 to 016 pass; presentation signatures are checked by a stand-in because Credo reads `Ed25519Signature2018` only |
| CEX, query 0.1 | reached in `<results dir>/runs/2026-11-15-kw-shim-query/` through the wallet's own `handleInboundCredentialExchangeQuery` (credential store, prompt store and `respondToCredentialExchangeQuery`): a query naming no type finds nothing (CEX-021 pass), an unsigned query is deferred like a signed one (CEX-027 pass), an approved deferral is presented on the query's thread with its nonce (CEX-026, CLARIFY, expectations met). The wallet sends nothing at all for a malformed query (CEX-019, 020), for no match (CEX-023) or for a deferral (CEX-022, where the text says the verifier is told `consentRequired`); held and not held are therefore indistinguishable (CEX-024, CLARIFY). It has no pre-trusted verifiers (CEX-025 SKIP) |
| DIS, CER, 2PC, TC, other CEX, RCPT, BND | SKIP: not declared (discovery served is 0.1; the others, including `credential-exchange/offer` and `request` 0.1 and `task-consent/granted` and `decision` 0.1, are not served on the peer leg; no HTTPS surface) |

Plain-task and producer probes (2026-11-15, layer 3a, not core; docs/04 sections 11.7 and 11.8; figures historical, on the 543-vector plain and 183-vector emit sets, 2026-11-15; superseded, current figures in Coverage): VTI handlers in process on the 543 plain-task vectors, 112 ran: 89 PASS, 20 CLARIFY, 3 KNOWN-FAIL (PP-AUT-149, 261, 211, causes not determined), 431 SKIP (`<results dir>/runs/2026-11-15-plain-probe/`). keyring-wallet's own request builders through the producer class: 50 of 183 emit vectors ran (49 PASS, 1 FAIL: EM-PSH-004, the push-gateway registration carries no recipient or issuedAt) and 67 of 75 emit-more vectors ran, all PASS, including the 8 `vtc/join-requests` vectors the wallet emits (`<results dir>/runs/2026-11-15-kw-emit-more/`; re-run on the merged tree in `<results dir>/runs/2026-11-15-integration-keyring-wallet/`, identical). The reference adapter and VTI figures were re-run on the merged tree too (`<results dir>/runs/2026-11-15-integration-reference/`, `...-vti-inprocess/`, identical); the core set then had 361 vectors (CEX-033 to 039 were added at the final merge; current sizes by family and channel are generated in Vector families). Final-merge re-runs: `<results dir>/runs/2026-11-15-final-*` (every figure above reproduced; the plain run is 135 of 543 on the VTA after the vti-reach declarations, 112 before).

## 3. Differences between the two

| Topic | VTI | keyring-wallet |
|---|---|---|
| Duplicate record | durable, digest-keyed, claim then settle | none by design; digest idempotence on stored credential only |
| Acceptance window | 10 min, 60 s skew, 30 d horizon | no max age; 5 min skew |
| Proof default | verify; present-and-failing fatal | `acceptUnverified` unless a ceremony installs a verifier |
| Replies and errors | signed | unsigned |
| Purpose | `authentication` operational, `assertionMethod` for approvals, per type | `assertionMethod` default on ceremony legs |
| Signer versus issuer | issuer must equal proven signer | issuer is the connection identifier; signer is a relationship identifier |
| Unknown or unsupported type | explicit refusal with served versions | retained and logged |
| Holds | `trust-task-next-step` plus a poll task | silence while a person decides |
| Transport | HTTPS, DIDComm v2, TSP over one pipeline | DIDComm v2 and v1 via an agent framework, TSP |
| Task digests, outcome evidence | spec-driven (witness analogue) | implemented for witness-share, strong |
| VRC propose, issue, witness-share | not hosted | hosted (witness-share locally specified) |
| Control (cancel, suspend, resume) | not implemented | not applicable (client) |
| Idempotency extension | `idempotencyKey` | none |
| Relationship identifier per VRC | not hosted | one `did:peer:0` per counterparty connection, reused; the suite reports "differs" from per-VRC uniqueness, which the specifications do not require |

Where they agree on something beyond the specification, the suite still asks whether the specification says it (for example both refuse an `issue` with no accepted proposal because the issue specification says so).

## 4. Measured differences and how the suite handles them

Authority order: the specifications come first, the existing VTI implementation second ([decisions 43, 45 and 46](decisions/01-constraints-and-process.md#authority-order)). VTI is not asked to change: where it differs from a vector, the suite reports a measured difference (SKIP, KNOWN-FAIL with owner `unassigned`, or a stated difference in the matrix), and any proposal to change or extend VTI is brought to the project owner for review before it is made. Tier is the lowest tier at which the item shows. "Confidence" is in the reading, not in the suite.

| Implementation | Difference | Shows today | Tier | Handling | Confidence |
|---|---|---|---|---|---|
| VTI | Max age 10 min; the window numbers are profile pins, not framework text | TIME, DUP-110 to 113 (the window rows) | 2 (`profile-window`) | Declared window (10 min) measured by the suite and always printed in the matrix; reported as a window difference; fixture rows that pin 5 min are SKIP | H |
| VTI | HTTPS path and no `Authorization` header, against the binding | BND-002 | 1 | Adapter maps paths; BND-002 (bearer mapping, stated by the binding) is a measured finding: KNOWN-FAIL, owner `unassigned`, expiry from [the expiry policy](../exceptions/expiry-policy.json), VTI row only | M |
| VTI | Closed payloads | ENV-013; DUP-103 | 2 (`attested`); DUP-103 is SKIP | No `openPayload` carrier class is declared | H |
| VTI | Releases a refused duplicate claim | DUP-009, DUP-010, LIF-002 | 1 (CLARIFY) | The framework is silent: CLARIFY, not gating | H |
| VTI | Unsigned requests refused except for public tasks | PRF-108, VRC-PRO-011 | 1 (CLARIFY) | Acceptance of an unsigned request is consumer policy: CLARIFY, not gating | H |
| VTI | DIDComm auth refusals as `problem-report` | ERR on DIDComm | 1 | Transport-matrix exception, recorded as a difference | M |
| VTI | Discovery answered to signed callers only | DIS-015 | 1 (CLARIFY) | The specification does not oblige an answer to an unsigned query: CLARIFY, not gating | H |
| VTI | No settable clock | TIME, DUP, ceremony vectors that need clock control | 1 | `clockFree` and rebase mode: those vectors are SKIP with a reason, never PASS | H |
| VTI | (none for VRC, which is SKIP) | | | | H |
| keyring-wallet | Duplicate record plus retention rule | DUP-001..008; TIME-101, 105 (stale) | 1 | KW adds | H |
| keyring-wallet | Default verifying proof policy; pass required purpose | PRF-007..010 where default applies | 1 | KW changes | H (policy) / M (fallback) |
| keyring-wallet | Answer unrecognised types | ENV-010 | 1 | KW adds | M |
| keyring-wallet | Sign replies and errors; whole-second `issuedAt` | RSP-004/005, ERR signed | 2 | KW adds | H |
| keyring-wallet | `authentication` purpose on operational legs | PRF-103 | 2 (`attested`) | KW changes | H |
| keyring-wallet | Envelope issuer and proof under the connection identifier | ID-003, PRF-010 | 2 (PRF-010 at 1) | KW changes | H |
| keyring-wallet | Receipts and propose answers signed; holds answered with `next-step` (`continuation: resubmit` where there is no status task) | VRC-PRO/ISS Tier 2 | 2 | KW adds | H |
| keyring-wallet | Specify witness-share upstream | WSH-001 to 005, 013, 017, 025 | 2 (`profile-witness-share`) | joint | H |
| keyring-wallet | Vetting and membership weak accept paths | future groups | 1 | KW changes | M |

## 5. Interop gotchas (details in the suite's vectors)

Each is a place where two correct-looking implementations disagree.

1. **Whole-second timestamps.** Emit RFC 3339 `Z` with no `.000`; some verifiers re-serialise through a date type and then fail the signature roughly one time in a thousand. Accept every spelling and verify over the received bytes (`fixtures/proof/eddsa-jcs-2022-timestamp-spellings*.json`). `proof.created` too.
2. **Sign with no proof key present.** JCS is presence-sensitive: a pre-existing `proof` member, even an empty one, changes the signed bytes. Sign the proof-less document. (Nested `proof` members inside `payload` are part of the document and are **not** removed when computing a task digest.)
3. **issuer == proof signer == transport sender.** Under the attested profile these are one identity; mixing a connection identifier and a relationship identifier breaks it (K5). The in-band `issuer` is authoritative (framework 4.8.1); the transport is a cross-check.
4. **Always set `recipient` on a signed document** unless the specification is a bearer specification (4.8.2, 7.2 item 8); it is what stops replay to another recipient.
5. **Receipts are recomputed, not copied.** Digest over the credential as stored, by the receiver.
6. **Task digest compare on decoded multihash bytes**; an unknown multihash is unverified, never a fallback to `id`.
7. **A `#response` carries no `inResponseTo` in the issue specification**; both deliveries share one thread, so correlate by credential digest plus the issuer and recipient pair.
8. **Error type by prefix.** Implementations emit different `trust-task-error` versions (0.3 and 0.6 observed); match on `https://trusttasks.org/spec/trust-task-error/`.
9. **No error loops.** An inbound error is terminal and answered with nothing.
10. **Discovery before a ceremony.** At least one implementation waits for a discovery answer (and skips after two minutes) before starting a VRC ceremony.
11. **Retries.** One client mints a new `id` per attempt and relies on `idempotencyKey`; another expects a bit-identical resend. The framework's rule is the latter.
12. **Window arithmetic is half-open** at `expiresAt` and at `issuedAt + maxAge + skew` (registry `freshness.json`, `item11-digest.json`).
13. **`did:peer:4` resolution** from the embedded document works offline; the registry's reference proof verifier handles only `did:key`, so verifiers for other methods are implementation-specific.

## 6. Recommended review

Before this document leaves the project: the VTI maintainers should review section 1 and the VTI rows of section 4; the keyring-wallet maintainers section 2 and their rows. Corrections should be recorded with a commit and a confidence mark, and any predicted result that turns out wrong should be fixed here first.

## 7. Measurement setup and other findings

How the adapters reach each platform, and findings that are not a vector result. The per-vector results are in sections 1.4, 1.5 and 2.3 and in results/platforms/.

**VTI, live community service.**

- The images are built from the starter kit's pinned VTI ref. The kit is run from a clean copy (`git archive HEAD`, then `npm ci`), so the kit checkout and VTI's own checkout are never modified.
- The carrier is `notifications/notify/0.1`: proof, recipient and `issuedAt` required, a closed payload, accepted from any signer. `handled` is derived from the wire (distinct carrier ids answered with `#response`), because the carrier's effect is deduplicated by notification id, which the harness cannot vary, and VTI's answer never says whether a notification was held.
- The adapter declares `attested` (the carrier requires a proof), `clockFree` (VTI reads `Utc::now()`), `https` only, `discovery.acceptanceWindow`, and `restart` when a compose directory is given.
- The harness actors are seeded as plain `member` ACL entries (`scripts/vti-seed-acl.ts`), only so that signed traffic uses the signer budget instead of the anonymous per-address budget (V24). This grants no authority the vectors rely on.
- Observed once and not reproduced: after about twelve hours idle the unauthenticated limiter answered `Retry-After: 128813`, and a restart of the VTC reset it.

**VTI, agent handlers in process.** The host crate (`src/adapters/vti-inprocess/`) builds against VTI's own lock file with the default features plus `test-support`, because VTI's services need the messaging features. It exposes bearer minting, VTI's own proof verifier and a credential count; the adapter reaches the agent's door over loopback HTTP.

**keyring-wallet.**

- A malformed, unmatched or deferred `credential-exchange/query` gets no reply. Held and not held are then indistinguishable to the verifier, as the query text asks, but the explicit sentence that a deferred query is answered `consentRequired` (CEX-022) is not met: a class A finding. CEX-019, 020 and 023 are class B: the error reply there is a framework SHOULD, and `noMatch` is expected but not required by the query text.
- Driven through its own builders as a producer, the wallet sends `push/register` 0.2 without `recipient` and `issuedAt` (one emit FAIL).

**truststackers.**

- The original repository is not reachable by the suite: it has no trust-task boundary, and the adapter exits at start-up ([docs/14 section 6](14-interoperability-tracking.md#6-truststackers-the-original-repository-not-reachable-by-the-suite)).
- Its proof package caps a UTC offset at 14:00, while the TF fixture and the registry runtime accept 23:59; the suite's copy follows the fixture. Not reported upstream (no outward contact).
- Its published proof package does not install beside runtime 0.29.0 under npm (peer range), which is why the suite has its own `did:key` signer and verifier.

**Ceremony receipts across the platforms.** None of keyring-wallet, VTI or truststackers records or verifies `trust-ceremony-receipt` documents, so group RCPT is SKIP for all three and only the reference verifier exercises it. keyring-wallet sends the `ceremony` member `{enactment, step}` in its shared-connect flow only; VTI carries the member through routed error responses and ships generated receipt types. The only verifier in the registry is the Rust crate `trust-tasks-ceremony` (a four-valued outcome); TypeScript and Go carry generated types only.
