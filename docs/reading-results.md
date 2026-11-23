# Reading results

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

How to read what a run of the suite prints and writes, and what a figure may and may not be used to say. Every task specification involved is draft, so a status here says where the specification text lives, not that it is ratified. The status codes and their plain-word equivalents are in the [glossary](03-glossary.md#status-codes-and-plain-words); what a result may be used to claim is in [claims.md](claims.md).

## Vector verdicts

- **PASS**: the implementation did what the vector requires.
- **FAIL**: it did not, and nothing explains it yet. A FAIL on a gating vector fails the run.
- **KNOWN-FAIL**: a difference that has been looked at and recorded in `exceptions/exceptions.json` with a reason, an owner and an expiry date.
- **CLARIFY**: the vector rests on a point the specifications do not settle. It is reported with its reason and never gates. CLARIFY results are not failures.
- **SKIP**: the adapter does not offer what the vector needs. A SKIP is never a pass and never a failure; every SKIP says why (not applicable, not reached, or a different version).
- **SKIPPED-SAFETY**: the vector would change state and the run was not told the adapter is disposable (`--allow-effects`). It is neither a pass nor a failure.

In the quick start, the 3 SKIP are vectors that need a capability the reference adapter does not declare, and the 68 CLARIFY rest on open points in the specifications.

## Reach, channels and tiers

- **Reach matters.** A high PASS count over a small reach says little. Always read the reach (vectors run, out of vectors that apply) beside the verdicts.
- **Channels.** Only `registry` vectors gate: they cite a specification in the Trust Tasks task-force repository. `pr` (an open pull request there), `proposed` (the suite's own proposals) and `candidate` (behaviour with no specification home yet) are advisory, written to the sibling folder `<out>-advisory`, and never in a headline figure. The "excluded by channel" line counts the advisory vectors a run left out. Channels are defined in [docs/04 section 18](04-suite-design.md#18-spec-maturity-channels-and-spec-drift-built).
- **Tiers.** Tier 1 is the framework's own requirements and nothing stricter. Tier 2 holds stricter behaviour, such as the proposed attested profile ([docs/04 section 10](04-suite-design.md#10-tiers-built)).

## The files a run writes

A run with `--out <dir>` writes:

| File | What it holds |
|---|---|
| `conformance-matrix.md`, `conformance-matrix.json` | A table per vector group: the verdict counts. |
| `results.json` | One row per vector: its status, its reason and, for a FAIL, the failing step. Verify any count against this file, never against a summary. |
| `run.json` | What was run: suite commit and version, vector and exception digests, each adapter's declared capabilities, the date used. |

The exit code is 0 when nothing gating failed.

## Ceremony results

Ceremony scenario results are *completed*, *ended as specified*, *failed* or *skipped*. They are always reported as completion with a denominator, never as conformance, never counted with vector results, and never as proof that two platforms interoperate ([docs/25](25-ceremony-scenarios.md)).

## Figures

- Every percentage is printed with its denominator, for example 66.7% [104/156].
- Each platform is reported in its own rows. Rows are never added together, averaged or ranked.
- *Covered* (a vector exists for a task) is not *passing*. Coverage is a fact about the suite, not about any platform.
- Measured results are dated snapshots of recorded runs, published separately from this repository.

When a verdict looks wrong, read the vector's cited text first: the vector may be what is wrong. [Challenging a vector](challenges.md) says how to dispute one, and [how to contribute](community/contributing.md#classify-a-failure-a-b-c-or-d) says how a failure is classified.
