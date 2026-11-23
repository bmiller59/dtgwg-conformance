# Task-force alignment: how the suite uses the Trust Tasks repository, and how to check it

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. Every specification described here is a draft.

The suite's vectors are built from the Trust Tasks task-force repository (the shared source of the task specifications). This page says what the suite takes from that repository, how each item is matched to a vector or ceremony scenario, how to re-run the check, and what is left unused and why. The check is a tool, so the answer is measured again whenever the repository moves; the latest figures are in [results/tf-alignment.md](../results/tf-alignment.md) and [results/tf-alignment.json](../results/tf-alignment.json), never copied into prose here.

## What the suite takes from the repository

| Item in the repository | What the suite does with it |
|---|---|
| Task specifications (`specs/<task>/<version>/spec.md` with `payload.schema.json`) | Every task version is named by at least one vector; the vectors cite the file, and carry a hash of its text so a change is noticed ([spec drift](23-spec-drift.md)). |
| Invalid examples (`payload.invalid-examples.json` beside each task) | A payload the task force lists as invalid must be refused (framework text, section 7.2 item 2). The generators turn them into vectors that send the payload and expect a refusal. |
| Request and response examples written inside `spec.md` | Request examples become "not refused for an envelope reason" vectors. Response examples are not matched: a response comes from the implementation under test and is checked against the response schema. |
| Shared fixtures (`fixtures/proof`, `fixtures/consume`) | Copied unchanged into `vectors/imported/` by `scripts/import-fixtures.ts`, with checksums, and read by the proof and freshness vectors. |
| Ceremony definitions (`ceremonies/**/ceremony.json`) | Each definition has a scenario group that follows it and quotes its checksum. `ceremony.invalid-examples.json` (cases for the task force's own definition checker) is not used: it tests that checker, not an implementation. |
| Library test suites (Rust, TypeScript, Go, Dart) and `scripts/check-bindings-conformance.mjs` | Not used as vectors. They test the task force's own libraries. The fixtures they share are the ones the suite imports. The tool counts them so their size is visible. |

The repository has no per-task `payload.examples.json` files; valid examples are the ones written inside each `spec.md`.

## How an item is matched to a vector

The tool reads every vector and ceremony scenario under `vectors/` and collects each document its steps send. An invalid or request example counts as **used** when a vector sends a payload equal to it. A string that starts with `$` in a vector (a suite token such as a minted id) matches any value, because the generators swap some values for tokens. It is **named only** when a vector for the same task cites the task's invalid examples but none of its steps equals this one: the tool does not guess which example was meant. Anything else is **not matched**, with one of these reasons: the task is retired; the task has no vector built from examples; or the task has one but this example was not among those sent.

"Used" means reach, not a result: it says a vector sends the payload, nothing about whether a platform passes. A second figure shows how many of the used examples sit in a vector that expects a refusal.

Tasks are mapped by Type URI: **a vector step** sends or emits the task, **named only** means the task appears in a citation and nowhere in a step, **no vector** means neither. Fixtures are matched by file name and checksum against `vectors/imported/` and by the vectors that cite the file. Ceremony definitions are matched by the path and checksum quoted in the scenarios. Citations are checked three ways: the cited file exists, the recorded text hash still equals the hash of the file the vector itself cites (never another file its text happens to mention), and the pins the generators recorded are compared with the commit that was read. A file that exists only on a pull request or branch is not counted as missing when every vector citing it names that branch head (channel `pr`); the report lists it apart and says whether the head still holds the file.

## Re-running it

```sh
npm run tf-alignment -- <task-force checkout> [--ref origin/main] [--out <directory>]
```

It writes `results/tf-alignment.json` (full lists) and `results/tf-alignment.md` (a short report) and exits 0 whether or not it finds drift. It is read-only on the checkout: it never switches branches, fetches, or writes there. Without `--ref` it reads the working tree, which may be a feature branch and so older or newer than the suite's pins; the report states the commit and branch it read. With `--ref` it reads that revision from the clone's git objects (for example `origin/main`) through a temporary copy outside the checkout. It does not fetch: bring the clone up to date first if you want the newest main. The output has no timestamps, so two runs on the same inputs are identical.

It flags: invalid and request examples no vector sends; fixtures not imported, changed or gone; tasks with no vector; vectors citing files that no longer exist or whose text changed; ceremony definitions with no scenario or a changed checksum; and a stale snapshot (each generator input's commit, whether the commit read contains it, and how many commits lie beyond it). Hash changes use the same normalised-text hash as [spec drift](23-spec-drift.md); a changed hash asks a person to read the change, it does not say the vector is wrong.

## One task-force commit

Every input the generators read from the task-force repository records the commit it was read at: the manifest (`vectors/tf-manifest.json`, main and kit), the invalid-example snapshot, the gap snapshot, the completion extras, the scope inputs, the spec-hash table and the imported fixtures' provenance. They must all name the same commit. `npm run check:pins` lists them and fails when two differ, when one records no commit, or when the manifest does not name a full commit; `npm run check:docs` runs it. A commit may be written in full or as a prefix of at least nine characters. The pins moved together on 2026-11-23 to one commit, the then current main of the repository (`bd0c05013`, dated 2026-11-19); the decision is [D950](decisions/02-specs-tiers-and-channels.md#d950).

To move all pins to a newer commit of the repository, in this order, never editing a generated file by hand: refresh the manifest (`scripts/tf-manifest.ts`, with the kit commit set to the same commit), the invalid-example snapshot (`scripts/refresh-coverage-inputs.ts`), the gap and alignment snapshots (`scripts/gap-snapshot.ts`), the task facts (`scripts/derive-task-facts.ts`), the fixtures (`scripts/import-fixtures.ts <checkout> <commit>`), then the spec-hash table (`npm run backfill-spec-hashes`), then read what changed (`npm run check:spec-drift`) and re-pin the vectors a person has re-read (`npm run repin`), refresh the pinned digests (`npm run pins`), regenerate (`npm run regen`) and run `npm run check:docs`. A vector that cites a specification the manifest now lists as retired is excluded from every run, with the real successor named in the reason.

## The advisory alignment set

Where an invalid example is unused, the task's own payload schema refuses it, and the task is in the committed snapshot or in the alignment snapshot, `scripts/generate-alignment.ts` writes `vectors/alignment/` (regenerated by `npm run regen`; never edit the JSON by hand). Each vector sends the unused examples of one task and expects a refusal. It is advisory (channel `proposed`, profile `tf-alignment`), is in no first-share count, and `scripts/generate-gap.ts` ignores it when it decides which tasks other sets already cover. Examples it does not write are listed with a reason in `vectors/alignment/not-generated.json`: the schema accepts the example, it is not a JSON object, it carries a role the deployment chooses, the task is a reply type, or or the task is not a draft in the committed manifest (every vector cites the task-force commit the manifest pins). The gap snapshot holds only the gap families; a second snapshot, `vectors-src/alignment/tf-snapshot.json` (written by `scripts/gap-snapshot.ts --out`), holds every task version of every family that lists invalid examples, and only this generator reads it, so widening it cannot add a task version to any other vector set. A task keeps the id it was first given (`TFA-INV-nnn`); a task new to the set takes the next number, so an id never changes meaning. The decisions are [D920](decisions/02-specs-tiers-and-channels.md#d920) and [D951](decisions/02-specs-tiers-and-channels.md#d951).

## What is not used, and why

- **Library tests** test code in the task force's own libraries, not an implementation of the specifications. Running them again here would only re-check the shared fixtures, which the suite already imports unchanged.
- **Response examples** cannot be sent; see above.
- **Ceremony definition cases** test the task force's own checker.
- **Examples the schema accepts**, and examples invalid only by a format annotation, are an inconsistency inside the specification. They are questions for the task force, not vectors.
- **Examples that carry a governance role member** are left out on purpose: the role is the deployment's choice, so the suite fixes none. They are the largest group still not sent.
- **The three newest consumer fixtures** (`ext-critical`, `ext-critical.schema`, `extends-routing`) are imported with their checksums but feed no vector. They pin what a runtime does with a consumer configuration the wire cannot carry (the set of namespaces a consumer recognizes, and an extends chain it was handed), so a vector for them would invent a task type or a deployment setting. The cases that need no configuration (a malformed `extCritical` member) could be sent to the three join-request manifest specifications that opt in; that is a new hand-written vector for the owner to decide, not a derivation from the fixture.

## Limits

The matching is by payload equality, so a vector that changes an example before sending it (a mutation applied at run time) counts as not matched. The tool reads the local clone and never the network. It does not run any platform.
