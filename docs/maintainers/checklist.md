# Maintainer checklist: findings, figures and attribution

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

Check these before a finding, a figure or a statement about a platform is drafted or published. Where a test holds the rule, it is named.

## 1. Every finding or claim cites unmodified upstream

- Before a finding is drafted, it cites a line of the specification or of the platform at a named commit that is on upstream main (an ancestor of the upstream default branch), and says how that was checked (for example `git merge-base --is-ancestor <commit> origin/main` on a freshly fetched clone).
- A commit that is not on upstream main can be evidence for a proposed fix, never for how the platform behaves.
- A question for specification editors quotes the operative section in full (the conformance steps, the error table, the front-matter rationale) and the framework sections it depends on. A second reader confirms that the text does not already answer it.
- A count in a finding carries the command and the commit that produce it. A figure from an unmerged branch is labelled as such or left out.

## 2. Example validation uses the suite's validator and honours `variant` and `format`

- Task-force invalid examples are read only through `src/plain/invalid-examples.ts` (`readInvalidExamples`), which keeps the `variant` marker. An entry marked `"variant": "response"` is checked against the response schema and is never sent as a request. Held by `test/invalid-examples.test.ts`.
- Classify with `classifyInvalidExample`: it checks the schema of the entry's own variant with and without `format` asserted. "Invalid only through `format`" (`format-only`) is its own class and is never reported as accepted by the schema.
- Do not validate examples with an ad hoc script. If one is needed, compare its counts with the suite's classes first.
- Figures quoted from `results/tf-alignment.json` must match it; `test/tf-alignment-figures.test.ts` fails when a tracked page drifts.

## 3. Spec pin freshness

- Every generator input records the task-force commit it was read at; `npm run check:pins` fails when they differ.
- Before quoting "the suite's snapshot is current", fetch the task-force clone and run `npm run tf-alignment -- <clone> --ref origin/main`; read the "commits read has beyond it" column. A report written against an unfetched clone says nothing about upstream today.
- Moving the pin changes vectors: it is a decision for the owner, taken with a regeneration (`npm run regen`) and a fresh alignment report.

## 4. Platform attribution is stated per run

- Each run records the commit measured (`results/platform-run-map.json` `checkout`) and, for the wallet, the bifold commit.
- Each run says whether the measured commit is on upstream main. If it is not, say what it is (upstream main plus which changes) without calling it unmodified. `test/attribution.test.ts` fails when a tracked page calls a measured checkout unmodified, and checks that the README says the measured wallet commits are not on upstream main.
- A difference observed in a harness, a stand-in or a build input (for example a patch file the harness picks up) is attributed to that input, not to the platform.

## 5. Exceptions

- Every entry carries a class (A differs from spec text, B the vector reads more than the text says, C the text is open, D adapter or stand-in) and a reason that quotes or cites the specification text or a vector. `test/exceptions-classes.test.ts` fails on a new entry without them; the entries listed there as a baseline are classed only with evidence and the owner's review.
- Before a class C ("the text is open") is recorded, check whether the text defers to another standard; if it does, read that standard.
