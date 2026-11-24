# Documentation index

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

Every document here is a draft and describes the current design and state. Decisions are recorded in the document they affect; the change history is the git log. The process (running, recording, adding vectors) is in [CONTRIBUTING.md](../CONTRIBUTING.md). Terms are in the [glossary](03-glossary.md).

## Reading paths

There is no need to read everything. Start from what you want to know:

| If you want to know | Read |
|---|---|
| How to install and run it, step by step | [getting-started](getting-started.md), then [reading-results](reading-results.md) |
| How to add a platform, a vector or a ceremony scenario | [add-a-platform](add-a-platform.md), [add-a-test](add-a-test.md) |
| How to review the vectors against a specification | [review-guide](review-guide.md) |
| What each folder holds | [repository-layout](repository-layout.md) |
| What the suite tests and what is advisory | [01 layer model](01-layer-model.md) (sections 1 to 3), [02 core criteria](02-core-trust-task-criteria.md), [04](04-suite-design.md) sections 2, 8, 10 and 18 |
| What results may claim about interoperability | [14](14-interoperability-tracking.md), then [12](12-interoperability-interworking-meta-layer.md) part 2 |
| How to write an adapter | [add-a-platform](add-a-platform.md), [04 section 4](04-suite-design.md#4-adapter-contract-built-typescript-types-client-and-example-server), then [CONTRIBUTING](../CONTRIBUTING.md) |
| A specific platform | results/platforms/ (one page per platform); background [05](05-reference-implementations.md) (VTI, keyring-wallet) and [06](06-truststackers-conformance-plan.md) (truststackers) |
| Why something was decided | [decisions](decisions/README.md) (by topic), then [21](21-vector-group-rationale.md) for a vector group and [06 section 12](06-truststackers-conformance-plan.md#12-design-rationale-and-alternatives-rejected) for the truststackers plan |
| How results and vector ids are cited, versioned and retired | [04 section 20](04-suite-design.md#20-releases-run-provenance-and-vector-ids-built) (run.json, semver, test-id policy), [CHANGELOG](../CHANGELOG.md) |
| How to dispute a vector | [challenges.md](challenges.md) (the challenge process, owner acknowledgement of an exception) |
| What a platform may claim from a run | [claims.md](claims.md) (the claim template, the words not used, the lint) |
| Where each platform stands now | STATUS.md and AT-A-GLANCE |
| How the suite lines up with the Trust Tasks repository (unused examples, stale snapshot) | [tf-alignment](tf-alignment.md) |
| How a platform's figures are built (suites attempted, completeness, conformance) | [34](34-suite-attempts.md) |

## Concepts

| Document | Purpose |
|---|---|
| [01-layer-model.md](01-layer-model.md) | The layer model (layer 2 and layers 3a to 3d, with 4a/4b deferred), what belongs in each, how layers interact, and how they map to vectors, tiers and the capability matrix. |
| [02-core-trust-task-criteria.md](02-core-trust-task-criteria.md) | The decision rule for what is a core trust task (3b), a DTG-core task (3b-DTG), family-level or ceremony-level; worked examples; graduation and versioning. |
| [03-glossary.md](03-glossary.md) | Definitions of the terms used, and the status-code to plain-word table. |

## Design

| Document | Purpose |
|---|---|
| [04-suite-design.md](04-suite-design.md) | Purpose, vector format, adapter contract, runner, provisioning, clock, gating and known failures, tiers, vector groups with spec traceability, 2PC-to-lifecycle mapping, negative categories, channels and spec-drift. Has a table of contents. |
| [10-witness-share-profile.md](10-witness-share-profile.md) | The `vrc/relationships/witness-share` suite-local profile specification and its vectors. |
| [11-build-state.md](11-build-state.md) | Inventory of what is built and what is not: parts, where they live, and their state. |
| [13-didcomm-carrier-and-witness-server.md](13-didcomm-carrier-and-witness-server.md) | The DIDComm carrier and the black-box witness-server adapter. |
| [17-governance-probes.md](17-governance-probes.md) | Governance probes (advisory): what an implementation declares about roles and authority, and the probes run against it. |
| [19-vti-emit-and-2l-vectors.md](19-vti-emit-and-2l-vectors.md) | The VTI emit adapter (VTI's own request builders) and the second-layer (2L) vectors. |
| [34-suite-attempts.md](34-suite-attempts.md) | How results are reported per platform: which suites it attempts (from code evidence), completeness and conformance per suite, the three bands, and the scope-relative headline figure. |
| [20-observing-pushed-documents.md](20-observing-pushed-documents.md) | The optional `observe.pushed` capability: how a vector observes the next task an implementation pushes to the counterparty. |
| [21-vector-group-rationale.md](21-vector-group-rationale.md) | Why each vector group, tier placement and contract member is built as it is, with the alternatives rejected. |
| [22-coverage-families.md](22-coverage-families.md) | The coverage families: vectors for every trust task type keyring-wallet and VTI use, in eight families, advisory and outside the headline counts. |
| [25-ceremony-scenarios.md](25-ceremony-scenarios.md) | Ceremony scenarios (`tt-ceremony-scenarios/0.1`): the separate runner, the contract members `initiate`, `connect` and the `received` and `ceremony` observe queries, and the reference-only dry run. What it shows and does not show; never a conformance count. |
| [26-paired-ceremonies.md](26-paired-ceremonies.md) | Paired ceremonies between a member's wallet and the community or agent service: access-list, device, vault, step-up and sign-in groups, the stand-ins and what each run shows. |
| [27-kw-vti-ceremonies.md](27-kw-vti-ceremonies.md) | The KW-to-VTI ceremony set (task-consent, credential exchange): scenarios, stand-ins, version skew, what is not built and why. Channel proposed, non-gating. |
| [28-gap-families.md](28-gap-families.md) | (Latest-version reach against VTI main, decision D245.) The gap families (`vectors/gap`): every task version that no other vector set referenced (vta, vtc, rooms, did-management, git-ns, messaging, then the 21 remaining families, so every version of the task-force repository has a vector); how they are derived from the task-force specifications, what is not generated (class C notes) and the platform reach. |
| [29-witness-tasks.md](29-witness-tasks.md) | The WIT vector group for `witness/session` and `witness/session/submit`, the reference oracle, the keyring-wallet witness-server host and what it does and does not measure (the DIDComm-carried WSD and WSS groups are in doc 13). |
| [30-onboarding-vetting-ceremonies.md](30-onboarding-vetting-ceremonies.md) | Onboarding (FC-MBR) and identity-vetting (FC-IDV) ceremonies between a wallet and a community: the scenarios, the retired submit 0.1 step, the reference oracle and its mutants, the rows, the differences by class. Advisory; never a conformance count. |
| [31-persona-rooms-elections-ceremonies.md](31-persona-rooms-elections-ceremonies.md) | Persona (FC-PER), directory (FC-DIR) and elections-reads (FC-VOT) ceremonies between a phone and VTI's agent or community: which pairs exist in code (the persona, directory and elections groups; rooms and the ballot cast are in doc 32), the scenarios, the reference oracles and their mutants, the rows, the differences by class. Advisory; never a conformance count. |
| [32-rooms-ballot-ceremonies.md](32-rooms-ballot-ceremonies.md) | Rooms (FC-RMS, 18 scenarios) and ballot cast (FC-BAL, 14) ceremonies between a phone and VTI's community, agent and ballot box: whether the wallet sends the cast, what was configured for rooms, the scenarios, oracles and mutants, the rows, the differences by class, the resource-gated rows. Advisory; never a conformance count. |
| [33-registry-promotion.md](33-registry-promotion.md) | Registry promotion: the process, the pre-screen and review tools, the provisional single-implementer rule (D353), the batch B1, B2 and B2b records, and the gating runs. |
| [35-live-vti-rows.md](35-live-vti-rows.md) | The ceremony scenarios and the core run against VTI's service containers: one stack, the stand-ins the control layer holds, the outcomes by row, the classes of what did not complete (wallet refusals, FC-MBR-007, CEX-031). Advisory; never a conformance count. |
| [36-didcomm-wire-rows.md](36-didcomm-wire-rows.md) | Wire rows: ceremonies over a real DIDComm v2 wire (adapter, stand-ins, what is not carried). |
| results/coverage.md | Generated page: types, vectors and recorded runs of the coverage families at version grain, beside the task-grain figure. |
| [tf-alignment.md](tf-alignment.md) | Task-force alignment: what the suite takes from the Trust Tasks repository, how each item is matched to a vector, how to re-run `npm run tf-alignment`, the advisory alignment set, and what is not used. |
| [23-spec-drift.md](23-spec-drift.md) | Spec drift: the hashes of the cited Trust Tasks text and schema, the on-demand check, the SPEC-CHANGED state and re-pinning. |
| [24-candidate-task-notes.md](24-candidate-task-notes.md) | The local text behind the candidate coverage vectors: the platform's own source quoted for the used task types that have no Trust Tasks specification (decision CV-6). |

## Platforms background

| Document | Purpose |
|---|---|
| [05-reference-implementations.md](05-reference-implementations.md) | VTI and keyring-wallet as the models to emulate: model behaviour, caveats and measured differences, cross-implementation gotchas, measurement setup and findings outside the vector results. Best-effort, with confidence marks and commit provenance. |
| [06-truststackers-conformance-plan.md](06-truststackers-conformance-plan.md) | Plan for a truststackers conformance adapter: architecture, attestation design, gap table, phases, risks, gates. |
| [15-keyring-wallet-didcomm-v2.md](15-keyring-wallet-didcomm-v2.md) | The keyring-wallet developer option for DIDComm v2 and what it could unlock for the harness. |
| [18-keyring-wallet-over-didcomm.md](18-keyring-wallet-over-didcomm.md) | The keyring-wallet adapter over real DIDComm (Credo agent): design, the stand-in versus DIDComm comparison, findings, experimental DIDComm v2. |

Documents 05 and 06 describe named implementations from a reading of their source code and should be reviewed by the respective maintainers before being shared beyond this project.

## Interoperability

| Document | Purpose |
|---|---|
| [14-interoperability-tracking.md](14-interoperability-tracking.md) | Conformance-implied versus demonstrated interoperability, the wording rules, the ledger format. Data: [../results/interop/](../results/interop/). |
| [12-interoperability-interworking-meta-layer.md](12-interoperability-interworking-meta-layer.md) | Summary of a working-draft deck separating interoperability, interworking and meta-layer roles (credited in [CREDITS.md](CREDITS.md)); how the suite uses the words, platform by platform. |

## Proposals (all DRAFT, none filed or sent)

| Document | Purpose |
|---|---|
| [proposals/2l-profiles-draft.md](proposals/2l-profiles-draft.md) | The structure of the proposed 2L profiles and the decisions on it. |
| [proposals/acl-understanding-pairing.md](proposals/acl-understanding-pairing.md) | Pairing the ACL task with governance declared through the understanding family. |
| [proposals/governance-baked-in-audit.md](proposals/governance-baked-in-audit.md) | Where governance is fixed inside implementations, as neutral evidence. |
| [proposals/tf-question-list.md](proposals/tf-question-list.md) | Copy-ready questions for the task force. DRAFT, NOT FILED. |
| [proposals/upstream-harness-asks.md](proposals/upstream-harness-asks.md) | Asks of the upstream test harness. DRAFT, NOT SENT. |
| [09-draft-questions-for-task-force.md](09-draft-questions-for-task-force.md) | Unsent drafts: two task-force questions and a scope note. Not sent. |

## Generated pages

These are generated from the recorded run folders by `npm run regen`; do not edit them by hand (`npm run check:docs` fails when one is stale).

| Page | What it is |
|---|---|
| ../STATUS.md | One screen: where each measured surface stands, and what waits on the project owner. |
| ../results/AT-A-GLANCE.md, ../results/at-a-glance.html | The plain-language view, as Markdown and as one self-contained HTML file. |
| ../results/platforms/ | One page per platform (a short hand header plus a generated block). |
| `<results dir>/runs/INDEX.md` | Which run folders are current, and which are superseded. |
| [../results/interop/](../results/interop/) | The conformance-implied pair matrix and the ledger view. |

Their hand-written inputs, which hold no numbers: [../results/at-a-glance.config.json](../results/at-a-glance.config.json) (which run folders belong to which surface, plain descriptions) and [../results/skip-classes.json](../results/skip-classes.json) (the class of each SKIP reason; reasons no rule covers are shown as unclassified).

## Decisions

| Document | Purpose |
|---|---|
| [decisions](decisions/README.md) | The design-rationale register: the project rules by topic (governance, authority order, channels, tiers, SKIP classes, exceptions, bindings, interop wording, truststackers, 2L), with the roadmap decisions RD1 to RD7. |
| [open-decisions-from-reviews.md](open-decisions-from-reviews.md) | Review items that need a decision by the project owner. |
| [claims.md](claims.md) | The conformance-claims template: what a platform may say about a run (suite version, run folder, vector ids), the status words not used, and the lint that enforces it. |
| [challenges.md](challenges.md) | How an implementer challenges a vector: grounds, evidence, what results show while it is open, outcomes; owner acknowledgement of an exception. |
| [37-vector-completeness.md](37-vector-completeness.md) | The completion vectors (`vectors/complete`): positive vectors for the latest version of each task VTI serves or the wallet has a role for, the completeness measure and its limits. |
| [community/index.md](community/index.md) | The way in for contributors: how to contribute, the open gaps (generated), where everything sits. |
| [16-roadmap-and-decisions.md](16-roadmap-and-decisions.md) | The roadmap: what is done and what remains, with the roadmap decisions. |
| [maintainers/first-push-checklist.md](maintainers/first-push-checklist.md) | For maintainers: the order in which the suite is first put on a public host. |
| [maintainers/checklist.md](maintainers/checklist.md) | For maintainers: checks before a finding, a figure or a statement about a platform is drafted or published. |
| [07-status-and-open-questions.md](07-status-and-open-questions.md) | Settled, proposed or assumed, and open items. |
| [CREDITS.md](CREDITS.md) | Credits. |

Back to the [repository README](../README.md).
