# Questions and evidence for the Trust Tasks Task Force (2L profiles)

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. Not filed, not sent. Nothing here has been posted to, filed with, or sent to any project.

Date 2026-11-15. DRAFT, NOT FILED. Companion to [2l-profiles-draft.md](2l-profiles-draft.md) (profile text, evidence, inferences). Back to [the docs index](../README.md).

Status tags used inside the list: draft (registry `status: draft` at kit origin/main 0dbc98f1c, 2026-11-14, last locally cached state, not fetched), merged, open PR (number, commit), retired. Every spec in the registry is draft or retired; there is no `published` status.

Paste-ready text (in a code fence, ordered by priority):

```
TASK FORCE QUESTIONS: a proposed "second layer" (2L) of common profiles above the core

Context. We are drafting capability-gated profiles 2L-1..2L-5 (access and approval; holder, device and push; notification and delivery; assurance; community lifecycle), each a list of slug@version, advertised through trust-task-discovery. task-consent stays the core approval primitive. A standing principle: governance (role names, who may grant what, admission, retention) is the deployer's or community's choice; profiles define mechanics and declaration points only, and conformance never asserts a governance value. Evidence below is from the VTI reference implementation, the keyring-wallet (KW) holder app and Truststackers (TS), read at kit origin/main 0dbc98f1c. Statements marked "(our inference)" are ours, not the specs'.

PRIORITY 1. Credential status and revocation (a gap, no generic task)

Q1. Does the TF want a generic task for revoking a credential and for checking its status? We found none, and we are not proposing semantics; we would like to know whether this is wanted and who should shape it.
Evidence:
- vta/credentials/revoke@0.1 (draft): a context authority revokes a credential it issued; MUST report alreadyRevoked; for profiles with credentialStatus "the consumer MUST also flip the credential's published status-list bit" and return statusListIndex.
- vtc/endorsements/revoke@0.1 (draft): revokes a community-issued statement or vetter role credential by flipping its bit on the community Revocation status list; alreadyRevoked.
- Other per-domain revokes, each domain-specific: vtc/vetting/revoke-statement, vtc/vetting/revocations/list, vtc/badges/awards/revoke, vtc/invitations/revoke, git-trust/revoke, rooms/revocations/{get,put}.
- credential-exchange has no revoke or status verb (offer, request, issue, present, query, pending/*). The DTG credential specification lists a revoke verb that no registry slug provides.
- No spec defines the status list itself, how a verifier fetches it, or a status query. SPEC.md mentions "the status list it consulted" only as something an error must not leak (line 1278).
- A search of TF issues and PRs for "status list", "revocation status", "credential status", "revoke credential" found nothing relevant (only closed #337, about listing issued credentials). Not checked: GitHub Discussions, meetings.
- The VTI reference implementation serves a status list over plain HTTP in its community service (not a trust task) and uses the two revoke tasks above.
Ask: is a revocation/status task in scope for the TF, and if so should it sit with credential-exchange or stand alone?

PRIORITY 2. How a profile claim is advertised

Q2. trust-task-discovery 0.4 lists supportedTypes as bare Type URIs or expanded entries with acceptanceWindow and requiredExt only; there is no profile-claim member. Should a responder be read as claiming a profile when it lists all required members (implicit claim), or should there be an explicit claim (a new optional member or an ext namespace)? (Our preference: implicit first, no spec change; explicit only if the TF wants an unambiguous claim.)
Q3. Is profile claim granularity per profile, or per member group (for example session, acl, approval inside 2L-1)? We have no evidence either way.

PRIORITY 3. ACL: implicit role assumptions

Q4. acl/grant 0.3 says "a role above the granter's is permissionDenied", which presumes an ordering of roles. No acl spec defines the ordering. Is it intended to be deployment-declared (we think so, our inference), and may a profile say so?
Evidence: acl/grant/0.3 consumer item 4 and Authorization; role is an opaque string, a ceiling and never a grant, interpreted by the ACL maintainer (acl/_shared/0.3, AclEntry.role); an unrecognised role MUST NOT fall back to a default role.
Q5. acl/revoke 0.3 refuses removing the last holder of "a privileged role the maintainer's policy protects" (lastAuthorityProtected), which presumes a privileged subset that nothing declares. Same question: deployment-declared?
Evidence: acl/revoke/0.3 consumer item 4.
Q6. vtc/roles/define 0.1 (draft) has "built-in roles" that "cannot be created, changed or replaced" (error builtInRole). Is that an optional preset, or does the TF intend a built-in role set? This matters because our principle is that a profile fixes no role set. The framework evaluation also left authorization unspecified (framework consumer item 10).
Q7. Do you agree that the role vocabulary, ordering, privileged subset and who-may-grant-what are outside the acl specs and belong to a deployment-declared governance document, with the profile defining only mechanics? Evidence of why it matters: the reference implementations hard-code role sets (VTI: Admin, Initiator, Application, Reader, Monitor, with Monitor as the default for an unspecified entry; KW sends role "admin" literally), because no spec says where roles are declared.
Q8. Version spread: the registry has acl 0.1 to 0.3 for grant/revoke/change-role/update/show (list 0.4, swap-key 0.1); KW sends 0.1/0.2 and VTI serves 0.2/0.3. Should a profile pin one version per slug and treat older senders as out of profile?

PRIORITY 4. Governance reference for an ACL profile (understanding family, open PR #904)

Context: PR #904 (open draft, branch understanding-rebased, head 96b1d70, last updated 2026-11-13, behind main, CI failing per the author) proposes understanding/{offer,exchange,seal}. We cite it as an unmerged draft. The related vti-spec PR #78 (open draft) defines a GovernanceFramework DID-document service with the same {uri, version, digestMultibase} shape; the offer text says its termsRef must match a published service.
Q9. May an access-control profile declare one optional pointer, termsRef {uri, version, digestMultibase}, reusing #904's RegisterRef, to the deployment's governance document? Or is a DID-document service reference (#78) enough? Or neither, with the pointer left to adapters?
Q10. #904 gaps relevant to this use (our reading of the PR files and its 9 comments):
 a) Agreement is {name, rosterItems[], effectiveFrom, legalRef?, machineReadableRef?} shaped for privacy terms. Can a governance document's roles be roster items, or does the TF want a separate role-definition shape?
 b) The seal confers no access (a Verifiable Authority Credential does), and the offer adds "no ACL entry, no grant". There is no defined link from a seal to acl/grant. acl/grant 0.3's payload is closed (entry, reason, ext). Should a grant cite a seal (via ext, or a new grant version), or follow the VAC route?
 c) Two parties only (host and joining party); an acl grant has three (granting authority, maintainer, subject).
 d) No version-drift rule: termsRef pins a version and digest at seal time; nothing says what happens to existing entries when the pinned document changes.
 e) The PR body's open-items list (four items) looks partly stale against the comments (outcomeEvidence, seal decisions as data); could the body be refreshed?
 f) A possible family split or rename (a myterms/* family floated in the PR thread on 2026-10-27, the host-governed design under its own name): until settled we refer to the termsRef shape, not the family name.
 g) A governance document has no machine-readable role section; RegisterRef points at an opaque document.
Q11. When a declared value is absent or a governance document cannot be fetched or its digest mismatches, we propose the profile reports indeterminate (the existing "not stated is not absent" rule), and conformance SKIPs vectors that need the value. Is that the intended reading of indeterminate for a profile?

PRIORITY 5. consent/* placement and the approval family

Q12. Where should consent/* sit? Facts: confirm/* is retired in favour of task-consent (PR #156, commit 3f1ceec37). consent/* (1.0, list 1.1, approve-request 0.1) is draft and not proposed for retirement anywhere; the delegated-trust-task-execution design note says generalising it was wrong and left it untouched; it is messaging-conversation consent for an AI agent. The TF overlap survey (docs/alignment/2026-10-20-trust-task-overlap-survey.md:337) names three meanings: consent/* messaging-conversation, task-consent/* privileged-task approval, auth/step-up/* session elevation. In practice VTI serves consent/* and KW does not appear to (our inference). Is it a candidate for a profile, or a standalone family until a second implementation exists? We are not proposing to retire it.
Q13. Should consent/approve-request reuse task-consent/request's challenge and evidence rules? It looks parallel (our inference, not verified in depth).
Q14. auth/step-up/approve-response has seven versions (0.1 to 0.7), approve-request five. For a profile we would pin approve-response 0.7 and approve-request 0.5 (what VTI serves and sends). Is a consolidation planned? Both it and task-consent/decision 0.2 use the approver's-own-DID proof rule ("a delegated key's proof never counts as the approver's"); may a profile state that step-up is a session-elevation layer over task-consent?
Q15. task-consent/request: an open issue (#1219) reports that minApprovals above the eligible approvers is accepted and can never run. Is that being resolved before the profile pins it?

PRIORITY 6. Other members, evidence and placement

Q16. Notifications: notifications/notify and relay 0.1 (draft) are served by VTI only (VTA and VTC); we found no KW or TS use. Inbox list and dismiss exist only as VTI-named slugs (vta/notifications/*, vtc/notifications/*). Is a generic inbox slug wanted, and is there a second implementation planned?
Q17. Audit: audit/list 0.2 and audit/verify 0.1 (draft) have VTI evidence only. Same question: second implementation?
Q18. Push: who serves push/register 0.2 (0.1 retired)? VTI does not (its mobile core is a client). Which role does a push gateway have in the specs, and is bindings/push the intended carriage for push/wake and provision?
Q19. Vetting: vetting/request, session, attestation, decline 0.1 (draft) are produced and consumed by KW as applicant and vetter; VTI defines types but has no handler. Is there a second implementation, or should these stay family-level?
Q20. Policy: policy/evaluate has versions 0.1 to 0.4 (TS maps to 0.3). Should a profile include policy/evaluate only, leaving upsert, list, get and delete out because policy content is governance?
Q21. Directory: vtc/directory/query 0.1 and entries/list 0.2 are community-shaped. Is a generic card query wanted? (A generic form is our inference.)

PRIORITY 7. Core boundary

Q22. docs/02 of the conformance suite proposes a 3b-DTG list (credential-exchange offer, request, issue, present; task-consent request, decision) as slug@version, pending the DTG Core Trust Task Protocols specification that does not yet exist. Does the TF want 2L profiles to reference the same slug@version mechanism and to live beside that list, or in the DTG specification itself?
Q23. trust-ceremony-receipt 0.1 is framework-reserved with an optional verifier capability. Should a 2L assurance profile list it by reference, or should it stay only in core?

PRIORITY 8. Proof baseline reach

Q24. Cryptosuite baseline and a credential carried in a payload: SPEC.md 4.7.1 (line 313) says a conforming consumer MUST be able to verify a `proof` whose `cryptosuite` is `eddsa-jcs-2022`, and the paragraph speaks of the document's proof. specs/vrc/relationships/issue/0.1/spec.md line 101 requires `vrc` to carry "a signed credential" and line 108 has the receiving party verify "the credential's own proof"; neither names a suite. Does the 4.7.1 baseline reach the credential inside the payload, so that a receiving party MUST be able to verify an `eddsa-jcs-2022` credential proof? Or may it accept only some credential suites (for example a JSON-LD profile) and refuse the rest? Evidence: keyring-wallet can verify a JCS-proofed credential but refuses one while its developer switch for shared connect is off (the default); vectors VRC-ISS-001, 002, 014, 015 and 016 send such a credential and, once the document's own proof is accepted, end at that refusal. Under the narrower reading those vectors over-read the text. The vectors stay as written; the wallet's gate is unchanged.

What we are NOT asking: to retire consent/*, to fix any role set, or to adopt any default for a governance value.
```

Notes before any use (not part of the paste-ready text):
- Order reflects the priorities: revocation gap, ACL implicit assumptions, #904 gaps, consent/* placement, then other members.
- Items that depend on an open PR cite its number and commit; #904 and vti-spec #78 may change before posting. Re-read both first.
- Q15 cites issue #1219 from the approval-spec review, not re-verified; drop it to keep the list to directly verified evidence.
- The kit cache (0dbc98f1c) was not fetched: refresh it and re-check statuses (especially acl versions, discovery, PR #156) before any use.
