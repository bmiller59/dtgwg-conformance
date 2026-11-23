# Plan: a conformance boundary for truststackers

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

> **Which truststackers.** This page plans a trust-task conformance boundary for truststackers. The suite measures the original truststackers where it is reachable and otherwise uses a clearly labelled stand-in. The original repository has no such boundary and is not reachable by the suite ([docs/14, section 6](14-interoperability-tracking.md#6-truststackers-the-original-repository-not-reachable-by-the-suite)).

A plan, not a commitment. It describes phases P0 to P11 (section 5); none of it is part of this repository.

**Reading basis.** Truststackers is the third implementation the suite is meant to serve (after the two models in [05-reference-implementations.md](05-reference-implementations.md)). It runs ceremonies internally as two-phase commit over TSP and today has no document-level Trust Task surface. Code examined: `p2p-trust-stack` at `c3cf7b8`; `utility-server` (`3ccb855`) and `agent-app` (`29499ce`) are their own git repositories (branch `main`). `p2p-trust-stack` was 2 commits behind its upstream main (none touching migrations, transactions, DID or credential code). Line numbers refer to the examined tree and drift; symbol and file names are the stable references. Confidence: **H** read directly, **M** from earlier reading notes, **L** inference.

Path abbreviations (all repo-relative):

| Short | Path |
|---|---|
| `core/` | `p2p-trust-stack/packages/core/` |
| `app-api/` | `p2p-trust-stack/packages/app-api/` |
| `utility-server/` | `truststackers/utility-server/` |
| `agent-app/` | `truststackers/agent-app/` |

## 1. Target and success definition

**Claim (proposed, to be made only when the gates in section 8 pass):** Tier 1 (framework core) and Tier 2 (the `attested` profile) of the suite, for the benchmark ceremony **VRC issue and witness-share**, on the **HTTPS carrier**, with the **agent** as the implementation under test for the VRC groups and the **utility server** for the non-VRC carrier vectors.

Success means: the suite's reference adapter and the truststackers adapter both pass the vector groups below; no KNOWN-FAIL is carried by choice; the capability matrix lists truststackers with no unexplained cell. DIDComm is a later carrier (deferred until after P10). Groups beyond the benchmark are declared in `capabilities()` and appear in the matrix as they land.

Capability declaration (planned): `tierMax: 2`, `bindings: ["https"]`, supported types `vrc/relationships/propose/0.1`, `vrc/relationships/issue/0.1`, `vrc/relationships/witness-share/0.1` (suite-local profile specification), a `read`-class carrier task, and ceremony document types for the 2PC groups. Optional: `clock` yes, `restart` yes (durable claims), `idempotencyKey` no (SKIP), `control` no (answers `unsupportedType`, which the framework allows), `trigger.consent` yes. Cryptosuite claimed: `eddsa-jcs-2022` only (ES256 verification is a SHOULD; PRF-005 is reported SKIP).

## 2. Architecture, aligned to the layer model

Settled decisions (rationale in brackets):

- **A boundary adapter over HTTPS now, DIDComm later (deferred until after P10).** Ceremony documents (layers 3a to 3d, [01-layer-model.md](01-layer-model.md)) are carried by a new boundary in front of the existing machinery. [The suite is carrier neutral; no DIDComm code exists in any truststackers repo, so it is a later phase gated on a library choice.]
- **TSP two-phase commit stays internal (layer 2).** The boundary enlists operations on the existing coordinator and reads the outcome as a fact; it does not change the layer-2 protocol. [Keeps the existing, tested machinery; the suite only needs the lifecycle mapping in [04-suite-design.md](04-suite-design.md) section 12.]
- **The agent is the implementation under test, with an opt-in listener** (off by default, never on the UI port, which uses a cookie session). [VRC receipt happens on the agent; the utility server remains for non-VRC vectors.]
- **The pipeline lives in `core/` as pure code** shared by the agent and the utility server; the carrier and the handlers sit outside it.

```
carrier (HTTPS route | DIDComm later)     utility-server route (extended); agent listener (new)
        | raw bytes + carrier-authenticated sender (or none)
core/src/services/trust-tasks/boundary/    NEW, pure, transport-agnostic
   pipeline.ts   ordered consume (wraps the registry runtime's consumeInbound), claim, dispatch, sign, settle
   errors.ts  lifecycle.ts  accepted-store.ts  handlers.ts  proof/{sign,verify,resolver,purposes,digest}.ts
app-api/src/runtime/trust-tasks-boundary/  NEW, agent-side handlers (need agent keys and stores)
   vrc-propose.ts  vrc-issue.ts  witness-share.ts
        | enlist ops on the EXISTING coordinator: TransactionManager.run(tx => tx.enlist(participant, ops))
existing 2PC participants, unchanged semantics
```

Rules: handlers never touch a table directly; they enlist operations as existing callers do. Unchanged: the coordinator and wire protocol, participants' commit/abort semantics, the operation proof on `tx_prepare`, the ceremony driver, governance guard, the append-only `trust_tasks` repository (extended, not replaced).

### 2.1 Served document types (planned)

| Wire type | Handler | Class | Proof | Source of policy |
|---|---|---|---|---|
| `https://trusttasks.org/spec/vrc/relationships/propose/0.1` | `vrc-propose` | mutating, holds | Tier 1 optional; Tier 2 required | generated from the registry |
| `.../vrc/relationships/issue/0.1` | `vrc-issue` | consequential | REQUIRED; `issuedAt` REQUIRED | generated |
| `.../vrc/relationships/witness-share/0.1` | `witness-share` | consequential | REQUIRED | hand-written from the suite-local profile specification |
| `.../trust-task-discovery/0.4` | `discovery` | read | Tier 2 signed | generated |
| `trust-task-next-step`, `trust-task-control` | reply builders; control answered `unsupportedType` | | Tier 2 signed | generated |
| `task-consent/{request,decision}`, `credential-exchange/{issue,present}` | adapters over approvals and credential delivery | consequential | Tier 2 required | generated if present in the runtime, otherwise to verify |
| existing private evaluate task (read) | existing evaluator | non-consequential | optional | URN codec (section 2.3) |
| ceremony documents (founding, approvals) | `ceremony-doc` | consequential, holds | Tier 2 required | URN codec |
| anything else | | | | `unsupportedType` or `unsupportedVersion` with `details.servedVersions` |

HTTPS: `POST /trust-tasks`, `Content-Type: application/json`; the body is read raw so verification and digests run over the received bytes and the verbatim copy can be retained; replies are the exact bytes signed. Statuses follow the registry binding's code-to-status function; a duplicate is 200 with the prior response, 202 in flight, or 204 absorbed.

### 2.2 Mapping documents onto existing operations

| Document | Pre-checks in the adapter, before any enlist | Operation enlisted | Success reply |
|---|---|---|---|
| `propose` (peer to us) | pipeline; `relationshipDid` matches `^did:`; the relationship DID is new for this exchange: it differs from the sender's envelope `issuer` and from any DID already known as that sender's connection identifier (a profile-level check, not specification text: the specification only says "not a long-term identifier", so inequality is checkable but uniqueness to the relationship is not provable), and it is not already recorded as a counterparty relationship DID for another sender or exchange; upgrade-mismatch rule | none while held, which is answered with a signed `trust-task-next-step` (`expects` the originating propose type, `continuation: resubmit`, `inResponseTo` populated, same thread; a resubmission in that thread gets the outcome or a further next-step) rather than silence (the proposer's `relationshipDid` is recorded against the document `id` in the mapping table of section 3.10); on the human's accept, `acknowledgePeer` / `localUserAcknowledges` in the personhood ceremony (`core/src/relationship/ceremony.ts`; the RFI/RFA handshake auto-accepts and has no consent hook). Held state is "peer acked, local not" | `propose#response {accept, relationshipDid, witnessed}` (the agent mints its own relationship DID for this exchange before replying, P5c); decline is `trust-task-error` with extended code `vrc/relationships/propose:declined`. No decline operation exists today: it must be new (a durable decline flag plus a message), or the hold lapses through the ceremony staleness expiry |
| `issue` (peer to us) | an accepted proposal exists for the sender, else `vrc/relationships/issue:notAccepted`; credential issuer equals the counterparty relationship DID recorded for this exchange (thread), subject equals our relationship DID for it, and the envelope `issuer` and proof are under the counterparty's connection identifier (not the relationship DID); credential proof verifies; `vrcDigestMultibase` equals the digest of the credential; if the exchange already holds a VRC with a different digest, answer extended code `vrc/relationships/issue:alreadyIssued` (the rule is per exchange, since relationship DIDs are unique per VRC; a second exchange between the same parties is a new exchange and stores a new VRC) | `store_remote_vrc` on the VRC receive participant (idempotent by credential digest) | `issue#response {vrcDigestMultibase}` recomputed over the credential **as stored**, only after outcome `committed` and the row exists |
| `witness-share` | presentation challenge equals `threadId`; domain `vrc:witness-share`; subject equals sender's relationship identifier; both parties named; outcome-evidence pairing checks | new operation `store_witness_share` on a new participant | `#response {vwcDigestMultibase}` over the credential as stored |
| ceremony documents | pipeline; admin eligibility; idempotent duplicates | `ceremony_begin`, `ceremony_approve`, `ceremony_query`, `ceremony_reset` | begin gives `next-step`; committed gives `#response` |

The VRC receive participant stores whatever credential it is handed: neither it nor the storage function behind it (`core/src/vtc/store.ts`, `storeReceivedDtgVrc`) checks issuer, subject, proof or digest form (H, read). **The adapter's pre-checks are therefore the only gate on the boundary path.** Keep pre-checks as pure functions the participant can reuse, to avoid two sources of truth; P6 adds a pure `checkVrc(vc, expectedIssuer, expectedSubject)` built on the existing `verifyDtgProof` plus key resolution through `DidResolver`.

Further properties of the receive path. (1) Storage dedup is first-wins on the (issuer, subject) pair and silently skips a later different VRC, so a receipt is never issued over a credential other than the one stored (hence `alreadyIssued` above). (2) The stored digest is a raw SHA-256 hex of the JSON text, not the `vrcDigestMultibase` form; the receipt is computed on the stored bytes, which equal the received bytes. (3) The participant upserts a remote-supplied `issuerIdentity` into the local identities table; the boundary path must not pass it, or must validate it against the verified issuer.

**Relationship DIDs: unique per VRC exchanged.** The envelope `issuer` and the document proof use the connection identifier; the relationship DID is the VRC's issuer and subject party and signs the VRC's inner proof (`proofPurpose: assertionMethod`). Today the VRC issuer and subject are the two connection identifiers themselves (`core/src/relationship/vrc-mint.ts:124-125`), the claim repeats both, and `issuerScope` (REQUIRED by the credential specification) is not emitted: this is a conformance gap, closed by phase P5c (section 3.10). Specification basis: the issue specification requires the VRC's issuer and subject to be the relationship DIDs the proposal exchanged and the receiver to verify the credential proof and party bindings before storing; the propose specification requires a DID minted for the relationship and not a long-term identifier; the credential specification requires a `pairwise` identifier never to be used with a second counterparty and recommends a distinct identifier for each new relationship. "Unique per VRC" is stricter than "per relationship" and is a design decision of this effort; nothing normative states which key signs the inner proof or that the relationship DID must differ from the connection DID (those are profile rules). Scope and decisions: section 3.10, [section 12.3](#123-relationship-dids-phase-p5c) and [07-status-and-open-questions.md](07-status-and-open-questions.md) (O17 to O26).

### 2.3 Wire form of private types (settled)

Boundary-only URN codec for truststackers' private task types. The framework's URN form (section 6.1) is `urn:<NID>:<prefix>:spec:<slug-segments>:<MAJOR.MINOR>`, with `/` in the slug written `:`, so a form without the prefix is not valid. The form is `urn:p2pts:tasks:spec:<slug-segments>:<MAJOR.MINOR>` (the NID `p2pts`; the `tasks` prefix value is **proposed** and ours to choose; the NID is not IANA-registered, which the framework's grammar permits). A test runs the codec over every seeded private type and asserts the slug grammar; names with underscores, digit-first segments or uppercase must be renamed at the boundary. The error type is never minted privately.

## 3. Attestation design

### 3.1 Signing key (settled: reuse now, dedicated before production)

**Now:** responses are signed with the service's connection identifier's `#key-1` (listed under `authentication`), `proofPurpose: "authentication"`; envelope `issuer` is that identifier and equals the request's `recipient`. **The key differs by implementation.** For the utility server (Slot-A layout) `#key-1` is the permanent TSP key already installed for the operation proof. For an agent the connection DID is `did:scid:vh` in the Slot-B layout: `#key-1` is the rotating identity key, there is no `#key-scid`, and `assertionMethod` is `['#key-1']` too, so the purpose pin cannot separate authentication from assertion for an agent (it protects only against `keyAgreement`). Rotating the agent's identity key changes the TSP VID and invalidates recent signatures for latest-only resolvers. No new key, no new custody, and it matches the Tier 2 purpose pin. On the utility server the rotatable identity key (`#key-scid`, `assertionMethod`) is used only for approver attestations.

**Caveats of reuse.** One key then serves the TSP identity, the operation proof and document proofs. The framings are structurally disjoint (the operation proof signs a canonical JSON text beginning `{"actor":"`; a document proof signs two 32-byte hashes), so cross-use would need a hash preimage; that is a structural separation, not a domain tag. The TSP v3 signing bytes were read: raw Ed25519 over the binary CESR envelope (counter, version, two VID strings, payload), no domain tag, so a TSP message is far longer than 64 bytes. For agents all three protocols use the same key (`#key-1` = identity key). A test feeding each proof to the other verifier is planned. Rotating `#key-1` means a new TSP identifier, which is a larger event than a key roll.

**Settled: the dedicated key is `#key-boundary` under `authentication`** (built at library level in P11, behind a default-off gate; section 5, P11). **Design so the switch is cheap:** one `BoundarySigner` interface installed once and the only place that names a verification method; a verifier that resolves the key set valid at `proof.created`, not "now" (no such lookup exists in the examined code today); a cutover that adds a dedicated key (proposed id `#key-boundary`, `authentication`) before enabling it, accepts `#key-1` only for documents created before a cutover instant, and refuses `#key-1` afterwards. Retroactive acceptance matters for re-verifying stored documents and outcome evidence (30-day horizon, audit rows). This is gate G2.

**Switching to a dedicated key is real engineering work, not a configuration change (settled strategy; findings from reading the code, nothing run).**

- **Keep `#key-1` behind the `BoundarySigner` interface until the prerequisites below exist and the signer and verifier are wired into the processes.** Do not ship the cutover while any writer of the identity's document still rebuilds it without carrying earlier entries forward.
- **`did:peer:4`:** the identifier is a hash of the document and embeds it, so there is no update path (`core/src/did/numalgo4.ts`, `did-peer4-method.ts`: `supportsRotation = false`). A dedicated key goes into the **next provisioning, which means a new identifier** (appended after the existing keys, since some extractors read verification methods by index). Counterparties must then re-establish trust with the new identifier (introductions, relationship records, name and membership bindings that reference the old one). The old identifier keeps verifying forever.
- **`did:scid:vh`:** an in-place add (same identifier, same TSP key, no re-introduction) is possible in principle, because the in-repo chain validator constrains the key chain but not the rest of the document (`core/src/did/scid-vh-method.ts`, `validateChain`). It is **not** available today:
  Prerequisites 1 to 3 are built at library level in P11 (carry-forward `updateDocument`, time-pinned resolution over the validated log with an equal second resolving to the old key set, no cache-sourced resolution); 4 and 5 and the wiring remain.
  1. Existing writers (`ScidVhMethod.rotate()`, `core/src/did/speculative-rotation.ts`) rebuild the document from a builder and would silently drop a hand-added key at the next log entry; `rotate()` also appears to mishandle the two-slot key layout (it would put the identity key at `#key-1` and change the TSP identifier), and the speculative path drops the post-quantum keys. A new `updateDocument` that copies the previous document forward, appends the verification method, keeps self-commit key commitments legal and signs with the current identity key is required, with tests (chain validates; a later name claim keeps the key; resolution at the previous version lacks it; post-quantum keys retained).
  2. A **time-pinned verifier** is required and does not exist: the client resolver (`core/src/did/did-resolver.ts`) resolves the latest document only; the server resolver can pin by version or time. `createdAt` in a log entry and `proof.created` are both signer-asserted and can be backdated; no witness time anchor is stored by the examined server. Define a tie rule (entry times are whole seconds).
  3. The verifier must **refuse resolutions flagged as coming from the cache** (a fallback when no valid log is held), otherwise an unvalidated key set is trusted.
  4. The persisted log store drops the post-quantum signature of an entry; fix before relying on it for non-repudiation.
  5. Record the cutover instant only after the entry is resolvable at the public resolver; refresh any verifier caches.
- **The agent's connection identifier is `did:scid:vh` (settled):** the default agent class is the scid:vh agent and no caller passes another DID method. G2 for the agent therefore takes the `did:scid:vh` path (in-place add after a carry-forward `updateDocument` and a time-pinned verifier), not the `did:peer:4` next-provisioning path. The agent's boundary key becomes a new dedicated key (settled), not the rotating identity key. (The `did:peer:4` agent class exists but nothing selects it; treat as test/legacy.)
- Open items on the `did:scid:vh` path (metadata-only log entry conformance, document-promotion behaviour) are listed in [07-status-and-open-questions.md](07-status-and-open-questions.md) section 4.

Relationship identifier keys appear only inside the VRC's inner proof; the boundary does not sign with them (section 3.10). The inner proof key is independent of G2: G2 concerns only the connection identifier's document-signing key. The server serves the by-DID rotation-log route, but the agent's own resolver reads only its local database (see P4).

### 3.2 Proof-only sender authentication (settled, staged behind a flag)

On the document surface the sender is established solely by the verified proof (`issuer` equals the verification method's identifier; key listed for the purpose), plus recipient binding and the duplicate record. Session cookies and bearer tokens stay for UI routes only. [Removes a second authentication path and makes responses verifiable end to end.] Staging: first verify proofs with the cookie accepted as a cross-check only (a mismatch is `identityMismatch`); then a one-release flag `TRUST_TASKS_PROOF_ONLY`, default on for the new agent listener, and for the utility-server route after a re-grep of callers. Requirements: DID resolution for `did:peer:4` (offline from the embedded document) and `did:scid:vh` (cached, timeout, rate-limited before resolve; failure is `unavailable`, not `proofInvalid`); listener identity for recipient binding; the replay record, which becomes the sole replay defence for consequential tasks and so must fail closed and survive restart; key rotation handled by the key-set-at-created lookup. **Pre-build gate G1: passed, with conditions.** Read in the framework (section 4.8.1) and the HTTPS binding 0.3: proof-only without transport authentication is permitted for consequential tasks; the in-band identity is authoritative and the transport is only a cross-check, and the binding forbids omitting `proof` rather than requiring a transport credential. Conditions: (a) the consequential specs declare `proof` REQUIRED (the registry `issue` policy does; `witness-share` is ours to write), a missing proof being `proofRequired`; (b) `recipient` is in-band and equals one of our identifiers, else `malformedRequest` or `wrongRecipient`; (c) proof is not authorization, so every handler authorizes from the verified `issuer` (AUTHZ-001), never from document claims; (d) the existing route's `401 proof/unattributable` rule (a proof with an unauthenticated issuer) is exactly what proof-only removes, and its `401` is outside the binding's mapping (`422 proofInvalid` or `identityMismatch`). The cookie stays a cross-check only (local policy). Without a transport sender, an `identityMismatch` error goes to the in-band `issuer`. The replay record is the only replay defence. Version note: the binding targets framework 0.5.0 and the framework draft is 0.7.0, so the pin below (0.6.0) matches neither exactly; re-confirm when pins are revisited.

### 3.3 Verification and library (settled: adopt, with two own modules)

Adopt the registry's TypeScript runtime (`@openvtc/trust-tasks`, pinned to `0.29.0`) for the consume pipeline, freshness, duplicate-record interface, canonical JSON, digests, error builders and the generated policies for `vrc/relationships/{propose,issue}`. [Public registry types are served; hand-rolled canonicalisation and timestamp code is where the bugs are (the registry's timestamp fixtures); the suite's reference adapter uses the same runtime, so a divergence is a real finding.] Write our own: (1) a DID-resolving verifier and signer: the registry's proof package handles only `did:key` and refuses an issuer that is not the signer's `did:key`, while truststackers identifiers are `did:peer:4` and `did:scid:vh`; it implements the upstream verifier interface so the pipeline calls it unchanged, and runs the registry's proof fixtures plus our own; (2) the durable accepted-id store; (3) the share's specification policy. Pin exactly (the library is 0.29.x of a Working Draft), bump deliberately and rerun the suite. Licence: Apache-2.0 for code. Single import site so a vendoring fallback is a one-file change.

Verification order mirrors the model implementation: size cap, parse, envelope, type and version, freshness (one clock), expiry and recipient, spec rules (proof and `issuedAt` required), **proof verify**, transport-sender cross-check, admission and authorisation, **claim**, payload schema, handler, sign, settle. The claim comes after the proof so an unauthenticated flood cannot burn another sender's ids. Payload validation sits after proof and before claim (a deliberate difference from the model so malformed documents are never claimed). Key resolution requires the verification method's identifier to equal `issuer` exactly and the fragment to be listed under the relationship matching `proofPurpose` (closing the "first signing key" fallback seen in another implementation).

Purposes (single source with a drift test): Tier 1 accepts `authentication` and `assertionMethod`, refuses `keyAgreement`, absent or unrecognised; Tier 2 pins `authentication` for every operational document and `assertionMethod` only for the approver attestation slugs.

### 3.4 Digests, receipts, outcome evidence

`taskDigest` is the multibase base58btc multihash SHA-256 of the canonical document without its top-level proof, compared on decoded bytes, unknown multihash unverified. `documentDigest` (including proof) is used only for duplicate-conflict detection. Receipts (`vrcDigestMultibase`, `vwcDigestMultibase`) are computed from the stored credential and signed under the service identifier. For witness-share the verbatim initiating and terminal documents are stored and the pairing checks run before storing; the terminal's proof must verify under the initiating document's recipient. For VRC issue, evidence is the signed receipt plus observable stored state (settled; spec-grade evidence only for witness/session).

### 3.5 Duplicate record (fail closed)

Implement the registry runtime's replay-guard interface over the data source (SQLite in core and the agent, a distributed SQL database in the utility server). Insert-if-absent is available on both dialects, but the repository's portability rule (utility-server `session-store.ts`) avoids `INSERT OR IGNORE` and `ON CONFLICT`: use a plain insert and catch the primary-key violation, with expired-row replacement as delete plus insert inside `db.transaction`. Name the primary key column `id` (the distributed-database data source appends `RETURNING id` to plain inserts). Not exercised on a real distributed database. Caution: several utility-server participants use `INSERT OR REPLACE INTO tx_participant_state`, which Postgres-dialect databases reject; check which database holds those tables before placing the claim table beside them.

```sql
CREATE TABLE IF NOT EXISTS trust_task_accepted (
  id TEXT PRIMARY KEY, digest TEXT NOT NULL, issuer TEXT, type TEXT NOT NULL,
  thread_id TEXT, tx_id TEXT, state TEXT NOT NULL,   -- 'claimed' | 'completed'
  retain_until INTEGER NOT NULL, response TEXT,      -- signed response (NULL if secret)
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
```

Key is `id` alone (as the framework and the model implementation do). `claim`: absent or expired row inserts, `fresh`; same digest gives `duplicate` (with the prior response, or in flight); different digest gives `idConflict` (changed payload, recipient or re-signed proof). `retainUntil` = `expiresAt` if present else `issuedAt` + 5 min + 60 s, clamped to `issuedAt` + 30 days. A claim is released only on a `retryable: true` failure (settled). Each claim stores `tx_id`; on a duplicate, at boot and on an interval, a settle check asks the coordinator for the transaction outcome through a new additive accessor `TransactionManager.getOutcome(txId)` (none exists today; build it on `TransactionLog.hasDecision`/`last`; returns `committed`, `aborted`, `inFlight` or `unknown`; participant-side values are `unknown`, `prepared`, `committed`, `aborted`): committed completes and rebuilds the response; aborted releases per the rule above; unresolved keeps 202. A crash between claim and commit is the main residual risk.

### 3.6 Signed responses and errors

Every reply on an attested profile is signed, including `trust-task-error` and `next-step`: fresh `id`, `threadId` equal to the request's or its `id`, `issuer` the service identifier, `recipient` the transport sender when identity is contested else the request's `issuer`, whole-second `issuedAt`, `inResponseTo{typeUri,id}`; `details` bounded (4096 bytes, 16 members), messages from a fixed vocabulary. Refusals made before a trustworthy recipient exists (oversize, unparseable) return a minimal unsigned 4xx body, outside the vectors. An inbound error is answered with nothing.

### 3.7 Persistence and retention

Migration `0021_trust_task_boundary.sql` (additive, nullable; next free number is 0021 in both migration trees; the utility-server's server-only 0501 sorts after it, harmlessly; the relationship-DID mapping table of phase P5c is part of this same migration, so there is one version bump), with `SCHEMA_VERSION` bumped in both trees (currently 24 in core and 25 in the utility server; re-check at P3 time). A bumped version makes a downgraded binary refuse the database, so "revert code and leave the columns" is not free once the version is bumped. It adds to the `trust_tasks` table: verbatim `raw_document`, `digest`, `task_digest`, `issued_at`, `expires_at`, `in_reply_to`, `error_code`, `disposition`, `verified_signer`, `lifecycle`; the unused `proof` column starts to be written. **Retention (settled): do not store bodies refused before proof verification (counters and a hashed sender in the log only); store verbatim every document refused after verification and every accepted one.** The two-phase-commit transaction tables gain `error_code` and `retryable` through the existing additive-column mechanism.

### 3.8 Freshness

Windows set to the profile pins (skew 60 s, max age 5 min, horizon 30 d, half-open at `expiresAt`), declared in `capabilities.window` and read by the vectors as the effective window; future `issuedAt` and `expiresAt <= issuedAt` give `malformedRequest`. One injected clock used by the pipeline, the claim store, ceremony-deadline checks and the signer's timestamps (so replies are deterministic under the suite clock). Constants live only in a `pins.ts`. Producers emit whole-second timestamps; consumers accept all spellings. Pins: framework 0.6.0, `trust-task-error` 0.6, HTTPS binding 0.3, TSP binding 0.1, library `0.29.0`.

### 3.9 Lifecycle mapping (the seam)

As the table in [04-suite-design.md](04-suite-design.md) section 12. Specifics for truststackers: a closed `details.reason` vocabulary in one constant (`policyDenied`, `notAdmin`, `nameTaken`, `deadlineLapsed`, `alreadyCommitted`, `notAccepted`, `vcInvalid`, `outcomeEvidenceInvalid`, `notFound`, `storeFailed`, `notFoundOrNotPermitted`), table-tested; `notFound` and `permissionDenied` for an ineligible approver indistinguishable on the wire. Because a participant failure today is a log line plus a `no` vote, the boundary reads the abort reason from a bounded in-memory registry keyed by transaction id (participant catch blocks record it before voting `no`); for a remote participant the durable channel is the proposal's `error_code` and `retryable` returned by the existing query operation. Unknown reasons map to `internalError` with an opaque message.

### 3.10 Relationship DIDs (phase P5c)

Findings from reading the code: a context-scoped helper already exists and is unused (`DidManager.createRelationshipDid` in `core/src/services/did-manager.ts` creates a `did:peer:4` with a `did_documents` row of context type `relationship`; `IdentityResolver.registerRdid` wraps it; no production caller). It does not persist the secret key and the `keys.encrypted_secret_key` column stays empty. `did:peer:4` is self-resolving and has no rotation. The existing ceremony is keyed per connection pair (`relationships` unique on the pair; `vrc_ceremonies` one saga per pair) and exchanges no relationship DID: the `personhood_ack` operation carries only the connection DIDs.

Design (rationale in [section 12.3](#123-relationship-dids-phase-p5c)):

- **Method and keys:** `did:peer:4` with a signing key only (an X25519 key only if encryption is needed). Created without a transport service entry. Keys are generated for it alone: never derived from the identity seed, never reused as the TSP key, the operation-proof key or the connection document-signing key.
- **Creation:** a fresh relationship DID per VRC exchange, stored durably before it is sent in a `propose` or acceptance; creation rate-limited and capped per counterparty; never minted before the proposal passes the pipeline.
- **Key custody:** the per-VRC secret key is encrypted at rest under the agent's key hierarchy. The development-default passphrase constant used by the community-key path is never copied.
- **Mapping table:** a table in the application database, part of migration 0021 with P3 (one `SCHEMA_VERSION` bump), keyed by the `propose` document `id` (the thread id). Columns: both connection DIDs, both relationship DIDs, role, state. Unique on each relationship DID in both directions, so a counterparty reusing a relationship DID is refused. Each relationship DID maps to the root identity so the credentials table, graph and `(issuer, subject)` queries keep one node per peer.
- **Handshake and carrier:** specification-following VRCs are produced only through the boundary path at first: the relationship DID travels in `propose` and its acceptance. The internal TSP ceremony is untouched.
- **vrc-mint:** inputs are the exchange's two relationship DIDs; signed with the relationship DID's key under `assertionMethod`; `issuerScope: "pairwise"` added; the claim no longer repeats the connection DIDs; idempotency keyed on the exchange.
- **Second exchange:** a second exchange between the same parties is a new `propose` id and yields a new VRC. `issue:alreadyIssued` applies only to a resend within one exchange.
- **Receive and verify:** `checkVrc` takes issuer and subject from the exchange record; a `did:peer:4` inner proof verifies offline, so it needs no rotation-log source, and stored VRCs survive a later connection-DID key change. The remote-supplied `issuerIdentity` is not passed.
- **Archive:** the utility-server archive push for specification-following VRCs omits the connection identity record, so the server cannot map a relationship DID to a connection DID.
- **Lifecycle:** on relationship end, `teardownCeremony` also retires the exchange record, the secret key is deleted and the public document is retained (nothing further can be signed; stored VRCs still verify). No revoke verb exists yet. With a non-rotating method, compromise recovery is a new VRC under a new relationship DID.
- **Existing VRCs:** VRCs issued under connection identifiers are labelled legacy. There is no backfill and no forced re-issue.
- **Signing key and G2:** two independent key paths: the envelope proof under the connection DID via `BoundarySigner`, and the inner proof under the relationship DID's own key. The cross-protocol test of P4 gains the inner proof as a further framing.
- **Tests (same change):** two exchanges with one counterparty give distinct DIDs on both sides; DID never equals a connection identifier and carries no service entry; mapping durable before send, restart-safe, unique both ways; inner proof under `assertionMethod` with the relationship key, envelope proof under the connection key; `issuerScope` present and no connection DID in the claim; receive refuses wrong issuer, subject or reused DID; offline `did:peer:4` verification; teardown; migration applied to a populated database; graph keeps one node per peer. Existing ceremony, receive-store and inbox tests need new fixtures: `core/test/tx/vrc-ceremony.test.ts`, `core/test/vtc/store.test.ts`, `core/test/tx/inbox-dedup.test.ts`, `core/test/tx/coordinator-dispatch.test.ts`, `core/test/tx/ceremony-session-key.test.ts`, `core/test/relationship/ceremony-ack-view.test.ts`, `core/test/relationship/identity-key-heal.test.ts`, `app-api/test/agent/ceremony-event-receive.test.ts`.

Reference practice (not normative): the verifiable-trust-infrastructure holds the relationship DID's key in its agent and signs witness documents as the relationship DID, with a pairwise-scoped relationship credential; the keyring wallet mints one `did:peer:0` per counterparty connection and reuses it (so it is not per VRC) and signs the document proof under the relationship DID while the envelope `issuer` is the connection DID, which is why the connection-DID rule (docs/04 section 10) treats it as a known failure.

## 4. Gap table

Sizes: S at most 0.5 day, M 1 to 3 days, L more than 3. Refs are examined-tree files (confidence H unless noted).

| Vectors | Current behaviour | Change | Size | Risk |
|---|---|---|---|---|
| ENV-001..005 | structural parse only (`core/src/services/trust-tasks/envelope.ts`); the private type scheme `task:p2pts:` is not a valid Type URI; `#response` as a request is refused by the route | registry `consumeInbound` validation; reject `/binding/`; no fragment equals `#request`; URN codec | M | low |
| ENV-006/007 | unknown members preserved; no extension handling | rely on the runtime's `ext` and critical handling | S | low |
| ENV-008/009 | payload schemas unused by the catalog | validate with generated and local schemas; closed at Tier 2 | M | low |
| ENV-010 | unknown type answered 404 `endpointNotFound` | `unsupportedType` / `unsupportedVersion` with served versions | S | low |
| TIME-001..009 | `issuedAt`/`expiresAt` never checked in the current code; participant expiry uses `>` and only inside the crystallize check; approve ignores it | runtime freshness with one clock; shared `assertOpen` using `>=` in approve, crystallize, query | M | medium (late approvals now refused) |
| DUP-001..008 | none in the current code; duplicate begin throws; re-approve is a database uniqueness failure | accepted-id store; duplicate begin with the same hash returns existing state, other hash `idConflict`; idempotent approve | M | medium |
| PRF-001..004, 006 | proof never verified | DID-resolving verifier over raw JSON, registry fixtures | L | medium (DID resolution) |
| PRF-007..010, 011, 012, 013; ID-003 | n/a | listed-key and purpose rules, controller equals issuer, sign `authentication`, proof requirements | M | low |
| ID-001/002 | recipient never checked; issuer checked only when a proof exists | recipient must equal a service identifier; sender versus issuer; error addressing | S-M | medium (hosted-community recipients) |
| AUTHZ-001 | evaluate may trust an in-band actor (unverified) | verified sender is the actor; unauthenticated gives `permissionDenied` | S | medium |
| RSP/LIF | `threadId` copied only if present; no state machine | `threadId` always; `lifecycle.ts`; control types `unsupportedType` | S | low |
| RSP-003, VRC-PRO-008, VRC-PRO-019 to VRC-PRO-021 | no hold document; a held proposal is silent | every hold, ceremony documents and `propose` alike, is answered with `next-step`; `propose` uses `continuation: resubmit` (no status task) | M | low |
| RSP-004/005, ERR signed | replies unsigned | sign in pipeline | S | low |
| ERR-001..008 | error is a `#response` of the request type with `{code,message}`; ad hoc codes; non-typed throws reach the framework handler | `errors.ts` with the standard codes, `retryable`, `inResponseTo`, bounds; catch-all `internalError`; legacy code map | M | medium (clients reading `type`) |
| VRC-PRO-001..021 | no wire; handshake via the relationship manager | `vrc-propose` over the existing accept path; hold answered with `next-step`, resubmission handling; decline extended code | M-L | medium (API unverified) |
| VRC-PRO and VRC-ISS party-binding vectors; envelope/inner-proof split | VRC issuer and subject are the connection DIDs; no relationship DID, no `issuerScope`; ceremony keyed per pair | per-VRC relationship DID, exchange record and mapping, mint and verify on relationship DIDs (section 3.10, phase P5c) | L | high (key custody, ceremony change, migration) |
| VRC-ISS-001..020 | receive participant stores unverified parameters; no authorisation, binding or credential-proof check; receipts are internal | `vrc-issue` handler per section 2.2 | L | medium |
| WSH-001..012 | no witnessed-credential concept for VRC | new participant, credential kind, evidence storage and pairing | L | high (new storage; local specification) |
| TD-001..006 | n/a | `digest.ts` | S | low |
| 2PC-001/002 | failure is a `no` vote with a log line | abort-reason registry; outcome to reply | M | medium |
| 2PC-003 | pending proposals visible only through query | `next-step` with `expects` | M | low |
| 2PC-004 | expiry not enforced on the participant path | `assertOpen`; `deadlineLapsed` | M | medium |
| 2PC-005 | `ceremony_reset` unconditional | guard to failed/expired only; reset after commit gives `alreadyCommitted` | S | medium (checked below) |
| 2PC-006..008 | inbox dedup only | claim row plus settle check; `indeterminate`; `unavailable` | S-M | medium |
| BND-001..006 | route exists; cookie auth | raw body retained; status table; proof-only | S-M | low |

## 5. Phased steps (independently shippable, in dependency order)

Every phase: tests ship in the same change, drive by vector ids (test names embed the vector id and load vector-shaped JSON from a fixtures directory; the registry's `fixtures/consume` and `fixtures/proof` are copied with a recorded provenance commit); tests never touch real home, state or config (temp directories); a small in-process adapter implementing the suite's adapter contract is created in P0 and grows each phase, then wrapped for JSON-RPC in P8. Migrations are additive and nullable; the default rollback is to revert code and leave the columns (but see section 3.7: the `SCHEMA_VERSION` bump makes a downgraded binary refuse the database). Before heavy builds or test suites check memory and load, run under `nice -n 10`, with a bounded wait.

**Order:** P0, then P1, P3 and P5 in parallel (disjoint files); P2 after P1; P4 needs P2; P4b after P4; P5b needs P4, P4b, P5; P5c needs P3, P4 and goes after P5 (shared VRC participants); P6 needs P3, P4, P4b, P5c; P7 after P6; P8 needs P5, P6; P10 after (needs P6, P7, ideally P8); P9 after P10; P11 needs P4. Release order: the core package first, then the utility-server dependency bump.

| Phase | Content | Tests | Back-compat and rollback |
|---|---|---|---|
| **P0** Pins, library, fixtures, adapter skeleton | first task: install and typecheck the pinned library under the repo's TypeScript 6 and run its own tests (its `.d.ts` compatibility is unverified); dependency pins; `boundary/{runtime.ts,pins.ts}`; copied fixtures with provenance; adapter skeleton; a `myVid` selector (the library's `consumeInbound` takes a single recipient VID: the adapter picks the document's `recipient` if it is in the served set, else the default identifier, so hosted communities give `wrongRecipient` correctly); notice entry | digest (`item11-digest.json`), freshness, timestamps via the adopted runtime; dependency-licence check | no behaviour change; remove deps and files |
| **P1** Typed error model, status table, lifecycle (Tier 1 foundation) | `errors.ts`, `lifecycle.ts`; error builder emits `trust-task-error` 0.6 with `{code, retryable, inResponseTo, message, details?, retryAfter?}`; `threadId` default; route uses the status function with a catch-all | ERR-001..008, LIF-001..003, RSP-001/002; every internal status maps to one lifecycle state | `payload.code` and `message` paths kept; 404/401 become 422 (documented; grep callers first); ships alone |
| **P2** Tier 1 consumer pipeline on the existing route | `pipeline.ts` wrapping `consumeInbound`; raw body capture; handler registry with the legacy evaluate handler; interim proof policy `rejectIfPresent` | ENV-001..010, TIME (envelope), ID-001/002, BND-001..006, PRF-012 negative | stale `issuedAt` now `expired`; a strictness flag for one release (freshness and recipient only; proof checks never off); ships alone |
| **P3** Persistence, accepted-id store and relationship mapping table | migration `0021_trust_task_boundary.sql` in both trees (including the P5c mapping table) with one `SCHEMA_VERSION` bump per tree; additive tx columns; repository fields; janitor hook; `TransactionManager.getOutcome(txId)` accessor; claim insert as plain insert plus caught key violation, key column `id` | DUP-001..008 against the store (same bytes, other payload, re-sign, other recipient, window edge, in flight, restart, fail closed with a throwing data source, concurrent double claim on both dialects, horizon clamp, missing `issuedAt`) | nullable columns; no behaviour change until P4/P6 call the store |
| **P4** Attestation: signer, verifier, signed replies, digests | `boundary/proof/*`; reuse `verifyDtgProof` and `DidResolver.dereferenceVerificationMethod`; wire `HttpRotationLogSource` with timeout, size cap, cache and rate limit (it exists but nothing instantiates it, and the agent resolver reads only its local rotation log), or document that `did:scid:vh` peers must be introduced first; copy `parseDateTimeStamp` with attribution (not exported by the proof package); `setBoundarySigner` installed beside the existing operation-proof signer in both processes; pipeline wiring; persistence of proof, raw document and verified signer | PRF-001..010 with all registry proof fixtures plus own `did:peer:4` and `did:scid:vh` fixtures; PRF-011/013; ID-003; RSP-004/005; TD-001..006; whole-second emission; round trip against the reference verifier for `did:key` documents; resolve a `did:scid:vh` agent identity and assert `#key-1` in `authentication` and `assertionMethod`; cross-protocol test (section 3.1) | documents with a proof that previously failed now verify; unsigned evaluate keeps working at Tier 1 |
| **P4b** Layer 3b handlers | `trust-task-next-step` builder, discovery (0.4, `acceptanceWindow` equal to the pins, registry-driven), control refused `unsupportedType` | discovery lists exactly the registered types; next-step shape; control gives `unsupportedType` | ships alone |
| **P5** Participant behaviour the boundary requires | approve at `expiresAt` refused and proposal flips to `expired`; duplicate begin and approve rules; reset guard; executor failure leaves a `failed` row with `error_code` (also on the non-transactional VRC path, so no orphan request row); deny reason persisted and rendered; non-admin approve gives `permissionDenied`; poll helper reads `errorCode` first; a held `propose` is answered with `next-step` (`continuation: resubmit`) | boundary and expiry tests; reset refused from pending and crystallized; failure rows; deny reason | old fields stay; behaviour changes (late and double approvals, reset guard) in release notes; ships alone |
| **P5b** Layer 3b-DTG adapters | `task-consent/{request,decision}` over approval and consent holds (approval keeps its proposal-hash signature; the document proof is `assertionMethod` via the identity-key slot); choose the `task-consent/decision` version explicitly (the library holds 0.1 and 0.2); `credential-exchange/issue` over the existing `exchange:credential` delivery operation; `present` has no existing operation and is sized as new | purpose pin, double approve, non-admin indistinguishable from not-found, expiry `deadlineLapsed`, issue idempotent by digest | `offer`/`request` verbs and a revoke verb are out until the DTG specification stabilises |
| **P5c** Relationship DIDs (per VRC) | section 3.10: per-VRC `did:peer:4` relationship DID minted without transport entry; mapping table (in migration 0021, with P3) keyed by the `propose` id, with root-identity mapping; key encrypted at rest under the agent key hierarchy; mint on relationship DIDs with `issuerScope: pairwise`; relationship DID carried in `propose`/acceptance (boundary path only); receive checks from the exchange record; archive push omits the connection identity record; teardown retires the record and deletes the secret key | per-VRC uniqueness, no connection DID in claim or document, mapping durability and uniqueness, inner and envelope proof keys, reused-DID refusal, offline verification, teardown, migration on a populated database, graph node count | additive table; existing connection-DID VRCs untouched and labelled legacy; the version bump makes a downgrade refuse the database |
| **P6** VRC propose and issue (benchmark core) | `vrc-issue`, `vrc-propose` (a held proposal is answered with `next-step`, using the P4b builder), config-gated agent listener, receipt by read-back | VRC-PRO-001..021, VRC-ISS-001..020, AUTHZ-001, 2PC-001/002/006/007/008; an in-process two-agent test | new route only; the existing TSP VRC ceremony is untouched (a second front door onto the same participant) |
| **P7** witness-share (new storage) | implement the suite-local witness-share profile (document 10; the registry has none); new receive participant and operation; credential kind; evidence table keeping the two verbatim documents; suite-local policy | WSH-001..012 and pairing vectors; evidence stored verbatim; receipt over the stored credential | until it lands WSH is reported KNOWN-FAIL or SKIP honestly |
| **P8** Ceremony documents, holds, real adapter | `ceremony-doc` handlers (founding first); `next-step` for every hold, including held `propose` (VRC-PRO-008 at Tier 1, VRC-PRO-019 signed at Tier 2); URN codec; JSON-RPC adapter (`provision`, `trust`, `setClock`, `send`, `trigger`, `observe`, `restart`, `reset`, `snapshot`/`diff`); retained-document accessor | 2PC-003..005, TIME-009, RSP-003, VRC-PRO-008, VRC-PRO-019 to VRC-PRO-021, double approve, non-admin approve, reset after commit, expired ceremony; reference adapter on the same vectors | ships alone |
| **P9** DIDComm carrier (deferred until after P10) | gated on a library choice; no DIDComm code exists today; no bearer alias | rerun framework groups | |
| **P10** Interop milestone | per [04-suite-design.md](04-suite-design.md) section 15: truststackers against VTI first on the framework, discovery and 2PC groups (VRC groups off the VTI row; VTI is measured as it is: its differences are reported in the matrix, and no VTI change is required or proposed without the project owner's review), then keyring-wallet through an HTTP shim written in the suite repository as an adapter (no change to keyring-wallet); live pairwise sessions, recorder and promoter, matrix. Increment I1 (suite core: `clockFree` and rebase mode, run salt, declared windows, vacuous-pass rule) is built | transcripts promoted to vectors that pass the reference adapter and fail a mutant | needs a running peer endpoint; not started |
| **P11** Dedicated boundary key (gate G2 engineering) | `updateDocument` with carry-forward for `did:scid:vh` (in-place `#key-boundary` add); time-pinned key resolution over the validated log and a verifier key policy; signer that switches at the cutover instant, default-off gate; `did:peer:4` documented (new identifier at next provisioning). Also: process wiring and encrypted key custody in the agent and the utility server, the genesis-hash check, persistence items K3 and K4, ops runbook, builder option at provisioning | carry-forward and chain validity on both key layouts, pre- and post-cutover verification, backdating bounded by freshness, cache never consulted, cross-protocol tests | default off; do not enable in a process that signs but cannot switch |

### 5.1 Decisions folded into the phases

| Phase | Decision | Status |
|---|---|---|
| P4, P4b | A hosted community at Tier 2 answers as the server identifier | built |
| P4, P4b | Read-only evaluate documents are not recorded in the task and thread tables | code change pending |
| P4 | The rotation-log endpoint setting stays opt-in; rate limits stay (6 resolutions per DID, 60 globally, per minute) | built |
| P4 | A failure to record is a 503 `unavailable` at Tier 2 and best-effort at Tier 1 | built |
| P4b | Discovery advertises only valid Type URIs; proof on discovery is required only at Tier 2 | built |
| P5 | A prior approver re-approving after the commit gets success, any other party `alreadyCommitted`; an aborted ceremony cannot be reset; an unknown failure is stored as `internalError` | built |
| P5 | A held proposal lapses after 7 days with `deadlineLapsed` | code change pending |
| P5c | Server-side linkability of a relationship DID to the root identity is a known limitation; per-counterparty caps and the agent's configured passphrase are kept | built |
| P6 | Held-proposal acceptance is independent of the personhood acknowledgement; the listener defaults to Tier 2 and nothing is auto-accepted outside tests; the credential is stored as canonical (RFC 8785) text | built |
| P7 | `eddsa-jcs-2022` only for the presentation; stricter-than-reference rules kept; no further migration for the utility server; evidence retained indefinitely and private to the two parties and the witness; WSH-008 and WSH-009 at Tier 1, `targetFrameworkVersion` 0.6.0, `issuedAt` REQUIRED, evidence members `initiating` and `terminal` | built |
| P8 | Framework matrix cells are measured through the fixture carrier and labelled; the binding is labelled a loopback listener with an adapter bearer map; an abort is `taskFailed`, not retryable; `proposerApproves` is a declared property (native stack false); `continuation: proceed` for a hold that names a status task; quorum is every named administrator; closed reason key; 7-day ceremony deadline; a status read of a lapsed pending ceremony writes `expired`; `verifyReceipt` is an optional adapter method with its own tier | built |
| P11 | Freshness default 600 s, stored documents re-verified at the recorded receipt time; an equal second resolves to the old key set; the adapter declares `proposerApproves` false | built (library level) |
| P11 | Add the missing genesis-hash check to `resolveFromLog` as its own tested commit with a release note | code change pending |
| P9 | DIDComm deferred until after P10 | settled |
| P10 | Starts with truststackers against VTI on the framework, discovery and 2PC groups (VRC off the VTI row), then keyring-wallet through an HTTP shim written in the suite repository as an adapter; no change to keyring-wallet | planned; I1 built |
| Release | The core package first, then the utility-server dependency bump | settled |

Rationale for each row: [section 12.4](#124-decisions-folded-into-the-phases-section-51).

Follow-up **F1** (separate ticket, after P6): enforce the operation proof on the agent-to-server hop. Today the policy defaults to `warn` and is applied only to `tx_prepare`; setting `enforce` refuses absent or invalid proofs there (a refused prepare is a `no` vote, so the transaction aborts cleanly, and commit, abort and inquiry are deliberately not gated so no transaction is stranded). The real risk is functional: a peer with no signer has all operations refused until upgraded, and `indeterminate` verdicts hide forged-binding cases. Roll receivers one at a time; rollback is to set `warn` and restart. Needed so Tier 2 can truthfully claim an attested inner hop.

## 6. Checked facts that shape the plan (H)

- The reset guard is safe: the only caller of the coordinator's reset on the founding-ceremony route is a stub no UI calls; the UI's reset button resets the personhood handshake, a different operation. External API clients of that route will see refusals (release note).
- The `did:peer:4` and `did:scid:vh` document builders list `#key-1` under `authentication` (an install that uses a legacy path without the TSP seed may publish a bare document with no `authentication` and cannot be verified by peers; see docs/07 section 4). A test resolving both kinds and asserting `#key-1` in `authentication` is added in P4. `did:peer:4` resolves offline; `did:scid:vh` needs a rotation-log source.
- The registry runtime ships generated policies for `vrc/relationships/propose` (proof optional, recipient required, `issuedAt` optional) and `issue`; none for `witness-share`.
- Both migration trees currently end at `0020`; the next free number is `0021` in both (re-check at P3).

## 7. Risks

- **Storage for witness-share is new** and its specification is local: ship P6 first and report WSH honestly.
- **The receive participant trusts its inputs**, including a remote-supplied issuer identity record, and dedups first-wins (section 2.2); the existing TSP VRC path stays as weak as it is today (out of scope, in the security register).
- **DID resolution in the hot path** (latency, DoS): cache, timeout, rate limit before resolving, `did:peer:4` offline; failure is `unavailable`.
- **Claim and commit crash window:** `tx_id` plus the settle sweep; needs the new `TransactionManager.getOutcome(txId)` accessor (none exists today).
- **Dialect differences** between SQLite and the distributed database for atomic claim and migrations: test both.
- **Library pinned to a Working Draft:** exact pin, deliberate bumps.
- **Behaviour changes** (late and double approvals, reset guard, stricter freshness, 401 to 422) may surprise UIs and agents: flag, release notes, old fields kept.
- **One key, several protocols** (section 3.1): structurally separate; dedicated key at G2. For agents the shared key is also the rotating identity key.
- **Relationship DID work (P5c)** adds a secret key per VRC, a change to a durable per-pair ceremony, identity-row fan-out and a migration; the archive push omits the connection identity record; `did:peer:4` cannot rotate. Existing VRCs under connection identifiers are labelled legacy.
- **Open listener on agents:** opt-in, off by default, never on the UI port.
- **Two sources of truth** if adapter pre-checks diverge from participant checks: reuse pure functions.

## 8. Gates (tracked checkpoints, not phases)

| Gate | Condition | Blocks |
|---|---|---|
| G1 spec check | **PASSED with conditions** (section 3.2): proof-only without transport authentication is permitted for consequential tasks; conditions a to d apply | none beyond conditions a to d; do not turn `TRUST_TASKS_PROOF_ONLY` on before they hold |
| G2 dedicated key | prerequisites of section 3.1 exist (the agent path is `did:scid:vh`: carry-forward `updateDocument` and a time-pinned verifier that refuses cache-sourced resolutions; `did:peer:4` next-provisioning applies only to legacy or test agents); the dedicated key `#key-boundary` is wired and held under encrypted custody in each process; the genesis-hash check is in the resolvers; signer switched; `#key-1` accepted only for documents created before the cutover instant, with the 600 s freshness bound; key-set-at-created tested; cutover instant documented. Until then `#key-1` stays behind `BoundarySigner` | production release of the listener |
| G3 proof-only default | flag default on for the agent listener; the utility-server route stays at Tier 1 by default until a caller re-grep | production |
| G4 inner hop | the operation-proof policy decided for the production topology (F1) | any claim of an attested inner hop |
| G5 KNOWN-FAIL review | every `exceptions` entry has an owner or an expiry | publishing the capability matrix |

## 9. Out of scope

Producer-side ceremony initiation for non-truststackers peers beyond the `trigger` hook; data rooms (declared unsupported, `unsupportedType`); delegation, authority and membership lifecycle (blocked on the DTG protocols specification); step-level re-drive deduplication in the driver; retention and replication reconciliation of the `trust_tasks` table; ES256; idempotency keys; discovery beyond 0.4; changing the TSP wire or the operation proof; changes to the other two implementations; the suite itself.

## 10. Remaining open items

See [07-status-and-open-questions.md](07-status-and-open-questions.md) section 4: the remaining engineering work (production ceremony host, held-proposal UI and initiator side, the legacy participant that stores at prepare, G2 process wiring and key custody, a likely rotation-log route bug, the genesis-hash check, persistence items K3 and K4), who contacts the task force, and the proposals the plan depends on (the `attested` profile, the witness-share specification home).

## 11. Verification before building

Outcome of twelve read-only code reads; nothing was built, run or installed.

1. Resolved: neither the VRC receive participant nor the storage function checks issuer, subject or credential proof (section 2.2).
2. Resolved: the agent's connection identifier is `did:scid:vh` (Slot-B layout); the VRC issuer and subject are today the connection identifiers, with no separate relationship identifier; one relationship DID per VRC exchanged is the design, scoped in section 3.10 (P5c).
3. Resolved: the human consent point is `acknowledgePeer` / `localUserAcknowledges`; no decline operation exists (section 2.2).
4. Resolved: no outcome-by-id accessor exists; add `TransactionManager.getOutcome(txId)` (section 3.5).
5. Resolved: insert-if-absent form and migration number 0021 in both trees (sections 3.5, 3.7); not exercised on a real distributed database.
6. Resolved with caveats: `did:peer:4` resolves offline; `did:scid:vh` needs a rotation-log source the agent lacks; no cache; `#key-1` under `authentication` for both (P4).
7. Resolved in P0: the pinned library installs, typechecks under the repository's TypeScript and runs under each toolchain. The date helper is not exported (copy it); `consumeInbound` takes a single recipient VID (`myVid` selector).
8. Resolved: HTTPS binding and framework security sections read; the registry has no `witness-share` specification; `trust-ceremony-receipt` read only in its header (proof REQUIRED, bearer, recorder is the issuer).
9. Resolved by grep: no in-repo caller of `POST /trust-tasks` besides its test and help text; status-string consumers listed (a rename must update the ceremonies page, the rules and VTC-create pages and the ceremony poll helper together); re-grep external clients before P1.
10. Not part of this plan: measurement of a built boundary.
11. Resolved: the library holds `task-consent` (decision 0.1 and 0.2) and `credential-exchange`; delivery is the `exchange:credential` operation.
12. Resolved: TSP v3 signs raw Ed25519 over the binary CESR envelope (section 3.1).

## 12. Design rationale and alternatives rejected

Why the plan is shaped as it is. The suite tests truststackers like any other implementation; these are product decisions for the plan and do not change what the suite asserts ([decisions.md, truststackers](decisions/README.md)).

### 12.1 Boundary and lifecycle

- **A boundary adapter in front of the existing machinery** (section 2): TSP two-phase commit stays internal (layer 2). The boundary enlists operations on the existing coordinator as existing callers do and reads the outcome as a fact; handlers never touch tables directly. It keeps the tested machinery and needs only the lifecycle mapping (section 3.9), so the internal TSP ceremony is untouched. The implementation under test is the agent with an opt-in listener (off by default, never on the cookie-session UI port), because VRC receipt lives on the agent.
- **Reply on the outcome, never on the vote** (section 3.9): a yes vote is a promise, not an effect; replying before the coordinator outcome is `committed` could acknowledge something that then aborts.
- **A closed `details.reason` vocabulary** (section 3.9): error messages must not leak identity or state; unknown reasons map to `internalError` with an opaque message.
- **A boundary-only URN codec** (section 2.3): internal code keeps its names and only the wire form is converted, so a rename cannot leak into the stored data model.

### 12.2 Attestation

- **Reuse `#key-1` now, behind `BoundarySigner`** (section 3.1): a dedicated key is real engineering work (section 3.1, gate G2) with no benefit before release, and reuse costs no new custody. The pluggable signer makes the later switch a one-place change. Shipping the cutover before carry-forward exists would silently drop the new key at the next rotation and invalidate signatures.
- **Proof-only sender authentication** (section 3.2): it removes a second authentication path and makes responses verifiable end to end; the framework (section 4.8.1) and HTTPS binding 0.3 permit it for consequential tasks, under the conditions of section 3.2.
- **Adopt the registry runtime** (section 3.3): hand-rolled canonicalisation and timestamp code is where the bugs are, and the suite's reference adapter uses the same runtime, so a divergence is a real finding. The claim comes after proof verification so an unauthenticated flood cannot burn another sender's ids.
- **Recompute receipts** (section 3.4) from the stored credential: a digest copied from the request attests nothing about what was stored.
- **Sign every reply at Tier 2** (section 3.6), errors and next steps included: a signed receipt or refusal is evidence; an unsigned one is only a claim by the transport.
- **Retention** (section 3.7): unauthenticated storage is an abuse surface, so bodies refused before proof verification are not stored; verbatim retention of verified documents is what outcome evidence needs. Verbatim retention is a profile rule, not framework text (CER-013 is CLARIFY).

### 12.3 Relationship DIDs (phase P5c)

Relationship DIDs are unique per VRC exchanged, stricter than the specifications' per-relationship wording (specification basis in section 2.2). What the specifications leave open is carried as profile rules: CLARIFY vectors (VRC-PRO-016 to 018; VRC-ISS-020 to 023), except the connection-DID rule, a Tier 2 expectation (VRC-ISS-018, 019). The envelope uses the connection DID because the profile requires `issuer` equal to proof signer equal to transport sender.

| Item | Decision | Rationale |
|---|---|---|
| Method and keys (O17) | `did:peer:4`, signing key only; X25519 only if encryption is needed | Self-resolving, so a stored VRC verifies offline with no rotation-log source and no shared resolution origin (the credential specification calls a web-origin method a poor fit); a different class and method from the `did:scid:vh` connection DID helps unlinkability. No rotation: compromise recovery is a new VRC under a new relationship DID, which per-VRC minting makes natural |
| Mapping table (O18) | A table in the application database keyed by the `propose` document `id` | The existing ceremony and relationship tables are keyed per connection pair; a per-VRC key is a structural change, not a column |
| Migration placement (O24) | Folded into migration 0021 with P3 | One `SCHEMA_VERSION` bump instead of two; each bump makes a downgrade refuse the database |
| Key custody (O19) | The per-VRC key is encrypted at rest under the agent's key hierarchy; the development-default passphrase constant is never copied | A new class of secret, one per VRC, in a long-running agent; the closest existing pattern is unsafe |
| Internal ceremony (O20) | Specification-following VRCs are produced only through the boundary path at first | Changing a live, retried, durable saga keyed per pair is high risk; the boundary `propose` and acceptance already carry `relationshipDid` |
| Second exchange (O21) | A new `propose` id is a new exchange and a new VRC; `issue:alreadyIssued` only for a resend within one exchange | The rule is per exchange, since DIDs are unique per VRC |
| Archive push (O22) | Omit the connection identity record from specification-following VRC archive pushes | The push would let the utility server map every relationship DID to a connection DID, defeating the pairwise purpose |
| Lifecycle (O23) | On relationship end delete the secret key and keep the public document | A relationship DID is "for nothing else"; stored VRCs still need the document to verify; no revoke verb exists |
| Existing VRCs (O25) | Labelled legacy; no backfill, no forced re-issue | Re-issue needs a fresh exchange anyway |
| Per-VRC uniqueness in the suite (O26) | A CLARIFY vector (VRC-PRO-017) plus a Tier 2 profile note; keyring-wallet is reported as "differs", not failing | The specifications do not require it; keyring-wallet mints one `did:peer:0` per counterparty connection, which they do not forbid |

### 12.4 Decisions folded into the phases (section 5.1)

| Decision | Rationale |
|---|---|
| A hosted community at Tier 2 answers as the server identifier | The server holds the signing key; reply, receipt and proof are then verifiable under one identifier |
| Read-only evaluate documents are not recorded | They change nothing, so a record is not evidence of an effect, and recording reads would turn a read route into a storage path |
| The rotation-log endpoint stays opt-in; rate limits stay | Opt-in keeps an outbound fetch off by default; the limits bound resolution cost before the resolver runs |
| A failure to record is 503 `unavailable` at Tier 2, best effort at Tier 1 | At Tier 2 the stored document is the evidence; Tier 1 requires none |
| The route stays at Tier 1 by default until the gate G3 caller re-grep | Tier 2 by default would break callers not yet checked |
| Discovery advertises only valid Type URIs; proof on discovery only at Tier 2 | The answer lists exactly what the boundary serves; the framework does not require the proof |
| A prior approver re-approving after the commit gets success, any other party `alreadyCommitted`; an aborted ceremony cannot be reset | A repeat by the same party changes nothing; an abort is terminal, a reset is only for failed or expired ceremonies |
| Server-side linkability of a relationship DID to the root identity is a known limitation | The graph keeps one node per peer; the archive push omits the connection record (12.3) |
| Held-proposal acceptance is independent of the personhood acknowledgement | Different consents: one for this exchange, one for the peer relationship |
| The listener defaults to Tier 2; nothing is auto-accepted outside tests | The listener serves attested ceremonies; a held proposal needs a human |
| The credential is stored as canonical (RFC 8785) text | The receipt digest is recomputed over it and must be reproducible by a third party |
| A held proposal and a ceremony deadline lapse after 7 days with `deadlineLapsed`; a status read of a lapsed pending ceremony writes `expired` | A hold needs a bound; leaving the stored state pending would make state depend on who reads |
| Witness-share: `eddsa-jcs-2022` only, stricter-than-reference rules, evidence retained and private to the two parties and the witness | The suite-local profile names that cryptosuite; vectors are not weakened; deleting evidence is irreversible, and it links identifiers the pairwise design keeps apart |
| An abort is `taskFailed`, not retryable; in-flight and unknown outcomes stay identical | An aborted transaction will not succeed on resend; distinguishing "no decision readable" cases would invent information |
| `proposerApproves` is declared, false for the native stack | Whether a begin counts as the proposer's approval is not specified, so the adapter declares it |
| The native quorum is every named administrator | The suite asserts no quorum of its own; it runs the ceremony against the essential governance the adapter declares ([04 section 11.4](04-suite-design.md#114-ceremony-documents-cer-2pc-003-to-2pc-005-time-103)) |
| `verifyReceipt` is an optional adapter method (`receiptVerify`) | The verifier rules of `trust-ceremony-receipt` have no wire output (O10) |
| Keep the 600 s proof freshness default; re-verify stored documents at the recorded receipt time; an equal-second tie resolves to the old key set | 600 s bounds the window in which a stolen `#key-1` could sign a backdated proof after cutover; a key added in the same second cannot be shown to precede the proof |
| Add the genesis-hash check to `resolveFromLog` as its own tested commit | The latest-only resolvers do not check it, so a self-consistent forged log passes |
| DIDComm (P9) is deferred until after P10 | No DIDComm code existed; the interop milestone needs only HTTPS |
| P10 starts with truststackers against VTI, then keyring-wallet through a shim in the suite repository | VTI does not host the VRC ceremonies; a shim in the suite keeps changes out of an implementation the suite does not own |
| Release the core package first, then the utility-server bump | The utility server consumes the core package |

### 12.5 Alternatives rejected

| Topic | Alternative | Why not |
|---|---|---|
| Wire carriage | Rewrite the 2PC as document exchange; expose TSP 2PC to the suite | Discards working, tested machinery; the suite does not speak the layer-2 transport |
| Sender authentication | Keep the session cookie or bearer on the document surface; require a transport credential beside the proof | A second authentication path; responses not verifiable end to end |
| Signing key | A dedicated key now; `#key-1` hard-coded at each call site | Real engineering work with no pre-release benefit; a many-place switch later |
| Library | Hand-rolled canonicalisation, digests and timestamps | Where the bugs are; the reference adapter would not exercise the same code |
| Private type URI | `urn:p2pts:spec:...` (no prefix); renaming internal types | Invalid under the framework grammar; renaming leaks into stored data |
| Relationship DID method | `did:key`; `did:scid:vh` | No document or rotation; a shared resolution origin, and the connection DID already uses it |
| Relationship DID scope | One per counterparty | Cannot express per-VRC uniqueness |
| Mapping storage | Columns on the per-pair ceremony table | Per-pair rows cannot hold several exchanges |
| Migration | A second migration (0022) | Two version bumps, two downgrade traps |
| Internal ceremony | Extend the personhood acknowledgement to carry the relationship DID | Touches a live durable saga |
| Lifecycle | Keep the relationship secret key for later status updates | No revoke verb exists; retention enlarges the compromise surface |
| Existing VRCs | Re-issue all | Needs fresh exchanges; labelling legacy is enough |
