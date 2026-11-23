# Task-force alignment report

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

> Draft proposal for discussion and review by the DTGWG. Every specification measured here is a draft; this report says nothing about adoption or endorsement.

Read: revision origin/main, commit bd0c05013277b83f23fa90db699671ebb48dd24c (2026-11-19).
The clone's remote main is bd0c05013 (2026-11-19), 0 commits ahead of what was read.

## Is the suite's snapshot stale?

| Suite input | Commit | Known to checkout | In what was read | Commits read has beyond it | Commits it has beyond read |
|---|---|---|---|---|---|
| vectors/tf-manifest.json (main) | bd0c05013 | true | true | 0 | 0 |
| vectors/tf-manifest.json (kit) | bd0c05013 | true | true | 0 | 0 |
| vectors-src/gap/tf-snapshot.json | bd0c05013 | true | true | 0 | 0 |
| vectors-src/complete/tf-extra.json | bd0c05013 | true | true | 0 | 0 |
| vectors-src/coverage/tf-invalid-examples.json | bd0c05013 | true | true | 0 | 0 |
| vectors/complete/not-generated.json (scope input) | bd0c05013 | true | true | 0 | 0 |
| vectors-src/spec-hashes.json | bd0c05013 | true | true | 0 | 0 |
| vectors/imported/PROVENANCE.json | bd0c05013 | true | true | 0 | 0 |

Task specifications in what was read but not in the suite's manifest: 0. In the manifest but gone: 0. Retired since the manifest: 0.

## What the checkout holds

- Task specifications: 1417 (1342 draft, 75 retired)
- Per-task valid example files (payload.examples.json): 0
- Invalid-example files: 1086, holding 5252 examples
- Request examples written in the specifications: 1853; response examples: 1289
- Fixture files: 39; ceremony definitions: 3; ceremony invalid cases: 21
- Reference library test files: rust 1395 in 8 packages; typescript 17 in 5 packages; go 38 in 1 packages; dart 37 in 6 packages

## What the suite uses

Used = a suite vector sends a payload equal to the example (suite tokens such as minted ids match anything). Named only = a vector for the task cites its invalid examples, but this one was not matched. These are reach figures: nothing here says a platform passes.

| Item | Count | Of | Share |
|---|---|---|---|
| Invalid examples used (all sets) | 5025 | 5252 | 95.7% |
|   of those, without the advisory alignment set | 4109 | 5252 | 78.2% |
|   of those, in a vector that expects a refusal | 5022 | 5252 | 95.6% |
| Invalid examples named only | 165 | 5252 | 3.1% |
| Invalid examples not mapped | 62 | 5252 | 1.2% |
| Request examples used | 547 | 1853 | 29.5% |
| Tasks with a vector step | 1416 | 1417 | 99.9% |
| Tasks named only in text | 1 | 1417 | 0.1% |
| Tasks with no vector at all | 0 | 1417 | 0.0% |
| Fixture files imported unchanged | 39 | 39 | 100.0% |
| Fixture files used by a vector | 35 | 39 | 89.7% |
| Ceremony definitions with a scenario | 3 | 3 | 100.0% |

Why invalid examples were not matched:

- taskRetired: 12
- taskNotInSuite: 0
- taskInSuiteNoVectorFromExamples: 50
- taskVectorFromExamplesButThisOneNotMatched: 165

## Citations

- Trust Tasks files the vectors cite: 1433; no longer in the checkout: 0; only on a pull request or branch (cited at that head, so not missing): 3
- Vectors whose recorded text hash was re-checked: 9076; unchanged: 9076; files whose text changed: 0
- Imported fixture files no longer in the checkout: 0; changed since import: 0; checkout fixtures not imported: 0
- ceremonies/mutual-attestation/0.1/ceremony.json: 3 scenarios cite it; quoted checksum current
- ceremonies/vetting/identity-vetting/0.1/ceremony.json: 7 scenarios cite it; quoted checksum current
- ceremonies/vtc/member-onboarding/0.1/ceremony.json: 14 scenarios cite it

Full lists are in tf-alignment.json.
