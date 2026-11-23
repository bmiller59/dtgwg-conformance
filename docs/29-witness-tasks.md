# Witness tasks: witness/session and witness/session/submit

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This page describes the vector group **WIT** (43 vectors, targeting the latest versions: `witness/session` 0.2 and `witness/session/submit` 0.2), the oracle the reference adapter uses for it, the adapter for the keyring-wallet witness server, and what the group does and does not measure. The specifications are in the task force repository under `specs/witness/` (`session` and `session/submit`, each in versions 0.1 and 0.2 (0.2 is the latest and the target; decision D290), plus the shared `_shared/0.1/outcome-evidence.schema.json`). No open pull request or other branch of the task force repository changes `specs/witness`.

## Two witness measurements, kept apart

The same server and the same two tasks are measured in two ways, with different vectors, adapters and run records. Their results are never added together.

| | This page (group WIT, `vectors/ceremony-witness`) | [docs/13](13-didcomm-carrier-and-witness-server.md) (groups WSD, WSS, WSB, `vectors/witness`) |
|---|---|---|
| Carrier | None: the server's handlers behind an in-memory stand-in for the carrier | Real DIDComm v1 and v2 |
| Adapter | `src/adapters/witness-server/` (`launcher.ts`, `witness-host.ts`, `shim.ts`) | `src/adapters/witness-server/` (`adapter.ts`, `index.ts`) |
| Reference oracle | `src/adapters/reference/witness.ts`, 25 `ws*` mutants | `src/adapters/reference/witness-oracle.ts`, the `witness*` mutants |
| Checks | Session and submit rules, and the outcome evidence of the credential | Carriage, discovery (0.4) and the session wire (0.2) |

## What the two tasks do

A witness is a third party that observes a relationship exchange and later attests that it did, in a Verifiable Witness Credential (VWC). Each of the two parties of the exchange runs its own session with the witness:

1. `witness/session`: the party names the two relationship DIDs of the exchange. The witness answers with a fresh `challenge` and a `domain`, signed.
2. `witness/session/submit`: the party sends a presentation of its relationship credential, bound to that challenge and domain. The witness answers with the VWC and `vwcDigestMultibase`, signed. That answer is the outcome evidence: the VWC's `taskContext` is the id of the session document and its `taskDigestMultibase` is the task digest of that document.

Version 0.2 leaves the session payload unchanged and adds an optional `memberPresentation` to submit (a second presentation by a member DID that is neither party, bound to the same challenge and domain; a witness that relies on it verifies it whole and answers a failure `presentationInvalid`, one that does not may ignore it, and the member DID must not appear in the credential). The versions pair one to one: a witness refuses a submission in the other version with `challengeMismatch`. All vectors of the group send and cite 0.2 except the three marked below as older.

## The vectors

| Range | What it checks |
|---|---|
| WIT-001 to 003 | The session answer: a fresh challenge of at least 16 characters and a domain; the answer is signed; `parentThreadId` is carried back. |
| WIT-004 to 006 | A session by an issuer who is not one of the named parties is refused `witness/session:refused`; `parties` that are not exactly two DIDs, and unknown members, are malformed. |
| WIT-007 | The two sessions of one exchange get different challenges. |
| WIT-008 to 012 | Envelope rules for the session: an unsigned request is accepted (the proof is OPTIONAL), a missing or future `issuedAt`, a wrong recipient and a transport identity that differs from the issuer are refused. |
| WIT-013, 014 | A byte-identical resend of a session is a duplicate; the same id with other content is `idConflict`. |
| WIT-015, 016 | Older version, non-focus (WIT-015: a session in 0.1 is answered like 0.2) and the one-to-one version pairing (WIT-016, names both versions). Both are SKIP for a witness that serves only 0.2 (VTI's). |
| WIT-017, 018 | The member presentation (new in 0.2): a submit that carries one is answered with the credential and the member DID is nowhere in the reply (WIT-017); a `memberPresentation` that is a bare DID, or a submit that carries only a `memberPresentation`, is malformed (WIT-018). |
| WIT-020 to 026 | The conforming submit, and the outcome-evidence rules one at a time: `taskContext`, `taskDigestMultibase`, `vwcDigestMultibase`, the credential's issuer is the witness that answered, its subject is the party that opened the session, it is a `StatementCredential` under the witnessed predicate. |
| WIT-027 to 031 | A presentation bound to another challenge or domain (`challengeMismatch`), with a credential that does not verify, with no proof, or held by a non-party (`presentationInvalid`). |
| WIT-032 to 035 | A submission by the other party or by an outsider; the challenge is single-use; a redelivery of a completed submit is a duplicate. |
| WIT-036 to 041 | A submit on a thread with no session, a malformed payload, a missing or foreign envelope proof, an envelope proof with purpose `authentication`, and a submission after the witness's session window. |
| WIT-050, 051 | The whole ceremony for both parties (two sessions, two submits, two credentials, each checked against its own session) and the replay of one party's presentation into the other's session. |
| WIT-052 | Older version, non-focus: the 0.1 pair still issues a credential end to end (the one 0.1 ceremony kept, because a 0.1-only witness is still deployed). |

The member presentation is built by the same helper: a member presentation is the variant `member`: a presentation held by the harness actor R (a DID that is neither party) carrying one credential that names R, bound to the session's challenge and domain; the vector puts it in with `$capJson`. Three vectors are CLARIFY because the specifications leave the point open: WIT-036 (the code for a thread with no session), WIT-040 (the envelope's `proofPurpose`) and WIT-041 (the session expiry, which the specifications leave to the witness's own policy). A CLARIFY is never gating.

The vectors use the harness actors A and X as the two parties, S as a party outside the exchange and the implementation as the witness. A presentation is built by the adapter, through the helper `witnessPresentation` (optional capability `witness.presentation`), because its format belongs to the implementation: the reference adapter builds a Data-Integrity presentation with the suite's own crypto, the witness-server adapter builds a JSON-LD presentation with the server's own Credo agent. The vector asks for a variant (a valid one, or one with the wrong challenge, the wrong domain, a tampered credential, no proof, or a holder outside the exchange) and puts the result into the submit document with the token `$capJson(name)`.

The outcome-evidence rules are a new assertion, `evidence`, on the expected reply (`src/runner/witness-evidence.ts`): it names the rules to check on a submit answer against the session document the harness sent, so a platform that breaks one rule gets one finding.

## The reference adapter's oracle

`src/adapters/reference/witness.ts` is a witness written from the two specifications. It is the executable reading of the text, not a copy of any implementation, and it is what the 25 witness mutants (`ws*`) deliberately break so that each negative vector can be shown to fail for the fault it names. The reference serves the 0.2 and 0.1 types by default (0.2 is what the vectors send; 0.1 is the older version) (`witnessTasks: false` models a platform that is not a witness; the option `witness` is the separate `reference-witness` mode of [docs/13](13-didcomm-carrier-and-witness-server.md) section 6). Its session expiry (ten minutes) is the reference's own policy, since the specifications set none.

## The keyring-wallet witness server

Adapter: `src/adapters/witness-server/` (`launcher.ts`, `witness-host.ts`, `shim.ts`). It runs the server's **own TypeScript source** (`bifold/packages/witness-server`, read only) in a small Node host, with the server's own toolchain (ts-node, its `tsp-esm-preload.cjs`), on a real Credo agent over a throw-away SQLite wallet:

- the server's own code: `WitnessTaskSessions` (including its trust-task runtime consume pipeline), `buildWitnessCredentialJson`, the document-proof signer and verifier, Credo's JSON-LD presentation verification and credential signing;
- the shim: the carrier below `handleDocument` (an in-memory capture of the reply instead of DIDComm v1, v2 or TSP framing, connections and a mediator), the witness's connection DID (a `did:key` here; a deployment uses a `did:peer`), the clock (a settable `Date`), and the harness parties' keys, which are imported into the agent so it can sign their presentations.

Nothing leaves the loopback address and no secret is involved (every key is a fixed test seed). The locality policy and credential shape are the server's defaults (`offered`, `vsc`; no Bluetooth sensor, so the credential records `declinedByHolder`), overridable with `WIT_LOCALITY_POLICY` and `WIT_CREDENTIAL_SHAPE`.

Run it:

```
KW_ROOT=<keyring-wallet checkout> nice -n 10 npm run suite -- \
  --adapter 'stdio:node --experimental-strip-types src/adapters/witness-server/launcher.ts' --out <dir>
```

### What the result does and does not show

It shows how the server's handlers and issuance logic behave for documents that arrive in the suite's form. It does not show the real wire (framing, mediator pickup, the TSP carriage), the real connection DIDs, or the wallet-to-server interplay. One difference matters for reading failures: the real wallet sends its session document with `issuer` set to its **connection DID** and signs its submit with its **relationship DID** (`witnessCeremony.ts`), while the specifications say the issuer is one of the DIDs in `parties` and the proof's key belongs to the issuer. The vectors follow the specifications, so WIT-004 and WIT-039 describe a real divergence whose fix needs the wire contract between wallet and server to change, not only the server.

Only the framework and witness vectors that the server's types can carry are run: the server hosts no generic carrier task, so the other groups are SKIP, which is reach, not failure.

### What is not covered

- The original server (bifold `7e14c5124`) matches Type URIs by exact string and serves 0.1 only: for it every 0.2 vector is SKIP and only WIT-015 and WIT-052 run.
- The `witness-share` hand-over and a receipt: they are measured by their own groups (WSH and RCPT) against the platforms that receive them. A cross-platform run that takes the server's real VWC into a receiver was not built: the server signs its credential with a JSON-LD proof (Ed25519Signature2018 or eddsa-rdfc-2022), which the suite's receivers verify only in the Data-Integrity JCS form.
- The locality leg (`ext` locality assertion), the DIDComm and TSP carriages and the legacy basic-message dialect.

### Latest versions (decisions D245, D290; 2026-11-20)

The latest version of both witness tasks is 0.2 (the session payload is unchanged; submit gains an optional `memberPresentation`; the pair must be 0.2 and 0.2) and of discovery 0.4. The 66 vectors that targeted 0.1 were retargeted (D290): the 38 `WIT-*` of this page, and the 28 of `vectors/witness` (WSD 10 on discovery 0.4, WSS 11 on session 0.2, WSB 7 on submit 0.2; [docs/13](13-didcomm-carrier-and-witness-server.md)). The 0.1 vectors were replaced rather than kept, except three that add value for a 0.1-only witness and are labelled `older (non-focus)` by the coverage matrix: WIT-015 (a 0.1 session), WIT-016 (the version pairing, which names both) and WIT-052 (the 0.1 ceremony). New: WIT-017 and WIT-018 (the member presentation). Source citations and `tfRef` pins name the 0.2 and 0.4 texts (`vectors/pins.json`, `vectors-src/spec-hashes.json`).

**Oracles.** `src/adapters/reference/witness.ts` (group WIT, 25 `ws*` mutants) and `src/adapters/reference/witness-oracle.ts` (vectors/witness) serve 0.2 and 0.4 first, and 0.1 as the older version, with the one-to-one pairing; the two new mutants are `wsMemberInVwc` (the member DID is put in the credential) and `wsMemberUntyped` (a bare DID is accepted as `memberPresentation`). `test/witness.test.ts` and `test/witness-oracle.test.ts` show the unmutated oracles pass every vector and every declared mutant makes its vector fail (43 WIT vectors, 40 PASS and 3 CLARIFY; 28 vectors of `vectors/witness`, 25 PASS and 3 CLARIFY).

**Adapters.** The in-process host reads the versions the server declares (`SESSION_TYPES`, `SUBMIT_TYPES`, `DISCOVERY_TYPES`; a build that exports none is the 0.1-only one) and advertises exactly those, so a vector for a version the server does not serve is SKIP. The DIDComm adapter declares the pair at 0.2, or at each version named in `WITNESS_VERSIONS`, and takes a row name (`WITNESS_ROW`).

**Platform rows (2026-11-20, suite `7e452ba`).**

| Platform | Surface | Result (Tier 1) |
|---|---|---|
| VTI `vti-witness` (serves 0.2 and discovery 0.4 only) | not run | blocked, see below |

**VTI's witness: not run (blocked).** `vti-witness` serves `witness/session` 0.2, `witness/session/submit` 0.2 and discovery 0.4 and 0.3 only; it is reached over DIDComm or TSP through a mediator and a VTA that provisions its identities (`vti-witness setup`, then `run`). No host serves it here: no VTA, mediator or running `vti-witness` exists on this machine, a Docker-free stack of them is not a bounded job, and the one binary on disk (a release build of VTI `c24fd5df7` of 2026-11-07) is not the main the matrix reads (`71d524572`). The WIT vectors that a 0.2-only witness runs (all except WIT-015, 016 and 052) and the 28 of `vectors/witness` have no VTI row. What would unblock it: a VTA plus mediator started from the VTI main checkout (or a Rust test host that exposes `vti-witness`'s `dispatch` core, which takes one document and returns one signed reply with no transport, as an adapter), after which the same commands as above produce a separate row.
