# Glossary

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

Terms are used as defined by the cited specification where one exists. Entries that are this project's own are marked (project). Identifiers (the channels `registry`, `pr`, `proposed`, `candidate`; `2L` in paths, profile tags and ids; the `--kit` option) are kept as they are in the vectors and the command line. Prose says "AP, application profiles" and "TF checkout" (what `--kit` names). Renaming the identifiers themselves is an [open decision for the project owner](open-decisions-from-reviews.md).

## Status codes and plain words

The run folders and the README use the codes. AT-A-GLANCE and the platform pages use plain words. They mean the same thing:

| Code | Plain words used on other pages | Meaning |
|---|---|---|
| PASS | agrees, pass | The implementation did what the vector expects. |
| CLARIFY | unclear, unsettled in the specifications, agrees with open points | The vector rests on a point the specifications do not settle. Reported with its reason; never gates. Each CLARIFY vector has a class (`spec-silent`, `spec-inconsistent`, `vector-overreads`, or `unclassified`), an age and a slot for task-force question ids ([docs/04 section 18.10](04-suite-design.md#1810-clarify-classes-age-and-task-force-questions)). |
| KNOWN-FAIL | differs, known difference, recorded difference, recorded deviation | A looked-at difference, recorded in `exceptions/` with a class, an owner and an expiry date. |
| FAIL | unexplained, needs a look | An unexplained difference. A FAIL on a gating vector fails the run. |
| SKIP | not tested, not run | The vector was not run. Each SKIP is classified: not applicable, not reached, or different version (also written "version mismatch" or "other version"). |

A SKIP is never a failure and never a pass. Only "not reached" counts against reach.

## Terms

**AP, application profiles (project).** The suite's proposed layer of common application profiles (2L-1 to 2L-5; the identifiers use `2L`: `vectors/2l`, `profile: "2L"`, ids `TL-*` and `TE-*`), inside layer 3, over tasks that exist in the Trust Tasks registry ([docs/19](19-vti-emit-and-2l-vectors.md#2l-vectors)). Its vectors are channel `proposed`, so advisory. "2L" is not "L2": L2 is the carrier layer (HTTPS, DIDComm, TSP) of the [layer model](01-layer-model.md).

**2PC (two-phase commit).** A coordination pattern in which participants first vote on a proposed outcome and then all commit or all abort. Some implementations run ceremonies this way over TSP; in this model that machinery is layer 2, internal to the implementation.

**Adapter (project).** A small program or module per implementation under test that lets the harness send bytes, receive replies and observe state without knowing the implementation's internals. It speaks JSON-RPC over stdio or HTTP, or is loaded in process as a module ([docs/04 section 4](04-suite-design.md#4-adapter-contract-built-typescript-types-client-and-example-server)).

**Advisory (project).** A result that is reported but never gates a run and never appears in a headline total: every `pr`, `proposed` and `candidate` vector, every CLARIFY, and spec-drift findings. Advisory channel results are written to the sibling folder `<out>-advisory`.

**Anchor (project).** An implementation the suite measures other implementations against when the specifications are silent: VTI first, then keyring-wallet. See *authority order*.

**Applicable (project).** A vector applies to a surface unless it is classified *not applicable* there. Reach is counted out of the applicable vectors.

**Attested profile (project, proposed).** The stricter profile in Tier 2: a proof on every request, response and error, pinned proof purposes, recipient binding, matching issuer, signer and sender, task digests and outcome evidence. It is built in the suite and is not part of any published specification.

**Authority order (project).** The order in which sources are trusted when they disagree: the specifications, then VTI, then keyring-wallet, then truststackers. Where an authoritative implementation differs from a vector, the vector and the text are re-examined first.

**Authority set (project).** The principals who may decide a held task on a platform: part of its *essential governance*. The adapter declares it as the entries of `principals` whose role is `consent.approverSet` in `capabilities.governance.essential` ([docs/04 section 19.1](04-suite-design.md#191-essential-governance-e-capabilitiesgovernanceessential)). The suite never asserts who should be in it.

**Boundary adapter (project).** The component of an implementation that carries ceremony documents (layers 3a to 3d) over a Trust Tasks binding such as HTTPS in front of that implementation's own internal machinery.

**Project owner.** The repository maintainer, who makes the project decisions recorded in [decisions](decisions/README.md).

**Candidate (project; channel).** Behaviour with no home in the Trust Tasks repository yet, implemented by one or a few platforms. Advisory and not an endorsement. Not to be confused with the registry maturity status "candidate", which no Trust Tasks specification has today. See *channel*.

**Capability matrix (project).** The table the runner writes for each run (`conformance-matrix.md` and `.json`): per vector group and adapter, the statuses. It is the reporting unit of the suite.

**Carried protocol / protocol family.** Terms of the framework for a protocol whose messages a Trust Task carries, and for a group of related task specifications.

**Ceremony (trust ceremony).** "A flow composed of several Trust Tasks, optionally described by a published ceremony definition" (framework definition).

**Ceremony definition.** A published description of a ceremony's steps; examples in the registry's `ceremonies/` directory are `mutual-attestation`, `vetting/identity-vetting` and `vtc/member-onboarding`.

**Ceremony family / suite (project, layer 3d).** A grouping of related ceremonies that are tested and reported together.

**Channel (project).** Where a vector's expectation comes from ([docs/04 section 18.2](04-suite-design.md#182-channels)). `registry`: cites a Trust Tasks repository artifact (registry specifications are themselves drafts, so "registry" says where the text lives, not that it is ratified) and gates. `pr`: cites an open TF pull request; advisory. `proposed`: a suite-defined profile over TF text (2L, and `ceremony-design`, the suite's own ceremony and two-phase design); advisory. `candidate`: behaviour with no TF home yet; advisory, not an endorsement.

**Class A to D (project).** The class of a recorded difference ([results/vector-review.md](../results/vector-review.md#classes)). A: the implementation differs from the specification text. B: the vector reads more than the text says. C: the text is itself open or inconsistent. D: an artefact of the adapter or the stand-in carrier.

**Conformance-implied (project).** Agreement inferred because two implementations each pass the same vectors on their own. It suggests they would interoperate on that behaviour; it does not show that they did ([docs/14](14-interoperability-tracking.md#1-two-kinds-of-evidence)). AT-A-GLANCE's "conformance measured" means the same. Compare *demonstrated*.

**Consequential trust task.** A task whose `sideEffects.level` is `mutating` or `destructive`, or that discloses a secret or acts as the subject; absent or unresolvable declarations are treated as consequential (framework definition).

**Consumer / producer.** The party that receives and acts on a trust task document and the party that sends it (framework definitions).

**Core trust task.** In this project, a task in layer 3b: a framework-reserved slug every implementation claiming 3b must support (or must support if it claims the optional capability). See [02-core-trust-task-criteria.md](02-core-trust-task-criteria.md).

**Declaration mismatch, GOV-DECLARATION-MISMATCH (project).** The result of the *honesty check* when the platform does not behave as its adapter's declared *essential governance* says: it completes a held task earlier or later than the declared k, or counts a principal outside the *authority set*. Every result that rests on the declaration becomes FAIL and the run's exit code is non-zero. The only governance finding that gates; it rules on the declaration, not on the platform's governance ([docs/17 section 2.1](17-governance-probes.md#21-essential-governance-e-extended-governance-x-and-the-one-gating-kind)).

**Demonstrated (project).** Interoperation shown by a recorded exchange between two independent implementations, entered in the ledger ([docs/14 section 4](14-interoperability-tracking.md#4-the-ledger-of-demonstrated-executions)). None is recorded today.

**Different version (project; SKIP class).** The platform offers the task, at a different version from the one the vector needs. Also written "version mismatch".

**DTG.** The credential model defined by the DTG credential specification, including the DTG Core Credentials (VRC, VMC, VWC and others).

**Emit / producer class (project).** Vectors (families `emit` and `emit-more`) that ask an implementation to build and send a document through its own code, and check what it sent ([docs/04 section 11.8](04-suite-design.md#118-producer-emit-class-family-emit-groups-em-acl-em-pol-em-vlt-em-dev-em-aut-em-key-em-psh-layer-3a-not-core)). Not core.

**Enactment.** One run of a ceremony (framework term).

**Essential governance, E (project).** The part of a platform's governance that gates: its *authority set* and `minApprovals` (k, at least 1) for a held task. Declared by the adapter (`source`: platform configuration, configured by the harness for the run, a fixed built-in rule reported as GOV-FIXED, or unreadable, reported as GOV-NOT-PROBED), recorded in run.json and never asserted by the suite. The ceremony vectors run relative to it ([decision 39](decisions/04-ceremonies-governance-and-exceptions.md#d39); [docs/02 section 5.1](02-core-trust-task-criteria.md#51-standing-principle-the-suite-never-determines-governance)).

**Extended governance, X (project).** Every part of governance other than *essential governance*: role names and hierarchy, delegation, step-up policy, `sealBeforeGrant`, `termsRef`, the source of authority, provisioning and policy content. Reported only by the advisory governance probes, never gating ([docs/17](17-governance-probes.md)).

**Family (task family).** A group of task slugs sharing a first path segment and shared schemas, for example `credential-exchange/*`. The suite also groups its vectors into families (core, plain, emit, emit-more, witness, 2L), each in its own folder under `vectors/`.

**Framework.** The Trust Tasks framework specification: the envelope, lifecycle, errors, proofs and processing rules that every task document follows.

**Gating (project).** A result that can fail a run and counts in headline totals. Only `registry` vectors gate.

**Excluded from run (project).** A vector removed from every run (`excludedFromRun`): never run, counted or reported as SKIP, but listed so it stays visible. Set automatically when the vector cites a retired TF specification ([docs/04 section 18.7](04-suite-design.md#187-tfref-excludedfromrun-and-the-resolver)).

**Honesty check (project).** The harness's own probe, run in every suite run before any vector and not selectable by the adapter, that checks a platform's behaviour against the *essential governance* its adapter declares: completion exactly at the k-th distinct approval, and an approval from a principal outside the *authority set* not counted. Results: consistent, *declaration mismatch*, not probed (E unreadable) or not run (no ceremony offered) ([docs/04 section 11.4](04-suite-design.md#114-ceremony-documents-cer-2pc-003-to-2pc-005-time-103)).

**IUT (implementation under test).** The implementation a harness run is checking.

**Kit (project).** In `--kit`, `TT_KIT` and `kit:` references: the local checkout of the Trust Tasks task-force repository (the "TF checkout"). The VTI buildathon starter kit is a different thing.

**Mutant (project).** A deliberately broken variant of the reference adapter that violates one rule (`src/adapters/reference/mutants.ts`). Each negative vector names the mutants it must catch.

**Non-vacuity (project).** The check that every negative vector fails the mutants it names, so a vector cannot pass merely because an implementation refuses everything ([docs/04 section 9](04-suite-design.md#9-non-vacuity-built)).

**Not applicable (project; SKIP class).** The platform does not offer the task or feature, so the vector does not apply. It needs checked evidence from the platform: a file and line at a named commit, or the adapter's `notOffered` entry with that citation. "The adapter lacks it" is never evidence. Not a reach gap.

**Not reached (project; SKIP class).** The platform may well offer it, but the suite's test setup cannot drive it yet: a limit of the suite, not of the platform. Every SKIP without checked evidence for another class is not reached. It is the only SKIP class that counts against reach. AT-A-GLANCE writes "not reached yet".

**Oracle (project).** The suite's reference adapter, which implements the expected behaviour. Used as the suite's self-check; never a platform. The two names are synonyms.

**Out of tier (project).** A stricter-tier (Tier 2) vector outside the headline tier. Not counted at all in the headline reach.

**Outcome evidence.** Evidence, defined by a task specification and carried in a signed response, that a stated outcome occurred; credentials may cite it.

**Plain-task probe (project).** Vectors (family `plain`) that send one plain trust task document of a registry task and check the reply against the pinned package's schema and policy ([docs/04 section 11.7](04-suite-design.md#117-plain-tasks-family-plain-groups-pp-acl-pp-pol-pp-vlt-pp-dev-pp-aut-layer-3a-proposed-2l-1-and-2l-2-not-core)). Layer 3a, not core.

**Profile (project).** A named set of stricter or grouped rules over existing tasks: the attested profile (Tier 2) and the 2L application profiles. "Proposed" is also a design status in docs/04 and docs/07, and the name of a channel; the context says which.

**Proof.** A signature member on a trust task document that binds it to the signer's identifier and a proof purpose.

**QUARANTINED (project; result).** The result of a flaky vector while its entry in `exceptions/quarantine.json` is current: the vector ran and the observed outcome is in the reason, but the result is advisory, in no count and never in the exit code. An expired entry makes the result FAIL ([docs/04 section 18.9](04-suite-design.md#189-promotion-criteria-and-flaky-vectors-quarantine)).

**SPEC-CHANGED (project; result).** The result of a vector flagged by the spec-drift check: the spec moved; this test has not been re-checked. The vector ran and the observed outcome is in the reason, but the result is advisory, in no count and never in the exit code, and never a pass or a difference until a reviewer re-pins it ([docs/23](23-spec-drift.md)).

**Reach (project).** Vectors that actually ran against a surface, out of the vectors that apply to it (all vectors minus "not applicable"). A SKIP never counts toward reach.

**Reference adapter (project).** See *oracle*.

**Retired (project; vector id).** A vector id that is no longer run: the vector stays in its file as a tombstone (`retired: {reason, since}`), is never run, counted or reported as SKIP, and its id is never reused. Not the same as *excluded from run* ([docs/04 section 20.3](04-suite-design.md#203-vector-ids-never-reused-retired-rather-than-deleted-cited-with-the-version)).

**Registry (project; channel).** The gating channel: the vector cites a Trust Tasks repository artifact. Every registry specification is status draft. See *channel*.

**Single-party (project).** The label for a platform whose declared *authority set* has one member: one principal decides a held task alone. Shown at a glance; vectors that need a second approver are SKIP "authority set of one". A description, not a finding.

**Slug.** The name of a trust task specification in the registry, for example `trust-task-error` or `vrc/relationships/issue`.

**Spec-drift (project).** An advisory finding that the cited specification text has changed since the vector was pinned, or is not available locally ([docs/04 section 18.5](04-suite-design.md#185-drift-detection-and-refreshing-pins)).

**Stand-in carrier / shim (project).** A suite-side carrier that delivers documents to keyring-wallet's own logic without its real transport. Written "stand-in carrier (shim)" at first use, then "stand-in". It measures the wallet's logic, never wire interoperation.

**Sub-group (project).** A named set of Tier 2 vectors run for every adapter, beside the attested profile ([docs/04 section 3.1](04-suite-design.md#31-tier-and-sub-group-fields)).

**Surface (project).** One way a platform is measured, for example VTI agent service in process, or VTI community service live over HTTPS. Surfaces of one platform are never added together.

**Task digest.** A digest of a task document, used to bind a later response or credential to the exact request it concerns.

**tfRef (project).** A vector's citation of a Trust Tasks repository artifact: its path, the TF commit it was resolved at and its status. Required for every non-candidate vector ([docs/04 section 18.7](04-suite-design.md#187-tfref-excludedfromrun-and-the-resolver)).

**Tier (project).** A strictness level of the suite. Tier 1 is the framework's own requirements and nothing stricter. Tier 2 holds stricter behaviour: the attested profile and the named sub-groups.

**Trust task.** "A unit of verifiable work between two parties, formally defined by a Trust Task specification and exchanged as Trust Task documents" (framework definition).

**Trust task document.** A single JSON object carrying `type`, `id`, `payload` and optional integrity and routing members, validated against the framework schema and the task's payload schema.

**TSP (Trust Spanning Protocol).** The Trust over IP authenticated-messaging protocol; the registry has a `tsp` transport binding (version 0.1, draft) that carries trust task documents inside TSP messages.

**Vector (project).** One JSON test case: documents to send, clock and signing instructions, and the expected disposition, payload assertions and observable state.

**VMC.** Verifiable membership credential, a DTG credential issued to a community member.

**VRC.** Verifiable relationship credential: a DTG edge credential representing one half of a bidirectional peer-to-peer trust relationship (DTG credential specification).

**VTA / VTC.** Verifiable Trust Agent (key, credential and authority root for a principal) and Verifiable Trust Community (a community authority for admission, membership and recognition), as defined in the VTI specification.

**VTI.** Verifiable Trust Infrastructure: a specification of node operations built on trust tasks.

**VWC.** Verifiable witness credential: a credential by which a third party asserts it observed a DTG edge, such as a VRC, being formed.
