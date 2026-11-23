# Review guide

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

For specification editors, implementers and anyone else asked to review the suite. You do not need to install anything to review: the vectors are JSON files you can read in a browser. Every task specification involved is draft, and so is the suite. A partial review is useful: one task reviewed is better than none.

## What to review

The most useful question is whether a vector says what the specification says. A vector can:

- be right;
- ask for more than the text says (for example, treat a SHOULD or MAY as a MUST);
- ask for less, or miss a rule that is in the text;
- pick one side of a point the text leaves open, which it should not do.

Three open review requests describe this in more detail: [review the suite as specification editors](maintainers/first-issues/01-review-the-suite-as-specification-editors.md), [review the open findings](maintainers/first-issues/02-review-the-open-findings.md) and [check our readings of the specifications](maintainers/first-issues/04-check-our-readings-of-the-specifications.md).

## Find the vectors for your task

Each vector names the specification file it rests on in `source.tfRef.repoPath`, relative to the task-force repository. To list the files that cite one task:

```sh
grep -rl '"repoPath": "specs/vrc/relationships/propose/0.1' vectors/
```

Other ways in:

- [results/traceability.md](../results/traceability.md): every normative sentence (MUST, SHOULD and the like) of the cited texts, and whether a vector cites it.
- [results/vector-review.md](../results/vector-review.md): the review of every recorded difference against the text, with its class.
- [Open gaps](community/open-gaps.md), section "Questions for the task force (not to be asserted)": the points the suite found open.

## Read one vector

A vector, shortened (`vectors/framework/env.json`):

```json
{
 "id": "ENV-005",
 "title": "missing payload is refused",
 "tier": 1,
 "spec": ["framework 4.4 (payload REQUIRED)", "SPEC.md:1011 (7.2 item 1)"],
 "source": { "channel": "registry", "tfRef": { "repoPath": "SPEC.md", "commit": "bd0c0501...", "status": "main" } },
 "clarify": null,
 "mutants": ["lenientEnvelope"],
 "steps": [{ "send": { "template": "carrier.request", "params": { "payload": { "$omit": true } } },
             "expect": { "disposition": "any-refusal", "noSideEffect": true } }],
 "requires": ["carrier:consequential"]
}
```

| Field | What to check |
|---|---|
| `spec` | The sentences the vector rests on, as file and line at the pinned commit. Read them first. |
| `source.channel` | `registry` gates a run; `pr`, `proposed` and `candidate` are advisory. |
| `source.tfRef` | The specification file and the task-force commit the vector was written against. |
| `steps[].send` | What the suite sends: a template with changes. Here a request with its payload left out. |
| `steps[].expect` | What must come back. `any-refusal` means an error reply or no reply; `noSideEffect` means nothing may change. |
| `clarify` | Not `null` when the vector rests on an open point: it is then reported as CLARIFY and never gates. |
| `mutants` | The deliberately broken stand-ins that must fail it, which shows the vector can fail at all. |
| `requires` | What an implementation must offer for the vector to run; otherwise it is SKIP. |

The full format is [docs/04 section 3](04-suite-design.md#3-vector-format-tt-conformance-vectors01-built). The words are in the [glossary](03-glossary.md).

## Reply

Comment on the review request, start a GitHub Discussion on the repository, or open a specification-question issue from the templates in `.github/ISSUE_TEMPLATE/`. Quote the sentence you rely on and name the vector id. How a disagreement is recorded, and what results show while it is open, is in [challenging a vector](challenges.md). Nothing in any platform is changed on the strength of a review; it only decides how the suite reads the text.
