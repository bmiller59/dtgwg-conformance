# Onboarding and identity-vetting ceremonies: a wallet and a community, run end to end

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This page describes two ceremony groups run between a member's wallet (keyring-wallet) and a community service (VTI's VTC): `FC-MBR`, joining a community, and `FC-IDV`, the community's part of identity vetting. They use the scenario format and runner of [docs/25](25-ceremony-scenarios.md) and the paired-ceremony machinery of [docs/26](26-paired-ceremonies.md). They are on the `proposed` channel, advisory and non-gating, and are never counted with the conformance results.

## 1. What a run shows, and what it does not

- It shows that these platforms, at the versions they speak, completed this choreography (or ended in the refusal the scenario names) on this date, using the wallet's own request code and the community's own handlers. The strongest wording allowed for two platforms is "ran against both with the same scenarios".
- It does not show conformance and is never added to a PASS count. A SKIP is reach, not failure, and is always classified.
- The carrier is the runner's relay (runner-carried mode): the runner hands each signed document to the community's HTTPS door and each answer back to the wallet. No DIDComm packing, mediator or push gateway is exercised, so a push is observed as a record the community handed to its delivery engine, not as a delivery.
- The administrator is the community's own console, never a wallet: a decision and a vetter grant are injected through the community participant's `trigger` and signed by the community's seeded administrator, through the community's door. That is a class D stand-in for an operator.

## 2. What was added

| Piece | Where |
|---|---|
| Community and member oracle, written from the specification text: a community serving the join family and the vetting directory, with 13 deliberate mutants, and a member who joins and publishes a vetter profile | `src/adapters/reference/join-reference.ts` (adapter specs `reference-community[:mut=...]`, `reference-joiner`) |
| Wallet driver kinds `join-manifest`, `join-apply`, `join-status`, `join-withdraw`, `join-supplement`, `vetter-profile`: the wallet's own community controller (`vtiAgent`: fetch the manifest, apply with its version and refusal handling, poll, withdraw, supplement) and its vetter desk's profile publication | `src/adapters/keyring-wallet/ceremony-driver.ts` |
| VTI community adapter, ceremony mode: triggers `knowApplicant`, `decide`, `grantVetter`; stored kinds join requests by status, a DID as a member, push records by task type, the administrator's answers by code, listed vetters | `src/adapters/vti/adapter.ts` |
| Community host: the boot steps `vtc`'s server start makes and the test-support state omits (default policies, the two status lists), and `/ctl/resolve` | `src/adapters/vti/vtc-host/src/main.rs` |
| Two optional capability names: `initiate.vetterDirectory`, `initiate.foreignPresentation` | `src/adapter/contract.ts` |
| Scenarios | `vectors/ceremony-scenarios/fc-mbr.json`, `fc-idv.json`, written by `scripts/ceremony-onboarding.ts` |

## 3. Member onboarding (group FC-MBR, 17 scenarios)

The choreography is the one of the member-onboarding ceremony definition (applicant, community, administrator): discover the criteria, apply, the community's decision, the applicant's poll, with the optional supplement and the reciprocal credential. The scenarios run at the versions the platforms serve: `vtc/join-requests/manifest` 0.4 and `submit` 0.3. **The definition cites submit and manifest 0.1; the retired `vtc/join-requests/submit/0.1` stays a documented step of it and is not claimed here**: no step of any scenario sends it, and the existing reference-only group FC-ONB (which keeps the definition's 0.1 shape) is unchanged.

| Id | What it checks |
|---|---|
| FC-MBR-001 | criteria, apply, queued for review, the administrator approves, the poll reads approved; one approved request, the applicant a member, the membership credential and the role credential handed to delivery (two push records) |
| FC-MBR-002 | the administrator rejects with a reason: the poll (naming the request) reads rejected with that reason; not a member |
| FC-MBR-003 | withdraw; the poll naming the request reads withdrawn; the applicant may apply again |
| FC-MBR-004 | a second application while one is open: `vtc/join-requests/submit:requestAlreadyOpen`; one request |
| FC-MBR-005 | version skew: submit at 0.2 to a community that serves 0.3: `unsupportedVersion` naming what it serves, the wallet's own handling reads the criteria again and submits at 0.3, one request |
| FC-MBR-006 | the signed submission delivered again after admission: no second request |
| FC-MBR-007 | the submission with a payload value changed after signing (fresh id and own id) and with its proof removed: `proofInvalid`, `idConflict` or `proofInvalid`, `proofRequired` |
| FC-MBR-008 | an application addressed to another community: `wrongRecipient`, nothing recorded |
| FC-MBR-009, 010 | a decision on a request id never minted: `decide:notFound`; a second decision on a decided request: `decide:notPending` |
| FC-MBR-011 | an outsider's poll: `status:notFound` |
| FC-MBR-012 | a member with no administrative authority decides: `permissionDenied`, request unchanged |
| FC-MBR-013 | a presentation naming another holder than the signer: `submit:presentationInvalid` |
| FC-MBR-014 | the wallet's clock two hours behind: refused as stale, nothing recorded |
| FC-MBR-015 | the poll without the request id after a rejection must not leave the applicant believing the request is pending or approved |
| FC-MBR-016, 017 | supplement of a pending request: `supplement:notAwaitingEvidence`; supplement by an outsider: `supplement:notFound` |

**Version skew.** The community serves manifest 0.4 only (0.3 and 0.2 are answered `unsupportedVersion`) and submit 0.3 only; the wallet asks the manifest newest first (0.4, then 0.3, then 0.2) and submits at the version the manifest answers to, so against the community the overlap is the newest of each and no step-down happens on its own. FC-MBR-005 makes the wallet speak 0.2 (a class D stand-in for an older community's version) to walk its own refusal handling; what it claims is that the wallet's code recovers once, not that the wallet speaks 0.2.

**Not built.** The reciprocal credential (`vtc/members/solicit-vmc`, `request-vmc`, `vmc`): the wallet's member credential is built from the community's membership credential, which reaches it as a push the relay does not deliver, and the community's request to the member is also a push. The invitation variant (`vtc/invitations/*`, redeemed by an OpenID4VCI request) and the removal notice are not built either (suite limit).

## 4. Identity vetting (group FC-IDV, 8 scenarios)

Identity vetting has two legs. The **peer leg** (`vetting/request`, `session`, `attestation`, `decline`) runs between an applicant and a vetter, who is a member or an openvtc client. The **community leg** is the community as directory and revocation host: `vtc/vetting/vetters/{grant, profile, list, show, resend}` and `vtc/vetting/revoke-statement`.

**Does any VTI service handle `vetting/request`? No.** The community answers `vetting/request`, `session`, `decline` and `attestation` with `unsupportedType` (probed on a community host, scenario FC-IDV-008), and the VTI source has no handler for them in the community or the agent: the types exist only in the client SDK's wire types (applicant to vetter). VTI's role in vetting is the community; the peer leg is wallet to wallet (or to an openvtc client) and stays on the reference scenarios (FC-VET). A wallet-to-wallet vetting run needs a second wallet identity, a ticket and match code, and the card and statement verification of the upstream library; it is not built (work).

**What the wallet sends to the community.** The wallet defines the constants for `vetters/list` and `revoke-statement` but sends neither (no call site), and it never sends `vetters/show` or `vetters/grant`: the only community-leg task it sends is `vetters/profile` (its vetter desk). So the wallet rows run the grant (the community's administrator) and the profile publication, and the rest is played by the reference member (class D stand-in for a member that sends them), against the same community.

| Id | What it checks | Played by |
|---|---|---|
| FC-IDV-001, 002 | administrator grants, the vetter publishes a listed profile (listed); unlists (not listed) | wallet, reference member |
| FC-IDV-003 | a member with no grant publishes a profile: refused, not listed | wallet, reference member |
| FC-IDV-004 | `vetters/show`: a granted vetter reads live, a DID with no grant reads none | reference member |
| FC-IDV-005 | `revoke-statement`: recorded; the same notice again returns the original time | reference member |
| FC-IDV-006 | granting the same member twice: listed once | wallet, reference member |
| FC-IDV-007 | `vetters/list` names a listed vetter, and is empty after it unlists | reference member |
| FC-IDV-008 | `vetting/request` sent to the community: `unsupportedType` | reference member |

## 5. Non-vacuity

The oracle pair completes every scenario (`test/onboarding-pairs.test.ts`), and each of the community's 13 deliberate mutants ends the scenario that watches for it `failed`: admits on submit, decides an unknown id, decides for anyone, no proof check, withdraw that keeps the request pending, a second open request, a repeated decision, a wrong recipient accepted, a supplement of a pending request, a profile without a grant, an unlisted vetter still listed, `show` always live, a revoke that is not idempotent.

## 6. Rows and results

Counts are read from each row's `scenario-result.json`. All rows are separate. 25 scenarios (17 + 8).

| Row | Member | Community | Completed | Ended as specified | Failed | Skipped |
|---|---|---|---|---|---|---|
| `oracle` | reference member | reference community | 17 | 8 | 0 | 0 |
| `oracle-mutants/<mutant>` | reference member | reference community with one mutant | the watching scenario fails (13 of 13) | | | |

No row against the original VTI community (26d0da81) exists: its host was not built. Run records are kept outside the repository; this page cites run names only.

## 7. Differences, classes and skips

| Item | Class | Note |
|---|---|---|
| The community host omitted the boot steps of `vtc`'s server start: without default policies a join submission answers `internalError`; without the status lists an approval admits the applicant (ACL row and member record) and then cannot mint the credential, so the request stays pending and a retry is refused as a duplicate membership | D (host configuration) | Fixed on the suite side (`VTC_HOST_BOOT`, the same calls the real server makes). Separately noted: the approval writes the admission before it issues the credential, so a failure leaves a half-applied admission; the specification says nothing about atomicity (spec-silent) |
| The poll without the request id after a rejection is answered `status:notFound` (`no open join request`); with the id it reads `rejected` with its reason | unsettled | The status specification's abstract says an applicant whose first reply was lost polls from its own DID and that a refusal it cannot ask about is a refusal it cannot act on; its security note describes the id-less form as a mapping to the *open* request. FC-MBR-015 accepts either `rejected` or `notFound` and fails only on pending or approved. Draft question, not filed |
| The applicant's second submission is refused under the consumer-minted code `submit:requestAlreadyOpen`, the supplement of a pending request under `supplement:notAwaitingEvidence` | none | Consumer-minted under the task's slug (SPEC 8.5) for the first; declared by the specification for the second |
| FC-MBR-013 (foreign presentation), FC-IDV-004, 005, 007, 008 for the wallet | SKIP, scope | The wallet never builds a presentation naming another holder, and sends no vetters list, show, revoke-statement or vetting request to a community; the reference member plays them (capabilities `initiate.foreignPresentation`, `initiate.vetterDirectory`) |
| The member's wallet and the person: the persona identity, the criterion choice, the directory statement the person was shown, the administrator, the community's DID document and the push recipient's document | D | Stand-ins named in the scenarios and the driver |
| Not built | suite limit | reciprocal credential, invitation variant, removal notice, the deferred and supplemented evidence path (needs a criterion the community defers on), hidden vetting |

## 8. How to run

```
VTI_VTC_CEREMONY=1 VTI_VTC_BIN=<community host> ... npm run ceremony -- --participant V=stdio:<community launcher> --participant K=stdio:<wallet launcher> --scenario FC-MBR-001 --reuse --out <run folder>
```

The reference pair needs no platform: `--participant V=reference-community --participant K=reference-joiner`. Environment for each launcher is in its header; a community host built from this source reads `VTC_HOST_PUBLIC_URL` and `VTC_HOST_BOOT` (the launcher sets both for the ceremony track).
