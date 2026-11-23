> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

## What this changes

<!-- One change per pull request. Say what and why in a few sentences. -->

## Kind of change

- [ ] Vector or ceremony scenario (generator edited, never the generated JSON)
- [ ] Adapter (new or extended)
- [ ] Classification of a failure (A to D) or a challenge to a vector
- [ ] Documentation
- [ ] Tooling or tests

## Specification basis

<!-- For a vector, scenario or classification: quote the sentence, with document, clause and version. All task specifications are draft.
     If the text is open, this is a question for the task force and the change must not assert a reading. -->

## Checklist

- [ ] The specification text wins: nothing here is changed to match a platform's behaviour.
- [ ] A new vector names its channel (starts advisory), its requirements and, if negative, the mutant it must fail.
- [ ] Percentages carry their denominators; each platform is reported separately.
- [ ] No claim that a platform is conformant, compliant or certified (`npm run lint:claims`).
- [ ] Generated files regenerated (`npm run regen`), and `npm test`, `npm run typecheck` and `npm run check:docs` pass.
- [ ] Tests are in this change, not a follow-up.
- [ ] No local paths, internal hostnames or credentials; the tone is factual and constructive.
- [ ] Every commit is signed off (`git commit -s`).
