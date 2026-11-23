# 17. Governance probes (advisory)

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. Nothing here is an adopted or endorsed rule. Nothing from this folder has been filed with, or sent to, any project.

## 1. The principle, and what follows from it

Governance (which roles exist, what they mean, who may grant what, how many approvers a task needs) is the end user's choice. A conformance suite never decides it. This family therefore does one narrow thing: it checks whether a platform lets a governance value be **declared**, and whether the platform **applied** what was declared. It reports the result as separate advisory findings.

Four rules follow, and a test enforces the first three:

1. **No governance value is built into a probe.** Every role name, authority rule and number a probe uses is a nonce it declares itself (`gov-r1-3fa9c2b1`). A probe never names a role a platform defines.
2. **No ruling.** A finding states what was declared and what was observed. It says nothing about whether either is appropriate. A built-in default that a deployer can override is not a finding; the finding is that no declaration path exists, or that a declaration was not applied.
3. **Advisory only.** Findings are kept out of PASS, FAIL, SKIP, KNOWN-FAIL and CLARIFY, out of tier roll-ups, headline totals, the vacuous-pass rule and the exit code. The governance command always exits 0 on findings. The one exception is GOV-DECLARATION-MISMATCH (section 2.1), which is not a finding about governance at all but about the adapter's own declaration.
4. **No order of merit.** Platforms appear alphabetically. A cell is a list of counts in words, with no colour.

## 2. Finding kinds

| Kind | Meaning |
|---|---|
| `GOV-HONOURED` | The declaration was applied. Shown so that a clean result is visible. |
| `GOV-FIXED` | A value the adapter declared was not applied: refused, ignored, or replaced by a built-in. It reports declaration support only. Also given, by itself, when an adapter states its essential governance E as a fixed built-in rule of the platform (`source: fixed-rule`, section 2.1): E is still filled and the vectors run against it. |
| `GOV-DEFAULT` | Nothing was declared for an item, and the platform stated or applied a value for it as if one had been given (an implied role, quorum or requester rule). |
| `GOV-NOT-PROBED` | No declaration path was exercised. The reason is stated (`governance-undeclared`: the adapter declares no path, or not the item the probe needs; or the platform does not serve the task). Also given when E is unreadable, or names principals the harness cannot drive, so the honesty check cannot probe it (section 2.1). It is never a negative finding. |
| `GOV-DECLARATION-MISMATCH` | The adapter honesty check observed behaviour that does not match the essential governance E the adapter declared (section 2.1). The one kind that gates. |
| `GOV-EVIDENCE` | A row of static evidence (section 6). Not a test result. |
| `GOV-SPEC` | Static evidence whose source is the specification text; it is addressed to the specification owners and not attributed to a platform's code. |

### Wording

Every finding sentence comes from one template per kind (`src/governance/findings.ts`):

- Declared `<item>`; the platform applied `<observed>`. This reports whether a declaration was honoured. It makes no statement about whether the observed behaviour is appropriate.
- Not probed: `<reason>`. No declaration was exercised, so this reports nothing about the platform.
- Declared essential governance `<declared>`; the harness observed that `<observed>`. The declaration does not match the behaviour, so the results that rest on it are recorded as FAIL. This reports whether the adapter's declaration matches the platform and makes no statement about whether the platform's governance is appropriate.

A lint (`bannedWordsIn`) is run over every generated finding, the banner, the Markdown and JSON reports, the probe files, the evidence data and this document. It rejects words that rule on governance or order platforms. The list is in the source; a document may name it only inside a `lint:skip` block.

<!-- lint:skip -->
Banned (whole words, any case): wrong, bad, violates, non-compliant, fails governance, fails, should have, weak, insecure, broken, rank and its forms, score and its forms, best, worst, better, worse, grade.
<!-- /lint:skip -->

### 2.1 Essential governance (E), extended governance (X), and the one gating kind

The suite separates two tiers of governance ([decision 39](decisions/04-ceremonies-governance-and-exceptions.md#d39); docs/02 section 5.1):

- **E, essential governance:** the platform's authority set (the principals who may decide a held task) and `minApprovals` k. The adapter states it in `capabilities.governance.essential` (docs/04 section 19.1) from the platform's configuration, from the configuration the harness gave the platform for the run, or from a fixed built-in rule; the suite records it in run.json and never asserts what it should be. The ceremony vectors run relative to it: `registry` CER-001, 002, 005, 015 and the task-consent family reach their holds through it, and the `candidate` vectors CER-017 (completion exactly at the k-th distinct approval), CER-018 (an outsider's approval refused and not counted) and CER-019 (a repeat not counted twice) measure behaviour against it (docs/04 section 11.4). A fixed built-in rule still fills E and is reported as GOV-FIXED; an unreadable E is reported as GOV-NOT-PROBED, and the per-E vectors are SKIP "authority set unreadable". A declared set of one is labelled *single-party* at a glance.
- **X, extended governance:** everything else (role names and hierarchy, delegation, step-up policy, `sealBeforeGrant`, `termsRef`, the source of authority, provisioning, policy content). X is reported only by the advisory probes of this document.

**GOV-DECLARATION-MISMATCH.** Because the ceremony vectors trust the declared E, the harness checks the declaration against behaviour in every suite run, with a probe of its own that an adapter cannot opt out of (the adapter honesty check, `src/runner/honesty.ts`, docs/04 section 11.4): completion exactly at the declared k-th distinct approval, and an approval (or, where nothing can be held, a begin) from a principal outside the declared set not counted. When the behaviour differs, the run records a GOV-DECLARATION-MISMATCH finding (probe id `essential-declaration`), every result that rests on E becomes FAIL, and the exit code is non-zero whatever the channels. It is the only GOV-* kind that gates, and that does not break rule 2: it does not rule on governance. It says that the adapter's statement about the platform is not what the platform does, so the results computed from that statement cannot stand. A platform whose adapter declares a set of one, and which in fact accepts a second principal's decision, is reported this way; so is one declaring k = n that completes earlier or later. Where the platform offers no ceremony the check is not run and gives no finding.

## 3. How a probe works

1. The runner reads `capabilities.governance.declaration`. Only `supported` (with the optional capability `governance.declare` and a `declareGovernance` method) runs a probe; `none` and `unknown` give GOV-NOT-PROBED for every probe.
2. The probe generates a nonce declaration and calls `declareGovernance`. `rejected` is GOV-FIXED ("a refusal of the declaration"); `unsupported` is GOV-NOT-PROBED.
3. It exercises the platform with ordinary tasks, signed by harness actors (`acl/grant` 0.3, `acl/list` 0.4, `policy/evaluate` 0.4), and compares each outcome with the declaration only.
4. It records one finding.

The adapter contract change is additive and is written in docs/04 section 19.

## 4. The probes (`vectors/governance/gov.json`, group GOV)

All five are in the `candidate` channel: the task text they rest on is in the registry package, but the declaration they make is suite-local text with no task-force home, so they are `candidate`, not `proposed` (docs/04 section 18.6). No platform implements a declaration path, so `implementedBy` is empty with a note. They are suite instruments, not behaviour a platform could adopt, so each also carries `probe: true` (docs/04 section 18.1): wherever channel counts are shown they are counted as `probe`, apart from the candidates (the families block of `results/README.md` has a "governance probes" row), and the candidate figures (32 in core: WSH-001 to 023, TD-001 to 006, CER-017 to 019) hold only adoptable behaviour. The governance loader refuses a probe without the marker. Each carries `source` (pinned to the package digest), citations, and the evidence rows that sit beside it.

| Id | Kind | What is checked | Findings it can give |
|---|---|---|---|
| GOV-D-001 | differential | A declared role name is accepted when granted, held, and listed under that name; a refusal that names the known roles names the declared set. | HONOURED, FIXED |
| GOV-D-002 | default | A role that was not declared is refused and no entry is held for it (acl/grant 0.3: an unrecognised role confers nothing and has no default role). | HONOURED, DEFAULT |
| GOV-D-003 | differential | A declared who-may-grant-what rule decides five grants as declared. The rule is chosen so that no flat or positional rule agrees with it. | HONOURED, FIXED |
| GOV-D-004 | differential, then default | A declared consent rule (quorum and requester rule, declared twice with different values) comes back in a `requireConsent` decision with the declared values; omitted values count as a value left to the receiver (policy/_shared 0.4: both required, no default). | HONOURED, FIXED, DEFAULT |
| GOV-D-005 | default | A principal the declaration does not name is refused, not treated as holding a role. | HONOURED, DEFAULT |

Not built, and why: seal-before-grant and `termsRef` digest checks (they need draft text with no agreed citation route), retention and expiry substitution, default-allow versus default-deny posture, and the opt-in probe of host invariants (GOV-D-005 in the audit, renumbered here; the invariants protect against escalation and whether a deployment may switch them off is for the task force). Self-reported `declaration: none` is shown as GOV-NOT-PROBED, not as a finding the suite did not observe.

## 5. Non-vacuity

The reference adapter honours a declaration when started with `governance: true` (`reference-governance`). Seven mutants (`src/adapters/reference/governance.ts`) each change one behaviour, and `test/governance.test.ts` requires the matching finding: ignoring the declaration gives GOV-FIXED on D-001, D-003 and D-004; asserting a default role for an unknown role gives GOV-DEFAULT on D-002; a built-in authority rule gives GOV-FIXED on D-003 and D-001 (it also refuses the grant D-001 declares); an implied principal gives GOV-DEFAULT on D-005; an omitted quorum gives GOV-DEFAULT on D-004; a fixed quorum gives GOV-FIXED on D-004; holding an entry under another role gives GOV-FIXED on D-001. Every probe not named stays HONOURED under each mutant.

The honesty check has its own non-vacuity: lying variants of the reference adapter (`DECLARATION_LIES` in `src/adapters/reference/mutants.ts`, adapter name `reference-lie-<id>`) keep the declared E but behave otherwise: `completesEarly` (the effect one approval before k), `completesLate` (one after) and `anyPrincipalDecides` (a principal outside the set is counted). `test/honesty.test.ts` requires each to be caught with GOV-DECLARATION-MISMATCH, the E family turned FAIL and a non-zero exit code, as are the quorum mutants `cerQuorumEarly` and `cerQuorumLate`, and requires the honest reference at k = 1 to 4 to be consistent. One case cannot be told apart and is not claimed: `completesEarly` at k = 1 where the begin counts as an approval.

## 6. Static evidence

`results/governance-evidence.json` holds what the governance audit ([proposals/governance-baked-in-audit.md](proposals/governance-baked-in-audit.md)) read in the code of three platforms, with file, line, commit, whether a declaration path exists, whether the text of the specification fixes the value, and a kind. It is data, never executed, shown as "Static governance evidence (not a test result)", alphabetical by platform, never counted. Every row was re-read at its location before inclusion; rows that could not be re-read were left out (the audit has more rows than this file). A test checks that each cited line exists where a local checkout is present.

## 7. How to read a result

- A cell such as `honoured 3 / declared value not applied 1 / not probed 1` is five separate observations. It is not a mark of quality and cannot be compared across platforms measured in different ways.
- `not probed` is reach: the adapter could not give the platform a declaration. It says nothing about the platform.
- `declared value not applied` says the platform was given a value and applied another. A deployer may have good reason for that; the finding records only that the declaration had no effect.
- A finding on a `candidate` probe is "against a proposal": the declaration itself is not yet task-force text.

## 8. How it relates to channels (docs/04 section 18)

Channels say how mature the text under a vector is; governance findings say whether a declaration was honoured. They are independent: a probe carries a channel (`candidate`) and the `probe` marker, which keeps it out of the candidate counts, and its findings are advisory whatever the channel. Hiding a channel changes nothing outside the advisory output. The registry-only default run of the reference adapter (343 core, 540 plain, 179 emit vectors, docs/04 section 18.3) is pinned by a test.

## 9. Running it

```
npm run governance -- --adapter reference-governance --adapter reference --out <out dir>
npm run governance -- --adapter 'governance-mutant:govAssertDefault'
npm run governance -- --adapter 'stdio:<launcher command>' --timeout 120000
```

Outputs `governance-advisory.md` and `governance-advisory.json`, with the static evidence appended when `results/governance-evidence.json` exists. Regenerate the probe file with `node --experimental-strip-types scripts/generate-governance.ts`. Run folders: `<results dir>/runs/2026-11-15-governance-probe-*/`.

## 10. Not yet done

- The governance column is a separate report; it is not yet a column of the main capability matrix.
- Platform adapters and `declareGovernance`: keyring-wallet is reported GOV-NOT-PROBED. The VTI community-service adapter in its in-process host mode (`src/adapters/vti/`) implements it through the VTC's own `vtc/roles/define/0.1`; the VTC answers that defining a role needs the consent of another administrator and the requester's step-up factor (a passkey or an enrolled approver), which the harness does not hold, so every probe is GOV-NOT-PROBED with the VTC's own words (`<results dir>/runs/2026-11-15-vti-reach-governance-vtc/`). The agent service (VTA) has a closed role enum and no declaration path (`...-governance-vta/`).
- The probes speak the older `acl/grant` 0.2 and `acl/list` 0.3 when a platform serves only those (`TASK_VERSIONS` in `src/governance/probes.ts`; the 0.2 entry has no `purposes` member).
- GOV-D-004 reads the consent decision a platform states for a declared rule; the check over a real ceremony (a platform holding a task for its declared number of approvers) is the adapter honesty check of section 2.1, which runs only where the adapter offers ceremonies. No VTI or keyring-wallet adapter offers `optional:ceremony`, so their declared E is recorded and shown, and the check is not run for them.
