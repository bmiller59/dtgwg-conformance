# Paired ceremonies: a wallet and a service, run end to end

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This page describes the ceremony scenarios that are run between two real platforms: keyring-wallet (the member's phone) and VTI (the member's agent, a VTA, or a community service, a VTC). It builds on the scenario format and runner of [docs/25](25-ceremony-scenarios.md). Platform runs are new here. They are labelled "ran together, one pair, one carrier, one date" and are never counted with the conformance results.

## 1. What a run shows, and what it does not

- It shows that these two platforms, at the versions they speak, completed this choreography (or ended in the refusal the scenario names) on this date, with the wallet's own request code and the service's own handlers.
- It does not show conformance, and it is never added to a PASS count. The strongest wording allowed is "ran against both with the same scenarios".
- The carrier is the runner's relay (runner-carried mode). The runner hands each document the wallet signed to the service's HTTPS door, and each answer back to the wallet. No DIDComm packing, mediator or push gateway is exercised.
- The wallet runs under its own jest set-up with injected parts (a memory key store, a stand-in key creator). Parts that are stand-ins are class D and are named in the scenario text.

## 2. What was added

| Piece | Where |
|---|---|
| Wallet driver: the wallet's own request code (VtaClient, device, card-vault, step-up and sign-in modules) carried by the runner, with the wallet's own version step-down | `src/adapters/keyring-wallet/ceremony-driver.ts` (turned on with `KW_CEREMONY=on`) |
| VTI agent and community adapters in ceremony mode: a fresh service per scenario, state observers (access list, devices, credentials), triggers (`actorRole`, `seedDevice`, `seedMember`, `requireStepUp`) | `src/adapters/vti-inprocess/adapter.ts`, `src/adapters/vti/adapter.ts` |
| Reference oracle: a member phone, an agent (access list, devices, vault, step-up gate) with deliberate mutants, and the three roles of the sign-in (the browser, the community's service with 11 deliberate breakages, the member's approver), written from the specification text | `src/adapters/reference/pair-reference.ts`, `oob-starter.ts`, `oob-service.ts`, `oob-approver.ts` |
| Runner additions (all optional): `InitiateResult.continues` (a participant that runs its own flow answers a relayed reply with its next document), step kind `replay` (same, `stripProof`, `tamper`, `conflict`), check kind `reply`, `$doc:<slot>`, `$<slot>` in a stored kind | `src/ceremony/` |
| Scenarios | `vectors/ceremony-scenarios/fc-acl.json`, `fc-dev.json`, `fc-vlt.json`, `fc-stu.json`, `fc-aut.json`, written by `scripts/ceremony-pairs.ts` |

## 3. Access list and key swap (group FC-ACL)

The wallet is an admin manager of its agent. The scenarios ask the latest versions (`acl/list` 0.4, `acl/grant`, `acl/update`, `acl/revoke` 0.3; a grant at 0.3 states `purposes`, scope `any` by default); VTI main serves nothing older, so no older-version variants are kept (they would only skip). Nine scenarios: the lifecycle (list, grant, relabel, revoke, list), a manager who is not admin, revoking an unknown subject, granting twice (an idempotent re-assertion, `acl/grant` 0.3 consumer step 6), a replayed grant, a grant changed after signing or without its proof, a grant addressed to another agent, a grant signed on a clock two hours behind, and the key swap (`acl/swap-key` 0.1: the old key refused afterwards, the successor accepted). The successor key and its DID are a stand-in (a fixed Ed25519 did:key, not a did:peer).

## 4. Step-up and sign-in (groups FC-STU, FC-AUT)

**Step-up.** A gated task is held, the phone answers the approve-request with an approve-response 0.7, and the task runs once. VTA is the only service that answers 0.7; the wallet builds older versions as well. The hold's shape is where the specification and the deployed agents differ: SPEC 8.6 requires a next step, deployed agents answer `taskFailed` with `details.reason` `auth:step_up_required`. FC-STU-001 is therefore written for the overlap (either shape); FC-STU-002 asserts the specification's shape alone. Gating a task needs the service's policy enforcement switched on, which the prebuilt VTI hosts cannot do (the endpoint was added to the host source but no host was built); the VTI rows are SKIP, the reference rows ran.

**Sign-in.** A browser (the reference starter), the community (VTC) and the wallet: request, claim, the match number shown to the browser only, identify and prove, the grant, respond, redeem. Twelve scenarios: the full sign-in (FC-AUT-001); a wrong number (002); a second claim (003); a non-member (004); a cancel (005); a stranger's redeem (006); a proof after a cancel (007); a respond under a key that is not the lock (008); a grant for a digest other than the one shown (009); an identify with a broken signature (010); a version step-down against a community from before the 2026-10-24 renaming (011); and a wallet that only knows claim 0.1 meeting a current community (012). Scenarios 008, 009, 010 and 012 need an approver that sends deliberately broken or older documents (capability `initiate.oobTamper`, class D: a wallet never sends them), so a wallet is SKIP for them, classified as scope. Scenario 011 needs the service to be told which versions it serves (`trigger.serveVersions`, a deployment's release): only the reference service offers it, so a platform host is SKIP for it.

*Versions.* The community (VTC) serves request 0.2, claim 0.2, prove 0.3, respond 0.3 (grant 0.3), redeem 0.2 and cancel 0.1; the wallet asks claim 0.2 then 0.1 and prove, grant and respond 0.3 then 0.2 then 0.1. The overlap is the newest of each, so the wallet does not step down against the VTC; step-down is exercised against the reference service in its `legacy` profile (claim 0.1; prove, grant, respond 0.1 and 0.2; instants as epoch seconds). Nothing is claimed beyond the overlap: a scenario that completes against the VTC completes at the versions both serve. The request ladder is not exercised (the starter opens requests at 0.2 only).

*Origin and the portal's URL.* The VTC accepts `auth/oob/request` only from the portal's own origin (request 0.2, service item 3). With a configured `public_url` the `Origin` header must equal that URL's origin exactly; the request's own address and the Host header do not count (`vtc-service/src/member_portal/oob.rs portal_origin`). The starter's first run sent the origin of the host's loopback address, which that rule refuses; the in-process host configures `http://vtc.test`. The adapter now sends the public URL (read from the host's `/ctl/info` `publicUrl`; for a host that does not report it, the fixed `http://vtc.test` of the prebuilt hosts; `VTI_PUBLIC_URL` overrides). With that, `auth/oob/request` is accepted by both prebuilt hosts. The community's DID document, a class D stand-in, names `TrustTaskHTTPS` and `SignInPortal` on that public URL, spelled as VTI's own `trust_task_https_service` and `sign_in_portal_service` build them.

*What stops a platform run at the claim.* The prebuilt hosts' public URL is `http://vtc.test`. The portal origin in step 1 must match `^https://[^/?#\s]+$` (shared `Origin` schema), and the VTC checks its own step 1 against that schema, so the claim is answered `internalError` ("step 1 does not match its specification"); the wallet independently reads only https service endpoints without a port and answers `noSignIn`. This is the host's configuration (class D), not a difference of VTI from the specification. A host built from this branch's source reads `VTC_HOST_PUBLIC_URL` (the launcher sets `https://vtc.test` for the ceremony track) and reports it; no such host was built here. Until one is, the platform rows stop at the claim and say so; they are never counted as completed.

*Class D stand-ins.* The member's agent (identify and grant are signed with the wallet identity's own key, as the driver's stand-in does), the phone's user-verification approval (none), the community's DID document (a did:key with the two services a did:webvh would publish), the starter's `Origin` header (a browser's), the reference service's portal (`https://portal.example`), and the held redeem poll (answered at once by the reference service). The reference service signs the respond answer (assertionMethod); the specification's examples show it unsigned, VTI signs it, and the wallet requires it (spec-silent, draft issue not filed). `unsupportedVersion` carries `details.servedVersions` as Type URIs (VTI and the reference implementation); the specification does not name the member, so it is not asserted.

## 5. Devices (group FC-DEV)

Register, heartbeat, list, set-wake, and the wallet's own remove flow (wipe, then revoke); a wipe that leaves the access-list entry (the binding stays, marked wiped; FC-DEV-007 reads it back with both `includeWiped` and `includeDisabled`, because the list specification gives `includeDisabled` the meaning "include devices with `disabledAt` set", gives `includeWiped` no text and does not say a wipe disables, while VTI sets `disabledAt` on a wipe; the earlier reading sent `includeWiped` alone and over-read the specification, a class B suite defect fixed on the adapter side); a repeated register, a heartbeat or wake before register, an unknown wipe target, a replayed register. A second phone is a stand-in registered by the adapter.

## 6. Vault (group FC-VLT)

The wallet files a community card in its agent's vault, then restores it by query and get; an empty restore. The card is a class D stand-in for a community's. `vault/sign-trust-task` and the persona tasks are not built (they need the sealed persona key and a real agent identity).

## 7. Non-vacuity

The oracle pair completes every scenario, and each mutant of the reference agent ends the scenario that watches for it `failed` (`test/ceremony-pairs.test.ts`). The mutants cover the revoke that keeps the entry, a non-admin grant, an executed replay, no proof check, no recipient check, no window, a swap that keeps the old key, a repeated register, a wipe that deletes, a heartbeat before register, an empty vault, an ungated task, an accepted unknown challenge and a denial that elevates. The sign-in oracle trio (starter, service, approver) completes the twelve FC-AUT scenarios, and each of the service's eleven breakages (a second claim accepted, no number check, a non-member accepted, an unsigned or wrong-origin claim answer, a cancel that does nothing, a redeem by any key, no digest check, a respond under any key, a session before approval, an identify whose signature is not checked) ends the scenario that watches for it `failed` (`test/signin-pairs.test.ts`). The step-down scenario FC-AUT-011 is checked to step down (claim 0.2 then 0.1, prove 0.3 then 0.2, grant and respond at 0.2).

## 8. Spec maturity and source

Every task cited is a Trust Tasks specification with status draft (the task force repository, no candidate or standard task exists). The choreography around the tasks is the suite's own, channel `proposed`. Where a scenario reads text that is newer than a platform (SPEC 8.6), it says so and the difference is class A in the run's issues file.

## 9. How to run

```
KW_CEREMONY=on ... npm run ceremony -- --participant K=stdio:<keyring-wallet launcher> --participant V=stdio:<vti-inprocess launcher> --scenario FC-ACL-001 --reuse --out <run folder>
```

Environment for each launcher is in its header. Run records are kept outside the repository; pages cite run names only.

## Latest versions (decision D245, 2026-11-20)

Paired runs measure the versions both platforms speak. The target is the latest version of each task: where a paired scenario names an older version (the witness ceremonies at 0.1, the onboarding definition's join-request tasks at 0.1) the scenario is labelled non-focus in the coverage matrix and stays runnable; it is not a headline figure.
