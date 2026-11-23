# Roadmap and decision record

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. Nothing here has been filed with, sent to, or agreed by any project. Every item marked "not sent" or "DRAFT" is local.

This page gathers, in one place, where the suite's coverage stands, which decisions are taken and which are open, and the ordered list of what remains. It states no counts: they live in results/README.md and ../STATUS.md.

Related pages: [12 interoperability vocabulary](12-interoperability-interworking-meta-layer.md), [13 DIDComm carrier and witness-server vectors](13-didcomm-carrier-and-witness-server.md), [14 interoperability tracking](14-interoperability-tracking.md), [15 keyring-wallet DIDComm v2](15-keyring-wallet-didcomm-v2.md), and the proposals under [proposals/](proposals/).

## Status key

| Word | Meaning |
|---|---|
| done | Built, committed locally and recorded; not necessarily merged. |
| in-progress | Started; some part exists. |
| not started | Nothing built. |
| decided | A choice was made; it may still need work. |
| open | No decision yet. |

## 1. Coverage state

Evidence tags: (V) verified in code or a run, (I) inferred. This page states no counts: vector counts are generated in results/README.md, Vector families, and each platform's figures in results/README.md, Coverage and on the platform pages under results/platforms/.

### 1.1 keyring-wallet

The wallet is a holder and mostly a client: it sends most application tasks and serves a small peer leg (the VRC ceremony and `credential-exchange/query`).

| Item | State | Kind |
|---|---|---|
| Private types with no public specification: `contacts/continuity-check`, `approver/access-request`, `keyring/chat` (a message type, not a task), the `ceremony/shared-connect` label | decided: out of scope until specifications exist (no specification means no vector, never invented semantics) | firm blocker |
| Tasks the wallet only sends (acl, vault, vta/*, vtc/*, device, rooms, directory) | in-progress: the producer (emit) class exists and the emit and emit-more families run; figures on results/platforms/keyring-wallet.md | feasible; not firm |
| Real DIDComm v2 wire, mediator and TSP (the VTA leg and the inbox handlers) | not started; see [15](15-keyring-wallet-didcomm-v2.md) | not firm in principle; reach |
| Witness server (`witness/session` 0.1, `witness/session/submit` 0.1) | done over DIDComm v1 and v2, with equal verdicts (a separate server, not wallet coverage; docs/13 section 8) | feasible |
| `trust-task-discovery` served at 0.1, vectors target 0.3 and 0.4 | open: a version gap, not a blocker; a feature request is drafted (Ask D) | feasible |
| `credential-exchange/query` 0.1 on the peer leg | done (adapter serves it; vectors added) | |

### 1.2 VTI

| Item | State | Kind |
|---|---|---|
| VRC ceremony, ceremony-document family, two-phase commit, receipts verifier are not implemented by VTI | decided: SKIP "not offered"; no adapter mapping, which would be invention | firm blocker |
| Send-only tasks (`task-consent/request`, `vtc/members/request-vmc`, `removal-notice`, `push/wake`, `push/provision`) | in-progress: needs the producer class on the VTI side | feasible; not firm |
| DIDComm and TSP carriage (adapters reach HTTPS and in-process only) | not started | firm for the current adapters |
| `vetting/request`, `vetting/session`, `vetting/decline`: no VTI handler | decided: measures the wallet only | not a VTI gap |
| Plain tasks VTI serves (about 450 type-and-version entries) | in-progress: the plain-task probe runs against the VTA in process and the VTC in process; figures on results/platforms/vti.md | feasible |
| `credential-exchange/offer` and `request` observed through pushed documents | done (pushed-document observation, section 4) | |
| Live-service row re-run on the current core set | not started (docker denied; podman as compose runtime not tried); the same adapter now runs against the in-process VTC | feasible |

The two VTI surfaces (live service over HTTPS, agent handlers in process) measure different services and are never summed.

## 2. The application-profile (AP) structure: decisions RD1 to RD7

These are the roadmap decisions RD1 to RD7 of the [decision register](decisions/05-application-profiles-roadmap.md#roadmap-decisions-rd1-to-rd7). AP, application profiles (identifiers use `2L`), is a small, profile-based layer above the core, drafted in [proposals/2l-profiles-draft.md](proposals/2l-profiles-draft.md). Open question list for the task force (copy-ready, DRAFT, NOT FILED): [proposals/tf-question-list.md](proposals/tf-question-list.md).

| # | Question | Outcome | Status |
|---|---|---|---|
| RD1 | One flat layer or profiles | Capability-gated profiles 2L-1 to 2L-5 (access and approval; holder, device and push; notification and delivery; assurance; community lifecycle). A claimant claims only what it serves, as discovery already works | decided |
| RD2 | Where approval sits | `task-consent/*` stays the core approval primitive; `auth/step-up/*` is a 2L-1 member over it; `consent/*` (messaging-conversation consent) is not an approval primitive and is at most an optional, separately claimable member. `confirm/*` is retired and does not appear | decided; placement of `consent/*` open |
| RD3 | Credential status and revocation | A named gap in 2L-4. No task is drafted from one implementation's HTTP status list; the gap is taken to the task force with evidence | decided; revocation/status itself open |
| RD4 | Access control (`acl/*`) | In 2L-1, paired with governance declared through the `understanding` family (open draft pull request #904: `understanding/{offer,exchange,seal}`, `termsRef`). The profile defines mechanics only and carries one declared pointer to the deployment's governance document. Status of that pull request: open and unmerged, still a draft (re-checked read-only on 2026-11-15: state open, draft, not merged, head `96b1d70`, unchanged). Detail: [proposals/acl-understanding-pairing.md](proposals/acl-understanding-pairing.md) | decided; per-grant citation and whether to name `understanding/*` at all (the family may be renamed) open |
| RD5 | Rooms and messaging | Out of 2L (domain profile); the one related pull request is open with no second implementation | decided |
| RD6 | Who gets vectors first | The plain request-reply tasks of 2L-1 and 2L-2 (acl, policy, vault, device, auth) through the plain-task probe | done (figures: results/README.md, Coverage) |
| RD7 | Contract changes | Producer class first, then pushed-document observation | done |

Other scope decisions: private keyring-wallet types are out of scope until specifications exist; referencing draft specifications and open pull requests is allowed where needed, always cited with status (draft, number, commit) so they can be told from merged text.

Where 2L-1 members overlap (`task-consent`, `step-up`, `consent`) the recommendation is to organise by role, not by family, and to not propose retiring `consent/*` (no task-force discussion proposes it; RD2 keeps it distinct). Source reading: [proposals/2l-profiles-draft.md](proposals/2l-profiles-draft.md).

## 3. Standing principle: governance is never determined by conformance tests

Governance (role names and meanings, who may grant what, consent thresholds, retention, who may appoint whom) is always the choice of the end user, the deployer or community. The suite therefore:

- never asserts a built-in role set, a default authority or a policy content;
- checks only mechanics (shape, proof, recipient, errors, behaviour consistent with the role set the adapter *declares*);
- SKIPs, with the reason "governance not declared", any vector that needs a role or policy value the adapter did not declare (`$role(n)` placeholders resolve from the adapter's declared governance; `policy/upsert` is gated on declared content).

This rule is in [02-core-trust-task-criteria.md](02-core-trust-task-criteria.md) section 5.1 and governs every 2L profile. Status: decided and implemented.

## 4. Governance-baked-in finding classes (GOV-*)

The suite never rules on which governance is right. It checks whether a platform lets the end user declare it, using differential probes (declare an alternative governance, see whether it is honoured) plus a static audit, and reports a separate advisory finding. Neutral evidence from the static audit is in [proposals/governance-baked-in-audit.md](proposals/governance-baked-in-audit.md). Wording rules: report what was declared and what was observed; no ranking, no blame, no ordering of platforms.

| Class | Meaning |
|---|---|
| `GOV-FIXED` | A governance value the adapter declared was not honoured (rejected, ignored or replaced by a built-in) |
| `GOV-DEFAULT` | With nothing declared, the platform applied a governance value as if normative where the tested text says "not stated" |
| `GOV-HONOURED` | The declaration was applied (shown so a clean result is visible) |
| `GOV-NOT-PROBED` | No declaration path was exercised |
| `GOV-EVIDENCE` | A static-audit row attached to the platform; not a result |
| `GOV-SPEC` | The specification fixes the value; attributed to the specification, not the platform |

Status: decided as a design; probes not started (section 7).

## 5. Spec-maturity channels (built)

Tests for a specification that is not yet merged must be includable and excludable and must never be mistaken for a statement about the specification. Each vector carries a `source` with a channel and a pinned digest of the text it was derived from:

| Channel | Meaning | Counted as |
|---|---|---|
| `registry` | Specification is in the registry on main (every registry specification is draft) | gating |
| `pr` | Open unmerged pull request, with number and head commit | advisory |
| `proposed` | A suite-defined profile over tasks that exist in the TF repository (today the 2L vectors, `profile: 2L`; the tasks carry their real TF status in `tfRef`) | advisory |
| `candidate` | No home in the TF repository, implemented by one or a few platforms, possibly adoptable later; records `implementedBy` (derived from the results), `localText`, `adoptionNote`; not an endorsement | advisory |

[Decision 78 by the project owner](decisions/02-specs-tiers-and-channels.md#d78): the witness-share (WSH) vectors, which rest on the suite-local profile in docs/10, are not in the registry channel, and public figures are stated as registry plus advisory channels. [Decision 79](decisions/02-specs-tiers-and-channels.md#d79) sets their tag: they are `candidate`.

[Decision 79 by the project owner](decisions/02-specs-tiers-and-channels.md#d79): channel `candidate`; strict rule that every vector cites a TF repository artifact (`tfRef`: main, registry draft, open pull request with number and head; retired flagged) or is a `candidate`, else removed or excluded from every run of all runs. As applied: WSH-001 to 023 and TD-001 to 006 candidates (TD vectors added; keyring-wallet and truststackers implement them, VTI skips all); DIS-007 re-sourced to propose 0.1 and kept registry; the 5 governance probes candidates (no platform implements a declaration path yet); the vectors citing retired TF specs excluded from every run (`excludedFromRun`; the wallet still emits the retired 0.1 versions); the synthetic-carrier vectors marked `synthetic` and kept, not counted as tested tasks; the 2L vectors stay advisory through `profile: 2L` with each `tfRef` set to the real status (all its tasks are drafts on main, the notifications ones through merged TF pull requests 1012 and 1017). Counts by family and channel: results/README.md, Vector families. docs/04 section 18.

A toggle selects channels; advisory results never change a gating count; a changed pinned digest is reported as spec drift. Status: done (docs/04 section 18). The witness-share and TD vectors are `candidate` (decisions 78 and 79 by the project owner, [decisions](decisions/02-specs-tiers-and-channels.md#d78)); every other core, plain, emit, emit-more and witness vector is `registry`; the 2L vectors are `proposed` (profile 2L); no vector is `pr` yet. Every non-candidate vector has a `tfRef`, enforced by `test/tfref.test.ts` and `npm run resolve-tf-refs`.

## 6. Contract changes

| Change | Purpose | Status |
|---|---|---|
| Producer class: optional adapter method `emit` and capability `emits`, the `emitted` disposition, the emit family | Check the documents an implementation sends, which the receive-and-reply contract could not reach | done (figures: results/platforms/keyring-wallet.md) |
| Pushed-document observation | Observe the next task a platform pushes after `offer` or `request` | done |
| Governance capability and declaration (`capabilities.governance`, `declareGovernance` or a governance profile option, SKIP reason `governance-undeclared`) | Let the end user's governance be declared to the platform under test | decided; not built |
| Carriers: new `bindings` values `didcomm`, `didcomm-v1`, `didcomm-v2` | Reach DIDComm | done for v1 (witness server); v2 in-progress, no result claimed |

After decisions 78 and 79 by the project owner ([decisions](decisions/02-specs-tiers-and-channels.md#d78)) the core family changed only by the pushed-document vectors CEX-033 to 039; the plain-task, emit, emit-more, 2L and witness families are measured separately.

## 7. Upstream asks (DRAFT, all "not sent")

The default is to not modify the platforms under test. Four asks survived verification; none has been sent, filed or discussed with anyone. Drafts and evidence: [proposals/upstream-harness-asks.md](proposals/upstream-harness-asks.md).

| Ask | Target | Summary | Status |
|---|---|---|---|
| A | VTI | A small standalone mock service example over the test-support code that already exists, plus a short "conformance boot" document | not sent |
| B | keyring-wallet | Injectable session factory, clock and id source in `VtaClient` (a testability improvement) | not sent |
| C | keyring-wallet witness server | A bind-host setting (default unchanged), plus two small tidy-ups | not sent |
| D | keyring-wallet | Serve `trust-task-discovery` 0.3 (a feature request, not a harness hook) | not sent |

Candidates dropped after verification: a served-types manifest, a production outbox-inspection flag, an emit hook in production builders, a dev-only HTTPS binding for the witness server.

## 8. What remains, in order

| # | Item | Status |
|---|---|---|
| 1 | Merge the local branches (plain-task and producer class, DIDComm carrier with witness vectors, channels, further emitters, roadmap notes) and resolve the shared-file conflicts | done |
| 2 | Reconcile counts across README, STATUS, results, platforms and docs 04, 05 and 12 after the merge | done: every figure is generated from the run folders (`npm run regen`, checked by `npm run check:docs`), and other pages link to the generated blocks instead of stating counts |
| 3 | Governance probes: the differential probes and default-probe (section 4), once the governance capability exists | not started |
| 4 | Remaining keyring-wallet emitters. Done on the merged tree: step-up responses, `auth/oob/*`, `keys/*`, `vault/upsert`, the vta and vtc families; `vtc/join-requests` does have schemas in the pinned package (`@openvtc/trust-tasks` 0.29.0 ships them) and all the wallet emits ran and PASS. Left: `acl/swap-key`, `auth/oob/identify` and `grant`, and the inbound-only types | mostly done (figures: results/platforms/keyring-wallet.md) |
| 5 | Decide the open exceptions for three plain-task differences whose causes are unconfirmed (PP-AUT-149, 261, 211) | open |
| 6 | DIDComm v2: the carrier fix is merged (the witness server answers v2 with verdicts equal to v1, docs/13 section 8); keyring-wallet over real DIDComm v1 is built (docs/18) with an experimental v2 leg; open: anonymous send over v2, mediated delivery, TSP | in-progress |
| 7 | Interoperability ledger: record demonstrated cross-platform exchanges per [14](14-interoperability-tracking.md). Important, but not the current focus; planned for later | not started |
| 8 | Re-run the VTI live-service row on the current core set | not started (docker denied; the in-process VTC row covers the same adapter) |
| 9 | Witness oracle: done for the discovery 0.1, session 0.1 and submit 0.1 documents (`reference-witness`, the `witness*` mutants; docs/13 section 6); still open: the success path of submit (the oracle never mints), `session/submit` 0.2 and TSP | partly done |
| 10 | Task-force questions and upstream asks: send only after the project owner decides | open |
| 11 | Rebuild the publish branch and republish the page | open (only if wanted; the page text of docs/14 section 5 and the at-a-glance page are not republished) |
| 12 | Final merge of vti-reach (with governance probes and channels), observe-oracle-v2, vti-emit-2l, kw-didcomm and at-a-glance | done |
| 13 | Retag the witness-share vectors to the planned `candidate` channel | done (decision 79 by the project owner, [decisions](decisions/02-specs-tiers-and-channels.md#d79); the WSH and TD vectors are `candidate`) |
| 14 | Reach work left by the VTI agents: enrol a step-up approver and a second administrator to exercise the VTC's governance declaration; a push-capable VTA host for CEX-025, 026 and 033 to 039 (`start_with_transports`); VTC restart; the VTC-served 2L vectors against the in-process VTC; handler-built emit documents needing pushed-document observation | open |
| 15 | Full end-to-end ceremony track for VTI's agent service (VTA) and keyring-wallet: a whole ceremony completed between independent real parties over a real carrier, recorded in the ledger of demonstrated executions ([14](14-interoperability-tracking.md), section 4). Today the suite tests individual ceremony documents and short multi-step sequences against one implementation at a time; no complete ceremony has been demonstrated across platforms, and the ledger is empty | planned (scope being written) |

Known open points in the witness-server run (figures: results/platforms/keyring-wallet.md): its KNOWN-FAIL entries are session and discovery behaviours recorded in `exceptions/exceptions.json` (`impl` `witness-server`), unowned, with an expiry date.

Back to [README.md](README.md).
