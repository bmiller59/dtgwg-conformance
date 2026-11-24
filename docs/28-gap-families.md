# Gap families (vectors/gap)

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This page describes the vectors that cover task versions that no other vector set referenced: first the families `vta`, `vtc`, `rooms`, `did-management`, `git-ns` and `messaging`, then, in the "uncovered families" step (2026-11-20), every remaining version of the task-force repository that still had none (21 more families, see "The uncovered families" below). Together the generator now leaves no task version of the repository without a vector. They are layer 3a (plain tasks), not core: channel `proposed` (profile `gap-families`), non-gating and outside every headline count. The coverage matrix (`results/coverage/`) is where the gap was measured and where it is re-measured.

## What a gap task is

A task version is a gap task when no vector under `vectors/`, other than `vectors/gap` itself, names its Type URI or its specification path. This is the rule the coverage matrix uses, so the generator and the matrix agree. When another set later gains a vector for a version, the next regeneration drops that version from `vectors/gap` and its ids stay in the id ledger as retired.

## Where the text comes from

- The specifications are read from the task-force repository at one commit, recorded in `vectors-src/gap/tf-snapshot.json` (refresh with `scripts/gap-snapshot.ts`; it only reads git objects of a clone). The snapshot holds, per version: the spec's status, the request and response policy, the declared error codes, the spec's own invalid payload examples and its request examples.
- The payload schemas come from the pinned `@openvtc/trust-tasks` package where it ships the version. The package is older than the repository, so for the versions it lacks (24 across these families at the recorded commit) the snapshot also stores the bundled schemas, and `loadTask` falls back to them.
- Every vector says which it used (`source.note` and the citations). Every current specification is `draft` or `retired`; none is `candidate` or `standard`. A retired specification gets vectors that are excluded from every run (`excludedFromRun`), as elsewhere in the suite.
- Where a copy of a version on an unmerged branch of the task-force repository differs from main, the vector follows main and its `source.note` starts the sentence `PROVISIONAL AGAINST BRANCHES`, naming the branch. The branch text itself is not vectored. No version of these families exists only on a pull request or branch.

## What is generated for each version

| Group | Vector |
|---|---|
| `GP-<fam>` mechanics | The shared plain-task mechanics (`src/plain/build.ts`): payload checked against the schema (first required member missing, unknown member in a closed payload, wrong type), the declared policy enforced (recipient, proof), `issuedAt` required (CLARIFY: the text names no error code), and a valid signed request answered without an envelope refusal. |
| `GP-<fam>` required members | A request missing any one required member is refused (one step per member). |
| `GP-<fam>` constraints | One step per constraint the top-level members state: enum, const, minLength, maxLength, pattern, minimum, maximum, minItems, maxItems, wrong type. |
| `GP-<fam>` invalid examples | The specification's own `payload.invalid-examples.json` entries are refused. |
| `GP-<fam>` request examples | The request examples in the specification are not refused for an envelope reason. |
| `GE-<fam>` | The producer class: the implementation is asked to emit the document through its own builders and the harness checks it against the schema and policy. |

Every negative is checked against the task's own schema with the suite's validator before it is written; a candidate the schema accepts is dropped. A role-named member is a `$role(n)` token only where the schema accepts any string (a deployment-defined authority role); where the schema fixes the values (for example a key purpose) the literal stays, and no constraint on a governance role is tested (docs/02 section 5).

Mutants make the negatives non-vacuous: `noPayloadValidation`, `openPayload`, `recipientOptional`, `proofOptional`, `noFreshnessWindow`, `plainBadResponse` and the four emit mutants. `test/gap.test.ts` checks that every mutant a vector names makes it fail.

## What is not generated, and why

`vectors/gap/not-generated.json` lists each item the specification states that did not become a vector, with the reason. Each invalid example is classified by its own `variant` marker and checked against the schema of that variant, with and without `format` asserted (`src/plain/invalid-examples.ts`). Response entries (marked `"variant": "response"`; the specification lists them in the same file as the request entries) are invalid replies: they are never sent as requests (`response-example`). Request entries that are invalid only through `format` (the request schema accepts them when `format` is not asserted, refuses them when it is) are not sent either (`format-only`): JSON Schema 2020-12 treats `format` as an annotation unless a consumer asserts it, and the specification does not say whether a consumer must. That is a specification question, not an implementation result. A request entry the request schema accepts even with `format` asserted would be listed as `invalid-example`; at the recorded commit there is none.

## How it is run

`npm run suite -- --vectors vectors/gap --out <dir>`. The reference oracle serves every version in the snapshot, so it is the check that the vectors are self-consistent. A platform runs only the vectors for types it declares; the rest are SKIP, which is reach, not failure. The first recorded run is `2026-11-19-gap-vta-vtc` (records are kept outside the repository); it reached very little: the pinned VTI agent declares four of the 554 versions, and the VTI community host and keyring-wallet declare none. Every SKIP is reach, classified as platform (the platform does not serve or emit the type) or suite limit (the adapter cannot set the clock).

## Reach: which gap versions VTI serves

`npm run suite -- --vectors vectors/gap --channels registry,proposed,candidate` against the VTI hosts. Reach is read from two places that must agree: the types a host declares at start-up (discovery, the truth for a given build) and VTI's source (`scripts/gap-reach.ts`, `src/coverage/reach.ts`, the dispatcher scanner of the coverage matrix). Recorded runs: `vti-upstream-gap-*`.

State of the 702 gap versions of 2026-11-20 (554 of the first step and 148 of the uncovered families; a 703rd, trust-task-discovery 0.1, was added by integration 5, see below), read on 2026-11-20 from VTI upstream `origin/main` (`71d524572`) with the types the original VTI hosts declare at start-up. Reach is now split in two classes (decision D245, docs/decisions/README.md): `platform` (a version in the target, the latest non-retired one, that VTI does not serve or send) and `scope` (a version outside the target: older than the latest of its slug, or retired). A SKIP of an older version is class `scope`, never `platform`.

| State | Versions on main | What it means |
|---|---|---|
| declared by a host (vectors run) | 7 | `vta/witness/{accept,list,open,present}` 0.2 and `credential-exchange/pending/{approve,deny,list}/0.1`; reach class `reached` |
| routed behind a cargo feature the host is built without | 139 | `tee` (`vta/attestation/*`), `vetting-pcs` and `voting` (`vtc/vetting/hidden/*`, `vtc/elections/*`, event-mode, pcs-binding); a host built with the feature (`VTI_HOST_FEATURES`) declares them. 120 of the 139 are focus versions (`platform`), 19 older (`scope`) |
| named in VTI code, not served | 48 | outbound senders (the VTA sending `did-management/*` to a did-hosting server, in `webvh_host.rs`), parse tables; 26 focus (`platform`), 22 older (`scope`) |
| VTI names another version of the task | 124 | split by direction below |
| not named by VTI code at all | 384 | 158 focus (`platform`: no handler or builder), 181 older and 45 retired (`scope`) |

The 124 "another version" rows by direction: `superseded` 108 (VTI names only newer versions, so this one is older than what VTI speaks; `scope`), `behind` 10 (VTI names only older versions, so VTI is below this version: 5 focus versions, `platform`, and 5 older or retired, `scope`), `mixed` 6 (`scope`). Only the `behind` focus rows are the latest-version work for VTI. Class totals on main: `reached` 7, `platform` 309, `scope` 386.

Counts by family are in the run record (`scripts/gap-reach.ts` writes `reach.json` with the state, the direction and the class of every version; `--matrix` names the coverage matrix that carries the focus class). keyring-wallet names none of the 554 first-step versions (scan of the wallet source), so every wallet vector SKIPs; for the older versions that is class `scope`.

The dispatcher scanner behind the matrix's "Versions VTI serves" column now resolves a constant through the `use` items of its own file, because dispatchers name a task as `<alias::Payload as Payload>::TYPE_URI` with a file-local alias: unresolved dispatcher constants fell from 233 to 14 and served versions rose from 324 to 574. This did not add a gap version a default-featured host omits; it showed that the remaining served gap versions are feature-gated. On upstream main the community no longer has a `DISPATCHED_URIS` table (VTI #2579): routing is in `vtc-service/src/trust_tasks/routing.rs`, and each `*_tasks.rs` registers its tasks with `on!(routes, <payload path> => handler)`. The scanner reads those registrations (`onRegistrations` in `src/coverage/matrix/vti.ts`; the payload is a full spec-crate path or an alias the file's own `use` items bind), and also the witness service's `SERVED` table; the matrix command takes `--vti-pin` (and `--vti-rev` for a read-only archive without git history) to say which source it read. On main it finds 378 community URIs (the older scanner found 36).

Every SKIP of these rows is one of: platform (the states above for the focus versions), scope (a version outside the target: older than the latest, or retired; the retired-version vectors are also excluded from every run), or suite limit (the 19 sender-only versions need a did-hosting capture harness the suite does not have).

## The uncovered families (2026-11-20)

After the first gap step the coverage matrix still listed 147 versions with no vector. This step wrote vectors for all of them with the same generator (`scripts/generate-gap.ts`, the same shared mechanics and the same spec-derived negatives), plus `voting/trustees/enrol/0.1`, which only a ceremony scenario names (the matrix counts a scenario as a reference, the generator's rule counts vectors; both are now satisfied). Result: 148 versions of 21 families (`vtn` 35, `voting` 23, `registry` 18, `persona` 17, `external` 15, `webvh` 10, `trust-task-error` 6, `credential-exchange` 3, `understanding` 3, `chat`, `confirm`, `consent`, `git-trust`, `provision`, `sync` 2 each, and `audit`, `peer-check`, `process-attestation`, `push`, `trust-task-discovery`, `trust-task-ok` 1 each), 1,078 vectors (930 `GP-*` mechanics and spec-derived vectors, 148 `GE-*` producer-class vectors), 89 of them CLARIFY on the shared `issuedAt` rule, and 1,524 mutant declarations. `vectors/gap` held 5,257 vectors for 702 task versions at the end of that step (5,263 for 703 since integration 5, below), which with the vectors of the other sets covers 1,420 of the 1,420 versions of the repository (main, open pull requests and branches).

Group ids: `GP-` and `GE-` followed by `VTN`, `VOT`, `REG`, `PER`, `EXT`, `WEB`, `TTE`, `CRX`, `UND`, `CHT`, `CNF`, `CNS`, `GTR`, `PRV`, `SYN`, `AUD`, `PCK`, `PAT`, `PSH`, `TTD`, `TTK` (`GP-TTE` and `GP-TTK` are empty and not written, see class C below). The vector ids of the first gap step are unchanged.

### Labels: maturity, channel, source

- **Maturity.** Every vector says `Spec maturity: draft` or `retired` in `source.note` (nothing in the repository is candidate or standard). 11 of the 148 versions are retired (`confirm/request` and `confirm/response` 0.1, `persona/correlation/analyze` 1.0, `persona/facet/{delete,list,put}` 1.0, `registry/record/{create,list,read,update}` 0.1, `trust-task-ok` 0.1): their 69 vectors are excluded from every run (`excludedFromRun`), as in the first step, and were run once on the reference with the exclusion removed (see "Verification").
- **Channel.** `proposed`, profile `gap-families`: advisory, never gating, outside every headline count, as before. The 16 `GP-CRX` vectors of batch B1 (credential-exchange pending approve, deny and list 0.1) are the exception: promoted to `registry` on 2026-11-20 ([docs/33](33-registry-promotion.md)). The three versions that exist only on open pull request #904 (`understanding/exchange`, `understanding/offer`, `understanding/seal`, all 0.1, a draft PR) are channel `pr` instead (24 vectors): the suite already defines that channel for an unmerged pull request, its `tfRef` is `{status: pr, pr: 904, head: <sha>}`, and `source.tfCommit` is the PR head (`96b1d70ea`, branch `origin/understanding-rebased`), not main. Their text is read from that revision by `scripts/gap-snapshot.ts --extra pr#904=origin/understanding-rebased`. A run must name the channel (`--channels registry,pr,proposed,candidate`) to include them. Spec-drift cannot check them against the main checkout (the run logs list them as `missing-source`, advisory), because the text is not on main.
- **Branches.** Six `voting` versions are on main and also on `feat/voting-trustees` (one also on `tmp/voting-hardening-032`) in a different form; their 64 vectors follow main and say `PROVISIONAL AGAINST BRANCHES` (the existing rule). No version exists only on a branch.
- **Platform claims.** A vector is never described as validated by a platform unless the platform ran it; the platform rows below say what ran.

### What the text could not support (class C)

`vectors/gap/not-generated.json` lists each item with `kind` and, where the text is the problem, `class: "C"` (D12 and D13: a gap in the specification, not an implementation result).

- **Reply types (`response-only-type`, 7 versions).** `trust-task-error` 0.1 to 0.6 and `trust-task-ok` 0.1 are the framework's reply types (SPEC.md section 4.4, section 8). The text says what a consumer returns with them and nothing about a consumer that receives one as a request, so no `send` vector is written (an earlier draft that did write them failed on the reference, because a received error document draws no reply). The producer-class vectors (`GE-TTE`, `GE-TTK`) are kept: the text does say what the document has to look like.
- **Thin text (`thin-text`).** Versions whose payload schema states no required member and no checkable constraint and whose specification carries no request or invalid example (3 of the new versions: `registry/record/list/0.1`, `webvh/witness/key/list/0.1`, `credential-exchange/pending/list/0.1`; 25 in all with the first step's families) get only the shared mechanics vectors.
- **Inconsistent examples** (`invalid-example`, `format-only`): as in the first step, a request entry the task's own schema accepts although the text lists it invalid, or one that is invalid only through `format`, is not sent; it is a specification question. Response entries (`response-example`) are never sent as requests.
- No state-dependent behaviour (a conflict, a missing record, a quota) is written: the text of these versions declares error codes but not the state that provokes them, and the suite does not invent it.

### Verification

- The reference oracle passes every vector at both tiers, attested and not (`test/gap.test.ts`), and every named mutant makes its vector fail (1,524 declarations among the new vectors; the same non-vacuity check as the first step).
- The 457 retired-version vectors are excluded from runs, so a separate run of the reference with the exclusion removed (`oracle-retired-included`, run records outside the repository): 439 PASS, 18 CLARIFY, 0 FAIL at each tier.
- `2l-catalog.ts` `versionsOf` now reads only versions the pinned package ships; before this step a version only the gap snapshot carried would have been picked up by the 2L generator (found when `push/register/0.3` made `generate-2l.ts` fail).

### Reach and outcomes against platforms (separate rows)

The reach figure is a count of vectors that executed (PASS or CLARIFY) among the new families' vectors that run (1,009 per tier; the other 69 are retired and excluded). Rows are never merged. Records: `2026-11-20-bam-uncovered-runs` (outside the repository).

| Row | PASS | CLARIFY | FAIL | SKIP |
|---|---|---|---|---|
| VTI agent (pinned build) | 16 | 3 | 0 | 990 |
| VTI community | 0 | 0 | 0 | 1,009 |
| VTI emit hosts | 0 | 0 | 0 | 1,009 |
| keyring-wallet shim | 0 | 0 | 0 | 1,009 |

(The table above counts the gap set alone. The coverage matrix reads every mapped run, see docs/22, decision D300.) Only three of the 148 versions are reached by any platform: `credential-exchange/pending/{approve,deny,list}/0.1`, which the VTI agent serves. All 16 PASS and 3 CLARIFY are on those versions (the CLARIFY is the shared `issuedAt` rule). No difference of class A to D was found, so no exception and no platform change were made. Every SKIP is reach: platform (of the 147 versions the matrix listed, VTI does not name 81 at all, pins 62 in its lock files without a handler, and serves 3; keyring-wallet names one, the response type `trust-task-error/0.5`, which it does not serve) or scope (retired, or an older version; class `scope` since D245). That the other versions are SKIP says nothing about whether a platform would conform to them.

## A version freed by the witness retarget (integration 5, 2026-11-21)

The witness 0.2 branch moved the witness discovery vectors (`WSD`) from `trust-task-discovery/0.1` to 0.4 (D290), which left 0.1 without any vector. The gap generator picks gap versions from the committed snapshot (`vectors-src/gap/tf-snapshot.json`), which had been taken while `WSD` still named 0.1, so it did not know the version and generated nothing. The snapshot was refreshed with `scripts/gap-snapshot.ts` (same task-force commit, `bd0c05013`) and `vectors/gap` regenerated: 5 `GP-TTD` and 1 `GE-TTD` vector for the version, 703 gap versions and 5,263 vectors in all, and the matrix reads no version without a vector again (decision D524). These six vectors have no run record yet. When a branch retargets vectors, refresh the snapshot and regenerate `vectors/gap`; the matrix line "Versions with no vector" is the check.
