# Spec drift: knowing when the Trust Tasks text a vector cites has moved

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

A vector cites Trust Tasks text (a task spec, the framework text, a binding) pinned to one task-force commit (`vectors/tf-manifest.json`). When the task force changes that text, a vector can quietly stop testing what the text says. This page describes how the suite notices, what it does with a vector it has noticed, and how a vector is cleared again. The decision behind it is [CV-11](decisions/03-vectors-and-coverage.md#cv11).

**Hashes catch change, not correctness.** A hash that has not moved says the cited text is the text the vector was written against. It does not say the vector is right, and a moved hash does not say the vector is wrong. A person reads the change and decides.

## What a vector carries

`source` (the object that names where a rule comes from) gains three optional fields ([schema](../schema/tt-conformance-vectors-0.1.schema.json)):

| Field | What it is |
|---|---|
| `tfCommit` | The Trust Tasks commit the two hashes were taken at. |
| `specHash` | `sha256` of the **normalised** text of the cited file (`spec.md` of the task, or `SPEC.md`, a binding). The granularity is the cited file, not a section. |
| `schemaHash` | `sha256` of the canonical `payload.schema.json` of the task the vector exercises (task specs only). |

Normalising (`src/vectors/spec-hash.ts`, the one module that hashes) collapses whitespace and removes markdown noise: emphasis markers, link syntax (the link text stays), heading hashes, table pipes and separator rows, list and quote markers, code fences, comments. Line wrapping and line numbers are not part of it. So a reflow, a restyle or a shift in line numbers keeps the hash, and a changed word moves it. JSON is hashed canonically (key order and formatting do not count).

The fields are optional on existing vectors and **required** on a vector whose file `family` starts with `coverage` and whose channel is `proposed` or `candidate`, when it cites a Trust Tasks file on main (`tfRef`): `tfCommit` and `specHash`, and `schemaHash` when the file is a task spec (`src/vectors/validate.ts`).

The generators stamp the fields from a committed table, `vectors-src/spec-hashes.json`, keyed by Trust Tasks path (`withSource` and the 2L and governance source builders call `withSpecHashes`), so regeneration is offline and deterministic. `scripts/backfill-spec-hashes.ts --tf <checkout at the pinned commit>` writes the table.

## Checking: `npm run check:spec-drift`

```sh
npm run check:spec-drift -- --tf <Trust Tasks checkout> [--old <checkout at the pinned commit>] [--flag --tf-commit <sha>]
```

It re-hashes every cited file and lists:

- vectors whose cited text **changed** (with a short passage diff of the normalised text, taken from the checkout's history at the pinned commit, or from `--old`), was **removed**, or was **renamed** (the same text is at a new path);
- **changed schemas**, even when the text did not move;
- **new task versions** in the checkout that the pinned manifest does not hold and that no census row or vector names;
- **vanished** task versions the pinned manifest holds and the checkout no longer has.

The exit code is 1 when anything is flagged, 0 when nothing is, and 2 when no vector carries hashes: it says so and never passes silently. It is run on demand, before each measurement; no scheduled job exists.

## SPEC-CHANGED

`--flag` writes `vectors-src/spec-flags.json` (vector id to `{oldHash, newHash, tfCommit, detectedOn}`). The runner records a flagged vector as **SPEC-CHANGED**: "the spec moved; this test has not been re-checked". It still runs, and the observed outcome is in the reason, but it is advisory like QUARANTINED: it is in no count, no roll-up and never in the exit code, and it is never shown as a pass or a difference until it is reviewed. The generated status output carries one line, `Spec pin: <date>; N tests need re-checking against newer spec`, from the flag file and the pin date in the manifest; the line is empty when N is 0.

## Re-pinning is a deliberate commit

```sh
npm run repin -- <vector id>... | --all-clear --decision still-correct|vector-changed|exception-changed [--wording-only] --reviewer "<name>" --tf <checkout>
```

A reviewer re-reads the change and chooses one decision: `still-correct` (the vector stands as written), `vector-changed` (the vector was edited to follow the text; edit the generator first), `exception-changed` (a recorded exception was changed). `repin` updates the table, clears the flags, appends a record to `vectors-src/spec-pin-log.json` (old and new hash, Trust Tasks commit, decision, reviewer, date) and regenerates the vectors. `--wording-only` (no semantic change) is allowed only with `still-correct` and is logged as such. Hashes are kept per cited file, so every flagged vector that cites a file is re-pinned together.

## The rule the tests enforce

`test/spec-repin.test.ts` applies `pinRuleProblems` (`src/vectors/repin.ts`) to the committed files:

1. A flagged vector's current hash must equal the flag's `oldHash`, unless the pin log has an entry for that vector, dated on or after the flag, whose `newHash` is the current hash. A hash cannot change silently while its flag stands (a bulk bump is refused).
2. If the pin log records a re-pin to the flagged `newHash`, the flag must be cleared.
3. A vector's `tfCommit` must equal its `tfRef.commit` (the manifest pin), unless the pin log records a re-pin of that vector at that `tfCommit`. Moving the manifest pin without re-hashing and re-pinning fails.

A flag on its own, with its hash unchanged and no log entry, is the normal state of a vector waiting for review: it does not fail the suite. The check that the hashes are right is separate: when `TT_KIT` names a checkout at the pinned commit, `test/spec-hash-pinned.test.ts` re-hashes every vector and fails on a mismatch (without `TT_KIT` it is skipped, and says so). What the rule cannot see is a bulk re-hash that is internally consistent; that is why the check is run against the real checkout before each measurement.
