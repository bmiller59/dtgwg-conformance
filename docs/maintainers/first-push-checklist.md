# First-push checklist

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This page is for the maintainers. It lists the order in which the suite is first put on a public host, and why the order matters. All specifications the suite measures are drafts, and so is the suite.

## Order

1. **Create the repository** on the host, empty, with no README, licence or ignore file of its own (the suite brings its own). Turn on private vulnerability reporting and GitHub Discussions before anything is public ([SECURITY.md](../../SECURITY.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md#where-to-discuss) point at both). Set the default branch name to `main`.
2. **Push the single signed commit.** Build it with `scripts/build-publish-commit.sh` from the release branch: one root commit, signed, with a sign-off, whose tree is the release branch without the working-branch-only files (`CLAUDE.md`). Push only that branch, as `main`. Do not push the working branches, do not force, and do not push tags. Then check from a fresh clone: `npm install`, `npm test`, `npm run typecheck`, `npm run check:docs`.
3. **Open the "we need reviewers" issues and the templates.** The issue templates in `.github/` arrive with the commit. Then open the issues that ask the specification and platform maintainers to review the vectors, one per area, each linking [the open gaps](../community/open-gaps.md). The texts are written and waiting in [docs/maintainers/first-issues/](first-issues/): [review the suite as specification editors](first-issues/01-review-the-suite-as-specification-editors.md), [review the open findings](first-issues/02-review-the-open-findings.md), [contribute a platform adapter](first-issues/03-contribute-a-platform-adapter.md) and [check our readings of the specifications](first-issues/04-check-our-readings-of-the-specifications.md). Each says the specifications are drafts and asks for a reply in the issue or in Discussions. Pin one welcome discussion that states the draft status and where questions go.
4. **Share the link last.** Only after steps 1 to 3 are in place and the clone check passes, send the repository link to the working group and to the platform maintainers. Nothing is sent to anyone earlier, and no issue or pull request is opened on a platform's own repository on anyone's behalf.

## Before step 2

- The release branch passes `npm run typecheck`, `npm test`, `npm run check:docs` and `npm run lint:claims`.
- `scripts/build-publish-commit.sh` (dry run first) reports no local path, no secret pattern, no attribution trailer and no excluded file.
- Run records stay outside the repository; the results archive is never published ([docs/04, section 21](../04-suite-design.md)).

## If something changes after the build

Rebuild under a new branch name; the script refuses an existing branch. Never amend or force-push the published commit.
