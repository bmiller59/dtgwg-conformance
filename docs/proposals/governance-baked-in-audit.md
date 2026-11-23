# Governance baked in: static audit and a conformance mechanism (DRAFT)

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. This page is a DRAFT. Nothing in it has been filed with, sent to or discussed with any project. Date: 2026-11-15.

This page records where three implementations fix governance values in code, and sketches an advisory way for the suite to make that visible without ruling on which governance is right. The audit rows are neutral evidence about where a value lives and whether a declaration path exists; they are not a ranking and not a judgement of any platform. The standing principle (governance is never determined by conformance tests) is in [../16-roadmap-and-decisions.md](../16-roadmap-and-decisions.md); the related profile and pairing drafts are [2l-profiles-draft.md](2l-profiles-draft.md) and [acl-understanding-pairing.md](acl-understanding-pairing.md).

Tags: **(V)** verified by reading the file at the pinned commit; **(I)** inferred, not traced. Status of every external reference: **merged** (in the local copy of the kit or specification), **draft/open PR** (unmerged), **suite proposal** (this page; nothing published).

Pins: verifiable-trust-infrastructure (VTI) `55327b668`; keyring-wallet `62af4d2d`; p2p-trust-stack (truststackers core) `81d9575`; truststackers utility-server `e45c150`; dtgwg-vti-spec `416899c`. Paths below are relative to each project's own repository, and line numbers will drift.

## 0. Recommendation and summary

**Recommendation: add a separate advisory "governance declaration" lane to the suite, in three parts that share one finding vocabulary: (1) a small set of differential probes (GOV-FIXED), (2) default-probes (GOV-DEFAULT), (3) the audit below published as static evidence data that is never executed. Start with the probes that need no adapter-contract change (GOV-D-002 and the existing declared-property quorum vectors), and take a `governance` adapter capability to the task force alongside the 2L-1 ACL profile, since both need it.** Reason: it keeps the principle intact (the suite never says which governance is right) while making visible a platform that cannot take a declaration. The cost is one new adapter capability and one new SKIP reason; the rest reuses the suite's existing `requires` gate and its declared-property pattern (CER-014).

Summary of findings (all (V) unless marked; details in section 1):

- **VTI.** The VTA has a closed five-role set with a hard-coded who-may-assign rule and no way to declare roles. The VTC has seven built-in roles fixed by the build, custom roles can be added (`vtc/roles/define`), policy is Rego the community replaces, thresholds and lifetimes are configuration, and trusted witnesses default to none. The VTC also has host invariants a policy cannot override (a join cannot grant admin, admin promotion needs step-up, no self-promotion). The VTI specification's own role list is an informative annex, and the code's role name (`admin`) differs from the annex's (`administrator`).
- **keyring-wallet.** A client, so its findings are about reading governance out of strings: `role: 'admin'` sent literally, `role === 'admin'` read as "can manage the agent", a default vetter role `'vetter'`, and sender-side defaults `minApprovals 1`, `excludeRequester false`. No hard-coded trusted issuer, community or registry list was found (a negative result, scoped to the patterns searched). Witness locality policy is operator-configurable.
- **truststackers.** Built for declaration: community rules come only from per-community policy bindings (data), and the guard fails closed with none. What stays in code: founding rules in `createVtc`, a binary admin/member fact vocabulary, route-level admin checks outside the policy engine, and fixed 7-day and 30-day constants.
- **Spec-level, not platform-level.** The kit's `vtc/roles/define` names built-in roles that cannot be created, changed or replaced; `acl/grant` and `acl/revoke` presume a role ordering and a privileged subset without stating them; the VTI specification annex fixes five roles and calls `monitor` the safe default for an unspecified entry. These are recorded as spec-level evidence, never as a platform finding.

No recommendation is made on where a real deployment's governance declaration is read from (DID-service reference in an open draft versus adapter-only); see section 4.

## 1. Static audit

Reading key. **No declaration path** = the deployer cannot state something else without a code change. **Default, overridable** = a built-in default exists and a declaration or configuration path overrides it. **Mechanics** = not governance; listed so the boundary is visible. "Spec text fixes it?" records whether the specification text itself fixes the value, in which case it is not the platform's doing.

### 1.1 VTI (verifiable-trust-infrastructure)

| # | File:line | What is fixed | Declaration path today | Spec text fixes it? | Reading | Evidence |
|---|---|---|---|---|---|---|
| V1 | `vti-common/src/acl/mod.rs:22-35` (enum), `Role::parse` ~49-58; `vta-service/src/operations/acl_v0_2.rs:247` `KNOWN_ROLES` | VTA role set: admin, initiator, application, reader, monitor; unknown role refused `roleNotRecognized`; role-to-capability tables per variant | None for a VTA: no custom-role code in `vta-service` (grep, no hits for `RoleDefinition`) | Partly. VTI-ACL-010/011 (mechanics) merged; the role set is "recorded in Appendix C", which is informative and "a proposal for working-group ratification"; the annex names `administrator`, code and wire use `admin`. Kit `acl/*` treats role as opaque | No declaration path (VTA) | V |
| V2 | `vti-common/src/acl/mod.rs:27-33` `#[default] Monitor` | A `Default` for `Role`, documented as a fail-safe for test scaffolding, not as the role of an unspecified stored entry | n/a | The annex line "monitor: the safe default for an unspecified entry" is the spec-level assertion of a default; it sits beside VTI-ACL-011 "MUST NOT fall back to a default role" | Code: mechanics (per its comment). Annex: spec-level default candidate | V (comment, annex); other uses of `Default` not traced (I) |
| V3 | `vti-common/src/acl/mod.rs:1355-1372` `validate_role_assignment` | Authority rule: only admins assign admin; reader, application, monitor assign nothing | None | No. Kit `acl/grant/0.3`: the granter's entry is the ceiling, "a role above the granter's" refused; the order is left to the maintainer | No declaration path (VTA) | V |
| V4 | `vtc-service/src/acl/capability.rs:633-662` `AdminRole::BUILT_IN` (7), ceilings ~665-730 | VTC built-in roles (community-admin, moderator, vetting-lead, repo-manager, credential-officer, auditor, approver) and their ceilings, "fixed by this build, never defined, replaced or deleted through `vtc/roles/*`" | Partial. Custom roles can be added (`vtc-service/src/acl/roles.rs`, `vtc/roles/define/0.1`) but need role-assign and approvals-admin authority plus N-of-M consent, with the ceiling bounded by the definers' authority. Built-ins cannot be renamed or replaced | Yes for "cannot be replaced": kit `vtc/roles/define:builtInRole` (merged, draft maturity). Which seven roles is a VTI design note (not read) | No declaration path for replacing the built-in set; default, overridable for adding to it | V |
| V5 | `vtc-service/src/ceremony/invariant.rs:1-60` | Host invariants "a policy can never override": a `join` policy may not grant admin; admin promotion only via role-change with verified step-up; a caller may not grant themselves admin | None for the deployer. The specification sanctions one escape for second-party consent: single-administrator mode (VTI-APV-022), host configuration, not runtime | Partly. VTI-VTC-022 (policy MUST NOT confer authority) covers "policy cannot widen". The three rules have no matching sentence in the sections searched. The code comment cites VTI-OPS-050/051, which in the merged text say something else (probably renumbering) | No declaration path | V; the citation point is I |
| V6 | `vtc-service/src/config.rs:890-969` | Second-party consent threshold default 1 (floor 1, "no value switches it off"); action lifetime 72 h (bounded 15 min to 14 d); max open actions; decline cool-down 3600 s; removal cooling-off 24 h | Yes: `[acl]` configuration and a runtime key; the floor of 1 is code | VTI-APV-014 is a SHOULD with VTI-APV-022 as the sole exemption; VTI-APV-008 requires expiry, sets no duration | Default, overridable (values); the floor of 1 is spec-shaped | V |
| V7 | `vtc-service/src/policy/default.rs`; `vtc-service/policies/default/*.rego` (16 files) | Boot-installed default policy per purpose, only where none is active. `admission.rego:59` default allow; `removal.rego:36-45` default deny, with an admin removing a non-admin allowed and an admin subject refused (compares role `"admin"`, not the built-in name `community-admin`: other vocabulary, I); `cross_community_roles.rego:34` `allow := false` | Yes: replace the policy | No | Default, overridable | V |
| V8 | `vta-policy/src/defaults.rs:13-56`; `vta-policy/policies/default.rego` | VTA baseline decision point "intentionally permissive"; engine is deny-by-default if removed | Yes: layer a higher-priority policy; `[policy]` declarative approvals seeded from configuration | No | Default, overridable | V |
| V9 | `vta-sdk/src/approvals/mod.rs:156-162` | `effective_min_approvals` = `unwrap_or(1).max(1)`; `effective_exclude_requester` = `unwrap_or(false)`. Rule `policy/_shared/0.4` (merged 2026-10-27) requires both, no defaults | A rule can state both | Kit: required, no default. Whether the model default reaches the wire as an implied value was not traced (I) | Default, overridable | V (code), I (wire effect) |
| V10 | `vti-voting/src/rules.rs:154-190` | Trustee threshold `2 <= t <= n <= 64`; community and ballot box cannot be trustees | None; manifest-validity rules | VTI-VOT-062 "a trustee MUST NOT hold enough shares to decrypt alone" implies at least 2 (I); 64 is the index width | Mechanics | V |
| V11 | `vtc-service/src/config.rs:250-300` | Directory defaults: `listed`, retention 30 days, facet threshold k = 5 (min 2), `external_cards` true, list rate 60/min | Yes (configuration) | VTI-DIR-113 states k; default 5 is code (I) | Default, overridable (consent, retention) | V |
| V12 | `vtc-service/src/credentials/trusted_witnesses.rs:1-40` | Trusted witnesses: an empty list trusts none; a credential from an unlisted issuer is refused by the host "before any policy runs" | Yes: `[witnesses] trusted` or `witnesses.trusted` via configuration patch, each change consent-gated | VTI-CMP-030 separates provenance from authority | Default, overridable (default-deny) | V |
| V13 | whole tree (grep) | No `GovernanceFramework` DID service and no `termsRef`; only `governance_framework_url` on a personhood profile (`vtc-service/src/community/profile.rs:144`) | No machine-readable place for a deployment to state its governance | An open draft PR on the VTI specification (VTI-KEY-052) defines it; not merged | Not a baked-in rule; a missing declaration surface | V |
| V14 | `vtc-service/src/join/criteria.rs:1-40` | Join criteria are the community's published ones ("adds none of its own"); a join with no criterion is never admitted | Yes (published criteria) | n/a | Mechanics (kept for balance) | V |

Not audited in depth (I): VTN, rooms, boards, badges, git-ns. The `git-ns` administrator-only switch is a spec-recorded stand-in.

### 1.2 keyring-wallet (bifold core and witness-server)

Paths are under `bifold/packages/core/src/modules/trust-tasks/module/` unless stated.

| # | File:line | What is fixed | Declaration path today | Spec text? | Reading | Evidence |
|---|---|---|---|---|---|---|
| K1 | `VtaClient.ts:2125` (`grantAdmin`) | Sends `role: 'admin'` literally with `FULL_ADMIN_AUTHORITY_02` | None; the role name is not read from a declaration | No | No declaration path (client side, against a service that declares other names) | V |
| K2 | `vtaAgent.ts:2414` (`role === 'admin'` lists devices); `vtaDevices.ts:181` (`limitedAccess: role !== 'admin'`); `hiddenVetting.ts:182` (`role !== 'admin'` decides phone eligibility) | The wallet infers "can manage the agent" and "limited access" from the role string `admin` | None | No | As K1 | V |
| K3 | `vtiEligibility.ts:44`; used at `vtiVetting.ts:2171`, `:2581` | Default vetter role `'vetter'` when a community's requirements name none | Yes: the requirements name a role | No | Default, overridable | V |
| K4 | `approvalsPolicy.ts:36-38`, `:47-48`; `approvalRules.ts:262-271` | `effectiveMinApprovals` default 1; `effectiveExcludeRequester` default false; `withPhoneRule` writes `minApprovals 1`, `excludeRequester false` and a one-member approver set (this phone) when the user switches a rule on. The policy sent carries explicit values (`approvalsPolicy.ts:101`) | The user chooses which rule is on; other rules are shown read-only | Rule `policy/_shared/0.4`: values required, none defaulted at the schema | Default, overridable; the phone-rule values are the app's mechanics for "approve on this phone" | V |
| K5 | `approvalRules.ts:32-37` `OFFERED_TASKS` | Only four task types can be gated from the UI (contexts create/delete, webvh dids delete, keys revoke) | The service's own policy can gate others | No | Mechanics (UI scope) | V |
| K6 | `bifold/packages/core/src/modules/vrc/vrc-manager.ts:168-169`, `:345` | A relationship credential the wallet issues expires after 7 days; no setting found | Not found | Relationship-credential specification not checked | Default with no override seen; low weight | V (constant), I (no setting) |
| K7 | `bifold/packages/witness-server/src/trustTasks/WitnessTaskSessions.ts:142-164`; `WitnessService.ts:1432-1545` | Locality policy `off`/`offered`/`required` (default off) and event start/end window, set by the operator (environment, configuration) | Yes | n/a | Mechanics | V |
| K8 | grep of bifold core, trust-tasks and app sources for trusted issuer, witness, registry, fixed community or ecosystem identifiers | Nothing, other than `MDOC_TRUSTED_CERTIFICATE_BASE64` (`utils/agent.ts:51`, environment) | Environment | n/a | None (negative result, patterns searched only) | V |

### 1.3 truststackers (core and utility-server)

| # | File:line | What is fixed | Declaration path today | Spec text? | Reading | Evidence |
|---|---|---|---|---|---|---|
| T1 | core `src/services/governance-guard.ts:393-435`; `policy-bindings.ts:1-30`; `policy-engine-config.ts:1-30` | A community's rules come only from its policy bindings (data): "no stored policy document and no fallback"; no bindings gives the document default `deny`. An environment variable picks the engine, not rules | Yes: `community_policy_bindings` per community, rule templates in a global catalog, runtime-editable | n/a | Mechanics (a model case for the principle) | V |
| T2 | core `src/services/policy-engine.ts:330-460` `defaultPolicy(kind)`; `governance-guard.ts:445-455` | The baseline rules (issue credentials, approve, revoke, add/remove admin, update governance: all `actor_is_admin`; crystallize needs `approval_count >= threshold_n`, that is every founding admin) govern a community under formation, before an identity row exists; afterwards bindings apply | Founding: none visible. After founding: bindings | No | Default, overridable after founding; no declaration path for the founding ceremony (I: seeding of bindings not traced) | V (code), I (seeding) |
| T3 | core `src/services/policy-engine.ts:305-306`, `:231-237` | Fact vocabulary the guard assembles: `actor_is_admin`, `subject_is_active_member`, `subject_is_community_member`; a supplementary `facts` bag exists. The role model a policy can express is admin versus member | Partial (facts bag, parameter facts from bindings) | No | No declaration path for hierarchies beyond admin/member (I: how far the bag extends) | V (header), I (extent) |
| T4 | core `src/services/vtc.ts:296`, `:319-323`, `:337-361` | `createVtc`: default threshold 2 for a VTC; only `subjectKind = human` VTAs may be founding admins (the comment calls it a governance requirement); each additional founding admin needs an established bidirectional relationship credential with the creator; threshold at most admin count | None found | Not located in the kit; the attribution is the comment's (I) | No declaration path | V |
| T5 | core `src/services/vtc.ts:371-383`, `policy-engine.ts:396-411` | Comments still say "at least 2 admins, threshold >= 2"; the rules and code say 1 | n/a | n/a | Mechanics (documentation drift) | V |
| T6 | utility-server `src/routes/layer5-applications/vtns.ts:64-74`; `src/tx/governance-change-participant.ts:266-274`; `src/tx/ceremony-participant.ts:348` | Route-level authority outside the policy engine: only memberships with role `admin` or `founding_admin` may manage VTN network rules; the governance-change approver roster is admins; role strings `admin`, `founding_admin`, `member` | None for the route check | No | No declaration path | V |
| T7 | utility-server `src/tx/governance-change-participant.ts:62`; `src/tx/ceremony-participant.ts:388` | Proposal expiry 7 days (constants). Expiry is enforced only on the core coordinator path | None found | n/a | Default with no override seen; low weight | V |
| T8 | utility-server `src/routes/layer4-governance/memberships.ts:36-40` | Membership credential default validity 30 days "per OpenVTC spec" | Not traced | OpenVTC specification, not checked | Default (I: overridable) | V (constant), I |
| T9 | core `src/services/governance-change.ts:96-108`; utility-server `src/tx/governance-change-participant.ts:271-274` | Change-approval scope default `admins`; `members` scope `minApprovals ?? 1` | Yes (scope and count in the proposal) | n/a | Default, overridable | V |
| T10 | core `src/tx/ceremony-store.ts:149-187`, `ceremony-coordinator.ts:96,162` | A second crystallization path (`count >= prop.threshold`) beside the policy rule `crystallize-quorum-*`; threshold from the proposal | Proposal field | n/a | Mechanics, but two sources of one rule (I: they can disagree) | V |

### 1.4 Overall reading

- Fixed role vocabularies: VTI VTA (V1, V3), VTI VTC built-ins (V4), truststackers admin/member strings (T3, T6), keyring-wallet reading `admin` (K1, K2). Spec-level contributors: V1 annex, V2 annex default, V4 `builtInRole`, kit `acl/*` ordering.
- Defaults a declaration overrides: V6-V9, V11, V12, K3, K4, T2 (after founding), T8, T9.
- Fixed ceremony or admission rules with no declaration path: V5, T4, T6.
- Mechanics named so they are not flagged: crypto bounds (V10), expiry required by the specification (VTI-APV-008), VTC join criteria (V14), truststackers bindings (T1), witness locality configuration (K7).
- Several fixed rules protect against privilege escalation. The finding is only that the deployer cannot state something else; it is not a view that a fixed rule is wrong.

## 2. Conformance mechanism (design only; nothing implemented)

### 2.1 Principles

1. The suite never rules on which governance is right. It observes only whether a declaration was honoured, overridden, rejected, or replaced by a built-in.
2. Governance values in vectors come only from the declaration. The harness builds alternative declarations from nonce names with no semantics (`gov-r-<hex>`), never from a built-in set of names.
3. Findings are advisory data. They never change PASS, FAIL, SKIP, KNOWN-FAIL or CLARIFY counts, tier roll-ups, the matrix headline, or the runner exit code.
4. Where the specification text itself fixes governance, it is not a platform finding (2.6).

### 2.2 Finding names

| Name | Meaning (neutral) | Produced by |
|---|---|---|
| `GOV-FIXED` | A governance value the adapter declared was not honoured: rejected, ignored, or replaced by a built-in. Reports declaration support only | differential probe |
| `GOV-DEFAULT` | With nothing declared, the platform stated or applied a governance value as if normative (an implied role, threshold or authority rule) where the tested text says "not stated" | default-probe |
| `GOV-HONOURED` | The declaration was applied (shown so a clean result is visible, advisory column only) | differential probe |
| `GOV-NOT-PROBED` | No declaration path was exercised (2.5) | runner |
| `GOV-EVIDENCE` | A row of the static audit attached to the platform (section 1); not a result | static companion |
| `GOV-SPEC` (evidence only) | The specification text fixes the value; attributed to the specification, not the platform | static companion |

Wording rules, to be enforced by a lint on the report template:

- Pattern: "Declared `<item>` = `<value>`; the platform applied `<observed>`. This reports whether a declaration was honoured. It makes no statement about whether `<observed>` is appropriate."
- <!-- lint:skip -->Never use: wrong, bad, non-compliant, violates, should have, fails, weak, insecure, or any ranking or score word. No platform ordering in any table; the advisory column lists platforms alphabetically.<!-- /lint:skip -->
- A finding names what was declared and what was observed, never "the platform's governance".

### 2.3 Where they appear

- A separate column "Governance (advisory)" in the capability matrix and a separate section in the Markdown report; the JSON result carries `advisories.governance[]` apart from `verdicts[]`.
- Not counted in PASS/FAIL/SKIP totals, Tier 1 or Tier 2 roll-ups, headline numbers, the vacuous-pass rule, or the exit code. Cell text is neutral (`honoured 3 / not honoured 1 / not probed 2`), no red or green.
- Channel-aware (reading, I): each vector and finding carries the channel of the text it rests on: `merged`, `draft` (PR number and head), or `proposed` (suite proposal). The `governance` capability and the 2L-1 profile are `proposed`, so every probe in 2.4 starts in the `proposed` channel and is shown "against a proposal". A finding rests on a merged channel only where its anchor sentence is merged (for example the "no default role" sentence in `acl/grant/0.3`, and `policy/_shared/0.4`). Channel is a label, not a filter; hiding a channel changes nothing outside the advisory column.

### 2.4 The five highest-value probes

IDs are sketches (I). Common steps for a differential probe: (a) read `capabilities.governance`; (b) generate an alternative declaration from nonces; (c) ask the adapter to apply it; (d) exercise the platform through ordinary tasks; (e) compare with the declaration only.

**GOV-D-001 role vocabulary substitution (differential).**
- Anchors: kit `acl/grant/0.3` item 1 (an unrecognised role confers nothing, MUST NOT fall back to a default) and `roleNotRecognized.details.knownRoles` (merged); the declaration itself is `proposed`.
- Declare `{gov-r-a, gov-r-b}` (two, so the count differs from a built-in five or seven).
- Steps: a provisioned granter runs `acl/grant` for `gov-r-a`; `acl/list` shows it; `acl/grant` with a nonce role not declared.
- Observe: the first is accepted and listed as `gov-r-a`; the nonce is refused `roleNotRecognized`; `knownRoles`, if returned, equals the declared set.
- `GOV-HONOURED` if all hold. `GOV-FIXED` if `gov-r-a` is refused `roleNotRecognized`, `knownRoles` still lists a built-in set, or the entry lists as another role. Expected from the audit: VTA GOV-FIXED (V1). VTC: roles are declared through `vtc/roles/define` (the adapter's job), so the probe reports whether the declared role works and, as a note only, whether built-ins remain accepted.

**GOV-D-002 unknown role: no default (default-probe; works today).**
- Anchors: `acl/grant/0.3` item 1 and VTI-ACL-011 (merged text, same words). Needs no declaration.
- Steps: `acl/grant` a nonce role, then `acl/list` for the subject.
- Observe: refusal and no entry. `GOV-DEFAULT` if an entry exists with any role, or the refusal presents a role as "the default". Expected: VTI refuses (V1 enum parse); that no entry is created is not traced (I).

**GOV-D-003 authority rule substitution (differential).**
- Anchors: `acl/grant/0.3` consumer item 4 (the granter's entry is the ceiling; a role above the granter's is `permissionDenied`) and item 3 (the maintainer's role model bounds the result), merged. The ordering is the maintainer's, so the declaration states it (`proposed`).
- Declare `{gov-r-a, gov-r-b, gov-r-c}`, an order where `gov-r-b` ranks above `gov-r-a`, and that `gov-r-c` may grant only `gov-r-a`. The order is generated so it matches no built-in order the adapter reports.
- Steps: provision granters for each role; c grants a (accept); c grants b (`permissionDenied`); a grants a and b grants c (declared outcomes).
- Observe each outcome equals the declaration. `GOV-FIXED` where an outcome follows a built-in rule instead. Expected from the audit: VTA GOV-FIXED (V3).
- `SKIP(governance-undeclared)` when no `authority` is declared; structural-ceiling vectors still run.

**GOV-D-004 quorum and self-approval substitution (differential).**
- Anchors: `policy/_shared/0.4` (merged): `minApprovals` and `excludeRequester` required, no defaults; suite groups TC-018, CER-004, CER-014 (the declared `ceremony.proposerApproves` is already a declared-property vector, so this extends an existing pattern).
- Declare a gated task with `minApprovals = k` and `excludeRequester` true, then false, `k` from {2, 3} (not the model default of 1).
- Steps: the requester submits; `k-1` distinct approvers decide; assert held (`pending` or next-step per TC-018); the k-th approves; assert executed once. With `excludeRequester` false the requester's decision counts; with true it does not.
- `GOV-FIXED` if the platform executes at another count, ignores `excludeRequester`, or refuses `k` without stating the bound as a declared limit. Expected: VTI rules carry both values (V9 is a model default only); the VTC consent threshold is configuration (V6), so 3 should be honoured (I: not run); truststackers founding unanimity (T2, T10) would show as GOV-FIXED if probed through the founding ceremony.

**GOV-D-005 declared policy versus a built-in invariant (differential, opt-in).**
- Anchors: none merged. It probes the VTC host invariants (V5) and truststackers `createVtc` rules (T4), which no merged text requires. `proposed` only.
- Declare that role `gov-r-a`, marked most privileged in the declaration, may be granted at join (or self-granted, in a one-owner declaration) with no step-up.
- Observe whether the platform applies the declaration or a built-in refusal. `GOV-FIXED` records "a built-in rule was applied over the declaration"; the wording must not call the rule unjustified, and a note carries any specification sentence that sanctions it (for example VTI-APV-022). Because several such rules defend against escalation, this probe is off by default (`--advisory governance.invariants`).

Held back (lower value now): seal-before-grant gating (needs an open draft and a citation route the task force has not chosen); `termsRef` digest integrity (mechanics); retention or expiry substitution (V6, V11, T7); default-allow versus default-deny consent posture (V7, V8).

### 2.5 Interaction with SKIP `governance-undeclared`

- `SKIP(governance-undeclared)` is as the ACL pairing draft defines it: the adapter declares no governance item the vector needs. A legal state, never a finding.
- It must be distinguishable from "the platform cannot take a declaration", so the adapter declares `governance.declaration` as `supported` | `none` | `unknown`:
  - `supported`, no items declared: vectors SKIP `governance-undeclared`; the advisory shows `GOV-NOT-PROBED` ("no declaration supplied").
  - `supported`, items declared: differential probes run.
  - `none` (the adapter says the platform has no declaration path): vectors SKIP; the advisory shows `GOV-FIXED (self-reported)` for the items the adapter names, labelled "stated by the adapter, not observed". The one finding the suite does not observe.
  - `unknown` (default for an adapter that says nothing): `GOV-NOT-PROBED`.
- Default-probes (GOV-D-002, the missing-value probe for `policy/_shared/0.4`) run regardless, since they test the undeclared state itself.
- A SKIP never yields GOV-FIXED by itself, and no probe turns a SKIP into a FAIL.

### 2.6 Static-evidence companion

- Data, not tests: `evidence/governance/<platform>.json`, one row per finding: `id`, `platform`, `commit`, `file`, `line`, `what`, `declarationPath` (`none`/`partial`/`yes`), `specLevel` (`platform`/`spec`/`both`) with specification reference and channel, `reading`, `verified` (`V`/`I`), `auditedOn`. Section 1 is the first dataset; it is not yet exported as JSON.
- Rendered as "Static governance evidence (not a test result)", alphabetical by platform, no counts in headline figures. Rows pin a commit; the report marks a row `stale` when the platform commit differs; the runner never fails on staleness.
- `GOV-SPEC` rows (V1 annex, V2 annex default, V4 `builtInRole`, kit `acl/*` ordering) are addressed to the specification owners and kept out of platform columns; they feed the questions in section 4.
- Dynamic findings link to evidence rows by id (GOV-D-001 on a VTA links V1 and V3), so code location sits beside observed behaviour.

### 2.7 Adapter-contract changes needed

| Item | Needed by | Change | New or existing |
|---|---|---|---|
| `capabilities.governance`: `declaration` (`supported`/`none`/`unknown`), declarable items (`roles`, `authority`, `consent`, `sealBeforeGrant`, `termsRef`), `provision.principalWithRole` | D-001, D-003, D-005 | New capability (same shape as the ACL pairing draft proposes) | New |
| Operation `declareGovernance(decl)` returning `applied`/`rejected(reason)`/`unsupported`, and `resetGovernance()`; or launch the adapter twice with `--governance-profile <file>` (no contract change, two runs per platform) | D-001, D-003, D-004, D-005 | New adapter method or runner option | New |
| SKIP reason `governance-undeclared` | all differential | New reason string; the `requires` gate exists | Extension |
| Reading an ACL entry back: `acl/list` through `send`, else an `observe` kind | D-001, D-002 | None if `acl/list` is served | Existing or small |
| Consent declaration `{task, minApprovals, excludeRequester, approverSet}` | D-004 | Extends `capabilities.ceremony` and the declared properties | Extension |
| Results schema: `advisories.governance[]`, `channel` | all | Runner and schema; no adapter change | New (schema) |

D-002 needs none of these. D-004 mostly rides existing ceremony declarations.

## 3. Open questions (recommendation first where there is one)

1. **Where does a real deployment declare governance?** Recommend: the DID-document `GovernanceFramework` service (open draft on the VTI specification), mirrored by the adapter, as in [acl-understanding-pairing.md](acl-understanding-pairing.md). Pros: hash-pinned, resolvable. Cons: unmerged; no platform publishes it (V13). Alternative: adapter-only, usable today, unreadable by a counterparty. No recommendation on a machine-readable role section for that document; no format exists.
2. **Show GOV-FIXED on a `proposed`-channel vector outside the advisory column?** Recommend no: keep it advisory and labelled "against a proposal". Con: easy to skip. Pro: keeps the principle and avoids anything resembling a ruling.
3. **Self-reported GOV-FIXED (`declaration: none`).** Recommend show it, labelled "stated by the adapter". Con: depends on the adapter author's honesty. Pro: otherwise a platform with no probe-able surface looks clean; no other design observes it.
4. **GOV-D-005 on by default or opt-in?** Recommend opt-in: it probes rules (V5) that protect against escalation, and whether a deployment may switch them off is for the task force and the deployer. Con: opt-in findings are easily never run.
5. **Spec-level items for the task force** (no outward contact made): (a) kit `vtc/roles/define:builtInRole` presumes a built-in set; (b) `acl/grant` and `acl/revoke` presume a role order and privileged subset; (c) the VTI specification annex fixes five roles, names them differently from the code, and calls `monitor` the default for an unspecified entry. Evidence: rows V1, V2, V4.
6. **Citation mismatch in VTI code** (V5): comments cite VTI-OPS-050/051 for rules those identifiers do not state. For the VTI maintainers; internal until the project owner decides.
7. **truststackers baseline versus bindings** (T2): how new communities are seeded with bindings, and whether founding is governed only by the baseline, was not traced. A short follow-up read settles "no declaration path" versus "default, overridable" for the founding ceremony.
8. **Channel idea.** Confirm the reading in 2.3 before building (see the spec-channel idea in [../16-roadmap-and-decisions.md](../16-roadmap-and-decisions.md)).
9. **Audit scope.** Not covered: VTN, rooms, boards, badges, git-ns, keyring-wallet app screens, the utility-server UI, p2p-trust-stack application API beyond the ceremony document. Those results are unknown, not clean.

## 4. Review passes

- Testing requirements: none were specified; the mechanism design is untested by construction (no implementation).
- Test coverage: not applicable (documentation only).

Back to [../README.md](../README.md). Index of related pages: [the docs index](../README.md).
