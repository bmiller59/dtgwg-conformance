# First issue 1: review the suite as specification editors

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This page is the text of one "we need reviewers" issue, kept here so the maintainers can open it as written once the repository is public. Nothing has been posted or sent. Every task specification this suite reads is a draft, and so is the suite.

## Title

Review request: do the suite's checks say what your specifications say?

## Body

This repository holds a neutral set of checks, called vectors, that read the draft trust task specifications and ask a platform one question each: given this message, what does it do? A vector quotes the sentence of the specification it relies on. Platforms are measured against the text, never the other way round, and every specification involved is a draft, so none of the results is an approval or endorsement of a platform by anyone.

We are not the authors of those specifications, and you are the people who know what the sentences were meant to say. We would like you to read the suite the way an editor reads a reviewer's notes: skim how it is organised, pick the tasks you own, and tell us where a check says more, less or something different from your text.

What the suite does and does not claim is on the front page of the repository and in [the claims rules](../../claims.md). It keeps each platform in its own rows and never adds them together.

## What we ask

1. Pick one or more tasks you edit. Open the vectors for them (the [review guide](../../review-guide.md) says how to find them and how to read one).
2. For each vector, check the quoted sentence against the current text. Say which of these applies:
   - the vector is right;
   - the vector asks for more than the text says (for example, it treats a "should" as a "must");
   - the vector asks for less, or misses a rule that is in the text;
   - the text itself is unclear or two documents disagree, so the vector should not pick a side.
3. If a draft has moved, tell us which version the suite should follow.

A partial answer is useful. One task reviewed is better than none.

## How to reply

Comment on this issue, or write in the repository's Discussions if you prefer to talk before filing anything. Quote the sentence you mean and name the vector id (for example a short code such as CV-AA-177). If you would rather not use the host, say so in a comment and name the way you prefer; we will follow it. Please be as blunt as you like about the suite: a report that a check is wrong is a contribution.
