# Ceremony scenarios: complete-ceremony runs, reference-only dry run

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This page describes how the suite can run one whole ceremony (several Trust Tasks between named roles, tied together by a thread) from the first document to a named end state. Only the first steps are built: the scenario format, its runner, the contract members it needs and twenty-nine scenarios in seven groups (FC-VRC, FC-TCA, FC-CEX, FC-MAT, FC-WSH, FC-VET, FC-ONB), all validated on the reference adapter alone. No platform has been run this way. The decision is [CV-15](decisions/03-vectors-and-coverage.md#cv15).

## 1. What a scenario run shows, and what it does not

- **It shows** that these participants, at these versions, over this carrier, completed this choreography (or ended in the refusal the scenario specifies) on this date. The only label a result may carry is: **ran together, one pair, one carrier, one date.**
- **It does not show** conformance. A scenario outcome is never a PASS, never counted with vector results, never in a headline figure, the catalog total or the exit code of `npm run suite`, and is never called interoperable without that qualifier.
- **The reference dry run shows less still.** Both participants here are the reference adapter (`reference` and `reference-peer`, two instances with different keys). The run shows that the format and the engine are sound and not vacuous: the oracle pair completes, and each deliberate mutant makes the scenario end in `failed`. It says nothing about keyring-wallet, VTI or truststackers. It is never evidence about a platform and is never admitted to the interop ledger.
- **The carrier is the runner's own relay** (runner-carried mode, in process). Addressing, sessions and real transports are not exercised.

The evidence kind is `complete-ceremony`. The scenario files, results and run records all carry it, and `countedAsConformance: false`.

## 2. How it is separated from the default run

| Piece | Where | Why it stays out of the default run |
|---|---|---|
| Scenario files | `vectors/ceremony-scenarios/` with their own manifest `scenarios-manifest.json` | The file is deliberately not named `manifest.json`, so no vector loader, catalog, glance model or count reads the folder |
| Schema | `schema/tt-ceremony-scenarios-0.1.schema.json` | Format description; tests check its enums against the code |
| Generator | `scripts/generate-ceremony-scenarios.ts` (listed in `npm run regen`) | Same freshness rule as every generator |
| Runner | `src/ceremony/` (`npm run ceremony`) | A separate entry with its own exit code |
| Ids | `FC-<ceremony>-NNN` in `vectors-src/id-ledger.json` | The ledger issues scenario ids like vector ids (never reused, retired not deleted); step entries (`<id>#<step>`) are found only for the spec-drift and tfRef checks and are not ledger ids |

## 3. The format `tt-ceremony-scenarios/0.1`

One file per group, for example `fc-vrc.json`. The file says `evidence: "complete-ceremony"` and carries the choreography's channel (`proposed` or `candidate`, never `registry`: the choreography is the suite's own, decision 79).

A scenario has:

- **`participants`**: named role slots (`P`, `R`) with a role and a `requires` list (`optional:initiate`, `optional:peer.connect`, `optional:observe.received`, `optional:observe.ceremony`, Type URIs). A slot is bound to an adapter when the run starts (`--participant R=<adapter spec>`). An adapter that does not offer a required capability, or does not list the role for the group (`Capabilities.ceremonyRoles`), gives SKIP with the reason. An unbound slot is SKIP.
- **`carrier.modes`**: `runner-carried` (built) or `live` (not built; such a scenario is SKIP).
- **`steps`**: each exactly one of `connect` (every participant to every other), `decide` (an operator decision through the participant's own `trigger`, as `policy` and `consent` do today) `initiate` (the participant builds and signs a document towards a peer; the runner relays it and the answers), `relayPushed` (the runner hands a participant's own pushed documents to their recipient) or `approve` (FC-TCA: the approvals up to k-1 or k, with k and the approver set read from the executor's declared essential governance, never from the scenario). A scenario may name the participants whose reading decides how it ended (`reads`; default all) and the governance source (`governance`). Where a scenario ends with a participant that has no way to learn the outcome (an issuer of a credential: accepted is silence), that participant reads from what it did itself and the scenario's assertions carry the rest. An argument of a step may carry `{"$received": {at, type, thread?, member}}`: the runner reads that payload member (a dotted path) from the newest document of that type that reached participant `at` on a captured thread, through the participant's own `observe`, and passes it on (FC-ONB: the request id the community minted, which the administrator decides on; the step fails when no such document arrived). The document that uses it is still built and signed by a participant. A step that sends a document carries a `source`: the Trust Tasks specification of that task with its `tfRef`, pin and spec hash (`withSpecHashes`), so `npm run check:spec-drift` re-hashes it like a vector's.
- **`expect`** (after a step) and **`completion.assert`** (at the end): checks of a participant's own state: `ceremony` (its reading of the thread), `received` (documents that reached it, by type, sender, code, exact count), `stored` (its stored count) and `receiptMatches` (the delivery receipt for the credential a step built carries that credential's digest, on its thread).
- **`allowedTerminals`**: the end states the scenario accepts (`completed`, `declined`, `refused`, `expired`, `aborted`).
- **`deadlineMs`** (at most 600000). Nothing waits without a bound.

### Result vocabulary

| Status | Meaning |
|---|---|
| `completed` | Every participant that decides the end (`reads`, default all) reads `completed` and every assertion holds |
| `ended-as-specified` | Every participant reads an allowed refusal state (for example `declined`) and every assertion holds |
| `failed` | A step expectation or an assertion did not hold, a participant errored, or the end state is not an allowed one |
| `inconclusive` | A participant's state cannot be read (it answers `unknown`), or two participants share one identity |
| `incomplete` | The deadline passed, or no terminal state was reached |
| `skipped` | A slot is unbound, a capability or role is not offered, or the scenario needs a live carrier |

None of these is a conformance verdict. A rerun is a new run, never a retry to turn `failed` into `completed`.

## 4. The contract members (all optional, additive)

Added the way `emit` and `observe.pushed` were: names in `OPTIONAL_CAPABILITIES` (`src/adapter/contract.ts`), declared in `Capabilities.optional`, rejected by the loader and warned by the runner when misspelt, listed in [docs/04 section 4](04-suite-design.md).

| Member | Capability | Shape |
|---|---|---|
| `initiate` method; `Capabilities.initiates[]` | `initiate` | `{kind, to, thread?, args?}` to `{threadId, documents[], sent}`. The implementation builds and signs the document. `sent: false` (the reference) means it is returned unsent and the runner relays it |
| `connect` method | `peer.connect` | `{peer: {vid, didDocument?, transportAddress?}, role?}` to `{connected, detail?}` |
| `observe {query: "received", from?, type?, threadId?}` | `observe.received` | `{value, documents[]}`: every document that reached the implementation, oldest first |
| `observe {query: "ceremony", threadId}` | `observe.ceremony` | `{value}` one of `open`, `held`, `completed`, `declined`, `refused`, `expired`, `aborted`, `unknown`. A state the implementation cannot map is `unknown`, never invented |
| `Capabilities.ceremonyRoles[]` | none | `{ceremony, roles[]}`: the roles it can play, giving SKIP "role not offered" |

Not built yet: `Capabilities.liveBindings[]` (needs a live mode).

## 5. The reference adapter as a participant

`src/adapters/reference/ceremony-party.ts` gives the reference the members above for the VRC ceremony. Kinds: `vrc-propose` (a relationship DID of its own, a signed proposal) and `vrc-issue` (a Verifiable Relationship Credential from its relationship DID to the peer's, signed by its relationship key, with the digest of that credential). It keeps an inbox of every document that reached it, takes the answers to what it started, and reads a thread as `completed` only when it holds the other party's credential **and** the receipt for the one it issued matched that credential's digest. It signs its own documents and has no carrier: that is why `sent` is `false`.

The same file gives the reference the members for two more groups. **Task-consent** (group `FC-TCA`, roles `executor`, `approver`, `outsider`): `consent-begin` (a requester's held task, the suite's own conformance ceremony begin), `consent-request` (the executor asks one approver on the ceremony's thread, with the binding it derived) and `consent-decision` (an approver decides on the binding it was shown, signed under `assertionMethod`). An approver reads a thread `held` while its decision is answered `pending`, `completed` when `granted`; the executor reads its own record. **Credential exchange** (group `FC-CEX`, roles `issuer`, `holder`, `verifier`): `cex-offer` and `cex-query` start a thread; the holder's request, the issuer's issue and the holder's presentation are pushed by the reference's own handlers and relayed by the runner (`relayPushed`). A holder reads `completed` only when it holds the credential issued on the thread, or has presented on it; an issuer when it has issued; a verifier when it kept the presentation. Credential exchange needs `attested` parties (`reference-party:seed=<n>,attested`), because the documents pushed there must carry a proof. Spec for a party of these groups: `reference-party:seed=<n>[,k=<k>,approvers=<A+B+..>][,cosign][,attested][,mut=<m1+m2>]` (own key; the essential governance it declares; a begin that does not count as the proposer's approval; deliberate mutants).

Group `FC-MAT` (roles `first-person`, `second-person`) needs no kind of its own: each party is the issuer of one credential exchange and the holder of the other, with the `cex-offer` kind and the pushed request and issue.

## 6. The scenarios

Group `FC-VRC`, channel `proposed`. The tasks are `vrc/relationships/propose/0.1` and `vrc/relationships/issue/0.1` (Trust Tasks repository, status draft); no Trust Tasks ceremony definition exists for this flow, so the choreography is the suite's text (layer model, [docs/01](01-layer-model.md): "propose, then issue once in each direction on one thread, each returning a delivery receipt"). "Receipt" means the issue `#response` delivery receipt, not `trust-ceremony-receipt` (the naming clash is open, [docs/21](21-vector-group-rationale.md)).

| Id | Roles | Steps | Ends as |
|---|---|---|---|
| `FC-VRC-001` | proposer P, responder R | connect; R decides accept; P proposes; P delivers its credential and R's receipt must match; R delivers its credential and P's receipt must match | `completed`: both read `completed`, both hold one credential, both receipts match |
| `FC-VRC-002` | the same | connect; R decides decline; P proposes | `ended-as-specified` (`declined`): P received `vrc/relationships/propose:declined`, both read `declined`, R stores no credential |

Two reference parties play the roles, so the format is exercised without a platform.

### 6.1 FC-TCA: task-consent approval under declared essential governance

Group `FC-TCA`, channel `proposed`. Participants: an executor `E`, three approver slots `A1` to `A3` and an outsider `O`. The tasks are `task-consent/request/0.1` and `task-consent/decision/0.2` (Trust Tasks repository, status draft); the held task is the suite's own conformance ceremony begin (a suite design, cited to the framework text SPEC.md section 8.6). **Governance is never decided by the suite:** the scenario names no role and fixes no k. The runner reads k and the size of the approver set from the executor's declared essential governance (`capabilities.governance.essential`, [docs/02](02-core-trust-task-criteria.md) section 5.1) and takes the first n approver slots as that set; whether the begin counts as the requester's own approval is the executor's declared `proposerApproves`. A declaration that is unreadable, that names more approvers than the scenario has slots, or whose k leaves no quorum that is one short to hold, makes the scenario `skipped` with the reason.

| Id | Steps | Ends as |
|---|---|---|
| `FC-TCA-001` | connect; every device enrols the executor; the requester begins the held task with the declared set; the executor asks and the declared approvers decide until k-1 are counted (the executor reads `held`, no effect yet); one more decides (the executor reads `completed`, one effect) | `completed` |
| `FC-TCA-002` | as above, then a device outside the declared set is asked and decides: refused with `task-consent/decision:notAnApprover`, not counted (`held` still); then a declared approver completes it | `completed` |
| `FC-TCA-003` | as `FC-TCA-001`, but at k-1 an approver already counted decides again: still `held`, then the k-th completes | `completed` |

The scenario reads the executor's state to end (`reads`); every other check is an assertion at a step. Tested on declared 2 of 3, 3 of 3 and 2 of 2, with the begin counting and not counting as an approval, and 1 of 3 (a quorum of one with nothing counted).

### 6.2 FC-CEX: credential exchange

Group `FC-CEX`, channel `proposed`. Tasks: `credential-exchange/{offer,request,issue,query,present}/0.1` (Trust Tasks repository, status draft). No Trust Tasks ceremony definition covers these flows; the choreography is the suite's text.

| Id | Roles | Steps | Ends as |
|---|---|---|---|
| `FC-CEX-001` | issuer `I`, holder `H` | `I` offers; `H` pushes a request on the offer's thread; `I` pushes the issue on that thread; `H` keeps the credential | `completed`: both read `completed`, `H` holds one credential |
| `FC-CEX-002` | verifier `V`, holder `H` | `H` holds a credential; `V` queries; `H` answers with a presentation bound to the query's nonce on its thread: at once when it pre-trusts `V` (a holder that offers the `verifierTrust` trigger), after its human approves the deferred query when it does not (steps guarded by `when`, D610) | `completed`, `V` keeps one presentation |
| `FC-CEX-003` | the same | `H` does not pre-trust `V`: the query is deferred (`H` reads `held`, `V` keeps nothing); `H`'s human approves; the presentation is pushed on the query's thread | `completed`, `V` keeps one presentation |

Not written: the declined deferred query, the sealed form of the issue, and the reference as issuer making an offer that the holder refuses.

### 6.3 FC-MAT: in-person mutual attestation

Group `FC-MAT`, channel `proposed`. Roles `first-person` `F` and `second-person` `S`, each both issuer and holder. The choreography is **defined**: `ceremonies/mutual-attestation/0.1/ceremony.json` in the Trust Tasks repository (status draft, targetFrameworkVersion 0.4; sha256 `b9c9638b...b980ad` as read, the full digest is in the scenario `spec`). It has two steps and nothing else:

| Definition step | Task | Issuer, recipient | `prev` | Scenario step |
|---|---|---|---|---|
| `attest-first` | `credential-exchange/issue/0.1` | `first-person`, `second-person` | `[]` (anchor-rooted, terminal) | `attest-first` (`F` pushes the issue, `S` keeps the credential) |
| `attest-second` | `credential-exchange/issue/0.1` | `second-person`, `first-person` | `[]` (anchor-rooted, terminal) | `attest-second` |

Completion is `allOf` both steps; there is no order between them and no `prev` in either direction (a chain would invent an order, a mutual `prev` would be a cycle). The definition has no offer or request. The reference issues in answer to a request, so each direction is reached through the FC-CEX offer and request (steps `offer-first`, `request-second`, `offer-second`, `request-first`, the suite's own preamble, with their task specifications cited as in FC-CEX); each direction has its own thread. Each step's `source` carries the task specification of `credential-exchange/issue` (withSource, tfRef and spec hash); the ceremony definition is cited in the scenario's `spec` by path and digest (the Trust Tasks manifest holds specifications, not ceremony definitions, so there is no tfRef for it); `test/ceremony-mat.test.ts` re-reads the definition when `TT_KIT` is set and checks the step names, issuers, recipients, empty `prev` and `completion`.

| Id | Steps | Ends as |
|---|---|---|
| `FC-MAT-001` | connect; `F` offers, `S` requests, `F` issues (`attest-first`); `S` offers, `F` requests, `S` issues (`attest-second`) | `completed`: both read `completed` on both threads, each holds one credential |
| `FC-MAT-002` | the same two directions, `attest-second` first | `completed` (no order) |
| `FC-MAT-003` | both offers and both requests are exchanged before either credential is issued, then `attest-second`, then `attest-first` | `completed` (simultaneous) |

Not exercised: the `coDerived` anchor (a value the two people establish together, from which the enactment identifier is derived, `enactmentPrivacy: blinded`). The reference has no enactment identifier and the runner no anchor, so "both steps commit to the same anchor" is not checked; evidence level `countersigned` and `maxDuration` are not checked either. The scenario shows the choreography (two independent issues, both required), not the anchor.

### 6.4 FC-WSH: witnessed VRC with witness-share

Group `FC-WSH`, channel **`candidate`**: `vrc/relationships/witness-share/0.1` has no Trust Tasks home (local text [docs/10](10-witness-share-profile.md), advisory, never an endorsement); `witness/session/0.1` and `witness/session/submit/0.1` are registry drafts (each step's `source` carries its tfRef, pin and hashes; the share step carries the candidate source). Roles: proposer `P`, responder `R` and a third slot `W` with role `witness`. Same label and `countedAsConformance: false` as every scenario.

**Which witness this is.** `W` is the suite's **reference witness oracle in a labelled mode, `mint-on-verified`**, selected only by the explicit adapter option `reference-witness:mode=mint-on-verified`. For a presentation that verifies, is bound to the session and is held by the submitter, it mints a Verifiable Witness Credential about the submitter, citing the session document by id and task digest and carrying the digest of the relationship credential presented. That is a **suite choice**: the drafts leave minting to the witness's own policy (the submit specification, Authorization). Nothing here ran the witness server, and no result says anything about it. The unmutated `reference-witness` that `vectors/witness` runs against is unchanged and still declines a presentation that verifies; the mode is declared in the participant's capabilities (`mode`) and each scenario result carries it next to the participant (`participants.W.mode`), and the label names the adapter spec. Before and after hashes of `results.json` for the default suite (`reference`) and for the witness vector run (`reference-witness`), at a fixed salt and date, are identical (recorded with the run records kept outside the repository, like every run record).

What the party builds itself, never the runner's vector builder: `witness-session` (opened under the party's relationship DID, naming the two relationship DIDs, with `parentThreadId` pointing at the exchange), `witness-session-submit` (a presentation held by the relationship DID, carrying the relationship credential the party will issue, bound to the session's challenge and domain) and `vrc-witness-share` (the credential the witness minted, in a presentation bound to the exchange and `vrc:witness-share`, with the retained session document and terminal answer). The party keeps the minted credential and the terminal document. A witness session is held under the party's relationship DID, so the runner presents that identity to the carrier for these documents (`InitiateResult.from`, an optional member); every other document comes from the party's own identity.

**Readings.** A party reads `completed` only when it holds the counterparty's relationship credential, the receipt for the one it issued matched, it holds the counterparty's witnessed credential **and** the receipt for its own share matched that credential's digest. The witness reads `completed` when it minted a credential for each of the two parties its session names. **No order between share and issue is asserted** (docs/10 open question O7): `FC-WSH-001` shares then issues, `FC-WSH-002` issues then shares, and both complete.

| Id | Steps | Ends as |
|---|---|---|
| `FC-WSH-001` | connect; `R` agrees to witnessed; `P` proposes with `witnessed: true`; each party opens a session with `W`, submits and receives its credential; each shares with the other (receipt digest matched); each issues | `completed`: `P`, `R` and `W` read `completed`, each party holds one relationship credential and one witnessed credential |
| `FC-WSH-002` | the same with both issues first, then the sessions, then the shares (the responder shares first) | `completed` |
| `FC-WSH-003` | `P` opens two sessions and submits on the second a presentation bound to the first session's challenge | `ended-as-specified` (`refused`): `witness/session/submit:challengeMismatch`, nothing minted |
| `FC-WSH-004` | both sessions complete; `R` shares with `P`; `P` shares the credential it received back to `R` | `ended-as-specified` (`refused`): `vrc/relationships/witness-share:notAccepted`, `R` stores nothing |

**Not claimed by these scenarios** (each needs a negative step that is not written; estimates in section 9): `mirrorWitnessed` (the responder mirrors `witnessed` against its policy), `noCredentialProof`, `noCitationDigest`, `wshStoresDuplicates` (a repeated share), and the witness-side `witnessSessionAnyIssuer`, `witnessAnyPartySubmits`, `witnessNoSessionCheck`, `witnessSkipsPresentationVerification`, `witnessBindingAfterVerification`. The honest path cannot show them.

### 6.5 FC-ONB: community member onboarding

Group `FC-ONB`, channel `proposed`. Roles: applicant `A`, community `C` and administrator `X`. The choreography is **defined**: `ceremonies/vtc/member-onboarding/0.1/ceremony.json` in the Trust Tasks repository (status draft, targetFrameworkVersion 0.4; sha256 `3754510f...4a94` as read, the full digest is in the scenario `spec`). Its steps, which the scenario steps carry by name, issuer and recipient (`test/ceremony-onb.test.ts` re-reads the definition when `TT_KIT` is set and checks them, with the order given by `prev`, `maxRounds`, the terminal and optional flags and the completion):

| Definition step | Task (0.1, as the definition names it) | Issuer, recipient | `prev` | Scenario step |
|---|---|---|---|---|
| `discover`, optional | `vtc/join-requests/manifest` | applicant, community | `[]` | `discover`: the community returns its `communityDid` and criteria |
| `apply` | `vtc/join-requests/submit` | applicant, community | `[]` | `apply`: a presentation held by the applicant and bound to the request (its challenge is the request's id) and to the community (its domain); the community mints a `requestId` and answers |
| `acknowledge` | `vtc/join-requests/submit-receipt` | community, applicant | `apply` | `acknowledge`: the community's own pushed document on the apply thread (not the submit response), relayed with `relayPushed`; it names the `requestId` |
| `supplement`, optional, `maxRounds` 3 | `vtc/join-requests/status` | applicant, community | `apply` | `status`: one poll per round on the thread |
| `decide`, terminal | `vtc/join-requests/decide` | administrator, community | `apply` | `decide`: `approved` or `rejected` on the `requestId`, read from the receipt the applicant received (`$received`) |
| `solicit`, optional | `vtc/members/solicit-vmc` | administrator, community | `decide` | `solicit` |
| `ask`, optional | `vtc/members/request-vmc` | community, applicant | `solicit` | `ask`: pushed by the community, relayed |
| `reciprocate`, optional, terminal | `vtc/members/vmc` | applicant, community | `ask` | `reciprocate`: a MembershipCredential naming the community, with the `requestId` |

Completion is `allOf` apply, decide and `anyOf` decide, reciprocate. **What the party is.** A reference party started with `reference-party:seed=<n>,attested,onboarding` (the explicit adapter option; the default reference and the witness run are unchanged) plays any of the three roles, in `src/adapters/reference/onboarding-party.ts`. As the community it keeps a request record (pending, approved or rejected), pushes the receipt and the request for the reciprocal credential on its own, answers a poll only to the proof signer who owns the request (an unknown request and another applicant's are the same `status:notFound`), refuses a decision for an unknown id (`decide:notFound`) or one that is not pending (`decide:notPending`), and stores a reciprocal credential only for an approved request (`vmc:requestNotApproved`, `requestNotFound`, `requestApplicantMismatch`; the credential must verify, be issued by the sender, be a MembershipCredential and name the community, else `invalidCredential` or `subjectMismatch`). With a `requestId` the request is resolved first, so a pending applicant gets `requestNotApproved` and not `notAMember`: the specification lists both and does not order them. As the applicant it answers a receipt only from the community it applied to (`submit-receipt:unknownRequest` otherwise), polls at most three rounds (the definition's bound; the runner has no `ceremony.round`, so a round is one poll), considers itself a member only after a poll read `approved` (`request-vmc:notAMember` before) and delivers the credential only after it was asked. It reads from its polls only (the definition's evidence recorders are the community and the administrator). **The administrator is declared, never modelled.** The community is told which party administers it by `trigger policy {administrator}` (a scenario `decide` step with the administrator's identifier); it takes `decide` and `solicit-vmc` only from that party and refuses the rest with `permissionDenied`. No role name, no authority list and no VTC governance is modelled. The party models only what the scenario observes: no join policy (a presentation that verifies, is held by the submitter and is bound to the request is taken), no community credential (the `vmc` a decision may return and `credentialsDelivered` are not produced), no `deferred` (the registry has no task to leave it, as the definition notes), no `resendCredentials`, no ordering of manifest versions 0.2 to 0.4 and no registry consent. The submit task at 0.1 is retired in the registry (superseded by 0.2); the scenarios use it because the definition names 0.1. The refusal code of a rejected poll is the party's own (`rejectedByAdministrator`); the specification fixes none.

| Id | Steps | Ends as |
|---|---|---|
| `FC-ONB-001` | connect; `C` is told its administrator; `A` discovers, applies; the receipt arrives; `X` approves; `A` polls | `completed`: `A`, `C` and `X` read `completed`, nothing is stored (no reciprocal step) |
| `FC-ONB-002` | the same, `X` rejects with a reason; `A` polls | `ended-as-specified` (`declined`): the poll carries the refusal members; all read `declined` |
| `FC-ONB-003` | two polls read pending, `X` approves, the third poll (the last round) reads approved | `completed` |
| `FC-ONB-004` | approved and polled; `X` solicits; `C` asks; `A` delivers the credential with the request id | `completed`: `C` stores one credential, all read `completed` |
| `FC-ONB-005` | `X` decides a request id the community never minted | `ended-as-specified` (`refused`): `decide:notFound`, the real request is still pending |
| `FC-ONB-006` | `A` delivers a credential with the request id while the request is pending | `ended-as-specified` (`refused`): `vmc:requestNotApproved`, nothing is stored |
| `FC-ONB-007` | `A` applies with a presentation held by another party | `ended-as-specified` (`refused`): `submit:presentationInvalid`, `A` and `C` read `refused`; only `A` and `C` take part |
| `FC-ONB-008` | `A` decides its own request | `ended-as-specified` (`refused`): `permissionDenied`, the request stays pending |

Each corrupt step is a party argument (`args.holder: "other"`, `args.unsolicited`, a decide by a party that is not the administrator); the honest party never builds them on its own. Same label and `countedAsConformance: false` as every scenario. Not claimed: the `maxDuration` of 30 days (no expiry hook), the evidence level `receipt` of the definition (no receipt document is checked).

### 6.6 FC-VET: identity vetting

Group `FC-VET`, channel `proposed`. Roles: applicant `A` and vetter `V`. The choreography is **defined**: `ceremonies/vetting/identity-vetting/0.1/ceremony.json` in the Trust Tasks repository (status draft, targetFrameworkVersion 0.5.0; sha256 `09a77e48...1826` as read, the full digest is in the scenario `spec`). Its steps, which the scenario steps carry by name, issuer and recipient (`test/ceremony-vet.test.ts` re-reads the definition when `TT_KIT` is set and checks them):

| Definition step | Task | Issuer, recipient | `prev` | Scenario step |
|---|---|---|---|---|
| `request` | `vetting/request/0.1` | applicant, vetter | `[]` | `request`: the vetter mints a `requestId` and returns it |
| `session` | `vetting/session/0.1`, `maxRounds` 3 | vetter, applicant | `request` | `session`: its own thread (`parentThreadId` the request exchange), a fresh 32-byte `challenge`, the request's community as `domain`; the applicant answers with the signed Vetting Card (`answer`) |
| `attest` | `credential-exchange/issue/0.1`, optional, terminal | vetter, applicant | `session` | `attest`: a StatementCredential under the `vetted` predicate |
| `decline` | `vetting/decline/0.1`, optional, terminal | vetter, applicant | `session` | `decline` |

Completion is `allOf` request, session and `anyOf` attest, decline. **What the party is.** A reference party started with `reference-party:seed=<n>,attested,vetting` (the explicit adapter option; the default reference and the witness run are unchanged) plays either role, in `src/adapters/reference/vetting-party.ts`. As the vetter it keeps a request record and its sessions and checks the card as the specification's Conformance vetter 5 states: the card's proof under an `assertionMethod` key of its publisher, publisher and audience, community, challenge and domain equal to the session's, not expired and not outliving the session, every required claim present, the identity commitment recomputed from its salt. As the applicant it answers only a session of the vetter that accepted the `requestId`, builds the card (`VettingCard` as the shared schema `vetting/_shared/0.1/vetting-card` defines it, one salt per application) and refuses a statement that cites no session of its own or whose task digest is not that of the session document it received (the outcome-evidence citation of FC-WSH, by `taskContext` and `taskDigestMultibase`). It models only what the scenario observes: no community policy, vetter eligibility, tickets or `requirementsDigest`, no match code (the party sets `livenessConfirmed` without a check). The definition's `maxRounds` is the vetter's bound of three sessions (a fourth is not opened); the runner has no `ceremony.round`, so a round is only its own session thread. A vetter's `decline` before any session (conforming in the definition, though the enactment is then not complete) is not written. Evidence level `countersigned` is not checked.

| Id | Steps | Ends as |
|---|---|---|
| `FC-VET-001` | connect; `A` requests; `V` opens a session; `A` answers with the card; `V` attests citing the session | `completed`: both read `completed`, `A` holds one statement |
| `FC-VET-002` | the same, then `V` declines | `ended-as-specified` (`declined`), `A` holds none |
| `FC-VET-003` | the first session lapses, `V` re-opens (round 2 of 3), `A` answers the second; the statement cites the second | `completed` |
| `FC-VET-004` | `A` answers with a card bound to another challenge | `ended-as-specified` (`refused`): `V` refuses, no card is accepted, `A` reads `refused` |
| `FC-VET-005` | a statement issued with no session (it cites the request exchange) | `ended-as-specified` (`refused`): `A` refuses, `V` reads `refused`, `A` holds nothing |
| `FC-VET-006` | after the statement `V` sends a decline anyway | `completed`: `A` refuses the decline and still holds the statement |

Each corrupt step is a party argument (`args.bind: "other"`, `args.without: "session"`, `args.force`); the honest party never builds them on its own. Same label and `countedAsConformance: false` as every scenario. Before and after hashes of `results.json` for the default suite (`reference`), the witness vector run and the full-vectors `reference-witness` run, at a fixed salt and date, are identical (recorded with the run records kept outside the repository).

## 7. Non-vacuity: mutants

Each mutant is a deliberate breakage in one participant. The run must end `failed`, at the step shown. They are named apart from the vector mutants (`CEREMONY_MUTANTS`, not in `MUTANTS`, so no vector is required to name them); `test/ceremony-scenarios.test.ts`, `test/ceremony-tca.test.ts` and `test/ceremony-cex.test.ts` and `test/ceremony-mat.test.ts`, `test/ceremony-wsh.test.ts`, `test/ceremony-vet.test.ts` and `test/ceremony-onb.test.ts` run every one. `cerNonAdminApproves` (a vector mutant of the ceremony approve task, not of the consent decision) is not on the consent path and is not claimed.

| Mutant | Breaks | Scenario ends `failed` at |
|---|---|---|
| `ceremonyDropReceipt` | keeps the credential, sends no delivery receipt (tried on each side) | the issue step whose receipt is awaited |
| `ceremonyReceiptWrongThread` | the receipt arrives on a new thread | the issue step |
| `ceremonyReceiptWrongDigest` | the receipt digest is not the credential's | the issue step (the receipts seen are listed) |
| `ceremonyEarlyCompletion` | reads `completed` once the proposal is accepted | the propose step (`open` expected) |
| `declineAsResponse`, `declineWrongCode` (existing vector mutants) | the decline is not the specified error | `FC-VRC-002` |
| `cerQuorumEarly`, `cerRespondOnFirstApproval` (existing vector mutants, on the executor) | completes before the k-th approval | `FC-TCA-001`, the k-1 step |
| `cerQuorumLate` (the same) | does not complete at the k-th approval | `FC-TCA-001`, the k-th step |
| `consentNonApproverApproves` (the same) | an outsider's decision is accepted | `FC-TCA-002`, the outsider's decision |
| `consentDoubleApproveCounts` (the same) | one approver is counted twice | `FC-TCA-003`, the repeated decision |
| `cerRespondWithoutEffect` (the same) | answers `granted` with no effect | `FC-TCA-001`, the k-th step |
| `noPush`, `pushedWrongThread` (the holder) | the request is never pushed, or arrives on another thread | `FC-CEX-001`, the request step |
| `cexNeverStores` (the holder) | the issued credential is not kept | `FC-CEX-001`, the issue step |
| `pushedWrongThread`, `pushedWrongType`, `pushedWrongRecipient` (the issuer) | every document the issuer pushes is addressed wrongly (its offer included) | `FC-CEX-001`, the offer step |
| `qryPresentNoNonce`, `qryPresentOtherThread` (the holder), `cexNeverStores` (the verifier) | the presentation is not bound to the query, or is not kept | `FC-CEX-002`, the query step |
| `qryAutoPresents`, `qryNoDeferral` (the holder) | a query that should wait for the human does not | `FC-CEX-003`, the query step |
| `noPush`, `pushedWrongThread` (the holder) | the approved presentation is not pushed, or on another thread | `FC-CEX-003`, the presentation step |
| `cexNeverStores` (the first person, then the second) | the credential issued to it is not kept | `FC-MAT-001`, `attest-second` (first person) or `attest-first` (second person); also `FC-MAT-002` and `FC-MAT-003` |
| `noPush`, `pushedWrongThread` (the second person) | no request on the offer's thread | `FC-MAT-001`, `request-second` |
| `noPush`, `pushedWrongType`, `pushedWrongRecipient` (the first person) | the documents it pushes, its offer included, are missing or wrong | `FC-MAT-001`, `offer-first` |
| `ceremonyDropReceipt`, `ceremonyReceiptWrongThread`, `ceremonyReceiptWrongDigest` (the responder, on the witness-share receipt) | no receipt, a receipt on a new thread, a receipt with the wrong digest | `FC-WSH-001`, `share-pr` |
| `wshDigestOverPresentation` (existing vector mutant, on the responder) | the receipt digest is the presentation's, not the credential's | `FC-WSH-001`, `share-pr` |
| `ceremonyEarlyCompletion` (proposer, then responder) | reads `completed` once the proposal is accepted | `FC-WSH-001` and `FC-WSH-002`, the propose step |
| `noSubjectBinding` (existing vector mutant, on the responder) | accepts a credential that is not about the sender | `FC-WSH-004`, `share-bounce` |
| `witnessChallengeReuse` (existing vector mutant, on the witness) | a binding replayed from another session is accepted | `FC-WSH-003`, `submit-replay` |
| `unsignedReplies` (existing vector mutant, on the witness) | the terminal answer is unsigned, so the evidence is refused by the receiver | `FC-WSH-001`, `share-pr` |
| `ceremonyDropReceipt`, `ceremonyReceiptWrongThread` (the vetter, on its acceptance of the request) | no acceptance, or one on a new thread | `FC-VET-001`, `request` |
| `ceremonyEarlyCompletion` (vetter, then applicant) | reads `completed` once the request is accepted | `FC-VET-001`, `request` |
| `vetCardUnbound` (the applicant) | the card carries a challenge that is not the session's | `FC-VET-001`, `answer` |
| `vetAcceptsUnboundCard` (the vetter) | accepts a card not bound to the session | `FC-VET-004`, `answer-unbound` |
| `vetAcceptsUncitedStatement` (the applicant) | accepts a statement that cites no session (attest without a session) | `FC-VET-005`, `attest-no-session` |
| `vetAcceptsDeclineAfterAttest` (the applicant) | accepts a decline after it holds the statement | `FC-VET-006`, `decline-after-attest` |
| `cexNeverStores` (the applicant) | the statement is not kept | `FC-VET-001`, `attest` |
| `ceremonyDropReceipt`, `ceremonyReceiptWrongThread` (the community, on its acceptance of the submit) | no acceptance, or one on a new thread | `FC-ONB-001`, `apply` |
| `ceremonyEarlyCompletion` (community on `FC-ONB-003`, applicant on `FC-ONB-001`) | reads `completed` once the request is recorded | the `apply` step |
| `noPush`, `pushedWrongThread`, `pushedWrongRecipient`, `pushedWrongType` (the community) | the submit-receipt is never pushed, or arrives on another thread, to another party or as another type | `FC-ONB-001`, `acknowledge` |
| `onbRejectAdmits` (the community) | a rejection is recorded as an approval | `FC-ONB-002`, `decide` (the community reads `completed`, not `declined`) |
| `onbVmcNeverStored` (the community) | answers the delivered credential as stored but keeps nothing | `FC-ONB-004`, `reciprocate` |
| `onbDecideUnknownAccepted` (the community) | answers a decision on an id it never minted | `FC-ONB-005`, `decide-unknown` |
| `onbVmcBeforeApproval` (the community) | stores a reciprocal credential for a pending request | `FC-ONB-006`, `vmc-early` |
| `onbAcceptsForeignHolder` (the community) | accepts a presentation held by another party | `FC-ONB-007`, `apply-foreign` |
| `onbDecideByAnyone` (the community) | takes a decision from a party it was not told is the administrator | `FC-ONB-008`, `decide-by-applicant` |

Also tested: a scenario without its connect step fails; two participants with one key are `inconclusive`; an adapter that does not offer the capabilities is `skipped` with the reason; an unreadable state is `inconclusive`, never `completed`.

## 8. Running it

```
npm run ceremony -- --participant P=reference --participant R=reference-peer [--scenario FC-VRC-001] [--out <run folder>] [--date YYYY-MM-DD]
npm run ceremony -- --participant P=reference-party:seed=130,attested --participant R=reference-party:seed=131,attested --participant W=reference-witness:mode=mint-on-verified --scenario FC-WSH-001
```

`--out` writes `scenario-result.json` (every result with its label), `transcript.jsonl` (every document as built, delivered and answered, with its SHA-256 and the carrier of each hop) and `run.json` (participants, capabilities, suite revision). Run folders are kept outside the repository, like other run records. The exit code is the runner's own (0 when every scenario completed, ended as specified or was skipped; 1 otherwise; 2 on a usage error) and is never the suite's.

## 9. Not built, and what is next

- **A live carrier mode** (participants send to each other over their own transports; `Capabilities.liveBindings`).
- **Platform runs**: VTI with itself (task-consent, credential exchange, witness session), keyring-wallet with keyring-wallet (VRC, witnessed VRC), and one VTI party with one keyring-wallet party over DIDComm v2. Each needs adapters for `initiate`, `connect` and the two observe queries on that platform, and every such run is labelled as above and only a run of two or more platforms may ever enter the interop ledger (a ledger format with the kind `complete-ceremony` is not built).
- **The other flows**: FC-WSH, FC-MAT, FC-VET and FC-ONB are built (sections 6.3, 6.4, 6.6 and 6.5; FC-MAT except for the `coDerived` anchor). FC-WSH leaves the negative steps of section 6.4 ("not claimed") unwritten: about one small step each (a party argument that corrupts one member, a repeated share), roughly half a day for all nine, no new participant state. The new flows are listed below.
- **FC-ONB, left over** (section 6.5): a `deferred` status and a supply of further evidence (the registry defines no task for it; a decision on a deferred request is `notPending`); `resendCredentials` and `credentialsDelivered` (the community issues no credential in the reference); a second decision on a decided request (`decide:notPending`: one small step and mutant, no new state); a solicitation for a DID that is not an active member (`solicit-vmc:notFound`: the same size); the submit and manifest versions in use (0.2 to 0.4) instead of the definition's 0.1, which needs the definition to be revised first; platform runs (every one of the platform items above applies, and the participant needs `initiate`, `connect`, the two observe queries and a way to be told its administrator). Channel `proposed`.
- **Expiry scenarios**, which need a deadline hook on the participant that owns the deadline.
- **Required follow-ups in other pages**: the wording rules of [docs/14](14-interoperability-tracking.md) gain the kind, once a platform run exists.

## Latest versions (decision D245, 2026-11-20)

The ceremony scenarios follow the versions the platforms serve. The task force's `vtc/member-onboarding/0.1` ceremony definition still cites `vtc/join-requests/manifest/0.1` and `submit/0.1`, older versions (the latest are 0.4 and 0.3); the FC-MBR scenarios run 0.4 and 0.3, and the FC-ONB group follows the definition as written. The witness ceremony group (WIT, [docs/29](29-witness-tasks.md)) targets version 0.1 of the witness tasks, an older version, until it is retargeted to 0.2.
