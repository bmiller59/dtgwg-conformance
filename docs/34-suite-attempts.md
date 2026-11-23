# Suite attempts: what each platform sets out to do, and how well it does it

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This page states how the suite reports, per platform, which suites it attempts, how complete each attempt is, and how well the attempted part agrees with the specification text. It is the reporting approach agreed by the project owner (decisions [D385 to D391](decisions/06-runs-and-results.md#suite-attempts-and-completeness)). The figures themselves are generated; this page states none. Wording follows [docs/14](14-interoperability-tracking.md#wording-rules): every agreement figure here is conformance-implied; none is demonstrated interoperation.

The prototype is `scripts/suite-attempt-prototype.ts` (tests: `test/suite-attempt-prototype.test.ts`). It reads the scope-relative roll-up (`src/glance/rollup.ts`, generator `scripts/rollup-prototype.ts`), the coverage matrix and the wallet role table. It is not yet part of `npm run regen`.

## 1. Goal

A platform is judged on what it attempts, not on the whole body of specifications. A reader should be able to see, for each platform: which suites it takes part in, how much of each suite it implements, and how well what it implements agrees with the specification text, with what was not measured kept visibly apart.

## 2. What a suite is

A **suite** is a task-force family: the first segment of the task slug (`acl`, `credential-exchange`, `vault`, ...), at the latest non-retired versions ([D245](decisions/02-specs-tiers-and-channels.md#d245)).

- **Large families are split.** A family with more than 30 focus tasks is split by its second segment (`vtc/members`, `vta/dids`, `auth/oob`, `rooms/keys`). Today that splits `vtc`, `vta`, `rooms`, `did-management`, `auth`, `persona`, `messaging` and `vtn`. Without the split, one family (`vtc`, 279 tasks) would show a platform that implements one well-defined area of it as a few percent complete.
- **Tiny sub-prefixes are pooled.** After a split, sub-prefixes with fewer than 3 tasks are kept together as one suite, `<family> (other)`, so that no suite is a single stray task.
- **Small families stay whole.** A family of 1 or 2 tasks (`sync`, `peer-check`, `vrc`) is its own suite. Completeness then reads "1 of 1" or "2 of 2", which is accurate.
- **`core`** holds the framework rule groups (CTRL, PRF, ENV, ERR, TIME, DUP, ID, LIF, RSP, BND) and the framework tasks `trust-task-control`, `trust-task-discovery`, `trust-task-error`, `trust-task-next-step` and `trust-ceremony-receipt`.
- **Ceremony groups sit beside suites.** Each ceremony group (FC-*) is listed with every suite whose tasks its scenarios name. Ceremony outcomes are shown with the suite, never inside its figures ([docs/26](26-paired-ceremonies.md) section 1).

Every focus task belongs to exactly one suite. The split threshold (30) and the pooling threshold (3) are parameters of the catalogue, recorded with every report.

## 3. Which suites a platform attempts: code evidence first

A platform's attempted suites come from **evidence of the tasks it includes**: tasks its code serves or sends, mapped to their suites. A suite is **attempted** when the platform includes any of its tasks.

| Evidence kind | What it is | Implemented? |
|---|---|---|
| `served-code` | the task is in a dispatcher table or handler of the platform's source (VTI dispatcher tables; the wallet's inbound registry and handler functions) | yes |
| `sent-code` | the platform's source holds a builder that sends the task (comment-stripped scan) | yes |
| `declared-run` | the platform's adapter declares the task at the measured build (`run.json`: served types, emitted types) | yes |
| `older-code`, `older-run` | the same, but only for an older version than the latest | no at the latest; the suite is still attempted, behind the latest |
| `named` | the source names the task (a constant, an allow-list, a pin) with no builder or handler | never |

Code evidence and the adapter declaration are united. Each has known bounds, which the report states beside the suite:

- A source scan reads a newer checkout than the measured build, so it can name tasks the measured build did not have. Such tasks are in scope but **not measured**, which lowers the measured share and never the agreement figure.
- An adapter can under-declare (the keyring-wallet shim declares fewer served types than the wallet's code serves). The code evidence then adds the missing tasks.
- A pin without a dispatcher (VTI `trust-tasks.lock` entries no dispatcher serves) is `named`: an upper bound, never an implementation.
- VTI's surfaces are read from the role file `results/coverage/vti-roles.json` (section 5a): handler registrations for the services, and the sending side of the SDK, CLI, community client, mobile core and mcp servers. Where a surface has no code scan (the witness and voting services of VTI have none of their own runs), the scope is the adapter declaration alone, and the report says so.

**Confidence** per attempted suite: **high** when code evidence and the measured build's adapter declaration agree on at least one task; **medium** when only one of them exists. A suite whose only evidence is `named` is not attempted: it is listed as not yet built, with the note "named in code only".

## 4. Two numbers per attempted suite

| Number | Definition | Reads as |
|---|---|---|
| **Completeness** | tasks implemented at the latest version / focus tasks in the suite; tasks implemented only at an older version are listed beside it ("+2 at an older version only") | how much of the suite the platform tries to do |
| **Conformance** | conformance-implied agreement on the implemented tasks: agrees / (agrees + differs + unexplained), gating (registry-channel) checks only, item level, as in the roll-up; always printed with its measured share | how well what it implements agrees with the specification text |

A partial implementer is never judged across the whole suite: a platform that implements 9 of 14 tasks reads "9 of 14" for completeness and is scored for conformance on those 9 only. The rest of the suite is not counted against it.

**Per-suite mark.** The conformance figure of one suite is printed as a percentage only when at least half of its implemented tasks were measured and at least 3 were decided:

- **clear reading** (filled circle): the percentage, with "a of d" and the measured share;
- **insufficient evidence** (half circle): something was measured, too little for a percentage; the counts are shown;
- **no measurement** (hollow circle): nothing was measured.

The per-suite threshold (3 decided) is lower than the headline's (10) because a suite is small; the measured-share floor is the same 50%.

## 5. Three bands

Each platform card carries a "Suites attempted" strip with three bands:

| Band | Meaning | Scored? |
|---|---|---|
| **Attempts** | the platform includes at least one task of the suite (section 3) | yes: completeness and conformance |
| **Not attempted** | no role by design (a service-operator suite on a wallet; a community suite on the agent service) | never; listed, never counted against the platform |
| **Not yet built** | the platform could take part (a client could send these, a server could serve them) but no implementation was found | never; shown so the reader sees what it could build |

Suites with no evidence and no role reading are shown as **not yet classified**, with the missing input named. The role readings come from evidence where it exists (the wallet's role table, the VTI role file, a sibling surface of the same platform serving the suite) and otherwise from judgement rules, which are labelled as judgement.

A suite whose only evidence is a name (a pin, a list or a table, no handler or builder) is **not yet built** and carries a **named only** flag (D408); the headline says how many of the suites it could build are named in code only.

### 5a. VTI roles and the sending-side scan (D420 to D423)

VTI is read per surface by `results/coverage/vti-roles.json` (generated by `npm run coverage-matrix` from the VTI source and `results/coverage/vti-role-rules.json`; the per-slug table is results/coverage/vti-participation.md). The surfaces are the agent (VTA), the community (VTC), the witness and voting services, the client builders (SDK, CLI, community client, network client), the mobile core and the mcp servers. For each focus slug and surface the role is one of `serves`, `emits`, `older-version`, `named-only`, `not-built` or `not-involved`.

- Code evidence is read with the keyring-wallet scan's discipline: comments stripped, test code removed, constants and module aliases resolved, each role with its file and line.
- Direction is by call role. A handler registration (`dispatch_table!`, `on!(..)`, a `SERVED` table) is `serves`. In client code a reference handed to a sender or builder is `emits`, and one compared with or matched against a received document is read as `serves`. A name in a list, a re-export or a table, or a pin in `trust-tasks.lock` the surface does not serve, is `named-only`.
- A slug with no code on a surface gets `not-built` (the surface could take part) or `not-involved` (no role by design) from a prefix rule with a stated reason. Those rules are judgement and are labelled so; the code evidence is not judgement.
- A card reads one or several surfaces: the client builders card unions the client, mobile core and mcp surfaces (the sending side). The role-based denominator of a surface is the slugs where it has a role (serves, emits, older-version).
- The platform line names the **weakest surface** (D423): the attempting surface with the least conformance evidence, that is the lowest measured share of its attempted tasks, then the lower clear agreement, then the larger scope; other surfaces with no measurement are named beside it.

## 6. The optional override file

A platform may have an override file, `results/scope/<component>.json` (format `tt-scope-override/0.1`; [results/scope/README.md](../results/scope/README.md)). It is optional: the code-derived scope stands without it. An entry may:

- classify a suite with no evidence as not attempted or not yet built, with its reason;
- annotate an attempted suite, for example a feature compiled out of the default build.

An override can never remove a suite that has evidence and never adds an attempt. When an override and the evidence disagree, the report shows both. Each entry carries its basis: `declared` (confirmed, with who and when), `inferred` (with an evidence link) or `unconfirmed`. Suites classified by an override are counted in the headline ("42 not its role, 6 by an override"), so a broad override is visible.

## 7. How it folds into the roll-up figures

- The headline agreement figure P of a platform or surface is the scope-relative roll-up's ([D385](decisions/06-runs-and-results.md#d385)): gating only, item level, withheld as "insufficient evidence" below 50% measured or 10 decided. Its items are the implemented tasks of the attempted suites, so P pools the suites' items: per-suite figures add up to the headline, and the headline is never an average of suite percentages.
- The scope is the code-derived one (section 3). Tasks found in code but not declared by the measured build are in the scope as not measured.
- Not attempted and not yet built never enter a denominator. They appear as counts in the headline and as bands on the card.
- The advisory reading, the ceremony completion figure (by partner kind) and the older-version line stay as in the roll-up: separate, labelled, never added to P.

## 8. How it reads

**One-line headline** per platform and per surface:

> {platform}: attempts {N} of {N+K} suites it could take part in ({F} in full); {P}% conformance-implied agreement on the measured part of those ({a} of {d} decided tasks; measured {m} of {D}, {M}%); {K} more it could build; {R} not its role ({o} by an override); {U} not yet classified.

When P is withheld the figure reads "conformance-implied agreement withheld (measured {m} of {D} tasks, {M}%; {a} agree)".

**Platform card strip.** The three bands, each attempted suite as a chip with its completeness bar, its conformance figure or mark, and its confidence.

**Overview grid.** Platforms and surfaces down the side in the fixed platform order (VTI, keyring-wallet, truststackers), suite families across, each cell the band and, for attempted families, the suites attempted and the pooled conformance; split families open into their sub-suites. A family no row attempts or could build is hidden, and the count of hidden families is printed.

**VTI (D332).** VTI is shown as one derived line (a suite is attempted if any surface attempts it; completeness counts a task once; conformance pools the surfaces' items, each kept under its surface; the weakest surface is named) and broken out by surface: agent service, community service, client builders, witness service, and further services as they are measured.

**Where VTI and keyring-wallet meet.** A small overlap view of the suites each attempts, the suites where one sends and the other serves (a conformance-implied pairing is possible there), and the ceremony groups both took part in. It is conformance-implied and ran-together evidence, not demonstrated interoperation.

**Plain-language legend** (printed with every grid):

- *Completeness*: how much of the suite the platform implements at the latest version.
- *Conformance*: of what it implements, the share that agrees with the specification text in every gating check that ran. Conformance-implied, never demonstrated interoperation.
- *Measured share*: how much of what it implements the suite could check.
- *Not attempted*: not this platform's role; never counted against it.
- *Not yet built*: the platform could take part but nothing was found; not scored.
- *Not yet classified*: the suite has not yet been read for this platform's role.
- Not a ranking. Platforms are never compared with each other as a league table. Every specification is currently a draft.

## 9. Guardrails

- Scope size, completeness and measured share are printed beside every agreement figure.
- Evidence beats an override: a suite with evidence stays attempted.
- Not attempted and not yet built are never in a denominator; "attempted and failed" is only ever a recorded difference.
- Every count moved by an override is visible in the headline.
- The surfaces of one platform are never merged into one figure except the labelled derived line.
<!-- lint:skip -->
- The claims lint applies to every generated page: never "conformant", "compliant" or "certified", and "interoperable" only with the docs/14 qualifier.
<!-- /lint:skip -->
