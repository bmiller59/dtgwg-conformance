# Design rationale register

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This folder states the rules the suite follows, grouped by topic: what the rule is, why, what was rejected, and where it is implemented. It describes how things are now. The change history is the git log; there are no dated notes.

- **The project owner** is the repository maintainer, who makes the project decisions recorded here and in the design documents.
- **Ids.** A few rules carry a stable id (for example *decision 79*) because other pages, vectors or code cite them. The ids are labels, not an order, and the numbering has gaps. RD1 to RD7 are the roadmap decisions on the application profiles (AP; identifiers use `2L`).
- **Status words.** *in force*: the rule applies. *open*: not settled, or proposed and waiting for the project owner ([open-decisions-from-reviews.md](../open-decisions-from-reviews.md) lists the review items).
- **Detail.** Longer rationale is in the design documents ([04](../04-suite-design.md) for the suite, [06 section 12](../06-truststackers-conformance-plan.md#12-design-rationale-and-alternatives-rejected) for the truststackers plan), [21-vector-group-rationale.md](../21-vector-group-rationale.md) (why each vector group is built as it is) and [05-reference-implementations.md](../05-reference-implementations.md) and results/platforms/ (what was found on each platform).

## Topics

| File | What it holds |
|---|---|
| [Constraints, governance and process](01-constraints-and-process.md) | Standing constraints, project governance, scope, suite mechanics and the authority order. |
| [Specifications, tiers and channels](02-specs-tiers-and-channels.md) | Tiers and advisories, specification sources and channels, the latest-versions focus, task-force alignment and pins. |
| [Vectors and coverage](03-vectors-and-coverage.md) | Coverage families, uncovered families, vector completeness, gaps, older sets, witness vectors and registry promotion. |
| [Ceremonies, governance and exceptions](04-ceremonies-governance-and-exceptions.md) | Governance in vectors, holds and ceremonies, SKIP classes, exceptions, the keyring-wallet to VTI ceremony set, bindings, interoperability wording, rooms and ballots, wallet driver legs. |
| [Application profiles roadmap](05-application-profiles-roadmap.md) | Roadmap decisions RD1 to RD7 on the application profiles. |
| [Runs, results and integration decisions](06-runs-and-results.md) | Platform rows, run records, reach and roles, live rows, integration passes, roll-up inputs and release-candidate decisions. |

## Adding a decision

Put the decision in the topic file it belongs to, as a bullet with a stable anchor (`<a id="d###"></a>`) and the next free number. Ids are never reused or renumbered; other pages, vectors and code cite them as `decisions/<file>.md#d###`. A test (`test/decisions-ids.test.ts`) fails on a duplicate id or a topic file missing from the table above.
