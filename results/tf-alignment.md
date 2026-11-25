# Task-force alignment report

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

> Draft proposal for discussion and review by the DTGWG. Every specification measured here is a draft; this report says nothing about adoption or endorsement.

Read: revision 98dda36f854ba028205923866450dbc1753c3bf6, commit 98dda36f854ba028205923866450dbc1753c3bf6 (2026-11-24).
The clone's remote main is 98dda36f8 (2026-11-24), 0 commits ahead of what was read.

## Is the suite's snapshot stale?

| Suite input | Commit | Known to checkout | In what was read | Commits read has beyond it | Commits it has beyond read |
|---|---|---|---|---|---|
| vectors/tf-manifest.json (main) | 98dda36f8 | true | true | 0 | 0 |
| vectors/tf-manifest.json (kit) | 98dda36f8 | true | true | 0 | 0 |
| vectors-src/gap/tf-snapshot.json | 98dda36f8 | true | true | 0 | 0 |
| vectors-src/complete/tf-extra.json | 98dda36f8 | true | true | 0 | 0 |
| vectors-src/coverage/tf-invalid-examples.json | 98dda36f8 | true | true | 0 | 0 |
| vectors/complete/not-generated.json (scope input) | 98dda36f8 | true | true | 0 | 0 |
| vectors-src/spec-hashes.json | 98dda36f8 | true | true | 0 | 0 |
| vectors/imported/PROVENANCE.json | 98dda36f8 | true | true | 0 | 0 |

Task specifications in what was read but not in the suite's manifest: 0. In the manifest but gone: 0. Retired since the manifest: 0.

## What the checkout holds

- Task specifications: 1427 (1351 draft, 76 retired)
- Per-task valid example files (payload.examples.json): 0
- Invalid-example files: 1088, holding 5272 examples
- Request examples written in the specifications: 1870; response examples: 1299
- Fixture files: 39; ceremony definitions: 3; ceremony invalid cases: 21
- Reference library test files: rust 1405 in 8 packages; typescript 17 in 5 packages; go 38 in 1 packages; dart 37 in 6 packages

## What the suite uses

Used = a suite vector carries a payload equal to the example, as a document of the example's own variant: a request entry in a request, a response entry (`variant: response`) in a response; a response entry sent as a request is never counted. Suite tokens match a value of their own kind (a clock token only an RFC 3339 date-time, any other token only a string). "Expects a refusal" is judged per step. Named only = a vector for the task cites its invalid examples, but this one was not matched. These are reach figures: nothing here says a platform passes.

| Item | Count | Of | Share |
|---|---|---|---|
| Invalid examples used (all sets) | 4247 | 5272 | 80.6% |
|   of those, without the advisory alignment set | 3451 | 5272 | 65.5% |
|   of those, in a step that expects a refusal | 4240 | 5272 | 80.4% |
| Request entries (not marked `variant: response`) used | 4247 | 4421 | 96.1% |
| Response entries (`variant: response`) used in a response | 0 | 851 | 0.0% |
| Response entries whose payload equals a request a vector sends (a coincidence such as `{}`; not counted as used) | 43 | 851 | 5.1% |
| Invalid examples named only | 955 | 5272 | 18.1% |
| Invalid examples not mapped | 70 | 5272 | 1.3% |
| Request examples used | 546 | 1870 | 29.2% |
| Tasks with a vector step | 1417 | 1427 | 99.3% |
| Tasks named only in text | 1 | 1427 | 0.1% |
| Tasks with no vector at all | 9 | 1427 | 0.6% |
| Fixture files imported unchanged | 39 | 39 | 100.0% |
| Fixture files used by a vector | 35 | 39 | 89.7% |
| Ceremony definitions with a scenario | 3 | 3 | 100.0% |

Why invalid examples were not matched:

- taskRetired: 14
- taskNotInSuite: 8
- taskInSuiteNoVectorFromExamples: 50
- taskVectorFromExamplesButThisOneNotMatched: 953

## Citations

- Trust Tasks files the vectors cite: 1435; no longer in the checkout: 0; only on a pull request or branch (cited at that head, so not missing): 3
- Vectors whose recorded text hash was re-checked: 9083; unchanged: 9083; files whose text changed: 0
- Imported fixture files no longer in the checkout: 0; changed since import: 0; checkout fixtures not imported: 0
- ceremonies/mutual-attestation/0.1/ceremony.json: 3 scenarios cite it; quoted checksum current
- ceremonies/vetting/identity-vetting/0.1/ceremony.json: 7 scenarios cite it; quoted checksum current
- ceremonies/vtc/member-onboarding/0.1/ceremony.json: 14 scenarios cite it

Full lists are in tf-alignment.json.
