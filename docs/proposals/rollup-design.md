# Roll-up summary design: one fair percentage per platform, relative to its own scope (2026-11-20, project owner)

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. Repository copy of a design note: local paths of the original are replaced by `<local path>`; the original and its data are in the author's scratch area.

Status: **DONE** (design plus a working prototype; nothing blocked). **Corrected 2026-11-20 (D354)**: the cause of the 16% / 15% is a gating coverage gap, not version lag; sections 0, 2.3 (VTI agent and community; Reference) carry the corrected text. Repository copy on branch `conformance/promote-b1`; the original text is in the scratch copy. Nothing pushed, filed or sent; no contact. No existing suite branch edited.

- Branch `conformance/rollup-design` off `conformance/latest-versions` `cb3d96a`, worktree `<local path>` (`.keep-until` 2026-11-27; `node_modules` symlinked to the final4 worktree's). Two signed, signed-off commits: `f6a4ce2` (prototype and tests), `b671571` (per-item detail in the JSON output).
- Prototype: `scripts/rollup-prototype.ts` (TypeScript, node `--experimental-strip-types`, the suite's own runtime). Tests: `test/rollup-prototype.test.ts`, 21 tests, all pass, synthetic inputs only (no run records, no results directory). `npm run typecheck` (tsc) clean. Full `npm test` not run (light-runs rule; the new test file is self-contained and runs under the normal glob).
- Prototype output from the real records: `<local path>` and `rollup.md` (regenerable with the command in section 2.1).
- Used `<local path>` (it appeared during this work) as a cross-check. It agrees with what I found independently. The matrix's "7 / 743 / 112" for keyring-wallet comes mostly from the wrong inputs and the wrong denominator. It does not say anything about the wallet.

Wording rule followed throughout: the bare word "interoperable" is never used. Every agreement figure here is **conformance-implied** (docs/14 (a)). Ceremony outcomes are "ran together" evidence. Neither is demonstrated interoperation (b): the ledger is still empty.

---

## 0. Recommendation in one paragraph

Give every platform component (VTI agent, VTI community, VTI client builders, keyring-wallet, the witness server) one **primary percentage**: **P, the conformance-implied agreement on the measured part of its declared scope**. The declared scope comes from what the platform says it serves, sends and plays in ceremonies, normalised to the latest version of each task. The vectors it happens to pass play no part in the scope. Print P only next to **M, the measured share of that scope**, and the **scope size**. Withhold P ("insufficient evidence") when M is under 50% or fewer than 10 items were measured. Beside P show **C, ceremony completion with real partners**, kept as a separate number (the "never conformance" rule is unchanged). Also show **F, the floor**: items shown to agree out of the whole declared scope. Keep the channel rule: only gating (registry) checks feed P. The advisory spec-derived checks (gap, coverage, 2L) appear as a labelled second line. With today's records this gives keyring-wallet **90%** and VTI client builders **100%**. The VTI agent and community get **"insufficient gating evidence at the latest versions"**: only 16% / 15% of their declared latest-version scope has a gating check. Their advisory reading is 94% / 96% on 89% / 94% measured. That is the honest answer, and the fix belongs in the suite: for most of what VTI serves the suite has **no gating vector at any version** (only advisory coverage, gap and 2L vectors), so the fix is to review and promote them (docs/33; decision D354). It is not version lag: of the unmeasured items, none has a gating vector only at an older version.

---

## 1. Definitions

### 1.1 The unit: a scope item

A **component** is one platform surface, or a set of surfaces that run the same code in one role. Examples: VTI agent service (VTA) in process; VTI community service (VTC) in process; VTI client builders (the emit surface); keyring-wallet wallet logic (its shim surface, which carries both its receiving runs and its emit runs); the keyring-wallet witness server. Platforms are always separate components. Carriers of the same logic (keyring-wallet DIDComm v1 and v2) are not added to the shim component. They appear on the card as "also measured over" lines, because surfaces are never combined into one figure (docs/14 rule 4).

A **scope item** is `(role, task slug at its focus version)`, where role is `receive` (serves or answers) or `send` (builds and sends). Each framework rule group (CTRL, PRF, ENV, ERR, TIME, DUP, ID, LIF, RSP, BND) is also an item, in role `receive`, for every component that receives trust tasks. Serving and sending the same task are two items, because they are different evidence (docs/14 section 2).

Why items rather than vectors for the headline: the scope is a list of tasks, and people think in tasks. Vector counts per task range from 1 to more than 40 (PRF alone has 41), so a vector-level figure is dominated by a few heavily tested families. The vector-level figure stays on the card as a detail line ("check-level agreement"), so nothing is hidden. The two can differ a lot: keyring-wallet original is 90% at item level and 71% at check level. Most of its recorded differences are clustered in the framework groups.

### 1.2 Declared scope (the denominator's population)

Derived from evidence that does not depend on results, in this order:

| Evidence | Role | Source in the records | Status in the prototype |
|---|---|---|---|
| Adapter declares it served | receive | `run.json` `implementations[].capabilities.supportedTypes` (+ `unlistedTypes`) of the component's own runs (the measured build) | used (defines the denominator) |
| Adapter declares it sent | send | `run.json` `capabilities.emits` | used |
| Ceremony roles declared | per ceremony | `run.json` `capabilities.ceremonyRoles`; ceremony rows the component is a party of | shown on the card; feeds C, never P |
| Receives any trust task | receive | presence of any receive item | adds the framework rule groups |
| Source scan (code names it) | either | `results/coverage/matrix.json` `vti.served` (`vta`/`vtc`), `kw.referenced`/`kw.serves` | **comparison only**, printed as "source names N tasks outside the declared scope" (see 3.3); not in the denominator, because the scans are at newer commits than the measured builds (VTI main `71d524572` vs measured `26d0da81`; KW `969963df` vs measured `62af4d2d4`) |

Normalisation (decision D245): each declared Type URI is mapped to its slug's **focus** version (the latest non-retired version). A slug whose latest is retired follows `supersededBy` to its successor's focus version. An item is **at latest** if one declared version is the focus version. Otherwise it is **behind**: in scope, not attempted at the latest version. That is the platform's version lag (D240, D248 class `platform`). Declared types with no task-force spec (truststackers' `urn:p2pts:*` ceremony types, `conformance/widget`) are listed apart as "outside the registry" and never counted.

The reference adapter (the oracle) has as its scope every focus item the suite holds a check for, in either role.

What is **not** used: the vectors a platform passes or runs. That would make the score circular: a platform would be "in scope" for exactly what it passes.

### 1.3 Evidence kinds

| Kind | What | Feeds |
|---|---|---|
| Gating | registry-channel vectors: core framework, DTG, ceremony documents and receipts, plain, emit, emit-more, witness | P, M, F, check-level |
| Advisory | channels `proposed`, `candidate`, `pr`: gap (GP/GE), coverage (CV/CX/CB/CE), probe, 2L | the "advisory reading" line only (channel rule: advisory never in a headline) |
| Ceremony | `complete-ceremony` scenario outcomes (`countedAsConformance: false`) | C only |
| Artifact-crossed | runner-relayed documents (docs/14 section 7) | nothing; may be linked from the detail |

### 1.4 How each result class counts

Per item, from all the vectors of the right role whose task is the item's slug at the focus version (a vector at an older version measures an older item, never the focus item):

| Result | Effect on the item | In P? |
|---|---|---|
| PASS | agrees, unless something worse is present | numerator and denominator |
| CLARIFY | unsettled if nothing else ran; beside a PASS the item still agrees | unsettled items are measured but outside P's denominator |
| KNOWN-FAIL, class A (differs from spec text) | differs | denominator, not numerator |
| KNOWN-FAIL, class B (suite may over-read; under review) | differs, sub-counted "under review" | denominator (conservative: a class change must come from the vector review, never from the roll-up) |
| KNOWN-FAIL, class C (unsettled in the spec) | treated as CLARIFY | outside |
| KNOWN-FAIL, class D (harness or stand-in limit) | treated as not reached (a limit of the suite) | outside |
| KNOWN-FAIL, unclassed exception | differs | denominator (conservative; 21 KW, 6 VTI exceptions have no class today) |
| FAIL with a recorded finding (`results/findings.json`) | differs (or C/D by the finding's class) | as its class |
| FAIL with no finding (unexplained) | **unexplained**, worst state | denominator; card shows a red "needs triage" count |
| Stale exception (runner FAIL "the vector now passes") | PASS, listed as fixed (glance model rule) | as PASS |
| SKIP not applicable | if every check of a declared item says this: **declared-not-offered** (a contradiction to look at) | outside, listed |
| SKIP not reached | not reached (suite limit) | outside |
| SKIP version mismatch | behind | outside |
| SKIP out of tier, QUARANTINED, SPEC-CHANGED | ignored (as the glance model does) | outside |
| no recorded run includes the checks | not run | outside |
| the suite has no gating check at the latest version | no check (suite gap) | outside |
| Ceremony: completed, ended as specified | C numerator | never in P |
| Ceremony: failed, incomplete, inconclusive | C denominator | never in P |
| Ceremony: skipped | outside C's denominator, shown | never in P |

Precedence within an item: unexplained > differs > agrees > unsettled > behind > no check > not reached > declared-not-offered / not run.

### 1.5 The numbers

| Symbol | Name | Definition |
|---|---|---|
| D | declared scope | number of scope items |
| M | measured share | (agrees + unsettled + differs + unexplained) / D |
| **P** | **conformance-implied agreement on the measured scope** | agrees / (agrees + differs + unexplained); withheld when M < 50% or fewer than 10 items measured or nothing decided |
| F | floor (shown-agreeing share) | agrees / D. Never shown alone; always below P |
| check-level | detail | PASS / (PASS + KNOWN-FAIL A/B/unclassed + FAIL), same scope, C and D outside |
| P' (advisory reading) | detail line | P computed with advisory checks added; labelled "not gating" |
| C | ceremony completion | (completed + ended as specified) / (scenarios run − skipped). Counted per distinct scenario across partners: a scenario counts as complete only if it completed with every partner it ran with. Split by partner kind (platform / the oracle), never summed across kinds |

### 1.6 Focus (latest) and older versions

The headline counts focus items only (D245). Items behind the latest are in the denominator as "behind". Older-version results appear as one line on the card, never in a headline: "older versions (non-focus): checks ran for N older task versions". Retired latest versions follow their successor. D241 (`vta/webvh/dids/{update,rotate-keys}` 1.0/1.1) is still open: the prototype follows the rule as written and maps them to the successors. If D241 is accepted, those items become "at latest" on the old slug.

### 1.7 Spec maturity

Every item carries its maturity and source (`draft/main`, `draft/pr`, `draft/branch`, `framework`). Today every specification in every scope is **draft**. The reference scope adds six `draft/pr` items (PR 904). The card shows a maturity strip ("all 95 tasks: draft, main") and an always-on note: "Specifications are drafts; a figure is against texts that may still change." When candidate or standard specs appear, the detail splits P by maturity. The headline stays one P, and the strip shows the mix. Items from a PR or a branch are marked provisional on the detail line.

---

## 2. The headline numbers and the worked examples

### 2.1 Exact inputs (prototype run of 2026-11-20)

| Input | Path or value |
|---|---|
| Gating results (Tier 1) | assembled results set `<local path>` (D221; the set `check:docs` used), read through the suite's own `buildModel` (`src/glance/model.ts`: same surfaces, same SKIP classes, same stale-exception rule as the at-a-glance page) |
| Surfaces and run folders | `results/at-a-glance.config.json` at `cb3d96a` (the `2026-11-19-final-*` runs) |
| Advisory results | `<local path>`, `<local path>` (the 2026-11-20 gap rows), `<local path>` (earlier reference gap run); first root wins per vector id |
| Ceremony records | `<results set>/ceremonies/` (31 rows) plus `<local path>` (FC-PER, FC-DIR, FC-VOT; not in the assembled set) |
| Focus, vector-to-task map, source scans | `results/coverage/matrix.json` at `cb3d96a` (task force `bd0c05013`, VTI main `71d524572`, KW `969963df`) |
| Exception and finding classes | `exceptions/exceptions.json`, `results/findings.json` at `cb3d96a` |
| Thresholds | M ≥ 50%, measured items ≥ 10 (chosen before computing; see 3.1) |

Command (from the worktree; read-only on every input):

```
nice -n 10 node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/rollup-prototype.ts \
  --results <local path> \
  --advisory <local path> \
  --advisory <local path> \
  --advisory <local path> \
  --ceremony-extra <local path> \
  --out <file.json> --md <file.md>
```

### 2.2 Results (real data, platform order; not a ranking)

Declared = items (receive / send / framework; behind latest). Every row is one component measured alone; rows are never added or compared.

| Component | Declared | Measured M | **P** | F | Check-level | Advisory reading P' (M') | Ceremony C (kind of partner) |
|---|---|---|---|---|---|---|---|
| VTI agent service (VTA), original | 273 (263/0/10; 29 behind) | 45 (16%) | **withheld** (M < 50%); 40 agree, 5 differ | 15% | 94% | 94% of 242 (89%) | 78%: 14 of 18 with original keyring-wallet (5 skipped) |
| VTI community service (VTC), original | 319 (309/0/10; 21) | 48 (15%) | **withheld**; 44 agree, 4 differ | 14% | 93% | 96% of 299 (94%) | 60%: 3 of 5 with original keyring-wallet (FC-KVX) |
| VTI client builders (sending side), original | 84 (0/84/0; 11) | 61 (73%) | **100%** (61 of 61) | 73% | 100% | 100% of 73 (87%) | none (no ceremony role) |
| keyring-wallet, original (wallet logic, stand-in carrier) | 105 (3/92/10; 14) | 83 (79%) | **90%** (75 of 83) | 71% | 71% | 91% of 90 (86%) | 74%: 17 of 23 with original VTI; 90% (38 of 42) with the oracle |
| keyring-wallet witness server | 12 (2/0/10; 2 behind) | 0 | **withheld** (nothing at latest) | 0% | n/a | same | none |
| truststackers (original) | not reachable | - | **no figure** | - | - | - | none |
| Reference adapter (self-check, not a platform) | 1,367 | 246 (18%) | **withheld** on gating | 18% | 100% | 100% of 1,351 (99%) | (oracle) |

### 2.2a After batch B1 (2026-11-20, D365)

The prototype re-run with the 462 promoted vectors counted as gating (`--promotions vectors-src/promotions.json`), once as a projection from the pre-promotion records (`--project-promotions`) and once from fresh gating runs recorded after the promotion; the two agree exactly. Same inputs as 2.1 plus the new gating runs of the oracle, VTI and the keyring-wallet shim. Single-implementer vectors, provisional rule (D353): the figures measure payload-schema and declared-policy mechanics.

| Component | Measured before | Measured after | P before | P after | Floor F after |
|---|---|---|---|---|---|
| VTI agent (original) | 45 of 273 (16%) | 140 of 273 (51%) | withheld | **96.4%** (135 of 140) | 49% |
| VTI community (original) | 48 of 319 (15%) | 115 of 319 (36%) | withheld | withheld (under 50%) | 35% |
| Reference (oracle) | 246 of 1,367 (18%) | 410 of 1,367 (30%) | withheld | withheld (under 50%) | 30% |
| keyring-wallet, client builders | unchanged | unchanged | | | |

The keyring-wallet rows do not move: it skips all 462 vectors, so no second implementation exists. The community reaches the 50% threshold only with batch B2.

### 2.3 Reading the examples

**keyring-wallet (original)**, against the old "covered 7 / skip 743 / not run 112 of 862". The wallet's adapter declares 95 tasks at the latest version: 92 it sends, 3 it serves. Add the 10 framework groups and that is 105 items. 83 of them were measured by gating checks (79%), and 75 of those agreed in every check: P = 90%. The 8 that differ are the framework groups ENV, ERR, PRF, TIME and DUP, plus `vrc/relationships/propose` and `issue` and `credential-exchange/query`. These are the recorded class A differences (next-step holds, error replies, proof checks). 14 items are behind: the wallet build that was measured sends `acl/*` 0.1/0.2 where the latest is 0.3/0.4, older `rooms/keys` versions, and `push/register` 0.2. 7 have no gating check at the latest (rooms `backfill`, `key-package`, `welcome`; vta/pcs vote and voter tasks). 1 is a contradiction (`framework/BND`: an in-process carrier declares no HTTPS binding; section 3.3). The ceremony figure with an original partner is 17 of 23. The four FC-DEV failures with the VTI agent are VTI's undeclared error codes. Sources that agree: the reach analysis's role-based 84 of 134 slugs (63%), counted on a wider, source-derived scope (section 3.3).


**VTI agent and community (original).** The adapter declares 289 agent types, which comes to 273 items at the latest. Only 45 have a gating check at the latest version. For 197 agent / 249 community of the unmeasured items the suite has no gating vector at any version: the gating families (plain, emit, framework, DTG, ceremony documents) do not cover the roughly 600 VTI-specific tasks, and only advisory coverage, gap and 2L vectors exist for them (D354, from the gating-gap analysis of 2026-11-20). Gating vectors at an older version only: 0 items. Platform behind the latest: 29 / 21 items (re-measuring VTI main would recover 23 / 14); a gating check at the latest that is SKIP: 2 / 1. So M = 16% and P is withheld. Of the 45 that were measured, 40 agree and 5 differ: `credential-exchange/issue` and `query`, and framework BND, ID and PRF. These are the recorded class A differences. The advisory spec-derived checks (gap, coverage) measure 242 items and 94% agree. The card shows that reading as its second line, labelled not gating. This is not "VTI looks broken". It is "the suite has not yet reviewed and promoted checks for most of what VTI serves at the latest version". 29 agent items are behind: VTI at `26d0da81` serves `acl` 0.2/0.3 against latest 0.3/0.4, `rooms/keys` at older versions, `vta/did-templates` 3.1 against 3.2, `vta/memory` 0.1 against 0.3, and so on. That is a finding about the platform's version lag, and it shows as its own count.

**VTI client builders.** 84 items, 73% measured, all agree. 11 are behind and 12 have no gating check.


**Witness server.** The server serves witness session/submit 0.1, and the latest is 0.2. The suite's witness vectors also target 0.1 (D251). So nothing is measured at the latest. The card reads "insufficient evidence: behind the latest version (serves 0.1, latest 0.2)", with the older-version line: "3 older task versions measured". The framework groups were never run on this surface, so they read "not run".

**Reference.** It agrees 100% wherever it ran. Its gating measured share is 18%, which is the clearest single sign of how little of the latest-version scope the gating set covers (a coverage gap, not version lag: D354).

### 2.4 Why one primary number plus supporting ones, and not one number

- P alone hides how much was measured: "100%" on 17 items or on 16% of a scope would read as a clean bill. Hence M and D are always beside it, and P is withheld when M is low.
- F alone (agrees over everything declared) mixes suite limits with platform defects. VTI's F of 15% is mostly the suite's missing gating checks, not VTI. F stays on the card as the honest floor, never as the headline.
- C cannot be merged into P. The "never conformance counts" rule (docs/26 section 1, D22/CV-15) exists because a ceremony is one pair, one carrier, one date, with stand-ins (class D). Its failures can belong to either party or to the harness, and its outcome is not a check of the spec text. A blended number would let a good pairing hide a conformance gap, or the reverse. C stays a separate, labelled number. **This design does not change the rule.**
- Check-level beside item-level shows depth: 90% of the wallet's tasks agree everywhere, but 71% of its checks pass. Most of its differences sit in the framework groups.

---

## 3. Guardrails against misleading

### 3.1 Minimum-measured-share threshold

P is printed only if M ≥ 50% **and** at least 10 items were measured. Otherwise the card shows "Insufficient evidence for a conformance-implied figure (<reason>)" together with the counts (measured, agree, differ), so the reader still sees what exists. I fixed both thresholds before computing the examples, and I did not tune them to the results. 50% is the point where more of the scope is measured than not. 10 items stops a single-digit scope from producing 100%. Raising or lowering the threshold is an open question (section 6).

### 3.2 Not attempted is never attempted and failed

The states `behind`, `no check`, `not reached`, `not run` and `declared-not-offered` are never in P's denominator. Each has its own count and plain-language line on the card. `differs` and `unexplained` are the only states that count against a platform. Class D differences (stand-ins) count as not reached, and class C as unsettled. The prototype tests pin each of these rules.

### 3.3 Goodhart: shrinking the scope must be visible

- D (scope size) is printed in the same sentence as P, every time. A test shows that removing two differing items from the declaration raises P and lowers D in the same headline.
- **Source-scan comparison.** The card prints "the platform's source names N tasks outside its declared scope". Today that number is 40 for keyring-wallet, 22 for the VTI agent and 73 for the VTI community, all against newer source than was measured. For keyring-wallet this already catches a real under-declaration: the shim adapter declares only 3 served task-force types, while the reach analysis finds 12 SERVES slugs in the wallet's code. Recommendation: once the scanner can run at the measured commits, the denominator becomes the union of the adapter declaration and the source scan (section 6, Q3).
- **Declared but not offered.** An item the adapter declares, but which every run reports as not applicable, is listed as a contradiction (VTI `task-consent/decision` 0.2; keyring-wallet `framework/BND`). The BND case also shows a scoping refinement: framework groups should follow the component's declared bindings, so BND applies only to HTTPS surfaces.
- **Scope diff between runs** (design, not prototyped). Each roll-up stores its scope snapshot. The card prints "scope since the previous run: +a / −b items" with the removed items listed in the detail. Removing a differing item is then visible as a removal, not as an improvement.
- An adapter's declarations are part of the suite. Changing them goes through review like a vector change (CONTRIBUTING), never as a side effect of a run.

### 3.4 Confidence and measurement notes (always on the card)

- How measured: in process, stand-in carrier, real DIDComm, live. Wording per CONTRIBUTING.md: VTI "framework behaviour over HTTPS"; keyring-wallet "logic over a shim carrier"; truststackers "real stack, in process".
- Independence: platform rows are independent of the suite. The reference is not ("self-check, not a platform").
- Spec maturity strip (1.7). Commits measured, and the suite revision.
- <!-- lint:skip -->The claims lint (`src/glance/claims-lint.ts`) already covers `results/*.md`. The new page and blocks must pass it: never "conformant", "compliant" or "certified".<!-- /lint:skip -->

### 3.5 Run-count caveat

Every row is a single run (2026-11-19, rooms and ballot 2026-11-19/20). There is no repeat, so stability is not shown. The card prints "1 run, <date>; no stability check". Once repeat runs exist, the card would show "N runs, P stable" (the same item states in every run) or flag items that flip between runs. Quarantined vectors stay outside, as now.

### 3.6 Not a ranking

Cards appear in the fixed platform order: VTI, keyring-wallet, truststackers, then the reference. They are never sorted by P. There is no combined column, no "best".

---

## 4. Human-readable layout (templates ready to paste)

### 4.1 Headline sentence

With a figure:

> **{component}: {P}% conformance-implied agreement on the measured part of its declared scope** ({agrees} of {decided} tasks agree in every check that ran; measured {measured} of {declared} declared tasks, {M}%). {ceremony clause}

Without one:

> **{component}: insufficient evidence for a conformance-implied figure** ({reason}). Declared scope {declared} tasks; measured {measured} ({M}%), of which {agrees} agree. {ceremony clause}

Ceremony clause (by partner kind, never summed across kinds):

> Ceremonies with an original platform partner: {C}% completed or ended as specified ({n} of {ran} scenarios run{, k skipped}); ran together, never counted as conformance.

Filled (keyring-wallet, real data):

> **keyring-wallet (wallet logic, stand-in carrier): 90% conformance-implied agreement on the measured part of its declared scope** (75 of 83 tasks agree in every check that ran; measured 83 of 105 declared tasks, 79%). Ceremonies with an original platform partner: 74% completed or ended as specified (17 of 23 scenarios run, 5 skipped); ran together, never counted as conformance.

> **VTI agent service (VTA): insufficient gating evidence at the latest versions** (16% of the declared scope has a gating check). Declared scope 273 tasks; measured 45, of which 40 agree. Advisory reading (spec-derived checks, not gating): 94% of 242 measured (89%). Ceremonies with an original platform partner: 78% completed or ended as specified (14 of 18 run, 5 skipped); ran together, never counted as conformance.

### 4.2 One-screen card (per component)

```
┌ keyring-wallet · wallet logic behind a stand-in carrier · original · independent of the suite ┐
│ 90%  conformance-implied agreement on the measured scope                                          │
│      75 of 83 decided tasks agree · measured 83 of 105 declared (79%) · floor 71%                 │
│ Scope   105 tasks: sends 92 · serves 3 · framework rules 10 · 14 behind the latest version       │
│         source names 40 further tasks not in this declaration (newer checkout; see detail)        │
│ Not counted  behind 14 · no gating check 7 · contradiction 1 (framework/BND)                      │
│ Against      differs 8 (class A 49 checks, B 1, unclassed 1) · unexplained 0                      │
│ Checks       125 PASS · 30 CLARIFY · 62 KNOWN-FAIL (incl. 9 class D, 2 class C, outside P)        │
│ Advisory reading (not gating): 91% of 90 measured (86%)                                           │
│ Ceremonies (ran together, not conformance): original VTI 17/23 (74%) · oracle 38/42               │
│                                                                                                   │
│ Also measured over: real DIDComm v1, v2 (separate surfaces, not added)                            │
│ Specs: all draft (main) · 1 run, 2026-11-19 · keyring-wallet 62af4d2d4 (bifold 7e14c5124)         │
│ Older versions (non-focus): checks ran for 61 older task versions                                 │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

The truststackers card is one line: "Not reachable by the suite: no trust-task boundary upstream; no figure."

### 4.3 Expandable detail

1. **Per family.** One row per task family: items, agree / differ / unexplained / behind / no check / not reached, with links to the vectors. Example for keyring-wallet: `vta` 23 items (16 agree, 3 behind, 4 no check); `vtc` 25 (24 agree, 1 behind); `rooms` 8 (5 behind, 3 no check); `framework` 10 (4 agree, 5 differ, 1 contradiction).
2. **Per item.** Role, slug at the focus version, declared versions, gating state, advisory state, the vectors, and the exception or finding class with its link. This is already in the prototype JSON (`components[].items`).
3. **Per ceremony group.** Scenarios, completed, ended as specified, failed, incomplete, inconclusive, skipped, per partner. Example for keyring-wallet original with original VTI: FC-ACL 9 of 9; FC-DEV 3 of 7 (4 failed: VTI device codes); FC-VLT 2 of 2; FC-STU 5 skipped (host has no policy enforcement); FC-KVX 3 of 5 (2 failed).
4. **Why not counted.** A list of the behind, no-check, not-reached and contradiction items, each with its reason.
5. **Scope provenance.** Which declaration put each item in scope, and the source-scan-only tasks.

### 4.4 Plain-language explanations (one per state)

- **Agrees.** Every check that ran for this task matched what the specification text expects.
- **Unsettled.** The checks that ran hit points the specification leaves open (CLARIFY, or a difference classed C). Not counted for or against.
- **Differs.** At least one check found a recorded difference from the specification text (class A), or one where the suite may be reading the text too strictly (class B, under review). It counts against the platform until the review settles it.
- **Unexplained.** A check failed and no recorded exception or finding explains it yet. It counts against the platform and needs triage.
- **Behind the latest version.** The platform implements an older version of this task than the latest, so the latest version was not attempted. This is the platform's version lag, shown apart and not counted as a failure.
- **No gating check yet.** The suite holds no reviewed (gating) check for this task at its latest version. It may have advisory ones. This is a gap in the suite.
- **Not reached.** The platform declares the task, but the suite's test setup could not drive it (a stand-in, a host or a carrier limit). This is a limit of the suite, not of the platform.
- **Not run.** Checks exist, but no recorded run of this platform included them.
- **Declared but not offered.** The platform's declaration lists this task, but the run reported it as not offered. The declaration or the run needs a look.
- **Ceremony completed / ended as specified.** The two platforms went through the whole choreography, or ended in exactly the refusal the scenario names, on this date over this carrier.
- **Ceremony failed / incomplete / inconclusive.** It did not end as the scenario requires. The detail names the step and which side's behaviour (or which stand-in) stopped it.
- **Ceremony skipped.** The scenario could not be run with this pair (scope or host capability). It is not counted.

### 4.5 Ceremony pair view: keyring-wallet × VTI (shared-flow completion)

Rows are ceremony groups. Columns are pairs. Each cell is completed + ended as specified, over scenarios run (failed, skipped). There is no total across pairs. Real data:

| Group | KW unmod × VTI unmod agent | KW unmod × VTI unmod community |
|---|---|---|
| FC-ACL access list | 9 of 9 | |
| FC-DEV devices | 3 of 7 (4 failed) | |
| FC-VLT vault | 2 of 2 | |
| FC-STU step-up | 0 run (5 skipped) | |
| FC-KVX credential exchange | | 3 of 5 (2 failed) |

Headline line for the pair, original × original only: "keyring-wallet and VTI, both original, ran 23 shared ceremony scenarios together; 17 completed or ended as specified (74%). Ran together, one pair, one carrier (the runner's relay), one date; never counted as conformance, not demonstrated interoperation."

---

## 5. Where it goes in the suite (not implemented; plan)

| Piece | Where | Notes |
|---|---|---|
| Pure logic (item state, roll-up, guardrails, ceremony combine, headline text) | `src/glance/rollup.ts` | move from `scripts/rollup-prototype.ts` unchanged in behaviour; the CLI part becomes a generator |
| Number-free inputs | extend `results/at-a-glance.config.json` subjects with `components` (surfaces per component, role labels, source-scan key) and `results/ceremony-rows.json` rows with `parties` (replaces the prototype's hand table `CEREMONY_PARTIES`); thresholds in the config | one source of truth; no paths |
| Results inputs | `scripts/assemble-results-set.ts` + `results/ceremony-overlay.json` gain the advisory run sets and the FC-PER/DIR/VOT and live ceremony roots, so `--advisory`/`--ceremony-extra` disappear and the roll-up reads only `SUITE_RESULTS_DIR` | reproducible like the at-a-glance page |
| Prerequisite fix | `src/coverage/matrix/platforms.ts`: an explicit run-folder-to-platform map instead of the name regex (reach analysis rank 1); matrix inputs = the same assembled set | otherwise the coverage matrix and the roll-up disagree (today the matrix reads empty gating files for every platform) |
| Generated outputs | `results/rollup.md` and `results/rollup.json` (all cards, detail, pair view); block `generated:rollup` in `STATUS.md` (one headline sentence per component, above "Where each surface stands"); a "Fair summary" card section in `results/AT-A-GLANCE.md` and `.html`; block `generated:rollup-card` on each `results/platforms/*.md`; a short block in `results/README.md` | wired through `scripts/docs-blocks.ts`, `npm run regen`, `npm run check:docs` |
| Docs | `docs/14` new section "Scope-relative summary" (definitions 1.1 to 1.5, the guardrails, the wording); `docs/04` the generator; `docs/decisions/README.md` entry; the "How to read these results" box gains one line on P/M/C | the maintainers' guide "Communicating results" gains: P is always printed with M and D; ceremony C never added |

Tests required (beyond the 21 in the prototype, which move with the code):

1. Rule tests (as now): each result class's effect, precedence, the C/D handling, advisory kept out of gating, older vectors never measure the focus item, retired-to-successor, and serving and sending as separate items.
2. <!-- lint:skip -->Guardrail tests: the threshold withholds P; the headline always contains D and M; the scope-shrink test; the scope diff between two snapshots lists removals; declared-not-offered is reported; the claims lint passes on the generated page; and the word check (no bare "interoperable", "conformant", "compliant", "certified").<!-- /lint:skip -->
3. Separation tests: no component mixes surfaces from two subjects; ceremony kinds never summed (platform partner, oracle); C never appears inside P's computation (a ceremony record can be deleted without changing P).
4. Order test: cards in platform order whatever the values.
5. Generator freshness: `check:docs` fails when `rollup.md` or the blocks are stale; it runs with and without run records (without records: "no run records in this results directory", as the at-a-glance page does).
6. Golden test on a small fixture results directory: one component of each kind, expected JSON checked in (no real records in tests; tests never write outside a temp dir).
7. Non-vacuity: a reference mutant run fed as a "platform" yields differs or unexplained items and a lower P, so the roll-up sees a broken implementation.

---

## 6. Open questions for the project owner (recommendation first)

**Q1. Which checks feed P: gating only, or gating plus the advisory spec-derived checks at the latest version?**
Recommendation: **gating only for P, with the advisory reading printed as a labelled second line, and promote reviewed latest-version gap and coverage vectors into the registry channel**, starting with VTI's declared scope. Reason: this keeps the channel rule without exception, and it puts the visible gap (VTI M 16%) where the cause is, the suite.
- Gating only. Pros: obeys the existing rule; every counted check has been through the vector review. Cons: VTI and the reference get "insufficient evidence" until the promotion is done.
- Gating plus advisory. Pros: VTI gets a figure today (94% / 96%). Cons: changes the headline rule; counts unreviewed vectors (gap vectors are marked PROVISIONAL against branches; the oracle CLARIFYs 429); would also count the community's 18 advisory FAILs (12 explained as class C findings).

**Q2. Threshold for withholding P.**
Recommendation: **M ≥ 50% and at least 10 measured items**, as prototyped. Reason: it is the simplest rule a reader can check, and it was fixed before the data.
- Pros: clear, and hard to game with a tiny scope.
- Cons: a cliff (49% shows nothing; the counts are still shown).
- Alternative: show P for any M with a confidence band (for example a Wilson interval on decided items). That is more information, but harder to read and easy to quote without the band. I recommend against it for the headline. It could go in the detail.

**Q3. Denominator: adapter declarations only, or adapter declarations plus a source scan at the measured commit?**
Recommendation: **the union, once the matrix scanner can be pointed at the measured commits.** Until then, use adapter-only with the source-scan count printed beside it, as prototyped. Reason: the keyring-wallet shim under-declares what the wallet serves (3 declared vs 12 serving slugs in its code), which flatters the scope.
- Pros of the union: closest to "what it tries to implement"; resists Goodhart.
- Cons: the source scan is an upper bound (it matches literals and comments; the reach analysis notes this), and direction is unknown for most keyring-wallet names. Comment-only mentions must be stripped first.

**Q4. Class B differences: count against the platform, or as unsettled?**
Recommendation: **count against (as prototyped), with an "under review" sub-count.** Reason: a class can then only change through the vector review, never through the roll-up. Today there is 1 class B KNOWN-FAIL on keyring-wallet and 8 on VTI surfaces, so the effect is small either way.
- Cons: if the review later says the vector over-read the spec, the platform was marked down meanwhile.

**Q5. Item-level primary versus check-level primary.**
Recommendation: **item-level primary, check-level on the card.** Reason: the scope is tasks, and check counts per task vary by a factor of 40.
- Cons: one differing check marks a whole framework group, and the two figures can diverge (keyring-wallet 90% vs 71%). Both are shown.

**Q6. Framework rule groups per component.**
Recommendation: **follow the component's declared bindings** (BND only for HTTPS surfaces), and stop adding framework groups to surfaces whose run plan never includes them (the witness server over DIDComm). Otherwise mark those groups "not run". Reason: both of today's contradictions (`framework/BND` on the wallet shim, framework groups on the witness server) are scoping artefacts.

**Q7. Which surfaces become cards.**
Recommendation: **one card per component as in section 2.2.** That means VTI split into agent, community and client builders. keyring-wallet is one card (its receiving and sending runs on the shim surface already form one glance surface), plus a witness server card. VTI live gets no card until it is re-run. The project owner named "VTI agent, VTI community, keyring-wallet". I have no recommendation on whether VTI should also get one platform-level line combining its three components. The existing rule says surfaces are never combined, so I would not add one without a decision.

---

## 7. Data gaps and limits found (flagged, not fixed)

1. **The coverage matrix read no gating results.** In `matrix-set3`, every `run/results.json` (VTI and keyring-wallet) is empty, and the advisory files hold only coverage, gap and probe results. The matrix's per-platform "covered / skip / not run" therefore ignores every core, plain and emit run. That is the main cause of keyring-wallet "7 of 862" and of the identical 112 "not run" on every platform. The reach analysis found the same thing and traced it to the run-folder name regex in `src/coverage/matrix/platforms.ts`. The prototype avoids it by reading gating results through the glance model.
2. **Commit skew.** The declared scope comes from the measured builds (VTI `26d0da81`, keyring-wallet `62af4d2d4`). The source scans and the focus labels come from VTI main `71d524572`, keyring-wallet `969963df` and task force `bd0c05013`. "Behind" counts partly reflect the old measured builds: the reach analysis notes that `969963df` already names `acl` 0.3/0.4. A re-run on current checkouts is needed before the cards are published.
3. **Under-declaration.** The keyring-wallet shim declares 3 served task-force types against 12 serving slugs in code (Q3).
4. **Ceremony records outside the assembled set.** FC-PER, FC-DIR and FC-VOT were read from the persona-rooms-elections run folder. The 2026-11-20 live VTI ceremony rows were not read (D265 to D267 caveats). truststackers has no ceremony rows.
5. **Witness.** The server serves 0.1 and the vectors target 0.1 (D251), so it has no latest-version evidence.
6. **Exceptions without a class** (21 keyring-wallet, 6 VTI) are counted as differences, conservatively.
7. **Single runs**, dates 2026-11-19 and 2026-11-20 only. The 2026-11-14 live VTI surface is not used.
8. **D241** (webvh `update`/`rotate-keys`) is still open. The prototype maps those items to their successors, which shows as "behind" on VTI and keyring-wallet (`vta/dids/keys/rotate`, `vta/dids/update`, `vta/dids/list`).
9. **Vectors that name several tasks** are assigned to every focus item they name in their role, which is a simplification. A per-step mapping would be finer.

## 8. What was done, in short

- Read: the suite's contributor guide, README, STATUS.md, docs/14 (wording rules), docs/26 (ceremony rules), the glance model (`src/glance/model.ts`, `ceremonies.ts`, `claims-lint.ts`), `results/at-a-glance.config.json`, `skip-classes.json`, `ceremony-rows.json`, `coverage/matrix.json`, the exceptions and findings, the latest-suite report, the full-coverage decisions log, and the keyring-wallet reach analysis. docs/01, 02, 22, 28 and 27 to 32 were skimmed for structure only.
- Built the prototype on the suite's own glance model, so SKIP classes and stale exceptions are read exactly as the at-a-glance page reads them. Added 21 tests on synthetic inputs and ran the prototype on the real records. The figures in section 2 come from that run.
- Not done (by design): no integration into `regen`, no page edits, no full `npm test` run, no change to any existing branch, worktree, platform or run record.
