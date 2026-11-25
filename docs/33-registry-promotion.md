# Registry promotion: process, tools and review records

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This page is the working process for moving advisory vectors (channels `proposed`, `candidate`) into the `registry` channel, where they gate. The rules are [docs/04 section 18.6 and 18.9](04-suite-design.md#189-promotion-criteria-and-flaky-vectors-quarantine) and are not changed here, except for one **provisional** amendment (section 2). Each batch is its own commit, listed in [CHANGELOG.md](../CHANGELOG.md), and a change of the gating set is a **major** change (docs/04 section 20.2).

## 1. Process, and the tool for each step

| Step | What | Tool |
|---|---|---|
| 1. Pre-screen | The checks a machine can make: channel and `tfRef` status, no CLARIFY, not excluded, synthetic or retired, at least one mutant, a `spec` string that cites a line, no clock dependence, the oracle's verdict is PASS, every recorded VTI run of the vector has the same PASS verdict | `scripts/prescreen.ts` (`src/promotion/prescreen.ts`, `evidence.ts`; tests `test/prescreen.test.ts`). Writes `tt-conformance-prescreen/0.1` JSON: per vector the reason codes, the number of runs, whether clean and whether promotable |
| 2. Mechanical review | What a reviewer would check by opening the task-force text: the cited specification exists at the vector's `tfRef` commit with status draft; every `SPEC.md:<n>` cite is a line of SPEC.md at that commit, and "item k" names the numbered item on that line; "(recipient REQUIRED, proof REQUIRED)" and "isProofRequired=..." agree with the specification's front matter | `scripts/review-promotion.ts` (`src/promotion/review.ts`) |
| 3. Hand review | A template-plus-sample review (section 3): read each generator template against the text, then a sample of vectors; every vector whose quoted text is thin is read in full | by hand; the record is a section of this page |
| 4. Non-vacuity | Every mutant a promoted vector names makes it fail on the oracle | `test/promotion.test.ts` (runs `checkNonVacuity` over the promoted ids) |
| 5. Run evidence | Three consecutive recorded runs with `run.json` (the pre-screen reads them), then a gating run of the oracle and every surface after the promotion | `npm run suite`; row scripts are kept with the run records |
| 6. The edit | `vectors-src/promotions.json` lists the ids by batch and by the rule that let them gate. The generators (`generate-coverage.ts`, `generate-gap.ts`) call `applyPromotions` (`src/vectors/promotion.ts`) after the vectors are built: channel to `registry`, the suite-defined `profile` removed, `source.promotion` added (batch, rule, provisional, former channel and profile), `tfRef` kept. No id, step or expectation changes | the two generators, then `npm run pins` and `npm run regen` |
| 7. Record | CHANGELOG (major), [decisions](decisions/README.md); the generated pages (STATUS.md among them) are regenerated locally and are not published ([D959](decisions/06-runs-and-results.md#d959)) | `npm run regen` |

Demotion is the same edit the other way: delete the id from `vectors-src/promotions.json` and regenerate. A vector that is promoted and later fails on a surface is triaged like any other (class A to D, [results/vector-review.md](../results/vector-review.md#classes)); a class B fix changes the vector in the generator and is a major change.

## 2. The amended two-surface rule (PROVISIONAL, D353)

docs/04 18.9 item 3 asks for two surfaces: two implementations, or two carriers of one. For a task only one implementation serves, there is no second implementation. Decision D353, assumed by the project owner and **awaiting confirmation by the project owner**: for such a task the reference adapter (the oracle) and the VTI in-process host count as the two surfaces. A vector promoted on that basis

- carries `source.promotion.rule: "single-implementer"` and `provisional: true`, and the text "single implementer, provisional rule D353" in its `note`;
- is labelled **single implementer** wherever the suite says what gates it;
- is never a seeded-state probe (the probes rest on suite-local declarations, docs/04 18.6 (e)).

The amendment is one switch. `vectors-src/promotions.json` has `amendedRule.enabled`. Set it to `false` and regenerate: every vector promoted on this basis returns to its former channel and profile, with no other change. If the project owner confirms, set `amendedRule.status` to `confirmed` (the `provisional` flags then turn false on regeneration) and record the decision; if he declines, set `enabled` to false. Nothing else depends on it.

What this does not make independent: the oracle is built by the suite, so its agreement is not independent evidence; and the coverage vectors state that they are "built from the registry schema the platforms also build against". A promoted coverage vector measures structure (the payload schema and the declared policy), not behaviour, and the card says so (the roll-up design, [proposals/rollup-design.md](proposals/rollup-design.md)).

## 3. B1 review record {#b1-review}

Batch B1 is the 472 pre-screened vectors that belong to tasks the ceremonies of the VTI and keyring-wallet pair use, from the analysis of 2026-11-20. Ten of them are seeded-state probes (`CP-RM-*`), excluded by D353. The other **462** were reviewed.

**Method: template plus sample.** The coverage and gap generators write every vector of a kind from one template and one task, so the reviewer reads the template against the text once, checks the whole batch mechanically (step 2), and reads a sample of vectors by hand.

*Templates.* Four, found by grouping the `spec` strings and the steps:

| Template | Vectors in B1 | Rests on | Read as |
|---|---|---|---|
| payload validated against the task's schema (CV, GP) | 157 | SPEC.md 7.2 item 2 (line 1012, MUST validate the payload against the schema of the type); the task's `payload.schema.json` | a schema-invalid payload is answered `malformedRequest` or `permissionDenied`; 7.2 does not order validation against authorisation (items 2 and 10), so both are accepted; a lookup answer (`taskFailed`, not-found) is not, because it is what a consumer that never validated gives |
| policy enforced (CV, GP) | 141 | 7.2 item 5 (line 1015: recipient REQUIRED, absent, `malformedRequest`; the audience-binding item 8 gives the same code for a proof with no recipient) and item 7 (line 1017: proof REQUIRED, absent, `proofRequired`); the task front matter (`parties`, `proofRequirement`) | the step with no recipient is signed, so items 5 and 8 agree; the step with a recipient and `sign: null` expects `proofRequired`; the check that the title's policy is the front matter's is mechanical |
| valid request not refused for an envelope reason (CV, GP) | 69 | the framework's error codes (8.3): each envelope code names a defect the document does not have (`wrongRecipient`, `proofInvalid`, `expired`, `idConflict` and so on); the same pattern as the gating plain family (docs/04 11.7) | `answered`: no envelope code, and any response conforms to the response schema |
| task-force invalid examples (CX 88), and the GP-CRX vectors on missing members, schema constraints and the listed examples (7) | 95 | the task's own `payload.invalid-examples.json`; 7.2 item 2 | each listed payload is refused as in the first template |

*Mechanical check, all 462.* `scripts/review-promotion.ts` against the task-force clone: every cited specification exists at the vector's `tfRef` commit with status draft (446 at `0dbc98f1c`, 16 at `bd0c05013`, both on main); every `SPEC.md:` cite is a line there, and every "7.2 item k" sits on the line numbered k; the policy of every title and `isProofRequired` string agrees with the front matter. First pass: 27 problems, all in the reader (it did not read quoted values, indented lists, or the `proofRequirement: {request, response}` form); after fixing the reader, **0 problems**. The checks have unit tests with the negative cases (`test/promotion.test.ts`).

*Sample.* 41 vectors, drawn with a fixed seed (20261120) from the 14 non-GP groups: at least 2 per group, more from the four large ones (CV-MB 6, CV-AA 5, CV-RM 5, CV-VP 5). Each read against its template: the steps, the expected codes, the mutants, the quoted text. The ids: CV-AA-245, 266, 257, 236, 059; CV-CA-245, 259; CV-CS-005, 016; CV-MB-017, 076, 023, 161, 021, 056; CV-RM-061, 200, 111, 089, 045; CV-SD-064, 061; CV-VP-030, 113, 008, 034, 121; CX-AA-019, 018; CX-CA-036, 016; CX-CS-007, 003; CX-MB-027, 001; CX-RM-027, 028; CX-SD-001, 010; CX-VP-005, 012. **Findings: none that changes a vector.** Observations kept: the policy step with no recipient depends on the harness signing the document (so items 5 and 8 agree, as the first template says); two vectors (CV-VP-034, CV-MB-076) name a single mutant because only one applies to the task (no proof requirement, closed payload); the tolerance of `permissionDenied` is deliberate (docs/22) and means a PASS can be an authorisation gate answering first, which the run records show per surface (`acceptedOnlyGate`, section 3.1).

*Thin vectors, reviewed in full.* A vector is thin when it has fewer than four `spec` strings or none that names a numbered item or section 8.x. 82 are thin: 66 of the third template (the cite is the range 1011 to 1023 with no rule quoted), and 16 `GP-CRX` vectors (two or three strings; 3 of them are also of the third template). Each was read: the 16 `GP-CRX` against the payload schema and `payload.invalid-examples.json` of `credential-exchange/pending/{approve,deny,list}` 0.1 (the examples match the quoted ones, the steps are the examples, the item-2 line is cited); the 66 against the third template (with the 3 `GP-CRX` ones, 69 vectors). The defence of the third template is that the plain family, already gating, is the same pattern with the same checker (`answeredErrors`), and that each envelope code is defined by 8.3 as the consequence of a defect these documents lack. **Limits recorded, none a reason to hold a vector back:** the range citation is a paraphrase, not a quotation (the rule is in 8.3, and the vectors could cite it); and `answered` treats no reply to a task that declares a response as a failure, which rests on the task's response declaration and not on a 7.2 MUST (a deferred or asynchronous consumer would need `silence`).

*Defended and kept advisory.* 10 probes (D353), none else.

### 3.1 What the promoted vectors measure

Every B1 vector is a single-implementer vector: the keyring-wallet and the truststackers rows skip all 462 (receive-role vectors for tasks the wallet only sends), so no second implementation exists. None cites an open pull request or a branch: all `tfRef` statuses are `draft` on main, so no provisional mark for PR or branch text is needed (the existing marks on pull-request-tied vectors are untouched). The gating run of the promoted vectors is in section 5.

## 3a. B2 review record {#b2-review}

Batch B2 (2026-11-20, continuation of B1; decisions D450 to D455) takes the pre-screened vectors of the latest-version scope that B1 left: the analysis' B2 (the larger families: `vtc`, `vta`, `git-ns`, `keys`, `external`, `backup`, `config`, `governance`; 705 vectors) and B3 (6), plus the 75 `TL-*` second-layer vectors whose oracle PASS had sat in older folders. The single-implementer amendment (D353) was confirmed by the project owner; it stays labelled and reversible (`amendedRule.enabled`) and its `status` is `confirmed` (D457).

**Population and pre-screen.** `scripts/prescreen.ts` over the five run roots of the analysis: 6,893 non-registry vectors, 967 clean, 954 promotable (13 clean probes excluded). Of the 954, 785 name only latest non-retired versions (matrix `focus: focus`) and are the B2 candidates (710 of the analysis plus the 75 `TL-*`); 167 name an older version and 2 a retired one: they stay advisory (D245, latest versions are the focus) and are listed as not promoted.

**The 75 `TL-*` vectors.** Their oracle PASS sat in older run folders. All 785 candidates were re-run fresh on the oracle in the current tree (channels `proposed` and `candidate`, both tiers, attested and not): 785 PASS, 0 FAIL, 0 CLARIFY. Decision: promotable on the same evidence as the rest, subject to the review below; 51 of the 75 are promoted and 24 are held (class B finding below).

**Method: template plus sample, as B1.** Templates (same four as B1 plus two small variants): payload validated against the schema (244 CV), task-force invalid examples (195 CX), policy enforced (recipient REQUIRED, proof REQUIRED: 147 CV; recipient only: 72 CV), valid request not refused for an envelope reason (29 CV), and the `TL-*` and `GP-VTA` vectors of the same shapes (75 and 23). Mechanical check of all 785 against the task-force text at each `tfRef` commit (`scripts/review-promotion.ts`, kit `dtgwg-trust-tasks-tf`): **0 problems**. **Sample of 68** (seed 20261121, at least 2 per group and about 7% of each group, 20 groups; ids in `b2-sample.json` of the run records): every one read against its template (steps, expected codes, mutants, quoted text), no finding changes a vector; the policy variant with only a recipient rule has a single step, and the lists that name the clamped `limit` (git-ns `right/list`) already accept the clamped response. **Thin vectors**: 98 (fewer than four `spec` strings or none naming an item); all 98 read in full, 59 kept (the envelope template of B1 for 29 CV, 22 TL, 4 GP, plus 4 GP policy vectors) and 39 held.

**Finding, class B (the vector reads more than the text): 39 vectors held.** 24 `TL-*` and 15 `GP-VTA` payload-validation vectors expect `malformedRequest` and nothing else for a schema-invalid request addressed to the implementation. 7.2 item 2 (validate the payload) and item 10 (authorise) are not ordered, and 8.3 gives `permissionDenied` for a requester who is not authorised, so an implementation that authorises first follows the text; the B1 and CV and CX and `GP-CRX` templates accept both codes for that reason, and the header of `generate-2l.ts` says the same. They pass on the oracle and on both VTI surfaces (the harness actors are administrators) but a promotion would make the stricter reading gating. They stay advisory. Fixed after the B2 commit (D456, a vector change and a major one): those steps now accept `["malformedRequest", "permissionDenied"]` in the generators, and the 39 were promoted as B2b (section 3b).

**Held, not promoted.** 8 class A vectors (TL-JRQ-001, 005, 009, 017, TL-MBR-001, TL-AUD-005, CP-CA-002, CP-CA-003) while the recorded platform differences stand (section 6; none passes the pre-screen anyway); 13 clean seeded-state probes (`CP-*`, includes the 10 `CP-RM-*`; D353); the 39 above; the 169 older or retired versions. **Promoted: 746** (687 CV/CX, 8 `GP-VTA`, 51 `TL-*`), cumulative 1,208 with B1.

## 3b. B2b review record {#b2b-review}

Batch B2b (2026-11-20, third continuation of B2; decisions D456 and D490) promotes the 39 class B vectors held in B2: 24 `TL-*` and 15 `GP-VTA` payload-validation vectors. The class B fix was made first (commit "Payload-validation vectors accept malformedRequest or permissionDenied"): steps p1 to p3 of both generators now accept `malformedRequest` or `permissionDenied`, the same pair as the B1 `CV`/`CX`/`GP-CRX` templates, so a platform that authorises before it validates follows the text and the stricter reading is no longer gating. Ids and steps are unchanged; only `expect.code` and `spec` changed (729 vectors of `gap` and `2l`). Re-run on the oracle (all channels): 0 FAIL. Run on the two VTI rows (agent and community; channels `proposed` and `candidate`): all 39 PASS where the role applies (23 on the agent hosts, 20 on the community hosts, the rest SKIP by role), 0 FAIL. Rule: single implementer (D353, confirmed). **Promoted: 39**, cumulative 1,247 with B1 and B2.

## 4. Classes for new differences

A promotion can turn an advisory difference into a gating one. Each new FAIL is classed A to D against the specification text before anything is changed (authority: specification, then VTI, then keyring-wallet, then truststackers): A, the platform differs (the vector stays as written); B, the vector reads more than the text (fix the vector, a major change); C, the text is open (a note, not filed); D, the adapter or stand-in (fix the adapter). Class C notes are kept in [results/findings.json](../results/findings.json).

## 5. Gating run of batch B1 (2026-11-20)

After the promotion the 462 vectors were run as gating (default channel `registry`, so only promoted vectors run in the coverage and gap directories), Tier 1, on the oracle, the VTI in-process hosts and the keyring-wallet shim. Records are kept with the run records, outside the repository.

| Surface | PASS | SKIP | FAIL, KNOWN-FAIL, CLARIFY |
|---|---|---|---|
| Reference (oracle) | 462 | 0 | 0 |
| VTI agent | 250 | 212 (community-role tasks) | 0 |
| VTI community | 214 | 248 (agent-role tasks) | 0 |
| keyring-wallet shim | 0 | 462 | 0 |

Two vectors run on both VTI roles (250 + 214 = 464). **No new FAIL**, so nothing was classed, no platform and no vector was changed. The VTI verdicts are the same as in the pre-promotion runs of the same day and of 2026-11-18 and 11-19 (at least three recorded runs for every vector: 444 vectors in five recorded run roots, 2 in ten, the 16 `GP-CRX` in three; the re-published matrix set of 2026-11-20 is not independent, so the independent dates are 2026-11-18, 11-19 and 11-20). Not recorded: how many of these PASS answers are `permissionDenied` only. The runner records that split (`observedCodes`, `acceptedOnlyGate`, docs/22) for behavioural vectors, not for these mechanics vectors, so the share of PASS answers that show only an authorisation gate answering first is unknown, and the card's wording (structure, not behaviour) stands.

## 5a. Gating run of batches B2 and B2b (2026-11-20)

The 1,247 promoted vectors were run as gating (channel `registry`, Tier 1 and 2) on the oracle, the VTI in-process hosts and the keyring-wallet shim. The community coverage rows run sharded by vector (eight shards, D490), because the VTC rate-limits per source and per signer (D480 to D482). Records are kept with the run records, outside the repository.

| Surface | Coverage (B1 and B2) | Gap | 2L |
|---|---|---|---|
| Reference (oracle) | 1,133 PASS | 39 PASS | 75 PASS |
| VTI agent | 462 PASS, 671 SKIP | 39 PASS | 23 PASS, 52 SKIP |
| VTI community | 679 PASS, 454 SKIP | 39 SKIP | 64 PASS, 11 SKIP |
| keyring-wallet shim | all SKIP | all SKIP | all SKIP |

**0 FAIL, KNOWN-FAIL or CLARIFY on any surface**, so nothing was classed and no platform and no vector was changed after the promotion. The rooms vectors that fail on VTI (CX-RM-004, 005, 009, 010, 034 to 036, 038, 039; CV-RM-110, 113; CB-RM-034; class A, VTC `rooms/*`, 7.2 item 2) are all channel `proposed` and not promoted. Regenerating after the class B fix also widened 151 `PP-*` plain vectors (D491); the oracle and the VTI agent host give the same results as before.

**Measured share.** With the recorded runs read as gating, the measurement equals the projection: VTI agent service 242 of 273 declared items measured (89%), 237 of 242 agree (98%); VTI community service 298 of 319 (93%), 294 of 298 (99%), above the 50% threshold for a conformance-implied figure. The ceremony evidence is separate and unchanged.

## 6. Triage of the eight community FAILs without a finding

Before this batch, eight vectors on the community surface were FAIL with no recorded finding. Re-run on 2026-11-20 on the VTC host; read against the specification text:

| Vector | VTC answers | The text | Class |
|---|---|---|---|
| TL-JRQ-001 (`submit` 0.3, closed payload, `vp` typed) | `alreadyMember` for an unknown member and for `vp` of the wrong type | 7.2 item 2: validate the payload against the schema | A |
| TL-JRQ-005 (`status` 0.1, unknown member) | `status:notFound` | same | A |
| TL-MBR-001 (`members/vmc` 0.1) | `invalidCredential` | same | A |
| TL-JRQ-009, TL-JRQ-017 (`status`, `withdraw`, unknown id) | `malformedRequest` | the task declares `notFound`; `requestId` is a string of one or more characters | A |
| TL-AUD-005 (`audit/list` 0.2, forged cursor) | `malformedRequest` | `audit/list:invalidCursor` ("failed to verify, malformed or minted before a key rotation") | A |
| CP-CA-002, CP-CA-003 (seeded probes of CX-CA-031, CX-CA-033) | `membersOnly`; for `owners: []` a success response | `owners`: `minItems` 1, `uniqueItems` true | A |

The lookup-first pattern already recorded as class C (an answer from an object lookup before validation, the text unordered) was considered for the first five rows: the answers here are not lookups of an absent object but the answers to an accepted payload, so they are A. None is class B or D, so no vector and no adapter changed. The six 2L vectors are recorded as class A differences in [exceptions/exceptions.json](../exceptions/exceptions.json) (they are KNOWN-FAIL on the host); the two probes are findings in [results/findings.json](../results/findings.json) and rows of the community table in [docs/22](22-coverage-families.md#advisory-fails-of-the-community-service). Nothing is filed. The two probes are never promoted (D353).
