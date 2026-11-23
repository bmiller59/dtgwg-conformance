# First issue 3: contribute a platform adapter

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This page is the text of one "we need reviewers" issue, kept here so the maintainers can open it as written once the repository is public. Nothing has been posted or sent. Every task specification this suite reads is a draft, and so is the suite.

## Title

Help wanted: connect another platform to the suite

## Body

The suite runs its checks through a small piece of code called an adapter. An adapter turns "send these bytes and tell me what came back" into one platform's own calls. Today the repository has adapters for two platforms (a verifiable trust infrastructure service and a wallet) and a reference adapter written straight from the draft specifications, which is what the checks are first proved against. Every specification involved is a draft.

We would like to measure more platforms, and the people who maintain a platform are the best placed to write its adapter. An adapter is also a fair test of the suite: if it is hard to write, we want to know why.

## What we ask

1. Read the walk-through [add a platform](../../add-a-platform.md), the adapter section of the [contributing guide](../../community/contributing.md#add-or-extend-an-adapter) and the platform list in [platforms.md](../../../platforms.md).
2. Write an adapter for a platform you work on, starting from the example server under `src/adapters/example-server/`.
3. Declare only what the platform really does. A check the adapter does not declare is skipped, and a skip is an honest answer, never a failure.
4. Run the suite and read every result that is not a pass. For each, say whether the platform differs from the text, the check reads too much into the text, the text is open, or the adapter is at fault.

## How to reply

Comment on this issue to say which platform you would connect, and what you would need (a question about the adapter contract, a missing capability, a way to run the platform in a container). Pull requests are welcome; sign off each commit (`git commit -s`) and keep one change per pull request, as the [contributing guide](../../../CONTRIBUTING.md) describes. If a first run shows results you think are wrong, tell us in the same thread before anyone reads them as a verdict on the platform.
