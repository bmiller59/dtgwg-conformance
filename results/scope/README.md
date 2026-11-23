# Scope overrides (optional)

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

A platform's attempted suites come from code evidence: the tasks its code serves or sends, plus what its adapter declares at the measured build ([docs/34](../../docs/34-suite-attempts.md)). A file here is an optional override, never a required artefact. It can:

- classify a suite with no evidence as `not-attempted` (no role by design) or `not-yet-built` (the platform could build it), with a reason;
- annotate an attempted suite (for example: a feature compiled out of the default build).

It can never remove a suite that has evidence, and never add an attempt. Format `tt-scope-override/0.1`: `component`, optional `extends` (another component's file), `review` (`unreviewed` or `confirmed` with `by` and `on`), and `entries` (`suite` or a pattern `family/*` or `*`; optional `band`; `note`; `basis` `declared` (confirmed, with `confirmedBy` and `confirmedOn`), `inferred` (with an `evidence` link) or `unconfirmed`). The files are checked by `validateOverride` in `scripts/suite-attempt-prototype.ts`.
