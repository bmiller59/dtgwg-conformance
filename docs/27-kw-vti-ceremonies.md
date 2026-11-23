# KW-to-VTI ceremonies: task-consent and credential exchange

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This page describes the first ceremony set run between keyring-wallet (KW, the wallet) and the verifiable-trust-infrastructure (VTI) services, and the reference oracle that stands beside them. A ceremony here is several Trust Tasks between named roles, tied together by a thread, run from the first document to an end state that each participant reads for itself. The finer layer, the per-task unit vectors, stays in the normal vector groups; this layer shows the tasks working together.

Both groups are channel `proposed` and non-gating (decisions register, kv-scope). Everything on this page follows [docs/25](25-ceremony-scenarios.md): the result of a scenario is evidence of kind `complete-ceremony`, labelled "ran together, one pair, one carrier, one date", and it is never counted as conformance, never a PASS and never in a headline figure.

## 1. What is built

| Group | Ceremony | Scenarios | Roles |
|---|---|---|---|
| `FC-KVC` | task-consent: an executor holds a gated task for consent, approvers decide, the task executes once | 15 (001 to 014 and 101) | executor (the VTA or the reference oracle), approver and outsider (the wallet or the reference) |
| `FC-KVX` | credential exchange, presentation leg: a verifier queries, the holder's person decides, the holder presents | 5 | verifier (the community service, VTC, or the reference oracle), holder (the wallet or the reference) |

The scenario source is `scripts/ceremony-kv-scenarios.ts` (imported by `scripts/generate-ceremony-scenarios.ts`); the generated files are `vectors/ceremony-scenarios/fc-kvc.json` and `fc-kvx.json`. The steps are written so that any executor or verifier and any approver or holder can play a slot: the step kinds are the same, and each participant builds and signs its own documents with its own code. No scenario gives the executor a number of approvals or a role name; the `consentSetup` step names the approver set the scenario uses and the executor's own policy decides the rest.

### 1.1 FC-KVC scenarios

| Id | What it shows | Ends as |
|---|---|---|
| 001 | one approver: the gated task is refused for consent, the decision is accepted, the re-submit executes once | completed |
| 002 | two approvers, both required: one decision holds the task, the second lets it run | completed |
| 003 | an outsider holding a copy of the request is refused `notAnApprover` and not counted | completed |
| 004 | the same decision delivered twice is absorbed (SPEC.md 7.2 item 11) and counted once | completed |
| 005 | the approver denies: nothing executes | aborted |
| 006 to 012 | one tampered decision is refused and not counted, then the real one completes: wrong proof purpose, no proof, bad signature, wrong recipient, stale `issuedAt`, wrong `payloadDigest`, wrong `challenge` | completed |
| 013 | version skew: an executor serving only `decision/0.1` refuses the wallet's 0.2 decision as `unsupportedVersion`; the wallet steps down once by its own ladder | completed |
| 014 | an approver who decides twice with two different documents is counted once | completed |
| 101 | decision leg only, for a host whose gate cannot be switched on (section 3) | refused (`noPending`) |

### 1.2 FC-KVX scenarios

| Id | What it shows | Ends as |
|---|---|---|
| 001 | the query is deferred until the wallet's person approves; the presentation is accepted on the query's thread | completed |
| 002 | the person declines: nothing is presented | declined |
| 003 to 005 | a presentation document with no proof, a bad signature, or another recipient is refused and kept nowhere | refused |

## 2. The choreography and its stand-ins

Each stand-in is class D (a stand-in the suite supplies where the real step needs something it does not have). Each is named in the scenario that uses it and in the run's issues file.

1. **The requester.** The party that submits the gated task is a harness identity inside the executor's adapter (it holds the `admin` role at the VTA, so that only consent is missing). It is not a participant and decides nothing. For the VTA the gated task is `acl/grant/0.3` (with the required `purposes`); the effect is read back from the VTA's own access list, never from the adapter's record of its own re-submit.
2. **The deployment's consent configuration.** A VTA reads `policy.enforcement` and `policy.approver_sets` from its configuration file, and nothing on the wire sets them. The host (`src/adapters/vti-inprocess/rust`) exposes them through `/ctl/policy`, as it already exposes the trusted-verifier list. The rule itself (`requireConsent` for `acl/grant/0.2`) is written over the wire with `policy/upsert/0.3`.
3. **The carrier.** The runner relays documents (runner-carried mode); no mediator is used. The signed `task-consent/request` documents the VTA mints travel in its refusal (`details.consentRequests`), so the runner relays those; a real deployment pushes them. The wallet's approver-device ingestion of a request (`vtaAgent.ts`) needs a live agent session and is not driven: the wallet adapter keeps the request in an inbox, accepting it only from an executor the approver was enrolled with (`enrolExecutor`).
4. **The outsider's copy.** The VTA never asks a party outside its approver set, so the outsider's copy of the request is the first request re-addressed and unsigned.
5. **The negatives.** A real approver never sends a tampered decision. The wallet or the reference builds the decision with its own code; `src/ceremony/tamper.ts` then changes one thing and, where needed, signs again with the participant's own key.
6. **What is the participant's own.** The wallet's decision is built by its own `VtaClient.decideConsent` (own signature, own proof purpose, own choice of version); in scenario 013 the version it tries next is chosen by its own `TaskVersions` ladder from the refusal the peer really sent. The VTA's refusal, signed requests, decision handler, grant and execution are the VTA's own. The wallet's credential-exchange handling (`handleInboundCredentialExchangeQuery`, `respondToCredentialExchangeQuery`) is the wallet's own; the presentation signature is a stand-in of the existing shim (it signs the credential in place of Credo).

## 3. The decision leg alone (and why the full ceremony needs a rebuilt host)

The VTA's consent gate only runs when `policy.enforcement` is on. The host exposes it through `/ctl/policy` (and `/ctl/enforce`); the older prebuilt host binaries predate both routes, so against one the adapter detects the missing route and offers only the role `executor-leg`. A host built from this source (rustc 1.95, one niced build in its own target directory) has the routes and offers `executor`; the run records of 2026-11-19 (consent-gate rows) ran all fourteen full scenarios against it.

- `FC-KVC-001` to `014` are skipped with the reason "role not offered", never silently passed.
- `FC-KVC-101` runs: the harness stands in for the request (unsigned, a fresh binding), the approver's real decision goes to the VTA, and the VTA verifies the signature and routes the document before it looks up the pending request and answers `noPending`. That shows the wallet's decision document is well formed, correctly signed for `assertionMethod` and routed by the VTA; it shows nothing about the gate, the grant or the execution.

To run the full set: rebuild the host as the account that owns the dependency cache (`cargo build` in the existing host build directory, after copying `src/adapters/vti-inprocess/rust/src/main.rs` over its `src/main.rs`), then run the same commands; the adapter detects the route and offers the role `executor`.

## 4. Credential exchange

The wallet is a holder only. It answers a verifier's query through its own handler; it never builds `credential-exchange/offer`, `request` or `issue` (it redeems an invitation offer by an HTTP request to the community, `vtiInvitationOffer.ts`, which is not the Trust Task). So the issuing leg has no wallet-to-VTI pair and is not built here (section 6). The presentation leg is: the community's administrator asks the VTC for a credential query for the holder (`vtc/join-requests/query/0.1`), the VTC signs the query and hands it to its push engine, the adapter reads it from the host's push records (these are observable, which corrects an earlier note that VTC pushes cannot be seen), the wallet defers it for its person, the person decides, and the presentation is relayed to the VTC's door.

The VTC then verifies the presentation against the criterion the query was built from and decides the join request. Whether the wallet's presentation is accepted depends on the credential it holds: the shim's held credential is a stand-in signed by a suite key the VTC has no reason to trust. A run against the VTC therefore measures the wire (the query reaches the wallet, the wallet answers, the VTC's refusal reaches the wallet), not a successful admission.

## 5. Version skew

Two kinds, never counted as a pass:

- **Decision 0.1 against 0.2** (scenario 013). The wallet's ladder is 0.2 then 0.1; vta-service v0.60.0 to v0.66.0 served 0.1 only, and from 0d3f268e (2026-10-28) it serves 0.2 only. The scenario needs an executor that serves only 0.1; the reference oracle does so on request (`dv=0.1`), with a refusal that names the served version the way a VTA's does. The VTA at the pinned ref serves 0.2 only, so the wallet's first rung matches and no step-down occurs against it: that is the absence of skew, not a stepped-down success.
- **Step-up `approve-response`.** The VTA serves 0.7 only; the wallet builds older rungs first. The ceremony needs the same switched-on gate (a `requireStepUp` rule), so it waits on the same host rebuild and is not built.

## 6. Not built, and why

Every SKIP and every gap is one of four kinds: platform (the platform does not offer it), suite limit (the harness cannot do it yet), spec-silent (the specification does not say) or scope (not a Trust Task, or no pair exists). The table gives the kind.

| Item | Why |
|---|---|
| The full consent ceremony against the VTA | ran against a rebuilt host (section 3); against a prebuilt host older than `/ctl/policy` it stays a suite limit (role `executor-leg` only). |
| Offer, request and issue (credential exchange) with the wallet | platform (the wallet): the wallet never builds those tasks (section 4). The VTA and the VTC as holder or issuer have no wallet counterpart. |
| A credential the VTC accepts | suite limit, firm for now: needs a credential chain (an issuer the community trusts), which the shim does not have. |
| Replay of a presentation | suite limit, work: the runner's `relayPushed` delivers each pushed document once. |
| Step-up approve-response skew | suite limit, work after the host rebuild (section 5). |
| The VTA as holder against the reference as verifier (the existing `FC-CEX` scenarios with the VTA in a slot) | suite limit, work: the VTA adapter has no `initiate` and `ceremony` reading for credential-exchange threads yet. |

## 7. How to run

```
npm run ceremony -- --reuse --date <YYYY-MM-DD> \
  --participant E=reference-party:seed=97,k=1,approvers=A+B,cosign \
  --participant K1='stdio:node --experimental-strip-types src/adapters/keyring-wallet/launcher.ts' \
  --participant O=reference-party:seed=100 --scenario FC-KVC-001 --out <run folder>
```

Participant specs: `reference-party:seed=<n>[,k=<k>,approvers=<A+B>][,cosign][,attested][,dv=0.1][,mut=<mutant>]`; the VTA is `stdio:... src/adapters/vti-inprocess/launcher.ts` with `VTI_ROOT` and `VTI_INPROCESS_BIN`; the community service is `stdio:... src/adapters/vti/launcher.ts` with `VTI_VTC_BIN`; the wallet needs `KW_ROOT` and a jest cache (`KW_JEST_CACHE`). `--reuse` keeps one adapter per slot across scenarios (the wallet's jest host takes minutes to start). Check memory and load first and run under `nice -n 10`.

## 8. Non-vacuity

`test/ceremony-kv.test.ts` runs both groups on the oracle alone (every scenario completes or ends as specified) and then 15 deliberate mutants of the oracle's executor or verifier, each aimed at one scenario, each of which must make that scenario end `failed` at the step named in the test. One scenario, `FC-KVC-010` (stale `issuedAt`), has no isolating mutant: the two window mutants also break the gate step, so the test cannot say which rule failed; the oracle's refusal of the stale decision is tested, and the gap is named here.
