# Security policy

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

## Report a vulnerability privately

Report a suspected vulnerability through the private vulnerability reporting of the host that serves this repository (on GitHub: the repository's Security tab, then "Report a vulnerability"). Do not open a public issue, discussion or pull request for it.

The project publishes no personal email address for security reports. If the private reporting form is not available to you, open a public issue that says only that you need a private channel, and leave the details out. A maintainer will then arrange one.

## What to include

- What you found and where (file, vector id or command).
- How to reproduce it, and what you expected instead.
- Whether the problem affects only this suite or also a platform it measures. A vulnerability in a measured platform is best reported to that platform's own maintainers; tell us if you did, so the suite can note it without detail.

## What this repository is

The suite is a set of test vectors, adapters and generators. It holds no production data and runs no hosted service. The most likely security reports are:

- an adapter or runner that sends data somewhere it should not, or reads files outside its results directory;
- a vector or document that leaks a secret, a private path or personal data;
- a dependency with a known vulnerability.

## What to expect

A maintainer acknowledges a report, tells you whether it is accepted, and says when a fix or a note is planned. Please allow a reasonable time before you disclose it elsewhere. Credit is given if you want it.

Only the latest state of the main branch is maintained; there are no supported older versions.
