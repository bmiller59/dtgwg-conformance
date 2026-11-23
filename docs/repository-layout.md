# Repository layout

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

What each folder holds, in more detail than the README's folder overview. Every task specification involved is draft. The layer, channel and platform map is [where everything sits](community/where-everything-sits.md).

## Data

| Path | What it holds |
|---|---|
| `vectors/` | The test vectors (JSON), one file per group, generated. `vectors/ceremony-scenarios/` holds the ceremony scenarios; `vectors/imported/` holds task-force fixtures copied unchanged (checksums in `vectors/imported/PROVENANCE.json`). |
| `vectors-src/` | Hand-written generator inputs and the vector id ledger (`id-ledger.json`). |
| `schema/` | JSON Schema for the vector and scenario formats. |
| `exceptions/` | Recorded differences (`exceptions.json`), each with a reason, an owner and an expiry date; flaky vectors (`quarantine.json`). |
| `results/` | Results tooling inputs and review records: the review of every recorded difference (`vector-review.md`), the statement-to-vector map (`traceability.md`), task-force alignment (`tf-alignment.md`), SKIP classes, findings, and a template for a run folder. Run records and dated results are kept outside the repository ([docs/04 section 21](04-suite-design.md#21-where-run-records-live-built)). |

## Code

| Path | What it holds |
|---|---|
| `src/adapter/` | The adapter contract, the runner's client and a server helper. |
| `src/adapters/` | The adapters: `reference/` (the suite's own stand-in and its mutants), `example-server/` (start here for a new adapter), `vti/`, `vti-inprocess/`, `vti-live/`, `vti-emit/`, `vti-ballot/` (VTI surfaces), `keyring-wallet/`, `keyring-wallet-didcomm/`, `keyring-wallet-vta-wire/` and `witness-server/` (keyring-wallet surfaces). |
| `src/runner/` | The runner: engine, command line (`npm run suite`), clock and window handling, matrix. |
| `src/ceremony/` | The ceremony-scenario runner (`npm run ceremony`). |
| `src/vectors/` | Loading and validating vectors. |
| `src/carriers/`, `src/crypto/`, `src/util/` | Carriers (HTTPS, DIDComm), cryptographic helpers and shared utilities. |
| `src/coverage/`, `src/glance/`, `src/traceability/`, `src/promotion/` | Coverage matrix, the at-a-glance model, specification traceability and registry-promotion tools. |
| `src/tfalign/` | The task-force alignment tool (`npm run tf-alignment`, [tf-alignment.md](tf-alignment.md)). |
| `src/crosscheck/`, `src/crossed/`, `src/governance/`, `src/plain/` | The cross-check harness, the crossed replay, governance probes (`npm run governance`) and the plain-task builders. |
| `scripts/` | The vector generators (`generate-*.ts`), `regen.ts` (runs every generator, `npm run regen`) and maintenance tools, including `community-open-gaps.ts`. |
| `test/` | The suite's own tests (`npm test`). |

## Documents

| Page | What it holds |
|---|---|
| [docs/README.md](README.md) | The documentation index, with reading paths. |
| [docs/community/](community/index.md) | The way in for contributors. |
| [platforms.md](../platforms.md) | The platforms measured, their role and adapters. |
| [docs/37-vector-completeness.md](37-vector-completeness.md) | The completion vectors and how their coverage is measured. |
| [docs/tf-alignment.md](tf-alignment.md) | How the suite uses the Trust Tasks repository and how to check it. |
| [CHANGELOG.md](../CHANGELOG.md) | Suite versions and vector changes. |

Back to the [repository README](../README.md).
