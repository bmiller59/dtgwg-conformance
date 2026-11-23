# Constraints, governance and process

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

Standing constraints, project governance, scope, suite mechanics and the authority order. Part of the [design rationale register](README.md).

## Standing constraints

Every page must respect these:

- **Governance is never determined by conformance tests.** It is always the choice of the end user, meaning the deployer or community. The suite checks only mechanics, and whether a platform lets the end user declare governance ([decisions 75 and 77](04-ceremonies-governance-and-exceptions.md#governance-in-vectors)). The only governance that gates is the essential governance E an adapter declares for its platform (who may decide a held task, and how many approvals it needs): the suite never asserts what it should be, runs the ceremony vectors relative to it and checks that the platform behaves as declared ([decision 39](04-ceremonies-governance-and-exceptions.md#d39)).
- **Only vectors that cite a Trust Tasks (TF) repository artifact gate.** That artifact can be on main, a draft or an open pull request. `candidate` and `proposed` vectors are advisory: they never count towards a gate or a headline total, and they are not an endorsement ([decisions 76 and 79](02-specs-tiers-and-channels.md#specification-sources-and-channels)).
- **The suite does not change the platforms it measures.** The specifications are the most authoritative source, then VTI's behaviour. Any proposed change to VTI or keyring-wallet goes to the project owner first ([decisions 43, 45 and 46](#authority-order)).
- **No outward contact** (issue, pull request, comment or message) until the project owner says so ([decision 53](#d53)).
- **Each platform is reported separately, on its own results** ([Platforms reported separately](05-application-profiles-roadmap.md#platforms-reported-separately)).

## Project governance and process

| Rule | Why | Where |
|---|---|---|
| Decisions are recorded in the design document they affect, in the present tense, with the reason. The git log is the change history. | One place to read the current design; history is not mixed into it. | This page; [CONTRIBUTING.md](../../CONTRIBUTING.md) |
| Work happens on a feature branch per piece of work, with local signed, signed-off commits. Nothing is pushed and no pull request is opened without a further yes from the project owner. | The project owner reviews every change before it leaves the machine. | Process rule |
| After an implementation step, an architecture review and a documentation review are written separately; the recommendations are implemented as separate commits for the project owner to review. | Reviewable, revertible steps. | Review reports are kept outside the repository |
| Licence Apache-2.0. Copyright "Copyright the Contributors to the Trust Tasks Conformance Suite project", with DCO sign-off and no personal or employer name. | A neutral, contributable home. | `LICENSE`, `NOTICE`, `package.json` |
| The suite lives in its own repository beside the other DTGWG repositories and stands on its own. It names implementations as failing where the evidence shows it: factually, dated and with evidence. | A neutral place that a newcomer can read without other sources. | This repository; docs/05, docs/06 |
| No release without a suite adapter and a recorded run for each measured platform. | A result is a measurement, not a reading of code. | `<results dir>/runs/` |

<a id="neutrality"></a>**Neutrality and conflict of interest.** The suite has a single maintainer, the project owner. That concentration of control is handled as follows and stated here so a reader can weigh it:

- Vectors cite specification text, not any platform's behaviour, and are never weakened to fit an implementation; every negative vector is checked against mutants of the reference adapter, not against any platform.
- Independent maintainers are wanted, including at least one implementer other than the project owner, before the suite's results are offered as more than a draft. Where the suite is hosted and who maintains it there is not decided ([decision 53](#d53)).

<a id="d53"></a>**Decision 53 (open): what is not settled.**

- Who contacts the task force. There is no outward contact until a person is named.
- Legal confirmation of ownership, the hosting project, and any licence arrangement, before any contribution.
- Whether discovery 0.4 intends unsigned queries to be answered (DIS-015 stays CLARIFY; PRF-108 and VRC-PRO-011 follow it).
- Whether a relayed `task-consent` decision passes the framework identity check.
- The `continuation` value when a status task exists (not asserted).
- keyring-wallet's `Ed25519Signature2018` presentation proofs, and the fidelity of the keyring-wallet shim.
- The Tier 2 vectors, and citations into the credential and VTI specifications, have not been audited the way Tier 1 was.

<a id="d65"></a>**Decision 65 (open): licensing of imported material.** The licence of the imported TF fixtures is assumed to follow the code licence and is not confirmed; a licence check is the project owner's call. The source commit of the first fixture import is not recorded (the snapshot had no version-control metadata); re-importing at a pinned TF commit fixes that.

## Scope and shape of the suite

| Rule | Why | Rejected | Where |
|---|---|---|---|
| Black-box wire vectors (language-neutral JSON) plus thin per-implementation adapters, aimed at contribution to the Trust Tasks task force and building on its `fixtures/consume` and `fixtures/proof`. | Neutral across languages and implementations. | A TypeScript-only library; per-repository tests. | Whole suite; docs/04 sections 1 to 4 |
| Ceremonies first: relationship-credential (VRC) issue and witness-share; a roadmap for vetting, membership, data rooms and approver attestations. | They are the ceremonies the measured platforms share. | none recorded | `vectors/ceremony-vrc/`, `vectors/ceremony-doc/`; docs/16 |
| A layer framework mapped to the ToIP stack. The scope is layers 2 and 3 (3a to 3d); layer 4 is deferred. Layer 3b holds only framework-reserved slugs; a separate tier 3b-DTG holds the DTG core protocols (credential-exchange offer/request/issue/present, task-consent request/decision). VTI "Core" is a conformance profile, not a layer. | Separates what the framework defines from what a community protocol defines. | none recorded | docs/01, docs/02; `vectors/dtg/` |
| Governance and messaging have no core tasks. The core holds rules and components; carriage, acknowledgement and delivery evidence belong to bindings. The two-gate core-decision rule is a working rule. | No such task has two independent implementations and a TF home. | none recorded | docs/02 |
| An interop milestone and a per-family capability matrix (by implementation and tier). | Conformance per platform first, then pairs. | none recorded | `src/runner/matrix.ts`; docs/04 section 15; docs/14 |

## Suite mechanics

| Rule | Why | Rejected | Where |
|---|---|---|---|
| The harness never looks inside an implementation: it sends exact bytes, receives bytes, and asks an adapter for observable state. Adapters are thin and out of process (JSON-RPC over stdio or HTTP); harness keys are deterministic Ed25519 seeds and an implementation's keys are discovered, never imported. | A Rust wallet, a TypeScript agent and a Rust node are tested by the same files, and no implementation imports foreign key material. | A test library per language. | `src/adapter/contract.ts`; docs/04 sections 4 and 5 |
| Vectors are generated from authored scripts, one JSON file per group, ids `<GROUP>-<NNN>`; every vector cites its specification basis with file and line, enforced by a test. Documents are held as text where bytes matter; timestamps are offsets from a start time, signed at run time. | Reviewable source, traceability and reproducible runs; edges straddled by one millisecond. | Hand-edited vector JSON. | `scripts/generate-*.ts`; `test/vectors.test.ts`; docs/04 sections 3 and 7 |
| The oracle is the specification text, shown satisfiable by the reference adapter on the published runtime (`did:key` Ed25519, `eddsa-jcs-2022`). Every negative vector names mutants of the reference and a test proves each is caught (non-vacuity). | A wrong vector cannot hide behind a failing implementation. | Agreement between implementations as the oracle: it can freeze a shared bug. | `src/adapters/reference/`; docs/04 section 9 |
| <a id="run-provenance"></a>Every run folder keeps the `run.json` its tool wrote, citing the suite commit id (never a branch name), whether the tree was dirty, and the suite version. Folders recorded before that are listed in `runs-before-run-json.json` in the results directory and not edited. | A result an outside reader cannot tie to the exact suite tree cannot be reproduced or cited. | Backfilling old folders from prose (not exact); recording only a branch name. | `src/runner/provenance.ts`; `test/run-records.test.ts`; docs/04 section 20.1 |
| <a id="run-records-outside"></a>Run records (run folders, the run index, the before-run.json list, the baseline file, the pair matrix data) are kept outside this repository, in a results directory named by `SUITE_RESULTS_DIR` or `--results-dir` (default `results-local/`, git-ignored). Generated pages stay committed as snapshots stamped with the run set they came from; `check:docs` verifies them when run folders are present and skips with a message when they are not, and tests that need run folders skip the same way. The decision holds for now and is reversible. | The project owner's decision: run data does not belong in the suite's repository for now. Snapshots keep the pages readable without the runs and stay checkable against them. | Regenerating the pages on demand only (the repository would carry no figures); failing `check:docs` without run folders | `src/results-dir.ts`; `.gitignore`; `test/helpers.ts` (`NEEDS_RUNS`); docs/04 section 21 |
| <a id="semver"></a>The suite is versioned with semver read for a conformance suite: major when an expectation or the gating set changes, minor for added non-gating vectors or additive tooling, patch for documentation; `0.y.z-draft` while a draft. Changes are listed in `CHANGELOG.md`; tagging a release is the project owner's step. | Readers and implementers need to know when a verdict can change under them. | Date-based versions (say nothing about compatibility); no versions (results not citable). | `package.json`; `CHANGELOG.md`; docs/04 section 20.2 |
| <a id="test-ids"></a>Vector ids are never reused or deleted: a vector is retired (`retired: {reason, since, replacedBy?}`), kept as a tombstone, never run or counted; an append-only ledger of every issued id is checked. Results and claims cite ids as `<suite version>/<id>`. Retirement is not exclusion from a run. | A cited id must keep meaning the same rule; a deleted or reused id silently changes what an old result says. | Deleting vectors; reusing free numbers; treating `excludedFromRun` as retirement. | `src/vectors/ledger.ts`; `vectors-src/id-ledger.json`; `test/vector-ids.test.ts`; docs/04 section 20.3 |
| Vectors are never weakened to fit an implementation; a gap is a KNOWN-FAIL in a separate file with an owner and an expiry. | Keeps vectors specification-driven; exceptions cannot rot. | Loosening a vector; an `exceptions` object inside each vector (harder to audit and expire). | `exceptions/exceptions.json`; docs/04 section 8 |
| A vector that rests on an unsettled specification point is CLARIFY: reported, never gating, a candidate task-force question. | Avoids freezing ambiguous behaviour. | none recorded | `CLARIFY_OF` in `scripts/generate-vectors.ts`; docs/04 section 8 |
| `trust-task-control` is an optional capability and `unsupportedType` the refusal the framework states; there is no generic status task. VRC issue evidence is the receipt plus observable state. | Framework section 11.8; the issue specification declares no outcome evidence. | none recorded | LIF-003; VRC-ISS vectors |
| Runtime: TypeScript on Node 22.16 or later with native type stripping, `node:test`, `tsc --noEmit` for type checking only, never compiled; one runtime dependency, `@openvtc/trust-tasks` 0.29.0 exact. The suite has its own `did:key` Ed25519 `eddsa-jcs-2022` sign and verify on `node:crypto`, validated against the task-force proof fixtures, because the published proof package does not install beside 0.29.0. | The same language as the registry runtime and fixtures; no build step or extra runtime; a small dependency surface. | Bun; a compiled build. | `package.json`; `src/crypto/` |

## Authority order

<a id="d43"></a><a id="d45"></a><a id="d46"></a>**Decisions 43, 45 and 46 (in force).**

- The specifications are the most authoritative source. Where a specification states a requirement, a vector asserts it, and a platform that deviates has a measured finding.
- Where the specifications are silent or ambiguous, VTI's behaviour is the precedent. No different behaviour is asserted as a Tier 1 requirement.
- After VTI come keyring-wallet, then truststackers. VTI's and keyring-wallet's SKIPs are limits of the adapters' reach, not of the platforms. At the final measurement on the integrated suite, Tier 1 core passes (a vector that passes under a recorded exception counts) are: VTI 85 on the agent service and 73 on the community service; keyring-wallet 55 (shim), 54 (DIDComm v1) and 55 (v2). Nothing of the truststackers original could be run, so no figure for it exists.
- Profile pins beyond the specifications (5 min maximum age, 60 s skew, 30 d horizon) are Tier 2 `attested` profile choices, declared per implementation and measured, never Tier 1.
- The suite does not change or extend VTI or keyring-wallet. A difference is recorded as a measured difference: a suite-side parameter, SKIP, or KNOWN-FAIL with owner `unassigned`. Proposed changes are drafted and wait for the project owner's review before they are raised with anyone (`docs/proposals/upstream-harness-asks.md`).

Why: a suite that asserts more than the specifications say turns an implementation choice into a conformance failure, and the existing implementation is the only deployed reference. Rejected: pinning the windows and making VTI "the side that moves".

Where: docs/04 section 10; `SUBGROUP_OF` and `CLARIFY_OF` in `scripts/generate-vectors.ts`; the exceptions mechanism; window parameterisation; rebase mode.
