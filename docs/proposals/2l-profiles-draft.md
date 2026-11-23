# Second layer (2L) of common trust-task profiles: draft text

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. Not filed, not sent. Nothing here has been posted to, filed with, or sent to any project.

Date 2026-11-15. DRAFT: not for the Trust Tasks Task Force (TF) until reviewed by the project owner.

Tags: (V) verified in a file or result when the underlying notes were written; (inferred) a drafting inference, no source states it; every (inferred) item is listed in section 10. Status tags on every external reference: **draft** (in the registry as `status: draft`), **merged**, **open PR** (unmerged, with number and commit), **retired**.

Sources: the coverage review for VTI and keyring-wallet (sections 5-6) and the ACL pairing note ([acl-understanding-pairing.md](acl-understanding-pairing.md)) summarised in [../16-roadmap-and-decisions.md](../16-roadmap-and-decisions.md); the approval-spec review; the recorded decisions (see docs/16); suite docs [02-core-trust-task-criteria.md](../02-core-trust-task-criteria.md) and [04-suite-design.md](../04-suite-design.md).

Pins. Kit (a local clone of the TF's registry repository): `origin/main` 0dbc98f1c (2026-11-14), the last locally cached state, not fetched (V; the working tree is on a feature branch, so versions were read with `git ls-tree origin/main`). Every spec in the registry is `draft` or `retired`; there is no `published` status (V, approval-spec review). VTI (verifiable-trust-infrastructure) 55327b668. keyring-wallet (KW) 62af4d2d, bifold HEAD 7e14c5124. Truststackers (TS) code is under `p2p-trust-stack/packages`.

## 1. Standing principle (binds every profile below)

Governance is never determined by conformance tests or by a profile. It is the end user's choice (the deployer or community). A profile defines mechanics (wire shapes, proofs, errors, behaviour) and declaration points (places where a deployer states a governance choice). A profile supplies no default for any governance value. "Not declared" is a legal state; conformance reports it as SKIP with reason `governance-undeclared` (reason string proposed in the ACL pairing proposal, section 4; not yet in the suite) and never as FAIL. Basis: [decisions 75 and 76](../decisions/04-ceremonies-governance-and-exceptions.md#d75); framework ruling that a value not stated is not absent (`indeterminate`, per note 07 ruling 7 as cited in the ACL pairing proposal).

## 2. Scope

In scope: five capability-gated profiles, 2L-1 to 2L-5 (the recorded decision), each a list of registry slugs pinned as `slug@version`. A claimant states which profiles it serves or sends (section 3).

Out of scope: rooms and messaging (the recorded decision [RD5](../decisions/05-application-profiles-roadmap.md#roadmap-decisions-rd1-to-rd7); note 07 says no core tasks for messaging; chat/direct is open PR #1066 in the TF per the coverage review, not re-verified); DID and key lifecycle, backup and recovery, voting, persona (domain profiles); the private KW types (continuity-check, approver/access-request, keyring/chat, shared-connect label; no specs exist); credential status and revocation (a NAMED GAP, section 8 (2L-4), no semantics drafted); `confirm/*` (retired by TF PR #156, commit 3f1ceec37, in favour of `task-consent`; V).

## 3. Relation to core and the selection rule

Core as in docs/02 (V): 3b framework slugs (`trust-task-error`, `trust-task-next-step`, `trust-task-discovery`, optional `trust-task-control`, `trust-ceremony-receipt`); proposed 3b-DTG (`credential-exchange/{offer,request,issue,present}` and `task-consent/{request,decision}`; a scope proposal, not a published list); the VRC ceremony as ceremony-level 3c. 2L sits above these and names no reserved namespace. It reuses the mechanism docs/02 proposes for 3b-DTG: list `slug@version`, carry its own versioning. `task-consent/*` stays in 3b-DTG as the single approval primitive (the recorded decision); 2L-1 members add to it and never redefine it.

Selection rule used (the coverage review, 5.2, plus docs/02):
1. Recurrence gate: the task or cluster recurs on at least two platforms among KW (holder client), VTI (server), Truststackers (TS), or in the kit's cross-family fan-in (note 07, 1.3 as cited in the coverage review), and is not tied to one protocol design.
2. Neutrality gate (G1 of docs/02): the profile's mechanics can be written without fixing a role set, authority model or governance value. Where a member names a domain noun (community, member, VMC), the profile says so and keeps the governance part as declaration points. (inferred: docs/02's two gates are G1 neutrality and G2 framework coupling and are written for core membership; here G1 is applied as a profile test and G2 is not required, because 2L is not framework core.)
Where a candidate has evidence from one platform only, the profile marks the member optional and records it as a gap (sections 5 to 9).

Structure (from coverage review 5.4, adjusted for the recorded decisions [RD1 to RD7](../decisions/05-application-profiles-roadmap.md#roadmap-decisions-rd1-to-rd7)):

```
Core (3b, 3b-DTG, ceremony 3c)         existing; task-consent stays here
  |
2L: common application profiles        proposed; capability-gated, advertised in discovery
  2L-1 Access and approval:      auth, acl (+ optional termsRef), policy/evaluate, step-up (session elevation)
  2L-2 Holder, device and push:  vault/credentials, device, push, keys/sign
  2L-3 Notification and delivery: notifications notify/relay
  2L-4 Assurance:                audit list/verify, receipts (reference), credential status/revocation = NAMED GAP
  2L-5 Community lifecycle:      invitation, join, VMC, vetting statement, directory query
Domain profiles (outside 2L): rooms/messaging, did-management/webvh, backup/recovery, voting, persona
Private KW types: out of scope
```

## 4. Common rules for all five profiles

- Claim: a claimant says which profile and which role it takes (server: receives and answers the member tasks; client: sends them). A server claims a profile only for members it serves; (inferred) it may claim a profile with optional members omitted, and the profile lists which members are required.
- Declaration in discovery. Facts (V, discovery 0.4 spec): `supportedTypes` entries are a bare Type URI or an expanded object `{type, acceptanceWindow?, requiredExt?}`; there is no profile-claim member. Proposal (inferred): (a) implicit claim, a responder that lists every required member of a profile in `supportedTypes` is read as claiming it, needing no TF change; (b) optional explicit claim named `2l-<n>`, pattern `<profile-id>@<profile-version>` (for example `2l-1@0.1`), in a new optional discovery member or an `ext` namespace. Which of (a), (b) the TF prefers is an open question (Q1 in the TF list). This draft recommends (a) first because it needs no spec change, with (b) added only if the TF wants an unambiguous claim.
- Pinning: one version per slug per profile version; the lists below pick the latest registry draft unless stated.
- Conformance posture (docs/04, V): a vector whose `requires` capability is not declared is SKIP, never PASS; today only `task-consent/*` (TC-001..018) has vectors among 2L members; plain tasks have none by the suite's scope rule. What 2L "may check" below is therefore prospective, to be realised by the bundle-driven plain-task probe (coverage review D6, the recorded decision) and, for send-only and multi-actor items, by the producer vector class and second-actor capability (coverage review 5.5, changes A and C, not yet designed).
- Governance SKIP rule: where a governance value is undeclared, vectors that need it SKIP with `governance-undeclared`; vectors that need only mechanics still run. Role names or any value in a vector come only from the deployer's declaration, never from harness code (ACL pairing proposal, harness rule, (inferred) as a design).

## 5. Profile 2L-1: Access and approval

### 5.1 Purpose
Prove who is calling and obtain a session; manage who is allowed to act (access-control entries); evaluate an action against policy; raise a session's level of confirmation for a sensitive action using the approval primitive in core. [Decision 74](../decisions/04-ceremonies-governance-and-exceptions.md#d74): ACL is in 2L-1 with mechanics only plus an optional declared `termsRef` to the deployment's governance document.

### 5.2 Members (all status draft at origin/main 0dbc98f1c unless stated)

Part A, session:
- `auth/challenge@0.1`, `auth/authenticate@0.3`, `auth/refresh@0.2`, `auth/whoami@0.1`.

Part B, access control entries (ACL):
- `acl/grant@0.3`, `acl/revoke@0.3`, `acl/change-role@0.3`, `acl/update@0.3`, `acl/show@0.3`, `acl/list@0.4`, `acl/swap-key@0.1`. The kit has 20 acl spec versions over these 7 slugs (V, ACL pairing proposal; the earlier brief said 14).

Part C, policy and approval:
- `policy/evaluate@0.4` (latest; draft). Which evaluate version VTI serves was not verified; TS maps to `policy/evaluate/0.3` (`p2p-trust-stack/packages/core/src/services/trust-tasks/type-uris.ts:177`, V). Pin to be settled (see section 10).
- `auth/step-up/start@0.2`, `auth/step-up/approve-request@0.5`, `auth/step-up/approve-response@0.7`, `auth/step-up/policy@0.2` (draft; approve-response has seven versions, VTI serves 0.7 and sends approve-request 0.5, V). Framing agreed in the approval-spec review: session elevation over the core approval primitive, using the same "approver's own DID" proof rule as `task-consent/decision@0.2` ("a delegated key is `notAnApprover`", V). The label "assurance elevation" was suggested; it collides with the profile name 2L-4 "Assurance", and the TF's own survey calls this "session elevation" (V, `docs/alignment/2026-10-20-trust-task-overlap-survey.md:337`). Flagged as an open question.
- Referenced, not members: `task-consent/request@0.1`, `task-consent/decision@0.2`, `task-consent/granted@0.1` (core 3b-DTG; `granted` is advisory, "the grant lookup at re-submit is the real gate", V).

Open, not yet decided: `consent/{request,decision,revoke,list,approver-set,approver-list}@1.0` (list also 1.1) and `consent/approve-request@0.1`. These are messaging-conversation consent for an AI agent, not an approval primitive (V, approval-spec review). Options: (1) optional separately claimable member group in 2L-1, honest about scope; (2) leave out of 2L until a second implementation exists. Recommendation: option 2 if the recurrence gate is applied strictly, because the evidence is VTI only (VTI serves six and sends approve-request; KW does not appear to serve it, (inferred) carried from the earlier notes); option 1 is compatible with the decision already taken to put it in 2L-1 if marked optional. No TF proposal retires `consent/*` and none should be framed that way (V, design note rejected generalising it). Excluded in all cases: `confirm/*` (retired).

Excluded pending decision: `policy/{upsert,get,list,delete}`. Policy content is governance; a management profile would need declaration points and has not been scoped (inferred exclusion).

### 5.3 What a claimant must do

Server (maintainer) role:
- Part A: serve challenge/authenticate/refresh/whoami for identified callers. (V for VTI: VTA and VTC serve all four.)
- Part B: serve the acl tasks with the mechanics of the pinned specs: role is an opaque string, a ceiling and never a grant; an unrecognised role confers nothing and MUST NOT fall back to a default role, and `roleNotRecognized` carries `offendingRole` and `knownRoles` (grant/0.3, V); the granter's stored entry bounds every axis ("a role above the granter's is `permissionDenied`"); `acl/revoke` refuses removing the last holder of a protected privileged role (`lastAuthorityProtected`).
- Part C: serve `policy/evaluate`; serve the step-up tasks it claims; carry `task-consent/*` as in core when it hosts approvals.
Client role: send the tasks of the parts it claims at the pinned versions. Gap: KW pins grant/revoke/update 0.1/0.2 and swap-key 0.1 in `bifold/packages/core/src/modules/trust-tasks/module/approvalRules.ts` (V), VTA serves acl 0.2/0.3 (V per coverage review; `vta-service/src/operations/acl_v0_2.rs`). So a profile at acl 0.3 is not what KW sends today.
(inferred) Because Parts A to C are large, a claimant may claim each part separately.

### 5.4 Declaration in discovery
Proposed capability names (inferred): `2l-1` for the whole profile, `2l-1.session`, `2l-1.acl`, `2l-1.approval` for parts. Mechanism per section 4.

### 5.5 Governance declaration points (profile supplies no default for any)

Declared by the deployer in its governance document or adapter configuration:
1. `termsRef { uri, version, digestMultibase }`, optional, a pointer to the deployment's governance document. Shape reuses `RegisterRef` from open PR #904 (`understanding-rebased`, head 96b1d70, draft, unmerged; `_shared/0.1/agreement.schema.json#RegisterRef`, V) and the `GovernanceFramework` DID-document service of vti-spec open PR #78 (draft, VTI-KEY-052, not in the local VTI spec clone, V). Proposed home (recommended in the ACL pairing proposal): the DID-document service as source of truth with the profile mirroring it; alternatives are a discovery annotation or an adapter-only declaration. #904 is the understanding family (`understanding/{offer,exchange,seal}`); its name may change (a `myterms/*` split was floated in the PR thread on 2026-10-27, V), so the profile refers to the `termsRef` shape, not the family name.
2. Role names and meanings (the governance document, or `roleNotRecognized.knownRoles` as a cross-check).
3. Role ordering, and the privileged subset a "protected" role refers to. The merged specs presume both and define neither ("a role above the granter's", "a privileged role the maintainer's policy protects", V).
4. Who may grant or revoke which role.
5. Whether a grant needs approval, step-up, or a sealed understanding first (default state: not required; (b) per named roles or (c) all roles are the deployer's choice). Citation of a seal from a grant is unresolved: via a Verifiable Authority Credential citing the seal (the #904 route), via `ext` or a new grant version (a TF change), or internal policy only (ACL pairing proposal section 3). No recommendation on `ext` versus new version.
6. Which operation classes require step-up (`auth/step-up/policy`), approver sets, quorum and self-approval rules (kit rule: shared schemas never default a governance value, docs/02).
7. Last-authority protection policy.
8. Version drift: what happens to existing entries if the pinned governance document changes (not defined anywhere, Q in TF list).

### 5.6 What conformance may check, and what it must SKIP

May check (mechanics, the existing contract plus the plain-task probe):
- envelope, proof, recipient, expiry, replay on each task (framework vectors already run for any served task).
- acl payload shape (entry requires `subject, role, act, keys, capabilities, purposes`; an empty `act` list is refused; `purposes` explicit); `roleNotRecognized` for a role string the harness guarantees unknown (a random nonce) and that no default role is applied; idempotent re-grant; a different role for an existing subject refused with the `acl/change-role` hint; a grant cannot exceed the granter's stored entry (granter provisioned by the adapter with an authority the adapter declares); change-role compare-and-swap; revoke and swap-key atomicity; list filters, an unknown filter returns zero matches.
- `termsRef` shape, and if declared, digest integrity (fetch `uri`, compare `digestMultibase`); a mismatch or unfetchable document is `indeterminate`, not failure (rule of vti-spec #78, V).
- Consistency against the adapter's own declaration, never a built-in: each declared role is grantable by a granter the adapter says holds authority; a role outside the declared set is refused; `knownRoles` equals the declared set (superset or withheld: SKIP with note); if the deployment declares sealed-understanding-required, a grant without one is refused and with one accepted.
- Session: challenge and authenticate shape, refusal of an expired or replayed challenge, `whoami` returns the authenticated subject (these are (inferred) from the task purposes; no vectors exist and the adapter currently shortcuts authentication with `mint_token`, coverage review change D).
- Approval: `task-consent` vectors TC-001..018 (existing; for VTI all 18 SKIP, 12 for lack of the ceremony-document family VTI does not offer, 6 because VTI only sends `task-consent/request`, V). Step-up: no vectors; needs a second-actor capability (coverage review change C).

Must not check: that any named role exists (`admin`, `initiator`, ...); a hierarchy or "super-admin" meaning; that a role may grant another; a minimum or maximum number of roles; that a default role is least privileged; that a seal is or is not required; whether the governance document's content is sensible; which `purpose` string is used; which operations need step-up; approver counts or quorum.

Must SKIP when undeclared (reason `governance-undeclared`): role-accepted, role-consistency and granter-ceiling vectors without a declared role set; cross-role authority vectors without declared authority rules; seal-gating vectors without `sealBeforeGrant`; digest integrity without `termsRef`. Vectors for nonce-role refusal, shape, proof, recipient, replay still run. Adapter capability block (naming is a drafting proposal, inferred): `governance: { termsRef?, roles?, authority?: [...] | "structural-only", sealBeforeGrant?: "never" | {roles} | "all", provision }` (ACL pairing proposal section 4).

### 5.7 Evidence of implementations
- VTI: auth and acl served by VTA and VTC (`vta-service/src/trust_tasks/mod.rs` dispatch table; `vtc-service/src/trust_tasks/mod.rs` `DISPATCHED_URIS`; acl `vta-service/src/operations/acl_v0_2.rs`); step-up `vta-service/.../step_up.rs` (approve-response 0.7 served, approve-request 0.5 sent); task-consent `consent_request.rs` (send only), `task_consent::handle_decision` 0.2; policy `policy/{list 0.3,get,upsert 0.3,delete}`, VTC adds `activate`, `test`. All V per the coverage review.
- KW: `bifold/packages/core/src/modules/trust-tasks/module/`: `VtaClient.ts` (ACL sends, `grantAdmin`, task-consent), `approvalRules.ts` (pinned versions), `stepUp.ts`, `oobSignInAgent.ts` (auth/oob, task-consent), `proofPurpose.ts`, `vtaDevices.ts`. (V for file hits; only the cited lines were read.)
- TS: policy upsert and evaluate (`p2p-trust-stack/packages/core/src/services/trust-tasks/type-uris.ts:49-180`, envelope bridge `POST /trust-tasks` serving `policy/evaluate` only, the truststackers notes, section 0); `policy:*-authorized` and `ceremony:co-sign` vocabulary (the kit survey maps co-sign to `task-consent`, V approval-spec review); session cookie, proof-only planned (coverage review, A1). TS has no acl slugs found (inferred, not exhaustively searched).
- Kit fan-in (V per coverage review): `acl/grant` referenced by 22 slugs in 8 families (highest after error); `task-consent/decision` 19 slugs / 7 families; step-up 29 slugs / 10 families; auth 44 slugs.
- Hard-coded role assumptions, as evidence for why "configuration, not constant" matters (V, ACL pairing proposal section 5): VTI `vti-common/src/acl/mod.rs` (`enum Role {Admin, Initiator, Application, Reader, Monitor}`, `Monitor` default, `validate_role_assignment`), `acl_v0_2.rs:247` (`KNOWN_ROLES`); KW `VtaClient.ts:~2125` (`role: 'admin'`), `vtaDevices.ts:181`. The kit's `vtc/roles/define:builtInRole` (merged, draft maturity) presumes built-in roles. Neither implementation reads a governance document to learn roles.

### 5.8 Known gaps
- No machine-readable role section in any governance document; `RegisterRef` points at an opaque document (ACL pairing proposal section 2).
- #904 is shaped for privacy terms: `Agreement` has `{name, rosterItems[], effectiveFrom, legalRef?, machineReadableRef?}` and nothing says roles can be roster items; the seal confers no access (a VAC does) and the offer adds "no ACL entry, no grant"; two-party only (host and joining party, the granting authority is not bound); no version-drift rule; the PR is behind main with failing CI (V). It is an open draft and the profile must stay valid without it.
- KW sends older acl versions; VTI serves 0.2/0.3.
- No vectors for session, acl, step-up, policy; multi-actor and authentication-setup adapter changes needed (coverage review C, D).
- `consent/*` placement open; three consent-like families remain (`task-consent`, `auth/step-up`, `consent`) and the TF's own survey names them as three meanings (V).
- Evidence for `policy/evaluate` is thin on KW (KW sends `policy/get`, `upsert`, not evaluate; (inferred) from the coverage review).

## 6. Profile 2L-2: Holder, device and push

### 6.1 Purpose
A holder app (wallet) stores and presents credentials in a vault, registers devices with a server, and is woken by a contentless push. Signing with a held key.

### 6.2 Members
- `vault/credentials/query@0.1`, `get@0.2` (0.1 is retired), `receive@0.1`, `present@0.1`, `delete@0.1`, `archive@0.1`, `restore@0.1`, `unarchive@0.1`, `purge@0.1` (draft).
- `device/register@0.2`, `device/heartbeat@0.3`, `device/list@0.3`, `device/disable@0.1`, `device/set-wake@0.2`, `device/wipe@0.2` (draft).
- `push/register@0.2`, `push/provision@0.2`, `push/wake@0.2` (draft; 0.1 of each is retired); and the binding `bindings/push/0.1` (cited from the coverage review; status not re-checked here).
- `keys/sign@0.1` (draft). Optional: the coverage review rates key custody platform-specific (inferred); recommend optional.
- Excluded: private KW vault types; `vault/{get,list,upsert,sign-trust-task,...}` (VTA-specific, not proposed here).

### 6.3 What a claimant must do
- Server (a vault/device host, VTA-shaped): serve the vault and device tasks it claims; for `push/wake` and `push/provision`, VTI sends them to a push gateway (`step_up.rs:1145`, `device.rs:323`, V), so a "push sender" role exists and is distinct from the device server.
- Client (holder wallet): send vault and device tasks; receive wake.
- Push gateway role: who serves `push/register` is unverified: VTI does not serve it (`vta-mobile-core/src/push.rs` is a client, V); KW sends it (`vtaDevices.ts`); a push-gateway infrastructure repository exists and its served tasks were not checked.

### 6.4 Declaration in discovery
Proposed (inferred): `2l-2`, with optional parts `2l-2.vault`, `2l-2.device`, `2l-2.push`. Mechanism per section 4.

### 6.5 Governance declaration points
Who may register or wipe a device; whether a wipe needs approval or step-up; vault retention, archive and purge rules; who may read or present a credential and under what policy; wake policy. All deployer choices. The profile declares no values.

### 6.6 What conformance may check, and what it must SKIP
May check (plain-task probe, no contract change): envelope and proof rules; payload schema, error codes and `proofRequired` per bundle (coverage review D6, 3 to 5 days); idempotent `device/register` re-registration and `device/disable` effects (inferred from names); `vault/credentials/get` version bridge (KW sends 0.1 and 0.2, VTI serves 0.2 only; KW steps down by `taskVersions.ts`, (inferred) not run).
Must not check: retention periods, who may wipe, whether wipe is gated by approval, which credentials a holder stores.
SKIP when undeclared: approval-gated wipe or purge vectors without a declared rule (`governance-undeclared`); push vectors where no `bindings/push` carriage is declared (docs/04 `binding:` capability gate). `push/wake` and `push/provision` are send-only: cannot be exercised until the producer vector class exists (coverage review change A).

### 6.7 Evidence
- VTI: VTA serves `vault/credentials/*` (all 0.1, `get` 0.2 only) and `device/*`; sends `push/wake`, `push/provision` (V, coverage review section 2.3, 2.5).
- KW: `vtaDevices.ts` (device/register, push/register), `vtiCardVault.ts` and `approvalRules.ts` (vault/credentials/get), `EphemeralKeyManagementService.ts` (keys/sign). Heavy use per the KW report cited in the coverage review.
- TS: none found (inferred, not exhaustively searched); recurrence therefore rests on VTI plus KW (server and client halves of one pair). Recommend stating this plainly to the TF.
- Kit fan-in: vault 18 slugs; device and push 9 slugs (V per coverage review).

### 6.8 Known gaps
- Single pair of platforms (VTI and KW); no second independent implementation of either side.
- Push gateway served tasks not identified; `bindings/push` carriage not reachable by the current adapters (HTTPS only, coverage review firm blocker 3).
- No vectors; send-only items need the producer class.

## 7. Profile 2L-3: Notification and delivery

### 7.1 Purpose
An originator tells a party that "a thing exists" the party may take part in; a relay forwards the originator's signed document unchanged.

### 7.2 Members
- `notifications/notify@0.1`, `notifications/relay@0.1` (draft, framework 0.6.0; kit PR trusttasks-tf #1012 per the coverage review, status not re-verified).
- Not generic yet (inferred need): listing and dismissing a notification inbox exists only as VTI-named slugs `vta/notifications/{list,show,dismiss,deposit}` and `vtc/notifications/{list,show,relay}`; no generic slug exists. These are not proposed as members.
- Referenced: `task-consent/granted@0.1` (core) is a notification inside the approval flow, not a 2L-3 member.

### 7.3 What a claimant must do
Server (recipient or relay): serve `notify` and `relay` as counterparty tasks (VTA and VTC do, V). Client (originator): send a signed `notify`; the relay carries the originator's document unchanged (spec text per approval-spec review). Nothing further is stated by sources; do not add semantics.

### 7.4 Declaration in discovery
Proposed (inferred): `2l-3`. Mechanism per section 4.

### 7.5 Governance declaration points
Who may notify or relay whom, which notification kinds a deployment accepts, retention and dismissal rules, rate limits. Declared by the deployer; none defined by the profile.

### 7.6 Conformance
May check: envelope, proof, issuer-signed originator on relay (relay carries the document unchanged, from the spec), payload schema, error codes (plain-task probe). VTI has its own `VTI-NTF-001..063` rules (coverage review; not read here).
Must not check: which notifications a deployment accepts, ordering, retention.
SKIP when undeclared: acceptance-policy vectors (`governance-undeclared`). Origination is send-only: producer vector class needed.

### 7.7 Evidence
- VTI: `notifications/{notify,relay}` served by VTA and VTC (V, coverage review 2.5).
- KW: no `notifications/` string found in `bifold/packages/core/src/modules/trust-tasks/module/` (grep, V); it has inbox handlers (`vtiInbox.ts`, `vtiCommunityNotices.ts`). So KW evidence for notify is absent.
- TS: none found (inferred).

### 7.8 Known gaps
The recurrence gate is NOT met on current evidence: only VTI serves the tasks and no second platform sends or serves them. Options: (1) keep 2L-3 as a profile pending a second implementation, marked provisional; (2) fold `notifications/*` into 2L-1 or leave it a domain item until KW or TS implement it. Recommendation: option 1, marked provisional, because five profiles were decided (the recorded decision) and the cost of the marker is small; no recommendation is made on where the generic list/dismiss slug should live (question to the TF).

## 8. Profile 2L-4: Assurance

### 8.1 Purpose
Evidence that something happened and can be checked: an append-only audit log, signed receipts, and (a gap) credential status. Note the name overlaps the "assurance elevation" framing floated for step-up in 2L-1 (section 5.2).

### 8.2 Members
- `audit/list@0.2`, `audit/verify@0.1` (draft; 4 audit specs in the kit).
- `trust-ceremony-receipt@0.1` (draft; framework-reserved, optional capability `receiptVerify`, classed core-profile in 3b by docs/02, V). Listed here by reference only; it is not redefined (inferred placement, avoids double membership).
- Credential status and revocation: NAMED GAP. No member, no semantics drafted (the recorded decision [RD3](../decisions/05-application-profiles-roadmap.md#roadmap-decisions-rd1-to-rd7)).

### 8.3 What a claimant must do
- audit: serve `audit/list` and `audit/verify`; VTA and VTC serve both (V). Beyond the spec text, nothing else is stated.
- receipts: as framework text; verifier behaviour is covered by RCPT vectors (RCPT-001..070, optional capability `receiptVerify`, built, docs/04 11.6).
- status: nothing is required of a claimant; no task exists.

### 8.4 Declaration in discovery
Proposed (inferred): `2l-4`, parts `2l-4.audit`, `2l-4.receipts`. Mechanism per section 4.

### 8.5 Governance declaration points
Who may read the audit log; retention; which events are logged; whether receipts are required for which ceremonies; for status, any revocation authority and policy (not drafted). All deployer choices.

### 8.6 Conformance
May check: audit payload shapes and error codes (probe); log verification result shape; receipts (RCPT vectors, existing; KW and TS run them, VTI SKIP "not offered", V). 
Must not check: what is logged, who may read, retention; whether receipts are mandatory.
SKIP when undeclared: audit-access vectors without a declared reader rule (`governance-undeclared`); RCPT without `receiptVerify`.

### 8.7 Evidence
- Audit: VTI `audit/list` 0.2 and `audit/verify` 0.1 (VTA, VTC); KW: no `audit/` string found in its module directory (grep, V); TS: none found (inferred). Single-platform evidence; recurrence gate not met for audit (see 8.8).
- Receipts: `trust-ceremony-receipt` with 70 RCPT vectors measured on KW and TS; related tasks `vtc/join-requests/submit-receipt`, `vta/pcs/voter/receipt` (V, coverage review).
- Status and revocation (evidence for the TF, V from the approval-spec review and coverage review): `vta/credentials/revoke@0.1` (draft; must report `alreadyRevoked`; for profiles with `credentialStatus` "the consumer MUST also flip the credential's published status-list bit" and return `statusListIndex`); `vtc/endorsements/revoke@0.1` (flips its bit on the community Revocation status list); scattered per-domain revokes `vtc/vetting/revoke-statement`, `vtc/badges/awards/revoke`, `vtc/invitations/revoke`, `git-trust/revoke`, `rooms/revocations/{get,put}`. VTI also has an HTTP status-list module in `vtc-service` (not a task). No verb in `credential-exchange` (docs/02: "No revoke verb exists for credentials yet; the DTG credential specification lists one, so it is a gap, not a member"). No spec defines the status list, its fetch or a status query; `SPEC.md` mentions "the status list it consulted" only as something an error must not leak (line 1278). The TF has no issue or PR on it (approval-spec review: `gh search issues` for status list, revocation status, credential status, revoke credential returned no relevant hit; #337, closed, is about listing only; GitHub Discussions and meetings not checked).

### 8.8 Known gaps
- Credential status and revocation: named gap, to be taken to the TF as a new proposal with the evidence above; do not draft from VTI's HTTP status list alone (invention risk).
- `audit/*` has VTI-only evidence; same provisional status as 2L-3.
- Receipts are already core-profile; 2L-4 adds nothing to them (open question whether to keep them listed).

## 9. Profile 2L-5: Community lifecycle

### 9.1 Purpose
A community invites, admits and credentials members: invitation, join request, membership credential (VMC), a vetting statement from one person about another, and a directory query. The profile needs a membership concept; it is a domain-noun profile, which G1 (section 3) permits only as a profile with all admission rules left to the deployer.

### 9.2 Members (draft at origin/main 0dbc98f1c)
- Invitation: `vtc/invitations/issue@0.1`, `list@0.1`, `revoke@0.1`, `deliver@0.1` (deliver pushes a `credential-exchange/offer`, core).
- Join: `vtc/join-requests/submit@0.3` (0.1 retired), `status@0.1`; also `manifest@0.4`, `withdraw`, `supplement`, `decide` (coverage review; not individually re-verified, (inferred) optional).
- Membership credential: `vtc/members/vmc@0.1`, `vtc/members/request-vmc@0.1` (issued through core `credential-exchange/issue`).
- Vetting: `vetting/request@0.1`, `vetting/session@0.1`, `vetting/attestation@0.1`, `vetting/decline@0.1`. Optional: VTI defines types only and has no handler (V); KW is applicant and vetter.
- Directory: `vtc/directory/query@0.1`, `vtc/directory/entries/list@0.2`. VTC-shaped; a generic "query card" is an inference (coverage review, I).
- Related ceremony: `vtc/member-onboarding/0.1` (kit ceremony; the suite has no vectors for it, V).
- Excluded: `vta/pcs/*` and `vtc/vetting/*` privacy-design internals (platform-specific); badges; room offers.

### 9.3 What a claimant must do
- Server (community host): serve invitation, join, vmc, directory tasks it claims; send `request-vmc`, `removal-notice`, `submit-receipt` where its design does (send-only, V).
- Client (member wallet): send `join-requests/submit`, receive offers and VMCs; (V) KW does this.
- Vetting: applicant and vetter roles, KW only today; a VTI vetting server does not exist.

### 9.4 Declaration in discovery
Proposed (inferred): `2l-5`, parts `2l-5.invitation`, `2l-5.join`, `2l-5.vmc`, `2l-5.vetting`, `2l-5.directory`. Mechanism per section 4.

### 9.5 Governance declaration points
Admission criteria and who decides; who may invite; the join manifest; vetting thresholds, vetter eligibility, hidden versus open vetting; VMC content, validity and renewal; removal rules; directory disclosure fields and visibility. All the deployer's; the profile defines the wire and declares none of these.

### 9.6 Conformance
May check: mechanics of each served task (schema, proof, errors, state transitions stated in the specs, plain-task probe); a join submit refused when the manifest requirements are unmet (only where the manifest is declared); invitation issue then deliver yields a `credential-exchange/offer` (needs observation of pushed documents, coverage review change B).
Must not check: admission outcomes, who may invite, vetting thresholds, VMC validity, directory visibility.
SKIP when undeclared: any vector needing an admission rule, manifest, vetter set or disclosure policy (`governance-undeclared`). Send-only tasks (`request-vmc`, `removal-notice`, `submit-receipt`) need the producer class.

### 9.7 Evidence
- VTI: `vtc/invitations/*`, `join-requests/*`, `members/vmc`, `request-vmc` (VTC serves or sends), directory `vtc/directory/*`; no handler for `vetting/*` (V).
- KW: `module/joinWire.ts`, `joinManifest.ts`, `joinSubmission.ts`, `vtiMemberVmc.ts`, `vtiInvitationOffer.ts`, `vtiVetting.ts`, `vettingSchemas.ts`, `hiddenVettingAdapter.ts`, `directoryDisclosure.ts`, `vtiCommunityNotices.ts` (file hits V).
- TS: ceremonies `member-onboarding`, `member-invitation`, `vrc-personhood` and credential vocabulary `credential:membership-vmc`, `credential:onboarding-vmc`, `credential:invitation-vic` (`p2p-trust-stack/packages/core/src/services/trust-tasks/type-uris.ts:49-145`, V per TS note); credential-exchange boundary `.../trust-tasks/boundary/credential-exchange.ts`. TS ceremony documents are DB rows, not wire envelopes (TS note section 0), so the TS evidence is vocabulary-level (inferred reading).
- Kit: ceremony `vtc/member-onboarding/0.1` (tasks use `credential-exchange/issue`), `vetting/identity-vetting/0.1`; vetting 49 slugs; directory and persona 33 slugs (V per coverage review).

### 9.8 Known gaps
- VTI does not implement the VRC ceremony; the suite has no vectors for member-onboarding.
- Vetting is KW-only (no server), so the recurrence gate is not met for the vetting member.
- Directory generic form is inferred.
- Needs a producer class and pushed-document observation for most useful vectors.

## 10. Open questions and inferences (all (inferred) items, plus decisions pending)

Inferences used in this draft:
1. Profile capability name pattern `2l-<n>[.<part>]`, optionally `@<version>`, and the two advertising mechanisms (implicit via `supportedTypes`; explicit via a new member or `ext`). No source states either. Discovery 0.4 has no profile-claim member (V).
2. G2 not required for 2L, G1 applied at profile level (docs/02 states the gates for core only).
3. Part-level claims (`2l-1.acl` and similar) and the minimum member set for a claim.
4. Excluding `policy/{upsert,get,list,delete}` from 2L-1.
5. `policy/evaluate` version pin (0.4 latest; VTI-served version not verified; TS maps 0.3).
6. Session vectors (challenge, authenticate, refresh, whoami) as described are derived from task purposes, not from existing vectors.
7. `consent/*` not served by KW (carried from earlier notes).
8. No TS acl slugs; no TS or KW evidence for device, push, notifications, audit (greps are not exhaustive).
9. Idempotent `device/register`, `device/disable` effects as checkable behaviour.
10. Listing `trust-ceremony-receipt` by reference in 2L-4 only.
11. Treating `keys/sign` as optional in 2L-2.
12. The `governance-undeclared` SKIP reason and the adapter `governance` capability block (proposed in the ACL pairing proposal; suite has neither).
13. Reading TS ceremony evidence as vocabulary-level.
14. 2L-3 provisional status and the replacement of `vta/notifications/*` by a generic inbox slug, which no source proposes.

Open questions (recommendation first where there is one):
1. `consent/*` placement. Recommendation: leave out of 2L until a second implementation exists (evidence VTI only); optional member group in 2L-1 is the compatible alternative. Not yet decided.
2. Naming collision: "assurance elevation" for step-up versus profile 2L-4 "Assurance". Recommendation: call the 2L-1 framing "session elevation" (the TF survey's term) and keep "Assurance" for 2L-4. Pros: no clash, matches TF survey. Cons: departs from the wording first suggested.
3. Single-platform members (2L-3 notify/relay; audit in 2L-4; vetting in 2L-5; push/device second implementation in 2L-2). Recommendation: keep the profiles, mark such members provisional and state the evidence limits to the TF. No recommendation on dropping 2L-3: depends on whether the recurrence gate strictly.
4. Advertising mechanism (section 4). Recommendation: implicit via `supportedTypes` first.
5. Whether ACL claims may be partial (part B alone) and whether session (part A) is a prerequisite. No recommendation: no evidence.
6. ACL version: pin 0.3 (current) although KW sends 0.1/0.2. Recommendation: pin 0.3; the KW gap is a work item, not a profile concern.
7. `termsRef` home: DID service (#78, open draft), discovery annotation, or adapter-only. Recommendation: DID service as source of truth with the profile mirroring it (ACL pairing proposal); unmerged and not published by VTI.
8. Seal citation from a grant (VAC route versus `ext` versus new version). No recommendation on `ext` versus new version; VAC route and internal policy first.
9. Whether to keep `trust-ceremony-receipt` listed in 2L-4.
10. Whether `policy/*` management belongs in 2L at all.
11. Push gateway role: which slugs a gateway serves (unchecked).
12. Whether to claim `policy/evaluate` on VTI evidence plus one TS mapping.

## 11. Not done
No `git fetch` of the TF (cache may lag origin); no GitHub Discussions; no builds, runs or tests; no search of other platforms' trees; individual version of each VTC-served task not re-verified; #904 and #78 read as in the ACL pairing proposal (no re-read this session).

Back to [the docs index](../README.md).
