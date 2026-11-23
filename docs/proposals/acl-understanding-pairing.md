# Pairing acl/* with understanding/* (2L-1): design note

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. Not filed, not sent. Nothing here has been posted to, filed with, or sent to any project.

Date 2026-11-15. Read-only research behind the recorded roadmap decisions [RD1 to RD7](../decisions/05-application-profiles-roadmap.md#roadmap-decisions-rd1-to-rd7) (see [../16-roadmap-and-decisions.md](../16-roadmap-and-decisions.md), section 2). Back to [the docs index](../README.md).

Tags: (V) verified in a file or API result when the note was written; (I) inferred, not verified.
Status tags on every external reference: **merged** (in kit origin/main), **draft/open PR** (unmerged, with number and commit).

Sources and pins:
- Kit: the TF registry repository (local clone), origin/main 0dbc98f1c (2026-11-14). Note: it has 20 acl spec versions over 7 slugs (change-role, grant, list, revoke, show, swap-key, update; versions 0.1-0.4), not 14 as earlier notes had it (V). The 0.3 set was read, plus `_shared/0.3`.
- #904 (open draft PR, trustoverip/dtgwg-trust-tasks-tf, head 96b1d70, branch `understanding-rebased`, last update 2026-11-13). Spec files at that head, the PR body and all 9 comments were read (V).
- vti-spec PR #78 (open draft, VTI-KEY-052): body read via the GitHub API (V). VTI-KEY-052 is NOT in the local clone of the VTI specification repository (grep, V).
- VTI (verifiable-trust-infrastructure) 55327b668; keyring-wallet 62af4d2d; VTI spec `dtgwg-vti-spec/spec/03a-access-control.md` (merged text).

## 0. Recommendation (first)

**Recommendation: the 2L-1 ACL profile defines mechanics only and carries a single declared pointer to the deployment's governance document (`termsRef {uri, version, digestMultibase}`); role names, role meanings and who-may-grant-what live in that document. Sealing an understanding before a grant is an optional deployment rule, off unless the deployment declares it.**

Reason: the merged acl specs already treat a role as an opaque string and a ceiling (V, section 1), so the profile does not need to change them; it only needs a place to say "the vocabulary is defined here". That keeps the recorded decision (governance is never determined by conformance tests) intact and reuses #904's shape without making acl depend on the seal task.

This note has **no recommendation** on two points, because the evidence does not settle them: (a) whether a per-grant citation of a sealed understanding needs a new payload member or can ride on `ext` (section 3, option B); (b) whether the pairing should name `understanding/*` at all, given the #904 thread says the host-governed family may be renamed (section 6). Both go to the TF.

## 1. What acl/* says today about roles and authority (V)

- Role is an opaque string, "interpreted by the ACL maintainer"; it is a **ceiling, never a grant**; an unrecognised role confers nothing and "MUST NOT fall back to a default role" (`acl/_shared/0.3` AclEntry.role; grant/0.3 consumer item 1). `roleNotRecognized` carries `offendingRole` and `knownRoles` in its details (grant/0.3 error table, line ~49-57).
- "Role and capability vocabularies are opaque to this family; each maintainer publishes its own (the `vtc/roles` family is one)" (grant/0.3 Overview).
- Who may grant: the granter's own stored entry is the ceiling on every axis; "a role above the granter's is `permissionDenied`" (grant/0.3 consumer item 4, Authorization). The maintainer's role model bounds the result a second time (item 3).
- Whether extra approval or step-up is required: "the maintainer's policy and is not declared here" (grant/0.3 Authorization and Privacy sections).
- `acl/revoke` refuses removing the last holder of "a privileged role the maintainer's policy protects" (`lastAuthorityProtected`, revoke/0.3 item 4). `acl/list` returns zero matches for an unknown role (list/0.4 item 4).
- Where roles ARE defined: not in `acl/*`. `vtc/roles/define/0.1` (merged, draft maturity) lets a VTC define custom roles, but it also has "built-in roles" that "cannot be created, changed or replaced" (`vtc/roles/define:builtInRole`) (V). So even inside the kit, one family presumes a built-in set.
- The kit evaluation already ruled acl "fail" for framework core because it "embeds roles/authority" and FW item 10 leaves authorization unspecified (07-core-task-evaluation.md, V). That is consistent with this design.

Two points where the merged specs imply governance without naming it (V, flag for the TF):
1. "a role above the granter's" presumes an **ordering** of roles. Nothing in `acl/*` defines the order; it is implicit in each maintainer.
2. "a privileged role the maintainer's policy protects" presumes a **privileged subset**. Same: undeclared.

## 2. Referencing a governance document from an ACL profile

Shape (proposal, I): the 2L-1 profile declares one optional member, `governance: { termsRef: RegisterRef }`, where `RegisterRef` is the shape that #904 defines (`_shared/0.1/agreement.schema.json#RegisterRef`: `uri` (iri), `version`, `digestMultibase`, optional `mediaType`; draft, #904) and that vti-spec #78 defines for the DID-document `GovernanceFramework` service (`serviceEndpoint`, `version`, `digestMultibase`; draft, #78) (V). #904's offer spec states the two shapes are intended to match and that offer's `termsRef` MUST equal the host's published service where one exists (V).

Where the pointer can live, with pros and cons (recommendation first):

- **Recommended: the DID-document `GovernanceFramework` service (#78) as the source of truth; the profile/adapter mirrors it.** Pros: already designed, hash-pinned, resolvable from the maintainer's verified DID document, matches #904. Cons: #78 is an unmerged draft; VTI does not publish it yet (grep of VTI found no `GovernanceFramework` service or `termsRef`; its only governance field is `governance_framework_url` on a personhood profile, `vtc-service/src/community/profile.rs:144`, V); a VTA (not only a VTC) may have no community framework (I).
- Profile-level discovery annotation (`trust-task-discovery`). Pros: no DID change, per-profile. Cons: not designed anywhere found; a TF change (I).
- Test adapter capability only. Pros: no spec dependency, usable today. Cons: nothing a real counterparty can read; only for the harness.

What the document defines vs what the profile defines:

| Profile (mechanics) | Governance document (deployer's choice) |
|---|---|
| Wire shapes, proof, recipient, expiry, replay, error codes | Role names and meanings |
| "Unknown role refused, no default fallback" | Role ordering, privileged subset |
| Granter-ceiling check is evaluated against the stored entry | Which roles may grant which (authority rules) |
| Idempotency, compare-and-swap on change-role | Whether a grant needs an approval, step-up or sealed understanding |
| Delegation provenance (`delegatedBy`) recorded | Last-authority protection policy |

Gap (V/I): there is no schema for the governance document's role section. `RegisterRef` points at an opaque document. Without a machine-readable role list in it, nothing but the adapter's declaration states the role set in testable form (section 4).

## 3. What a deployment must declare: options, not defaults

Each item is declared by the deployer in its governance document or adapter configuration. The profile supplies no default for any of them; "undeclared" is a legal state and is reported as `indeterminate` (the kit's existing "not stated is not absent" idea, FW closed ruling 7, per note 07, V).

1. **Role enumeration.** Option A: the document lists role names (and optionally ceilings). Option B: the maintainer's `roleNotRecognized.details.knownRoles` is the only list. Option C: undeclared. Recommend A with B as a consistency cross-check. Cons of A: a second place to keep in sync. Cons of B alone: only visible on refusal.
2. **Grant/revoke authority rules.** Option A: a list of (granter role, grantable roles). Option B: just the structural rule already in the spec (cannot exceed granter), with the ordering declared. Option C: undeclared. No recommendation between A and B: A is explicit but duplicates the spec's ceiling rule; B is minimal but needs an ordering format nobody has defined.
3. **Sealed understanding before grant takes effect.** Options: (a) never required (default state, since nothing is required); (b) required for named roles; (c) required for all. Under (b)/(c) the maintainer refuses or holds the grant until a sealed understanding exists for the subject. No recommendation on b versus c; this is purely the deployer's choice and the profile must not pick.
   How the seal is cited:
   - Option A (use #904's own expectation): access follows via a Verifiable Authority Credential issued by the host citing the seal as outcome evidence (seal spec, "Graduated access following a seal", V). The ACL grant is then the maintainer's own act, informed by that credential. Pros: no payload change; matches the draft. Cons: the VAC layer is a different spec family; ACL stays disconnected from the seal.
   - Option B: cite the seal's `id` plus task digest from the grant (SPEC 4.9.3 style, as #904 does for its own citations). The merged `acl/grant/0.3` payload is `additionalProperties:false` with only `entry`, `reason`, `ext` (V), so this needs `ext` (SPEC 4.5.1, V member exists) or a new grant version. Pros: auditable link in the grant document. Cons: `ext` semantics are ecosystem-defined; a new grant version is a TF change. No recommendation: depends on whether the TF wants acl to know about seals.
   - Option C: the deployment's policy checks internally; nothing on the wire. Pros: simplest. Cons: not independently verifiable.
   Start with A and C, and take B to the TF.

## 4. What conformance may and may not check

Standing principle (the recorded decision): governance is never determined by conformance tests.

**May check (mechanics):** envelope/proof/recipient/expiry/replay on each acl task; payload shape (entry requires `subject, role, act, keys, capabilities, purposes`; empty `act` list refused, `purposes` explicit); `roleNotRecognized` for a role string the harness guarantees is unknown (a random nonce), and that the maintainer applies no default role; idempotent re-grant; existing subject with a different role is refused with the `acl/change-role` hint; a grant cannot exceed the granter's stored entry (using a granter the adapter provisions with an authority the adapter declares); change-role compare-and-swap; revoke/ swap-key atomicity; list filters and unknown filter returns zero matches; `termsRef` shape and, if declared, digest integrity (fetch `uri`, check `digestMultibase`; mismatch or unfetchable is `indeterminate`, per #78's rule that mismatch is indeterminate, not failure, V).
**Consistency checks against what the adapter declares (not against any built-in):** each declared role can be granted by a granter the adapter says holds authority; a role not in the declared set is refused; `knownRoles` in the refusal equals the declared set (or is a superset, SKIP-with-note if the maintainer withholds it); if the deployment declares "sealed understanding required", a grant without one is refused, and with one is accepted.
**May not check:** that any named role exists (`admin`, `initiator`, ...); a role hierarchy or "super-admin" meaning; that a given role may grant another; a minimum or maximum number of roles; that a default role is least-privileged; that a seal IS or IS NOT required; whether the governance document's content is sensible; which `purpose` string a deployment uses.

Adapter capability (naming is a drafting proposal, I):
```
governance: {
  termsRef?:   { uri, version, digestMultibase },   // declared source
  roles?:      [ { name, ceilingNote? } ],           // opaque names, no semantics checked
  authority?:  [ { granter: roleName, may: [roleName] } ] | "structural-only",
  sealBeforeGrant?: "never" | { roles: [roleName] } | "all",
  provision: { principalWithRole(roleName, act, keys) }   // how the harness obtains a granter
}
```
Behaviour when undeclared (all SKIP, reason `governance-undeclared`, never FAIL):

| Undeclared | Vectors that SKIP | Vectors that still run |
|---|---|---|
| `roles` | role-accepted, role-consistency, granter-ceiling (needs a granter) | nonce-role refusal, shape, proof, recipient, replay |
| `authority` | cross-role authority vectors | structural ceiling vectors if a granter can be provisioned |
| `sealBeforeGrant` | all seal-gating vectors | none depend on it |
| `termsRef` | digest integrity | all others |

Harness rule (I): no vector asserts anything about a role name taken from the harness's own code; role names in vectors come only from the declaration. The existing suite already uses a `requires` capability gate that yields `SKIP(not-applicable)` (05-conformance-suite-design.md, V), so this fits the current contract; a new SKIP reason string is needed.

## 5. Findings: things in VTI and keyring-wallet that assume a role set (evidence, not criticism)

Context: these implementations were built to VTI's own spec, which does define a role set; the findings show where "no built-in role set" would need a configuration point (V unless marked).

VTI (55327b668):
- `vti-common/src/acl/mod.rs:22-35`: `enum Role { Admin, Initiator, Application, Reader, Monitor }` with `Monitor` as `#[default]`; `Role::parse` (line ~49-58) errors on anything else. The role-to-capability table is hard-coded per variant (lines ~487-581). 475 references to `Role::Admin`/`Role::Initiator` in vta-service, vtc-service and vti-common (grep).
- `acl/mod.rs:~1355-1372` `validate_role_assignment`: hard-coded authority rule ("Only Admins can assign the Admin role"; Reader, Application, Monitor cannot assign). `AclEntry::is_admin` matches `Role::Admin` (~1088). Admin maps to unrestricted act scope (~687-701).
- `vta-service/src/operations/acl_v0_2.rs:247`: `KNOWN_ROLES = ["admin","initiator","application","reader","monitor"]`, used to emit `roleNotRecognized`.
- VTI spec (merged): VTI-ACL-010/011 are mechanics-only and compatible; but "the role set and ceiling of each role are recorded in Appendix C", listing five roles including "`monitor`: the safe default for an unspecified entry" (V). A default-for-unspecified is a governance default under the recorded decision, and sits slightly against its own VTI-ACL-011 (no default role) (I: possible tension, may be about different cases).
- No `GovernanceFramework` DID service or `termsRef` in VTI code (grep, V).
Kit (merged): `vtc/roles/define:builtInRole` presumes built-in roles (V).
keyring-wallet (62af4d2d, `bifold/packages/core/src/modules/trust-tasks/module/`):
- `VtaClient.ts:~2125` `grantAdmin()` sends `role: 'admin'` literally (with `FULL_ADMIN_AUTHORITY_02`), and its doc comment ties it to the VTA's "super-admin" rule.
- `vtaDevices.ts:181`: `limitedAccess: entry.role !== 'admin'` - the wallet infers "can manage the agent" from the string `admin`.
- Senders pin ACL versions in `approvalRules.ts` (grant 0.1/0.2, revoke 0.1/0.2, update 0.1/0.2, swap-key 0.1) - not 0.3 for grant/revoke/update (V); relevant if the profile targets 0.3.
Neither implementation reads a governance document to learn roles (V for grep results; the wallet side only the cited lines, so other call sites are unchecked, I).

Implication (I): a deployment can only truthfully declare `governance.roles` equal to the five VTI names for a VTA today. That is fine for the principle (the deployer chose them), but the adapter must read the declaration from configuration rather than from a constant, and the wallet should treat "admin" as a declared-role lookup.

## 6. What #904 still lacks for this use, and open questions for the TF

State of #904 (V from PR body and comments): draft; body lists 4 open items: (1) no purpose description on `Agreement`; (2) 7012 clause 5.4.5 IP address vs DID-only parties; (3) `exchange` has no `outcomeEvidence`; (4) category `consent` is the nearest closed-enum value. Comments say item 3 was addressed (exchange response now carries `taskContext`, `taskDigestMultibase`, declares `outcomeEvidence`; 2026-11-05) and that seal decisions are now reported as data (`decision: accepted|countered|refused`), and that the seal now refuses a counter wider than the tested agreement (e4ad7b3). So the PR body's list of four is partly stale (I). The PR is behind main with CI checks failing (author comment 2026-11-13).

Lacking for ACL pairing:
1. **Agreement is shaped for privacy terms, not authority.** `Agreement` is `{name, rosterItems[], effectiveFrom, legalRef?, machineReadableRef?}` with items drawn from the roster the offer's `termsRef` names (V). Nothing says roles can be roster items. A governance document defining roles would need to be the roster for a "membership" purpose (I).
2. **Out-of-scope by design:** seal says access after a seal is conferred by a VAC citing it; offer says it adds "no ACL entry, no grant" (V). So there is no defined link from a seal to `acl/grant`.
3. **Two-party only** (joining party, host). An acl grant has three roles (granting authority, maintainer, subject); the seal binds subject and host, not the granter (V/I).
4. **No version-drift rule.** `termsRef` pins a version and digest at seal time; nothing says what happens to existing ACL entries when the governance document's version or digest changes (I).
5. **Possible family split/rename.** A commenter (2026-10-27) proposed a faithful `myterms/*` family (carried protocol) and the host-governed design "under its own name" (V). The `understanding/*` name may change; reference by `termsRef` shape, not family name, until settled.
6. **No machine-readable role section** in a governance document (section 2).
7. **Unmerged dependencies:** #904 and #78 both open drafts; VTI-KEY-052 does not exist in any merged spec.

Questions to take to the TF, with evidence:
1. Should an acl profile state a governance `termsRef` (reusing `RegisterRef`), or is a DID-service reference (#78) enough? Evidence: section 2.
2. May a deployment's governance document be the "roster" of a seal, with roles as roster items, or does the TF want a separate role-definition shape (cf. `vtc/roles/define`, merged draft, `builtInRole`)? Evidence: #904 `Agreement`; `vtc/roles`.
3. Should grant cite a seal (new member / new version) or follow the VAC route? Evidence: seal "Graduated access" paragraph; grant/0.3 `additionalProperties:false`.
4. Role ordering and "privileged role" are implicit in grant and revoke; should the TF state they are deployment-declared? Evidence: grant/0.3 item 4; revoke/0.3 item 4.
5. Is "undeclared governance reports `indeterminate`" the intended reading for a profile, and what SKIP/indeterminate wording does the conformance side use? Evidence: note 07 ruling 7.
6. Version drift of a pinned governance document (section 6 item 4).
7. Does `vtc/roles` "built-in roles" fit the "no built-in role set" principle, or is it an optional preset? Evidence: `define:builtInRole`.

## 7. Open choices summary

| Choice | Recommendation | Pros | Cons |
|---|---|---|---|
| Pointer location | DID service (#78), mirrored in adapter | designed, hash-pinned | unmerged, VTI does not publish it |
| Role list source | Document list plus `knownRoles` cross-check | explicit, checkable | two places to sync |
| Authority rules | none | - | no format for ordering exists |
| Seal before grant | optional, off by default | deployer's choice | needs a citation route (none recommended) |
| Citation route | VAC route and internal policy first; `ext` or new version to TF | no spec change now | grant not self-describing |

Back to [the docs index](../README.md).
