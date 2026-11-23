# 36. Wire rows: ceremonies over a real DIDComm v2 wire

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. Nothing here is a claim of conformance by any implementation.

A **wire row** is a ceremony row (docs/25, docs/26) in which the participants do not hand documents to the scenario runner. The wallet builds, signs, packs, sends and reads every document itself, through a real mediator, to a live agent container. It is a new row kind (`wire` in `results/ceremony-rows.json`), printed apart from the in-process rows (`oracle`, `platform`) and never replacing them. Its outcomes are evidence of kind `complete-ceremony`: one pair, one carrier, one date. They are never conformance counts and are never added to a PASS total.

## 1. What runs

| Part | What it is |
|---|---|
| Wallet | keyring-wallet's own `VtaClient`, `VtiMediatorSession` and `VtiMediatorTransport` under the wallet's own jest (`src/adapters/keyring-wallet-vta-wire/wire-host.jest.ts`, `wire-agent.ts`). The ceremony kinds (`acl-grant`, `vault-keep-card`, `step-up-unprompted`, ...) are the same driver the in-process wallet row uses (`src/adapters/keyring-wallet/ceremony-driver.ts`, wire mode), so a scenario means the same thing on both rows. |
| Wire | DIDComm v2 authcrypt (`ECDH-1PU+A256KW`, `A256CBC-HS512`), Routing 2.0 `forward`, messagepickup 3.0 live delivery over a bearer WebSocket, the mediator's `affinidi.com/atm/1.0/authenticate` login; the mediator is the kit's image `mediator-buildathon:e6e2c636` (0.48.0). |
| Agent | the kit's VTA container `vta-buildathon:26d0da81`, with policy enforcement on (the starter's approvals seed). |
| Compose | one project, one network, started once per run (`src/adapters/keyring-wallet-vta-wire/stack/docker-compose.yml`), torn down at the end. |

## 2. The adapter

Two stdio JSON-RPC adapters, one command (`launcher.ts --role K|V`), so the ceremony runner drives the row like any other:

```
npm run ceremony -- --participant 'K=stdio:<node> launcher.ts --role K' --participant 'V=stdio:<node> launcher.ts --role V' --scenario FC-ACL-001 --reuse
```

- **K, the wallet** (`member-phone` in FC-ACL, FC-VLT, FC-STU). Declares `initiate`, `peer.connect`, `observe.ceremony`, `observe.received`, `transportIdentity`, `clockFree`, the kinds of the driver, and the mode label `wire`. `initiate` runs the wallet's call to its end and returns the documents that crossed the wire with `sent: true`, so the runner relays nothing. A reset gives the wallet a new manager DID, because the agent keeps a step-up elevation per DID across reconnects.
- **V, the agent** (`agent`). Declares the task types the live VTA lists in discovery, `trigger.requireStepUp`, and the same observe queries. It reads and sets up the agent through an **operator** identity over REST (`operator.ts`: `auth/challenge`, `auth/authenticate`, signed Trust Task documents), the harness's stand-in for an operator console. A document handed to V's `send` (a replay, a tampered copy) is carried over the wallet's wire as the wallet's DID. A document from any other identity is refused as not offered, never faked.
- One host, started once (`wire-host-up.ts`), serves both roles when `KW_WIRE_HOST_URL` names it; without it each launcher starts its own.

## 3. Stand-ins (class D, named in every run record)

1. The mediator's DID is resolved by a `did:webvh` resolver over plain HTTP that does not verify the log, unless the run uses `KW_WIRE_RESOLVER=real`, which is the wallet's own resolver with only the scheme of its one fetch changed (https to http for a loopback host). The original wallet cannot read the mediator 0.48 DID document on that path (section 5).
2. The VTA is a `did:key` and publishes no service, so the mediator is handed to the client (the default; with the loopback mediator image and `VTA_DID_KIND=webvh` the VTA is a `did:webvh` that publishes its own, and the mediator is still handed over, section 8).
3. The wallet's DID is made an admin on the agent's access list by the operator, not by the enrolment ceremony.
4. In-memory stores; the wallet's `Date.now` is the real clock.
5. The operator observes the agent's access list over REST; the vault count is read through the wallet's session (the vault is the caller's).

## 4. What is not carried, and why

- **A moved clock** (FC-ACL-008): the mediator and the agent check the same moved time; a faked `Date` breaks the login. Not reached.
- **Key swap** (FC-ACL-009): the scenario fixes a stand-in successor `did:key` that has no keys on this wire. Not reached; a real swap needs a second mediator login as the new key.
- **Harness actors as senders** (the vector layer): only the wallet's DID has keys on this wire. Vectors whose sender is a harness actor are not reachable through `send` on this row (V refuses them as not offered). Reaching them needs a per-actor DIDComm identity (an Ed25519 and an X25519 key in the wallet's key store per actor, a login per actor, an access-list entry per actor).
- **Community (VTC) ceremonies** (FC-MBR, FC-IDV) run on this row since part 4 (section 9); FC-AUT is not (a port-free https sign-in address, class D).
- **FC-KVC scenarios needing a second approver or an outsider** (002, 003, 004, 014), **a decision changed or replayed after signing** (006 to 012: the wallet signs and sends its own decisions, the harness has no copy of its key) and **an executor serving only decision 0.1** (013): not reached (class D). Scenario 101 is the in-process executor-leg role, not offered here.

## 5. The mediator DID document

Mediator 0.48 writes every service `type` as an array (`["DIDCommMessaging"]`). DID Core 1.0 section 5.4 says a service `type` is a string or a set of strings, so the document is valid. Credo's `DidDocumentService` validates it as a string only, so the wallet's real resolver path (`RetryingWebVhDidResolver`, then `resolveVtiMediator`) fails with `DidCommV2Service ... type must be a string` (`resolver-check.jest.ts` records it). The wallet row keeps the stand-in of section 3 item 1.

## 6. Reading the outcomes

The generated ceremony table prints the wire rows with kind "wire rows (real DIDComm v2 wire, live agent)". An outcome other than `completed` or `ended-as-specified` is classified A to D (decisions D12, D13, D334): A, the platform differs from the specification text; B, the scenario over-reads it (the scenario is fixed); C, a question for the specification; D, a stand-in or deployment limit of this row. No outcome here changes a conformance count.

## 7. FC-KVC on the wire (part 3)

The live VTA is the executor and the wallet the approver. A harness requester (an identity over REST holding `admin`, class D, as in the in-process row) submits the gated `acl/grant/0.2`; the VTA refuses it for consent, **pushes its signed `task-consent/request` to the wallet over the mediator** (the wallet keeps it only from an executor it was enrolled with), the wallet's own `VtaClient.decideConsent` builds, signs and sends the decision, and the requester's re-submit executes the grant once. The deployment's approver set is the VTA's own declarative approvals row (`approvals-row.ts`: `policy/upsert/0.3` with the Rego the VTA re-derives and byte-compares; pinned at 26d0da81), so no configuration file or restart is involved (the in-process row needs the host's `/ctl/policy`). Runner slots are `E` (V) and `K1` (K): `WIRE_SLOT_K=K1 WIRE_SLOT_V=E run-ceremony.sh`.

## 8. The loopback mediator and the VTC leg (part 3)

The pinned mediator refuses a loopback `did:webvh`. `stack/mediator-loopback.patch` (README in `stack/`) is a test-only change in a copy of the kit: the mediator's resolver cache is built with `HostPolicy::AllowPrivate`; the image is `mediator-buildathon:e6e2c636-loopback` and the pinned tags are untouched. With it the VTA (`VTA_DID_KIND=webvh`) and the VTC are `did:webvh` on loopback hosts and both log in; the wallet's signed `vtc/join-requests/manifest/0.4` crosses the wire to the VTC and back (`vtc-grant.ts` is the VTC's one-time set-up grant). Class D: the mediator resolver setting is test infrastructure, not the thing under test; the wallet's did:webvh resolution is the stand-in of section 3. Not fixed, stated: wallet sign-in (C01, FC-AUT) reads only https endpoints without a port from the community's DID document, and a local VTC publishes `http://localhost:<port>`.

## 9. The community ceremonies on the wire (part 4)

`launcher.ts --role C` is the live, original VTC (`vtc-buildathon:26d0da81`, a `did:webvh` on a loopback host behind the loopback mediator of section 8) as the community of FC-MBR and FC-IDV, with the wallet as the applicant, member and vetter (`vtc-adapter.ts`; `WIRE_ROLE_V=C run-ceremony.sh`). The community's administrator is the starter's admin `did:key` over the VTC's REST trust-task door (`<url>/v1`, class D: the administrator's console). `seedMember` is the administrator's own `vtc/members/admit`; `decide` and `grantVetter` are the VTC's own tasks; a member with no administrative authority signs a task with no session and is answered `permissionDenied`. Every read names the wallet's current DID (a live community keeps earlier scenarios' records). The community's pushes (`credential-exchange/issue`) are read from the wallet's own inbound log. A rate-limited document (429) is asked again after `Retry-After`.

Outcomes of the last batch (ceremony outcomes, never conformance counts): FC-MBR-001, 002, 003, 005, 009, 010, 011, 012, 015 and FC-IDV-001, 002, 006 completed; FC-MBR-004, 008, 016, 017 and FC-IDV-003 ended as specified (the wallet's call refused with the community's code); not reached, class D: FC-MBR-006 and 007 (the scenarios replay the relay's second document; the wallet reads the manifest over HTTPS, so only the submit crosses the wire), FC-MBR-013 and FC-IDV-004, 005, 007, 008 (the wallet has no call site), FC-MBR-014 (a real wire has real time). The first join refusal seen in part 3 was a harness defect (the persona assumed a `did:key`; the wallet's manager DID is a `did:peer:2`): fixed in the wire host and driver, in-process rows unchanged.

## 10. Where the part 3 and part 4 records are counted (integration 5)

The final passes of parts 3 and 4 have their own ceremony rows in `results/ceremony-rows.json`: `wire.kvc` (FC-KVC, the part 3 run) and `wire.mbr` (FC-MBR and FC-IDV in one run, the part 4 final pass), kind `wire`, platform keyring-wallet. Earlier passes, partial re-runs and the rate-limited first pass are kept outside the repository and are not counted (decision D525). The generated ceremony table in results/README.md shows the counts.

## 11. The first wire run (2026-11-20), kept as a description

The first run was a smoke run of the wallet's original `VtaClient` and `VtiMediatorSession` against a live VTA (0.72.0) behind the mediator (0.48.0), one compose project on loopback. Its run record is not part of the repository; this is what it showed.

- Steps that succeeded: manager DID creation, connect, discovery (289 task types listed), `acl/list`, `acl/grant`, `acl/update`, `acl/list`, `acl/revoke`, `acl/list`, `vta/contexts/list`.
- Sequence on the wire: fetch of the mediator DID document over HTTP; `authenticate` challenge and login (authcrypt, `ECDH-1PU+A256KW` with `A256CBC-HS512`); WebSocket open; `messagepickup/3.0` live-delivery change and delivery request; then for each task one authcrypt `0.1/envelope` to the agent, wrapped in a Routing 2.0 `forward` to the mediator, one frame back, and a `messages-received` acknowledgement.
- The wallet tries the newest task version first and falls back one version when the agent answers `trust-task-error`: `acl/list` 0.4 then 0.3, `acl/grant` 0.3 then 0.2, `acl/update` 0.3 then 0.2, `acl/revoke` 0.3 then 0.2. Discovery used 0.3.

A scenario the wire row cannot play (the tampered and repeated decisions of FC-KVC, the relay replays and the clock step of FC-MBR) is reported as skipped with its class D reason, never as failed; a failure is shown only where a real difference was observed (D528). The two final records were re-mapped that way: wire.kvc has 1 completed, 1 ended as specified and 13 skipped; the FC-MBR group of wire.mbr has 9 completed, 4 ended as specified and 4 skipped.
