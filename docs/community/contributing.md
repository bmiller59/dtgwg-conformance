# How to contribute

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This page is the way in for someone who has not worked on the suite before: what you can contribute, the rules a contribution is read against, and how to classify a failure. The step-by-step recipes (run, record a run, add a vector, triage a difference, classify a skip) are in [CONTRIBUTING.md](../../CONTRIBUTING.md) at the top of the repository; this page points into them rather than repeating them. What is open right now is on [open-gaps.md](open-gaps.md). All specifications involved are draft.

## What helps most

- **Check a vector against the specification.** Read the text it cites and tell us where it says more or less than the text. This is the most useful review, and the result can be a challenge ([docs/challenges.md](../challenges.md)).
- **Run the suite against another implementation** and report what it shows, including SKIPs that look wrong.
- **Pick an item from [open-gaps.md](open-gaps.md):** a ceremony scenario with no completed run, a task with no positive or negative vector, a weak positive that adapter state would let us assert.
- **Write or extend an adapter** for a platform (below).
- **Add a vector or a ceremony scenario** for a clause nothing covers yet.

Corrections to the suite are as welcome as additions. A report that a vector is wrong is a contribution, not an attack on the people who wrote it.

## Set up and run the tests

Node.js 22.16 or later. TypeScript is type-checked, never compiled.

```sh
npm ci
nice -n 10 npm test           # the suite's own tests
npm run typecheck
npm run lint:claims           # fails on words the suite never uses about a platform
npm run check:docs            # generated pages are current (skips run-folder checks when you have no run records)
```

`npm test` includes the hygiene test (no local paths in any tracked file), the status-banner test (every page carries the draft-proposal line), the link test (every relative link and anchor resolves) and a freshness test per generator. Heavy commands are best run under `nice -n 10`, and with enough free memory if the machine is shared.

Every tracked page begins with the draft-proposal status line shown at the top of this one. Copy it exactly.

## Add a vector

Walk-through: [add or fix a test](../add-a-test.md). Recipe: [CONTRIBUTING.md, recipe 3](../../CONTRIBUTING.md#3-add-a-vector). The points a reviewer looks for first:

1. **Cite the text.** A vector quotes the specification sentence it rests on, with the document and clause (`framework 8.2`, `specs/<family>/<task>/<version>`). A vector with no citation is a `candidate` (behaviour with no home in the Trust Tasks repository), never `registry`.
2. **Label the maturity.** Every task specification is currently draft; the vector says which specification and version it follows (`source.tfRef`, with the status the specification carries). Do not write that a specification is final.
3. **Pick the channel honestly.** `registry` vectors gate and rest on a specification in the Trust Tasks registry. `pr` (an open pull request), `proposed` (a suite-defined profile over real text) and `candidate` are advisory and are never added to a headline figure. Channels: [docs/04 section 18](../04-suite-design.md#18-spec-maturity-channels-and-spec-drift-built).
4. **Start advisory.** A new vector is not promoted to `registry` in the same change. Promotion needs review, recorded runs and the rules in [docs/33](../33-registry-promotion.md).
5. **Say what it requires.** `requires` lists the adapter capabilities and Type URIs the vector needs; an adapter that lacks one gets SKIP, which is never a failure and never a pass.
6. **Name the mutant.** A negative vector names a deliberately broken variant of the reference adapter that it must fail, so the vector is shown not to pass vacuously.
7. **Ids and the ledger.** Ids are `<GROUP>-<NNN>`, issued by the generator, recorded in `vectors-src/id-ledger.json` by `npm run regen`, never reused. To stop running a vector, retire it with a reason; never delete it ([docs/04 section 20.3](../04-suite-design.md#203-vector-ids-never-reused-retired-rather-than-deleted-cited-with-the-version)).
8. **Edit the generator, not the JSON.** Files under `vectors/` are generated and a test compares them with the generator's output.

## Add or extend an adapter

An adapter turns "send these bytes, tell me what came back" into one platform's own calls. It speaks JSON-RPC over stdio or HTTP, or is loaded as a module. The contract is [docs/04 section 4](../04-suite-design.md#4-adapter-contract-built-typescript-types-client-and-example-server) and `src/adapter/contract.ts`; the step-by-step walk-through is [add a platform](../add-a-platform.md).

1. Copy the shape of `src/adapters/example-server/server.ts`, which serves the reference adapter over the wire. Real adapters to learn from are under `src/adapters/` (`vti/`, `keyring-wallet/`).
2. Declare only what you can do: the document types you serve, the optional capabilities, and `clockFree` if you cannot set a clock. A vector that needs something you did not declare is SKIP, and that is the honest answer.
3. Never make an adapter pass by answering what the platform would not. An adapter that manufactures an outcome measures the adapter, not the platform; the suite counts that as a defect of the harness (class D).
4. State evidence for anything you declare as not offered (a file and line at a named commit), not a belief ([CONTRIBUTING.md, recipe 5](../../CONTRIBUTING.md#5-classify-a-new-skip-reason)).
5. Run it ([recipe 1](../../CONTRIBUTING.md#1-run-the-suite-against-your-platform)), read every non-PASS result with its reason, and describe the platform at a named commit or release.
6. Platforms are reported separately, never added or averaged.

A new optional capability is added to `OPTIONAL_CAPABILITIES` in `src/adapter/contract.ts` first; the loader rejects names that are not in that list.

## Add a ceremony scenario

A ceremony scenario runs several Trust Tasks between named roles to a named end state ([docs/25](../25-ceremony-scenarios.md), [docs/26](../26-paired-ceremonies.md)).

1. Add it in `scripts/generate-ceremony-scenarios.ts` (or the group's section of it), with the next id `FC-<group>-NNN`; ids are issued through the same ledger as vector ids.
2. Cite the specification text for each step. The choreography around the tasks is the suite's own proposal and is advisory; say so in the scenario.
3. Prove it on the reference pair first: `npm run ceremony -- --participant P=reference --participant R=reference-peer --scenario <id>`, and make sure a deliberate fault ends the scenario in `failed` (the scenario tests do this with mutants).
4. Run `npm run regen` and `npm test`.

Scenario results are outcomes of ceremonies run together (completed, ended as specified, failed, skipped). They are reported as completion percentages with their denominators, never as conformance, never counted with vector results, and never as proof that two platforms interoperate.

## Classify a failure: A, B, C or D

When a platform does not pass a vector, decide which of these it is, in this order, stopping at the first yes (the full procedure is [CONTRIBUTING.md, recipe 4](../../CONTRIBUTING.md#4-add-or-triage-a-difference-known-fail) and the classes are defined in [results/vector-review.md](../../results/vector-review.md#classes)):

| Class | Meaning | What you do |
|---|---|---|
| **D** | The harness: the adapter, a stand-in carrier or the runner is at fault, not the platform. | Fix the adapter or runner; record nothing against the platform. |
| **C** | The specification text is open or two documents disagree. | **Discuss it with the task force. Do not assert a reading in a vector, an exception or a report.** Record the question with both quotations. |
| **B** | The vector reads more than the text says (a SHOULD or MAY made a MUST, or the suite's own design rule presented as specification). | Change the vector to CLARIFY. The platform is not at fault. |
| **A** | The platform differs from clear specification text and the vector is right. | Record a difference with the quoted text. Proposed changes to the platform go to its maintainers by their own process. |

Rules that apply to all four:

- **Spec-open items are not asserted.** If you cannot point to a sentence that decides the behaviour, the answer is C, and the item is a question. A vector that picks a side on an open point is a defect.
- **Reproduce first.** A verdict that changes between runs of the same inputs is not a difference. Fix the vector or quarantine it.
- **Draft issues stay drafts.** Text written for a platform's maintainers is kept as a draft in the run record. Nothing is filed or sent on anyone's behalf from this repository until a public home and a contact are named.

## Wallet shared-connect developer switch

keyring-wallet has a developer switch, "shared connect" (upstream issue 962), that is off by default. The suite's wallet shim leaves it off, so published wallet results are measured with it off. A run with it on is a separate measurement: label it in the run folder name and in `run.json`, report it apart, and never merge it with the default rows. Details: [CONTRIBUTING.md](../../CONTRIBUTING.md#wallet-shared-connect-developer-switch-upstream-issue-962).

## Review expectations

- **The specification text wins over every implementation.** The order of authority is: the specifications, then VTI, then keyring-wallet, then truststackers. A vector is changed to match the text, never to match a platform's behaviour, and an implementation is never described as right because it is widely used.
- **Cite, then argue.** A review comment says which sentence it relies on. "The platform does X" is a fact about the platform and not an argument about the vector.
- **No status claims about a platform.** <!-- lint:skip -->The suite never calls a platform conformant, compliant or certified<!-- /lint:skip -->, and `npm run lint:claims` fails on those words outside a quoted block ([docs/claims.md](../claims.md)). State a result with the claim template: platform, commit, surface, suite version, run, tier, channel, reach.
- **Percentages carry their denominators**, state that the specifications are draft, and keep each platform in its own rows.
- **No ranking.** Each row is one surface measured alone. Rows are not added together or put in a league table.
- **Keep the tone** factual and constructive towards the people who maintain the platforms measured. Describe behaviour, not people.
- **Public-safe.** No local paths, internal hostnames, credentials or private addresses in any tracked file.
- **One change per pull request**, with its generated files regenerated, tests added in the same change, and each commit signed off (`git commit -s`, the Developer Certificate of Origin).

Discuss ideas and questions in GitHub Discussions on this repository, and use an issue for a concrete problem ([CONTRIBUTING.md](../../CONTRIBUTING.md#where-to-discuss)). Everything stays a working draft until the task force says otherwise.
