# 19. VTI emit and 2L vectors

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. Nothing here has been filed with or sent to any project.

## VTI emit

The producer class (docs/04 section 11.8) needs the implementation's own builders to emit signed documents. For VTI the builders are client-side Rust in `vta-sdk` (`VtaClient`) and `vtc-client` (`VtcClient`). `src/adapters/vti-emit/` holds a small host built outside the VTI tree (`rust/`, cargo build dir and target elsewhere, VTI read only): a fixed did:key identity (`ClientIdentity`), a capture endpoint that keeps each POSTed document whole (proof, recipient, issuedAt), and a table (`rust/src/flows.rs`) mapping each Type URI to the client method that builds it. `adapter.ts` implements only `emit` and declares `emits` from the builders that actually produced a document; every other catalogue type is SKIP with evidence from `scripts/survey-vti-emit.ts` (`not-built.json`), and a builder VTI's own client refuses to send is SKIP with the client's error. The SDK loopback sink was not used: it hands out type and payload only.

Result: generated, the "Sending side" row of Coverage and results/platforms/vti.md (current run `<results dir>/runs/2026-11-15-final2-vti-emit/`). See the first run's `<results dir>/runs/2026-11-15-vti-emit/README.md` (ref 26d0da81) for reasons, findings (four `cred_vault_*` builders refused by VTI's own pre-send check; builder-fixed governance values) and what is out of reach (handler-built `push/wake`, `push/provision`, `task-consent/request|granted`, `approve-request`). Governance rule: role and policy values are harness placeholders, never asserted; values a builder fixes are listed as evidence.

<!-- 2L-vectors:begin -->
## 2L vectors

AP, the common application profiles (the identifiers `vectors/2l`, `profile: "2L"` and the profile names 2L-1 to 2L-5 use "2L"), is the suite's own proposal (draft profile text 2L-1 to 2L-5, not filed anywhere). These vectors cover the members of four of the five profiles that have schema-bearing tasks in the pinned registry package: 2L-2 (push registration only; device, vault and push/wake and push/provision are already in `vectors/plain` and `vectors/emit`), 2L-3 (notifications), 2L-4 (audit) and 2L-5 (invitations, join requests, VMC, directory, vetting). 2L-1 (auth, acl, policy, step-up) is already `vectors/plain`.

Where they live: `vectors/2l/` (own `manifest.json`), authored by `scripts/generate-2l.ts`, run with `--vectors vectors/2l --channels registry,proposed`. Every vector is channel `proposed`: advisory, never in a gating count, headline total or exit code, and excluded from the default (registry) run, so the registry-only default counts are unchanged. The registry vector directory manifest (`vectors/manifest.json`) does not list them.

### Sources and status

Task shapes (payload schema, response schema, proof, recipient and issuedAt policy) come from `@openvtc/trust-tasks` 0.29.0 (a registry package; every registry specification is status draft). Task-specific error codes come from the specification text in the task-force checkout at `origin/main` 0dbc98f1c (2026-11-14), status draft; the package does not ship them. No open task-force pull request is a source of any 2L vector. Each vector carries `source` (slug, version, channel `proposed`, `pkg:` ref with a pinned digest of the schema and policy) and cites the specification in `spec`. Versions covered are every non-retired version of each slug in the package. Slugs named after VTI (`vta/notifications/*`, `vtc/*`) are marked VTI-named in `source.note`: the registry has no generic list, show, dismiss, deposit, invitation or directory slug.

### Classes

- Probe (`TL-*`, family `2l`): a task the implementation SERVES, the plain-task pattern (docs/04 section 11.7). Per task version: payload validated against the schema, declared recipient and proof policy enforced, issuedAt required (CLARIFY, not gating), and a schema-valid signed request not refused for an envelope reason with any response conforming to the response schema. Gated on the type being declared in discovery, so an implementation that does not declare the task SKIPs.
- Emit (`TE-*`, family `2l-emit`): a task the implementation SENDS, the producer class (docs/04 section 11.8). The emitted document is checked against the payload schema and declared policy. Gated on `optional:emit` and `emit:<type>`.
- Spec-stated refusals (9 probe vectors, inside the `TL-*` groups), mechanics only:
  - `notifications/relay` 0.1: a relay whose forwarded layers are not a chain of notify and relay documents each addressed to the relayer carrying it is refused with `notifications/relay:chainInvalid` (the relay carries the originator's signed document unchanged; the proofs inside the chain are not asserted).
  - `audit/list` 0.2: a cursor the maintainer did not issue is refused, with `audit/list:invalidCursor` or `permissionDenied`.
  - An identifier that names nothing is refused with the task's declared not-found code or `permissionDenied`: `vta/notifications/show` and `dismiss`, `vtc/notifications/show`, `vtc/join-requests/status` and `withdraw`, `vtc/invitations/revoke` and `deliver`.

### Governance

No vector asserts a role, policy content, admission, retention, who may do what, or an authorisation outcome. Where a refusal could be an authorisation refusal (audit-read gate, caller standing), `permissionDenied` is accepted in place of the task code. A payload that carries a role value takes it from the adapter's declared `governance.roles` (token `$role(n)`) and SKIPs with `governance not declared` otherwise; no current 2L payload carries one.

### Groups

The vector count is generated in Vector families (2L profiles row); the vectors of each group are in `vectors/2l/` (listed in its `manifest.json`).

| Group | Tasks |
|---|---|
| NTF | notifications notify, relay |
| NTV | inbox, VTI-named (`vta/notifications/*`, `vtc/notifications/*`) |
| AUD | audit list, verify |
| INV | vtc/invitations issue, list, revoke, deliver |
| JRQ | vtc/join-requests submit, status, manifest, withdraw, supplement |
| MBR | vtc/members vmc, request-vmc |
| DIR | vtc/directory entries list and show, card show and update, fields list, images get and upload, query |
| PSH | push/register |
| VET | vetting request, attestation, decline (KW only, no server) |

`vetting/session` 0.1 has no generated payload (a generator limit, listed in `vectors/2l/not-generated.json`).

### Non-vacuity

The reference adapter serves and emits every 2L task (`src/adapters/reference/2l-catalog.ts`, `2l-oracle.ts`) and the generic plain and emit mutants apply to them. Three new mutants break the spec-stated refusals: `relayChainUnchecked`, `auditCursorAccepted`, `unknownIdAccepted`. `test/twol.test.ts` checks that the generator reproduces the files, that the reference passes every vector, that an adapter serving nothing SKIPs everything, that the vectors are excluded from the default run, and that every mutant a vector names makes it fail.

### Where it runs

See `<results dir>/runs/2026-11-15-2l-reference/`, `2026-11-15-2l-vti-inprocess/` and `2026-11-15-2l-keyring-wallet/`. VTI in process serves the VTA only, so the VTC tasks (invitations, join requests, directory, VMC, VTC notifications) SKIP there until a VTC host exists; vetting has no VTI handler.
<!-- 2L-vectors:end -->
