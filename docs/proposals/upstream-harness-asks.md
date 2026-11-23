# Upstream asks that would make a conformance harness easier to connect (DRAFT, NOT SENT)

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite. **DRAFT, NOT SENT.** Nothing here has been posted, filed or sent to any project, and no project has been contacted. Each ask is an idea to be decided by the project owner first. Date: 2026-11-15.

This page lists four possible small requests to the maintainers of VTI (verifiable-trust-infrastructure) and keyring-wallet that would make it easier for a conformance harness, and any third-party client, to connect to their code. It is research from reading the code only (marker **(V)** = verified by reading the file at the pinned commit; **(I)** = inferred or not run). Nothing was built or run. Pins: keyring-wallet `62af4d2d` (bifold submodule `7e14c512`), VTI `55327b66`. Paths are relative to each project's own repository; line numbers will drift. The adapter contract referred to is in [../04-suite-design.md](../04-suite-design.md) section 4.

The default stance of the suite is not to modify the platforms it measures; these asks are optional, framed as benefits to the maintainers, and each can be declined or dropped without loss. Related: [../16-roadmap-and-decisions.md](../16-roadmap-and-decisions.md), [../15-keyring-wallet-didcomm-v2.md](../15-keyring-wallet-didcomm-v2.md).

## 1. Recommendation and verdicts

Of six candidates considered, three survive verification as real asks (one mostly documentation), one is a separate feature request, and three are dropped or not to be asked.

| # | Ask | Verdict | Why in one line |
|---|---|---|---|
| A | VTI: a small standalone mock VTC / mock VTA example binary over the test-support code that already exists, plus a short doc | Ask first | `MockVta` and `MockVtc` (ephemeral, loopback, token minting, seeding) exist but are Rust-library-only; a short `[[example]]` makes them reachable from any harness. |
| B | keyring-wallet (bifold): `VtaClient` options for an injectable session factory, clock and id source | Ask second, optional | Real, small, backwards compatible, but does not by itself remove the dependency on the Credo agent object, so its value to a harness is moderate. Frame it as a testability improvement. |
| C | keyring-wallet witness-server: `WITNESS_BIND_HOST` (default unchanged) | Ask, tiny | Stable identity, TLS and fixed ports already exist by environment variable; the one gap is that both listeners bind all interfaces. |
| D | keyring-wallet: serve `trust-task-discovery` 0.3 | Feature request, separate thread, not a harness hook | A small registration plus handler; 0.4 is not in the pinned package. |
| (manifest) | Served-types manifest | Drop | VTI derives it from its dispatch table and serves it over discovery 0.3/0.4; keyring-wallet exports its registry list and answers discovery. Nothing to add. |
| (outbox) | VTI outbox inspection behind a flag | Drop as stated | A production read surface over other parties' pending signed documents. The test-only path (inside Ask A) and the shipped loopback REST push give the same observation with no production surface. |
| (emit hook) | VTI emit hook for send-only tasks | Drop | The real triggers exist (admin routes and normal consent and step-up flows); what is missing is fixtures, not hooks. A hook in real builders is the highest-risk change on the list. |
| (witness HTTPS) | Witness dev-only HTTPS trust-task binding | Do not ask | The witness has no `/trust-tasks` route; it carries Trust Tasks over DIDComm. A binding would be a new product feature. |

Suggested path: send Ask A as an issue or discussion first (cheap to accept or decline) and open pull requests only once a maintainer says yes. Ask C could go as a small direct pull request; Asks B and D are better as an issue first. VTI's contributing guide requires a contributor licence agreement and sign-off and cites requirement identifiers; these asks touch no normative requirement and any pull request should say so (section 7).

Status of every ask: **not sent**.

## 2. Ask A (VTI): standalone mock VTC / VTA, plus a "conformance boot" doc

### Evidence: what exists (V)

- `vta-service/src/test_support.rs:2144-2160`: `MockVta`, "a real, listening HTTP server a test harness can drive over the wire, with no setup ceremony", ephemeral state, no TEE/KMS/mediator, bound to `127.0.0.1:<random>` (`:2671`).
- `vta-service/src/test_support.rs:952`: `mint_token(did, role, contexts)` mints an authenticated session and token and writes the ACL row. It is `cfg(any(test, feature = "test-support"))` only (`:17`), not in the shipped `vta` binary.
- `vta-service/Cargo.toml:119` `test-support`, `:134` `transport-harness` (adds an embedded test mediator, "Test-only, never in a production build"). The comment at `:395` says `test-support` "exists to serve *external* consumers".
- `vtc-service/src/test_support.rs:1019` `MockVtc` (same shape, `127.0.0.1:0` at `:1071`), `:134` `TestVtcBuilder`. Features at `vtc-service/Cargo.toml:98` and `:105`.
- The VTC's `mint_token` is a different thing (a passkey install token, test-only); the VTC test route for an authenticated caller is built with the harness types in `tests/it/common/`.
- Real binaries: `vta` and `vtc`. The store is an on-disk key-value store at `data_dir`; there is no in-memory store selectable by configuration (a tmpfs `data_dir` is the substitute). Default bind is `0.0.0.0` (`vta-config/src/lib.rs:777`) but `host` is configurable. Non-interactive setup is documented (`docs/03-vtc/non-interactive-setup.md`, `docs/02-vta/non-interactive-setup.md`).
- The suite's live VTI adapter uses a separate public starter kit (docker compose, offline `vtc acl add` seeding; the kit calls itself "DEV ONLY (plaintext secrets)"). It is not part of the VTI repository.

### What is missing

- A non-Rust way to start the mock: an `[[example]]` or small binary that serves `MockVtc` / `MockVta`, prints base URL, service DID and minted tokens or seeded DIDs as one JSON line, and exits on stdin close.
- A short doc page, "conformance boot profile", listing the two routes (the mock for in-process speed; the real binary with a tmpfs `data_dir`, `host = "127.0.0.1"` and offline `acl add`, cross-referenced to non-interactive setup).
- Unknown, to confirm with the maintainers: whether `MockVtc` serves `/v1/trust-tasks` with the production router (it uses `vtc.router`, so very likely) and whether a mock can push to a recipient.

### Observing pushes without a production change (I)

- All VTC pushes go through one chokepoint, `vtc-service/src/member_push.rs:68` `push_trust_task`, onto the durable outbox (`vti-common/src/outbox_store.rs`) and the `member_pushes` keyspace (`PushRecord` at `vti-common/src/trust_task_push.rs:291` holds the signed document; the struct is private and the keyspace may be encrypted).
- The push engine supports a REST leg: `POST {base}/trust-tasks` to a recipient DID document service of type `TrustTaskHTTPS`; plain `http://` is allowed only to exact loopback "for local development" (`trust_task_push.rs:613-641`). A harness that is the recipient (a DID document with a loopback `TrustTaskHTTPS` service) should therefore be able to receive and record pushed documents with no VTI change. Caveats not run: the REST transport is registered inside the messaging bootstrap (`vtc-service/src/messaging.rs:575`), so a boot with no messaging may not push at all; and the recipient DID must resolve with that service (did:key has none). Verify at runtime before asking anything about this.
- If still wanted, the right ask is a test-only accessor on `MockVtc` ("documents pushed so far") under the existing `test-support` feature, not a production endpoint.

### Minimal diff sketch (prose)

- New `vtc-service/examples/mock_vtc.rs` and `vta-service/examples/mock_vta.rs`, `required-features = ["test-support"]`, about 40 lines each: build with `TestVtc::builder()`, `MockVtc::start_with`, read an optional `--seed-did` list, print `{"baseUrl":..., "serviceDid":..., "tokens":{...}}`, block on stdin EOF.
- Optionally a `pushed_documents()` accessor on `MockVtc` (test-support only).
- One doc page under `docs/` or a section in `docs/03-vtc/getting-started.md`.

### Benefit to maintainers independent of the harness

Any third-party Trust Task client can test against a real router without a Rust toolchain in its test code; it also gives a one-command reproduction for bug reports and a smoke target in CI for non-Rust SDKs.

### Risk

Production attack surface: none if the examples are gated by `required-features` and never part of a release artifact. Not checked (I): whether examples with required features are excluded from published crate tarballs. Maintenance: they must keep `test-support` compiling, which their own integration tests already require. Say plainly that it is a development tool with no stability promise.

### Draft text (DRAFT, NOT SENT)

```
Title: Could the existing MockVtc / MockVta be started from the command line?

Hello, and thank you for the work on VTI. I have been writing a conformance harness for Trust Tasks (outside Rust) and found that vta-service and
vtc-service already ship exactly what a harness wants: MockVta and MockVtc under the test-support feature (ephemeral state, loopback only, a minting
helper for authenticated callers, ACL seeding). They are only reachable from Rust test code, though, so a client written in another language
cannot use them.

Would you be open to a small PR adding an example binary for each (required-features = ["test-support"], not built by default and not part of a release)
that starts the mock, prints one JSON line with the base URL, the service DID and any seeded identities/tokens, and exits when stdin closes? I would
also add a short docs page describing the two ways to boot a throwaway instance (the mock, or the real binary with a tmpfs data_dir, host = "127.0.0.1"
and offline `acl add`). If it is useful, a test-only accessor on MockVtc listing the documents it has pushed would let a harness check the next-step
documents without any production endpoint.

No normative requirement is touched. I would follow CONTRIBUTING (conventional-commit title, DCO sign-off, cargo fmt and clippy clean). If you would
rather not carry this, or prefer a different shape, I am happy to keep it on our side; I wanted to ask first. Thank you!
```

## 3. Ask B (keyring-wallet): injectable session factory, clock and id source in VtaClient

### Evidence (V)

- `bifold/packages/core/src/modules/trust-tasks/module/VtaClient.ts` is 2905 lines. The class is at `:901`; the constructor at `:1150` takes `(agent, vtaDid, store, options)`.
- The transport is `VtiMediatorSession` (`VtiMediatorTransport.ts:499`), the only `fetch` (`:584`, `:620`) and the only `WebSocket` (`:737`) in the pair. `VtaClient` constructs it at exactly one site, `VtaClient.ts:1257`. The interface it needs is about six methods: `start`, `stop`, `isOpen`, `checkAlive`, `sendTo`, `sendTspFrame`.
- Clock: `Date.now` / `new Date` appear 17 times in `VtaClient` (for example `:566` `nowSec`, `:1216`, `:1340`, `:1433`) and a handful of times in `VtiMediatorSession`. Ids: `utils.uuid()` about 10 times in `VtaClient`.
- Existing seams: `vtaAgent.ts:287-298` already accepts client factories, and 25 of the 313 test files construct `new VtaClient(`, so a new optional option member cannot break them.
- Important limit: `VtaClient` also depends directly on the Credo agent object for DID resolution, key access and envelope packing (for example `authcryptTo` `:1906`, `tspSessionForManager` `:1249`, `packTrustTaskForPeer` `:1347`). An injectable transport lets a harness replace the mediator socket, not the DIDComm v2 packing; a harness still needs a Credo agent (it can run in Node).
- The suite's keyring-wallet shim fakes the process clock with jest fake timers because the wallet has no injectable clock (`src/adapters/keyring-wallet/shim.ts` in this repository), which is the clock-side motivation.

### Minimal diff sketch

- Add optional constructor options `sessionFactory`, `now`, `newId`, each defaulting to today's behaviour (`new VtiMediatorSession(...)`, `Date.now`, `utils.uuid`).
- Export a `VtiSessionLike` interface (the six methods) from `VtiMediatorTransport.ts` and have the class implement it.
- Replace the 17 + 10 call sites with `this.now()` / `this.newId()` (mechanical).
- Tests: one new unit test with a fake session and a fixed clock; the existing constructors are unchanged.

### Benefit independent of the harness

Deterministic tests without fake timers or mocking the whole transport module; retry and backoff logic (breaker, read lane, probe timeouts) becomes testable.

### Risk

Low: mechanical and default-preserving. The cost is review size (about 30 lines in a 2900-line, very active file) and merge conflicts; scope a first change to the options and the session site, and the clock and id substitution second. The code lives in the `bifold` submodule, a separate repository, so it is a bifold change first and then a submodule pointer update.

### Draft text (DRAFT, NOT SENT)

```
Title: Optional injectable session, clock and id source for VtaClient?

Hello, and thanks for the great work on Keyring. While wiring an external Trust Task conformance harness to the wallet we found that VtaClient is
tied to VtiMediatorSession (fetch, WebSocket) and to Date.now / utils.uuid, so tests either mock the whole transport module or fake the global Date.

Would you be open to a small, backwards-compatible change: three optional constructor options on VtaClient (sessionFactory, now, newId), each defaulting to today's
behaviour, plus a small VtiSessionLike interface that VtiMediatorSession implements? The session is created at one site (VtaClient.ts, the
`new VtiMediatorSession` call) and the clock/id calls are mechanical to replace. No existing test constructor would need to change.

If this is welcome I can send the PR in two parts (options and session first, clock and id substitution second), with a unit test using a fake
session and a fixed clock. Happy to adjust to whatever shape suits you, or to drop it if it is not a priority. Thank you!
```

## 4. Ask C (keyring-wallet witness-server): bind host, and a small doc fix

### Evidence (V)

- Stable test identity already exists by environment: `WITNESS_ISSUER_SEED` (`src/config.ts:390`), `WITNESS_ISSUER_DID` (`:493`), `WITNESS_ISSUER_KEY_FILE` (`:495`), `WITNESS_INVITATION_FILE` (`:496`, stable invitation across restarts), `WITNESS_PORT` 9002 (DIDComm HTTP inbound) and `WITNESS_WEB_PORT` 9003.
- HTTPS exists: `WITNESS_TLS_ENABLED=true` (`:396`), certificate, key and directory variables, `WITNESS_TLS_AUTO_GENERATE` (default true), `WITNESS_TLS_HOSTNAMES`, `WITNESS_TLS_VALIDITY_DAYS` (`:397-402`); `TlsManager.ts` auto-generates a self-signed certificate; `WebServer.ts:410-420` creates the HTTPS server. HTTPS applies to the web/API server only (QR page, `/api/issuer`, `/api/verify`, `/api/issued`, `/log`), not to the DIDComm inbound port.
- Gaps: (a) `server.listen(config.webPort, ...)` (`WebServer.ts:455`) and `DidCommHttpInboundTransport({ port })` (`WitnessService.ts:372`) give no host, so both bind all interfaces; there is no `WITNESS_BIND_HOST`. (b) The `WitnessServerConfig.tlsEnabled` doc comment says "Default: true (secure by default)" but the code defaults to false (`config.ts:396`). (c) `/api/mock/start|stop|reset` (`WebServer.ts:280-295`) are unauthenticated mutating POST routes on whatever interface the server binds; unrelated to the harness, but the reason a loopback option matters.
- There is no `/trust-tasks` HTTPS route. Trust Tasks (`witness/session`, `witness/session/submit`, discovery) travel over DIDComm v1 or v2 (`src/trustTasks/runtime.ts`, `WITNESS_DIDCOMM_VERSIONS`), so the suite's HTTPS-binding vectors cannot apply to the witness.

### Minimal diff sketch

`WITNESS_BIND_HOST` (unset keeps current behaviour) passed as the host argument to `server.listen(port, host, cb)` and, if Credo's `DidCommHttpInboundTransport` accepts one (not confirmed, I), to the inbound transport; documented in `.env.sample` and the README; fix the `tlsEnabled` comment.

### Benefit and risk

Lets anyone run the witness on a laptop or CI runner without exposing the activity log, dashboard and mock-data routes to the LAN. Very low risk: off by default, no change for existing deployments; Docker keeps `0.0.0.0`.

### Draft text (DRAFT, NOT SENT)

```
Title: WITNESS_BIND_HOST for the witness server (and a small doc fix)?

Hello, and thanks for the witness server; it is very easy to run locally. The stable issuer seed, the invitation file and the TLS options were exactly what we
needed for repeatable local runs.

One thing we could not find is a way to bind to loopback only: the web server (`server.listen(config.webPort, ...)`) and the DIDComm inbound transport listen on every
interface, so the activity log, the network dashboard and the /api/mock/* routes are reachable from the LAN when someone just wants a local instance.

Would you accept a small PR adding an optional WITNESS_BIND_HOST (unset keeps today's behaviour, so Docker is unaffected), documented in .env.sample and the README?
While there I would correct the comment on tlsEnabled ("Default: true") which does not match the code (default false). Thank you!
```

## 5. Ask D (keyring-wallet): serve trust-task-discovery 0.3 (a feature request)

### Evidence (V)

- Peer-leg discovery is registered only at 0.1: `ceremony.ts:2011` registers the 0.1 Type URI (imported at `:30`); the handler `handleInboundDiscovery` (`ceremony.ts:830-865`) answers `supportedTypes` from `SUPPORTED_TASK_TYPES` (`:172`, four types) plus `trustTaskRegistry.listTypeUris()`. The witness server also loads only 0.1 (`witness-server/src/trustTasks/runtime.ts:22,42`).
- The registry dispatches on the exact Type URI (`registry.ts:153-157`), so a 0.3 document is unhandled today.
- The pinned `@openvtc/trust-tasks` (0.28.1 in the wallet's dependencies) has discovery 0.1, 0.2 and 0.3 only; no 0.4. The 0.3 response has the same `supportedTypes` plus an optional response-level `acceptanceWindow` (`maxAgeSeconds`, `clockSkewSeconds`).
- VTI answers 0.4 and 0.3 (`vta-service/src/trust_tasks/discovery.rs`, `vtc-service/src/trust_tasks/discovery.rs`); the wallet's `VtaClient` already asks 0.3 first (`pcsVtaPayloads.ts:44-51`).

### What serving 0.3 takes

- A second registration (`registerBuiltinTrustTasks`, `ceremony.ts:1995`) for the 0.3 Type URI with the 0.3 payload spec, reusing the handler body. Keep 0.1 registered for older peers.
- A decision for the maintainers: whether to include `acceptanceWindow`. The wallet enforces a clock skew of five minutes and no maximum age (the suite shim's own note), so advertising a window would state a policy it does not have; it is optional and can be omitted.
- 0.4 would need a bump of the pinned package first. Size: about 20 lines plus a test; the real effort is the sender-side choice of version per peer, which is their design call.

Benefit: peers that ask for 0.3 could be served (conformance-implied; no exchange demonstrated), removing a version cliff. Risk: low; only in negotiation, not in serving an extra read-only type.

### Draft text (DRAFT, NOT SENT)

```
Title: Serve trust-task-discovery 0.3 alongside 0.1?

Hello, and thank you for the Trust Task work in Keyring. We noticed that the wallet and the witness server answer trust-task-discovery 0.1 only, while the
VTA and the community service answer 0.3 and 0.4 (and the wallet already asks the VTA for 0.3 first).

Would you consider registering the 0.3 Type URI next to 0.1 with the same handler (the supportedTypes list is the same shape; the response-level acceptanceWindow is optional, so
it could simply be omitted)? Nothing else would change. We are glad to send a PR with a test if that is welcome, or to leave it to your roadmap. Thank you!
```

## 6. Candidates dropped or corrected, with evidence

- **Served-types manifest: drop.** VTI's discovery answer is "derived from the dispatch table, so it cannot claim a task this service does not actually route" (`dispatched_uris()` in the VTA, `served_uris()` in the VTC), with a census test that every served URI is pinned; over the wire it is discovery 0.4 for authenticated callers with `acceptanceWindow`. keyring-wallet's list is `trustTaskRegistry.listTypeUris()` plus `SUPPORTED_TASK_TYPES`, both exported; versions are part of the Type URI. "Per leg" does not exist as a data model on either side.
- **Observing pushed documents behind a flag: drop as a production feature.** A read endpoint or file over pending signed documents addressed to other members, in an encrypted keyspace by design, would be a new authenticated read path to sensitive records where none exists today; a compile-time flag and loopback bind reduce but do not remove that. Plausibility of acceptance: low for production code, high inside `test-support`. Alternative without a change: be the recipient (loopback `TrustTaskHTTPS` service) or the test-only accessor in Ask A.
- **Emit hook for send-only tasks: drop.** The tasks have real triggers: `request-vmc` is an admin route (`POST /v1/members/{did}/request-vmc`); `removal-notice` fires on a real removal and not on self-leave; `task-consent/request` and `push/wake` come from the VTA's consent and step-up paths, only in real flows. What a harness lacks is fixtures (an enrolled approver, a consent policy, a member), which Ask A's boot profile and doc can provide. An emit hook would let a caller make a service sign and send arbitrary documents from its real keys, a signing oracle even behind a flag. Better: after Ask A, ask for a documented recipe for triggering each push in the mock.
- **Conformance boot profile: merged into Ask A, corrected.** `mint_token` is test-only and exists for the VTA; the VTC has no equivalent in a shipped binary. There is no in-memory real-binary mode. Default bind is `0.0.0.0`; loopback is a configuration value.
- **Witness dev-only HTTPS binding: do not ask.** **Stable test identity flags: already exist** (Ask C).

## 7. How the asks map to harness blockers, and contribution conventions

Mapping. Reach: Ask A improves VTI reach cheaply; it does not give keyring-wallet the real DIDComm v2 wire (that needs Ask B, a Credo agent, a mediator, and possibly the developer option in [../15-keyring-wallet-didcomm-v2.md](../15-keyring-wallet-didcomm-v2.md)). Send-only (producer) class: none of the asks removes it; observing what a real builder emits needs the test-only accessor or loopback REST push for VTI, and a hook in the wallet for keyring-wallet (out of scope by default).

Contribution conventions, as read from the repositories (no one contacted):

- **VTI:** Apache-2.0. A contributor licence agreement is required (the contributing guide points to an individual and an entity form; the form directory was not in the checkout, so which applies, and whether contributing on behalf of an organisation changes it, must be confirmed on the hosting site first). DCO sign-off on commits. The pull request title is a conventional commit and its body is published verbatim; target `main`; do not edit `version =`; formatting, lint with warnings denied and tests clean; new public functions need doc comments; changes to authority, transports or sessions must cite `VTI-*` identifiers. These asks touch none, so a pull request would say "no normative requirement affected". Rust edition 2024, a cold build is large.
- **keyring-wallet and bifold:** Apache-2.0 in both. Pull requests from a copy of the repository are evaluated by the repository guardians on a schedule; contributors retain copyright (no separate agreement). Sign-off plus a verified cryptographic signature on commits to `main`. Conventional commits via commitlint; in `bifold/` the sign-off must be the last line of the message and name the commit's own author. The pull request template asks for goal, changes, docs and tests, environment-variable documentation (relevant to Ask C) and test steps. `bifold/` is a separate repository, so a change there is its own pull request and then a submodule pointer update.

## 8. Open decisions (recommendation first)

1. **Send Ask A first, as an issue rather than a pull request.** Recommend yes. Pro: cheapest, highest acceptance, serves other third parties. Con: example binaries add a small maintenance burden.
2. **Run a short experiment on loopback `TrustTaskHTTPS` push before Ask A**, so the ask can say what works today. Recommend yes (needs a mediator for the messaging block). It decides whether the test-only accessor is still wanted.
3. **Ask B now or later.** Recommend later, bundled with an actual need (a Node-side Credo harness). Pro of now: smaller conflict window. Con: moderate value until the agent-object dependency is also addressed.
4. **Ask C: direct pull request or issue.** Recommend a direct pull request (about 10 lines), after the contribution hooks are set up.
5. **Ask D:** raise only if keyring-wallet's served version should be measured by the suite; otherwise keep the 0.1 variant plan.
6. **Contributor licence agreement for VTI:** confirm which form applies before any pull request. No recommendation until known.

## 9. Unverified residue

Nothing was built or run. The loopback-push observation path is read from code and unit tests only. It was not confirmed that `DidCommHttpInboundTransport` accepts a host option (Ask C), nor whether examples with required features are excluded from published crate tarballs (Ask A). Line numbers are from the pinned commits.

Back to [../README.md](../README.md). Index of related pages: [the docs index](../README.md).
