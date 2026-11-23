# Run YYYY-MM-DD: <platform> <ref or label>

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. Nothing from this run has been filed with or sent to any project.

## Versions tested

| Item | Value |
|---|---|
| Implementation | name |
| Commit or release | commit or release |
| Source | public, local or unpublished |
| Adapter revision | where it lives and its revision |
| Suite revision | the suite commit and version from `run.json` (`suite.commit`, `suite.version`, and whether the tree was dirty), with the vector count |

Copy this folder to `runs/YYYY-MM-DD-<short-label>/` of the results directory (outside this repository; `SUITE_RESULTS_DIR`, docs/04 section 21) and fill it in. Keep it in plain English. No local paths, no private addresses, no credentials.

## What was run

- **Implementation and version:** name, repository, commit or release, and whether it is a live service, a library behind an adapter, or something else. State what the adapter does and does not measure.
- **Adapter:** where it lives in this repository and any non-default options.
- **Suite state:** vector count, tiers run, suite commit, whether exceptions were applied.
- **Date:**

## Counts

| Run | PASS | CLARIFY | SKIP | KNOWN-FAIL | FAIL |
|---|---|---|---|---|---|
| Tier 1 | | | | | |
| Tier 2 | | | | | |

(Add one row per configuration, for example attested and non-attested. Verify every number against `results.json`, not against a summary.)

## What changed since the previous run

Name the previous run folder and list each status change and its cause (suite change or implementation change).

## Reading the result

Plain-English caveats: what the SKIPs mean, what this run does not say.

## Files

- [Matrix](conformance-matrix.md), [matrix JSON](conformance-matrix.json), [raw results](results.json), [run provenance](run.json) (written by the runner with `--out`: suite commit, vector and exceptions digests, each adapter's capabilities and version, the date used; pin the date with `--today`)
- [issues-<platform>.md](issues-PLATFORM.md)
- Draft issues (not filed): list each file in [draft-issues/](draft-issues/)

## How it was run

The command, with placeholders for paths.
