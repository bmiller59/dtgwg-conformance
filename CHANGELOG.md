# Changelog

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

All notable changes to the suite are listed here, newest first, in the style of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow the semver policy in [docs/04 section 20.2](docs/04-suite-design.md#202-suite-versions-semver): major when an expectation or the gating set changes, minor for added non-gating vectors or additive tooling, patch for documentation. While the suite is a draft (`0.y.z-draft`), a minor step may carry what would otherwise be a major change; such entries are marked **gating**. Results and claims cite vectors as `<version>/<id>` ([section 20.3](docs/04-suite-design.md#203-vector-ids-never-reused-retired-rather-than-deleted-cited-with-the-version)).

## [0.1.0-draft]

The initial release: a draft proposal for review, not an adopted or endorsed suite.

### Added

- **Black-box vectors and adapters.** JSON test vectors for Trust Tasks documents, run against a platform through an adapter that speaks the suite's contract (in-process, standard input and output, HTTP, DIDComm). Vector groups cover the plain tasks, the framework tasks, emitted documents, the registry-promoted coverage and gap families, governance probes, the application profiles (`vectors/2l`), the Trust Tasks specification alignment set and imported task-force fixtures.
- **Channels.** Every vector sits in a channel (`registry`, `pr`, `proposed`, `candidate`). Only reviewed `registry` vectors gate; the rest are advisory. Promotion criteria, a pre-screen and a review check are scripts ([docs/33](docs/33-registry-promotion.md)).
- **Ceremony scenarios.** 163 scenarios in 21 groups, run by `npm run ceremony` between two or more parties, with evidence levels for what each run shows.
- **Governance and the adapter honesty check.** Adapters declare the authority set and threshold for approvals; the runner probes the declaration against behaviour (GOV-DECLARATION-MISMATCH).
- **Exceptions, SKIP classes and quiet periods.** Platform differences are recorded as cited exceptions per surface, SKIP is allowed only from a cited `notOffered` entry, and no-reply verdicts need a minimum quiet period.
- **Results and coverage tooling.** A coverage matrix per task version (latest versions are the focus), VTI roles per surface, keyring-wallet reach by role, estimated coverage, reverse traceability, artifact-crossed replay, independent-implementation counts and a roll-up prototype. Run records are kept outside the repository ([docs/04 section 21](docs/04-suite-design.md#21-where-run-records-live-built)).
- **Provenance and policy.** `run.json` in every run folder, the vector id policy (ids are never reused; retired vectors stay as tombstones), the semver policy above, pins to one task-force commit with a pin-agreement check, and a neutrality and conflict-of-interest note ([decisions.md](docs/decisions/01-constraints-and-process.md#neutrality)).
- **Documentation.** A README with the layer map, a quick start, a choose-your-path table and walk-throughs for running, adding a platform and adding vectors; the layer model, the decision register and the design documents under `docs/`.
- **Licence and attribution.** Apache-2.0 code; NOTICE attributes the Trust Tasks specification material under the Open Web Foundation Final Specification Agreement 1.0; contributions use the Developer Certificate of Origin 1.1.

[0.1.0-draft]: #010-draft
