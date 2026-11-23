# Contributing

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

New here? Start with [getting started](docs/getting-started.md) (install and a first run), the walk-throughs [add a platform](docs/add-a-platform.md) and [add or fix a test](docs/add-a-test.md), the shorter [contributor guide](docs/community/contributing.md) (what to add, how a review goes) and the [open gaps](docs/community/open-gaps.md). This page is the one place for the suite's process. Each recipe ends with the command that shows it worked. Terms are defined in the [glossary](docs/03-glossary.md); the design is in [docs/04](docs/04-suite-design.md).

Before you start:

- Use Node.js 22.16 or later, work from a git clone (the page checks read the list of tracked files from git) and run `npm ci`.
- Sign off every commit (`git commit -s`). The sign-off is your statement under the [Developer Certificate of Origin 1.1](https://developercertificate.org/). Inbound = outbound: your contribution is licensed to the project and its users under the same Apache-2.0 licence as the rest of the project.
- Run heavy commands (suite runs, `npm test`, builds) under `nice -n 10`.
- Keep the repository public-safe: no local paths, private addresses or credentials in any tracked file. `npm test` checks this.

Recipes:

1. [Run the suite against your platform](#1-run-the-suite-against-your-platform)
2. [Record a run](#2-record-a-run)
3. [Add a vector](#3-add-a-vector)
4. [Add or triage a difference (KNOWN-FAIL)](#4-add-or-triage-a-difference-known-fail)
5. [Classify a new SKIP reason](#5-classify-a-new-skip-reason)

To dispute a vector rather than change it yourself, see [challenging a vector](docs/challenges.md).

Then: [Style and wording](#style-and-wording).

## 1. Run the suite against your platform

1. Check out the suite and run `npm ci && nice -n 10 npm test && npm run typecheck`.
2. Check out the Trust Tasks task-force repository (the "TF checkout"). The runner uses it to detect spec-drift. Pass it as `--kit <TF checkout>` or set `TT_KIT`.
3. Check out your platform at the commit you want to measure. The suite reads that checkout and never writes to it.
4. Set the environment variables for your adapter (table below). Each adapter's header comment lists every option.
5. Pick the vector family with `--vectors` and the channels with `--channels` (tables below).
6. Pin the date that exception expiry is judged against with `--today YYYY-MM-DD`, so the run can be reproduced.
7. Run it:

   ```sh
   export TT_KIT=<TF checkout>
   nice -n 10 npm run suite -- --kit "$TT_KIT" --today <YYYY-MM-DD> \
     --adapter '<adapter spec>' --vectors vectors --channels registry,proposed,candidate --out <out>
   ```

8. Check the output. `<out>` holds `conformance-matrix.md`, `conformance-matrix.json`, `results.json` (one row per vector) and `run.json` (provenance: suite commit, vector and exception digests, adapter capabilities, the date used). Advisory channels go to the sibling folder `<out>-advisory`. The exit code is 0 when nothing gating failed.

   ```sh
   ls <out> && head -20 <out>/conformance-matrix.md
   ```

### Adapters and their environment

A `stdio:node --experimental-strip-types ...` adapter prints Node's "Type Stripping is an experimental feature" warning on stderr; it is harmless, and adding `--disable-warning=ExperimentalWarning` after `--experimental-strip-types` hides it. When the checkout or service an adapter needs is missing, the run stops at start-up with a short error such as `fetch failed` (nothing answers at the service address) or `spawn nice ENOENT` (the checkout directory does not exist): check the environment variables below first. Writing a new adapter: [add a platform](docs/add-a-platform.md).

| Platform and surface | `--adapter` | Environment |
|---|---|---|
| Reference adapter (the suite's self-check) | `reference` (default); `reference-witness` with `--vectors vectors/witness`; `mutant:<id>` | none |
| VTI agent service, in process | `stdio:node --experimental-strip-types src/adapters/vti-inprocess/launcher.ts` | `VTI_ROOT` (VTI checkout, required); `VTI_INPROCESS_TRANSPORTS=1` (push-capable host, `observe.pushed`); `VTI_INPROCESS_NO_ATTESTED=1` (the non-attested run); `VTI_INPROCESS_BIN` (prebuilt host, skips the build); `VTI_INPROCESS_BUILD`, `VTI_INPROCESS_JOBS`, `VTI_HOST_TIMEOUT_MS` |
| VTI community service, in process | `stdio:node --experimental-strip-types src/adapters/vti/launcher.ts` | `VTI_ROOT` (required unless `VTI_VTC_BIN`); `VTI_VTC_BIN`, `VTI_VTC_BUILD`, `VTI_INPROCESS_JOBS`, `VTI_HOST_TIMEOUT_MS`; `VTI_ACTOR_ROLE` (VTI's ACL role for the harness actors, default `member`; the recorded plain and 2L runs used `admin`) |
| VTI community service, live over HTTPS | `module:src/adapters/vti/index.ts` | `VTI_BASE_URL`, `VTI_API_PREFIX`, `VTI_SERVICE_DID`, `VTI_VERSION`, and optionally `VTI_COMPOSE_DIR`, `VTI_COMPOSE_SERVICE`, `VTI_COMPOSE_PROFILE` (see `src/adapters/vti/adapter.ts`) |
| VTI sending side (emit) | `stdio:node --experimental-strip-types src/adapters/vti-emit/launcher.ts` | `VTI_ROOT` (required); `VTI_EMIT_BIN`, `VTI_EMIT_BUILD`, `VTI_EMIT_JOBS`, `CARGO_TARGET_DIR`, `VTI_HOST_TIMEOUT_MS`; `VTI_EMIT_REPORT` (per-type builder report) |
| keyring-wallet behind a stand-in carrier | `stdio:node --experimental-strip-types src/adapters/keyring-wallet/launcher.ts` | `KW_ROOT` (keyring-wallet checkout, default `../keyring-wallet`); `KW_JEST_CACHE`, `KW_HOST_TIMEOUT_MS` |
| keyring-wallet over real DIDComm | `stdio:node --experimental-strip-types src/adapters/keyring-wallet-didcomm/launcher.ts` | `KW_ROOT`, `KW_JEST_CACHE`, `KW_HOST_TIMEOUT_MS`, `KW_HOST_MAX_MS`; `DIDCOMM_ROOT` (a directory whose `node_modules` holds Credo); `KW_DIDCOMM_VERSION` (`v1` default, or `v2`); `KW_DIDCOMM_PORT`, `CARRIER_PORT` |
| keyring-wallet witness server over DIDComm | `stdio:node --experimental-strip-types src/adapters/witness-server/index.ts` with `--vectors vectors/witness` | `WITNESS_INVITATION_FILE` or `WITNESS_INVITATION_URL`; `DIDCOMM_ROOT`; `DIDCOMM_VERSION` (`v1` default, or `v2`); `CARRIER_PORT`, `WITNESS_REPLY_WAIT_MS` |
| truststackers (original) | none: the original upstream has no trust-task boundary the suite can reach | none |
| Your own adapter | `stdio:<command>`, `http:<url>` or `module:<path>` | yours; start from `src/adapters/example-server/` and [docs/04 section 4](docs/04-suite-design.md#4-adapter-contract-built-typescript-types-client-and-example-server) |

### Wallet shared-connect developer switch (upstream issue 962)

keyring-wallet has a developer switch, "shared connect", that is off by default; while it is off the wallet refuses a credential proved with `eddsa-jcs-2022` that arrives in a payload ([decisions.md](docs/decisions/README.md), "The shared-connect gate is a spec question"). The suite's wallet shim leaves the switch off, so every published wallet result is measured with it off. A run made with it on is a different measurement: report it separately, label it in the run folder name and in `run.json`, and never merge it with the default rows or with the original-platform rows.

### Families and channels

| `--vectors` | Family |
|---|---|
| `vectors` (default) | Core: framework, 3b-DTG, ceremony documents, VRC, receipts, imported TF fixtures |
| `vectors/plain` | Plain-task probes (layer 3a) |
| `vectors/emit`, `vectors/emit-more` | Producer class: documents your platform builds and sends |
| `vectors/witness` | Witness share over DIDComm |
| `vectors/2l` | The suite's proposed 2L application profiles (all `proposed`, so advisory) |

`--channels` takes any of `registry` (default; gates), `pr`, `proposed`, `candidate` (advisory; written to `<out>-advisory`, never in a headline total). See [docs/04 section 18](docs/04-suite-design.md#18-spec-maturity-channels-and-spec-drift-built). Other options (`--tier`, `--timeout`, `--rebase`, `--window`, `--salt`, `--exceptions`, `--strict`: fail when an adapter declares an optional capability name outside `OPTIONAL_CAPABILITIES`) are documented at the top of `src/runner/cli.ts`.

The governance probes are a separate command, `npm run governance` ([docs/17](docs/17-governance-probes.md)). Governance is never determined by these tests.

## 2. Record a run

1. Run the suite (recipe 1) with `--run YYYY-MM-DD-<label>/<family>` (one subfolder per family), which writes to `runs/` of the results directory: `$SUITE_RESULTS_DIR`, or `--results-dir <dir>`, else `results-local/` (git-ignored). Run records are kept outside this repository ([Where run records live](#where-run-records-live)). Never edit `conformance-matrix.*`, `results.json` or `run.json`, and keep `run.json` with the rest: every run folder carries one ([docs/04 section 20.1](docs/04-suite-design.md#201-every-run-folder-carries-runjson); `npm test` checks it).
2. Copy `results/TEMPLATE-run/` into the run folder: `README.md`, `issues-<platform>.md`, `draft-issues/`.
3. Fill in the run README: the status line, the "Versions tested" table (implementation, commit or release, source, adapter revision, and the suite commit and version from `run.json`, never a branch name), what the adapter does and does not measure, and what changed since the previous run. Verify every count against `results.json`, never against a summary. Give a runnable "How to re-run" block with placeholders such as `<TF checkout>`.
4. Write `issues-<platform>.md` and one `draft-issues/NN-short-title.md` per issue (title, vector ids, expected vs observed, suggested fix, target repository, status `DRAFT, NOT FILED`). Spec questions go in `draft-issues/spec-questions/`. Nothing is filed without the project owner's approval.
5. Update `exceptions/exceptions.json` (reason, owner, expiry) and `results/vector-review.md` for every new or changed difference (recipe 4). Classify any new SKIP reason (recipe 5).
6. Point the surface at the new folder: in `results/at-a-glance.config.json`, set the surface's `runs` to the new folder (and add a `milestones` entry for a new label prefix). This file holds no numbers.
7. Regenerate every generated page and block (STATUS, README status block, results/README figures, platform pages, AT-A-GLANCE; in the results directory, the run index and Superseded banners), with `SUITE_RESULTS_DIR` naming the results directory:

   ```sh
   nice -n 10 npm run regen
   ```

8. Add a new platform's row to `platforms.md` by hand (links, adapter path; no figures). Do not type figures into any page: link to the generated block instead.
9. Prove it:

   ```sh
   nice -n 10 npm test && nice -n 10 npm run check:docs
   ```

### Where run records live

Run folders, the run index and the other run records are not committed: they live in a results directory outside this repository, named by `SUITE_RESULTS_DIR` (or `--results-dir <dir>` on any command; default `results-local/`, which is git-ignored). The layout and the reasons are in [docs/04 section 21](docs/04-suite-design.md#21-where-run-records-live-built).

- The generated pages (README and STATUS blocks, `platforms.md`, `results/README.md`, AT-A-GLANCE, the platform pages, the pair matrix page, the independent-implementations page) are committed snapshots. Each names the run set it was generated from. Commit them after `npm run regen` against the results directory, never by hand.
- `npm run check:docs` checks the snapshots against the results directory when it holds run folders, and skips that part with a message when it does not. The other checks always run.
- `npm test` passes without run folders: tests that need them skip and say why. Run the full set with the results directory set:

  ```sh
  SUITE_RESULTS_DIR=<results dir> nice -n 10 npm test
  SUITE_RESULTS_DIR=<results dir> nice -n 10 npm run check:docs
  ```

- The results directory the generated pages are checked against can be rebuilt instead of kept as a hand-made copy: `scripts/assemble-results-set.ts` copies a base results directory (the run folders of the last full set, here the integration 4 set) and adds what `results/ceremony-overlay.json` names. The overlay has four parts: `entries` (ceremony run records: a source folder holding `scenario-result.json`, or with `each` a folder of such folders, copied to `ceremonies/<row>/<as>/`; only `scenario-result.json` is copied), `runs` (whole run folders copied to `runs/<name>/`, for example the live VTI core run, the witness 0.2 runs, the promotion gating sets and the wallet emit re-runs), `files` (single replacement files: the run index, two run READMEs, `runs-before-run-json.json`) and `sources` (what each root label is; the test refuses an undocumented label). Each source is named by a root label given on the command line, so no local path is recorded in the repository; the label `repo` is this repository (the merged run index is kept in `results/overlay-files/runs-INDEX.md`). Integration 5 labels: `rooms-final`, `rooms-agent` (rooms and ballot ceremonies), `live` (the live VTI container set), `witness` (the witness 0.2 set), `wire` (the wire.up, wire.fk, wire.kvc and wire.mbr records; a `superseded` folder inside a ceremony source is never copied), `kwacl`, `vtilatest` (the latest-version ACL and VTI main ceremony rows), `persona` (persona, directory and elections reads), `b1gate`, `b2gate`, `b2ported` (promotion gating run sets), `kwreach` (wallet emit re-runs).

  ```sh
  node --experimental-strip-types scripts/assemble-results-set.ts --base <base results dir> --out <new dir> \
    --root <label>=<folder> [--root ...] [--dry-run]    # one --root for every label in the overlay's `sources` except `repo`
  ```

  The output directory must not exist (nothing is overwritten, and a run folder that is already in the base is refused). Then run the checks against `<new dir>` as above. The tests that read the coverage records also take `COVERAGE_RUNS_DIR=<coverage runs folder>`; `results/coverage.md` itself is generated without it, so `npm run check:docs` is run without `COVERAGE_RUNS_DIR`.
- A page cites a run folder as a code span, `<results dir>/runs/<folder>/` or `runs/<folder>/`, never as a link.

## 3. Add a vector

1. Find the family and its generator. Never hand-edit generated JSON: a test compares it with the generator's output.

   | Family | Writes | Authored in |
   |---|---|---|
   | Core | `vectors/` (framework, dtg, ceremony-*) | `scripts/generate-vectors.ts` (reads `vectors/imported/` and the hand file below) |
   | Core, hand-written rows | `vectors/dtg/cex-push.json` | `vectors-src/dtg/cex-push.json`; `generate-vectors.ts` refreshes its `tfRef` and markers and emits it |
   | Plain | `vectors/plain/` | `scripts/generate-plain.ts` |
   | Emit | `vectors/emit/` | `scripts/generate-emit.ts` |
   | Emit-more | `vectors/emit-more/` | `scripts/generate-emit-more.ts` |
   | Witness | `vectors/witness/` | `scripts/generate-witness-vectors.ts` |
   | 2L profiles | `vectors/2l/` | `scripts/generate-2l.ts` |
   | Governance probes | `vectors/governance/` | `scripts/generate-governance.ts` |

   Task-force fixtures under `vectors/imported/` are copied unchanged by `scripts/import-fixtures.ts`; do not edit them.
2. Add the vector in the generator with the next free id `<GROUP>-<NNN>`; an id is never reused, and `npm run regen` adds it to the id ledger. Quote the specification text it rests on. To stop running a vector, retire it (`retired: {reason, since: <suite version>}`), never delete it, and note it in [CHANGELOG.md](CHANGELOG.md): see [docs/04 section 20.3](docs/04-suite-design.md#203-vector-ids-never-reused-retired-rather-than-deleted-cited-with-the-version) for the id, version and citation rules.
3. Set its `source.channel` and, for `registry`, its `tfRef` (the TF artifact it cites). A vector with no TF home is `candidate`; the suite's own profiles are `proposed`. See [docs/04 section 18](docs/04-suite-design.md#18-spec-maturity-channels-and-spec-drift-built), especially 18.2 and 18.7.
4. Choose the tier: Tier 1 is the framework's own requirements and nothing stricter; anything stricter is Tier 2 ([docs/04 section 10](docs/04-suite-design.md#10-tiers-built)).
5. A `requires` entry is `optional:<name>` (the name must be in `OPTIONAL_CAPABILITIES` in `src/adapter/contract.ts`; the loader rejects any other), `carrier:`, `emit:`, `binding:`, `cryptosuite:`, `discovery` or a Type URI. A new optional capability is added to that list first.
6. For a negative vector, name the mutant that must fail it (`mutants`), adding one to `src/adapters/reference/mutants.ts` if none fits. The non-vacuity test (`test/reference.test.ts`) proves the vector catches the fault ([docs/04 section 9](docs/04-suite-design.md#9-non-vacuity-built)).
7. Make the reference adapter pass the positive form, if it does not already.
8. Regenerate:

   ```sh
   nice -n 10 npm run regen
   ```

9. Prove it:

   ```sh
   nice -n 10 npm test && nice -n 10 npm run check:docs
   ```

## 4. Add or triage a difference (KNOWN-FAIL)

A difference is a vector a platform does not pass. Re-read the specification text before anything else: the vector may be the thing that is wrong. An implementer who thinks so files a challenge ([docs/challenges.md](docs/challenges.md)). The order of authority is the specifications, then VTI, then keyring-wallet, then truststackers.

0. If the verdict is not reproducible (the same platform and inputs pass on one run and fail on another), it is not a difference: fix the vector if the suite causes it, or quarantine it in `exceptions/quarantine.json` with an owner and a short expiry ([docs/04 section 18.9](docs/04-suite-design.md#189-promotion-criteria-and-flaky-vectors-quarantine)).
1. Find the vector's cited text (its `tfRef` or quoted rule) and read it at the pinned commit.
2. Classify it, stopping at the first yes ([results/vector-review.md](results/vector-review.md#classes)):
   - Is it an artefact of the adapter or a stand-in carrier, not the platform? Class **D**. Fix the adapter if you can.
   - Is the specification text itself open, or inconsistent between documents? Class **C**: a question for the task force.
   - Does the vector read more than the text says (the text is silent, says SHOULD or MAY, or the platform's reading is defensible)? Class **B**: change the vector to CLARIFY (recipe 3) with an entry in `vectors-src/clarify-classes.json` (class, the suite version it moved in, question ids; [docs/04 section 18.10](docs/04-suite-design.md#1810-clarify-classes-age-and-task-force-questions)), and record no exception.
   - Otherwise the platform differs from the text and the vector is right: class **A**.
3. For A, C and D, add an entry to `exceptions/exceptions.json`: `impl`, `vector`, `class` (`A` to `D`; a test checks it agrees with the reason), `reason` (quote the text with file and line, state the class), `owner` (`unassigned` until someone agrees to own it), `expires` (YYYY-MM-DD; `npm run regen` sets it from [exceptions/expiry-policy.json](exceptions/expiry-policy.json), which gives each implementation key its date; a new key needs an offset there), `ref`, `acknowledged` (`null` until the platform's implementer agrees the entry describes their platform, then `{ "by", "on", "ref" }`; [docs/challenges.md section 7](docs/challenges.md#7-owner-acknowledgement-of-an-exception)), `expectFailure` (`{ "failures": [regex, ...] }`, anchored patterns over the recorded result's `failures` lines; a failure that misses one is FAIL). Key it on the surface that recorded the difference (each surface has its own implementation name); an entry copied to another surface's key without a recorded result there carries `inherited` (where it came from). An expired entry, one whose vector now passes, or one whose vector fails another way fails the run ([docs/04 section 8](docs/04-suite-design.md#8-outcomes-capability-gating-and-known-failures-built)).
4. Update `results/vector-review.md`: the entry and its class, with the quoted text. Its totals table is generated from the exceptions file by `npm run regen`.

   A FAIL whose cause is written down but which should stay a FAIL (explained, not excused) goes in `results/findings.json` instead (hand input: `impl`, `vector`, `class` A to D or `null` when not yet classed, `explanation`, `ref`, `excused: false`, and optionally `inherited` (where it was measured, when no recorded run folder holds the FAIL yet: the stale-entry test skips it and the pages show nothing until a recorded FAIL matches) and `evidence` (vector ids, for example the seeded probe, behind the explanation)). It still counts as FAIL and still fails the run; the generated pages show it as "Recorded finding, not excused" rather than "Needs a look". A test fails when an entry no longer matches a current FAIL.
5. Draft an issue in the run folder's `draft-issues/` (expected vs observed, the quoted text, a suggested fix, target repository), marked `DRAFT, NOT FILED`. Never file it without the project owner's approval.
6. Re-run the affected surface with `--today` pinned, then regenerate:

   ```sh
   nice -n 10 npm run regen
   ```

7. Prove it:

   ```sh
   nice -n 10 npm test && nice -n 10 npm run check:docs
   ```

## 5. Classify a new SKIP reason

Every SKIP is classified. A reason that matches no rule shows up as "unclassified" in AT-A-GLANCE and counts as not reached.

1. Find the reason text: after `npm run regen`, AT-A-GLANCE names the unclassified reasons in each platform's "What is next", and `results.json` holds each SKIP's `reason`.
2. Decide the class, using only checked evidence from the platform:
   - **not applicable**: the platform does not offer the task or feature. Only the adapter's cited `notOffered` entry (`{ "reason", "evidence" }`, the evidence a file and line or search at a named commit of the platform) makes a SKIP not applicable; the SKIP then carries `evidence`. A rule cannot: on a run recorded under that rule, a SKIP without evidence that a rule classes not applicable reads not reached ([docs/04 section 8](docs/04-suite-design.md#8-outcomes-capability-gating-and-known-failures-built)).
   - **version mismatch**: the platform offers the task at a different version than the vector needs.
   - **not reached**: everything else. The platform may well do it, but the suite cannot drive it yet. Name the specific, checked reason (a test-host limit, a missing trigger, a clock that cannot be set).
   - **out of tier**: a Tier 2 check outside the headline tier.
3. "The adapter lacks it" is never a reason. Without checked platform evidence, the class is not reached.
4. Add a rule to `results/skip-classes.json`: `id`, `match` (a regular expression over the reason), `class`, `note` (the evidence: file:line at a commit). Scope it with `surfaces` when the evidence is about one platform. Rules are tried in order and the first match wins, so put specific rules before generic ones.
5. Regenerate:

   ```sh
   nice -n 10 npm run regen
   ```

6. Prove it (the sweep test in `test/at-a-glance.test.ts` checks not-reached reasons on re-run surfaces):

   ```sh
   nice -n 10 npm test && nice -n 10 npm run check:docs
   ```

## Where to discuss

Questions, ideas and open-ended proposals go to GitHub Discussions on this repository. A concrete problem with a vector, a specification question, a new adapter or a new vector proposal goes in an issue, using the templates in `.github/`. Security reports and conduct reports go through the private channel in [SECURITY.md](SECURITY.md), never in a public thread. All participation follows the [code of conduct](CODE_OF_CONDUCT.md); who maintains the project is in [MAINTAINERS.md](MAINTAINERS.md).

## Style and wording

- **Claims.** State a result with the [claim template](docs/claims.md) (suite version, run folder, vector ids). The status words it lists are not used about any platform; `npm run lint:claims` (also run by `npm test` and `npm run check:docs`) fails on them outside a `lint:skip` block.
- **Figures.** A figure appears in exactly one generated place; every other page links to it. Never type a count into a page. A historical figure is written with its context, for example "(on the 384-vector set, 2026-11-15; superseded)".
- **Interoperability.** Never write "interoperable" or "interoperate" without saying whether conformance-implied or demonstrated interoperation is meant ([docs/14](docs/14-interoperability-tracking.md)). Today only conformance-implied evidence exists; no demonstrated interoperation is recorded.
- **Platform order.** Wherever platforms are listed: VTI, keyring-wallet, truststackers.
- **Platforms apart.** Platforms are reported separately: separate runs, rows, sections, numbers and links. Never add or average them.
- **Not a ranking.** Each row is one surface measured alone. Rows are never added together and never compared as a league table.
- **Advisory stays advisory.** Only `registry` vectors gate. `candidate`, `proposed` and `pr` results are advisory and never in a headline total.
- **Governance.** Governance is never determined by these tests. Role values come from what the adapter declares ([docs/17](docs/17-governance-probes.md)).
- **SKIP.** A SKIP is never a failure and never a pass. Every SKIP says why: not applicable (with evidence), not reached, or different version.
- **Tone.** Write for the platform's maintainer: factual, non-accusatory and constructive.
- **Decisions.** Record a decision in the design document it affects, in the present tense: the rule, the reason, the alternative rejected and where it is implemented. A project-wide rule also gets an entry in [docs/decisions/README.md](docs/decisions/README.md). The git log is the change history; there are no dated notes.
- **Paragraphs.** One claim per sentence. Figures go in generated tables, never in prose. History goes in the git log, not in a page. At most about 80 words per paragraph, and no more than one level of parentheses.
- **Status line.** Every page starts with the draft-proposal status line shown at the top of this page. `test/banner.test.ts` checks it (its exemptions are listed in the test).
- **Links.** Use relative links to tracked files; an anchor must name a heading of the target page. `test/links.test.ts` checks both, and `npm run check:docs` runs it with the banner test.
