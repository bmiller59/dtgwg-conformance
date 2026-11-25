# dtgwg-conformance

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. Nobody has accepted it on behalf of the DTGWG or any foundation. Contributing it to a neutral home is an intention, not something that has happened.

A neutral, Apache-2.0 test suite for [Trust Tasks](https://trusttasks.org): signed JSON documents that people and software exchange to run trust ceremonies, such as issuing a verifiable relationship credential. Every task specification it reads is **draft**. You are welcome to check it, run it against your own implementation and extend it.

**Jump to:** [the layer map](#the-layer-map) · [what it is](#in-one-minute) · [where we are](#where-we-are) · [quick start](#five-minute-quick-start) · [choose your path](#choose-your-path) · [what the results mean](#what-the-results-mean) · [get help](#get-help-and-report-something)

## The layer map

The suite is organised by the layers of the trust stack. Each band says what it is and names the vector groups that test it.

```text
LAYER 4  Trust application ................ Deferred
  4b  Applications
  4a  SDK and API
--------------------- suite scope starts ---------------------
LAYER 3  Trust task ....................... In scope
  3d  Ceremony families           groups: roll-up only
  3c  Individual ceremonies       groups: VRC-PRO, VRC-ISS, WSH, TD, CER
  3b-DTG  Core credential tasks   groups: TC, CEX
  3b  Core trust tasks            groups: ERR, NS, DIS, CTRL, RCPT
  3a  Individual trust tasks      groups: ENV, RSP, ID, LIF, PRF, TIME, DUP, AUTHZ, plain, emit
LAYER 2  Trust spanning ................... In scope
  2   TSP and carriers            groups: BND, 2PC, witness
--------------------- suite scope ends -----------------------
LAYER 1  Trust support .................... Relied on, not tested directly
  1   Identifiers and keys        no vectors
```

The suite's scope is layers 2 and 3. Layer 1 is relied on, not tested; layer 4 is deferred. The layer model and its 3a to 3d and 4a/4b bands were proposed by Brendan A. Miller on top of the standard Trust over IP model. The full layer model, with what belongs in each band, is in [docs/01-layer-model.md](docs/01-layer-model.md).

<details>
<summary>What each band is and what the suite checks here</summary>

| Band | What it is | Vector groups | What the suite checks here |
|---|---|---|---|
| 4b Applications | Applications built on those SDKs. | none | Not tested. |
| 4a SDK and API | Uniform application SDK and API functionality over layers 2 and 3, so applications need not each reimplement them. The suite's adapters drive a platform under test; they are not this SDK. | none | Not tested. |
| 3d Ceremony families | A named group of related ceremonies, tested and reported together. The family is the unit of the capability matrix. A family a platform does not offer is reported as not applicable, never as a failure. | roll-up only | No tests of its own. Results of the ceremonies below are reported per family. |
| 3c Individual ceremonies | A flow of several trust tasks between parties. The choreography: which tasks, between which roles, in what order, and what counts as completed. The first ceremonies are the relationship credential (VRC) exchange and witness-share. | VRC-PRO, VRC-ISS, WSH, TD, CER | That each ceremony's documents and short step sequences follow the specified order and bindings, one platform at a time. |
| 3b-DTG Core credential tasks | A proposed tier. `credential-exchange/*` and `task-consent/*`: shared by several ceremonies but specific to credentials and approvers, so not framework-reserved. | TC, CEX | That credential-exchange and task-consent documents follow their task specifications. |
| 3b Core trust tasks | The slugs the framework reserves for itself. Error replies, holds, discovery, control and the ceremony receipt. Any task can be refused with an error or held with a next step, so ceremonies never list these as steps. | ERR, NS, DIS, CTRL, RCPT | That error replies, held-task replies, discovery, refusals of control and ceremony receipts are formed and used as the framework states. |
| 3a Individual trust tasks | One signed document, and the rules every task shares. Type and version, id and thread, freshness, lifecycle states, duplicate handling on id, proofs, and who is allowed to perform a task. | ENV, RSP, ID, LIF, PRF, TIME, DUP, AUTHZ (plus the plain and emit families) | That a platform applies the rules every task shares: envelope, proofs, freshness, duplicates, lifecycle and identity binding. Two further families check single tasks and what a platform sends. |
| 2 TSP and carriers | Authenticated transport between parties. The suite is black box and does not speak TSP. Where a platform coordinates a ceremony with two-phase commit, that stays internal. | BND, 2PC, witness | Only what an outside observer can see: the HTTPS binding, and that a commit or abort shows as the right lifecycle state. TSP itself is not tested. |
| 1 Identifiers and keys | What proofs and identities stand on. Decentralized identifiers and their resolution, key material, and the logs and registries that say which key was valid when. | none | Not tested directly. Proofs are checked against the DID document each platform supplies. |

</details>

## In one minute

**It is:**

- **Test vectors.** Language-neutral JSON files in `vectors/`. Each says what to send, what a correct implementation must send back or do, and quotes the specification text it rests on.
- **Ceremony scenarios.** Whole ceremonies (several tasks between named roles, to a named end state) in `vectors/ceremony-scenarios/`. Their results are outcomes of ceremonies run together, not test verdicts.
- **Adapters.** The suite never looks inside an implementation. A small adapter per platform turns "send these bytes, tell me what came back" into that platform's own calls, speaking JSON-RPC (a simple request and reply format) over stdin and stdout, over HTTP, or as a loaded module.
- **A reference adapter and mutants.** The reference adapter is the suite's own stand-in implementation, written from the specifications. Mutants are copies of it with one deliberate bug, so each negative vector is shown to catch the fault it names.

**It is not:**

- **An adopted or endorsed standard**, or <!-- lint:skip -->a certification. The suite never calls a platform conformant, compliant or certified<!-- /lint:skip -->, and a test fails if its pages do.
- **A ranking.** Each result is one surface of one platform at one commit, measured alone. Rows are never added together or compared as a league table.
- **A verdict on the specifications.** Where the draft text is open, the suite records a question for the task force and does not assert an answer.

The order of authority is the specifications, then VTI, then keyring-wallet, then truststackers. The specification text wins over every implementation. The three platforms are described in [platforms.md](platforms.md): VTI is the Verifiable Trust Infrastructure services (OpenVTI), keyring-wallet is a mobile wallet, and truststackers is a peer-to-peer trust stack.

## Where we are

Snapshot of **2026-11-22**. Every task specification involved is **draft**. Each percentage is followed by its denominator in brackets. The recorded runs behind these figures are kept outside this repository; the figures and how they were taken are in [open-gaps.md](docs/community/open-gaps.md) and `docs/community/data/`.

**Results are dated snapshots.** Measured results are dated snapshots of recorded runs. They are published separately and are not part of this repository, which holds the suite (vectors, adapters, runner, method and design documents). A pointer will be added here when the results are published.

**Ceremonies: completion, never conformance.** 165 scenarios in 21 groups. A scenario is *completed* when one recorded run had VTI (OpenVTI) and the keyring-wallet both taking part and the ceremony ran to its specified end. This says nothing about whether either side agrees with the specifications.

**Same-ceremony completion, VTI (OpenVTI) and keyring-wallet both seated, original platforms: 66.7% [104/156].** The 156 are the scenarios in which each platform has code for some task. The platforms are as they were when measured: OpenVTI as of 4 November 2026 (commit 26d0da81a), which is on upstream main, and keyring-wallet 62af4d2d4 with bifold 7e14c5124 as of 7 November. Neither wallet commit is on upstream main: 62af4d2d4 is upstream main (2c01012de) plus a documentation commit and a dependency update, and 7e14c5124 is upstream bifold main (7447b1eeb) plus three fixes that upstream later merged in revised form (#974); both sit on upstream branches ([D853](docs/decisions/03-vectors-and-coverage.md#d853)). Those are 235, 174 and 191 commits behind current upstream main. A re-run on current main is in progress. Until it lands, read this figure as a floor for upstream today.

| Denominator | Original platforms |
|---|---|
| All scenarios | 63.0% [104/165] |
| Both platforms attempt the scenario | 66.7% [104/156] |
| VTI attempts the scenario | 66.2% [104/157] |
| keyring-wallet attempts the scenario | 64.2% [104/162] |

61 of the 165 scenarios (37.0% [61/165]) have no completed run on the original platforms. Why, class by class, is on [open-gaps.md](docs/community/open-gaps.md), and those are good places to start.

<details>
<summary>Caveats that apply to every ceremony figure here</summary>

- Reference-assisted results are included: 9 of the 104 had a reference (stand-in) party in a third seat. 43 of the 104 ran against VTI's live service containers, 3 over DIDComm wire and 58 with both platforms' code hosted in process by the suite. (DIDComm is a messaging protocol between agents.)
- 14 of the 156 cannot be run as a pair with today's adapter declarations (FC-VET 6, FC-TCA 3, FC-MAT 3, FC-CEX-001, FC-KVC-013).
- Role-level coverage (who held which seat) is the next step and is planned to become the headline.

</details>

**Vectors: covered is not passing.** The measure below is the suite's own coverage of 682 tasks (the latest version of each task that VTI serves or whose role the keyring-wallet source shows with code). It is not a result for any platform. These vectors are advisory; none is promoted to gating. How the set is built and measured is in [vector completeness](docs/37-vector-completeness.md).

| Covered (a vector exists) | Share of the 682 tasks |
|---|---|
| Any vector | 100.0% [682/682] |
| A positive vector | 99.9% [681/682] |
| A negative vector | 99.6% [679/682] |
| A positive that asserts the task's own success response | 55.6% [379/682] |
| Positives that pass on any non-envelope answer (weak only) | 44.3% [302/682] |
| A gating (`registry`) vector | 78.9% [538/682] |

*Passing* is a different number and is reported per surface, per run and per channel in the dated results pages, which are published separately. It is not restated here, because one figure would blend surfaces that must stay separate. Passing figures for the gating channel are not quoted yet: older vectors were corrected and the recorded results are being re-run.

## Five-minute quick start

You need Node.js 22.16 or later and git. Nothing else: no platform, container or network service. Every command below was run on a clean copy of this repository.

```sh
npm ci
nice -n 10 npm run suite -- --adapter reference --tier 1 --allow-effects reference-in-process --out results-local/quickstart
```

This runs the core vectors (Tier 1, the gating `registry` channel) against the reference adapter. `--allow-effects reference-in-process` says the adapter is a disposable stand-in, so vectors that change state may run; never name a real deployment this way. Expected output (the salt differs on every run; `results-local/` is git-ignored):

```
reference: adapter contract 0.1 (suite 0.1)
reference tier 1: {"PASS":271,"CLARIFY":68,"SKIP":3} (clock set, minimum quiet 0 ms (binding:in-process), salt 4345bfb09620)
  advisories: 0
  excluded by channel: proposed 19, candidate 32
  excluded by tier (not SKIP): 44 (tier 2 not selected)
  ...
```

The remaining lines are advisory spec-drift notes: they appear because no checkout of the Trust Tasks specifications was given (`--kit`). Now watch a vector catch a fault, using a mutant that accepts a document addressed to someone else (this run exits with code 1, because a gating vector failed, as intended):

```sh
nice -n 10 npm run suite -- --adapter mutant:noRecipientCheck --tier 1 --allow-effects reference-in-process --out results-local/mutant
```

```
reference+noRecipientCheck tier 1: {"PASS":264,"CLARIFY":68,"FAIL":7,"SKIP":3} (...)
  FAIL ERR-006:  step 1: expected a trust-task-error, got https://trusttasks.org/spec/conformance/widget/0.1#response; ...
  ... (six more FAIL lines)
```

Finally, one ceremony scenario with two reference parties:

```sh
nice -n 10 npm run ceremony -- --participant P=reference --participant R=reference-peer --scenario FC-VRC-001
```

```
FC-VRC-001	completed (completed)
These are outcomes of ceremonies run together, not conformance results: nothing here is counted.
```

Next: [getting started](docs/getting-started.md) explains each line of output, runs the same vectors through an out-of-process adapter (which is how a real platform is measured) and shows how to point the suite at a real platform.

## Choose your path

| I want to | Start here | Then |
|---|---|---|
| Run the suite against the stand-in or a real platform | [Getting started](docs/getting-started.md) | [CONTRIBUTING.md, recipe 1](CONTRIBUTING.md#1-run-the-suite-against-your-platform) (every adapter and its settings) |
| Connect a new platform (write an adapter) | [Add a platform](docs/add-a-platform.md) | [First issue 3](docs/maintainers/first-issues/03-contribute-a-platform-adapter.md) |
| Add or fix a test (a vector or a ceremony scenario) | [Add a test](docs/add-a-test.md) | [CONTRIBUTING.md, recipe 3](CONTRIBUTING.md#3-add-a-vector) |
| Review the suite against a specification I edit | [Review guide](docs/review-guide.md) | First issues [1](docs/maintainers/first-issues/01-review-the-suite-as-specification-editors.md), [2](docs/maintainers/first-issues/02-review-the-open-findings.md) and [4](docs/maintainers/first-issues/04-check-our-readings-of-the-specifications.md) |
| Report a wrong vector, a finding or a specification question | [Report something](#get-help-and-report-something) below | [Challenging a vector](docs/challenges.md) |
| Pick something to work on | [Open gaps](docs/community/open-gaps.md) | [How to contribute](docs/community/contributing.md) |

## What the results mean

A vector result is PASS (did what the vector requires), FAIL (did not, and nothing explains it yet), KNOWN-FAIL (a recorded, explained difference), CLARIFY (the specifications do not settle the point, so it never gates) or SKIP (not run, always with a reason; never a pass and never a failure). Only `registry` vectors gate; `pr`, `proposed` and `candidate` are advisory. Always read the reach (vectors run, out of those that apply) beside the verdicts. Ceremony scenarios report completion, never conformance. Details, with the files a run writes: [reading results](docs/reading-results.md); every term: [glossary](docs/03-glossary.md#status-codes-and-plain-words); what a result may be used to claim: [docs/claims.md](docs/claims.md).

## Get help and report something

- **Questions and ideas:** GitHub Discussions on this repository ([where to discuss](CONTRIBUTING.md#where-to-discuss)).
- **A vector looks wrong, or the specification text looks open:** an issue from the templates in `.github/ISSUE_TEMPLATE/` (a problem with a vector, a specification question, a new adapter, a new vector). To dispute a vector with evidence: [challenging a vector](docs/challenges.md).
- **A security problem:** privately, as [SECURITY.md](SECURITY.md) describes. Never in a public thread.
- **Conduct:** the [code of conduct](CODE_OF_CONDUCT.md) (Contributor Covenant 2.1); reports use the same private channel.
- **Who maintains the project:** [MAINTAINERS.md](MAINTAINERS.md), by role.
- **Contributing:** [how to contribute](docs/community/contributing.md) (the rules a contribution is read against) and [CONTRIBUTING.md](CONTRIBUTING.md) (the step-by-step recipes). Sign off every commit (`git commit -s`, the Developer Certificate of Origin).

Nothing is filed or sent from this repository on anyone's behalf.

## Folder overview

| Path | What it holds |
|---|---|
| `vectors/` | The test vectors (JSON, generated; never edit by hand). `vectors/ceremony-scenarios/` holds the ceremony scenarios; `vectors/imported/` holds task-force fixtures copied unchanged. |
| `vectors-src/`, `scripts/` | Hand-written generator inputs and the vector id ledger; the generators (`scripts/generate-*.ts`) and maintenance tools. |
| `schema/` | JSON Schema for the vector and scenario formats. |
| `src/adapters/` | The adapters: `reference/` (the stand-in and its mutants), `example-server/` (start here for a new adapter), `vti/`, `vti-inprocess/`, `vti-live/`, `vti-emit/`, `vti-ballot/`, `keyring-wallet/`, `keyring-wallet-didcomm/`, `keyring-wallet-vta-wire/` and `witness-server/`. |
| `src/` (the rest) | `src/adapter/` (the adapter contract), `src/runner/` (the runner, `npm run suite`), `src/ceremony/` (the ceremony runner, `npm run ceremony`), `src/vectors/` (loading and validating vectors), `src/carriers/`, `src/crypto/`, `src/util/`, `src/coverage/`, `src/glance/`, `src/traceability/`, `src/promotion/`, `src/tfalign/`, `src/crosscheck/`, `src/crossed/`, `src/governance/`, `src/plain/` ([repository layout](docs/repository-layout.md) says what each holds). |
| `test/` | The suite's own tests (`npm test`). |
| `exceptions/` | Recorded differences, each with a reason, an owner and an expiry date. |
| `results/` | Results tooling and review records; run records and dated results are kept outside the repository. |
| `docs/` | The reference ([index](docs/README.md)); [docs/community/](docs/community/index.md) is the way in for contributors. |

## Licence and credit

Apache-2.0 (see [LICENSE](LICENSE)). Copyright the Contributors to the Trust Tasks Conformance Suite project (see [NOTICE](NOTICE)). Specification attribution (Open Web Foundation Final Specification Agreement 1.0, section 2.2): parts of this repository are derived from the Trust Tasks specification (framework specification SPEC.md version 1.0 and the individual task specifications) of the task-force repository [trustoverip/dtgwg-trust-tasks-tf](https://github.com/trustoverip/dtgwg-trust-tasks-tf), commit `98dda36f854ba028205923866450dbc1753c3bf6` (2026-11-24). That specification is published under the Open Web Foundation Final Specification Agreement 1.0 (copyright and patent grants); that repository's own source code is under Apache-2.0. The derived material is `vectors/imported/`, `vectors-src/alignment/tf-snapshot.json`, `vectors-src/coverage/tf-invalid-examples.json`, `vectors-src/coverage/task-census.tsv` and the vectors and result pages generated from them; the full list and checksums are in [NOTICE](NOTICE) and `vectors/imported/PROVENANCE.json`. Credits, including the source of the interoperability vocabulary, are in [docs/CREDITS.md](docs/CREDITS.md).
