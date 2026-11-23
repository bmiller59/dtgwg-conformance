# Community: check and extend the suite

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

Everything an outside contributor needs to check this suite or extend it. All task specifications involved are draft, and <!-- lint:skip -->nothing here says any platform is conformant<!-- /lint:skip -->.

| Page | Use it to |
|---|---|
| [README](../../README.md) | See what the suite is and is not, where it stands, and run it against the reference adapter in five minutes. |
| [Getting started](../getting-started.md) | Install, run against the reference adapter, read the output, then point the suite at a real platform. |
| [Add a platform](../add-a-platform.md) | Write an adapter for a platform, step by step. |
| [Add or fix a test](../add-a-test.md) | Add a vector end to end, or a ceremony scenario. |
| [Review guide](../review-guide.md) | Review the vectors against a specification you edit: find them, read one, reply. |
| [Reading results](../reading-results.md) | What a run prints and writes, and what a figure may be used to say. |
| [How to contribute](contributing.md) | Learn the rules: adding a vector, an adapter or a ceremony scenario, classifying a failure as A, B, C or D, and what a review expects. |
| [Open gaps](open-gaps.md) | Pick something to do: each open ceremony scenario and vector gap, with its blocking class and what it needs. Generated from data. |
| [CONTRIBUTING.md](../../CONTRIBUTING.md) | Follow the step-by-step recipes: run, record a run, add a vector, triage a difference, classify a SKIP, and the style rules. |
| [Challenging a vector](../challenges.md) | Dispute a vector with evidence, and see what happens to results while it is open. |
| [What a platform may claim](../claims.md) | State a result without saying more than the run shows. |
| [Glossary](../03-glossary.md) | Look up a term or a status code. |
| [Suite design](../04-suite-design.md) | Read the vector format, the adapter contract, channels and the runner. |
| [Documentation index](../README.md) | Find the rest of the reference. |
| [Platforms measured](../../platforms.md) | See which platforms are measured, their role in the authority order and where their adapters are. |

Issue and pull request templates are in `.github/`: a problem with a vector, a specification question, a new adapter, a new vector proposal, and a pull request checklist. Nothing is filed or sent from the suite on anyone's behalf. Ideas and questions go to GitHub Discussions on the repository ([where to discuss](../../CONTRIBUTING.md#where-to-discuss)); security and conduct reports go through the private channel in [SECURITY.md](../../SECURITY.md).

The order of authority is the specifications, then VTI, then keyring-wallet, then truststackers. The specification text wins over every implementation.
