# Getting started

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This page takes you from a fresh copy of the repository to a run against a real platform. Every task specification involved is draft. The five-minute version is in the [README](../README.md#five-minute-quick-start); this page explains it and goes one step further each time. Terms are in the [glossary](03-glossary.md).

## 1. Install

You need Node.js 22.16 or later and git. TypeScript runs directly through Node; there is no build step. Work from a git clone rather than a downloaded archive: the checks of the documentation pages read the list of tracked files from git.

```sh
node --version          # v22.16.0 or later
npm ci                  # installs the exact versions in package-lock.json
```

Suite runs and the suite's own tests can take a few minutes and several CPU cores. On a shared machine run them under `nice -n 10`, as every example here does.

## 2. Run against the reference adapter

The reference adapter is the suite's own stand-in, written from the specifications. It is not a platform: running against it shows that your copy works and what a result looks like.

```sh
nice -n 10 npm run suite -- --adapter reference --tier 1 --allow-effects reference-in-process --out results-local/quickstart
```

What the output lines mean:

| Line | Meaning |
|---|---|
| `reference: adapter contract 0.1 (suite 0.1)` | The adapter answered the handshake; both sides speak contract 0.1. |
| `reference tier 1: {"PASS":271,"CLARIFY":68,"SKIP":3} (...)` | The verdicts for this run. Tier 1 is the framework's own requirements and nothing stricter. The bracket says the clock could be set and gives the run salt, a random value mixed into document ids (pass `--salt <s>` to repeat a run exactly). |
| `advisories: 0` | Notes that never gate, such as a missing optional error reply. |
| `excluded by channel: proposed 19, candidate 32` | Advisory vectors left out because only the gating `registry` channel was selected (`--channels` adds others). |
| `excluded by tier (not SKIP): 44 (tier 2 not selected)` | Stricter Tier 2 vectors, left out by `--tier 1`. |
| `essential governance honesty check: ...` | The roles the adapter declared are consistent with themselves. Governance is never determined by these tests. |
| `excluded from every run: N (...)` | Vectors that cite a retired specification; they are never run. Appears for some families. |
| `spec-drift (advisory, ...) ...` | The suite could not compare the specification text it cites with a current copy, because none was given. See section 5. |

`--allow-effects reference-in-process` tells the runner the adapter is disposable, so vectors that change state may run. Without it, those vectors are reported `SKIPPED-SAFETY` and are not run. Never pass it for a deployment you care about.

The run folder `results-local/quickstart/` holds `conformance-matrix.md` (a table per vector group), `results.json` (every vector with its status and reason) and `run.json` (what was run, with digests). How to read them: [reading results](reading-results.md).

To run another family of vectors, name its folder, for example the plain-task probes:

```sh
nice -n 10 npm run suite -- --adapter reference --tier 1 --vectors vectors/plain --allow-effects reference-in-process --out results-local/plain
```

All the families are listed in [CONTRIBUTING.md, recipe 1](../CONTRIBUTING.md#families-and-channels).

## 3. See a vector catch a fault

A mutant is the reference adapter with one deliberate bug. A negative vector names the mutants it must catch, which shows it does not pass vacuously.

```sh
nice -n 10 npm run suite -- --adapter mutant:noRecipientCheck --tier 1 --allow-effects reference-in-process --out results-local/mutant
```

The mutant accepts documents addressed to someone else, so seven vectors now FAIL, each with the step and the reason, and the command exits with code 1 because a gating vector failed. That is the expected result here. The list of mutants is in `src/adapters/reference/mutants.ts`.

## 4. Run through an out-of-process adapter

A real platform is measured through an adapter that runs as its own process. The example server serves the reference adapter over JSON-RPC on stdin and stdout, the same way a platform adapter does:

```sh
nice -n 10 npm run suite -- --adapter 'stdio:node --experimental-strip-types --disable-warning=ExperimentalWarning src/adapters/example-server/server.ts stdio' --tier 1 --allow-effects reference-in-process --out results-local/stdio
```

It gives the same `{"PASS":271,"CLARIFY":68,"SKIP":3}` as section 2. `stdio:<command>`, `http:<url>` and `module:<path>` are the three ways to name an adapter. To write one for your platform, see [add a platform](add-a-platform.md).

One ceremony scenario with two reference parties:

```sh
nice -n 10 npm run ceremony -- --participant P=reference --participant R=reference-peer --scenario FC-VRC-001
```

## 5. Check the cited text against the specifications

Vectors quote the specification text they rest on, pinned to a commit of the task-force repository [trustoverip/dtgwg-trust-tasks-tf](https://github.com/trustoverip/dtgwg-trust-tasks-tf). Give the runner a checkout of that repository (the "TF checkout") and it reports where the cited text has changed since (spec-drift, advisory):

```sh
git clone https://github.com/trustoverip/dtgwg-trust-tasks-tf <TF checkout>
nice -n 10 npm run suite -- --kit <TF checkout> --adapter reference --tier 1 --allow-effects reference-in-process --out results-local/drift
```

## 6. Point the suite at a real platform

Each platform adapter reads the platform from a checkout or a running service named by environment variables. The suite never writes to the platform's checkout. Two examples, with placeholders:

```sh
# VTI community service, running, over HTTPS
VTI_BASE_URL=<https://your-vtc> nice -n 10 npm run suite -- --adapter module:src/adapters/vti/index.ts --tier 1 --out results-local/vti

# keyring-wallet, from a checkout, behind a stand-in carrier
KW_ROOT=<keyring-wallet checkout> nice -n 10 npm run suite -- --adapter 'stdio:node --experimental-strip-types src/adapters/keyring-wallet/launcher.ts' --tier 1 --out results-local/kw
```

Leave out `--allow-effects` against anything that is not a disposable test deployment: vectors that would change state are then reported `SKIPPED-SAFETY` and not sent. Every adapter, its settings and the full run command (with `--today` pinned so the run can be reproduced) are in [CONTRIBUTING.md, recipe 1](../CONTRIBUTING.md#1-run-the-suite-against-your-platform). Each adapter's header comment lists every option. Platform runs need the platform's own toolchain (for example Rust for VTI's in-process hosts) and can take much longer than the reference run.

To keep a run as a record, see [CONTRIBUTING.md, recipe 2](../CONTRIBUTING.md#2-record-a-run). Run records are kept outside this repository.

## 7. Run the suite's own tests

```sh
npm run typecheck
nice -n 10 npm test           # the whole suite of tests; several minutes
nice -n 10 npm run check:docs # generated files and pages are current
```

Tests that need recorded runs, a TF checkout or a platform checkout skip and say why. [How to contribute](community/contributing.md#set-up-and-run-the-tests) lists what the tests check.

## When something goes wrong

| Symptom | Likely cause |
|---|---|
| `SyntaxError` or `--experimental-strip-types` is not recognised | Node.js older than 22.16. |
| Many lines of `spec-drift ... missing-source` | No TF checkout was given. They are advisory; see section 5. |
| `SKIPPED-SAFETY` results | `--allow-effects` was not given. That is the safe default. |
| A platform adapter stops at once with `fetch failed` | Nothing answers at the service address given (for VTI over HTTPS, `VTI_BASE_URL`). |
| A launcher stops at once with `spawn nice ENOENT` or a similar `ENOENT` | The platform checkout named by its environment variable (for example `KW_ROOT`) does not exist. |
| `npm run check:docs` reports `stale: test/links.test.ts, ...` in a folder that is not a git clone | The page checks need git; clone the repository, or run `git init && git add -A` in the folder. |

Questions go to GitHub Discussions on the repository ([where to discuss](../CONTRIBUTING.md#where-to-discuss)).
