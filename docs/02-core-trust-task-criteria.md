# What is a core trust task? Decision rule and examples

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

The outcomes below (which families get core tasks) are settled for this effort; the scoring rule that produces them is a working rule, not an adopted standard. Registry facts: every spec in the Trust Tasks registry is `draft` or `retired`; none is `candidate` or `standard`.

## Scope rule for the suite (decision 79 by the project owner)

Recorded as decision 79 by the project owner in [decisions](decisions/02-specs-tiers-and-channels.md#d79). The suite may test only what has a Trust Tasks (TF) repository home. Every vector therefore cites a TF artifact in `source.tfRef` (a file on main with its commit and status, or an open pull request with its number and head; a retired spec is flagged and the vector is excluded from every run) or is explicitly tagged channel `candidate`: behaviour with no TF home that one or a few platforms implement and that may be adopted later (the witness-share profile, docs/10; the governance declaration probed in docs/17). A candidate records `implementedBy` (derived from the recorded results), the suite-local text it rests on and an adoption note, is advisory, and is never an endorsement. Anything else is removed or excluded from every run of all runs. Details and enforcement: docs/04 section 18. Naming note: the channel `candidate` is the suite's; the registry statuses `candidate` and `standard` mentioned above are TF registry statuses, and no registry spec has them.

## Classification is not scope

The verdict classes in section 2 (core, core-profile, family-level, ceremony-level, plain task, blocked) say which layer a task belongs to and how strictly an implementation must support it. They never decide whether the suite covers a task. The suite's scope is full coverage of everything in the Trust Tasks task force repository (`trustoverip/dtgwg-trust-tasks-tf`): every task type and version on main, in open pull requests and on remote branches (decision by the project owner, 2026-11-19). Core tasks were only the first focus; after core, the priority is VTI and keyring-wallet. The most important evidence is full trust ceremonies end to end, with per-task unit vectors as the finer layer. Non-core families are optional suites a user can choose to run.

- A `plain task` (layer 3a) is in scope. An earlier reading used that class as a reason to leave a task without vectors; that was a misreading and is withdrawn.
- Types with no public specification (the private keyring-wallet types) are held for now: with no public text there is nothing to quote ([decision 79](decisions/02-specs-tiers-and-channels.md#d79)). Held is not excluded forever.
- Every task and every vector is flagged by spec maturity (the spec's `status`: draft, candidate, standard, retired, withdrawn) and by source (main, open pull request, or branch). The generated table is results/coverage/README.md, with the machine-readable matrix beside it.

## 1. Why a rule is needed

"Core" is used for three different things in the source material:

1. **Framework-reserved slugs.** The framework reserves the namespace `trust-task-*` and `trust-ceremony-*` (framework section "Type URI"). Private specifications must not use it.
2. **DTG Core.** The DTG Core Credentials and the planned "DTG Core Trust Task Protocols" referred to by the DTG credential specification.
3. **The VTI Core profile.** A list of node operation families in the VTI specification (VTI-OPS-080).

Only the first is part of the framework. This project therefore uses:

- **Layer 3b**: meaning 1 only.
- **Layer 3b-DTG** (proposed tier): meaning 2.
- A **conformance profile**, not a layer: meaning 3.

Two properties of the framework make the rule conservative. Adding a reserved slug is a framework MINOR change, and removal does not exist: `trust-task-ok` was deprecated at framework 0.5.0 and the slug "remains reserved permanently". Entry is close to one-way, so tie-breakers favour the lower tier. Promotion from family level is cheap and already practised: a concept used by more than one task is moved to a shared component (VTI-OPS-072; the registry's `_shared/` convention).

## 2. Verdict classes

| Class | Meaning | Layer |
|---|---|---|
| core | Every implementation claiming 3b must implement it. | 3b |
| core-profile | In 3b or 3b-DTG but capability-gated: optional, advertised via discovery, must conform if claimed. | 3b (optional) or 3b-DTG |
| family-level | Shared by ceremonies of one family or domain. | 3d |
| ceremony-level | Used by one ceremony. | 3c |
| plain task | An ordinary registry task. | 3a |
| blocked | Does not exist, or its normative home is an unwritten specification. | none |

## 3. The rule

### Gate G1: neutrality (all must hold)

The task (a) names no domain noun, role or authority model (community, member, vetter, approver set, mediator); (b) is not tied to one ceremony; (c) is not tied to one transport or binding; (d) defines no governance value or default. Test: can its abstract be written using only framework-defined terms (producer, consumer, document, thread, proof)? Failing G1 means never framework core. It may still be 3b-DTG, family-level, ceremony-level or plain.

### Gate G2: framework coupling (one must hold)

(a) A normative framework sentence names the task or its semantics (for example the response dispositions, the lifecycle table, the discovery section); or (b) the behaviour of at least two other core items or two framework rules is undefined without it. Failing G2 means not core; it may be core-profile if G1 passes and the score is at least 7.

### Score S, 0 to 2 on each of six criteria (maximum 12)

| # | Criterion | 0 | 1 | 2 |
|---|---|---|---|---|
| S1 | Fan-in: distinct task families referencing it | fewer than 3 | 3 to 9 | 10 or more |
| S2 | Byte-exact interop: a divergence breaks unrelated ceremonies and needs fixed vectors | no | partly | yes |
| S3 | Security criticality: misimplementation gives a domain-independent security failure | no | some | yes |
| S4 | Stability: version churn and open framework rulings | 4 or more versions, or an open ruling | 2 to 3 versions, or minor rulings open | one version, or settled |
| S5 | Independent use (implementations of the framework, VTI and others; the framework's own runtime libraries count as one) | 1 | 2 | 3 or more |
| S6 | Minimal surface | multi-operation or large | medium | tiny |

### Outcomes

- G1 and G2 pass and S >= 7: **core**. If S < 7 but the framework text already mandates the behaviour, still core, with the weak criteria recorded as work items.
- G1 passes, G2 fails or framework support is optional, S >= 7: **core-profile** (optional capability in 3b).
- G1 fails, the task is specific to the DTG credential and community model, S >= 7, and it is used by at least two ceremonies or two implementations: **core-profile in 3b-DTG**.
- Used by two or more ceremonies of one domain: **family-level**. By one: **ceremony-level**. Otherwise **plain**.
- Does not exist, or its home is an unwritten specification: **blocked**.

### Tie-breakers

1. Prefer the lower tier.
2. If the behaviour can be a rule in the framework or a shared component rather than a task, do that. Most of "core" is not a task: envelope, proof, task digest, outcome evidence and duplicate handling are framework rules (layer 3a).
3. If it can be a binding concern (carriage, acknowledgement, delivery evidence), put it in the binding.
4. Security criticality can decide whether to specify something, but not where it lives; security-critical domain logic stays in its family, with vectors in the suite.
5. A task supported only by its author's own draft scores 0 on S5.

## 4. Resulting tiers

**3b (framework-reserved):**

| Slug | Version | Class |
|---|---|---|
| `trust-task-error` | 0.6 | core |
| `trust-task-next-step` | 0.1 | core |
| `trust-task-discovery` | 0.4 | core |
| `trust-task-control` | 0.1 | core-profile (framework says support is optional) |
| `trust-ceremony-receipt` | 0.1 | core-profile (optional capability `receiptVerify`, docs/04 section 11.6) |

**3b-DTG (proposed):** `credential-exchange/{offer,request,issue,present}` (0.1) and `task-consent/{request,decision}` (0.1 and 0.2). The DTG credential specification refers to a planned "DTG Core Trust Task Protocols" specification that does not exist yet; until it does, 3b-DTG membership is a scope proposal, not a published list. It would reference registry slugs by `slug@version`, carry its own versioning, and use no reserved namespace. No revoke verb exists for credentials yet; the DTG credential specification lists one, so it is a gap, not a member.

## 5. Worked examples

**Governance: no core tasks.** The only family literally named `governance` has three capability-management slugs, and the other governance-flavoured tasks (voting, policy, community administration, elections) are community-specific, so they fail G1. What the framework can hold is rules and components, not tasks: the `indeterminate` error code (a value that is not stated or cannot be fetched is not "absent"); the rule that shared schemas never default a governance value (framework ruling and registry change on consent decisions carrying their quorum and self-approval rule); and a possible shared governance-framework reference component (URI, version, digest), which remains inside one family until a second family needs it. A proposed `understanding/*` family stays family-level until a second implementation exists.

**Messaging: no core tasks.** `messaging/*` administers a DIDComm mediator (fails G1(a), (c)); `chat/*` tasks are applications of the framework. Carriage, acknowledgement and delivery evidence belong to transport bindings, which must map the framework lifecycle to their own events. If a core delivery-evidence task is ever needed it should arise from two bindings, not from the mediator family.

**Credentials: a thin 3b-DTG primitive.** `credential-exchange/*` wraps OID4VCI and OID4VP for issuing and presenting credentials and is used by two of the three published ceremony definitions and by more than one implementation. It fails G1 (credential-specific), so it cannot be framework core, but it passes the DTG-level branch. `credential-exchange/query` and `pending/*` stay family-level. The whole family is at version 0.1 and targets framework 0.5.0, so versions should not be frozen yet.

**Approver consent.** `task-consent/{request,decision}` fails G1 literally (it names an approver set and quorum) and is placed in 3b-DTG through the DTG-level branch. A stricter reading, family-level with a DTG tag, would also be acceptable; this is the placement where the rule is most opinionated. `auth/step-up/*` stays family-level (one response task has seven versions, so S4 is 0). `confirm/*` is retired in favour of `task-consent/*`.

**High fan-in does not promote.** `acl/grant` has the widest reference spread outside the framework slugs but embeds roles and authority, which the framework deliberately leaves open, so it fails G1 and stays family-level.

**No generic status task.** None exists, and the framework deliberately provides `trust-task-next-step` plus a `resubmit` continuation as the fallback for holds. Several families have their own status tasks; they stay family-level.

**Blocked.** Delegation invocation, authority demonstration and credential revocation as a core verb have no registry slug today.

### 5.1 Standing principle: the suite never determines governance

Governance (who may grant what, what a role means, which approvers a policy names, what a policy says) is always the end user's choice, the deployer's or the community's. A conformance vector therefore never fixes a role name, a role's meaning or an authority rule. The plain-task family (docs/04 section 11.7) and the producer class (section 11.8) apply this as follows:

- A vector tests mechanics only: payload shape, the declared policy (proof, recipient, issuedAt), error codes, and that a response conforms to its schema.
- A vector that needs a role value carries the token `$role(n)`, filled from the roles the adapter declares in `Capabilities.governance.roles` (optional capability `governance.roles`). An adapter that declares none gets SKIP with the reason "governance not declared".
- A vector that would carry policy content (`policy/upsert`) is gated on the optional capability `governance.content` in the same way.
- The roles an adapter declares are its deployment's; the reference adapter declares two arbitrary strings with no meaning.
- Each affected vector says so in its `spec` list and carries its spec-maturity channel in `source` (docs/04 section 18; a suite-local profile over TF tasks is `proposed`, a behaviour with no TF home is `candidate`, both advisory and never gating). Registry and specification status is recorded in every citation (the registry package is `@openvtc/trust-tasks` 0.29.0; every registry specification is status draft).

This is a standing rule for every family where policy or authority content is a deployment choice (acl, policy upsert content, step-up approver rules), not only for the vectors that exist today.

**Essential and extended governance ([decision 39](decisions/04-ceremonies-governance-and-exceptions.md#d39)).** Governance splits into two tiers, and only the first can affect a gating result:

- **Tier E, essential governance (gating).** Two facts about a held task: the platform's *authority set* (the principals who may decide it) and `minApprovals` (k, at least 1). The adapter declares them in `capabilities.governance.essential` (docs/04 section 19), in the shape of the existing `GovernanceDeclaration` (`principals` plus `consent`), read from the platform's own configuration, from the configuration the harness gave the platform for the run, or from a fixed built-in rule. The suite never asserts what E should be: it records the declaration in the run, runs the ceremony vectors relative to it ("behaves per declared E", so they run at k = 1 as well as at larger k), and checks the declaration against the platform's behaviour with the adapter honesty check (docs/04 section 11.4). A fixed built-in rule still fills E; it is reported as the advisory GOV-FIXED, not as SKIP. A declared authority set of one is shown as *single-party*. Where E cannot be read, the vectors that need it are SKIP "authority set unreadable" with GOV-NOT-PROBED.
- **Tier X, extended governance (advisory only).** Everything else: role names and hierarchy, delegation, step-up policy, `sealBeforeGrant`, `termsRef`, the source of authority, provisioning and policy content. These are reported only through the advisory GOV-* findings of the governance probes (docs/17), never in a gating count.

The one gating governance result is a declaration mismatch (GOV-DECLARATION-MISMATCH, docs/17): it states that the adapter's own declaration of E does not match what the platform does, which is a fact about the measurement, not a ruling on the platform's governance.

## 6. Graduation

**In**, when all hold: (i) a second family or ceremony needs the same semantics; (ii) G1 and G2 pass and S >= 7 (or the framework mandates it); (iii) at least two independent implementations pass the suite's vectors for it (the meaning this project gives to the framework's `candidate` maturity level, and evidence the suite can supply); (iv) a soak period with no breaking change. Mechanism: framework-level via a new reserved slug (framework MINOR plus registry entry); DTG-level by listing `slug@version` in the DTG protocols specification (no framework change); a shared shape becomes a `_shared/` component first.

**Out**: deprecate (`supersededBy`), then `retired`, then `withdrawn`. A reserved slug stays reserved forever and consumers keep accepting the retired version for a stated window. In 3b-DTG, drop the reference in a new MAJOR of the protocols specification.

## 7. Versioning implications

- Core slugs use `MAJOR.MINOR` (only `trust-task` itself is three-part). Consumers accept their version and lower, and should accept forward minors.
- Adding to the reserved table is a framework MINOR; removal does not happen.
- The framework's draft allowance lets a breaking change be a MINOR bump, and core slugs have used it (`trust-task-error` went from 0.1 to 0.6, `trust-task-discovery` from 0.1 to 0.4; framework prose still cites older versions of both). **Proposed:** once a slug is core, a breaking change requires a MAJOR. Until then the suite pins an explicit version per core slug and matches by prefix.
- Adding a standard error code is non-breaking in some runtimes and breaking in others that use closed unions; a core vector set must state which.

## 8. Limits

Fan-in figures come from prose references across the registry and include boilerplate mentions; they are indicative. Implementation counts are bounded by the fact that one maintainer authored most of the registry and all four reference runtimes, so independent use is weak evidence. Transport binding details and the relation between `consent/*` (1.0) and `task-consent/*` have not been fully examined.
