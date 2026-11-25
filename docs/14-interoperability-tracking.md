# Interoperability tracking: conformance-implied and demonstrated

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

> **Priority.** This tracking is important, and it is **not the current focus**. It is planned for later. What exists today is the format, an empty ledger of demonstrated executions and a pair matrix computed from the current results. Nothing here is a claim that any two platforms interoperate.

This page uses the vocabulary of [12-interoperability-interworking-meta-layer.md](12-interoperability-interworking-meta-layer.md) (credit: [CREDITS.md](CREDITS.md)). It adds one distinction the suite needs in order to say what its results do and do not show.

## 1. Two kinds of evidence

| | (a) CONFORMANCE-IMPLIED | (b) DEMONSTRATED |
|---|---|---|
| What it is | Each platform, measured alone against the same vectors, did what the standard-based vector expects. So a client or server from another platform that follows the same standard could in principle exchange those trust tasks with it. | A recorded cross-platform execution: one platform sent a real document, another received it, and the outcome was kept as an artefact. |
| Who acts | The suite, against one platform at a time. | Two real platforms. |
| What it can say | "The results indicate that a pairing should work for these vectors." | "This pairing did work (or did not) on this date, for this task and carrier." |
| What it cannot say | That the pair interoperates. A vector can pass on both sides while the two sides still fail to talk (different carrier, different version choice, different reading of an open point). | Anything about tasks or versions not exercised. |
| Evidence today | Yes: the pair matrix, ../results/interop/pair-matrix.md. | **None.** The ledger is empty: [../results/interop/ledger.md](../results/interop/ledger.md). |

A third kind, (c) ARTIFACT-CROSSED, sits between the two: documents one platform emitted, relayed by the suite's runner into another platform's receiver adapter. It is defined in [section 7](#7-artifact-crossed-evidence-runner-relayed-documents); it is never (b) and never a conformance count.

**Conformance does not demonstrate interoperation.** Today only conformance-implied evidence exists. "Conformance measured", used on the at-a-glance page, means the same as (a) conformance-implied. No live cross-platform exchange has been recorded in any run, and the suite itself never makes two platforms exchange documents with each other.

### Wording rules

1. Never write "interoperable" or "interoperability achieved" without saying which of (a) conformance-implied or (b) demonstrated is meant. Today the only available answer is (a), and the phrase should say so ("conformance-implied agreement on N vectors").
2. "Both PASS" is a statement about two separate measurements on the same vector, never about an exchange between the two.
3. A SKIP is never counted as agreement. A pair figure always carries both the number run and the number that agreed.
4. Name the platform surface. VTI and keyring-wallet each have several measured surfaces (section 2); they are never combined.
5. truststackers: the original platform is not reachable by the suite (no vector could run; see results/README.md). It appears in no pair matrix row and in no ledger entry.
6. State the roles (section 2) when a pair is described: a client/sender result and a server/receiver result are different evidence.
7. Pair figures are not a ranking.

## 2. Roles: which side each platform is measured on

Trust tasks have a sender (client side: builds and signs the document) and a receiver (server side: validates, acts and answers). Vectors in the core families send documents to the implementation, so they measure the **receiver** side. The producer (emit) class (`vectors/emit`, [04-suite-design.md](04-suite-design.md) section 11.8) checks documents the implementation **sends**, so it measures the **sender** side. A client/server pairing is implied only where one platform's sender evidence and the other's receiver evidence exist for the same task and version.

| Platform surface | Receiver / server side | Sender / client side |
|---|---|---|
| VTI community service, live over HTTPS | Measured (recorded earlier, not re-run) | Not measured |
| VTI community service, in process | Measured | Not measured |
| VTI agent service handlers, in process | Measured | Not measured on this surface |
| VTI sending side (VTI's own client code) | Not measured on this surface | Measured: the emit and emit-more classes |
| keyring-wallet behind a stand-in carrier | Measured | Measured, partly: the emit and emit-more classes |
| keyring-wallet over real DIDComm (Credo agent, DIDComm v1) | Measured | Measured, partly: the emit and emit-more classes |
| keyring-wallet witness server over real DIDComm | Measured (witness vectors) | Not measured |
| truststackers (original) | Not reachable by the suite | Not reachable by the suite |

The figures for every surface are generated locally by `npm run regen` (STATUS.md, results/README.md) and are not published ([D959](decisions/06-runs-and-results.md#d959)); dated results are published separately and are not part of this repository. Every SKIP is classified; a "not reached" SKIP is a limit of the suite's test setup, not of the platform ([glossary](03-glossary.md#status-codes-and-plain-words)).

## 3. Conformance-implied evidence today: the pair matrix

../results/interop/pair-matrix.md (and `pair-matrix.json`) is computed by `scripts/interop-matrix.ts` from the final `results.json` of each surface (Tier 1), per pair and per conformance group. The groups are the finest grain the results carry; a group covers one task or one framework rule, and a finer per-task, per-version mapping is a later extension. The figures are in the generated pair matrix; this page states none.

The pair figures are receiver-side. They are conformance-implied, they cover only the vectors that could be run, and none of them is demonstrated interoperability. Re-run the script after any new result; `--check` fails when the files on disk are out of date.

## 4. The ledger of demonstrated executions

Files under [../results/interop/](../results/interop/):

| File | Purpose |
|---|---|
| `ledger.schema.json` | Schema of the ledger (`tt-interop-ledger/0.1`). |
| `ledger.json` | The ledger itself. **Seed: empty.** |
| `ledger.md` | Markdown view, generated; says plainly when the ledger is empty. |
| `pair-matrix.json`, `pair-matrix.md` | The conformance-implied matrix (section 3), generated. |

### Entry format

One entry per recorded execution (a real document sent by one platform and received by another):

| Field | Meaning |
|---|---|
| `id` | `IX-001`, `IX-002`, ... |
| `date` | Date of the execution (`YYYY-MM-DD`). |
| `sender`, `receiver` | `platform` (VTI, keyring-wallet or truststackers-original), `version` (commit or release), optional `surface`. The two must be different platforms. |
| `task`, `version` | Trust Task slug and version, for example `acl/list` and `0.3`. |
| `carrier` | `https`, `didcomm-v1`, `didcomm-v2`, `tsp` or `other` (with `carrierNote`). |
| `evidence` | At least one repository-relative path or public URL to the recorded artefact (captured documents, logs). An entry without an artefact is not admitted. |
| `outcome` | `accepted`, `rejected-as-specified`, `failed` or `inconclusive` (with `outcomeNote`). |
| `related` | Optional run folders or vector ids. |

### Markdown view generator (built)

`scripts/interop-ledger-view.ts` validates `ledger.json` (the rules above; a failing entry stops the run) and writes `ledger.md`: when there are no entries it writes the sentence "No cross-platform execution has been recorded" and points at the pair matrix; otherwise one table row per entry (id, date, sender, receiver, task@version, carrier, evidence, outcome), in id order. `--check` fails if `ledger.md` is stale. The tests in `test/interop.test.ts` cover validation (no evidence, bridge as a party and same-platform pairs are refused) and the matrix.

### What a first entry needs (planned, not started)

A live exchange needs a carrier both sides really offer, which today is the open point: keyring-wallet is measured behind a shim, and VTI's agent handlers run in process. The DIDComm carrier in [13-didcomm-carrier-and-witness-server.md](13-didcomm-carrier-and-witness-server.md) and the wallet's DIDComm v2 option ([15-keyring-wallet-didcomm-v2.md](15-keyring-wallet-didcomm-v2.md)) are the candidates. Sequencing: [16-roadmap-and-decisions.md](16-roadmap-and-decisions.md).

## 5. Wording for docs/12 and the artifact

docs/12 and the published summary page are worded as follows. This wording is applied in docs/12. Republishing the summary page with it is an open item in [docs/16, What remains](16-roadmap-and-decisions.md#8-what-remains-in-order).

- Replace "interoperability is what the suite measures" with: **"The suite measures conformance to the standard, platform by platform. It does not measure interoperation between platforms. Conformance-implied agreement (both platforms did what the vector expects, each measured alone) is recorded in the pair matrix; demonstrated interoperation (a recorded exchange between two platforms) has not been recorded."**
- Replace "none of these pairs shows interoperability achieved" with: **"These pairs are conformance-implied only. No pair has a demonstrated exchange."**
- In every table that uses the status word "Achieved in tests", add the clause "conformance measured, not interoperation demonstrated".
- For truststackers, say: **"The truststackers original is not reachable by the suite: no trust-task boundary exists upstream, so no vector could be run."**
- Never use "interoperable" for a platform or a pair without (a) or (b).


## 6. truststackers: the original repository, not reachable by the suite

truststackers is reported as one platform here: **truststackers (original)**, the TrustStackers/p2p-trust-stack repository at its upstream `main` (`d7ebe8f`, 2026-10-30). It is reported separately from VTI and keyring-wallet and is never added to their figures.

**What the original measures.** Nothing. The original has no trust-task boundary for the suite to drive, so no vector could be run (runs `<results dir>/runs/2026-11-15-truststackers-base/` and, on the final suite, `2026-11-19-final-truststackers-base/`: the same result). The original is "not reachable by the suite" today. That is a fact about reach, not a defect report, and no measurement is faked or inferred for it. It appears in no pair, and the ledger of demonstrated executions would name the party `truststackers-original`, never `truststackers`.

## 7. Artifact-crossed evidence: runner-relayed documents

Evidence kind (c), `artifact-crossed`. The suite measures both sides of a task: the emit and emit-more classes check what a platform sends, the core families how a platform handles what it receives. Artifact-crossed joins the two without a live exchange: the documents platform A's real builders produced are handed, byte for byte, to platform B's receiver adapter, and B's verdict is recorded.

### 7.1 What it is and is not

| | |
|---|---|
| What it shows | That B's receiver, given the exact bytes A's builder produced, accepted them, held them or refused them (with the error code). A refusal of a document that A's emit vectors passed points at a difference between the two readings of the specification. |
| What it cannot show | Anything about carriage, sessions, discovery, addressing in a real deployment or timing between the two: the runner relays the bytes, sets B's clock to the document's `issuedAt` where B's clock can be set, and tells B's adapter that A sent them (the transport identity is the document's issuer). |
| Oracle | None. The verdict is recorded, not judged: no PASS or FAIL, no vector, no exception. |
| Counting | Never summed with conformance counts, never shown on the at-a-glance page, never a pair-matrix figure and never a ledger entry (the ledger holds (b) only). |
| Wording | "artifact-crossed: B accepted N of the documents A emitted (runner-relayed)". Never "demonstrated", never "interoperates". Demonstrated interoperation (b) has not been recorded. |

### 7.2 The tool

`npm run crossed -- (--producer <spec> | --producer-run <dir>) --receiver <spec> --out <dir>` (`src/crossed/cli.ts`, `src/crossed/crossed.ts`). Specs are the runner's adapter specs (`reference-peer` is a second reference party with its own key, so a reference-to-reference replay is between two parties).

1. **Producer.** Live (`--producer`): the receiver is provisioned first, then the producer adapter (optional capability `emit`) is asked, from one reset state before the first document (not one per type: the reference numbers its document ids from the reset, so a reset per type would repeat one id, which a receiver whose duplicate store outlives its `reset` refuses as `idConflict`) and the emit vectors' clock start where its clock can be set (the current time, set before each document and recorded as `clock: "real time"`, when the receiver's clock cannot be set, so a receiver that judges freshness against real time gets fresh documents), for one document of each Type URI in its `emits`, addressed to the receiver's VID. The documents are written to `produced.json` (format `tt-crossed-produced/0.1`, with the producer's identity and DID document) so the replay can be repeated from the record. Recorded (`--producer-run`): an earlier `produced.json` is read. The run folders recorded before this tool hold no emitted bytes (`results.json` keeps verdicts only), so a recorded replay starts from a `produced.json`.
2. **Receiver.** For each document, from a reset state: the producer's VID is passed to `trust` (a receiver that answers `trust` with "not supported", such as VTI, which resolves `did:key` itself, still receives the document, and the case notes it), the clock is set to the document's `issuedAt` where it can be set, and the bytes are sent with `send`. A Type URI the receiver does not declare is `not-served` and not sent.
3. **Verdict per document.** `accepted` (a reply that is neither an error nor a next-step), `held` (a next-step), `rejected` (an error reply; its code is kept), `no-reply`, `transport-refused`, `not-served`, `adapter-error`. Each case also records whether the document's `recipient` is the receiver's own VID (false when a recording made for another receiver is replayed) and the emit vectors that check the type on the producer side.
4. **Output.** `crossed.json` (format `tt-artifact-crossed/0.1`, `evidence: "artifact-crossed"`, `demonstrated: false`, `countedAsConformance: false`), `crossed.md` and `run.json` (tool `crossed`, suite commit and version, producer and receiver). The exit code does not depend on the verdicts.

Non-vacuity (`test/crossed.test.ts`): the reference producer's documents are all accepted by the reference receiver; the documents of the producer mutant `emitBadPayload` are all rejected by the reference receiver and all accepted by the receiver mutant `noPayloadValidation`, so a broken producer and a broken receiver each change the record.

A recorded run goes in its own folder under `<results dir>/runs/` (`YYYY-MM-DD-crossed-<producer>-to-<receiver>`) with `run.json` and a README that states the evidence kind.

### 7.3 Recorded runs

Live runs, each artifact-crossed evidence (never demonstrated, never counted). "Sent" is the documents of a type the receiver serves.

| Folder | Producer to receiver | Sent | Receiver verdicts | Reading |
|---|---|---|---|---|
| `2026-11-16-crossed-vti-emit-to-reference` | VTI emit (client builders, VTI `26d0da81`) to the reference | 46 of 70 | accepted 45, rejected 1 | The one refusal (`task-consent/decision` `noPending`) needs a pending request the reset receiver does not hold |
| `2026-11-16-crossed-reference-to-vti-inprocess` | reference to the VTA in process (VTI `26d0da81`) | 60 of 205 | accepted 5, rejected 55 | 48 refusals are `permissionDenied`: the producer's `did:key` is not on the VTA's access list and the relay cannot enrol it; the other 7 are not judged |
| `2026-11-16-crossed-keyring-wallet-to-reference` | keyring-wallet shim (`62af4d2d4`) to the reference | 66 of 117 | accepted 60, rejected 5, no reply 1 | `push/register` refused `malformedRequest`: the recorded push-registration finding (EM-PSH-004); 4 refusals need state the reset receiver does not hold |

Not feasible, not recorded:

- **Reference to the keyring-wallet shim.** Run with the shim launcher: the reference emits 205 Type URIs (plain, emit and 2L families) and the shim serves none of them (it serves the credential-exchange, relationship and ceremony families, which the reference does not emit), so every document was `not-served` and nothing was sent. The reverse crossing (keyring-wallet to the reference) is recorded instead.
- **VTI live.** No container runtime here for the live community service.

## 8. Independent passing implementations per vector group

A W3C-style implementation report, generated: ../results/independent-implementations.md (full table) and a summary block in results/README.md. Written by `npm run regen` (`src/glance/independent.ts`, through `scripts/docs-blocks.ts`) and checked by `npm run check:docs`.

- **Independent** means independent of the suite. The reference adapter (the suite's oracle) is never counted; it is shown apart in its own column. truststackers (original) is reported separately as not reachable. Independence of the suite is not independence of each other: shared libraries or a shared reading are not checked, and the page says so.
- **Unit**: the vector group, the finest grain the results carry. A platform counts once per group whatever number of its surfaces ran it, through the surface that shows most.
- **Passes a group**: at least one PASS and no FAIL or KNOWN-FAIL among the group's vectors that ran on that surface. CLARIFY counts as neither. "Whole group" marks a surface on which no vector of the group was SKIP. Platforms that ran the group with a difference are listed in their own column.
- **Recorded runs only**: the surfaces and run folders of [at-a-glance.config.json](../results/at-a-glance.config.json); each source row names its run folders and the suite version their `run.json` records ("not recorded" for folders before run.json), and a surface the at-a-glance model marks as recorded earlier is labelled "earlier recording".
- Not a ranking, not a status award and not interoperation of any kind: neither (a), (b) nor (c).

## 9. Reported separately: VTI, keyring-wallet, truststackers

VTI, keyring-wallet and truststackers are three platforms (truststackers as in section 6). Each is measured as its original code.

**Rules that follow.**

1. Separate runs, rows, columns, platform pages and numbers for each platform, and for each surface of a platform (section 2). Figures are never added together or averaged across platforms.
2. The reference adapter is never independent evidence: it is not counted on the independence page (section 8, shown apart) and is not a party in the ledger (section 4).
3. The exceptions recorded for VTI and keyring-wallet describe the original code. Where one no longer matches (the vector passes), the runner reports a stale exception and the at-a-glance model counts the vector as PASS and lists it on the surface as an exception that no longer applies.
4. Where a recorded difference was a defect of the suite's own harness rather than of the platform (the adapters' reply filter, a missing DID resolver in the stand-in carrier, host seeding, the proof purpose the harness signs with), it is fixed in the suite, for every platform alike, and the platform is re-run under the fixed harness; the figures are the re-run's, and each change in them is explained by the harness fix that caused it.
5. A platform is not a ranking position. Its numbers are never compared with another platform's as a league table (CONTRIBUTING, "Not a ranking").

The figures are generated locally by `npm run regen` (STATUS.md, results/README.md) and are not published ([D959](decisions/06-runs-and-results.md#d959)); dated results are published separately and are not part of this repository.

## 10. Scope-relative summary: default inputs and wording

Each platform component (VTI agent service, VTI community service, VTI client builders, keyring-wallet, the witness server) is summarised against the scope it declares, not against the whole specification (`docs/proposals/rollup-design.md`, `docs/34`). Figures: P, the conformance-implied agreement on the measured part of the scope (agree over agree plus differ, gating checks only); M, the measured share of the declared scope; F, the floor (agree over everything declared). P is withheld ("insufficient evidence") when M is under 50% or fewer than 10 items were measured, and is always printed with M and the scope size. Advisory checks form a labelled second line and never enter P. Ceremony completion is a separate figure by partner kind and is never added to P.

- **Default inputs.** Gating results are read from the run map (`results/platform-run-map.json`) and promotions from `vectors-src/promotions.json`; a promoted gating run (promote-b1, promote-b2) feeds P with no flag. Before this default the roll-up read only the at-a-glance surfaces, which name the earlier runs, so the VTI agent and community read 19% and 23% measured; with the promoted runs read they read 89% and 93% (agent 242 of 273 items, community 298 of 319; the agree share of what was measured is 98% and 99%). The measured share rose because more items were checked, not because more passed: the 29 agent and 19 community items declared at an older version stay outside what is measured.
- **Kinds stay apart.** A component reads only its own platform's runs; cards follow the platform order (VTI, keyring-wallet, truststackers).
- **Wording.** No generated line uses the bare word "interoperable" or any claim word listed in the claims lint; the headline says "conformance-implied agreement" and names the measured share. A figure is one run on one date, against draft specifications, and a single-implementer promotion is labelled as such (docs/33).
- **Code.** `src/glance/rollup.ts`, `scripts/rollup-prototype.ts`, [docs/04 section 21.5](04-suite-design.md#215-the-roll-up-generator-and-its-default-inputs).

Back to [README.md](README.md).
