# Layer model

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This document describes how this project divides the stack it intends to test. Section 8 lists what is settled and what is proposed or assumed.

## 1. Purpose

Trust ceremonies are built from several kinds of thing that are easy to conflate: a transport, a signed document, a small set of framework-reserved documents, a particular multi-party flow, and a group of such flows. A conformance suite has to say which of these a given vector tests, who is responsible when it fails, and how results are reported. The layer model gives each a name and a place.

The numbering follows the Trust over IP stack: layer 1 is identifiers and keys, layer 2 is the authenticated transport, layer 3 is trust tasks and ceremonies, layer 4 is applications. The division of layers 3 and 4 into 3a to 3d and 4a/4b was proposed by Brendan A. Miller as an addition on that model. **This repository's scope is layers 2 and 3.** Layer 1 (identifiers and keys) is relied on and is outside the suite's scope; layer 4 is deferred.

## 2. Diagram

```
 LAYER 4  Trust application                                       (deferred)
 4b  Applications                   built on those SDKs
 4a  SDK and API                    uniform application functionality over
                                    layers 2 and 3
 ----------------------------------------------------------------------
                          suite scope starts
 ----------------------------------------------------------------------
 LAYER 3  Trust task
 AP  Application profiles             inside layer 3: the suite's proposed common
                                    profiles over tasks (glossary; docs/19)
 3d  Ceremony families              grouping; unit of the capability matrix
 3c  Individual ceremonies          e.g. VRC issue, witness-share, vetting
 3b-DTG  Core credential tasks      (proposed tier) credential-exchange/*,
                                    task-consent/*
 3b  Core trust tasks               framework-reserved slugs
 3a  Individual trust tasks         signed documents: envelope, lifecycle,
                                    proofs, dedupe
 LAYER 2  Trust spanning
 2   TSP and carriers               authenticated transport (and 2PC-style
                                    coordination some implementations ride on it)
 ----------------------------------------------------------------------
                          suite scope ends
 ----------------------------------------------------------------------
 LAYER 1  Trust support
 1   Identifiers and keys           relied on, not tested: DIDs and their
                                    resolution, key material, key logs
```

Documents of layers 3a to 3d travel over a Trust Tasks transport binding (HTTPS, DIDComm, TSP and others exist in the registry). Where an implementation runs a ceremony internally over TSP with two-phase-commit style coordination, a **boundary adapter** translates between that internal machinery (layer 2) and the ceremony's documents (3a to 3d). The 2PC machinery is not visible on the wire the suite sees.

## 3. The layers

### Layer 1: identifiers and keys (outside the suite's scope)

**What it is.** What proofs and identities stand on: decentralized identifiers and their resolution, key material, and the logs and registries that say which key was valid when.

**What the suite checks here.** Not tested directly. Proofs are checked against the DID document each platform supplies.

**Suite stance.** Layer 1 is relied on and is outside this suite's scope. No vector tests it directly; it is covered only indirectly, because proofs (group PRF) and identity binding (group ID) are checked against the DID document each platform supplies.

### Layer 2: TSP and carriers

**What it is.** The Trust Spanning Protocol: authenticated message transport between parties identified by VIDs. The Trust Tasks registry has a `tsp` binding (0.1, draft) that maps the authenticated sender VID to the framework's transport-authenticated party identity. Some implementations also run multi-party coordination on top of TSP, in a two-phase-commit style: participants vote, then the coordinator commits or aborts.

**What the suite checks here.** Only what an outside observer can see: the HTTPS binding, and that a commit or abort shows as the right lifecycle state. TSP itself is not tested.

**Belongs here.** Message framing, sender authentication, routing and nesting, delivery between VIDs, and, where an implementation uses it, the prepare/commit/abort coordination of a multi-party ceremony.

**Does not belong here.** Anything that must be visible and checkable as a signed document: document ids, thread ids, proofs, error codes, lifecycle states. A transport fact must not be silently equated with a framework state (an HTTP 202 is not `accepted`; a closed connection is not `cancelled`).

**Suite stance.** The suite is black box and carrier-neutral. It does not speak TSP and does not test 2PC internals. It tests the observable consequences: that the outcome of the coordination maps onto the framework lifecycle correctly (section 6).

### Layer 3a: individual trust tasks

**What it is.** A single trust task document: one JSON object with `type`, `id`, `payload` and optional members (`issuer`, `recipient`, `threadId`, `issuedAt`, `expiresAt`, `proof`, `ext`, `ceremony`). The framework defines no separate envelope; the framework schema validates the outer object and the task's own schema validates only the payload.

**What the suite checks here.** That a platform applies the rules every task shares: envelope, proofs, freshness, duplicates, lifecycle and identity binding. Two further families check single tasks and what a platform sends.

**Belongs here.** Everything every task shares: the type URI and its versioning rules, `id` and thread rules, freshness (`expiresAt`, `issuedAt`, acceptance windows), the consumer processing pipeline, the document lifecycle (`received`, `validated`, `accepted`, `executing`, `suspended`, `responded`, `errored`, `cancelled`, `expired`), duplicate handling (the document `id` alone is the key; identical canonical bytes are a duplicate, anything else under the same `id` is `idConflict`), proof rules, and per-task specifications of ordinary tasks.

**Does not belong here.** Ceremony choreography, carriage specifics, governance values or authority models, and the framework-reserved documents such as the error reply (3b). Whether a given consumer is authorised to perform a task is deliberately left outside the framework.

**Examples.** Any registry task, such as `vrc/relationships/propose`, `witness/session` (0.1, 0.2), `vetting/request`.

### Layer 3b: core trust tasks (and the proposed 3b-DTG tier, core credential tasks)

**What it is.** The framework-reserved task slugs: documents whose meaning the framework itself relies on. They are in the reserved namespace `trust-task-*` and `trust-ceremony-*`. Registry versions:

| Slug | Version | Role |
|---|---|---|
| `trust-task-error` | 0.6 | The error reply; its code set and `retryable` rule are referenced by the lifecycle. |
| `trust-task-next-step` | 0.1 | The reply for a held task: a continuation instead of an error or silence. |
| `trust-task-discovery` | 0.4 | A consumer advertises supported types, versions and its acceptance window. |
| `trust-task-control` | 0.1 | Cancel, suspend, resume. Support is optional in the framework. |
| `trust-ceremony-receipt` | 0.1 | Evidence that one enactment of a ceremony completed. Optional. Its verifier rules have no wire output and are measured through the optional adapter method `verifyReceipt` (group RCPT, docs/04 section 11.6). |

**What the suite checks here (3b).** That error replies, held-task replies, discovery, refusals of control and ceremony receipts are formed and used as the framework states.

**3b-DTG (proposed).** A separate tier for the core protocols of the DTG credential model, kept outside the reserved namespace: `credential-exchange/{offer,request,issue,present}` and `task-consent/{request,decision}`. It exists because those tasks are used by several ceremonies and implementations but are credential- or approver-specific and so cannot be framework-reserved. See [02-core-trust-task-criteria.md](02-core-trust-task-criteria.md).

**What the suite checks here (3b-DTG).** That credential-exchange and task-consent documents follow their task specifications.

**Belongs here.** A task that is neutral (no domain nouns), coupled to the framework, and widely used; or, in 3b-DTG, one that is DTG-specific and shared by several ceremonies.

**Does not belong here.** Governance tasks, messaging/mediator tasks, community tasks, a generic status task (none exists; the framework uses `trust-task-next-step` with a `resubmit` continuation), or anything used by one ceremony.

**Note.** The "Core profile" of the VTI specification (a list of node operation families) is a conformance profile of that specification, not a layer here.

### Layer 3c: individual ceremonies

**What it is.** A flow of several trust tasks between parties, optionally described by a published ceremony definition, tied together by `threadId` and optionally the `ceremony` member. The model of a trust task is bilateral; a multi-party outcome is several bilateral tasks.

**What the suite checks here.** That each ceremony's documents and short step sequences follow the specified order and bindings, one platform at a time.

**Belongs here.** The choreography: which tasks, between which roles, in what order, with what bindings between steps (for example a delivery receipt carrying the digest of the credential delivered), and what counts as completed.

**Does not belong here.** Rules every task shares (3a) or the reserved core documents (3b); they are used, not redefined.

**Examples.**
- *VRC issue.* `vrc/relationships/propose` (accept or decline), then `vrc/relationships/issue` once in each direction on one thread, each returning a delivery receipt. A VRC is one half of a bidirectional peer relationship (DTG credential specification).
- *Witness-share.* A party shares a witnessed relationship with its witness; it relates to the `witness/session` family and to the VWC. The task specification for witness-share is not in the registry; the suite bundles a suite-local profile specification for it (docs/07 O1).
- *Vetting.* Registry ceremony definition `vetting/identity-vetting` (steps `vetting/request`, `vetting/session`, `vetting/decline`, `credential-exchange/issue`).
- *Membership.* Registry ceremony definition `vtc/member-onboarding` (steps under `vtc/join-requests/*` and `vtc/members/*`).
- *Mutual attestation.* Registry ceremony definition `mutual-attestation` (step `credential-exchange/issue`).
- *Approver attestations* (step-up, consent): `auth/step-up/*` and `task-consent/*`.

### Layer 3d: ceremony families

**What it is.** A named grouping of related ceremonies tested and reported together, for example "VRC" (propose, issue, witness-share), "vetting", "membership", "data rooms".

**What the suite checks here.** No tests of its own. Results of the ceremonies below are reported per family.

**Belongs here.** The list of ceremonies in the group, the capabilities an implementation must declare to take part, shared setup, and which tasks are shared across the group (family-level in the sense of document 02).

**Does not belong here.** Anything that holds for all ceremonies (3a, 3b).

**Role in the suite.** The family is the unit of the **capability matrix**: one row per implementation and tier, one column per family. An implementation that does not offer a family is reported as not applicable, not as failing.

### Layers 4a and 4b: deferred

4a (SDK and API) is uniform SDK/API functionality over layers 2 and 3, so that applications need not each reimplement them; 4b (applications) is applications built on those SDKs. They are out of scope here. They matter to the model only because the suite's adapters are not a 4a SDK: an adapter exists to drive an implementation under test, not to be reused by applications.

**What the suite checks here.** Not tested.

## 4. How the layers interact

- **Downward dependency.** Each layer uses only those below it. A ceremony (3c) is composed of tasks (3a), some of which are core (3b), carried over a binding that rides on layer 2.
- **Carriage by boundary adapter.** Ceremony documents of 3a to 3d are carried over a Trust Tasks binding by a boundary adapter in front of the implementation's own machinery. In an implementation that coordinates a ceremony with 2PC over TSP, that coordination stays internal at layer 2.
- **The lifecycle mapping is the seam.** The adapter must map coordination outcomes onto the framework lifecycle. The mapping this effort has adopted (settled in outline, details assumed):

| Internal fact (layer 2) | Visible at 3a/3b |
|---|---|
| Document passed the pipeline, duplicate record written | `accepted`; no reply yet |
| More approvals needed | `accepted` and blocked; reply is `trust-task-next-step` |
| Coordination committed (read from the coordinator's outcome, not from a "yes" vote) | `responded`; signed `#response` |
| Coordination aborted or participant refused | `errored`; `trust-task-error` with code `taskFailed` and a `details.reason` from a closed vocabulary |
| Ceremony deadline lapsed while pending | `errored`; `taskFailed` with `details.reason: "deadlineLapsed"` (not `expired`, which is the framework's acceptance-time expiry) |
| Outcome unknown | `indeterminate` (retryable) or still `accepted`; never guessed as `responded` |
| Duplicate while in flight | existing state or 202, never an error; same `id` with other bytes is `idConflict` |

- **Core documents are reachable from any ceremony.** Any task may be refused with `trust-task-error` or held with `trust-task-next-step`; ceremony definitions do not need to list them as steps.

## 5. What does and does not belong, in one table

| Concern | Layer |
|---|---|
| Sender authentication, routing, framing | 2 |
| Two-phase prepare/commit/abort inside an implementation | 2 (internal) |
| Document shape, id, thread, freshness, dedupe, lifecycle, proof | 3a |
| Error replies, holds, discovery, cancel/suspend, ceremony receipt | 3b |
| Credential offer/request/issue/present; approver consent (proposed tier) | 3b-DTG |
| One ceremony's step order and bindings | 3c |
| Which ceremonies are grouped and reported together | 3d |
| SDKs and applications | 4a, 4b (deferred) |
| Identifiers, keys, resolution, key logs | 1 (relied on, outside scope) |
| Authorisation policy, governance values | outside the framework; family or community specifications |

## 6. How layers map to what the suite tests

The suite is black-box: the harness sends exact bytes and receives bytes; adapters expose the implementation's observable state. Vector groups follow the layers:

| Layer | Vector groups | Tier |
|---|---|---|
| 1 | None. Layer 1 is outside the suite's scope and relied on; it is covered only indirectly by groups PRF and ID. | n/a |
| 2 | No vector of the layer 2 protocols themselves. The carriers are exercised by carrying layer 3 documents: group BND (the HTTPS binding) and the witness vectors over a real DIDComm carrier. Otherwise only the visible outcome mapping above (a "2PC" group asserting lifecycle consistency: no `#response` before commit; every error matches an abort or failure; nothing leaves a terminal state; duplicates after commit return the same receipt and cause no second effect). | 2 (the lifecycle-visible effect is Tier 1) |
| 3a | Envelope, timing, duplicates, proofs, identity binding, responses, authorization, lifecycle (groups ENV, RSP, ID, LIF, PRF, TIME, DUP, AUTHZ), plus the plain and emit families (single tasks, and what a platform sends); reuse of the framework's existing consume and proof fixtures. | 1, with attested-profile assertions in 2 |
| 3b | `core/{error,next-step,discovery,control}` and, for the receipt, group RCPT; control and receipt are capability-gated (not applicable if unsupported; for control the refusal the framework states is `unsupportedType`; for the receipt the optional capability `receiptVerify`). | 1 (gating); the receipt points the text leaves open are CLARIFY |
| 3b-DTG | `dtg-core/{credential-exchange,task-consent,...}`, informative (non-gating) until the DTG protocols specification exists, except where a task specification states a MUST (built: groups TC and CEX, docs/04 section 11.5). | informative; the MUSTs of a task specification gate at 1; stricter rules at 2 |
| 3c | One group per ceremony (for example VRC propose, VRC issue, witness-share), each declaring the task types it requires. | 1 and 2 |
| 3d | Groups roll up into a family; results are reported per family. | n/a |
| AP | `vectors/2l`: the application profiles (identifiers use `2L`), channel `proposed`, advisory and never gating ([19-vti-emit-and-2l-vectors.md](19-vti-emit-and-2l-vectors.md)). | 1 (advisory) |

**Tiers.** Tier 1 is the framework core: what the framework itself makes mandatory. Tier 2 is the proposed `attested` profile: proof on every request, response and error, pinned proof purposes, recipient binding, issuer == proof signer == transport sender, task digests, outcome evidence, closed payloads. Tier 2 assertions that exceed the framework are tagged as profile assertions, because a profile is not a specification until the task force accepts it. Choosing `--tier 2` implies Tier 1.

**Capability gating.** Each vector declares the task types it requires; an implementation that does not declare them gets SKIP (not applicable), never a pass. The other outcomes: PASS, FAIL, KNOWN-FAIL (a gap recorded by the implementation's maintainers, asserted so that closing it forces the record's removal), and CLARIFY (a vector that depends on an unsettled specification point; reported, never gating).

**Capability matrix.** Per 3d family, per implementation, per tier: pass, fail, known-fail, skip counts and the declared capabilities. It reports implementation status; that is kept out of this model document: each run writes its own matrix, and the current figures are in results/README.md.

**Non-vacuity.** Every vector must also pass against a reference adapter built on a framework runtime, so that a wrong vector cannot hide behind a failing implementation.

## 7. Examples, end to end

A VRC issue run touches every layer in scope:

1. (2) Two parties are authenticated to each other over a carrier.
2. (3c, 3d) The "VRC" family declares `vrc/relationships/propose` and `vrc/relationships/issue`.
3. (3a) Each document is validated, accepted, de-duplicated on `id`, and signed.
4. (3b) A proposal held for a human decision is answered with `trust-task-next-step`; a refusal is a `trust-task-error`.
5. (3c) The credential delivered in each direction is checked against the digest in its receipt, and the stored count is exactly one after a replay.
6. (2, via the adapter) If the implementation coordinates the exchange with 2PC, the `#response` appears only after commit.

## 8. Settled, proposed and assumed

**Settled for this effort (decisions taken):** scope is layers 2 and 3, layer 4 deferred; the layer names above; the suite is black-box wire vectors plus thin adapters in a neutral repository; tiers are Tier 1 framework core and Tier 2 attested; 2PC stays internal behind a boundary adapter and the suite never speaks TSP; 3b means framework-reserved slugs only, with 3b-DTG as a separate tier; membership of 3b-DTG as in section 3; no core tasks for governance or messaging; ceremony deadline expiry maps to `taskFailed` with `deadlineLapsed`; the first ceremony is VRC issue plus witness-share, with vetting, membership, data rooms and approver attestations to follow.

**Proposed (not accepted by any external body):** the `attested` profile as a named profile of the task force; the 3b-DTG tier and its membership (a scope note for the DTG credential specification editors is intended; none has been sent); the decision rule in document 02 as a working rule; "breaking change in a core slug requires MAJOR".

**Assumed or unverified:** the exact closed vocabulary of `details.reason`; that the suite-local witness-share profile specification is the right interim home; the status of `trust-ceremony-receipt` (a draft); whether proof-only sender authentication suffices for consequential tasks on the document surface; the mapping from VTI operation family names to registry slugs; the framework's current version relative to the registry (framework prose cites older error and discovery versions than the registry).

## 9. Source specifications

Trust Tasks framework (Working Draft 0.7.0): sections "Document Lifecycle", "Consumer" minimum requirements (items on duplicates and re-evaluation), "Error Responses", "Task Control", "Transport Bindings", "Type URI". Trust Tasks registry (task force repository): `specs/` slugs named above, `ceremonies/`, `bindings/tsp/0.1`, `fixtures/consume`, `fixtures/proof`. DTG credential specification: definitions of VRC, VMC, VWC; planned "DTG Core Trust Task Protocols". VTI specification (Working Draft 0.2.0): VTA/VTC definitions; VTI-OPS-072, VTI-OPS-080.
