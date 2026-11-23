# Vector review: the known differences, re-examined

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. Nothing here has been filed with or sent to any project.

This page records a second look at every vector on which VTI (at its pinned reference) or keyring-wallet (over its stand-in carrier) differs from the suite's expectation: 9 VTI entries and 77 keyring-wallet entries. The order of authority is the specifications first, then VTI where the specifications are silent, then keyring-wallet. For each difference the question was: is the vector right, or is the implementation (or the specification text) the thing to reconsider? A vector is never changed to make an implementation look better; every classification below rests on quoted specification text.

## Result in one paragraph

54 of the 86 differences are plain differences between an implementation and the specification text (class A) and stay as they are. 4 vectors asked for more than the cited text says and are now reported as CLARIFY instead of gating. The remaining 28 are left unchanged: 20 depend on a decision for the task force or for the suite's maintainers, and 8 are limits of the stand-in carrier, not of the wallet.

## Classes

- **A** the implementation differs from the specification text; the vector is right.
- **B** the vector reads more than the text says (the text is silent, says SHOULD or MAY, or an implementation's reading is defensible).
- **C** the specification text is itself open or inconsistent between documents; this is a question for the task force.
- **D** an artefact of the adapter or the stand-in carrier.

| Class | VTI | keyring-wallet | Total |
|---|---|---|---|
| A | 7 | 47 | 54 |
| B | 1 | 20 | 21 |
| C | 1 | 2 | 3 |
| D | 0 | 8 | 8 |
| Total | 9 | 77 | 86 |

## What changed in the suite

Four vectors are now CLARIFY (reported, never gating). The vector, the fixture and the mutants are unchanged.

- **PRF-021 and PRF-027** (hour 24 in a proof's `expires` or `created`). A Data Integrity proof's timestamps "MUST be an [XMLSCHEMA11-2] dateTimeStamp string". The XML Schema 1.1 lexical form allows `24:00:00` (`endOfDayFrag`), so the fixtures' "hours run 00-23" is the RFC 3339 range, which the framework applies to `issuedAt` and `expiresAt` only. The other calendar-invalid rows stay gating.
- **PRF-031 and PRF-033** (a small-order key; a signature valid only under the cofactored equation). RFC 8032 section 5.1.7 says to check "[8][S]B = [8]R + [8][k]A'" and that "It's sufficient, but not required, to instead check [S]B = R + [k]A'". Nothing in RFC 8032 or in the framework requires rejecting a small-order key. Refusing both is the stricter verify_strict practice.

The reasons of the known-fail entries were rewritten to quote the specification text, name what the implementation does, and state the class.

## What the vector review moved

A later pass re-read the vectors themselves against the specification text (the order of authority is unchanged, and no vector was changed because a platform fails or passes it). Every change applies to every platform. Reasons are in [docs/21](../docs/21-vector-group-rationale.md) and [decisions.md](../docs/decisions/02-specs-tiers-and-channels.md#error-reply-should).

| Verdict | Vectors | What changed |
|---|---|---|
| Narrowed (the error reply is a SHOULD) | ENV-006 to 009, ENV-011, ID-001, ID-002, LIF-002, LIF-003, CTRL-001 to 003, ERR-004, PRF-101, 102, 104 to 106, the TIME rejection rows, DUP-002, 003, 005, 009, 010 and the item 11 rows, DIS-010, 011, 017, VRC-PRO-004 to 006, 014, 015, CEX-019, 020, 031, 036 | `errorReply: "should"`: no reply is an advisory, a wrong code in a sent reply still fails. The keyring-wallet rows of these ids, which excused "no error reply" as class B, are now the framework's own SHOULD and no longer differences. ENV-010 stays as it was (SPEC.md:756) |
| Gated on a declared window | DUP-005, TIME-101, TIME-105 | `window:declared`; SKIP where neither the implementation nor the runner states a window (the profile pin is never used) |
| Input changed | BND-004, BND-007, VRC-PRO-007, TD-001 to 006, WSH-007, WSH-012, WSH-024, PP-ACL-020, PP-AUT and TL-INV DID inputs | The BND tamper step changes /threadId; the TD vectors assert acceptance without the profile receipt digest; no base16 share; nested proof and altered initiating document under `payload.ext`; WSH-012 is also altered; a member described as a DID gets a DID |
| Gated | BND-002, DIS-013 | BND-002 needs `optional:transportIdentity` (the mapping is deployment-defined, binding 0.3 spec.md:129) and its statuses are advisory; DIS-013 runs against discovery 0.4 only |
| Allowed | CEX-001 | The empty courtesy acknowledgement (SPEC.md:217-223) |
| Now CLARIFY | CEX-023 (spec-inconsistent), TC-012, WSH-017 (vector-overreads), WSB-004 (spec-silent) | Reported, never gating |
| Cited only | WSS-010, discovery DIS-001 to 017 (0.3 text), the plain-task note | No expectation change, except that a `malformedRequest` for a schema-valid payload that admits `ext` is a note (SPEC.md:246, :1069, :388) |

### What the re-measure moved

Each surface was re-run with the reviewed vectors and compared, vector by vector, with the previous run on the same surface (core, plus plain, non-attested and AP parts where they apply; the live VTI service was not re-run). Only these results move; every other vector keeps its status.

- **keyring-wallet (all three surfaces).** Now PASS, and their KNOWN-FAIL entries now report as stale: CTRL-001 to 003, ENV-006 to 009, ERR-004, LIF-003, VRC-PRO-004 to 006, 014, 015 (the missing error reply is the framework's SHOULD) and CEX-019, 020. CEX-023 and WSH-017 become CLARIFY. The entries of DUP-103, 104, 105, 106, 109 (shim and DIDComm v1) and TD-001 to 005 (all three surfaces) excuse a failure line that no longer occurs (a missing error reply is now an advisory; the TD vectors no longer assert the receipt digest), so they report FAIL until the entries are edited; the wallet's behaviour there is unchanged.
- **VTI agent service in process.** BND-004, BND-007 and CEX-001 now pass and PP-AUT-015 (Tier 2) passes with a DID input: their entries report as stale. CEX-023 becomes CLARIFY (it was KNOWN-FAIL).
- **VTI community service in process.** PP-ACL-020, PP-POL-004, 026 and 047 pass on the attested profile (their entries report as stale) and TL-INV-004 passes. BND-002 is SKIP, not offered (the door reads no bearer, so it declares no transport identity): its entry has nothing left to excuse.
- **The reference adapter** is unchanged on every tier (Tier 1: 234 PASS, 62 CLARIFY, 3 SKIP); WSH-017 is the one vector that moved, to CLARIFY on the candidate channel.

The class of the keyring-wallet ENV-010 entry (B: no reply to an unrecognised type) is a decision for the project owner: SPEC.md:756 puts the error reply inside the MUST for a known slug at another MAJOR version, so class A or D may fit better than B; the entry is not edited here.

## VTI

| Vectors | What they test | Basis | VTI | Class |
|---|---|---|---|---|
| PRF-101, PRF-102, PRF-104, ERR-006, ERR-007, BND-004, BND-007 | A proof that is present and fails verification is refused `proofInvalid` | Framework 7.2 item 7: "verify it ... and reject the document with `proofInvalid` on verification failure"; the code table: "A proof was present but failed verification" | Answers `permissionDenied` (HTTP 403), so an anonymous caller cannot tell whether a DID resolves | A |
| PRF-103 (Tier 2) | The proposed attested profile pins `proofPurpose` to `authentication` | The framework says a producer SHOULD use `authentication` and a consumer MAY require a purpose as local policy | Accepts any purpose the signer lists the key under | B |
| BND-002 | A bearer token maps to the transport sender; a different in-band issuer is `identityMismatch` | HTTPS binding: a server MUST "read `Authorization` (if present) and map the bearer token ... via a deployment-defined mechanism" | Reads no `Authorization` header; the signed document carries the authentication | C |

For the first row, VTI's choice is deliberate and VTI is the working reference, so the question goes to the task force (may a failed DID resolution be answered `permissionDenied`?), and the vectors do not change. The framework already handles the enumeration risk in the error message ("the reason a signature failed beyond the fact that it did" may not be said), not in the code.

## keyring-wallet (over a stand-in carrier, not the real wire)

| Group | Vectors | What they test | Basis | What the wallet does | Class |
|---|---|---|---|---|---|
| Issue proof under the wrong identifier | AUTHZ-001, VRC-ISS-001, 002, 007, 008, 009, 010, 012, 014, 015, 016 | A signed issue delivery is processed | Framework 4.7: the proof's verification method "MUST resolve to verification material controlled by the party identified by the document's `issuer`" | Sets the envelope issuer to the connection DID but signs and verifies under the relationship DID; the later checks are never reached | A |
| No error reply to an unrecognised type | CTRL-001, 002, 003, ENV-006, 007, 008, 009, 010, ERR-004, LIF-003 | `unsupportedType` / `unsupportedVersion` is returned | Framework 7.2 item 3 (reject) and "the consumer SHOULD return an error response" | Rejects (executes nothing) but sends no reply | B |
| No error reply to a bad proposal | VRC-PRO-004, 005, 006, 014, 015 | A malformed or misaddressed proposal is refused with an error | Same | Logs, sends no reply | B |
| No duplicate record | DUP-001, 002, 003, 004, 005 | Resends are absorbed; changed resends are `idConflict` | Framework 7.2 item 11: a consumer "MUST NOT execute a consequential Trust Task twice" | Keeps no record, by design | A |
| Stand-in carrier sends no sender | DUP-101, 102, 104, 105, 106, 107, 108, 109 | The task force's digest fixture rows | Item 11 | The wallet does not process a document with no authenticated connection | D |
| Older runtime | ENV-003, TIME-023, TIME-024 | Missing `id`; calendar-invalid timestamps | Items 1, 4, 13 | Pins runtime 0.28.1, which lacks these checks | A |
| Proof not verified by default | PRF-101, 102, 104, 105, ERR-006, ERR-007 | Failing proofs are refused | Item 7; 4.7.1 | Default policy accepts unverified documents outside the issue and witness-share paths | A |
| Silent hold | NS-001, 002, 003, 004, 005, VRC-ISS-005, VRC-PRO-008, 020, 021 | A held proposal is answered with a next step | 8.6: "A consumer holding a task MUST answer with a next step" | Holds silently until the person answers; five of these vectors are therefore not measured at all | A |
| Proof fixtures accepted | PRF-010, 011, 018, 020, 022, 023, 024, 025, 026, 028, 029, 030, 032 | The task force's proof fixtures marked invalid | The fixture verdicts; Data Integrity datatypes; vc-di-eddsa 3.3.2; RFC 8032 5.1.3 | The verifier checks the signature only | A |
| Proof fixtures, now CLARIFY | PRF-021, 027, 031, 033 | see above | see above | accepts | B |
| No acceptance window | TIME-101, 105 | A document past the maximum age is `expired` | "The framework names no default maximum age"; a consumer must not accept a document older than the window over which it retains records | Declares only a 5 minute skew | C |
| Acceptance claims witnessing | VRC-PRO-007 | An acceptance does not claim `witnessed` unless it agrees | Propose 0.1: set `witnessed: true` "where it agrees"; silence means unwitnessed | Echoes the proposal's value; it cannot accept without agreeing | B |

## Questions for the task force

1. Is an error reply required when a consumer rejects a document and the transport can carry a reply? The text says "reject ... with `<code>`" in 7.2, "MAY return an error response" in section 8, and "SHOULD return an error response" under 7.2.
2. May a failed DID resolution while verifying a proof be answered `permissionDenied`?
3. Which timestamp range governs a proof's `created` and `expires`: XML Schema `dateTimeStamp` or the RFC 3339 range used for `issuedAt`?
4. Does the baseline signature suite require strict Ed25519 verification beyond RFC 8032?
5. Must a server on the HTTPS binding offer a bearer mapping, given that the mapping is deployment-defined?
6. May a consumer with no acceptance window at all conform for a consequential task that carries no `expiresAt`?

## Differences recorded after the review (same classes)

Later runs recorded further differences. They were not part of the 86 above; they are classed here with the same words so that every number on the results pages reads the same way.

| Run | Differences | Class A (differs from the spec text) | Class B (vector reads more than the text says) | Class C (spec open) | Class D (stand-in artefact) |
|---|---|---|---|---|---|
| keyring-wallet, wider run: 23 new | 23 | 22 (21 witness-share and related vectors that fail on the same proof-identifier rule as the issue rows; DUP-006, a resend after a restart is executed again) | 0 | 0 | 1 (DUP-103, the stand-in carrier sends no sender) |
| VTI, agent handlers in process: 17 | 17 | 9 (ID-002, ID-004, BND-002 refusal addressed to the in-band issuer; PRF-010, 011, 029 proof path; CEX-004 sealed bundle; PRF-008, 019 known gap of the shared proof library) | 8 (PRF-103, CEX-010, DUP-001, DUP-004, BND-005 profile differences; CEX-001, BND-004 step 5, BND-007 step 5 are suite over-assertions) | 0 | 0 |
| keyring-wallet, credential-exchange query run: 4 new | 4 | 1 (CEX-022, a deferred query is not answered `consentRequired`) | 3 (CEX-019, CEX-020 silent rejection of a malformed query, the cause of CTRL-001; CEX-023 no `noMatch` reply, which the text expects but does not require) | 0 | 0 |
| VTI, agent handlers in process, credential-exchange query run: 3 new | 3 | 3 (CEX-022, CEX-027: the DCQL form of a type query gathers nothing, so nothing is deferred; CEX-023: no match is answered `taskFailed`, not `noMatch`) | 0 | 0 | 0 |
| VTI, agent handlers in process (9) and community service in process (1), coverage vectors, proposed channel, advisory: 10 new | 10 | 10 (CB-AA-028, 029, 035, 036, 037, 038, 040, CB-SD-017, CB-RM-009 on the agent surface; CB-RM-006 on the community surface: the task lists its own `notFound` or `notAMember` code for a missing object, and VTI answers `taskFailed` with `details.reason` `not_found`. Each vector accepts the task's code or `permissionDenied` and VTI answered neither.) | 0 | 0 | 0 |
| VTI, agent handlers in process (CB-CS-004, CB-CS-010) and community service in process (CX-MB-040), coverage vectors, proposed channel, advisory: 3 new | 3 | 3 (CB-CS-004: an unknown step-up challenge is answered `taskFailed`, where the task lists `auth/step-up/approve-response:challengeUnknown`; CB-CS-010: an unknown consent challenge is answered `malformedRequest`, where the task lists `consent/decision:challengeMismatch`; CX-MB-040: a payload with an unknown top-level member is answered `internalError`, where the task's closed payload schema and SPEC.md 7.2 item 2 call for `malformedRequest`. Each vector accepts the task's code or `permissionDenied` (CX-MB-040: `malformedRequest` or `permissionDenied`) and VTI answered neither. For CX-MB-040 the recorded result holds the code only, and the cause of the `internalError` after the accepted payload is not claimed.) | 0 | 0 | 0 |
| VTI, community service in process (CX-CA-031, CX-CA-033), coverage vectors, proposed channel, advisory: 2 new | 2 | 2 (CX-CA-031: owners holding the same DID twice is not refused by `git-ns/repo/adopt`; CX-CA-033: an empty owners list and a duplicated one are not refused by `git-ns/repo/create`, although the task's payload schema has `uniqueItems` (and `minItems` 1) on `owners` and SPEC.md 7.2 item 2 is a MUST. The seeded probe (CP-CA-002, CP-CA-003) answers the duplicate `git-ns:membersOnly` and the empty list with a success, so one probe step created a repository, a side effect on the in-process host only. The other payloads of each vector, and the empty-owners step of CX-CA-031, are refused or fail only through a namespace lookup before validation, which is a suite note, not an entry.) | 0 | 0 | 0 |

## Totals in the exceptions file today

<!-- generated:exception-classes -->
Entries in [exceptions/exceptions.json](../exceptions/exceptions.json) by implementation key and class. The class is the entry's `class` field (or, for an entry without one, the "class X" in its reason); "Not classed" entries state no class yet and are not guessed here. Different keys are different measured surfaces (the two VTI keys are two surfaces of one VTI) and are never added together as one platform's figure; the "All entries" row counts lines in the file. "Unacknowledged" counts entries whose `acknowledged` field is null: the implementer has not yet agreed that the entry describes their platform ([docs/challenges.md section 7](../docs/challenges.md#7-owner-acknowledgement-of-an-exception)).

15 of them are for advisory (proposed-channel coverage) vectors; the headline count of recorded differences on the status pages leaves them out.

| Implementation key | Entries | A | B | C | D | Not classed | Unacknowledged |
|---|---|---|---|---|---|---|---|
| `keyring-wallet` | 82 | 49 | 1 | 2 | 9 | 21 | 82 |
| `keyring-wallet-witness-server` | 9 | 9 | 0 | 0 | 0 | 0 | 9 |
| `verifiable-trust-infrastructure` | 10 | 7 | 1 | 2 | 0 | 0 | 10 |
| `verifiable-trust-infrastructure-inprocess` | 29 | 21 | 6 | 0 | 0 | 2 | 29 |
| `verifiable-trust-infrastructure-vtc-inprocess` | 25 | 20 | 1 | 0 | 0 | 4 | 25 |
| `witness-server` | 4 | 3 | 0 | 0 | 0 | 1 | 4 |
| All entries | 159 | 109 | 9 | 4 | 9 | 28 | 159 |
<!-- /generated:exception-classes -->

The earlier hand-typed totals here (129 entries, A 89, B 28, C 3, D 9) were stale; the table above is generated (`npm run regen`). Where the earlier totals counted class D (stand-in carrier artefacts) and the entry's reason does not say "class D", the entry is shown as not classed until its reason or `class` field is updated.

## Where two readings differ

- **BND-004 and BND-007.** For the live VTI service the review treats these as class A: VTI answers `permissionDenied` where the text asks for `proofInvalid`. For VTI run in process the run notes call the same two vectors, at step 5, suite over-assertions (class B): the tamper step adds a member to a closed payload, so the schema check fails before the proof check, and tampering with an existing member is refused `proofInvalid`. Both can be true, because the surfaces differ, but the step-5 defect is in the vector and would also affect the live row. Not resolved here: it needs the project owner to decide whether to fix the vector (mutate an existing member) and re-run both surfaces. Nothing was edited.
- **CEX-001.** The vector expects silence; the specification lets a consumer send an empty acknowledgement. Class B on the in-process row; the live service does not serve this task type, so there is no second reading.
- **BND-002.** The live row is class C (the bearer-to-sender mapping is deployment-defined and the service reads no `Authorization` header). The in-process row is class A for a different behaviour (the refusal is addressed to the in-band issuer). Same vector, two different causes.

## What this does and does not show

This is a reading of specification text against two implementations. It does not judge either implementation as a whole. The four vectors that became CLARIFY (PRF-021, 027, 031, 033) were re-run afterwards on every surface that reaches them: keyring-wallet moved four vectors from KNOWN-FAIL to CLARIFY; VTI in process moved the same four from PASS to CLARIFY (CLARIFY is reported whatever the observation, and never gates); the live VTI service does not reach them and is unchanged. The raw per-run records are in `<results dir>/runs/`.
