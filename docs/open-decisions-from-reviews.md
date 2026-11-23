# Open decisions from the reviews

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

Two reviews of this repository (architecture, items R1 to R24; documentation, items D1 to D20) are implemented where the change is mechanical. The items below change gating numbers, project policy or public identity, so they wait for the project owner (the repository maintainer, who makes the project decisions recorded in [decisions](decisions/README.md)). Each item gives the recommendation first, then the options with their pros and cons. Review item R3 (the ceremony family in the gating channel) is decided and recorded as [decision 39](decisions/04-ceremonies-governance-and-exceptions.md#d39): essential versus extended governance, the ceremony family split and the adapter honesty check.

## 1. R7: exception expiry policy (resolved)

Expiry dates come from one policy file, [exceptions/expiry-policy.json](../exceptions/expiry-policy.json): an anchor date plus a whole-day offset per implementation key, so the surfaces expire on different days instead of all at once. `npm run regen` writes every entry's `expires` from it, and `npm run check:docs` fails while an entry disagrees. The review date with the Trust Tasks task force is not yet set, so the anchor is a placeholder calendar date; when that date exists (option A of the review), it becomes the anchor. The runner's `--today YYYY-MM-DD`, recorded in `run.json`, keeps a recorded run reproducible across an expiry. Per-implementer expectation files are future work ([challenges.md section 8](challenges.md#8-future-work)).

## 2. R24: commit author identity

Every commit's author and `Signed-off-by` use one personal-domain address. Nothing was changed: the author email setting is the project owner's.

**Recommendation:** confirm before the first push whether that address is meant to be public. If not, rewrite authorship to a noreply address before publishing (afterwards it is permanent).

| Option | Pros | Cons |
|---|---|---|
| Keep the address | No history rewrite | Personal address public for good |
| Rewrite to a noreply address before the first push | Private address stays private | History rewrite (signatures redone); must happen before publication |

## 3. Further items deferred because they move numbers or need the project owner

Built in code and documentation, with the measured numbers moving at the next re-run of all surfaces: R5 (the keyring-wallet DIDComm v2 row declares the wallet as its platform, [decisions](decisions/04-ceremonies-governance-and-exceptions.md#platform-surfaces)); R6 (the VTC in-process host's own implementation name, `expectFailure` per exception, [decisions](decisions/04-ceremonies-governance-and-exceptions.md#exception-surfaces); 37 entries keep no class because their reason text does not support one); R8 (not applicable only from a cited `notOffered` entry, [decisions](decisions/04-ceremonies-governance-and-exceptions.md#cited-not-offered); the not-applicable columns shrink and not-reached grows); R9 (tier-excluded vectors recorded under `excludedByTier`, never SKIP, [decisions](decisions/04-ceremonies-governance-and-exceptions.md#excluded-by-tier); the SKIP figures of the re-run lose them); R10 (a minimum quiet period for no-reply verdicts, 1500 ms over DIDComm, [decisions](decisions/04-ceremonies-governance-and-exceptions.md#min-quiet); the recorded DIDComm adapters already wait longer, so no verdict is expected to move). R19 (the governance probes carry a `probe` marker and are counted apart from the candidates, [decisions](decisions/02-specs-tiers-and-channels.md#probe-class)) is built and moves no measured figure.

| Item | Why deferred | Recommendation |
|---|---|---|
| R12 archiving superseded run folders out of git | Deleting tracked records is a publication choice | Archive superseded sets as a checksummed tarball before the first public push; keep `<results dir>/runs/INDEX.md` |
| R14 raising the issuedAt question with the TF | Needs the TF contact ([decision 53](decisions/01-constraints-and-process.md#d53)) | Raise it first: it settles most CLARIFY vectors in one answer. The `clarifyRef` field (vector to question id, checked by the loader) was not added: it rewrites generated vectors and is best done once the question list is agreed |
| R18 / D7 identifier renames (`2L` in paths and ids, `--kit` to `--tf`, channel display names) | Public vocabulary; affects cited docs and ids readers already know | Keep identifiers; prose already says "AP, application profiles" and "TF checkout" (glossary). Decide before publication |
| R20 fixture licence provenance | A licence check is the project owner's call ([decision 65](decisions/01-constraints-and-process.md#d65)) | Re-import at the pinned TF commit, then have the licence checked before publication |
| R16 fuller fix (reference emitter learns the emit-more types; a generic emit-more mutant) | Code change in the oracle; the labelling part is done (results/README.md, "Not validated by the oracle") | Do it before the TF contributes vectors |
| R17 splitting the monoliths (reference adapter, generate-vectors, engine; shared VTI HTTPS base) | Large refactor, not low-risk in a review pass | Do it before a second contributor changes these files |
| R21 the 8 VTC 2L advisory FAILs | No written explanation exists in the repository, so they cannot be recorded as findings without new analysis | Classify them on the next VTC 2L run; until then they show as unexplained (advisory, not gating) |

## 4. Which task-force commit recorded runs read

`vectors/tf-manifest.json` pins two task-force commits: main `0dbc98f1` (2026-11-14, the commit every `tfRef` is resolved at) and the kit copy `640d4989` (2026-10-29, an ancestor of main). The `2026-11-16-` runs used a read-only export of main `0dbc98f1` as `--kit` ([docs/04 section 18.5](04-suite-design.md#185-drift-detection-and-refreshing-pins)). Nothing records which of the two is the reference for recorded runs.

**Recommendation:** main as pinned (`0dbc98f1`), stated in docs/04 section 18.5 and in every run README, with `kit.commit` kept only as the record of which paths the older copy held. Reason: the vectors cite main (every `tfRef` and the traceability report read it), and only main holds `trust-task-discovery/0.4`, which the DIS vectors test.

| Option | Pros | Cons |
|---|---|---|
| Main as pinned (`0dbc98f1`), as the 2026-11-16 runs did | Same commit the citations and the traceability report use; one advisory drift (`trust-task-discovery/0.4`) | Moves whenever the manifest is refreshed; a reader needs the manifest to know the commit |
| Kit copy (`640d4989`) | Matches the copy the earlier runs and fixtures were taken from | `trust-task-discovery/0.4` absent (`missing-source`), `task-consent/decision/0.2` drifts; citations point at a newer text than the one run against |
| Record both per run (run.json field for the TF commit read) | Exact provenance whichever is chosen | A run.json format change; still needs one of the two as the default |

## 5. Open items from the re-runs

Three items the `2026-11-16-agreed-` re-runs of the keyring-wallet DIDComm rows raised. Nothing was changed in the quiet rule or the adapter.

### 5.1 ENV-002 fails QUIET-NOT-ESTABLISHED on both keyring-wallet DIDComm rows

ENV-002 sends bytes that are not JSON. The DIDComm adapter reports the wallet's transport refusing the send (`transport.kind: refused`) with 0 ms of quiet, and the minimum quiet rule ([docs/04 section 3.3](04-suite-design.md#33-verdicts-that-rest-on-no-reply-the-minimum-quiet-period), 1500 ms for DIDComm) turns the empty reply set into `QUIET-NOT-ESTABLISHED`: PASS before the rule, FAIL now on v1 and v2. ENV-003 on v1 records the same line (468 ms) but stays KNOWN-FAIL through its exception.

**Recommendation:** do not apply the quiet rule to a send the transport refused. A refusal at the transport is an answer, not an absence: nothing can arrive later for a document that was never accepted, so there is nothing to wait for.

| Option | Pros | Cons |
|---|---|---|
| Exempt a send whose transport result is `refused` from the minimum | Matches what the rule is for (absence of a reply); ENV-002 returns to PASS | An adapter could report `refused` to dodge the rule; the exemption needs the adapter's transport report to be honest |
| Keep the FAIL and have the adapter wait the minimum even after a refusal | No rule change | Waits on nothing; slows every refused send by 1500 ms |
| Keep the FAIL as it stands | No change at all | A FAIL that says nothing about the wallet; counts move against a correct refusal |

docs/04 section 3.3 no longer says the rule changes no verdict: it names these rows.

### 5.2 The exception field `notOn`

`notOn: {<implementation name>: <reason>}` on a platform-keyed exception names the rows of the platform the entry does not cover ([docs/04 section 8](04-suite-design.md#8-outcomes-capability-gating-and-known-failures-built); [decisions](decisions/04-ceremonies-governance-and-exceptions.md#exception-surfaces)). It is used once: the keyring-wallet ENV-003 entry is `notOn` the DIDComm v2 row, where ENV-003 passes.

**Recommendation:** confirm the design as built. It keeps one entry per difference, says in the entry where the difference does not show, and a stale `notOn` (the row starts failing) is judged without the entry, so it cannot hide a difference.

| Option | Pros | Cons |
|---|---|---|
| Keep `notOn` (as built) | One entry per difference; the exclusion and its reason sit in the entry; checked by the loader | A second way to scope an entry beside the implementation key |
| Key the entry per row instead (no `notOn`) | One scoping mechanism | Duplicates the entry on every row that does carry the difference |
| An `onlyOn` list instead | Positive list | Must be edited whenever a row is added to the platform |

### 5.3 DUP-101..109 on the DIDComm v2 row: expectFailure mismatch

On the v2 row DUP-101 to DUP-109 FAIL with "KNOWN-FAIL exception does not match the observed failure": the vectors send a document with no sender, the v2 adapter cannot make a sender-less send, and the observed failure is an adapter error, not the difference the wallet's exception describes.

**Recommendation:** have the adapter declare the sender-less send unsupported on v2, so those vectors SKIP (not reached, with the reason) instead of failing; implement the send later if the v2 carrier allows one.

| Option | Pros | Cons |
|---|---|---|
| Adapter declares it unsupported on v2 | Honest: the row cannot reach these vectors; the exception stays exact | Reach on v2 drops by 9 until implemented |
| Implement a sender-less v2 send in the adapter | The vectors run on v2 as on v1 | Adapter work; may not be possible over the v2 carrier |
| `notOn` the v2 row for those entries | No adapter change | Wrong: hides an adapter limit as if the wallet had no difference there |

