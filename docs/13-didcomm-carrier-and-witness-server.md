# 13. DIDComm carrier and the witness-server vectors

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

The counts below are for the `vectors/witness/` set only; the global counts, per family and per platform, are in results/README.md. Every vector in `vectors/witness/` carries a `source` (docs/04 section 18) in the `registry` channel: the kit specifications it cites are status draft, and `kit:specs/witness/session/0.2`, `kit:specs/witness/session/submit/0.2` and `kit:specs/trust-task-discovery/0.4` (the latest versions, decision D290) are pinned in `vectors/pins.json`. Current figures: results/platforms/keyring-wallet.md.

## 1. What this adds

| Piece | Path |
|---|---|
| A DIDComm carrier (the harness packs a Trust Task document into a DIDComm message, sends it over a connection, unpacks replies) | `src/carriers/didcomm/carrier.ts` |
| A black-box adapter for a witness server reached over that carrier | `src/adapters/witness-server/` |
| Witness vectors (count generated in Vector families) for `witness/session` 0.2, `witness/session/submit` 0.2 and `trust-task-discovery` 0.4 (the latest versions, retargeted from 0.1 by decision D290; the 0.1 texts are no longer tested here), one authored source | `scripts/generate-witness-vectors.ts` -> `vectors/witness/` |
| Exceptions (KNOWN-FAIL) for the witness server | `exceptions/exceptions.json` (entries with `impl` `witness-server`) |
| A witness oracle (spec-driven reference mode `reference-witness`, with mutants) | `src/adapters/reference/witness-oracle.ts`, `test/witness-oracle.test.ts` |
| A run | `<results dir>/runs/2026-11-15-witness-server/` |

Shared files touched: `src/adapter/contract.ts` (a comment on `bindings`, no type change) and `src/vectors/load.ts` (a manifest may declare `nonVacuity: "pending-oracle"`; no shipped suite does since the witness oracle, section 6).

## 2. The adapter-contract addition (additive, optional)

`Capabilities.bindings` already carries free-form strings, and a vector already gates on `requires: ["binding:<name>"]` (SKIP when the adapter does not declare it). The addition is three new values: `didcomm` (any DIDComm carriage), `didcomm-v1` and `didcomm-v2`. An adapter that never declares them is unaffected, and no existing vector requires them. No method, type or wire change.

## 3. The carrier

Derived from the specifications, with their status (the kit is `dtgwg-trust-tasks-tf` at origin/main `0dbc98f1c`, 2026-11-14; every spec below is `draft`, targetFrameworkVersion 0.5.0):

- `bindings/didcomm-v1` 0.2 (draft): message `@type` `https://trusttasks.org/binding/didcomm-v1/0.2/trust-task/1.0/task`; exactly one `~attach` with `@id` `trust-task`, `mime-type` `application/json`, the document in `data.json`; authcrypt; `~thread.thid` from `threadId` (else the document `id`) only when it has the RFC 0008 shape `[-_./a-zA-Z0-9]{8,64}` and omitted otherwise, never rewritten (section 3.1); the transport-authenticated sender is the connection's `theirDid` (section 3).
- `binding/didcomm` 0.2 (draft): message type `https://trusttasks.org/binding/didcomm/0.1/envelope`, `body` is the document verbatim, `thid` from `threadId` else `id`, `pthid` from `parentThreadId`, authcrypt.

No cryptography is written in the suite. Packing, authcrypt, connections and the HTTP transport are Credo-TS (`@credo-ts/core`, `didcomm`, `askar`, `node`), loaded with `createRequire` from a directory named by `DIDCOMM_ROOT` (a keyring-wallet bifold checkout's `packages/witness-server` works). Credo is therefore not a dependency of the suite. `signAs` makes an `eddsa-jcs-2022` proof with the key behind the connection's own DID (the key stays in Credo's key store), in the form of `src/crypto/proof.ts`.

Two Credo facts the carrier handles, recorded because they cost time: (a) `@openwallet-foundation/askar-nodejs` must be required before any `@credo-ts` module, or Credo's ES modules snapshot an unregistered binding; (b) an agent receives a given out-of-band invitation once, so each harness actor gets its own agent (own wallet, own inbound port).

## 4. Identity mapping (a property of the carrier, not of any implementation)

The harness names parties by actor (A, X, ...), each with a `did:key`. A v1 envelope authenticates a verkey that the connection binds to a DID (bindings/didcomm-v1 0.2 section 3), so an actor's identity on this carrier is its connection DID. The adapter therefore opens one connection per actor, and in the bytes it sends it rewrites each actor's `did:key` to that actor's connection DID and the IUT vid to the witness DID of the sending connection; replies are rewritten back. A document the harness signed is re-signed after the rewrite with the key behind the connection DID, keeping purpose and `created`. Consequences, stated as limits: a vector that corrupts or tampers with a proof cannot be carried (the re-signature would repair it); `from: none` and `from: spoof` are refused (a DIDComm connection always authenticates its sender, so the capability `transportIdentity` is not declared); documents that are not JSON text cannot be placed in an attachment (the adapter reports `transport.kind: refused`).

## 5. The witness-server adapter and vectors

The adapter takes an out-of-band invitation (the server's `invitationUrl`, as a person would scan it) and knows only the wire. It declares the served types the witness documents (the pair `witness/session` and `witness/session/submit` at 0.2, or at each version named in `WITNESS_VERSIONS`, for example `0.2,0.1`; a version not named is not offered and its vectors are SKIP), `clockFree`, and no other optional capability. It reads nothing of the server's code and sets nothing on it. Governance and deployment choices (locality policy, event window, issuer identity, session lifetime) are not asserted by any vector: the run is measured against whatever the server is configured to do, and the configuration used is recorded in the run README.

Vector groups (every vector quotes its source rule and the spec's draft status in `spec`; the vector count is generated in Vector families, and the per-group lists are `vectors/witness/wsd.json`, `wss.json` and `wsb.json`):

| Group | Rules covered |
|---|---|
| WSD (discovery 0.4) | default and empty patterns mean `*`; `<prefix>/*`; a pattern that matches nothing; 17 patterns refused; unknown member refused; recipient absent refused; wrong recipient refused; no expanded-entry member beyond `type`, `requiredExt` and `acceptanceWindow` (the 0.4 schema); the discovery type itself listed (CLARIFY) |
| WSS (session 0.2) | challenge and domain present; response proof present; no challenge reuse; each party's own session; issuer not in `parties` refused `witness/session:refused`; `parties` shape (1, 3, not-a-DID); no `issuedAt`; replay does not open a second session; no recipient |
| WSB (submit 0.2) | unknown session refused; wrong challenge `challengeMismatch` before other checks; another party's session `challengeMismatch`; unsigned request `proofRequired`; no `vp`; right challenge but unverifiable presentation (CLARIFY); `authentication`-purpose proof (CLARIFY) |

Not covered, and why: the success path of submit (a VWC) needs a real, verifiable relationship credential presentation and, where the server requires locality, a Bluetooth proof, neither of which the suite can mint; the older 0.1 pair and discovery 0.1 (out of focus; the WIT group keeps three labelled older vectors, docs/29); TSP carriage; mediated (non-direct) deployments.

## 6. Non-vacuity (witness oracle)

docs/04 section 9 requires every negative vector to fail against a mutated reference. The witness vectors are checked against a small, specification-driven oracle, `src/adapters/reference/witness-oracle.ts`, reached as the reference adapter mode `reference-witness` (option `witness`; runner specs `reference-witness` and `mutant-witness:<id>[,<id>]`). It implements only what `trust-task-discovery` 0.4, `witness/session` 0.2 and `witness/session/submit` 0.2 state (and serves the 0.1 types as the older version, the session and submit pairing one to one, a submission in the other version being `challengeMismatch`) (Conformance and front matter; every check cites its rule in the file): patterns and bare Type URIs without duplicates; `witness/session:refused` for an issuer not in `parties`; a fresh challenge of at least 16 characters and a domain under a signed response; for submit, the binding to the session challenge verified first and the opening party checked (`challengeMismatch`), then the presentation's own proof (`presentationInvalid`). Framework steps (recipient, proof, freshness, duplicate record, payload schema) are the adopted runtime's pipeline, configured per document from the front matter. The oracle declares the DIDComm bindings the vectors gate on and serves only the three witness-family types, each at the latest version and at 0.1; it models the documents, not the carriage. The default reference adapter is unchanged (it declares no `didcomm` binding, so these vectors are SKIP for it), and the `reference-witness` run is selected explicitly.

The manifest declares no `nonVacuity: "pending-oracle"`, so the loader's mutant-declaration check applies to the suite: every negative vector names at least one mutant (`witness*` mutants of their own and the existing `discovery*`, `recipientOptional`, `noRecipientCheck`, `noPayloadValidation`, `noFreshnessWindow`, `noReplayRecord`, `unsignedReplies`, `proofOptional`, `proofRequiredAsInvalid`). `test/witness-oracle.test.ts` requires the unmutated oracle to pass every witness vector (the CLARIFY ones observed to pass) and every declared mutant to make its vector fail. No negative vector needed a blanket or per-vector exemption. The CLARIFY vectors WSD-009, WSB-004 and WSB-007 also carry a mutant, which shows the observation is not vacuous either.

Limits. The oracle never mints: the submit specification leaves minting to the witness's own decision under its policy and the suite can build no verifiable relationship credential, so a presentation that verifies is declined with `taskFailed`; the success path stays untested (docs/16 item 9). The mutants that skip a check mint a stub credential only so that the skipped check is visible. A mutant is caught by the vector's stated expectation (code or disposition), as in the rest of the suite. Checking the oracle against the vectors found one gap in the runner, fixed here: the engine checked the bare-URI and no-duplicate rules (responder rules 3 and 4) only for discovery 0.3 and 0.4 responses, so WSD-001's duplicate mutant passed; the engine now applies them to 0.1 responses as well (not the unknown-member rule of expanded entries, which WSD-010 alone asserts).

## 7. Results (witness server, DIDComm v1, one local run)

Current figures are generated: the "Witness server over real DIDComm" row of Coverage and results/platforms/keyring-wallet.md. Advisories (SHOULD: error replies carry no `issuer`), details and the run configuration of the first run: `<results dir>/runs/2026-11-15-witness-server/README.md`. A re-run with the oracle in place gave the same figures vector by vector and lists where oracle and server differ: `<results dir>/runs/2026-11-15-witness-oracle/README.md`.

The KNOWN-FAIL entries, each in `exceptions/exceptions.json` (`impl` `witness-server`) with owner `unassigned` and the expiry [exceptions/expiry-policy.json](../exceptions/expiry-policy.json) gives that key:

- WSD-004: discovery ignores `patterns`; a pattern that matches nothing still lists both witness types.
- WSD-010: with locality policy `offered` an expanded entry carries `offeredExt`, not in the 0.4 response schema either (deployment-dependent).
- WSS-005: a session opened by a party not named in `parties` is accepted (the spec requires `witness/session:refused`).
- WSS-010: a replayed session document is executed again (a new challenge) instead of being answered as a duplicate (SPEC.md 7.2 item 11).

CLARIFY: WSD-009 (whether the discovery type must list itself), WSB-004 (the code for a bound but unverifiable presentation: the server answers `challengeMismatch`), WSB-007 (the server rejects a request proof made for `authentication` with `proofInvalid`; neither spec pins a purpose, the key is listed under `authentication` in the DID document). Two vector expectations were corrected from the specification during the work, not fitted to the server: a recipient that is not the witness is `wrongRecipient` (SPEC.md 8.3, 7.2 item 5), not `identityMismatch`.

## 8. DIDComm v2

The carrier implements `binding/didcomm` 0.2 (message class, `toV2Plaintext`, inbound reassembly of the spread body) and the adapter primes each actor's connection (below). Against the server with `WITNESS_DIDCOMM_VERSIONS=v1,v2` and `DIDCOMM_VERSION=v2` the witness vectors give **every per-vector status and failure text equal to the v1 run** (21 PASS, 4 KNOWN-FAIL, 3 CLARIFY, 0 FAIL on the 28-vector witness set, 2026-11-15; superseded, current figures in Coverage) (`<results dir>/runs/2026-11-15-observe-oracle-v2/`, which also records the earlier run: 19 FAIL, all but two vectors with no reply, the other two expecting silence). Claimed: the v2 carriage of those documents (authcrypt, `type` the envelope URI, `body` the document) is accepted and answered by this one server, and the vector verdicts do not depend on the carriage. Not claimed: any other implementation, the DIDComm v2 binding vectors (this group tests the witness specifications, not the binding), mediated or routed delivery, and that a conforming witness must behave like this one in the two points below.

Why the first run saw nothing (server source: `packages/trust-tasks/src/TrustTaskEnvelopeV2Message.ts`, `v2Binding.ts`, `witness-server/src/trustTasks/WitnessTaskSessions.ts`, Credo-TS `DidCommThread` decorator):

1. **Thread id shape.** Credo-TS turns a v2 plaintext into a v1 shape and validates `thid`/`pthid` as `~thread` ids (RFC 0008: 8 to 64 of `-_./A-Za-z0-9`, or a DID). Trust Task ids are `urn:uuid:...` (colons), so a `thid` taken from the document's `threadId`/`id`, as binding section 3.1 recommends, fails class validation: `ClassValidationError ... thread.threadId has failed the following constraints` on the server, a problem report back, and on the carrier `Not sending problem report in response to problem report` and `Timeout has occurred` (the HTTP inbound transport waiting for a return message that is never produced). Both directions are affected: the server's replies carry `thid` = the request id and the carrier's own Credo dropped them. The carrier now omits `thid`/`pthid` when they are not representable (the document's own `threadId` in `body` still correlates, and the server's `checkV2ThreadCorrelation` accepts an absent `thid`), and, in v2 mode only, removes the `Matches` check on `ThreadDecorator.threadId/parentThreadId` from its own process so the server's replies are delivered. That is a client-side relaxation of a Credo v1 rule the v2 binding does not impose. The binding text says SHOULD for `thid`; whether it should name a representable id is a question for the binding, not settled here.
2. **Rotated witness DID.** A reusable v2 invitation is answered from a DID the server creates per connection on first contact (`did:peer:2...`, differing from the invitation's), and the document `recipient` is compared to that DID (`wrongRecipient` otherwise). The server's error replies carry the invitation DID as `issuer`, not the rotated one, so the earlier priming that read `issuer` learned the wrong DID (10 PASS, 11 FAIL once replies flowed). The adapter now sends one recipient-less discovery request per actor and takes the DID from the connection the reply arrives on (Credo updates `theirDid` to the reply's `from`). This priming is a property of the observed server, not of the binding, and is the only server-specific step in the v2 path.
The v2 carriage is declared only when `DIDCOMM_VERSION=v2`.

The witness server is re-run over both versions in the current run folder `<results dir>/runs/2026-11-16-agreed-witness-server/` (`v1/`, `v2/`), and the specification-driven witness oracle (`--adapter reference-witness`) in 2026-11-16-agreed-reference/witness-oracle (`<results dir>/runs/2026-11-16-agreed-reference/witness-oracle/`); their figures are generated in Coverage and not restated here. keyring-wallet's own agent over real DIDComm is a separate adapter, docs/18.

## 9. Re-running

The server runs from a copy, never inside the keyring-wallet checkout: it writes its wallet (`.wallets/`), seed (`.witness-seed.json`), reporting store (`.reporting/`), invitation (`.oob-invitation.json`) and build output (`dist/`) into its own package directory. The copy needs only the package and the bifold root manifest; the bifold dependencies, including the built workspace packages (`@bifold/trust-tasks` and the others), are read from the checkout through a link. The checkout must have its dependencies installed and its workspace packages built.

```sh
umask 002
# 1. a copy of the witness-server package next to the bifold root manifest, dependencies linked from the checkout (read only)
mkdir -p <witness-server copy>/packages
cp <keyring-wallet checkout>/bifold/package.json <witness-server copy>/
rsync -a --exclude .wallets --exclude .oob-invitation.json --exclude .witness-seed.json --exclude .reporting --exclude .env --exclude dist \
  <keyring-wallet checkout>/bifold/packages/witness-server <witness-server copy>/packages/
ln -s <keyring-wallet checkout>/bifold/node_modules <witness-server copy>/node_modules
cd <witness-server copy>/packages/witness-server
# 2. configuration (a deployment choice, recorded in the run README; no vector asserts it)
cat > .env <<'EOF'
WITNESS_NAME=witness-conformance
WITNESS_PORT=19412
WITNESS_WEB_PORT=19413
WITNESS_PUBLIC_URL=http://127.0.0.1:19412
WITNESS_DIDCOMM_VERSIONS=v1,v2
WITNESS_LOCALITY_ENABLED=false
WITNESS_LOCALITY_REQUIRED=false
WITNESS_INVITATION_FILE=.oob-invitation.json
EOF
# 3. build in the copy and start (direct mode); the server writes .oob-invitation.json when it is listening
nice -n 10 ../../node_modules/.bin/tsc
nice -n 10 node -r ./tsp-esm-preload.cjs dist/index.js
```

`WITNESS_LOCALITY_POLICY` is left unset, which the server reads as `offered`; the legacy `WITNESS_LOCALITY_*` variables above have no effect on the policy. Node 20.19 or later is needed (the preload requires an ES module). For a clean start, stop the server and delete `.wallets/`, `.witness-seed.json` and `.oob-invitation.json` in the copy.

Then, from the suite checkout, with the server listening:

```sh
export DIDCOMM_ROOT=<witness-server copy>/packages/witness-server WITNESS_INVITATION_FILE=$DIDCOMM_ROOT/.oob-invitation.json CARRIER_PORT=19512
for v in v1 v2; do DIDCOMM_VERSION=$v nice -n 10 npm run suite -- --kit <TF checkout> --vectors vectors/witness --tier 1 --timeout 90000 \
  --adapter 'stdio:node --experimental-strip-types --disable-warning=ExperimentalWarning src/adapters/witness-server/index.ts' --out <run folder>/$v; done
```

The carrier uses `CARRIER_PORT` and the next ports (one per actor, up to six). Each version takes about two minutes (silence and refusal waits). Ids are salted per run, so a second run against the same server does not replay the first run's documents. The current run's README records the measured `bifold` commit and the exact commands.
