# First issue 4: check our readings of the specifications

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This page is the text of one "we need reviewers" issue, kept here so the maintainers can open it as written once the repository is public. Nothing has been posted or sent. Every task specification this suite reads is a draft, and so is the suite.

## Title

Review request: where might a check read more into the text than it says?

## Body

When a platform fails a check, we sort the cause into four kinds. One of them, which we call class B, is the case where the check itself asks for more than the specification says: for example, a "should" or "may" treated as a "must", or a design habit of the suite presented as if it were in the text. In that case the platform is not at fault and we change the check.

We try to catch these ourselves, but we wrote the checks, so we are the worst people to find them. We would like a fresh reader to look for places where a check over-reads. The rules we apply are in the [contributing guide](../../community/contributing.md#classify-a-failure-a-b-c-or-d), and the review notes on individual checks are in [the vector review](../../../results/vector-review.md). Every specification involved is a draft; a reading that is right today may be wrong after the next revision.

## What we ask

1. Pick a task, read its specification text, then read the vectors that cite it.
2. Mark any vector that requires something the text only suggests, or allows. Quote the sentence and the word that makes it optional.
3. Mark any vector that picks one side of a question the text leaves open. Those should be a question to the editors, not a pass or fail.
4. Tell us if you find a reading that is right but poorly explained.

## How to reply

Comment on this issue with the vector id, the sentence you rely on, and what you think the check should do (accept both behaviours, ask a question, or be removed). Several short comments are easier for us to act on than one long one. We will change the vector, record why, and credit the reply in the decision log if you wish; tell us if you would rather not be named.
