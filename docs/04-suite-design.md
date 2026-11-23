# Suite design

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

Sections marked *built* describe the code as it is; *proposed* sections are not implemented. Separately, whether a design choice is **settled** (agreed for this effort), **proposed** to outside parties (a recommendation not yet agreed with any of them) or **assumed** (a working assumption that later reading may overturn) is collected in section 16.

Spec citations ("framework section 7.2 item 11") refer to the Trust Tasks framework text (Working Draft 0.7.0; the registry's specifications target 0.6, see section 6). Every specification in the registry is `draft` or `retired`. Reading the code of implementations is best effort; see [05-reference-implementations.md](05-reference-implementations.md) for confidence marks.

## Contents

- [1. Purpose](#1-purpose)
- [2. Shape of the suite (built)](#2-shape-of-the-suite-built)
- [3. Vector format tt-conformance-vectors/0.1 (built)](#3-vector-format-tt-conformance-vectors01-built)
- [4. Adapter contract (built: TypeScript types, client and example server)](#4-adapter-contract-built-typescript-types-client-and-example-server)
- [5. Key and DID provisioning (built for did:key; other methods proposed)](#5-key-and-did-provisioning-built-for-didkey-other-methods-proposed)
- [6. Version pins and windows (built)](#6-version-pins-and-windows-built)
- [7. Deterministic time, rebase mode and the run salt (built)](#7-deterministic-time-rebase-mode-and-the-run-salt-built)
- [8. Outcomes, capability gating and known failures (built)](#8-outcomes-capability-gating-and-known-failures-built)
- [9. Non-vacuity (built)](#9-non-vacuity-built)
- [10. Tiers (built)](#10-tiers-built)
- [11. Vector groups and spec traceability (built)](#11-vector-groups-and-spec-traceability-built)
- [12. Two-phase commit to lifecycle mapping (built)](#12-two-phase-commit-to-lifecycle-mapping-built)
- [13. Negative vector categories (built)](#13-negative-vector-categories-built)
- [14. Full-coverage roadmap (proposed; some steps built; dependencies marked D)](#14-full-coverage-roadmap-proposed-some-steps-built-dependencies-marked-d)
- [15. Interop milestone and capability matrix (proposed; the capability matrix is built)](#15-interop-milestone-and-capability-matrix-proposed-the-capability-matrix-is-built)
- [16. Settled versus proposed, at a glance](#16-settled-versus-proposed-at-a-glance)
- [17. Implementation as built](#17-implementation-as-built)
- [18. Spec-maturity channels and spec-drift (built)](#18-spec-maturity-channels-and-spec-drift-built)
- [19. Governance declaration (built; additive adapter contract, docs/17)](#19-governance-declaration-built-additive-adapter-contract-docs17)
- [20. Releases, run provenance and vector ids (built)](#20-releases-run-provenance-and-vector-ids-built)

## 1. Purpose

Check that independent implementations of trust ceremonies exchange the same bytes and reach the same outcomes, so a ceremony started by one can be finished by another. The framework says a conformance test suite "has not yet been published" (framework section 17.2) and that the registry's fixtures are expected to form its basis. This suite is intended to be that basis' next step: it keeps the existing fixtures as oracle and adds ceremony-level vectors.

Settled design choices:

- **Black box.** The harness sends exact bytes, receives bytes, and asks an adapter for observable state. It never inspects implementation internals.
- **Wire vectors plus thin adapters**, language neutral, rather than a library in one language or per-repo tests.
- **Tiered.** Tier 1 asserts what the framework itself requires and nothing stricter; Tier 2 asserts stricter behaviour in named sub-groups, the `attested` profile and the `profile-*` choices (section 10).
- **Carrier neutral.** The suite is defined on documents. The first carrier is HTTPS; others follow (section 15).
- **Scope** is layers 2 and 3 of [01-layer-model.md](01-layer-model.md); the suite does not speak the layer-2 transport and does not test two-phase-commit internals.
- **First ceremony:** Verifiable Relationship Credential (VRC) issue and witness-share, with a roadmap to full coverage (section 14).

Non-goals: a test of any implementation's user interface, performance or storage; a programme that awards a status to implementations; a way to bless behaviour merely because two implementations agree (see section 15 on the differential oracle).

## 2. Shape of the suite (built)

```
vectors (JSON)  ->  runner (TypeScript)  ->  adapter (per implementation, out of process)  ->  IUT
                        |                                                                   
                        +-> reference adapter (non-vacuity oracle, section 9)
```

- **Vectors** describe documents to send, clock and signing instructions, and expected dispositions and state.
- **Runner** loads vectors, filters by capability and tier, drives the adapter, validates every reply with generic validators, and writes a report.
- **Adapter** turns "send these bytes, tell me what came back, let me observe state" into the implementation's own calls. The suite's adapters live in this repository under `src/adapters/<name>/` (reference, example server, VTI live and in process, VTI emit, the keyring-wallet shim and its DIDComm adapter, the witness server). An adapter can also live with the implementation and be reached over stdio or HTTP (section 4.1): the original truststackers repository has no trust-task boundary, so it has no adapter ([platforms.md](../platforms.md)).
- **Reference adapter** wraps the task force's reference consumer runtime over a trivial carrier, so that every vector is shown satisfiable by an implementation known to follow the framework.

Proposed layout if contributed to the task-force repository (**proposed**):

```
conformance/
  README.md  format.md  adapter.md       versioned format and contract
  runner/                                TypeScript, on the registry's TypeScript runtime
  vectors/{framework,ceremony-vrc,approvals,vetting,...}/*.json  manifest.json
  fixtures -> ../fixtures/{consume,proof}   reused by reference, not copied
  adapters/reference-ts/                 non-vacuity oracle
  results/runs/<date>-<label>/           one folder per recorded run (matrix, raw results, issues)
```

## 3. Vector format `tt-conformance-vectors/0.1` (built)

The format extends, and does not replace, the task force's `fixtures/consume` (freshness, duplicate keying, timestamps) and `fixtures/proof` (Data Integrity proofs). Those fixtures are imported by reference under `suites/framework/` and remain the oracle for the harness's own helper layer. The existing convention that a manifest entry may carry an `exceptions` object naming an implementation that reaches a different result "and why", asserted so that the exception fails once the gap closes (see `fixtures/proof/manifest.json`), is kept; the suite holds exceptions in `exceptions/exceptions.json` (sections 8 and 17).

One JSON file per vector group, plus a `manifest.json` per suite. Documents are held as JSON text wherever bytes matter, as the existing consume fixtures do (`first`/`second`).

```json
{"format":"tt-conformance-vectors/0.1","group":"VRC-ISS",
 "requires":["vrc/relationships/issue/0.1"],
 "tier":2,"actors":{"A":{"keys":"harness"},"B":{"keys":"iut"}},
 "clock":{"start":"2026-11-12T10:00:00Z"},
 "profiles":{"consequential":{"skewMs":60000,"maxAgeMs":300000,"expiryHorizonMs":2592000000,"requireIssuedAt":true}},
 "vectors":[{
  "id":"VRC-ISS-014","title":"same id, re-signed proof","tier":1,
  "spec":["framework 7.2 item 11 (Keying and comparison)"],"clarify":null,
  "setup":[{"use":"scenario/accepted-proposal"}],
  "steps":[
   {"at":"+0s","send":{"from":"A","to":"B","template":"issue.request","params":{"id":"urn:uuid:..."},
      "sign":{"as":"A","purpose":"authentication","created":"+0s"}},
    "expect":{"disposition":"response","type":".../issue/0.1#response",
      "pointer":{"/payload/vrcDigestMultibase":"$digest(vrc.AtoB)"},
      "state":{"stored":{"vrc.AtoB":1}}}},
   {"at":"+5s","send":{"same":"previous","mutate":[{"op":"resign","created":"+5s"}]},
    "expect":{"disposition":"error","code":"idConflict","retryable":false,"httpStatus":409,
      "noSideEffect":true,"state":{"stored":{"vrc.AtoB":1}}}}]}]}
```

Elements:

- **`source`**: where the rule comes from, how mature that source is, and a digest of it (section 18). `spec` keeps the line-level citations; `source` names the document they point into. Required on every vector.
- **`requires`**: task types the implementation must declare (capability gate, section 8). Absent capability yields SKIP, never PASS.
- **`send`**: either a literal `document` (JSON text) or a `template` with `params` and `mutate` operations (`set`, `remove`, `resign`, `reorder`, `bom`, `truncate`, addressed by JSON pointer), plus `sign` (key alias, proof purpose, `created` offset, cryptosuite, verification-method override). Symbolic values: `$now+Ns`, `$thread`, `$id(name)`, `$digest(name)` (credential digest), `$taskDigest(name)`.
- **`expect.disposition`**: one of `response`, `error`, `next-step`, `silence`, `duplicate` (the prior reply, or HTTP 202 or 204, or silence), `any-refusal`. `code` may be a set; `pointer` holds JSON-pointer assertions; `state` holds adapter observables; `noSideEffect` asserts observable state is unchanged against a snapshot. HTTP status is asserted only on the HTTPS binding. `error` takes `errorReply: "should"` where the text makes the reply a SHOULD (section 3.2), and `silence` takes `acknowledgement: "allowed"` where the text permits the empty courtesy acknowledgement (section 3.3).
- **Generic validators run on every reply:** the envelope is valid; `id` is fresh and differs from the request's; disposition is decided from `type` alone; the error payload obeys framework section 8.2 (bounded `details`, no leaking message, section 8.2.1); no reply is made to an inbound error. A reply whose `threadId` is not the request's thread (a MUST on a next-step), whose `issuer` or `recipient` does not swap the request's parties, or whose `inResponseTo` is wrong is a SHOULD mismatch and is handled as an advisory (section 3.2). Tier 2 `attested` adds: reply signed, signer equals the request's `recipient`, purpose `authentication`, whole-second timestamps, and the SHOULD mismatches as failures.
- **Whole-second timestamps.** Producers emit RFC 3339 `Z` without a fractional part (some verifiers re-serialise through a date type and fail on `.000Z`). Consumers must accept `.000Z`, `+00:00` and fractional spellings and verify over the received bytes (fixtures `eddsa-jcs-2022-timestamp-spellings*.json`). Out-of-range values (Feb 30, hour 24, second 60, offset beyond 23:59) are refused (`fixtures/consume/timestamps.json`).

### 3.0 Steps that observe a pushed document

A step is exactly one of `send`, `verifyProof`, `verifyReceipt`, `trigger`, `restart`, `emit` or `observePushed`. `observePushed` (optional capability `observe.pushed`; docs/20) sends nothing: it asks the adapter which documents the implementation pushed and checks them.

```json
{"observePushed":{"to":"$A","type":"https://trusttasks.org/spec/credential-exchange/request/0.1","threadId":"$id(off)",
  "withinMs":250,"pointer":{"/payload/credential_request/credential_configuration_id":"..."}}}
{"observePushed":{"to":"$A","type":"https://trusttasks.org/spec/credential-exchange/request/0.1","threadId":"$id(off)","none":true,"withinMs":100}}
```

`to`, `type`, `threadId` are the filter (at least one; `$`-tokens are substituted); `pointer` and `match` assert members of a matching document (at least one document must satisfy all); `count` demands exactly that many; `none` is the negative form; `withinMs` (0 to 60000, default 0) bounds a poll in real milliseconds, a positive step passing as soon as the expectation holds and a `none` step waiting the whole period so a late push is still seen. The pushed document must be issued by the implementation. A vector with this step `requires` `optional:observe.pushed`.

### 3.1 Tier and sub-group fields

Every vector carries `tier` (1 or 2). A Tier 2 vector also carries `subgroup`, one of `attested`, `profile-window`, `profile-ceremony`, `profile-witness-share`, `profile-p384` (section 10 defines them); a Tier 1 vector carries none, and the loader rejects either mismatch. `clarify` is a non-null text naming the unsettled specification point; it marks a vector that is reported and never gates (section 8). A vector may be both Tier 1 and CLARIFY; it then runs at Tier 1 and is reported as CLARIFY.

A sub-group is selected by running its tier. A `profile-*` sub-group is measured for every implementation that has the capabilities its vectors `require`, whether or not the implementation claims `attested`; the `attested` sub-group needs an implementation whose `tierMax` is 2.

### 3.2 Advisories

A SHOULD of the framework or of a task specification that a vector observes is not a Tier 1 failure. The mismatch is recorded as an advisory on the vector's result (`VectorResult.advisories`), printed per run by the command line, and listed in the matrix Markdown and in the matrix JSON (`row.advisories`); it is never hidden. On an implementation that declares `attested`, run at Tier 2, the same mismatches are failures. Advisory classes:

- the `threadId` of a reply that differs from the request's thread, except on a `next-step`, where the thread is a MUST;
- the `issuer` or `recipient` of a reply that does not swap the request's parties;
- `inResponseTo` of an error or a hold that does not name the request, except in a vector about retained errors;
- default `retryable` values (the member must still be a boolean; a non-boolean is a failure);
- a duplicate answered with an equivalent `#response` instead of the retained document (silence is allowed; any other answer fails);
- a hold that does not name a declared status task. Where no status task is declared the hold asserts `expects` and `continuation` (section 11.4); where one is, it asserts neither;
- the absence of an error reply to a rejected document (`expect.errorReply: "should"`). SPEC.md 7.2 requires the rejection and states the reply as a SHOULD (SPEC.md:1071; a MAY at :1196), so a rejection that is judged by `noSideEffect` and state, and answers nothing, is an advisory, never a failure. A reply that is sent is still held to its `trust-task-error` type and its code, so a wrong code fails; `any-refusal` is not used for this because it never checks the code. Where the text puts the reply inside a MUST (a known slug at another MAJOR version, SPEC.md:756; the HTTPS binding, whose reply is mandatory) the vector leaves `errorReply` off and a missing reply fails (ENV-010). A rejection whose reply is a SHOULD carries the citation SPEC.md:1071. The generated older sets (single tasks, 2L, coverage, gap, witness, probe, completion) carry `errorReply: "should"` on every `error` step of a task whose own text does not put the reply inside a MUST; `vectors-src/complete/reply-required.json` lists the 13 task versions whose text does (a consumer MUST item that returns, answers or replies with a `trust-task-error`), derived from the task-force text by `scripts/derive-reply-required.ts`, and a missing reply stays a failure there (D881).

A vector may declare `advisoryMutants` next to `mutants`: a mutant listed under `mutants` must make the vector fail, a mutant listed under `advisoryMutants` must make it record an advisory (section 9).

### 3.3 Verdicts that rest on no reply: the minimum quiet period

Three dispositions accept an empty reply set: `silence`, `any-refusal` (silence or an error) and `duplicate` (with or without `priorReplyLost`). When no reply arrived, the verdict rests on absence, and absence is only as good as how long the adapter watched for a reply. Every `send` result reports `quiescentAfterMs`, the quiet the adapter observed before it returned. The engine holds such a step to a minimum quiet period per run (`src/runner/quiet.ts`):

| Declared bindings | Minimum | Why |
|---|---|---|
| `in-process` or `https` (also when DIDComm is declared beside them) | 0 ms | `send` returns once the implementation has handled the document; every reply is in the call's answer |
| DIDComm only (`didcomm`, `didcomm-v1`, `didcomm-v2`) | 1500 ms | Asynchronous: a reply can still be in flight when `send` returns |
| No binding the suite knows | 1500 ms | Treated as asynchronous |

A `silence` step may carry `acknowledgement: "allowed"` where the text permits the courtesy acknowledgement (SPEC.md 4.4.2: a `#response` of the originating type whose payload is exactly `{}`, and whose absence carries no information, SPEC.md:217-223; CEX-001). The step then passes on no reply, or on exactly one such acknowledgement; any other reply, or an acknowledgement with content, fails. A no-reply verdict of this kind, like a rejection with `errorReply: "should"`, rests on no reply and so needs the minimum quiet period.

`--min-quiet-ms <n>` overrides the rule for every adapter of a run. A step that got a reply is judged on that reply; the minimum applies only when the reply set is empty. When the adapter reports less quiet than the minimum, or no number, the step fails with `QUIET-NOT-ESTABLISHED: <what> not established: the adapter reported <n> ms of quiet, the minimum is <m> ms (<basis>)`. The engine does not wait and ask again: a reply that arrives after `send` returned is not attributable to the step (the DIDComm adapters move it to the unsolicited documents on the next send), so waiting would change nothing it can see, and a short quiet period must never become a PASS on silence. The result is deterministic for a given adapter answer. The minimum applies to `send` steps; a `trigger` reports no quiet period and its documents are judged as returned.

The DIDComm adapters in this repository wait longer than the minimum before returning an empty reply set when the document was delivered (keyring-wallet DIDComm: 2500 ms, `replyWaitMs`; witness server: 4000 ms). The rule does change verdicts on the keyring-wallet DIDComm rows: where the wallet's transport refuses a send (the adapter answers non-JSON bytes with transport `refused` and 0 ms of quiet), ENV-002 fails `QUIET-NOT-ESTABLISHED` on both the v1 and the v2 row, and ENV-003 on v1 records the same line (468 ms) beside the difference its exception excuses, so it stays KNOWN-FAIL. Whether a refused send should be held to the rule is an open decision for the project owner ([open decisions, section 5](open-decisions-from-reviews.md#5-open-items-from-the-re-runs)). The in-process and HTTPS adapters have a minimum of 0 and are unchanged. Each SuiteRun records `quietPeriod: {minimumMs, basis}` (basis `binding:<name>` or `runner option`), `run.json` records it per implementation (`implementations[].quietPeriod`, from the first tier run), and the command line prints it beside the clock mode. Runs recorded before the rule have neither.

## 4. Adapter contract (built: TypeScript types, client and example server)

An adapter is an out-of-process JSON-RPC 2.0 server. The runner reaches it over one of two transports and sees the same method set on both. The contract is implemented in `src/adapter/contract.ts` (types and in-process dispatcher), `src/adapter/client.ts` (the runner's client), `src/adapter/server.ts` (a server helper) and `src/adapters/example-server/server.ts` (the reference adapter served over the wire, the model for an implementation's own server). This section is the contract an adapter server implements.

### 4.1 Transports

| Transport | Runner flag | Framing |
|---|---|---|
| stdio | `--adapter stdio:<command>` | The runner starts `<command>` through the shell and keeps it for the whole run. Each message is one JSON object on one line (UTF-8, `\n`-terminated, no embedded raw newlines; JSON string escapes keep that true). Requests go to the process's stdin, responses come from its stdout, one response line per request line, in request order. Anything else (logs) goes to stderr, which the runner passes through. The server exits when stdin closes. |
| HTTP | `--adapter http:<url>` (also `http:http://host:port/path`, `http://host:port/path`, `http:host:port/path`) | One `POST` per call with `content-type: application/json`; the body is the JSON-RPC request and the `200` reply body the JSON-RPC response. The path is the adapter's choice. Any other HTTP method gets `405`; a body over 8 MiB gets `413`. A JSON-RPC error is still HTTP `200`. |

Rules for both:

- JSON-RPC 2.0, one request per message; batches are not used. `id` is a number chosen by the runner; the response echoes it.
- The runner sends one request at a time and waits for the response. A call that is not answered within `--timeout` ms (default 30000) fails the run with a transport error.
- Documents under test travel as JSON strings in `bytes` and `replies`. They are the exact characters that go on, or came off, the wire; neither side parses and re-serialises them.
- A new run starts with `capabilities`, then `provision`; every vector starts with `reset` and `setClock`.
- Errors: a method that fails answers `{"error":{"code":-32000,"message":"..."}}` with the failure text, which the runner reports unchanged. Unparseable input is `-32700` (response `id` null), a structurally invalid request `-32600`, an unknown method `-32601`.

### 4.2 Methods

Parameters are always an object (or absent). `result` is the value shown; a method with nothing to return answers `null`.

| Method | Params | Result | Purpose |
|---|---|---|---|
| `capabilities` | none | `{name, implementation?, version, tierMax, bindings[], supportedTypes[], carriers[], cryptosuites[], optional[], ceremony?, window?, pins{framework, error, binding}}` | What the implementation takes part in. `carriers` lists the generic "carrier" task types vectors may use, each with a class (`consequential`, `read`, `fire-and-forget`, `openPayload`) and a valid payload. `openPayload` is a second entry for the same Type URI, declared by an implementation whose carrier accepts a payload member its schema does not name; a closed-payload implementation (VTI) does not declare it, and a vector that sends an extra payload member (DUP-103) `requires` `carrier:openPayload`, so it measures the duplicate rule and not the payload schema. `optional` may include `control`, `idempotencyKey`, `restart`, `trigger.consent`, `trigger.twoPhase`, `fault.claimStore`, `ceremony` (with `ceremony`, which declares `proposerApproves`), `ceremony.status`, `trigger.ceremonyDeadline`, `trigger.ceremonyEffect`, `observe.retained`, `observe.pushed`, `discovery.acceptanceWindow`, `discovery.expiryHorizon`, `binding.requireBearer`, `clock` or `clockFree` (exactly one: the harness can set the clock, or cannot; section 7), `proofVerify`, `receiptVerify`, `seed.defaults` (the implementation's shipped default policies are in force before the first request, docs/22), `attested`. `notOffered` (optional) maps a `requires` entry to the reason the implementation itself does not offer it; a vector gated on an unmet entry that is listed there is SKIP with the reason "not offered by the implementation: ...", so a report can tell what an implementation does not offer from what an adapter cannot reach. `unlistedTypes` (optional) lists Type URIs the implementation serves but does not name in its discovery answer (VTI's pre-session `auth/*` family, dispatched ahead of the ACL gate): the vector gate counts them as declared, and the discovery vectors do not expect them in the list. `window` is the acceptance window the implementation enforces and advertises (`maxAgeSeconds`, `clockSkewSeconds`, `expiryHorizonSeconds`); absent means the profile pins (section 6). `bindings` names `in-process` and, for an adapter that also reaches the implementation over HTTPS, `https` (section 11.3). `implementation` names the implementation when `name` also names a mode (`x-attested`): runs that share it become one matrix row. A vector whose `requires` is not met is SKIP; an entry is a Type URI, or `carrier:<class>`, `optional:<name>`, `binding:<name>` or `cryptosuite:<name>` (the P-384 proofs of PRF-003 and PRF-005 need `cryptosuite:ecdsa-jcs-2019:P-384`). |
| `provision` | `{roles: string[]}` | `{<role>: {vid, didDocument?, transportAddress, keyCustody}}` | The identifier the implementation uses for each role. The runner needs `iut`. Keys of the implementation stay inside it (`keyCustody: "iut"`). For an identifier that is not `did:key` (`did:scid:vh`, `did:peer:4`, `did:web`) the result **MUST** carry `didDocument`: the runner verifies the IUT's own proofs (Tier 2 signed replies) from it. Ed25519 keys as `publicKeyMultibase` (multicodec `0xed01`) or an OKP `publicKeyJwk`; the verification method named in a reply's proof (for example `<vid>#key-1`) must be listed under the relationship matching its `proofPurpose` (`authentication` for replies). A key that is not in the document, or listed only under another relationship, fails verification. `did:key` identifiers need no document. |
| `trust` | `{vid, didDocument?}` | `null` | Tells the implementation about a harness-held peer that does not resolve locally. `did:key` peers resolve without it. |
| `setClock` | `{iso}` | `null` | Sets the implementation's clock (RFC 3339 UTC). Called before every step, only for an implementation that declares `clock`; one that declares `clockFree` is never called (section 7) and answers `-32000`. |
| `advance` | `{ms}` | `null` | Moves the clock forward. |
| `send` | `{from, bytes, channel?, http?}` | `{replies[], transport{status?, kind, contentType?}, quiescentAfterMs}` | Delivers `bytes` and returns every document the implementation emitted in answer, in order. `from` is the authenticated transport identity: `{"kind":"actor","vid":...}`, `{"kind":"none"}` or `{"kind":"spoof","vid":...}`. `kind` in the result is `document`, `none` or `refused`. `quiescentAfterMs` is how long the adapter observed no further reply before returning; the engine holds no-reply verdicts to a minimum (section 3.3). `http` (`{method?, path?, contentType?}`) is sent only to an adapter that declares the `https` binding and only by the BND vectors and the status assertions of other vectors; it is the request line (default `POST /trust-tasks`, `application/json`), `from` is presented as the bearer token the adapter holds for that identity (`none`: no Authorization header), and the result then carries the HTTP `status` and the `contentType` of the body (section 11.3). |
| `trigger` | `{action, args}` | `{documents[]}` | Acts for the implementation's human or operator (and, for the 3b-DTG groups, the helper actions of section 4.4): `policy` presets what its human decides about a proposal, `consent` decides a held one and returns the reply the implementation then emits. Needs optional `trigger.consent`. The two-phase actions `twoPhase`, `settle`, the ceremony actions `ceremonyDeadline` and `ceremonyEffect`, and the fault action `fault` are named in section 12.1 (optional `trigger.twoPhase`, `fault.claimStore`). |
| `observe` | one of `{query:"handled"}`, `{query:"documentState", id}`, `{query:"stored", kind, digest?}`, `{query:"retained", id, side}`, `{query:"pushed", to?, type?, threadId?}` (optional `observe.pushed`; docs/20), `{query:"received", from?, type?, threadId?}` (optional `observe.received`) or `{query:"ceremony", threadId}` (optional `observe.ceremony`; both docs/25) | `{value, documents?}` | Observable state: the count of executions, a document's lifecycle state (`unknown`, `accepted`, `responded`, `errored`), the count of stored artifacts of a kind (`vrc`; `ceremony-effect` counts the effects of committed ceremonies), the text of a retained request or reply (`side` `request` or `reply`; optional `observe.retained`; empty when none is held). `pushed` returns the documents the implementation sent on its own initiative, not as the reply to a `send` (`documents`, oldest first, as text; `value` is their count); each filter given must match (recipient VID, exact Type URI, thread, where a document without `threadId` is on the thread of its own `id`). Additive: an adapter that does not declare `observe.pushed` is never asked, and the vectors that need it are SKIP (docs/20). |
| `restart` | none | `null` | Optional (`restart`): restart with durable state kept. |
| `reset` | none | `null` | Clean state. Called before every vector. |
| `snapshot` | none | the snapshot id (string) | State fingerprint for side-effect detection. |
| `diff` | `{snapshotId}` | `{changed, detail?}` | Compares now with the snapshot. |
| `emit` | `{type, args?}` | `{documents[]}` | Optional (`emit`, with `Capabilities.emits`): emit the document of `type` through the implementation's own builders, unsent (producer class, section 11.8). |
| `initiate` | `{kind, to, thread?, args?}` | `{threadId, documents[], sent}` | Optional (`initiate`, with `Capabilities.initiates`): the implementation builds and signs the document of a ceremony step towards a connected peer. `sent: false` means it is returned unsent and the scenario runner relays it. Used only by the separate ceremony-scenario runner (docs/25), never by a vector. |
| `connect` | `{peer: {vid, didDocument?, transportAddress?}, role?}` | `{connected, detail?}` | Optional (`peer.connect`): set up the relationship with a peer beyond `trust`. Used only by the ceremony-scenario runner (docs/25). |
| `verifyProof` | `{bytes}` | `{valid}` | Optional (`proofVerify`): verify the proof on the document bytes as received. Lets the proof fixtures reach an implementation. |
| `verifyReceipt` | `{receipt, definition?, roleBindings?, steps?}` | `{outcome, reason?}` | Optional (`receiptVerify`): the verifier rules of `trust-ceremony-receipt` 0.1, which have no wire output (section 11.6). `receipt` is the receipt document as received; `definition` the ceremony definition the verifier resolved (absent or `null`: it could not resolve it); `roleBindings` the enactment's role names mapped to VIDs (absent or `null`: not available); `steps` the step documents the verifier holds, each as received. `outcome` is `complete`, `incomplete` (verified, but the completion rule is not met or the receipt is a prefix), `unverifiable` (the verifier could not check something the verdict needs and says so) or `invalid` (rejected); `reason` is for people and is never asserted. The method is pure: it changes nothing a vector observes. |

Carrier payloads. A consequential carrier declares `validPayload` in `capabilities`; the framework vectors build their request from it, so a carrier whose payload is not `{subject}` works unchanged. The invalid and extra-member variants (a payload that violates the schema; a closed payload with an unknown member) are derived from `validPayload` too: the first member gets the wrong type, or `extra: true` is added.

Attested and non-attested runs. Vectors marked `skipIfOptional: ["attested"]` or `exactTier` (for example PRF-108, the imported DUP-101 to DUP-113 rows, VRC-PRO-011) assert behaviour that a server claiming `attested` does not show: an unsigned document is accepted. They are SKIP against an attested server, so full coverage of an implementation that supports both modes needs two runs: once with the server in its non-attested mode, once attested. The command line runs Tiers 1 and 2 for every adapter by default (`--tier 1|2` runs exactly that tier), so the non-attested run covers Tier 1 and the `profile-*` sub-groups, and the attested run adds the `attested` sub-group. Runs of one implementation (the attested and the non-attested server, either tier) are merged into one matrix row: a vector one run skipped and another executed counts once, with the worst executed status. The row lists the vectors still skipped for this reason ("Not covered ... run a second time without `attested`"), which is empty once both runs are included.

### 4.3 Wire examples

stdio shows each message on one line; HTTP uses the same bodies.

`capabilities`:

```json
{"jsonrpc":"2.0","id":1,"method":"capabilities"}
{"jsonrpc":"2.0","id":1,"result":{"name":"reference","version":"0.0.1","tierMax":1,"bindings":["in-process"],"supportedTypes":["https://trusttasks.org/spec/conformance/widget/0.1","https://trusttasks.org/spec/vrc/relationships/propose/0.1","https://trusttasks.org/spec/vrc/relationships/issue/0.1"],"carriers":[{"typeUri":"https://trusttasks.org/spec/conformance/widget/0.1","class":"consequential","validPayload":{"subject":"did:web:alice.example"}}],"cryptosuites":["eddsa-jcs-2022"],"optional":["trigger.consent","clock","proofVerify"],"pins":{"framework":"0.6.0","error":"0.6","binding":"none"}}}
```

`provision`, `setClock`, `reset`:

```json
{"jsonrpc":"2.0","id":2,"method":"provision","params":{"roles":["iut"]}}
{"jsonrpc":"2.0","id":2,"result":{"iut":{"vid":"did:key:z6Mk...","transportAddress":"in-process","keyCustody":"iut"}}}
{"jsonrpc":"2.0","id":3,"method":"setClock","params":{"iso":"2026-11-12T10:00:00.000Z"}}
{"jsonrpc":"2.0","id":3,"result":null}
```

`send` (the document text is a JSON string; the reply documents are strings too):

```json
{"jsonrpc":"2.0","id":4,"method":"send","params":{"from":{"kind":"actor","vid":"did:key:z6MkA..."},"bytes":"{\"id\":\"urn:uuid:...\",\"type\":\"https://trusttasks.org/spec/conformance/widget/0.1\",\"issuer\":\"did:key:z6MkA...\",\"recipient\":\"did:key:z6Mk...\",\"issuedAt\":\"2026-11-12T10:00:00Z\",\"payload\":{\"subject\":\"did:web:alice.example\"}}"}}
{"jsonrpc":"2.0","id":4,"result":{"replies":["{\"id\":\"urn:uuid:...\",\"type\":\"https://trusttasks.org/spec/conformance/widget/0.1#response\",...}"],"transport":{"kind":"document"},"quiescentAfterMs":0}}
```

`send` with no sender identity, and a silent answer:

```json
{"jsonrpc":"2.0","id":5,"method":"send","params":{"from":{"kind":"none"},"bytes":"{\"id\":\"urn:uuid:..."}}
{"jsonrpc":"2.0","id":5,"result":{"replies":[],"transport":{"kind":"none"},"quiescentAfterMs":0}}
```

`trigger`:

```json
{"jsonrpc":"2.0","id":6,"method":"trigger","params":{"action":"policy","args":{"propose":"hold"}}}
{"jsonrpc":"2.0","id":6,"result":{"documents":[]}}
{"jsonrpc":"2.0","id":7,"method":"trigger","params":{"action":"consent","args":{"exchangeId":"urn:uuid:...","decision":"accept"}}}
{"jsonrpc":"2.0","id":7,"result":{"documents":["{\"id\":\"urn:uuid:...\",\"type\":\"https://trusttasks.org/spec/vrc/relationships/propose/0.1#response\",...}"]}}
```

`observe`:

```json
{"jsonrpc":"2.0","id":8,"method":"observe","params":{"query":"handled"}}
{"jsonrpc":"2.0","id":8,"result":{"value":1}}
{"jsonrpc":"2.0","id":9,"method":"observe","params":{"query":"documentState","id":"urn:uuid:..."}}
{"jsonrpc":"2.0","id":9,"result":{"value":"responded"}}
{"jsonrpc":"2.0","id":10,"method":"observe","params":{"query":"stored","kind":"vrc"}}
{"jsonrpc":"2.0","id":10,"result":{"value":1}}
```

`verifyProof`, `snapshot`, `diff`:

```json
{"jsonrpc":"2.0","id":11,"method":"verifyProof","params":{"bytes":"{\"id\":...,\"proof\":{...}}"}}
{"jsonrpc":"2.0","id":11,"result":{"valid":true}}
{"jsonrpc":"2.0","id":12,"method":"snapshot"}
{"jsonrpc":"2.0","id":12,"result":"snap-0"}
{"jsonrpc":"2.0","id":13,"method":"diff","params":{"snapshotId":"snap-0"}}
{"jsonrpc":"2.0","id":13,"result":{"changed":false}}
```

`verifyReceipt` (optional `receiptVerify`):

```json
{"jsonrpc":"2.0","id":16,"method":"verifyReceipt","params":{"receipt":"{\"type\":\"https://trusttasks.org/spec/trust-ceremony-receipt/0.1\",...}","definition":{"slug":"receipt-linear",...},"roleBindings":{"recorder":["did:key:z6Mk..."]},"steps":["{...}","{...}"]}}
{"jsonrpc":"2.0","id":16,"result":{"outcome":"complete","reason":"verified"}}
```

Errors:

```json
{"jsonrpc":"2.0","id":14,"method":"restart"}
{"jsonrpc":"2.0","id":14,"error":{"code":-32000,"message":"restart is not supported"}}
{"jsonrpc":"2.0","id":15,"method":"nope"}
{"jsonrpc":"2.0","id":15,"error":{"code":-32601,"message":"method not found: nope"}}
```

An optional helper method the adapter does not implement (`verifyReceipt`) answers `-32000` with `method not supported by this adapter`.

An HTTP call is the same JSON in the request body (`POST /rpc HTTP/1.1`, `content-type: application/json`) and the response body.

### 4.4 Helper actions and observe kinds of the 3b-DTG groups

The task-consent and credential-exchange vectors (section 11.5) need three values only the implementation can produce, and the query vectors three more acts of the holder or its human. They travel over `trigger`, with `documents[0]` carrying a JSON value instead of a Trust Task document (the runner does not validate it as a reply), and each is gated by an optional capability. A value is captured by the step (`capture` with a JSON pointer) and used later as `$cap(name)`.

| Action | Args | `documents[0]` | Optional capability | Meaning |
|---|---|---|---|---|
| `enrolExecutor` | `{vid}` | none | `trigger.consentEnrol` | The device (the implementation as approver) is enrolled with the executor `vid`: it will prompt for that executor's `task-consent/request`. Before it is called, the device has no enrolled executor. |
| `consentBinding` | `{thread}` | `{"challenge": string, "payloadDigest": string}` | `trigger.consentBinding` (with `ceremony`) | The implementation (as executor) names the challenge and the salted payload digest of the consent it holds pending for the ceremony in thread `thread`. The vectors echo both verbatim in the decision. The specification fixes what the digest covers, not how a challenge is minted, so an implementation derives or stores them as it likes. |
| `presentationNonce` | none | `{"nonce": string, "threadId": string}` | `trigger.presentationNonce` | The implementation (as verifier) opens a presentation thread and names the nonce it will accept there, and the thread. The vectors send the presentation in that thread, with the nonce as the proof's `challenge`. |
| `holdCredential` | `{type?}` | none | `trigger.holdCredential` | The implementation (as holder) comes to hold a credential of the given type (the type IRI a DCQL `type_values` entry names; a default type when absent), however it really comes to hold one (an adapter may deliver it through its own issue path). |
| `verifierTrust` | `{vid}` | none | `trigger.verifierTrust` | The holder's consent policy pre-trusts the verifier `vid`, so its queries are answered at once. A holder with no such policy does not declare the capability, and the vector is SKIP. |
| `queryDecision` | `{thread, decision}` | the presentation, when `decision` is `approve` | `trigger.queryDecision` | The holder's human decides the query deferred in thread `thread` (`approve` or `decline`); the decision itself is out of band in the specification. On `approve` the presentation the holder then sends on the query's thread is returned and checked as a reply. |
| `makeOffer` | `{to}` | `{"threadId": string}` | `trigger.makeOffer` (with `observe.pushed`) | The implementation (as issuer) opens an issuance thread by pushing a `credential-exchange/offer` to the party `to`, and names the thread. The vectors then send the holder's `request` on it (CEX-035). |

Observe: `stored` takes two further kinds. `credential` is the number of credentials the implementation keeps from `credential-exchange/issue` (`digest` selects those with that digest); `presentation` is the number of presentations it keeps from `credential-exchange/present`. Both are counts of durable records, never of attempts. A prompt raised for a `task-consent/request` counts as `handled`. `stored` kind `deferral` (capability `observe.deferred`; vector state member `deferred`) is the number of `credential-exchange/query` documents the holder keeps waiting for its human's decision. The engine accepts a `credential-exchange/present` on the query's thread as the answer to a `query`.

The decision vectors run on the ceremony family of section 11.4: the pending consent request is a ceremony held for approvals, A and X are its administrators and approvers, and the `ceremony.proposerApproves` declaration is honoured as in the CER vectors.

### 4.5 Implementing a server

- Serve the methods of section 4.2 and nothing is required beyond them. `restart`, `snapshot`, `diff`, `advance`, `trust`, `verifyProof`, `verifyReceipt` may answer `-32000` when unsupported; the runner calls only what a vector needs, and gates on `optional` first.
- `reset` must drop everything a vector can observe (duplicate record, exchanges, stored artifacts, policy, clock) so vectors do not depend on order.
- The runner never looks inside: `send` returns whatever the implementation emitted, `observe` answers the four queries above.
- `capabilities.name` identifies the implementation in reports and in `exceptions/exceptions.json`; `tierMax` is the highest tier it claims.
- The model server is `src/adapters/example-server/server.ts` (`stdio` or `http --port N`, options `--attested`, `--mutant a,b`, `--no-vrc`, `--no-ceremony`, `--no-dtg`, `--cosign`, `--status[=proceed|resubmit|omit]`). A test runs the whole vector set through it on both transports and requires the same results as the in-process adapter.

## 5. Key and DID provisioning (built for `did:key`; other methods proposed)

- **Harness-held keys** for every scripted peer role, from deterministic Ed25519 seeds (the task force's proof fixtures use seed `[7; 32]`), so signatures are reproducible and goldens can be committed.
- **IUT-held keys are discovered, never imported.** `provision` returns the IUT's identifiers; the harness verifies IUT-produced proofs by resolving them (`did:key` locally; `did:peer:4` from the embedded document; `did:web`/`did:webvh` through a harness-served resolver). No implementation imports foreign key material.
- Ceremonies that use a per-relationship identifier need the adapter to create that identifier inside the IUT.

## 6. Version pins and windows (built)

| Pin | Value | Note |
|---|---|---|
| Framework target | 0.6.0 | The framework prose in the snapshot is 0.7.0, while the registry's specifications and bindings target 0.6 or earlier. Pins are revisited when they converge. A vector that depends on the difference is CLARIFY. |
| `trust-task-error` | 0.6 | Error type is matched by prefix `https://trusttasks.org/spec/trust-task-error/`, since implementations emit different versions. |
| HTTPS binding | 0.3 | |
| TSP binding | 0.1 | Informational; the suite's harness does not speak it. |
| Acceptance windows | Profile pins: skew 60 s, max age 5 min, expiry horizon 30 days, half-open at `expiresAt` | The framework text sets no numbers; these are the defaults the task force's fixtures use for the consequential profile (`fixtures/consume/freshness.json`), so they are a profile choice, not a framework requirement. An implementation **declares** its window (`capabilities.window`); the runner can also be given one (`--window maxAge=600,skew=60,horizon=2592000`, which overrides the declaration). Vectors take the effective window (given, else declared, else the pins) through the symbolic terms `windowMaxAge`, `windowSkew` and `windowHorizon` (in `$nowAt(...)` and in step offsets such as `+windowMaxAge+windowSkew+0s`), so a Tier 1 time vector never requires 5 minutes. An implementation with another window is measured against its own and the matrix reports the difference from the pins (`windowDifference`); it is a measured difference, not a failure. The matrix Markdown always prints the declared window of each implementation, with or without a difference. The imported fixture rows state absolute instants for the pins; they are the Tier 2 `profile-window` sub-group (TIME-001 to 011, 015, 017 to 020; DUP-110 to 113), are marked `profileWindow`, and are SKIP, with the reason `window difference`, when the effective window differs from the pins. The pins are a Tier 2 profile choice and no Tier 1 vector requires them. DIS-012 and DIS-013 check that the advertised window is no wider than the enforced one, whatever its value. A vector that crosses the maximum age (DUP-005, TIME-101, TIME-105) carries `requires: window:declared`: the framework names no default maximum age (SPEC.md:1043) and a consumer MUST NOT accept a document older than its own window (SPEC.md:1035), so the vector runs only where the implementation declares a window or the runner is given one, never against the profile pin, and is otherwise SKIP "window not declared". |

## 7. Deterministic time, rebase mode and the run salt (built)

One injected clock. Every timestamp in a vector is an offset from `clock.start`, generated and signed at run time. Boundary vectors straddle each edge by one millisecond and assert half-open windows (as `freshness.json` does). Literal byte goldens are kept where bytes matter (timestamp spellings, member order), as in `fixtures/proof`.

**Transport identity.** `transportIdentity` (optional) says the transport authenticates the sender, so the harness's `from` means something. Framework 7.2 item 6 applies only to "an authenticated identity derived from the transport"; an implementation whose transport authenticates no sender (the VTI community service reads no `Authorization` header) does not declare it, and the vectors that send a spoofed `from` and expect `identityMismatch` (ID-002, ID-004) are SKIP for it. BND-002, which asserts the HTTPS binding's own bearer mapping, is not gated by it.

**Clock capability.** An implementation declares exactly one of the optional capabilities `clock` (the harness can set its clock; `setClock` is called before every step) and `clockFree` (it cannot). The runner refuses an adapter that declares both or neither.

**Rebase mode** applies to a `clockFree` implementation (or when `--rebase` forces it): the real time, to the whole second, at the start of a vector is that vector's clock start, `setClock` is never called, and the vector's relative offsets, and the absolute `issuedAt` and `expiresAt` of its send parameters, are applied to it. The vector is SKIP, with a reason, never PASS, when its assertions need exact or multi-offset control:

| Reason in the matrix | Rule |
|---|---|
| `needs exact clock control: an assertion sits within seconds of a window edge` | the vector is marked `exactClock` (the millisecond and edge rows of TIME) |
| `needs exact clock control: an absolute instant` | a step uses `atAbsolute` |
| `needs clock control: steps at several clock offsets` | the steps act at more than one offset and at least one is not a literal forward offset of at most 10 s (duplicate-record retention, restarts after time, deadlines, ceremonies). Where every offset is a literal `+Ns` with N at most 10, the runner waits that real time before the step and the vector is measured (the same-document duplicate rows at `+5s`, the corrected resend at `+1s`) |
| `needs exact clock control: absolute timestamps in the document` | an absolute instant sits in a literal document or raw text, which cannot be rebased |

The matrix row names the skipped ids (`clockSkipped`) and says that the row was measured in rebase mode. The reference adapter has a clock-free mode (`ReferenceOptions.clockFree`, example server `--clock-free`, runner spec `reference-clockfree`); the tests run the whole suite against it in process, over stdio and over HTTP and require identical results, and require the mutants to be caught by the vectors it still runs.

**Run salt.** Deterministic document ids (`$id(name)`, the witness-share session ids, and the `urn:uuid` literals of raw fixture documents) are a hash of the vector id and name, so a second run against a durable peer would replay the first run's ids into its duplicate record. Each run therefore mixes a salt into every such id. The default is a random value per run (printed by the runner and stored in the run record as `salt`); `--salt <value>` fixes it to reproduce a run, and `--salt ""` leaves the ids unsalted. Equal ids stay equal within a run, so duplicate and conflict vectors behave the same; results do not depend on the salt. A second token, `$mint(name)`, is a short lowercase value (`m` and 15 hex digits) derived the same way from the run salt, the vector id and the name, for an identifier that a `urn:uuid` cannot be (a git-namespace owner segment, a key id, a room-name suffix); it may sit inside a longer string (`github.com/$mint(own)/widgets`). The seeded probes use it so a second run against a durable peer does not meet `alreadyBound` or `alreadyExists`.

## 8. Outcomes, capability gating and known failures (built)

| Outcome | Meaning |
|---|---|
| PASS | Observed behaviour matches the vector. A SHOULD mismatch the vector observes does not change this: it is recorded as an advisory (section 3.2). |
| FAIL | It does not. Gates. |
| SKIP | The vector is not run: the implementation does not declare the capability the vector `requires`, or another gate holds (clock, window, E). Not a failure and not a pass. It is *not applicable* only when the gate is an entry of the adapter's `notOffered` that carries evidence (`{ reason, evidence }`: where in the platform's source, at which ref, or what was observed); the SKIP then records that `evidence`. Every other SKIP is *not reached* or *version mismatch* (results/skip-classes.json); "the adapter did not declare it" is never not applicable. |
| KNOWN-FAIL | A gap recorded in the exceptions file for that implementation, with a reason and, where possible, a code reference. The runner asserts the vector still fails, and, where the entry states `expectFailure`, that it fails the recorded way; if it starts passing, or fails another way, the result is FAIL. |
| (excluded by tier) | Not an outcome: a vector outside the selected tier (a Tier 2 vector in a Tier 1 run, `tier 2 not selected`; an `exactTier` vector at the other tier, `only runs at tier N`) is not run and is listed in the run's `excludedByTier` (id, reason, channel), like `excludedByChannel`, never as SKIP. The matrix and the at-a-glance pages show the count apart. Runs recorded before this split hold them as SKIP with those reasons; the at-a-glance generator reads both. |
| CLARIFY | The vector depends on an unsettled specification point, or asserts something no specification sentence states. Reported with its reason, never gating, never counted toward Tier 2. |

**The vacuous-pass rule.** A negative vector passes when the implementation refuses the document, which an implementation that refuses everything also does. A matrix cell is therefore green only when its anchor positive vectors pass: the family's non-CLARIFY vectors that expect an accepted response must include at least one that ran and passed, and none that ran may fail. An anchor is a non-CLARIFY vector that has a step expecting a response document or a positive durable state (`storedCredential` or `storedPresentation` above zero: the fire-and-forget tasks answer an accepted document with no reply). A PASS roll-up that is not green is shown with `*` and an annotation (`green: false`, `annotation` in the matrix JSON; `anchors` gives passed, ran and total).

The runner exits non-zero on FAIL, or on a KNOWN-FAIL that now passes. The command line runs Tier 1 and then Tier 2 for every adapter by default; `--tier 1|2` runs exactly that tier. Tier 2 runs the `profile-*` sub-groups for every adapter and the `attested` sub-group only for an implementation that claims `attested` (tierMax 2). Rules for exceptions:

- **Vectors are never weakened to fit an implementation.** The vector encodes the specified behaviour; the implementation carries a KNOWN-FAIL. Where a re-reading of the specification text shows that a vector asks for more than the text says, the vector is not edited: it is given a `clarify` reason and reported as CLARIFY (never gating). The review that did this for PRF-021, 027, 031 and 033 is in `results/vector-review.md`.
- Weak behaviour in an implementation (accepting what the specification or another implementation refuses) is never encoded as expected behaviour.
- **Authority order.** The specifications are the most authoritative source, the existing VTI implementation the second. A vector asserts what a specification states. Where the specifications are silent the existing VTI implementation is the precedent at Tier 1; a vector that would assert anything stricter is Tier 2 (a named sub-group) or CLARIFY. Tier 1 is the framework MUSTs and nothing stricter (section 10). A deviation from a stated requirement is a measured finding (KNOWN-FAIL with owner `unassigned`, or a stated difference), never a required change; a proposal to change or extend VTI is made to the project owner first.
- Every exception names an owner or an expiry before a capability matrix is published (gate G5 in document 06). Each entry applies to one implementation's row only; for example the entry for implementation `verifiable-trust-infrastructure` and vector BND-002 (the bearer token is not mapped to the transport sender) does not touch the reference adapter, which passes BND-002. The entries are counted in results/README.md, Recorded differences.
- **One key per surface.** An entry is keyed on an implementation name (or a platform its rows declare, [decisions](decisions/04-ceremonies-governance-and-exceptions.md#platform-surfaces)), and every measured surface has a name of its own: the live community service is `verifiable-trust-infrastructure`, the in-process VTC host (the same adapter with `VTI_CONTROL_URL`) `verifiable-trust-infrastructure-vtc-inprocess`, the agent service in process `verifiable-trust-infrastructure-inprocess`. An entry is justified by a recorded KNOWN-FAIL or FAIL of its surface (`test/exceptions-file.test.ts`); an entry copied from another surface's key without such a record carries `inherited` (where it came from), the KNOWN-FAIL reason says so, and the next recorded run decides it (a pass makes it stale). The at-a-glance config lists a surface's earlier names under `aliases` so its older run folders still read.
- **`notOn`: surfaces a platform entry does not cover.** An entry keyed on a platform applies to every row that declares it. `notOn: { "<implementation name>": "<why>" }` names the rows of that platform whose path does not carry the difference; there the vector is judged without the entry (a pass is PASS, a failure FAIL), instead of reading as stale. Each name needs a reason that points at the platform's code, and it never names the entry's own key (`src/vectors/load.ts`, `exceptionApplies` in `src/runner/suite.ts`). The keyring-wallet ENV-003 entry names the DIDComm v2 row: the wallet's v2 binding drops a document with no `id` before the pinned runtime sees it.
- **`expectFailure`: the failure an entry excuses.** `{ "failures": [regex, ...] }`: each regular expression must match at least one failure line the engine reports (a line names the step and what was observed: the HTTP status, error code, reply type or count, or the state assertion). A failing result that misses one is FAIL with the reason "KNOWN-FAIL exception does not match the observed failure", naming the patterns not matched, so a vector that starts failing for another reason is not hidden behind its old entry. The patterns of the current entries are the failure lines common to every recorded KNOWN-FAIL of the entry's surface (both tiers where the entry has none), anchored, with salted `urn:uuid` ids generalised; the test checks that each still matches what was recorded. An entry without `expectFailure` excuses any failure.

## 9. Non-vacuity (built)

Every vector must also pass against the reference adapter (the task force's TypeScript consumer pipeline and replay guard over a trivial carrier). Where possible a vector is also run against a mutated reference that violates the rule, and must fail there. A wrong vector therefore cannot hide behind a failing implementation. A mutant that violates a SHOULD is declared under `advisoryMutants` and must make the vector record an advisory (section 3.2); every other mutant must make the vector fail. A profile sub-group vector is run against a mutated reference that does not claim `attested`, an `attested` vector against one that does. This mirrors the practice, in one implementation's own tests, of injecting a mutant (for example an unknown payload member that must be rejected) to prove a check bites.

The ceremony vectors depend on two declared properties (`ceremony.proposerApproves`, `ceremony.status`; section 11.4), so each mutant is applied to the reference in each configuration its vector runs in: a ceremony vector against both `proposerApproves` values, and a vector that needs a status task against the status variant in both values. Every one of those pairs must fail, or, for an advisory mutant, record an advisory (section 3.2). The reference supports both values and the status variant (`ReferenceAdapter` options `proposerApproves`, `ceremonyStatus`, `statusContinuation`; example server options `--cosign`, `--status[=proceed|resubmit|omit]`), and the tests run the whole ceremony group against each combination. The decision vectors of the TC group (section 11.5) run on the ceremony family, so their mutants are applied in the same configurations. The RCPT mutants (section 11.6) are switches in the reference verifier and are indifferent to the ceremony options; each runs once against its vector.

## 10. Tiers (built)

**Authority order (settled).** The specifications come first. Where they are silent, the existing VTI implementation is the precedent at Tier 1. A vector that asserts anything stricter than that, or a design choice of this suite, is Tier 2 in a named sub-group, or CLARIFY.

**Tier 1, framework core (settled).** The framework MUSTs and nothing stricter: envelope, errors, lifecycle, freshness, duplicate handling, and the proof rules the framework itself makes MUST, plus task specifications' own REQUIRED items. A SHOULD the vectors observe is an advisory, never a Tier 1 failure (section 3.2). A Tier 1 vector that rests on a point the specifications do not settle is CLARIFY: it runs at Tier 1 and never gates. Tier 1 asserts no window number (section 6).

**Tier 2, named sub-groups (proposed).** Stricter-than-specification behaviour and the suite's own choices, each vector in one sub-group (`subgroup`, section 3.1):

| Sub-group | Contents | Runs for |
|---|---|---|
| `attested` | The stricter behaviour of the attested profile, for ceremonies that must be attestable (the table below): proof on every request, response and error, closed payloads, pinned purposes, the HTTP status table (BND-007), the signed-reply and identity vectors, and the time vectors TIME-012, 016 and 021 | An implementation that claims `tierMax` 2 |
| `profile-window` | Fixture rows that pin the 5 min / 60 s / 30 day window, which the framework text does not state (TIME-001 to 011, 015, 017 to 020; DUP-110 to 113); also gated by the declared window (section 6) | Every implementation whose declared window equals the pins; SKIP otherwise |
| `profile-ceremony` | The suite's own ceremony and two-phase design (2PC-001, 004, 005; CER-003, 008, 009, 014; TIME-103; section 11.4 and 12). These vectors are also channel `proposed`, profile `ceremony-design`, so they are advisory ([decision 39](decisions/04-ceremonies-governance-and-exceptions.md#d39)) | Every implementation that declares the capabilities |
| `profile-witness-share` | The suite-local witness-share profile ([10-witness-share-profile.md](10-witness-share-profile.md); WSH-001 to 005, 013, 017, 025) | Every implementation that declares the share task |
| `profile-p384` | P-384 proofs (PRF-003, PRF-005), behind the capability `cryptosuite:ecdsa-jcs-2019:P-384` | Every implementation that declares that suite |

A `profile-*` sub-group is selected by running Tier 2 and is measured for every implementation that has the capabilities its vectors need, whether or not the implementation claims `attested`. The matrix Markdown shows a Tier 2 sub-group roll-up per implementation (pass, fail, skip, known-fail, clarify), the declared window, and the advisory count.

The `attested` profile is a proposal and is not part of any published specification. Every `attested` assertion that exceeds the framework is tagged `profile:attested`; Tier 1 is not delayed by debate about it.

| Tier 2 requirement | Basis in the framework | Why it is profile, not core |
|---|---|---|
| Proof on every request, response and error | Framework section 4.7.2 and 7.3 require proof only where a task specification says so | Responses and errors are usually proof-optional |
| `proofPurpose` pinned: `authentication` for operational documents; `assertionMethod` for the attestation slugs (approver decisions) | Section 4.7.3 ties purpose to verification relationship | The framework does not pin which purpose a task uses. `task-consent/decision` 0.2 states `assertionMethod` itself (TC-002, Tier 1); the pin stays profile for other attestation slugs |
| `recipient` on every proof-bearing document | Section 7.2 item 8 already requires it for non-bearer tasks | Extended to all, including receipts |
| `issuer` == proof signer == transport sender | Sections 4.8.1 and 7.2 items 6 and 7 require consistency checks | Pinned as one identity for the profile |
| `issuedAt` on every document | Section 7.3 item 17 requires it only for consequential tasks | Needed to bound the duplicate record for all |
| Closed payloads (extra member refused) | The framework leaves unknown payload members to the task specification | |
| Task digests and outcome evidence | Sections 4.9.3 and 4.9.4 | Applies to documents whose specification declares them |
| Whole-second timestamps on emission | Section 4.2 allows all RFC 3339 spellings | Interop hazard, see document 05 |

**Key rotation and verification time.** Verifiers should evaluate a proof against the key set in force when it was created. Both `created` and a log entry's own timestamp are signer-asserted, so a verifier cannot fully trust either; the suite therefore keeps key-rotation vectors out of the first benchmark and treats them as a later group (see document 06, section 3.1, for one implementation's constraints, and document 07 section 4).

## 11. Vector groups and spec traceability (built)

Ids are suite ids. "Spec" cites the framework (section / item), a task specification, or a registry fixture. `[V]` = an extension or strictness found in one implementation, profile-optional and never core. `[CL]` = needs a specification clarification (reported, non-gating). **Settled** = the group's expectation follows a framework MUST or an agreed decision; **proposed** = depends on a Tier 2 sub-group or a clarification. Tier 2 vectors name their sub-group (section 10): `attested`, `profile-window`, `profile-ceremony`, `profile-witness-share`, `profile-p384`. The design table below uses design ids; section 11.1 lists the ids as built with the tier and sub-group of each.

| Group | Covers | Tier | Spec basis | Status |
|---|---|---|---|---|
| ENV-001..005 | minimal valid; BOM; missing `id`/`type`/`payload`; bad Type URI (http scheme, uppercase slug, `/binding/`); no fragment equals `#request` | 1 | framework 4.1 to 4.4, 6.1 (reuse registry type-URI tests) | settled |
| ENV-006 | lowerCamelCase members and codes | 1 | 4.10 | settled |
| ENV-007 | unknown member preserved, not acted on; unknown `ext` ignored; critical unknown refused `unsupportedExtension`; `extCritical` naming an absent namespace refused | 1 | 4.5.1, 4.5.2, 7.2 | settled |
| ENV-008 | payload schema invalid | 1 | 7.2 item 2 | settled |
| ENV-009 | closed payload | 2 `[V]` | none (task-specific) | proposed |
| ENV-010 | unknown type; wrong MAJOR (`unsupportedVersion`); forward minor | 1 (served versions in `details`: 2 `[V]`) | 5.2, 7.2 item 3 | settled; forward-minor on draft specs `[CL]` |
| ENV-011 | envelope validated against the task spec's target framework version | 1 | 7.2 item 1 | CLARIFY (pins differ, section 6) |
| TIME-001..009 | expiry inclusive; future `issuedAt`; `expiresAt <= issuedAt`; stale; missing timestamps; horizon clamp; spellings; ranges; expiry does not abort executing work | 1 for the rows that take the declared window; 2 `profile-window` for the fixture rows that pin 5 min / 60 s / 30 d, 2 `attested` where the window rule is stricter than the framework (reference `freshness.json`, `timestamps.json`) | 7.2 items 4, 13; "Bounding the record" | settled for Tier 1; the pins are a Tier 2 profile choice |
| DUP-001..008 | identical resend absorbed; different payload, recipient or re-signed proof gives `idConflict`; window edge; in flight; restart; fail closed; never `taskFailed` | 1 (reference `item11-digest.json`); the imported window rows DUP-110 to 113 are 2 `profile-window` | 7.2 item 11 and "Keying and comparison", "Disposition of a duplicate" | settled; 006 needs optional `restart`, 007 and 008 need optional `fault.claimStore` and are CLARIFY (design rules, the specification is silent); DUP-103 needs the carrier class `openPayload` |
| DUP-009, DUP-010 | same `id` after the first was refused; same `id` from another issuer | 1 CLARIFY | 7.2 item 11 keys on `id` alone; implementations differ on releasing a refused claim and on whether the issuer is part of the key | built; never gating |
| IDK-001..003 | `idempotencyKey` (new `id`, same key returns prior result) | profile `vti-ext` `[V]` | none | optional capability; SKIP elsewhere |
| PRF-001..006 | valid eddsa; tamper; unsupported suite; verify over received bytes (spellings, key order, `@context`); ES256 | 1 (reference `fixtures/proof/*`); the P-384 proofs PRF-003 and PRF-005 are 2 `profile-p384` | 4.7, 4.7.1 (`eddsa-jcs-2022` baseline, P-256 SHOULD) | settled |
| PRF-007..010 | purpose `keyAgreement`/absent/unrecognised; verification method not listed for the purpose; verification-method controller differs from `issuer` | 1 | 4.7.3, 7.2 item 7 | settled |
| PRF-011 | purpose pinned | 2 | 4.7.3 (SHOULD at most) | proposed |
| PRF-012 | proof required | 1 where the task spec says REQUIRED; 2 otherwise | 7.2 item 7, 7.3 | settled / proposed |
| PRF-013 | proof without `recipient` | 1 | 7.2 item 8, 4.8.2 | settled |
| ID-001, ID-002 | wrong recipient; transport sender differs from `issuer`, with correct error addressing | 1 | 7.2 items 5, 6; 12.6 | settled |
| ID-003, ID-004 | issuer == signer; issuer == transport-authenticated sender (ID-004 needs the optional capability `transportIdentity`) | 2 | 4.8.1 | proposed |
| AUTHZ-001 | verified but unauthorised gives `permissionDenied`; no existence oracle | 1 (oracle: 2) | 7.2 item 10; 7.2 "missing target" | settled / proposed |
| RSP-001, RSP-002 | success type, `threadId`, party swap, fresh `id`; fire-and-forget `{}` | 1 | 4.4.1, 4.4.2, 4.9 | settled |
| RSP-003 | a held task is answered with `trust-task-next-step` | 1: a `next-step` naming the expected task; where the consumer offers no status task, `expects` names the originating Type URI with `continuation: resubmit`; 2: the same, signed | 8.6 ("A hold is a next step") | proposed; built for `propose` as VRC-PRO-008, 019 to 021 |
| RSP-004, RSP-005 | response signed; verifies under the request's `recipient` | 2 | 7.3 (outcome-evidence responses) | proposed |
| ERR-001..008 | shape; `threadId`; `inResponseTo`; code set and extended form; `retryable` defaults; no leak; bounded `details`; no reply to an inbound error | 1 (signed: 2 `attested`); the `threadId`, party and default `retryable` checks are advisories | 8.2, 8.2.1, 8.2.2, 8.3, 8.4, 8.5 | settled; ERR-002, 005 and 008 CLARIFY |
| LIF-001..005 | terminal stays terminal; no state inferred from silence; control unsupported gives `unsupportedType`; cancel semantics | 1 (004/005 optional capability) | 4.12, 11, 11.8 | settled |
| VRC-PRO-001..021 | propose (the implementation under test is the counterparty): accept and the counterparty's own relationship DID, decline as `propose:declined`, payload shape and closure, witnessed agreed not assumed, hold answered with a next-step, then decide and resubmit, unsigned accepted at Tier 1 and refused at Tier 2, pipeline checks, profile rules on the relationship DID (connection DID, reuse) | 1 (Tier 2 for proof, signed reply and next-step) | `vrc/relationships/propose/0.1` | settled; 016 to 018 CLARIFY (section 11.1 lists them) |
| VRC-ISS-001..023 | issue (the implementation under test is the receiving party): receipt by read-back of the stored credential (digest computed, not copied), authorization by accepted proposal (`notAccepted`), party bindings and credential proof, envelope proof REQUIRED, `issuedAt` REQUIRED, expiry, duplicate (absorbed, `idConflict` for changed or re-signed content), Tier 2 signed receipt and docs/04 section 10 (issuer, signer and sender are the connection DID), second delivery, second credential, second exchange, inner proof purpose | 1; 2 for signed receipt and docs/04 section 10 | `vrc/relationships/issue/0.1` | settled; 003, 020 to 023 CLARIFY (section 11.1) |
| WSH-001..021 | witness-share (profile: [10-witness-share-profile.md](10-witness-share-profile.md)): WSH-001..012 happy path; presentation challenge and domain; witnessed-credential subject; parties; foreign terminal; task-digest mismatch; terminal signed by a non-recipient; wrong terminal type; stripped proof; decoded-bytes compare; unknown multihash. WSH-013..021 unsolicited share, request proof, payload shape, redelivery, duplicate `id`, ordering (CLARIFY), signed receipt, envelope identity. `requires`: `vrc/relationships/witness-share/0.1` (absent capability is SKIP) | 1; 2 `profile-witness-share` for WSH-001 to 005, 013, 017, 025; 2 `attested` for WSH-020, 021 | `witness/session/0.2`, `witness/session/submit/0.2`; framework 4.9.3, 4.9.4; the share task itself is the suite-local profile in document 10 | proposed (built: WSH-001..021 and WSH-025; section 11.1) |
| TD-001..006 | task digest: signed equals unsigned digest; re-signed same digest; nested proof kept; two multibase encodings equal; unimplemented hash never pairs. Black-box through the witness-share carrier (`requires` its type) | 1 | 4.9.3 | settled (built) |
| DIS-001..017 | discovery 0.4 request and response: default `*`, prefix, exact, literal wildcards, OR, empty answer, 16-pattern bound, closed payload, advertised window honest, sorted (CLARIFY), proof RECOMMENDED, signed at Tier 2, recipient (section 11.2) | 1 (signed: 2) | `specs/trust-task-discovery/0.4`, SPEC.md section 10 | settled; DIS-014 is a SHOULD (CLARIFY) |
| 2PC-001..008 | see section 12 (003 to 005 run on the ceremony family, section 11.4): abort and no vote end errored with no receipt; abort reason bounded and non-leaking; commit with a lost reply absorbed; outcome unknown stays accepted (202, idConflict, receipt after commit); unreadable duplicate record fails closed | 1; 2 `profile-ceremony` for 001, 004, 005 (the suite's own design over the lifecycle-visible effect) | 4.12, 7.2 items 11, 12; section 12 | 006 and 007 `registry`; 001 to 005 and 008 channel `proposed`, profile `ceremony-design` (advisory); 002 and 008 CLARIFY |
| CRM-xxx | the `ceremony` member on ordinary documents: carried through, covered by the proof, grants no authority | 1, optional | 4.11, 4.11.4 | not built |
| RCPT-001..070 | `trust-ceremony-receipt` 0.1 verifier rules through `verifyReceipt`: document shape and closed payload, proof and issuer rules, the digest, tamper detection, enactment and step mismatches, replay, the prev chain (section 11.6) | 1, optional capability `receiptVerify`; the points the text leaves open are CLARIFY | `specs/trust-ceremony-receipt/0.1/spec.md:113-138` | built |
| CER-001..019 | ceremony documents (begin, approve, reset, optional status): a hold is a next-step, resubmission, quorum approve answered only after the effect exists, double approve, duplicate, non-admin approve (`permissionDenied`), late approval (`deadlineLapsed`), reset rules, refused effect, unknown outcome (`indeterminate`), verbatim retention, the declared `ceremony.proposerApproves`, the status-task hold; CER-017 to 019 behave per declared essential governance (section 11.4) | 1; 2 `profile-ceremony` for CER-003, 008, 009, 014; optional `ceremony` | 8.6, 7.2 items 10, 11, 12, 8.3, this document sections 11.4, 12 and 19 | `registry`: CER-001, 002, 005, 015; `candidate`: CER-017 to 019; the rest channel `proposed`, profile `ceremony-design` (advisory); CLARIFY: CER-004, 007, 010, 011, 012, 013, 016 |
| BND-001..007 | HTTPS binding: path and method; bearer mapping to the transport sender; no Authorization; Content-Type and the 200 case (BND-004); completed duplicate; raw JSON retained; the status table (BND-007, 2 `attested`) (section 11.3). The client side (an implementation parsing a non-2xx error body) is not tested: the suite sends, it does not receive HTTP | 1 (HTTPS only); BND-007 is 2 `attested` | `bindings/https/0.3` | settled; deployments differ on paths |

Registry slugs checked (versions in the snapshot): `trust-task-error` 0.1 to 0.6, `trust-task-next-step` 0.1, `trust-task-discovery` 0.1 to 0.4, `trust-task-control` 0.1, `trust-ceremony-receipt` (present), `vrc/relationships/{propose,issue}` 0.1, `witness/session` 0.1 and 0.2, `witness/session/submit` 0.1 to 0.2 (directory listing; later versions not read), `task-consent/{request,decision,granted}`, `credential-exchange/{offer,request,issue,present,query,pending}`. `vrc/relationships/witness-share` is not in the registry.

### 11.1 Ids as built (authoritative)

The ids in the table above are design ids and differ from the files in several groups. The files under `vectors/` are authoritative for what runs; this table lists the ids that exist, generated from them. The tier column reads `1`, `1 CLARIFY` (Tier 1, non-gating, section 8) or `2 <sub-group>` (Tier 2 and its sub-group, section 10). The spec column shows the first two traceability entries; each vector's metadata carries the full list with file and line. The groups TC and CEX are listed in section 11.5 and RCPT in section 11.6.

| Id | Title | Tier | Spec (first entries) |
|---|---|---|---|
| ENV-001 | minimal valid carrier request is accepted and answered | 1 | framework 4.1 to 4.4; framework 7.2 |
| ENV-002 | undecodable bytes get no invented reply | 1 | framework 8.2 (nothing to address) |
| ENV-003 | missing id is refused or ignored, never executed | 1 | framework 4.4 (id REQUIRED); framework 7.2 item 1 |
| ENV-004 | missing type is refused or ignored, never executed | 1 | framework 4.4 (type REQUIRED); framework 7.2 item 1 |
| ENV-005 | missing payload is refused | 1 | framework 4.4 (payload REQUIRED); framework 7.2 item 1 |
| ENV-006 | Type URI with a non-https scheme that is not the served type | 1 | framework 6.1; framework 7.2 item 3 |
| ENV-007 | Type URI with an upper-case slug | 1 | framework 6.1; framework 7.2 item 3 |
| ENV-008 | a binding specification is not a task type | 1 | framework 6.1 (bindings are not task types); framework 7.2 item 3 |
| ENV-009 | unknown type | 1 | framework 5.2; framework 7.2 item 3 |
| ENV-010 | wrong MAJOR version of a served specification | 1 | framework 5.2; framework 7.2 item 3 |
| ENV-011 | payload that violates the payload schema | 1 | framework 7.2 item 2 |
| ENV-012 | unknown top-level member is preserved and not acted on | 1 | framework 4.5.1 (unknown members); framework 7.2 |
| ENV-013 | closed payload: an unknown payload member is refused | 2 attested | profile:attested (closed payloads) |
| ENV-014 | timestamps in any RFC 3339 spelling are accepted and verified over the received bytes | 1 | framework 4.2; fixtures/proof eddsa-jcs-2022-timestamp-spellings |
| RSP-001 | success response: type, thread, parties, fresh id | 1 | framework 4.4.1; framework 4.9 |
| RSP-002 | response continues the request's thread | 1 CLARIFY | framework 4.9 |
| RSP-004 | tier 2: the response is signed by the IUT with purpose authentication, whole-second timestamps | 2 attested | profile:attested (proof on every response); framework 7.3 |
| ERR-001 | error shape, threading, inResponseTo and bounded details | 1 | framework 8.2; framework 8.2.2 |
| ERR-002 | an inbound error is never answered | 1 CLARIFY | framework 8 (no error loops) |
| ERR-003 | tier 2: errors are signed by the IUT | 2 attested | profile:attested (proof on every error) |
| ID-001 | wrong recipient | 1 | framework 7.2 item 5 |
| ID-002 | transport sender differs from issuer: identityMismatch to the sender, no leak, no echoed id | 1 | framework 7.2 item 6; framework 8.1 |
| LIF-001 | a responded document stays responded; an inbound error does not change it | 1 CLARIFY | framework 4.12 (responded is terminal) |
| LIF-002 | a document refused before acceptance writes no record: a corrected resend under the same id is accepted | 1 CLARIFY | framework 4.12 (the record is written at accepted); framework 7.2 item 11 |
| LIF-003 | task control not supported: unsupportedType, nothing cancelled | 1 | framework 11.8 (support is optional) |
| PRF | PRF-001 to PRF-108 (41 vectors, ids not contiguous: imported rows are numbered in fixture order, native vectors from 101 or 1) | 1 except PRF-003 and PRF-005 (2 profile-p384), PRF-103 and PRF-107 (2 attested), PRF-108 (1 CLARIFY) | framework |
| TIME | TIME-001 to TIME-105 (29 vectors, ids not contiguous: imported rows are numbered in fixture order, native vectors from 101, which take the declared window: 101, 102, 104, 105; TIME-103 is the ceremony deadline edge, section 11.4) | 1 for 013, 014, 022, 023, 024, 101, 102, 104, 105; 2 profile-window for 001 to 011, 015, 017 to 020; 2 attested for 012, 016, 021; 2 profile-ceremony for 103 | framework |
| DUP | DUP-001 to DUP-010 and DUP-101 to DUP-113 (23 vectors: 001 to 010 native, 101 to 113 imported rows numbered in fixture order; 006 to 008 are the restart and fail-closed vectors, gated on the optional capabilities `restart` and `fault.claimStore`; DUP-103 needs the carrier class `openPayload`) | 1 except DUP-110 to 113 (2 profile-window) and the CLARIFY vectors DUP-007 to 010 | framework |
| VRC-PRO-001 | an accepted proposal is answered with a #response: accept true and the counterparty's own relationshipDid | 1 | specs/vrc/relationships/propose/0.1/spec.md:82-85 (counterparty items 1-2); specs/vrc/relationships/propose/0.1/spec.md:76-79 (proposer items 1-2) |
| VRC-PRO-002 | the acceptance names the counterparty's own relationship DID, not the proposer's | 1 | specs/vrc/relationships/propose/0.1/spec.md:85 (returns a #response with its own relationshipDid); specs/vrc/relationships/propose/0.1/payload.schema.json (Response.relationshipDid: the DID the counterparty will use) |
| VRC-PRO-003 | a decline is a trust-task-error vrc/relationships/propose:declined, not a response | 1 | specs/vrc/relationships/propose/0.1/spec.md:87 (counterparty item 4); specs/vrc/relationships/propose/0.1/spec.md:38-41 (errorCodes) |
| VRC-PRO-004 | a proposal naming no relationshipDid is refused | 1 | specs/vrc/relationships/propose/0.1/payload.invalid-examples.json example 1; SPEC.md:1012 (7.2 item 2) |
| VRC-PRO-005 | a relationshipDid that is not a DID is refused | 1 | specs/vrc/relationships/propose/0.1/payload.invalid-examples.json example 2; specs/vrc/relationships/propose/0.1/payload.schema.json (pattern ^did:) |
| VRC-PRO-006 | an unknown payload member is refused (the payload is closed) | 1 | specs/vrc/relationships/propose/0.1/payload.invalid-examples.json example 3; specs/vrc/relationships/propose/0.1/payload.schema.json (additionalProperties false) |
| VRC-PRO-007 | witnessed is a request: an acceptance that does not agree does not claim a witnessed exchange | 1 | specs/vrc/relationships/propose/0.1/spec.md:86 (silence accepts an unwitnessed exchange); specs/vrc/relationships/propose/0.1/spec.md:103-108 (witnessing is agreed, not assumed) |
| VRC-PRO-008 | while the human decides the proposal is answered with a next-step that names a resubmission (`expects` the originating type, `continuation: resubmit`, `inResponseTo`, same thread), never an error, a terminal reply or silence | 1 | SPEC.md:1414 (8.6: a hold is a next step, never an error); SPEC.md:1416-1418 (expects names the originating Type URI with continuation resubmit where no status task exists) |
| VRC-PRO-009 | a held proposal the human then accepts is answered with the acceptance on the proposal's thread | 1 CLARIFY | specs/vrc/relationships/propose/0.1/spec.md:82-85; SPEC.md:450-462 (4.9 threadId) |
| VRC-PRO-010 | a held proposal the human then declines is answered with the decline | 1 CLARIFY | specs/vrc/relationships/propose/0.1/spec.md:87; SPEC.md:1414-1420 (a declined hold is refused as a refusal) |
| VRC-PRO-011 | tier 1: an unsigned proposal is accepted (propose declares proof OPTIONAL) | 1 CLARIFY | specs/vrc/relationships/propose/0.1/spec.md:23-31 (proofRequirement request OPTIONAL); SPEC.md:1017 (7.2 item 7: proofRequired only where the specification requires proof) |
| VRC-PRO-012 | tier 2: an unsigned proposal is refused proofRequired | 2 attested | profile:attested (proof on every request); specs/vrc/relationships/propose/0.1/spec.md:23-31 (OPTIONAL in the specification; strengthened by the profile) |
| VRC-PRO-013 | tier 2: the acceptance is signed by the IUT, purpose authentication, whole-second timestamps | 2 attested | profile:attested (proof on every response); specs/vrc/relationships/propose/0.1/spec.md:23-31 (response proof OPTIONAL in the specification) |
| VRC-PRO-014 | the proposal goes through the framework pipeline: wrong recipient | 1 | specs/vrc/relationships/propose/0.1/spec.md:84 (counterparty item 1: SPEC.md 7.2 pipeline); SPEC.md:1015 (7.2 item 5) |
| VRC-PRO-015 | the proposal goes through the framework pipeline: transport sender differs from issuer | 1 | specs/vrc/relationships/propose/0.1/spec.md:84; SPEC.md:1016 (7.2 item 6) |
| VRC-PRO-016 | profile: a relationshipDid equal to the proposer's connection identifier is refused | 1 CLARIFY | specs/vrc/relationships/propose/0.1/spec.md:79 ("not a long-term identifier": inequality with the connection DID is a checkable inference, not specification text); docs/06 section 2.2 and 3.10 |
| VRC-PRO-017 | profile: a relationshipDid already used in an earlier exchange is refused (unique per VRC) | 1 CLARIFY | specs/vrc/relationships/propose/0.1/spec.md:79 (minted for this relationship); docs/06 section 3.10 (per-VRC uniqueness) |
| VRC-PRO-018 | a relationshipDid already recorded for another counterparty is refused | 1 CLARIFY | specs/vrc/relationships/propose/0.1/spec.md:79; specs credential: a pairwise identifier MUST NOT be used with more than one counterparty (CRED/body.md:381) |
| VRC-PRO-019 | tier 2: the next-step answering a hold is signed by the IUT, purpose authentication, whole-second timestamps | 2 attested | SPEC.md:1414-1418 (8.6 a hold is a next step); specs/trust-task-next-step/0.1/spec.md (proof RECOMMENDED; the attested profile requires it) |
| VRC-PRO-020 | a resubmission (fresh id, same thread) while the human still decides is answered with a further next-step | 1 | SPEC.md:1418 (a further next step while the act is awaited) |
| VRC-PRO-021 | a resubmission after the human accepted is answered with the acceptance on the proposal's thread, without a second execution | 1 | SPEC.md:1418 (the outcome once it is known) |
| VRC-ISS-001 | a credential delivered inside an accepted exchange is stored and receipted with the digest of the stored credential | 1 | specs/vrc/relationships/issue/0.1/spec.md:98-109 (issuing party items 1-3, receiving party items 1-3); specs/vrc/relationships/issue/0.1/spec.md:83-89 (receipt names the stored artifact) |
| VRC-ISS-002 | the receipt digest is computed over the stored credential when the request carries none | 1 | specs/vrc/relationships/issue/0.1/spec.md:83-89 (MUST compute the digest over the credential it stored); specs/vrc/relationships/issue/0.1/spec.md:102 (vrcDigestMultibase SHOULD) |
| VRC-ISS-003 | a request digest that does not match the credential is not copied into the receipt | 1 CLARIFY | specs/vrc/relationships/issue/0.1/spec.md:86-89 (a copied digest attests nothing about what was stored); specs/vrc/relationships/issue/0.1/spec.md:109 |
| VRC-ISS-004 | an unsolicited delivery is refused notAccepted however well it verifies | 1 | specs/vrc/relationships/issue/0.1/spec.md:115-122 (authorization is the accepted proposal); specs/vrc/relationships/issue/0.1/spec.md:49-52 |
| VRC-ISS-005 | a delivery for a proposal that is still held is refused notAccepted | 1 | specs/vrc/relationships/issue/0.1/spec.md:115-122; specs/vrc/relationships/propose/0.1/spec.md:97-101 (acceptance is not issuance; a held proposal is not accepted) |
| VRC-ISS-006 | a delivery for a declined proposal is refused notAccepted | 1 | specs/vrc/relationships/issue/0.1/spec.md:115-122; specs/vrc/relationships/propose/0.1/spec.md:87 |
| VRC-ISS-007 | a credential whose issuer is not the relationship DID the proposal exchanged is refused | 1 | specs/vrc/relationships/issue/0.1/spec.md:101 (issuing party item 2); specs/vrc/relationships/issue/0.1/spec.md:108 (party bindings checked before storing) |
| VRC-ISS-008 | a credential whose subject is not the receiving party's relationship DID is refused | 1 | specs/vrc/relationships/issue/0.1/spec.md:101; specs/vrc/relationships/issue/0.1/spec.md:108 |
| VRC-ISS-009 | a credential whose own proof does not verify is refused | 1 | specs/vrc/relationships/issue/0.1/spec.md:108 (verifies the credential's own proof before storing or receipting); specs/vrc/relationships/issue/0.1/spec.md:146-150 (two proofs, two jobs) |
| VRC-ISS-010 | a credential proven by a key its issuer does not control is refused | 1 | specs/vrc/relationships/issue/0.1/spec.md:108; SPEC.md:359-376 (4.7.3: a key controlled by the issuer) |
| VRC-ISS-011 | a delivery without an envelope proof is refused proofRequired even when the credential verifies | 1 | specs/vrc/relationships/issue/0.1/spec.md:23-31 (request proof REQUIRED); specs/vrc/relationships/issue/0.1/spec.md:148-150 (never accept an unproofed envelope because the credential verifies) |
| VRC-ISS-012 | a delivery without issuedAt is refused (issuedAt REQUIRED) | 1 | specs/vrc/relationships/issue/0.1/spec.md:33-35 (issuedAtRequirement REQUIRED); SPEC.md:1023 (7.2 item 13) and 7.3 item 17 |
| VRC-ISS-013 | an expired delivery is refused and nothing is stored | 1 | specs/vrc/relationships/issue/0.1/spec.md:33-35 (a replayed issuance re-asserts a relationship); SPEC.md:1014 (7.2 item 4) |
| VRC-ISS-014 | an identical resend is absorbed: the first receipt again, stored once, not executed twice | 1 | SPEC.md:1021 (7.2 item 11); SPEC.md:1055 (disposition of a duplicate) |
| VRC-ISS-015 | the same id with a different credential is idConflict, nothing new is stored | 1 | SPEC.md:1021 (7.2 item 11); SPEC.md:1033 (keying and comparison) |
| VRC-ISS-016 | the same id re-signed over identical content is idConflict | 1 | SPEC.md:1033 (a re-signed proof over identical content is a different document sharing an id); SPEC.md:1021 |
| VRC-ISS-017 | tier 2: the receipt is signed by the IUT, purpose authentication, whole-second timestamps | 2 attested | profile:attested (proof on every response); specs/vrc/relationships/issue/0.1/spec.md:23-31 (response proof OPTIONAL in the specification) |
| VRC-ISS-018 | tier 2: an envelope whose issuer is the relationship DID is refused (issuer, signer and sender are the connection DID) | 2 attested | docs/04 section 10: envelope issuer and proof under the connection DID; the relationship DID only in the VRC inner proof (profile attested); SPEC.md:394-423 (4.8.1 precedence of in-band identity) |
| VRC-ISS-019 | tier 2: an envelope issued as the connection DID but proven by the relationship DID's key is refused | 2 attested | docs/04 section 10 (profile attested): issuer == proof signer == transport sender; SPEC.md:1017 (7.2 item 7) |
| VRC-ISS-020 | a second delivery of the same credential under a new envelope id leaves one stored credential | 1 CLARIFY | SPEC.md:1062 (creating something SHOULD be refused when it exists) versus specs/vrc/relationships/issue/0.1/spec.md:83-89 (receipt names the stored artifact); docs/04 section 11 (digest-idempotent store) |
| VRC-ISS-021 | a second, different credential for one exchange is not stored | 1 CLARIFY | docs/06 section 2.2 (issue:alreadyIssued); SPEC.md:1062 (creating something) |
| VRC-ISS-022 | a second exchange between the same parties, with a fresh relationship DID, stores a second credential | 1 CLARIFY | docs/07 section 1 (relationship DID unique per VRC exchanged); specs/vrc/relationships/propose/0.1/spec.md:64-66 (a propose id names the exchange) |
| VRC-ISS-023 | profile: the credential's inner proof is made with purpose assertionMethod | 1 CLARIFY | credential specification CRED/body.md:85-86 and :249-250 (examples sign with proofPurpose assertionMethod; the VRC example elides the proof, :359-361); docs/06 section 3.10 (inference: inner proof key listed under assertionMethod) |

Groups added after the benchmark (generated from the files):

| Id | Title | Tier | Spec (first entries) |
|---|---|---|---|
| ERR-004 | the error code is a standard code (or a namespaced extended code), never an invented one | 1 | SPEC.md:1237 (8.2 code MUST be a standard or extended code) ; SPEC.md:1294 (8.3 the standard set) |
| ERR-005 | retryable defaults: refusals the producer cannot cure by resending are not marked retryable | 1 CLARIFY | SPEC.md:1315 (8.3 default retryable, SHOULD unless task-specific knowledge dictates otherwise) ; SPEC.md:1342-1346 (8.4 retry means the identical document) |
| ERR-006 | no leak: a message names neither the contested recipient nor the verification method it tried | 1 | SPEC.md:1274-1281 (8.2.1 a message MUST NOT carry the contested value or key-status internals) ; SPEC.md:1282 (applies to every code) |
| ERR-007 | bounded details on every error path: at most 4096 bytes and 16 members | 1 | SPEC.md:1284-1289 (8.2.2 unbounded details MUST NOT be emitted) |
| ERR-008 | an inbound error carrying an extended code and oversized details is not answered | 1 CLARIFY | SPEC.md:1290 (8.2.2 a receiver ignores oversized details and still honours the code) ; docs/04 section 13 (error hygiene: an inbound error is answered with nothing) |
| ID-003 | tier 2: the issuer and the proof signer are one identity | 2 attested | SPEC.md:394-423 (4.8.1 in-band identity is authoritative) ; SPEC.md:1017 (7.2 item 7) |
| ID-004 | tier 2: the issuer and the transport-authenticated sender are one identity; needs `transportIdentity` | 2 attested | SPEC.md:394-423 (4.8.1 the transport identity is a cross-check) ; SPEC.md:1016 (7.2 item 6, only where the transport authenticates the sender) |
| RSP-005 | tier 2: the response verifies under the identifier the request was addressed to, and no other | 2 attested | profile:attested (response signed by the request's recipient) ; SPEC.md:1015 (7.2 item 5 recipient) |
| CTRL-001 | cancel of a task that was answered: unsupportedType, the task keeps its state | 1 | SPEC.md:1698 (11.8 a consumer that does not implement control rejects it with unsupportedType) ; SPEC.md:1635-1640 (11.1 who may cancel) |
| CTRL-002 | suspend and resume are refused like cancel | 1 | SPEC.md:1698 (11.8) ; SPEC.md:1673-1677 (11.5 suspension and resumption) |
| CTRL-003 | an unrecognised control operation is refused, not defaulted to a known one | 1 | SPEC.md:1698 (11.8) ; specs/trust-task-control/0.1/payload.schema.json (operation: a consumer that does not recognise a value MUST reject the document) |
| CTRL-004 | an unsigned control document is refused unsupportedType: the type is checked before the proof | 1 | SPEC.md:1698 (11.8) ; SPEC.md:1011 (7.2 item 3 type before item 7 proof) |
| DUP-006 | restart: the duplicate record is durable, an identical resend after a restart is still absorbed | 1 | framework 7.2 item 11 (a document accepted once is not executed again; nothing limits that to one process lifetime) ; docs/04 section 13 (restart, optional) |
| DUP-007 | fail closed: an unreadable duplicate record gives unavailable, retryable, and nothing is executed | 1 CLARIFY | docs/04 section 12 (duplicate-record store unreadable: unavailable, retryable, fail closed) ; SPEC.md:1021 (7.2 item 11 cannot be honoured without the record) |
| DUP-008 | fail closed is never taskFailed, and the refused id is not burned: the identical resend executes once after the store returns | 1 CLARIFY | docs/04 section 12 (outcome unknown is never guessed) ; SPEC.md:1021 (7.2 item 11) |
| DUP-009 | same id after the first attempt was refused for its proof: the corrected resend under the same id | 1 CLARIFY | SPEC.md:1021 (7.2 item 11: keyed on id; the record is written at accepted, 4.12); docs/05 V9 (VTI claims the id only after the proof verifies and releases a refused claim) |
| DUP-010 | same id from another issuer: the second document is a different document under the same id | 1 CLARIFY | SPEC.md:1033 (7.2 item 11, Keying and comparison: the key is the id); docs/05 V9 |
| NS-001 | the next-step payload is a closed object: no member outside expects, continuation, inResponseTo, message, ext | 1 | specs/trust-task-next-step/0.1/payload.schema.json (additionalProperties false) ; SPEC.md:1414 (8.6 a hold is a next step) |
| NS-002 | every expects entry names a Type URI | 1 | specs/trust-task-next-step/0.1/payload.schema.json (expects[].typeUri required) ; SPEC.md:1416-1418 (expects names the originating Type URI where no status task exists) |
| NS-003 | message is at most 1024 characters | 1 | specs/trust-task-next-step/0.1/payload.schema.json (message maxLength 1024) ; SPEC.md:1414 |
| NS-004 | a hold is answered with trust-task-next-step, not the deprecated trust-task-ok and not silence | 1 | SPEC.md:1414 (8.6 a consumer holding a task MUST answer with a next step) ; SPEC.md:1427 (trust-task-ok SHOULD NOT be emitted) |
| NS-005 | the next-step is addressed to the producer on the request's thread with a fresh id and names the held document | 1 | SPEC.md:450-462 (4.9 threadId, a response never reuses the request id) ; specs/trust-task-next-step/0.1/spec.md (inResponseTo names the document answered) |
| AUTHZ-001 | a delivery on another party's accepted thread is indistinguishable from one on an unknown thread | 1 | SPEC.md:1020 (7.2 item 10 validation is not authorization) ; specs/vrc/relationships/issue/0.1/spec.md:115-122 (authorization is the accepted proposal) |
| AUTHZ-002 | a proposal resubmitted by a party other than the proposer is refused permissionDenied and learns nothing of the outcome | 1 CLARIFY | SPEC.md:1020 (7.2 item 10) ; SPEC.md:1414-1420 (a resubmission is answered in the same thread, for the producer that held it) |
| TD-001 | a cited document that carries a proof pairs with the digest computed without its top-level proof | 1 | SPEC.md:545-557 (4.9.3 the top-level proof is removed before hashing) |
| TD-002 | a cited document that carries no proof pairs with the digest of the document unchanged (no placeholder) | 1 | SPEC.md:545-557 (4.9.3 where the document carries no proof the input is the document unchanged; no placeholder is substituted) |
| TD-003 | a cited document signed again after the citation was made is the same document with the same task digest | 1 | SPEC.md:545-557 (4.9.3 a document has one task digest whether or not, or how often, it was signed) ; SPEC.md:559-561 (task digest versus step digest) |
| TD-004 | a proof nested inside the payload is part of the content and stays in the digest input | 1 | SPEC.md:545-557 (4.9.3 a proof within payload MUST NOT be removed) |
| TD-005 | the base64url spelling of a digest pairs: the decoded bytes are compared, not the encoded strings | 1 | SPEC.md:553 (4.9.3 DigestMultibase: base58btc `z` or base64url `u`; SPEC.md:2195); SPEC.md:557-558 (4.9.3 compare the decoded multihash bytes) |
| TD-006 | a citation naming an unimplemented hash never pairs, and the id alone is never enough | 1 | SPEC.md:558 (4.9.3 MUST NOT recompute under a different algorithm and MUST NOT fall back to id comparison alone) |
| WSH-001 | a conforming bundle is stored and receipted with the digest of the stored credential | 2 profile-witness-share | docs/10-witness-share-profile.md section 4, 5.1 ; docs/10-witness-share-profile.md section 11 WSH-001 |
| WSH-002 | a presentation whose challenge is not this exchange (replay across exchanges) is refused | 2 profile-witness-share | docs/10-witness-share-profile.md section 4 step 4.1 ; docs/10-witness-share-profile.md section 11 WSH-002 |
| WSH-003 | a presentation whose domain is not vrc:witness-share is refused | 2 profile-witness-share | docs/10-witness-share-profile.md section 3.3 (domain constant) ; docs/10-witness-share-profile.md section 11 WSH-003 |
| WSH-004 | a witnessed credential about the receiver (its own VWC bounced back) is refused | 2 profile-witness-share | docs/10-witness-share-profile.md section 4 step 6 ; docs/10-witness-share-profile.md section 11 WSH-004 |
| WSH-005 | parties that do not name both relationship DIDs are refused | 2 profile-witness-share | docs/10-witness-share-profile.md section 4 step 7 ; docs/10-witness-share-profile.md section 11 WSH-005 |
| WSH-006 | a foreign terminal (other thread) or a terminal that is an error response is refused | 1 | docs/10-witness-share-profile.md section 4 step 4.7 and 4.8 ; docs/10-witness-share-profile.md section 11 WSH-006 |
| WSH-007 | a task digest that does not reproduce over the initiating document (document altered, digest wrong, taskContext wrong) is refused | 1 | SPEC.md:545-557 (4.9.3 recompute, compare) ; docs/10-witness-share-profile.md section 4 step 4.5 and 4.6 |
| WSH-008 | a terminal signed by someone other than the initiating document's recipient is refused | 1 | framework 4.9.4 item 4 (the outcome evidence is signed by the party the initiating document was addressed to) ; docs/10-witness-share-profile.md section 11 WSH-008 |
| WSH-009 | a terminal of a type other than the declared outcome-evidence type is refused | 1 | framework 4.9.4 item 3 (the declared outcome-evidence type) ; docs/10-witness-share-profile.md section 11 WSH-009 |
| WSH-010 | a terminal with its proof stripped is refused | 1 | docs/10-witness-share-profile.md section 4 step 4.9 ; docs/10-witness-share-profile.md section 11 WSH-010 |
| WSH-011 | the citation in another multibase spelling of the same digest is accepted (decoded bytes are compared) | 1 | SPEC.md:557-558 (4.9.3 compare decoded multihash bytes, not strings) ; docs/10-witness-share-profile.md section 11 WSH-011 |
| WSH-012 | a citation naming a hash the verifier does not implement is not evidence of completion (the initiating document is also altered, so a consumer that does implement the hash refuses it as well) | 1 | SPEC.md:552, 557 (4.9.3 the multihash prefix names the algorithm; an unimplemented one is never recomputed under another and never compared by id alone) ; docs/10-witness-share-profile.md section 5.1 |
| WSH-013 | an unsolicited share (no accepted exchange with this sender) is refused notAccepted, not proofInvalid | 2 profile-witness-share | docs/10-witness-share-profile.md section 4 step 3 and 6.1 ; docs/10-witness-share-profile.md section 11 WSH-013 |
| WSH-014 | a share without an envelope proof is refused proofRequired | 1 | docs/10-witness-share-profile.md section 1 (proof required on the request) ; docs/10-witness-share-profile.md section 11 WSH-014 |
| WSH-015 | an envelope proof made by a key that is not the issuer's is refused | 1 | docs/10-witness-share-profile.md section 6.2 ; docs/10-witness-share-profile.md section 11 WSH-015 |
| WSH-016 | an unknown payload member, or a missing presentation, initiating or terminal, is malformed | 1 | docs/10-witness-share-profile.md section 3.2 (closed payload, required members) ; docs/10-witness-share-profile.md section 11 WSH-016 |
| WSH-017 | a redelivery of the same bundle under a new envelope id leaves one stored credential and a receipt with the same digest | 2 profile-witness-share, CLARIFY vector-overreads (a profile SHOULD; a new id is a different document, SPEC.md:1021) | docs/10-witness-share-profile.md section 8 (idempotent on the credential digest) ; docs/10-witness-share-profile.md section 11 WSH-017 |
| WSH-018 | the same id with changed content is idConflict and nothing new is stored | 1 | SPEC.md:1021 (7.2 item 11) ; SPEC.md:1033 |
| WSH-019 | a share arriving after the counterparty's issue is accepted too (no order is enforced) | 1 CLARIFY | docs/10-witness-share-profile.md section 7 (no order is determined by the reference implementation) ; docs/10-witness-share-profile.md section 11 WSH-019 |
| WSH-020 | tier 2: the receipt is signed and verifies under the request's recipient | 2 attested | docs/10-witness-share-profile.md section 6.3 ; docs/10-witness-share-profile.md section 11 WSH-020 |
| WSH-021 | tier 2: the envelope is issued, signed and sent as the connection DID; the relationship DID as issuer or as the signing key is refused | 2 attested | docs/10-witness-share-profile.md section 6.3 ; docs/10-witness-share-profile.md section 11 WSH-021 |
| WSH-024 | a second, different share on the same exchange is accepted and stored (the permissive reading) | 1 CLARIFY | docs/10-witness-share-profile.md section 12 (whether a second, different share on the same thread must be refused is not determined); docs/10-witness-share-profile.md section 8 (the receiver processes a second share on its merits) |
| WSH-025 | a witnessed credential whose own proof does not verify, or is made by a key its issuer does not control, is refused | 2 profile-witness-share | docs/10-witness-share-profile.md section 4 step 4.3 (the credential's own proof verifies independently of the evidence) ; SPEC.md:359-376 (4.7.3 a key controlled by the issuer) |
| DIS-001 | a query with no patterns lists exactly the task types the implementation declares, as bare Type URIs without duplicates | 1 | specs/trust-task-discovery/0.4/spec.md:77 (an absent or empty patterns list is the single pattern *); specs/trust-task-discovery/0.4/spec.md:78-79 (bare Type URIs, no duplicates) |
| DIS-002 | an empty patterns array is the same as * | 1 | specs/trust-task-discovery/0.4/spec.md:77; specs/trust-task-discovery/0.4/payload.schema.json (patterns: omitted or empty means *) |
| DIS-003 | the pattern * lists every supported type | 1 | specs/trust-task-discovery/0.4/spec.md:164-170 (pattern grammar: * matches every slug) |
| DIS-004 | a <prefix>/* pattern lists the types whose slug starts with the prefix and the slash | 1 | specs/trust-task-discovery/0.4/spec.md:164-170 (<prefix>/* matches slugs starting with the literal <prefix>/) |
| DIS-005 | the prefix includes its slash: vrc/relationships/p/* matches nothing although vrc/relationships/propose exists | 1 | specs/trust-task-discovery/0.4/spec.md:170 (the literal <prefix>/ including the slash) |
| DIS-006 | an exact slug lists only that slug, and a partial slug is not a prefix | 1 | specs/trust-task-discovery/0.4/spec.md:170 ("<slug>" is an exact match); specs/trust-task-discovery/0.4/spec.md:174 (any other shape is an exact slug match) |
| DIS-007 | a wildcard anywhere but the trailing /* is literal and matches no slug | 1 | specs/trust-task-discovery/0.4/spec.md:174 (wildcards elsewhere are matched literally; acl/*-handoff matches no slug) |
| DIS-008 | several patterns combine with OR | 1 | specs/trust-task-discovery/0.4/spec.md:176 (multiple patterns are combined with OR semantics) |
| DIS-009 | a query that matches nothing is answered with an empty list, not an error | 1 | specs/trust-task-discovery/0.4/spec.md:77 (the subset the responder supports that matches); SPEC.md:1574 (a response with supportedTypes [] is allowed) |
| DIS-010 | sixteen patterns are accepted and seventeen are refused malformedRequest | 1 | specs/trust-task-discovery/0.4/spec.md:178 (the array is bounded at 16 entries); specs/trust-task-discovery/0.4/payload.schema.json (patterns maxItems 16) |
| DIS-011 | the request payload is a closed object of non-empty string patterns: an unknown member, a non-array or an empty pattern is malformedRequest | 1 | specs/trust-task-discovery/0.4/payload.schema.json (additionalProperties false; patterns items minLength 1); SPEC.md:1013 (7.2 item 2 payload validation) |
| DIS-012 | the response states a window no wider than the one enforced: a document at the advertised maximum age, and one at the advertised skew ahead, are accepted | 1 | specs/trust-task-discovery/0.4/spec.md:106-127 (a responder MUST state a window no wider than the one it applies); specs/trust-task-discovery/0.4/spec.md:124 (refuses past acceptance end plus skew, or issuedAt beyond now plus skew) |
| DIS-013 | (discovery 0.4 only: 0.3 has no expiryHorizonSeconds) an advertised expiry horizon is honoured: a document issued almost a horizon ago with an expiresAt inside it is accepted | 1 | specs/trust-task-discovery/0.4/spec.md:118-122 (acceptance end with expiryHorizonSeconds); specs/trust-task-discovery/0.4/spec.md:106-127 (a responder MUST NOT state a wider horizon than it applies) |
| DIS-014 | the list is sorted lexicographically by Type URI | 1 CLARIFY | specs/trust-task-discovery/0.4/spec.md:88 (a conforming responder SHOULD sort supportedTypes) |
| DIS-015 | a discovery request without a proof is answered at Tier 1 (the proof is RECOMMENDED, not required) | 1 CLARIFY | specs/trust-task-discovery/0.4/spec.md:24-25 (proofRequirement RECOMMENDED); SPEC.md:1562 (10.5 item 1: RECOMMENDED, not OPTIONAL and not REQUIRED) |
| DIS-016 | tier 2: the discovery response is signed by the IUT under the request's recipient | 2 attested | profile:attested (proof on every response); specs/trust-task-discovery/0.4/spec.md:24-25 |
| DIS-017 | a discovery request addressed to another recipient is wrongRecipient | 1 | SPEC.md:1015 (7.2 item 5); specs/trust-task-discovery/0.4/spec.md:13-18 (the responder is the recipient) |
| BND-001 | only POST /trust-tasks is accepted: another method is 405 and another path is 404, neither with a framework error document | 1 | bindings/https/0.3/spec.md:52 (reject every other method/path combination with 405 / 404; not framework error documents) |
| BND-002 | the bearer-authenticated sender is the transport identity: a different in-band issuer is identityMismatch (422), routed to the authenticated sender (runs where the transport authenticates the sender, `optional:transportIdentity`; the statuses are SHOULDs) | 1 | bindings/https/0.3/spec.md:53 (map the bearer token to a VID); bindings/https/0.3/spec.md:124 (the in-band issuer is cross-checked against it; mismatch is identityMismatch) |
| BND-003 | a request with no Authorization header has no transport-authenticated sender and is judged on its proof | 1 | bindings/https/0.3/spec.md:53 (no Authorization: no transport-authenticated sender); bindings/https/0.3/spec.md:124 (absent for requests with no Authorization header) |
| BND-004 | the single-document answers: 200 with the response, and every answer, error documents included, carries Content-Type application/json (no status code is asserted on an error) | 1 | bindings/https/0.3/spec.md:161 (Content-Type application/json for every single-document answer); bindings/https/0.3/spec.md:139-156 (status mapping; the status codes themselves are BND-007); bindings/https/0.3/spec.md:135 (the mapping is a SHOULD, so the 200 is advisory) |
| BND-005 | a duplicate of a completed execution is answered with the retained response under 200 | 1 | bindings/https/0.3/spec.md:159 (a duplicate is answered with the response the first execution produced, under 200 OK); SPEC.md:1021 (7.2 item 11) |
| BND-006 | the proof is verified over the received JSON object: unknown members, key order and layout are preserved | 1 | bindings/https/0.3/spec.md:54 (keep the received JSON object; the proof is verified over it, not over a re-serialisation of the typed document) |
| BND-007 | the status table (attested profile): 200 with the response, 400 malformedRequest, 409 idConflict, and the flat 422 bucket, every body application/json | 2 attested | bindings/https/0.3/spec.md:139-156 (status mapping: SHOULD, spec.md:135); profile:attested (the status table) |
| 2PC-001 | an aborted transaction or a no vote is an error, never a receipt; nothing is stored and the document ends errored | 2 profile-ceremony | docs/04-suite-design.md section 12 (a vote no, or the transaction aborted: errored, taskFailed); docs/04-suite-design.md section 12 assertion 1 (a #response only after the observable outcome is committed) |
| 2PC-002 | an abort reaches the wire as a short closed-vocabulary reason; an internal fact does not | 1 CLARIFY | docs/04-suite-design.md section 12 (details.reason from a closed vocabulary); SPEC.md:1282 (8.2.1 a message must not disclose internal state) |
| 2PC-003 | a ceremony short of its quorum is visible to the producer only as a next-step: the begin document stays accepted (neither responded nor errored) and nothing is established | 1 | docs/04-suite-design.md section 12 (more approvals needed: accepted and blocked); SPEC.md:1414, 1417 (8.6 a hold is a next step); docs/06 section 3.9 |
| 2PC-004 | the deadline is enforced on the participant path: a late approval is refused `deadlineLapsed`, the begin document ends errored, a second late approval gets the same refusal | 2 profile-ceremony | docs/04-suite-design.md section 12 (deadline lapses while pending); docs/decisions/README.md (holds and ceremonies); docs/06 section 3.9 |
| 2PC-005 | a reset is allowed from an expired ceremony and refused after a commit, which keeps its effect | 2 profile-ceremony | docs/04-suite-design.md section 12 (reset after commit is refused or reported with its effects); docs/06 section 3.9 |
| 2PC-006 | a transaction that committed but whose reply was lost is not executed again: the resend is absorbed or answered with the receipt, and the effect count stays 1 | 1 | docs/04-suite-design.md section 12 assertion 4 (after commit a duplicate returns the same receipt or nothing and the effect count stays 1); SPEC.md:1021 (7.2 item 11) |
| 2PC-007 | while the outcome is not known the document stays accepted: no receipt, a resend is absorbed (202), other bytes under the id are idConflict, and the receipt follows the commit | 1 | docs/04-suite-design.md section 12 (duplicate while in flight; outcome unknown is never guessed as responded); bindings/https/0.3/spec.md:142 (in-progress duplicate: 202, empty body) |
| 2PC-008 | fail closed on the ceremony path: an unreadable duplicate record refuses the issue as unavailable (retryable), nothing is stored, and the resend executes once | 1 CLARIFY | docs/04-suite-design.md section 12 (duplicate-record store unreadable: unavailable, retryable); bindings/https/0.3/spec.md:155 (unavailable: 503) |

| CER-001 | a ceremony that needs more approvals is answered with a next-step in the begin's thread, naming the begin (hold rule, section 11.4); nothing is established | 1 | SPEC.md:1414, 1417; specs/trust-task-next-step/0.1/spec.md:82-84; payload.schema.json:42 |
| CER-002 | with no status task offered: a resubmitted begin gets a further next-step while approvals are awaited, the outcome once known, no second effect (SKIP when `ceremony.status`; CER-015 and CER-016 are its reciprocal) | 1 | SPEC.md:1417; next-step spec.md:94 |
| CER-003 | an approval that completes the quorum is answered with the response, and the effect exists when it is | 2 profile-ceremony | docs/04 section 12 assertion 1; SPEC.md:1022 (7.2 item 12) |
| CER-004 | approving twice is idempotent: a repeat by one administrator does not count as another's; a repeat after the commit gets the outcome again, no second effect | 1 CLARIFY | SPEC.md:1061 (setting a state SHOULD succeed when already in that state); docs/04 section 11.4 |
| CER-005 | the same approval document delivered again after the commit is absorbed, effect count stays 1 | 1 | SPEC.md:1021 (7.2 item 11); SPEC.md:1055 |
| CER-006 | an approval by a non-administrator is `permissionDenied`, records nothing, and the ceremony can still commit | 1 | SPEC.md:1305 (8.3); SPEC.md:1020 (7.2 item 10) |
| CER-007 | a non-administrator's approval of a ceremony gets the same refusal as an approval of one that does not exist | 1 CLARIFY | SPEC.md:1063 (a missing target: the same code MAY serve a target the requester may not see) |
| CER-008 | an approval after the deadline is `taskFailed` with `details.reason` `deadlineLapsed` (not `expired`), nothing established (needs `trigger.ceremonyDeadline`) | 2 profile-ceremony | docs/04 section 12; docs/decisions/README.md (holds and ceremonies); SPEC.md:1045 |
| CER-009 | a reset is refused while pending and after the commit, and changes nothing | 2 profile-ceremony | docs/04 section 12; docs/06 section 3.9; SPEC.md:1022 |
| CER-010 | a refused effect ends the ceremony failed: an error with a closed `details.reason`, no effect; a reset from failed is allowed (needs `trigger.ceremonyEffect`) | 1 CLARIFY | docs/04 section 12; docs/06 section 3.9; SPEC.md:1310 |
| CER-011 | while the effect's outcome is unknown the answer is a retryable `indeterminate`, nothing established; the response follows the commit (needs `trigger.ceremonyEffect`, `trigger.twoPhase` for `settle`) | 1 CLARIFY | SPEC.md:1312, 1317 (8.3 indeterminate); docs/04 section 12 |
| CER-012 | a reset after the commit is refused with `details.reason` `alreadyCommitted` | 1 CLARIFY | docs/04 section 12; docs/06 sections 3.9 and 12.1 (closed reason vocabulary) |
| CER-013 | a ceremony document is retained verbatim: the request as received (key order and layout kept) and the reply as sent (needs `observe.retained`) | 1 CLARIFY | docs/06 sections 3.7 and 12.2; SPEC.md:1342-1346 |
| CER-014 | the declared `ceremony.proposerApproves` is what the implementation does: where a begin counts as the proposer's approval one approval by the other administrator completes the quorum; where it does not that approval alone leaves the ceremony held and the proposer's own approval completes it | 2 profile-ceremony | section 11.4; SPEC.md:1417 |
| CER-015 | where a status task is offered (`ceremony.status`) a held ceremony is answered with a next-step that names it in `expects`, in the begin's thread, naming the begin; the begin stays accepted; the `continuation` value is not asserted (SKIP without `ceremony.status`) | 1 | SPEC.md:1414, 1417; next-step spec.md:82-84; payload.schema.json:42 |
| CER-016 | where a status task is offered, a query about a held ceremony is answered with a response of the status type in the ceremony's thread, records no approval and runs no effect; asked after the commit it answers again, no second effect (SKIP without `ceremony.status`) | 1 CLARIFY | SPEC.md:1417 (expects names a task by which the producer can learn the outcome); section 11.4 |
| CER-017 | behaves per declared E: the ceremony completes exactly at the k-th distinct approval from the declared authority set; each earlier one is held with no effect (runs at k = 1 too; `candidate`) | 1 | SPEC.md:1414, 1417; SPEC.md:1022 (7.2 item 12); sections 11.4 and 19 |
| CER-018 | behaves per declared E: an approval from outside the declared authority set is refused and not counted; completion still needs k distinct members (`candidate`) | 1 | SPEC.md:1020 (7.2 item 10); SPEC.md:1305 (8.3); sections 11.4 and 19 |
| CER-019 | behaves per declared E: a repeat approval by the same member (a fresh document) is not counted as another member's (needs k of at least 2; `candidate`) | 1 | SPEC.md:1061; sections 11.4 and 19 |
| TIME-103 | a ceremony's deadline is half-open: an approval one second before it commits, one made exactly at it is refused (needs `trigger.ceremonyDeadline`) | 2 profile-ceremony | docs/06 section 3.8; SPEC.md:1014 (7.2 item 4, the same half-open reading) |

Id note: WSH-025 is the credential-proof vector (docs/10 section 4 step 4.3). WSH-024 is the second, different share on one exchange (CLARIFY, docs/10 section 12). WSH-022 (terminal VWC differs from the presented one, docs/10 section 4 "not made" list) and WSH-023 (witness is a party) stay reserved: the first needs a profile rule docs/10 does not make, the second has no text in docs/10.

### 11.2 Discovery (DIS)

The discovery vectors target `https://trusttasks.org/spec/trust-task-discovery/0.4` and gate on that Type URI in `supportedTypes`. **An implementation that declares discovery MUST list in `supportedTypes` the Type URI of every task it serves, discovery's own included (the bare form `https://trusttasks.org/spec/<slug>/<MAJOR.MINOR>`), and its discovery answer MUST list exactly that set for `*`.** The suite compares the two (the answer to `*` against the declared `supportedTypes`) with its own implementation of the pattern grammar; a type listed but not declared, or declared but not listed, fails DIS-001 and the pattern vectors. A private type may be a URN (`urn:<NID>:<prefix>:spec:<slug-segments>:<MAJOR.MINOR>`, framework 6.1): the harness reads its slug from the segments between `spec` and the version, a `:` standing for `/`, so a type such as `urn:p2pts:tasks:spec:vrc:relationships:issue:0.1` is matched by `vrc/*`. A type URI of any other form is neither expected nor accepted in the answer, so declare only those two forms. The framework-reserved `trust-task-next-step`, `trust-task-error` and `trust-task-control` are listed only if served as tasks.

Optional capabilities: `discovery.acceptanceWindow` (the answer carries `acceptanceWindow`; DIS-012 then proves the window is no wider than the one enforced, by sending a document at the advertised maximum age and one at the advertised skew ahead) and `discovery.expiryHorizon` (DIS-013). Discovery is not consequential: it keeps no duplicate record and counts as no execution. The proof is RECOMMENDED, so Tier 1 accepts an unsigned request (DIS-015, CLARIFY, and SKIP for an attested server) and Tier 2 signs the answer. The vectors run against the version the implementation serves, 0.4 or else 0.3 (the pseudo-type `discovery`); the request rules are the same text in both, so DIS-001 to DIS-017 cite the 0.3 lines beside the 0.4 ones, DIS-013 runs against 0.4 only (`expiryHorizonSeconds` is the one member 0.4 adds, 0.4 spec.md:156), and the response check rejects `expiryHorizonSeconds` in an answer given as 0.3. Not covered: the discoverer side (an implementation that sends discovery and must not act on an unauthenticated answer, discovery 0.4 conformance rules), answers in versions 0.1 and 0.2, per-entry `acceptanceWindow` and `requiredExt`.

### 11.3 HTTPS binding (BND)

An adapter declares the binding by listing `https` in `bindings`. A vector that exercises it `requires` `binding:https` and is SKIP, never failed, for an adapter that declares only `in-process`. The vectors send `http: {method?, path?}` with the document and read `transport.status`, `transport.contentType` and whether a body came back. The harness never speaks HTTP itself: the adapter performs the request, presenting the bearer token it holds for the identity in `from` (the token-to-VID map is deployment-defined, binding section 3), no header for `none`, and reports status and content type. Other vectors may also carry `http` and a status assertion (the 2PC vectors assert 202, 204, 409 and 503); the assertion applies only when the adapter declares `https`.

BND-001 (method and path, `bindings/https/0.3/spec.md:52`), BND-002 (bearer mapping, identityMismatch routed to the authenticated sender, :53, :124, :131; the token-to-VID mapping is deployment-defined, :129, so it needs `optional:transportIdentity`; the 422 and 200 are the status mapping's SHOULD, :135), BND-003 (no Authorization header, :53; an adapter whose deployment refuses it with 401 declares optional `binding.requireBearer` and gets SKIP), BND-004 (the 200 case, advisory as :135 is a SHOULD, and Content-Type, :161; no status code is asserted on an error; the tamper step changes /threadId, because no order is fixed between payload validation and the proof check, SPEC.md:1009-1023), BND-005 (completed duplicate under 200, :159), BND-006 (proof over the received object, :54), and BND-007 (the status table, :139-156, Tier 2 `attested`: the binding states the mapping as a SHOULD, and the vector asserts 400, 409 and the flat 422 bucket). Rows not covered: 403 `permissionDenied`, the stream and `text/event-stream` rows, the in-flight 202 and no-retained 204 rows (asserted inside 2PC-006 and 2PC-007), an unrecognised bearer token (the binding says both "no sender" and 401), and recipient mismatch as `identityMismatch` (the binding section 3 table) rather than `wrongRecipient` (framework 7.2 item 5; the status is 422 either way).

Not built: IDK and the roadmap families after the benchmark.

### 11.4 Ceremony documents (CER, 2PC-003 to 2PC-005, TIME-103)

Channels ([decision 39](decisions/04-ceremonies-governance-and-exceptions.md#d39), essential versus extended governance; the split is `ceremonyChannel` in `scripts/generate-vectors.ts`). The family is split three ways, and only the first part gates:

1. **`registry` (gating): what the framework states for any held task.** CER-001 (the hold is a next-step), CER-002 (a resubmitted begin while approvals are awaited), CER-005 (an exact duplicate after the commit is absorbed), CER-015 (the hold names a declared status task), and 2PC-006 and 2PC-007 (section 12: a lost reply after the commit, an outcome not yet known). The CER vectors among them reach their hold and their completion through `quorum` steps driven from the declared essential governance (below), so they make no quorum rule of their own.
2. **`candidate` (advisory): behaviour relative to the declared essential governance**, written "behaves per declared E" so that each runs at k = 1 as well as at larger k. CER-017: the ceremony completes exactly at the k-th distinct approval from the authority set, each earlier approval held with no effect. CER-018: an approval from outside the authority set is refused and not counted. CER-019: a repeat approval by the same member (a fresh document) is not counted as another member's (needs k of at least 2). They are `candidate`, not `registry`, because the ceremony family runs on the suite's synthetic `conformance/ceremony` types, which have no Trust Tasks home; their `localText` is this document (`suite:docs/04-suite-design.md`, so a change here is reported as spec drift).
3. **`proposed`, profile `ceremony-design` (advisory): the suite's own ceremony and two-phase design.** CER-003 (the response only once the effect exists), CER-004 (approval idempotence), CER-006 and CER-007 (the non-administrator refusal and its equality with a missing ceremony), CER-008 (`deadlineLapsed`), CER-009 (reset rules), CER-010 to CER-012 (a refused effect, an unknown outcome as `indeterminate`, `alreadyCommitted`), CER-013 (verbatim retention), CER-014 (the declared `proposerApproves`), CER-016 (the status query), 2PC-001 to 2PC-005 and 2PC-008 (section 12), and TIME-103 (the half-open deadline). The seven-day deadline, `deadlineLapsed`, an abort as non-retryable `taskFailed`, the closed `details.reason` vocabulary and a quorum of every named administrator are suite design, not framework text, so none of them gates. At a glance these vectors are a measure of their own, "Core, suite design (proposed, advisory)".

Tiers are unchanged by the split: CER-003, 008, 009, 014, 2PC-001, 004, 005 and TIME-103 stay in the Tier 2 sub-group `profile-ceremony`, and CER-004, 007, 010 to 013, 016 and 2PC-002, 008 stay CLARIFY (CER-011: SPEC.md 8.3 does not describe `indeterminate` for an unknown effect outcome). A tier says how strict a vector is; the channel says whether its result can gate.

**Essential governance drives the ceremony.** The adapter declares the platform's essential governance E (section 19): the authority set and `minApprovals` k. The suite never asserts what E should be. A vector step `quorum` (a pattern, one of `begin`, `rest`, `complete`, `pending`, `exact`, `outsider`, `repeat`) is expanded by the runner (`expandQuorum` in `src/runner/essential.ts`) into concrete sends from the declared authority set, in its declared order:

| Pattern | Expands to |
|---|---|
| `begin` | the begin, from the first member of the set (the proposer); held unless the begin alone completes the ceremony |
| `rest` | the approvals after the begin, from distinct members, up to the k-th: each earlier one held with no effect, the k-th answered with the response and the effect |
| `complete`, `exact` | `begin` followed by `rest`: completion exactly at the k-th distinct approval |
| `pending` | the begin and every approval before the k-th, each held: the ceremony is one approval short of k, and the k-th member decides next (the task-consent family, section 11.5) |
| `outsider` | the begin, an approval from a harness actor outside the set (refused, no effect), then the members' approvals up to the k-th |
| `repeat` | the begin, the first member's approval, the same member's approval again (a fresh document, still held), then the remaining members up to the k-th |

Where the adapter declares `proposerApproves: true` the begin counts as the proposer's approval, so the expansion sends one approval fewer. Steps that are not `quorum` steps name members by token, resolved against E: `E1` (the proposer, the first member), `EK` (the k-th member, whose approval completes the ceremony after a `pending` step), `EN` (a member other than the k-th) and `EO` (a harness actor outside the set); the same tokens with a `$` prefix give the member's DID. Harness actors `A`, `X`, `B`, `C`, `D`, `F`, `G` and `H` are available as members, `Q` (or the first free actor) as the outsider.

A vector with `quorum` steps is SKIP, before any step runs, with one of these reasons (`quorumGate`):

- "authority set of one": the vector needs two or more members (a token `EN`, or a member's approval before the deciding one) and the declared set has one (SKIP class not-applicable; the declared E in run.json is the evidence);
- "declared minApprovals of one": the set has more members but k = 1, so no approval precedes completion (not-applicable);
- "authority set unreadable", with the reason, for a vector that measures behaviour relative to E (`exact`, `outsider`, `repeat`) when the adapter states no readable E; the record carries GOV-NOT-PROBED (not-reached);
- "authority set not drivable by the harness": E names a principal that is not a harness actor (not-reached); "no harness actor outside the declared authority set" for `outsider` and `EO` (not-reached).

Where E is unreadable, the `registry` vectors (CER-001, 002, 005, 015 and the task-consent family) keep running on a two-member scenario, `A` and `X` with k = 2 (`LEGACY_SCENARIO`), because the framework hold rules they assert do not depend on who the approvers are; only the per-declared-E vectors SKIP.

**The adapter honesty check.** The harness verifies the declared E against behaviour with a probe of its own (`probeEssential`, `src/runner/honesty.ts`). It is not a vector: it runs in every suite run of an implementation, before any vector, whatever the vectors, channels, tier or exceptions selected, and the adapter cannot opt out of it. It resets the adapter before each check and reads only the count of establishing effects, leaving the shape of the replies to the vectors. Two checks:

- **completion-at-k**: the first member begins and distinct members approve in order; no effect may appear before the k-th distinct approval (the begin counting as one where `proposerApproves` is true), and the effect must appear at it. An effect earlier or later than the declared k is a mismatch.
- **outsider-not-counted** (run only when completion-at-k is consistent, otherwise not run): the ceremony is begun, a harness principal outside the declared set approves, then members approve up to the k-th; the effect must still come exactly at the k-th member. Where the begin alone completes the ceremony (k = 1 with a counted begin), the outsider sends the begin instead, and it must create no effect. For a declared set of one the outsider is the second distinct principal: a platform that lets a second principal decide when its adapter declares one does not match its declaration.

The result is `consistent`, `mismatch`, `not-probed` (E unreadable, or naming principals the harness cannot drive: GOV-NOT-PROBED) or `not-run` (the platform does not offer `optional:ceremony`, so there is no held task to probe; no finding). A **mismatch** is recorded as the finding GOV-DECLARATION-MISMATCH (docs/17; probe id `essential-declaration`) and FAILS the E family for that platform: every result of a vector with a `quorum` step (CER-001, 002, 005, 015, 017, 018, 019 and the task-consent vectors driven by the `pending` step) that was PASS, FAIL, KNOWN-FAIL, or SKIP for an E reason becomes FAIL with the reason "GOV-DECLARATION-MISMATCH: ...; was <old status>: <old reason>"; CLARIFY results and other SKIPs are unchanged. The run's exit code is non-zero on a mismatch whatever the channels selected. The outcome is in `results.json` (`essentialProbe`), in run.json (`implementations[].essentialProbe`, section 19), on a run-log line, and in the at-a-glance E label, which leads with the mismatch. The probe runs once per tier run; run.json keeps the first result.

Non-vacuity: the reference adapter has lying variants (`DECLARATION_LIES` in `src/adapters/reference/mutants.ts`, option `declarationLie`, adapter name `reference-lie-<id>`) that keep the declared E but behave otherwise: `completesEarly`, `completesLate` and `anyPrincipalDecides`. `test/honesty.test.ts` requires the honest reference at k = 1 to 4 to be consistent and every lie, and the quorum mutants `cerQuorumEarly` and `cerQuorumLate`, to be caught (mismatch, E family FAIL, finding, exit code). One case is indistinguishable by construction and is not claimed: `completesEarly` at k = 1 with a counted begin, where "early" and "on time" are the same send.

What the check does not show: it runs only where the adapter offers ceremonies. No VTI or keyring-wallet adapter offers `optional:ceremony`, so their declarations are recorded and shown but the check is not run for them.

The ceremony vectors run on a family of three tasks (and an optional fourth, the status task) every implementation that hosts founding-style ceremonies declares in `capabilities.ceremony`: `beginType`, `approveType`, `resetType` (Type URIs, registry or URN form), optionally `statusType` with `statusPayload`, a request payload template for each, and the declared boolean `proposerApproves` (below; required). Templates may use the DID of any harness actor (`$A`, `$X`, `$B` ...); where a begin carries its approvers, the adapter's begin template names the members of the authority set it declares in E (the reference's `admins`). The vectors build documents from the declaration with the templates `ceremony.begin`, `ceremony.approve`, `ceremony.reset`, `ceremony.status` and name types with `$cerType(begin|approve|reset|status)` and `$cerResponse(begin|approve|reset|status)`. Optional capabilities: `ceremony` (the family; without it every vector here is SKIP), `ceremony.status` (a status task exists and `statusType` is declared with it: CER-002 is SKIP, CER-015 and CER-016 run; without it they are SKIP and CER-002 runs; the runner refuses a declaration that has one without the other), `trigger.ceremonyDeadline`, `trigger.ceremonyEffect` (section 12.1), `observe.retained`. Hooks an implementation lacks give SKIP only for the vectors that need them.

What the vectors rely on (the reference adapter models it; an implementation maps its own tasks onto it):

- The ceremony id is the thread id; the begin document may use its own id as the thread.
- The begin issuer must be one of the administrators the begin names. The named administrators approve by an approve document in the ceremony's thread. Whether the begin itself counts as the proposer's approval is a declared property, `capabilities.ceremony.proposerApproves` (boolean, required; the capability `ceremony.proposerApproves`). `true`: the begin's issuer is recorded as approving, so the begin is the first of the k approvals. `false`: a begin records no approval and each member, the proposer included, approves by an approve document. A `quorum` step accounts for this itself. The `ceremony-design` vectors that are written with two administrators (`$A` begins, `$X` approves) carry a step marked `when: {proposerApproves: false}` (the proposer's own approval, sent by `$A` with a fresh document id) that runs only for an implementation that declares `false` and is skipped, keeping its position, otherwise (CER-003, 004, 006, 009 to 012, 2PC-003, 2PC-005, TIME-103), so both kinds of implementation reach the same states; their two-administrator quorum is suite design, which is why they are `proposed`. CER-014 checks that the declaration is true: it sends the other administrator's approval alone and expects completion (`true`) or a hold (`false`).
- The status task, where declared, is a read: a query in the ceremony's thread by an administrator is answered with a response of its own type (`$cerResponse(status)`), records no approval and runs no effect; a party that is not an administrator, or a query about a ceremony that does not exist, gets the same `permissionDenied` as for an approval. The content of the status response is the implementation's; no vector asserts it.
- A party that is not an administrator, and a ceremony that does not exist, get the same `permissionDenied` (CER-007 is CLARIFY).
- Quorum runs the establishing effect, a fixture (for example a uniquely named record). The response is answered only when the effect exists. The effect is observable as `stored` kind `ceremony-effect`; `handled` counts the same effects. A refused effect ends the ceremony failed; an effect whose outcome is unknown leaves it pending and is answered `indeterminate`.
- The deadline is half-open: an approval at or after it is refused (the ceremony becomes expired). The window is the implementation's (the reference defaults to seven days); `ceremonyDeadline` sets it so vectors need no long waits.
- A reset document is allowed only from a failed or expired ceremony and answered with a response; pending or committed ceremonies refuse it with no change (`taskFailed` or `permissionDenied`; CER-012 asserts the reason token).
- Repeating an approval is a no-op, also after the commit (CER-004, CLARIFY), and an exact duplicate is absorbed (CER-005).

The hold rule (`expect.hold`, used by every vector that expects a hold): the reply is a `trust-task-next-step` in the request's thread (a MUST). Its `inResponseTo` naming the request is a SHOULD, and so is `expects` naming the declared status task where the implementation declares one (SPEC.md 8.6; a `#request` fragment is tolerated); a mismatch of either is an advisory (section 3.2). Where no status task is declared, `expects` names the request's own Type URI and `continuation` is `resubmit` (or absent, its default); where one is declared, neither is asserted.

**Open question: `continuation` on a ceremony hold.** SPEC.md 8.6 (lines 1414 to 1417) requires a hold to be answered with a next step. Where the consumer offers no status task, the framework states the value: `expects` names the originating Type URI with `continuation: resubmit`, and a resubmission in the same thread is answered with the outcome, or a further next step while the act is awaited. Where the consumer does offer a task by which the producer can learn the outcome (a status task), the framework says only that `expects` names that task; it states no `continuation` value. The next-step payload schema defines `resubmit` (the default) as "the expected task is a prerequisite and the producer re-issues the originating request" and `proceed` as "the expected task is the continuation and the originating request is not re-issued" (`payload.schema.json:42`); a status task is neither a prerequisite for the begin nor a replacement for it, so neither value follows from the text. The framework therefore requires `resubmit` only where there is no status task, and that is all the vectors assert. An implementation that offers a status task and answers `proceed` (the truststackers adapter does) fails no vector; one that offers none and answers `proceed` fails CER-001. The question of which value a status-task hold should carry is a candidate task-force question and is not drafted or sent. The status-task side is exercised by CER-015 (the hold names the status task, the begin stays accepted) and CER-016 (the status query), which run only where `ceremony.status` is declared, the reciprocal of CER-002; the reference adapter's status variant answers the hold with `proceed` by default and is run with `resubmit` and with the member absent as well, all three passing.

### 11.5 Task consent and credential exchange (TC, CEX): layer 3b-DTG

These groups cover nine task versions of the DTG credential model that the framework does not reserve (docs/01 layer 3b-DTG): `task-consent/request` 0.1, `task-consent/decision` 0.2 and 0.1, `task-consent/granted` 0.1, `credential-exchange/issue` 0.1, `present` 0.1, `query` 0.1, `offer` 0.1 and `request` 0.1. They are informative until the DTG protocols specification exists, except where the task specification itself states a MUST. A vector therefore falls in one of three classes: it asserts a MUST of the task specification (Tier 1, gating); it asserts something the specification does not state (Tier 2 `attested`, or CLARIFY with the unsettled point named); or it asserts a shape the specification fixes in a schema (gating: `malformedRequest`). Every vector cites the task specification section it rests on, and is SKIP unless the implementation declares the task's Type URI in `supportedTypes` and the helper capabilities of section 4.4.

The groups are two families, `dtg-task-consent` and `dtg-credential-exchange`, each with its own matrix column.

**TC, decision (the implementation is the executor; the pending request is a held ceremony).** Needs `task-consent/decision/0.2`, `ceremony` and `trigger.consentBinding`. The pending request is a ceremony held one approval short of the declared k: every vector that needs it starts with a `pending` quorum step (section 11.4), which sends the begin and every approval before the k-th from the declared authority set, then reads the binding through `consentBinding`; the k-th member (`EK`) signs the decision under `assertionMethod` (the specification's producer rule 1). A vector that also needs another member (`EN`) or an outsider (`EO`), (TC-006, TC-009, TC-018), takes it from E as well. The family therefore runs under any declared E, k = 1 included, or is SKIP with the essential-governance reasons of section 11.4 ("authority set of one" where a vector needs a second member); where E is unreadable it runs on the two-member scenario `A`, `X`, k = 2. These vectors stay `registry`: what they assert is task-consent specification text, not the quorum, and they rest on E, so a declaration mismatch of the honesty check turns their results to FAIL.

| ID | Asserts | Class |
|---|---|---|
| TC-001 | the decision echoing challenge and digest completes the quorum: a response of the decision type, status `granted`, the echoed digest, and the effect exists | Tier 1 |
| TC-002 | proof purpose `authentication` is refused (consumer 1) | Tier 1 |
| TC-003 | unknown `payloadDigest` is `task-consent/decision:noPending` (consumer 2) | Tier 1 |
| TC-004 | wrong `challenge` is `:challengeMismatch` (consumer 3) | Tier 1 |
| TC-005 | `actionId` naming another action is `:actionMismatch` (consumer 4) | Tier 1 |
| TC-006 | a signer outside the approver set is `:notAnApprover` and records nothing; the approver's own decision still completes the quorum (consumer 5) | Tier 1 |
| TC-007 | evidence that does not verify is `:evidenceInvalid` (consumer 7) | Tier 1 |
| TC-008 | a decision outside the enum, an unknown member, evidence outside the tagged union: `malformedRequest` (the specification's `payload.invalid-examples.json`) | Tier 1 |
| TC-009 | a denial is answered `denied` and closes the request for every approver: a later approval is refused and runs no effect (consumer 9) | Tier 1 |
| TC-010 | a decision without a proof is `proofRequired` | Tier 1 |
| TC-011 | an approval repeated after the commit runs no second effect and is answered like the first (consumer 10 against `noPending`) | CLARIFY |
| TC-018 | a decision short of the quorum is answered with the `pending` status or with a `trust-task-next-step` hold (the hold rule of framework 8.6 is checked; either form passes); a repeat by the same approver is not another approver's approval (consumer 10) | CLARIFY |

**TC, request (the implementation is the approver device).** Needs `task-consent/request/0.1` and `trigger.consentEnrol`; each vector first enrols executor A.

| ID | Asserts | Class |
|---|---|---|
| TC-012 | a request from an enrolled executor is answered `#response` with status `prompted` and one prompt is raised (the device refuses `notEligible` when it is not in the named `approverSet`, which the policy sets and the harness does not declare) | CLARIFY vector-overreads |
| TC-013 | an executor the device is not enrolled with: `task-consent/request:untrustedIssuer`, no prompt (consumer 1) | Tier 1 |
| TC-014 | no proof: `proofRequired`, no prompt | Tier 1 |
| TC-015 | `expiresAt` passed: no prompt, `expired` (the specification also allows status `refused`) | CLARIFY |
| TC-016 | the device is the requester and `excludeRequester` is set: `task-consent/request:notEligible`, no prompt (consumer 6) | Tier 1 |
| TC-017 | effects missing, challenge under 128 bits, unknown member, `minApprovals` 0: `malformedRequest`, no prompt | Tier 1 |

**CEX, issue (the implementation is the holder).** Accepted is silence, because the task defines no response document (`credential_response` is the OID4VCI answer carried to the holder, and nothing answers the delivery); the durable record is observed as `stored credential`.

| ID | Asserts | Class |
|---|---|---|
| CEX-001 | a cleartext credential from its issuer to its subject is accepted and kept (no reply, or the empty courtesy acknowledgement of SPEC.md 4.4.2) | Tier 1 |
| CEX-002 | neither member, and both members: `malformedRequest` | Tier 1 |
| CEX-003 | a credential whose issuer signature does not verify (flipped proof; proof by another key) is refused and not kept | Tier 1 |
| CEX-004 | a sealed bundle the holder cannot process or open: `unsupportedFormat` or `unopenableBundle`, nothing kept | Tier 1 |
| CEX-005 | a compact-string credential that does not verify is refused and not kept | Tier 1 |
| CEX-006 | no proof: `proofRequired` | Tier 1 |
| CEX-007 | `credential_response` as a string, empty `sealed`, an unknown member: `malformedRequest` | Tier 1 |
| CEX-008 | the same credential in a second document is kept once | CLARIFY |
| CEX-009 | a credential proof with purpose `authentication` is refused | CLARIFY |
| CEX-010 | a credential about another party than the holder is refused (the specification leaves acceptance to the consumer) | Tier 2 `attested` |

**CEX, present (the implementation is the verifier).** Needs `trigger.presentationNonce`. The proof of the presentation carries the nonce as `challenge` and the audience as `domain`. The specification names the members "nonce and domain" without fixing the member name, and leaves the source of the nonce (a query task) outside this suite, so the nonce and audience vectors are CLARIFY.

| ID | Asserts | Class |
|---|---|---|
| CEX-011 | a presentation bound to the issued nonce and to the verifier, by the holder, over a genuine credential, is accepted and kept | CLARIFY |
| CEX-012 | an unissued nonce: `credential-exchange/present:staleNonce` | CLARIFY |
| CEX-013 | another audience: `:audienceMismatch` | CLARIFY |
| CEX-014 | a nonce is good once: a second presentation with it is `:staleNonce` | CLARIFY |
| CEX-015 | a presented credential whose issuer signature does not verify is refused and not kept | Tier 1 |
| CEX-016 | `vp_token` a number, an array, absent, or an unknown member: `malformedRequest` | Tier 1 |
| CEX-017 | a presentation by a holder that is not the sender is refused | Tier 2 `attested` |
| CEX-018 | a presented credential about another party than the holder is refused | Tier 2 `attested` |

**TC, decision 0.1 (the implementation is the executor).** Needs `task-consent/decision/0.1`, `ceremony` and `trigger.consentBinding`, as for 0.2. Version 0.1 has a closed payload without the `evidence` and `actionId` members that 0.2 added.

| ID | Asserts | Class |
|---|---|---|
| TC-021 | a 0.1 decision under `assertionMethod`, echoing the challenge and digest of the pending request, completes the quorum: a response of the 0.1 decision type, status `granted` | Tier 1 |
| TC-022 | a 0.1 decision with a challenge other than the one issued: `task-consent/decision:challengeMismatch` | Tier 1 |
| TC-023 | a 0.1 decision without a proof: `proofRequired`, nothing recorded | Tier 1 |
| TC-024 | a 0.1 decision carrying `evidence` or `actionId` (members added in 0.2): `malformedRequest` | Tier 1 |

**TC, granted 0.1 (the implementation is the requester device).** Needs `task-consent/granted/0.1`. The notice tells a requester that its consent was granted; the text has it dropped silently when nothing is pending for the digest.

| ID | Asserts | Class |
|---|---|---|
| TC-019 | a granted notice for a `payloadDigest` with no pending task is dropped silently, never answered with an error | Tier 1 |
| TC-020 | a notice the schema does not allow (status other than `granted`, no `payloadDigest`, no `taskType`, an unknown member) is refused or ignored and changes nothing | Tier 1 |

**CEX, query (the implementation is the holder).** Needs `credential-exchange/query/0.1`; `trigger.holdCredential` and `observe.deferred` where declared (section 4.4). A query whose verifier the holder does not pre-trust is deferred for its human; the text asks for the verifier to be told `consentRequired`, and also for a held-but-not-consented credential to be indistinguishable from no match. Those two rules cannot both hold, so the vector that checks indistinguishability is CLARIFY, and "silence for both" is reported as observed rather than failed. The proof of a query is OPTIONAL.

| ID | Asserts | Class |
|---|---|---|
| CEX-019 | a `purpose` missing, empty, not a string or over 500 characters: `malformedRequest`, nothing deferred | Tier 1 |
| CEX-020 | a payload the schema does not allow (no `dcql_query`, no or empty `nonce`, `dcql_query` not an object, an unknown member): `malformedRequest`, nothing deferred | Tier 1 |
| CEX-021 | a query naming no credential type contributes no candidates (no wallet enumeration): nothing presented, nothing deferred | Tier 1 |
| CEX-022 | a held credential, a verifier not pre-trusted: the query is deferred, the verifier told `credential-exchange/query:consentRequired`, nothing presented | Tier 1 |
| CEX-023 | a type the holder does not hold: `credential-exchange/query:noMatch`, nothing deferred | Tier 1, CLARIFY spec-inconsistent (the same tension as CEX-024) |
| CEX-024 | held-but-not-consented and not held get the same refusal | CLARIFY (the text's two rules conflict) |
| CEX-025 | a pre-trusted verifier is answered at once on the query's thread, bound to its nonce and to the verifier (needs `trigger.verifierTrust`) | CLARIFY |
| CEX-026 | an approved deferral is presented on the query's own thread with its nonce and the verifier as audience (needs `trigger.queryDecision`) | CLARIFY |
| CEX-027 | a query without a proof is not refused for that, and is deferred like a signed one | Tier 1 |

**CEX, offer (the implementation is the holder) and request (the implementation is the issuer).** Need `credential-exchange/offer/0.1` and `credential-exchange/request/0.1`.

| ID | Asserts | Class |
|---|---|---|
| CEX-028 | an offer payload the schema does not allow: `malformedRequest` | Tier 1 |
| CEX-029 | an offer naming only configurations the holder cannot accept is answered `credential-exchange/offer:unsupportedCredential`, not abandoned (a SHOULD) | CLARIFY |
| CEX-030 | a request payload the schema does not allow: `malformedRequest` | Tier 1 |
| CEX-031 | a request for no offer the issuer made: `credential-exchange/request:unknownOffer` (or `invalidProof`), nothing issued | Tier 1 |
| CEX-032 | a request without a document proof: `proofRequired`, nothing issued | Tier 1 |

**CEX, answered by a pushed document (file `vectors/dtg/cex-push.json`, docs/20).** Need `observe.pushed`; the kit specs are status draft.

| ID | Asserts | Class |
|---|---|---|
| CEX-033 | an accepted offer is answered by a `request` pushed to the issuer on the offer's thread | CLARIFY |
| CEX-034 | a refused offer (no supported configuration) is not also followed by a pushed `request` | CLARIFY |
| CEX-035 | a request on the thread of an offer the issuer made (`trigger.makeOffer`) is answered by an `issue` pushed to the holder on that thread, issued by the implementation | CLARIFY |
| CEX-036 | a request for no offer the issuer made is refused and no `issue` is pushed | Tier 1 |
| CEX-037 | an approved deferred query is answered by a `present` pushed to the verifier on the query's thread, bound to its nonce and the verifier | CLARIFY |
| CEX-038 | a declined deferred query pushes nothing | Tier 1 |
| CEX-039 | two offers on two threads are each answered on their own thread (correlation by thread id) | CLARIFY |

Observed: no step of these vectors needs clock control, so an implementation whose clock cannot be set measures all of them (section 7). Not covered: the `sealed` path of `issue` beyond a refusal, SD-JWT-VC credentials and presentations (string members), WebAuthn and `approverSigned` evidence that verifies, VTC `actionId`, `excludeRequester` on the decision, the holder surfacing a query's `purpose` to its human or binding it to the consent record (no black-box observation exists), the query rate and deferral bounds (SHOULD; no vector), and the initiating side of every task (a task the implementation only sends has no vector: the adapter contract is receive and reply).

### 11.6 Ceremony receipts (RCPT): layer 3b, optional

This group covers `trust-ceremony-receipt` 0.1 (framework-reserved slug, layer 3b; docs/01, docs/02). The specification has no wire output for the verifier (no response type, no error codes: `errorCodes: []`, spec.md:44), so the group measures the verifier rules (spec.md:126-138) through the optional adapter method `verifyReceipt` (section 4.2), declared by the optional capability `receiptVerify`. A vector is SKIP for an implementation that does not declare it; the group never touches the carrier, the clock of the implementation beyond proof freshness, or any state another vector observes. The family is `ceremony-receipt`; the file is `vectors/ceremony-receipt/rcpt.json`.

**Scenario.** A `verifyReceipt` step names a scenario that the runner builds (`src/runner/receipt.ts`): one of three fixture ceremony definitions in the registry's shape (`ceremonies/ceremony.meta.schema.json`) on a private authority, a signed enactment of it (step documents that carry the `ceremony` member with `enactment`, `step`, `definitionDigest`, `round`, `terminal` and `prev`), the receipt a recorder issued for it, and what the verifier holds (the resolved definition, the role bindings, some or all of the step documents). Every deviation a vector names is applied by the builder; ids, salt and signatures are deterministic for a run salt (section 7).

| Fixture | Steps | Completion | Terminal |
|---|---|---|---|
| `linear` | `apply`, optional `review`, `decide` | `allOf` apply, decide | `decide` |
| `approve` | `propose`, `approve` (perRole, `maxRounds` 2) | `threshold` 2 `ofStep` approve | `approve` |
| `prefix` | `open`, `middle`, optional `end` | `allOf` open, middle | `end` (not needed by the completion rule) |

Every fixture names two recorder roles, so a receipt by the second recorder is a valid case. Role bindings: `A` initiator or proposer, `X` reviewer or first approver, `S` second approver, `W` and `Q` the recorders.

**Verdicts.** `complete`, `incomplete`, `unverifiable`, `invalid` (section 4.2). The specification fixes three distinctions and the group pins only those: a receipt the verifier rejects (`invalid`: spec.md:131, 133, 134, 136, 137), a receipt it could not verify and must say so (`unverifiable`: unresolvable or mismatching definition, spec.md:129 and 162; role bindings not available, spec.md:135; no terminal step document held, spec.md:134 and 140), and an enactment that is not complete (`incomplete`). Where the text allows more than one verdict a vector lists the accepted ones (for example a prefix is `incomplete` or `invalid`); a positive vector accepts `complete` only.

**Tiers.** Every vector is Tier 1 and asserts a MUST of the receipt specification, or of the framework rule the specification applies (SPEC.md 7.2 items 2, 3 and 7, 4.7, 5.2, 6.7 and the unrecognised-member rule), cited by file and line in the vector's `spec` list. There is no Tier 2 and no named profile in the group: nothing in it is stricter than the specifications. Every point the text leaves open is CLARIFY (never gating) with the open point named in `clarify`: whether a recorder that says incomplete over complete steps is reported as complete or invalid, the hash function a verifier must support, what a verifier does when the salt is absent, a held step without a proof, a receipt addressed to another party (bearer, spec.md:150-154, against SPEC.md 7.2 item 5), the receipt's own `threadId` and the steps' threads, a `parentEnactment` equal to the enactment, a re-presented receipt, and three checks the schema descriptions imply but no verifier rule states (an undeclared step name, a `typeUri` that differs from the definition's, a round beyond `maxRounds`).

**Reference verifier and mutants.** `src/adapters/reference/receipt-verifier.ts` implements rules 1 to 11 over the data it is given. Each of 29 mutants (`rcpt*`) switches one rule off (proof not verified, definition digest not compared, salt as prefix, task digest instead of step digest, no de-duplication, `payload.complete` trusted, the terminal echo trusted, bindings assumed, chain not walked, and so on). Every negative vector names the mutants that make it fail, and the non-vacuity check runs each against its vector; a positive vector can name one too (the second recorder).

Not covered: nested ceremonies (not required of a verifier, spec.md:146), `maxDuration` (not evaluable from a receipt, spec.md:147), `enactmentPrivacy: blinded` (the receipt cannot express it), the recorder side (how a recorder learns the steps and what it does on failure), the `ceremony` member on ordinary documents (CRM, section 11), and the evidence for a failed, aborted or expired enactment (undefined by the specification). The VTI, keyring-wallet and truststackers adapters do not declare `receiptVerify`, so the group is SKIP for them.

| ID | Asserts | Class | Spec (first entries) |
|---|---|---|---|
| RCPT-001 | a conforming enactment with every step document held verifies complete | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:119-124; specs/trust-ceremony-receipt/0.1/spec.md:128-138 |
| RCPT-002 | an enactment of perRole steps that meets a threshold verifies complete | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:131; specs/trust-ceremony-receipt/0.1/spec.md:132 |
| RCPT-003 | an optional step that did not happen is not required for completion | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:132; ceremonies/ceremony.meta.schema.json:182 |
| RCPT-004 | a verifier holding only the terminal step document verifies complete; a predecessor it does not hold is not a failure | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:137; specs/trust-ceremony-receipt/0.1/spec.md:134 |
| RCPT-005 | a receipt issued by the second recorder the definition names verifies | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:130; specs/trust-ceremony-receipt/0.1/spec.md:80 |
| RCPT-006 | an unrecognised top-level member on the receipt is preserved and not acted on | Tier 1 | SPEC.md:1067; specs/trust-ceremony-receipt/0.1/spec.md:128 |
| RCPT-007 | an unrecognised ext namespace in the receipt payload is ignored | Tier 1 | SPEC.md:1069; specs/trust-ceremony-receipt/0.1/payload.schema.json:97-99 |
| RCPT-008 | invalid payload: Empty payload omits required members: enactment, definition, definitionDigest, complete, steps. | Tier 1 | specs/trust-ceremony-receipt/0.1/payload.invalid-examples.json:3; specs/trust-ceremony-receipt/0.1/payload.schema.json:8-14 |
| RCPT-009 | invalid payload: steps must have at least one entry. | Tier 1 | specs/trust-ceremony-receipt/0.1/payload.invalid-examples.json:7; specs/trust-ceremony-receipt/0.1/payload.schema.json:45-48 |
| RCPT-010 | invalid payload: definition is omitted. | Tier 1 | specs/trust-ceremony-receipt/0.1/payload.invalid-examples.json:17; specs/trust-ceremony-receipt/0.1/payload.schema.json:26-31 |
| RCPT-011 | invalid payload: definitionDigest is raw hex rather than a multibase-encoded multihash. | Tier 1 | specs/trust-ceremony-receipt/0.1/payload.invalid-examples.json:34; specs/trust-ceremony-receipt/0.1/payload.schema.json:32-35 |
| RCPT-012 | invalid payload: A step omits digestMultibase. | Tier 1 | specs/trust-ceremony-receipt/0.1/payload.invalid-examples.json:52; specs/trust-ceremony-receipt/0.1/payload.schema.json:52-58 |
| RCPT-013 | invalid payload: A step omits id, so a verifier cannot locate the document the digest is over. | Tier 1 | specs/trust-ceremony-receipt/0.1/payload.invalid-examples.json:69; specs/trust-ceremony-receipt/0.1/payload.schema.json:52-58 |
| RCPT-014 | invalid payload: round must be at least 1; round 0 is not a repetition. | Tier 1 | specs/trust-ceremony-receipt/0.1/payload.invalid-examples.json:86; specs/trust-ceremony-receipt/0.1/payload.schema.json:65-69 |
| RCPT-015 | invalid payload: A step carries an unknown member (additionalProperties: false). | Tier 1 | specs/trust-ceremony-receipt/0.1/payload.invalid-examples.json:105; specs/trust-ceremony-receipt/0.1/payload.schema.json:51 |
| RCPT-016 | invalid payload: salt is too short to carry 128 bits of entropy in any multibase encoding. | Tier 1 | specs/trust-ceremony-receipt/0.1/payload.invalid-examples.json:124; specs/trust-ceremony-receipt/0.1/payload.schema.json:40-44 |
| RCPT-017 | invalid payload: complete must be a boolean, not a string. | Tier 1 | specs/trust-ceremony-receipt/0.1/payload.invalid-examples.json:143; specs/trust-ceremony-receipt/0.1/payload.schema.json:36-39 |
| RCPT-018 | invalid payload: Unknown top-level member is rejected (additionalProperties: false). | Tier 1 | specs/trust-ceremony-receipt/0.1/payload.invalid-examples.json:161; specs/trust-ceremony-receipt/0.1/payload.schema.json:7 |
| RCPT-019 | invalid payload: ext immediate keys must be reverse-DNS namespaced per SPEC §4.5.1. | Tier 1 | specs/trust-ceremony-receipt/0.1/payload.invalid-examples.json:180; specs/trust-ceremony-receipt/0.1/payload.schema.json:97-99 |
| RCPT-020 | a receipt of another MAJOR version of the type is rejected | Tier 1 | SPEC.md:756; SPEC.md:1013 |
| RCPT-021 | a document whose type is rooted at /ceremony/ is not a receipt | Tier 1 | SPEC.md:980 |
| RCPT-022 | a receipt without a proof is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:24-31; specs/trust-ceremony-receipt/0.1/spec.md:119 |
| RCPT-023 | a receipt whose signature does not verify is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:128; SPEC.md:1017 |
| RCPT-024 | a receipt signed by a key that is not its issuer's is rejected | Tier 1 | SPEC.md:305; specs/trust-ceremony-receipt/0.1/spec.md:128 |
| RCPT-025 | a receipt whose step digest was changed after signing is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:128; SPEC.md:309 |
| RCPT-026 | a receipt from which an enumerated step was removed after signing is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:128; SPEC.md:309 |
| RCPT-027 | a receipt issued by a party the definition does not name as recorder is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:119-120; specs/trust-ceremony-receipt/0.1/spec.md:130 |
| RCPT-028 | without the enactment's role bindings the verifier reports it could not verify | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:135; specs/trust-ceremony-receipt/0.1/spec.md:130 |
| RCPT-029 | a step issued by a party not bound to the step's issuer role is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:135 |
| RCPT-030 | a held step addressed to a party not bound to its recipient role is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:135 |
| RCPT-031 | an unresolvable definition: the verifier could not verify, the receipt is not invalid | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:129; specs/trust-ceremony-receipt/0.1/spec.md:162 |
| RCPT-032 | a resolved definition that is not the pinned one cannot verify the receipt, however complete it would make it look | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:129; specs/trust-ceremony-receipt/0.1/spec.md:91 |
| RCPT-033 | a step that pins another definition is a step of another ceremony | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:136; specs/trust-ceremony-receipt/0.1/spec.md:121 |
| RCPT-034 | the same step document enumerated twice is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:131; SPEC.md:174 |
| RCPT-035 | two documents for one step at one round are rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:131 |
| RCPT-036 | one approver's approvals listed twice do not reach a threshold | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:131 |
| RCPT-037 | a threshold the enumerated steps do not meet is not complete, whatever complete says | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:132; specs/trust-ceremony-receipt/0.1/payload.schema.json:36-38 |
| RCPT-038 | a recorder that says incomplete over steps that satisfy the rule | CLARIFY | specs/trust-ceremony-receipt/0.1/spec.md:132; specs/trust-ceremony-receipt/0.1/payload.schema.json:38 |
| RCPT-039 | a receipt enumerating no terminal step is a prefix, not complete | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:88; specs/trust-ceremony-receipt/0.1/spec.md:133 |
| RCPT-040 | a recorder that leaves the terminal step out of the receipt gives a prefix even where the verifier holds the terminal document | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:88-91; specs/trust-ceremony-receipt/0.1/spec.md:133 |
| RCPT-041 | terminal echoed on a step the definition does not declare terminal is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:133 |
| RCPT-042 | with the terminal step document not held the verifier reports it could not verify completion | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:134; specs/trust-ceremony-receipt/0.1/spec.md:140 |
| RCPT-043 | holding no step document the verifier reports it could not verify completion, not that the enactment completed | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:140 |
| RCPT-044 | a terminal echo the held document contradicts is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:134; specs/trust-ceremony-receipt/0.1/spec.md:88-91 |
| RCPT-045 | a held terminal document without the marker is not complete even where the receipt does not echo it | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:134 |
| RCPT-046 | a digest computed with the salt as a prefix is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:109; specs/trust-ceremony-receipt/0.1/spec.md:98 |
| RCPT-047 | a digest computed without the document's proof (the task digest) is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:103-105; SPEC.md:559 |
| RCPT-048 | a held step document altered after the receipt enumerated it is rejected even when its issuer signed the alteration | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:136 |
| RCPT-049 | a held step document signed again with the same content is another document | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:103-105; specs/trust-ceremony-receipt/0.1/spec.md:136 |
| RCPT-050 | a receipt that carries a salt other than the one the digests used is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:107; specs/trust-ceremony-receipt/0.1/spec.md:136 |
| RCPT-051 | a receipt whose digests use another multihash function | CLARIFY | specs/trust-ceremony-receipt/0.1/spec.md:108 |
| RCPT-052 | a receipt without a salt where the steps carry prev | CLARIFY | specs/trust-ceremony-receipt/0.1/spec.md:123; specs/trust-ceremony-receipt/0.1/payload.schema.json:40-44 |
| RCPT-053 | a step document of another enactment is rejected: replay of a step into this receipt | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:136 |
| RCPT-054 | a receipt that reports another enactment than the steps it enumerates is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:136; specs/trust-ceremony-receipt/0.1/spec.md:121 |
| RCPT-055 | an earlier enactment's receipt presented with the documents of a later one is not complete | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:136; specs/trust-ceremony-receipt/0.1/spec.md:140 |
| RCPT-056 | a held step document that names another step than the receipt enumerates is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:136 |
| RCPT-057 | a held step document at another round than the receipt enumerates is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:136 |
| RCPT-058 | a held step that follows a document the receipt does not enumerate shows an omitted step | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:137; specs/trust-ceremony-receipt/0.1/spec.md:74 |
| RCPT-059 | a predecessor whose digest differs from the one the successor committed to is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:137 |
| RCPT-060 | a predecessor that is not an ancestor of the step in the definition is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:137 |
| RCPT-061 | a held step document whose own proof does not verify is rejected | Tier 1 | specs/trust-ceremony-receipt/0.1/spec.md:138 |
| RCPT-062 | a held step document without a proof | CLARIFY | specs/trust-ceremony-receipt/0.1/spec.md:103; specs/trust-ceremony-receipt/0.1/spec.md:138 |
| RCPT-063 | a receipt addressed to another party | CLARIFY | specs/trust-ceremony-receipt/0.1/spec.md:150-154; SPEC.md:1015 |
| RCPT-064 | a receipt that carries a threadId no step has | CLARIFY | SPEC.md:649; specs/trust-ceremony-receipt/0.1/spec.md:17-23 |
| RCPT-065 | steps of one enactment that share a single threadId | CLARIFY | SPEC.md:649 |
| RCPT-066 | a receipt whose parentEnactment is its own enactment | CLARIFY | SPEC.md:658; specs/trust-ceremony-receipt/0.1/payload.schema.json:21-25 |
| RCPT-067 | the same receipt presented twice verifies the same way both times | CLARIFY | specs/trust-ceremony-receipt/0.1/spec.md:34; specs/trust-ceremony-receipt/0.1/spec.md:152 |
| RCPT-068 | a step name the definition does not declare | CLARIFY | specs/trust-ceremony-receipt/0.1/payload.schema.json:60-64; specs/trust-ceremony-receipt/0.1/spec.md:131-133 |
| RCPT-069 | a step whose typeUri differs from the one the definition declares | CLARIFY | specs/trust-ceremony-receipt/0.1/payload.schema.json:70-74; specs/trust-ceremony-receipt/0.1/spec.md:131-133 |
| RCPT-070 | a step at a round beyond the definition's maxRounds | CLARIFY | specs/trust-ceremony-receipt/0.1/payload.schema.json:65-69; ceremonies/ceremony.meta.schema.json:190 |

### 11.7 Plain tasks (family `plain`, groups PP-ACL, PP-POL, PP-VLT, PP-DEV, PP-AUT): layer 3a, proposed 2L-1 and 2L-2, not core

A bundle-driven probe (`vectors/plain/`, run with `--vectors vectors/plain`, generated by `scripts/generate-plain.ts`). It needs no change to the adapter contract (a plain request-and-reply task is sent and its reply observed). Every rule is read from the registry package the suite already depends on, `@openvtc/trust-tasks` 0.29.0 (every registry specification is status draft): each task version's `PAYLOAD_SCHEMA`, `RESPONSE_PAYLOAD_SCHEMA` and `SPEC` policy (`isProofRequired`, `isRecipientRequired`, `isIssuedAtRequired`), with the framework 7.2 pipeline for the error codes. 160 task versions of the acl, policy, vault, device and auth families are in the package; 151 have a buildable minimal request payload and get vectors (the other 9 are listed in `vectors/plain/not-generated.json`: a generator limit, not an implementation result). It is a separate family and manifest, so the core counts do not change.

Per task version, up to four vectors: P (payload schema: a missing required member, an unknown member in a closed payload, a wrong type are `malformedRequest`), E (the declared policy: no recipient is `malformedRequest`, no proof is `proofRequired`; SPEC.md 7.2 items 5 and 7), I (no `issuedAt` where required: any refusal; CLARIFY because no consumer rule names the code, inference from the pinned runtime), A (a schema-valid, signed, addressed request is not refused for an envelope code, and a response conforms to the response schema; new disposition `answered` with `plainType`). `malformedRequest` for a schema-valid payload is an advisory. The generator is a small JSON Schema subset validator and instance generator (`src/plain/schema.ts`; the runtime bundles none by design).

Governance: the vectors fix no role, role meaning or authority rule (docs/02 section 5.1). `Capabilities.governance.roles` with the optional capability `governance.roles` supplies role values (`$role(n)`); `governance.content` gates `policy/upsert`. Without them the vectors are SKIP, "governance not declared".

A `malformedRequest` answer to a schema-valid payload is an envelope-neutral refusal that the text permits where the payload schema admits `ext`: a consumer MAY require its own `ext` namespace and then rejects a document lacking it with `malformedRequest` (SPEC.md:246, :1069), and MAY reject a non-canonical VID-typed member the same way (SPEC.md:388). It is recorded as a note and is never escalated on the attested profile; an envelope code stays a failure, and a payload schema without `ext` keeps the SHOULD. The generated input gives a member whose description opens with a DID or VID phrase a DID.

The reference adapter serves these tasks (option `plain`, default true) and has the mutants `recipientOptional` and `plainBadResponse` in addition to the existing ones; non-vacuity is checked in `test/plain.test.ts`. Results: `<results dir>/runs/2026-11-15-plain-probe/`.

### 11.8 Producer (emit) class (family `emit`, groups EM-ACL, EM-POL, EM-VLT, EM-DEV, EM-AUT, EM-KEY, EM-PSH): layer 3a, not core

Today a vector sends a document and observes the reply, so a task an implementation only sends (a wallet's `acl/grant`, `device/heartbeat`) is out of reach. The producer class adds one optional adapter method and one optional capability:

| Item | Meaning |
|---|---|
| Optional capability `emit` | The adapter implements `emit`. |
| `Capabilities.emits` | The Type URIs (request form) the adapter can emit. A vector whose type is not listed is SKIP, "type not emitted", never a pass. |
| `emit` `{type, args?}` result `{documents[]}` | Drive the implementation's own builders (the code that builds and signs that document in normal operation) and return the document, unsent and unedited. `args.recipient` is a hint (a harness actor VID); every other input the real builder needs is the adapter's choice. |

A vector step is `emit: {type, args}` with `expect.disposition` `emitted` and `plainType`. The harness checks the document with the pinned package, from the same sources as 11.7: the type is the one asked; the id exists; the payload satisfies the payload schema; recipient, proof and issuedAt are present where the specification declares them REQUIRED; a proof-bearing document of a non-bearer task names a recipient (7.2 item 8); a proof by a did:key issuer verifies; a non-whole-second `issuedAt` is an advisory. It does not check what the document asks for or whether anyone is authorised to ask (docs/02 section 5.1). 183 vectors (one per task version of the 7 families acl, policy, vault, device, auth, keys, push); generated by `scripts/generate-emit.ts`; run with `--vectors vectors/emit`. Mutants of the reference (`emitBadPayload`, `emitNoProof`, `emitNoRecipient`, `emitNoIssuedAt`) are caught.

**Contract addition for the project owner's review.** `emit`, `Capabilities.emits` and the `emit` vector step are an addition to the adapter contract, not yet reviewed by the project owner. The pinned package declares no thread policy, so thread is not checked. The result carries the documents and an optional `standIn` list: notes naming any part of the document the implementation did not build or sign itself (class D). The harness records each note as an advisory next to the result and it never changes PASS or FAIL. The keyring-wallet adapter uses it for `auth/oob/grant` and `identify`, which the member's agent signs (a stand-in agent signs them in the test host). It also uses it for `acl/swap-key` 0.1 (stand-in successor key, mediator and store).

keyring-wallet: the jest host builds the wallet's own `VtaClient` over a capturing session (`sendTo` records the document and throws) and emits the types the wallet's source names through its original request builders (`src/adapters/keyring-wallet/kw-host.jest.ts`, `emitters.ts`): 13 types at first, now 50 of the 183 `vectors/emit` vectors and 67 of the 75 `vectors/emit-more` vectors (the vta, vtc, vetting, rooms, provision, config and task-consent families). The pinned package does ship `vtc/join-requests` schemas (an earlier version of this paragraph said it did not; that was wrong), and all 8 of those vectors the wallet emits ran and PASS. Results: `<results dir>/runs/2026-11-15-kw-emit/`, `<results dir>/runs/2026-11-15-kw-emit-more/`, and the merged-tree re-run `<results dir>/runs/2026-11-15-integration-keyring-wallet/`.

VTI: the VTI emit adapter (`src/adapters/vti-emit/`, docs/19) builds the documents with VTI's own client crates (`vta-sdk` `VtaClient` and `vtc-client` `VtcClient`) over a capturing endpoint; the types it cannot build are SKIP with a stated reason. Its figures are generated: results/README.md, Coverage. The second-layer vectors (`vectors/2l`: probe `TL-*` and emit `TE-*`; all `proposed`, advisory; docs/19) are measured the same way and never added to the core, plain, emit or emit-more figures.

## 12. Two-phase commit to lifecycle mapping (built)

Some implementations run a ceremony internally as a two-phase commit (2PC) over TSP (layer 2). The suite never sees it; it sees documents. The mapping below is the suite's design for the boundary of such an implementation. Only what the framework states for any task gates: the hold as a next-step (CER-001, 002, 015), duplicate absorption after the commit and while the outcome is unknown (2PC-006, 2PC-007, CER-005). The rest of the table (the response only once the effect exists, an abort as non-retryable `taskFailed`, the closed `details.reason` vocabulary, the deadline and `deadlineLapsed`, the reset rules, fail-closed on an unreadable duplicate record) is suite design: the vectors that pin it (2PC-001 to 005, 2PC-008, CER-003, 008 to 012, TIME-103) are channel `proposed`, profile `ceremony-design`, advisory ([decision 39](decisions/04-ceremonies-governance-and-exceptions.md#d39), section 11.4).

| Document step | Internal fact | Lifecycle (framework 4.12) and wire reply |
|---|---|---|
| Passes the pipeline; duplicate record written | before the transaction begins | `accepted`; no reply yet |
| More approvals needed, or consent required | proposal pending, transaction not finished | `accepted` and blocked; `trust-task-next-step` (framework 8.6): where the implementation offers no status task, `expects` names the originating Type URI with `continuation: "resubmit"`; where it offers one, `expects` names it and the `continuation` value is an open question (section 11.4) |
| All participants voted yes **and** the coordinator's outcome is `committed`, read from the outcome, not from a "yes" vote | effect exists | `responded`: `<request>#response`, signed, carrying the binding (for example the digest of the stored credential) |
| A vote `no`, or the transaction aborted | proposal failed with a reason | `errored`: `trust-task-error`, `taskFailed`, `details.reason` from a closed vocabulary, `retryable` explicit |
| Ceremony deadline lapses while pending | proposal expired | `errored`: `taskFailed` with `details.reason: "deadlineLapsed"` (suite design, proposed: `expired` is reserved for the envelope's `expiresAt`); a late approval is refused |
| Reset or cancel | transaction aborted | A producer-requested stop is `trust-task-control` cancel (`unsupportedType` if unsupported). A reset document is allowed only from a failed or expired ceremony; after the commit it is refused or reported with its effects, never a clean cancel (framework sections 11 and 8.3.1) |
| Duplicate while in flight | message already seen | existing state or HTTP 202; never an error; same `id` with other bytes is `idConflict` |
| Duplicate-record store unreadable | | `unavailable`, `retryable`, fail closed |
| Outcome unknown (inquiry unresolved) | transaction prepared or unknown | `indeterminate` (retryable) or still `accepted`; never guessed as `responded` |

Assertions (group 2PC; only (4) rests on framework text, SPEC.md 7.2 item 11, and gates through 2PC-006 and 2PC-007; the others are `ceremony-design`, advisory): (1) a `#response` appears only after the observable outcome is `committed` and the effect exists; (2) every error document corresponds to an aborted, failed or expired exchange and carries a `details.reason` from the closed set; (3) nothing leaves a terminal state; (4) after commit, a duplicate returns the same receipt and the effect count stays 1; (5) response and error signatures verify under the boundary's identifier, which equals the request's `recipient`.

### 12.1 Two-phase trigger actions (optional capability `trigger.twoPhase`)

The 2PC vectors run on the `issue` task (the effect is the stored credential, the binding in the receipt is its digest) and drive the implementation's transaction through `trigger`, whose action names and arguments are part of the contract. An adapter maps each to a fault of its own coordinator and participant:

| Action | Args | Meaning |
|---|---|---|
| `twoPhase` | `{outcome: "commit"}` | The transaction of the next `issue` document commits (the default). `deliver: false` models a reply lost after commit: the effect exists, nothing reaches the producer. |
| `twoPhase` | `{outcome: "abort", reason?, internal?}` | Coordinator abort. `reason` is a token of the implementation's closed vocabulary (the suite uses `storeFailed`); `internal` is an internal fact (text) that must never appear on the wire. |
| `twoPhase` | `{outcome: "voteNo", reason?}` | Participant vote fault: a participant votes no, so the transaction aborts. |
| `twoPhase` | `{outcome: "inflight"}` | The transaction is prepared and still running: no outcome yet, no reply. |
| `twoPhase` | `{outcome: "unknown"}` | Coordinator unknown-outcome fault: the outcome inquiry stays unresolved. The answer is silence or a retryable `indeterminate`; the document stays accepted and is never answered as responded. |
| `settle` | `{outcome: "commit" \| "abort", reason?}` | Resolves the pending (inflight or unknown) transaction and returns the documents the implementation then emits (the receipt, or the error). |
| `fault` | `{claimStore: "unreadable" \| "ok"}` | Claim-unreadable: the duplicate record cannot, or can again, be read (optional `fault.claimStore`, as for DUP-007). |

The ceremony family (section 11.4) adds two actions:

| Action | Args | Meaning |
|---|---|---|
| `ceremonyDeadline` | `{seconds}` | The approval window of ceremonies begun from now on, until `reset` (optional `trigger.ceremonyDeadline`). The deadline instant is the begin document's acceptance time plus the window; an approval at or after it is late. |
| `ceremonyEffect` | `{outcome: "commit" \| "fail" \| "unknown", reason?}` | What the establishing effect does when the next ceremony reaches its quorum (optional `trigger.ceremonyEffect`), one-shot: `commit` (the default), `fail` (the effect is refused; `reason` is a token of the implementation's closed vocabulary; without a `reason` the ceremony ends with `details.reason` `storeFailed`, the token the `twoPhase` abort uses, and an adapter may map a `reason` it does not know to that token), `unknown` (the outcome cannot be read; `settle {outcome}` resolves it and returns the documents then emitted). |

A `twoPhase` action is one-shot: it applies to the next `issue` document and the default is commit. An implementation with no such hooks leaves `trigger.twoPhase` undeclared and gets SKIP for 2PC-001, 002, 006 and 007 (2PC-008 needs only `fault.claimStore`).

## 13. Negative vector categories (built)

Expectations are the specification's dispositions; HTTP status is asserted only on HTTPS.

- **Proof:** bad `proofValue` or altered payload gives `proofInvalid`; unknown cryptosuite gives `proofInvalid` and is never processed as unsigned; proof absent where required gives `proofRequired`.
- **Purpose:** `keyAgreement`, absent or unrecognised gives `proofInvalid`; Tier 2: `assertionMethod` where the profile pins `authentication`, even when the key is listed under both; key not listed in the named relationship; valid signature whose verification-method controller differs from `issuer`.
- **Addressing:** wrong recipient gives `wrongRecipient`; proof without recipient gives `malformedRequest`; transport sender differs from `issuer` gives `identityMismatch`, addressed to the transport sender, without `inResponseTo.id`, naming neither party.
- **Time:** stale; expired (now equals `expiresAt`, inclusive); future `issuedAt` (`malformedRequest`, not `expired`); empty interval; missing `issuedAt` on a consequential task. Rows map one to one onto `freshness.json`.
- **Duplicates:** byte-identical resend absorbed and state unchanged; different payload, re-signed proof or different recipient gives `idConflict`; resend after the record window gives `expired` and is never re-executed; resend while held gives existing state or 202; restart (optional); claim store unreadable gives `unavailable`.
- **Reordered:** `issue` before an accepted `propose` gives `notAccepted`; share before issue or session (CLARIFY); a `#response` sent as a request is refused; a response for an unknown thread is ignored.
- **Replay:** an accepted `issue` replayed to a different recipient gives `wrongRecipient`; replay after the window; replay of an old receipt must not acknowledge a new delivery.
- **Type and version:** unknown type gives `unsupportedType`; wrong MAJOR gives `unsupportedVersion` with served versions; a type under `/binding/` is refused.
- **Ceremony deadline:** approving after the deadline is refused, no late effect.
- **Double approval:** the same approver twice counts once.
- **Ineligible approver:** `permissionDenied`, no state change, indistinguishable from not-found.
- **Reset after commit:** refused or reported with effects.
- **Error hygiene:** oversize `details` (over 4096 bytes or 16 members) ignored but the code honoured; no identity leak in `message`; an inbound error is answered with nothing.

## 14. Full-coverage roadmap (proposed; some steps built; dependencies marked D)

0. **Benchmark: VRC issue and witness-share** (framework groups ENV, TIME, DUP, PRF, ID, RSP, ERR, LIF; VRC-PRO, VRC-ISS, WSH, TD, 2PC). Needs the runner, the reference adapter and one adapter per participating implementation.
1. **Approver attestations** (step-up, consent, confirm) (D 0). Vectors: purpose pin, double approval, ineligible approver, threshold, a decline closes the action for all, expiry sweep, execution of the stored copy with re-check at the effect (framework 7.2 item 12), `next-step` with status polling. Harness additions: `trigger(consent)`, N-actor scripting. (`confirm/*` is retired in the registry direction this effort follows.)
2. **Vetting** (D 1): request, session, statement, decline, card digest, eligibility presentation, `taskContext` plus outcome evidence. A verifier tool maintained outside the suite can serve as a differential oracle.
3. **Membership** (D 2 partly): `vtc/join-requests/*` state machine; credential delivery. Membership lifecycle (withdrawal, revocation, re-issuance) is deferred by the DTG credential specification to a protocols document that does not exist: informative only.
4. **Data rooms** (D 0, parallel): `rooms/*`; epoch and revocation ordering needs time travel and multi-member scripting. Lowest priority.
5. **Credential exchange** (D 0): reuses the challenge-binding helpers from witness-share.
6. **Control** cancel, suspend, resume (D 0): optional capability; `unsupportedType` is the refusal the framework states.
7. **Delegation invocation, authority demonstration, membership lifecycle:** **blocked** on the planned "DTG Core Trust Task Protocols" specification, which does not exist. **Risk:** vectors written now would freeze two implementations' behaviour as if it were normative. Mitigation: group them as `core-protocols/*` with `status: "informative"`; results never gate and never count toward Tier 2; each vector cites the clause that defers it and records what each implementation does; promote or rewrite when the specification lands. Without that specification three of the targeted ceremonies (membership, delegation, authority) cannot be measured against a specification even in principle.
8. **Ceremony framework layer:** `ceremony.enactment/step/prev`, `trust-ceremony-receipt` (the step digest is over the bytes as received and differs from the task digest), cross-step party binding (an open framework issue) (D 0 to 4). The receipt verifier rules are built as group RCPT (section 11.6, optional `verifyReceipt`); the `ceremony` member on ordinary documents, the recorder side and cross-step party binding are not built.
9. **Transport matrix:** rerun framework groups over DIDComm v2 and TSP; an implementation's deviation (for example an auth refusal answered as a DIDComm problem report) becomes an explicit exception.
10. **Interop mode** (section 15).
11. **Specification feedback loop:** every CLARIFY becomes a task-force issue.

## 15. Interop milestone and capability matrix (proposed; the capability matrix is built)

Phase after the benchmark. Purpose: prove adapters against real peers, turn what peers actually exchange into vectors, and publish a per-family matrix.

- **Live pairwise sessions:** e.g. a wallet and a trust-stack agent on the VRC family (propose and accept, issue both directions, witness-share, with a scripted or real witness); a trust-stack agent and a trust-agent/community service only for families where the latter has an equivalent (framework carrier, approver attestations, vetting, membership). VRC groups stay SKIP for an implementation that does not serve them; they are never forced.
- **Tools:** a runner that starts two adapters and drives scripted scenarios through each `trigger`; a recorder (capture proxy) that stores verbatim request and response bytes with carrier metadata and signer identifier; a promoter that turns a transcript into a vector (parametrise ids, timestamps, keys; re-sign with harness keys where the IUT does not hold them; redact; mark `origin: "interop"` with the peer and commit); a matrix generator.
- **Capability matrix:** rows are implementation by tier; columns are families (framework carrier, VRC propose, VRC issue, witness-share, approver attestations, vetting, membership, data rooms, credential exchange, control). Cell values: PASS, FAIL, SKIP (not applicable), BLOCKED (specification missing or unpublished), KNOWN-FAIL (with reason), CLARIFY. A second view groups by layer (3a, 3b, 3c, 3d). KNOWN-FAIL entries expire: a cell that starts passing fails CI until the exception is removed.
- **Entry criteria:** the benchmark is green or honestly KNOWN-FAIL on each side; each side provisions its own keys; `did:peer:4` resolution works both ways; clocks are deterministic, or the peer runs in rebase mode (section 7), or they are within the declared skew.
- **Exit criteria:** runs reproducible from a clean state; every divergence classified as implementation bug, specification ambiguity (filed as CLARIFY) or vector bug; promoted transcripts pass the reference adapter and fail a mutated one; matrix published with no unexplained cell.
- **Differential-oracle caution:** agreement between two implementations is not conformance. Interop recordings are promoted only after classification, and are `informative` for blocked families.
- **Risks:** three-way clock and key provisioning; recordings that freeze buggy behaviour; an implementation that speaks a different carrier needs a shim.

## 16. Settled versus proposed, at a glance

| Item | Status |
|---|---|
| Black-box wire vectors with thin adapters; neutral home; builds on `fixtures/consume` and `fixtures/proof` | settled |
| Tier 1 / Tier 2 split; Tier 1 is the framework MUSTs and nothing stricter | settled |
| Tier 2 sub-groups `profile-window`, `profile-ceremony`, `profile-witness-share`, `profile-p384`, selected by running Tier 2 for every implementation with the capabilities | settled |
| Essential versus extended governance: the ceremony family split into `registry` (framework hold and duplicate rules), `candidate` (behaves per declared E) and `proposed` `ceremony-design`; the adapter honesty check gates on a declaration mismatch (section 11.4, [decision 39](decisions/04-ceremonies-governance-and-exceptions.md#d39)) | settled |
| Tier 2 sub-group `attested` as a named profile proposed to the task force | proposed |
| SHOULD mismatches are advisories (a failure on an attested implementation at Tier 2) | settled |
| Vector format `tt-conformance-vectors/0.1`, adapter method set | proposed |
| Windows 5 min / 60 s / 30 days are Tier 2 `profile-window` pins, declared per implementation and measured; Tier 1 time vectors take the effective window and the matrix always prints it | settled internally; to be confirmed with implementers |
| `clockFree`, rebase mode, run salt, vacuous-pass rule (sections 7, 8) | settled |
| Authority order: specifications first, existing VTI second; VTI differences are measured, never required changes | settled |
| Ceremony deadline gives `taskFailed` + `deadlineLapsed` | proposed (suite design, `ceremony-design`, advisory) |
| Duplicate-record gap is a KNOWN-FAIL; vectors are not weakened | settled |
| Each exception names one implementation and vector, an owner and an expiry date | settled |
| VRC groups SKIP for an implementation that does not serve them | settled |
| Envelope issuer and proof under the connection identifier; relationship identifier only inside the VRC's inner proof | settled |
| Holds are answered with `next-step` (framework 8.6), `continuation: resubmit` where there is no status task; Tier 2 adds signing | settled |
| VRC issue evidence = receipt plus observable state; spec-grade evidence only for witness/session | settled; task-force question drafted in document 09 |
| witness-share bundled as a suite-local profile specification | settled for now |
| 2PC to lifecycle table (section 12) | settled in outline; details assumed |
| Control optional; no generic status task | settled |
| Roadmap order and interop milestone | proposed |
| Group ids and counts | proposed |

See [07-status-and-open-questions.md](07-status-and-open-questions.md) for open items.

## 17. Implementation as built

The README lists the file map. This section records how the implementation realises the design and where it adds to the format of section 3.

- **Exceptions** live in a separate file, `exceptions/exceptions.json`, one entry per implementation and vector with a mandatory `owner` and `expires` date (section 8 gives an example). An expired exception fails the run; so does a stale one (the vector now passes). An exception may carry `tier` (1 or 2) so that it is judged only at that tier, for a profile row that tightens a Tier 1 SHOULD.
- **`verifyProof` helper method** (optional capability `proofVerify`) lets the imported proof fixtures reach an implementation, because their documents are not of a task the implementation serves.
- **`verifyReceipt` helper method** (optional capability `receiptVerify`) reaches the verifier rules of `trust-ceremony-receipt` 0.1 (group RCPT, section 11.6). It is optional on the `Adapter` interface (`src/adapter/contract.ts`), carried by the client and the dispatcher, and implemented by the reference adapter in `src/adapters/reference/receipt-verifier.ts`. The format gained the step kind `verifyReceipt` (a scenario and a list of accepted verdicts), built by `src/runner/receipt.ts`; the step digest is in `src/crypto/stepdigest.ts`; the receipt's payload schema and invalid examples are imported under `vectors/imported/receipt/`.
- **Vector fields:** `exactTier` (runs only at its own tier), `skipIfOptional`, `subgroup` (required on a Tier 2 vector, absent on a Tier 1 vector; section 3.1), `mutants` (the mutants that must make a negative vector fail), `advisoryMutants` (the mutants that must make it record an advisory; section 3.2), `origin` (imported fixture and row), `clockStart`, `exactClock` (needs exact clock control; SKIP in rebase mode), `profileWindow` (a fixture row pinning the profile window; SKIP for another window; set on the `profile-window` rows only), and `atAbsolute` and `when` on a step (offsets in `at` may use the window terms `windowMaxAge`, `windowSkew`, `windowHorizon`; `when: {proposerApproves}` runs the step only for that declared value of `ceremony.proposerApproves`, section 11.4). The loader rejects a negative vector that is not CLARIFY and names no mutant.
- **Optional capability `attested`:** an implementation that enforces the Tier 2 profile refuses unsigned requests, so Tier 1 vectors that send unsigned documents are SKIP for it rather than failing. The command line runs Tiers 1 and 2 for every adapter by default; the matrix Markdown prints the declared window, the Tier 2 sub-group roll-up and the advisory count for every implementation.
- **TIME rows** are the `consequential`-policy rows of the shared freshness fixture, sent as signed documents through the carrier; rows for other policies are not imported. The rows with absolute instants are `profile-window` (section 6). **DUP-101 and later** are the shared item-11 cases, sent unsigned and byte for byte; they are SKIP against an attested server. DUP-101 to 109 are Tier 1 and DUP-110 to 113, which pin the window, are Tier 2 `profile-window`.
- **Window pins** are those of section 6, applied through the runtime's consequential posture.
- **Carrier task:** the reference adapter serves `https://trusttasks.org/spec/conformance/widget/0.1`, the type the shared consume fixtures already use. It is a test type, not a registry specification.
- **3b-DTG groups (TC, CEX):** the reference adapter serves the four tasks as described in section 11.5 (option `dtg`, example server `--no-dtg`), models the approver device with `enrolExecutor`, the executor with `consentBinding` (challenge and digest derived from the ceremony) and the verifier with `presentationNonce`, and has 43 mutants of its own (`consent*`, `cex*`, `qry*`, `offer*`, `req*`, `granted*`, `dec01*`). For the query verb it also models the holder's credential store (`holdCredential`), pre-trusted verifiers (`verifierTrust`), the deferral list and the human's decision (`queryDecision`); option `queryUniformRefusal` takes the uniform-refusal reading of CEX-024. Vector steps of the two groups carry no clock offsets. The format gained the send members `credential` and `presentation` (built W3C credential and presentation), the templates `consent.request`, `consent.decision`, `cex.issue` and `cex.present`, and the state members `storedCredential` and `storedPresentation`.
- **Not built:** IDK, and the interop runner, recorder and promoter (the pair matrix, the ledger view and the artifact-crossed replay are built: docs/14). ES256 proof fixtures are SKIP for the reference adapter.
- **VRC-PRO and VRC-ISS:** the implementation under test is the counterparty (propose) and the receiving party (issue). Format members: a `trigger` step (`policy` presets what the IUT's human decides, `consent` decides a held proposal and returns the reply the IUT then emits; capability `trigger.consent`), a `capture` member (a value from the first reply, used later as `$cap(name)`), a `vrc` member on a send (builds the signed credential and its digest, `$digest(name)`), the expectation members `match`, `notEqual` and `state.stored`, and the disposition `next-step` (exactly one reply, a `trust-task-next-step` whose payload is checked against the closed payload schema: non-empty `expects` entries each naming a `typeUri`, `continuation` resubmit or proceed). The disposition `held` does not exist; a hold is always a `next-step`. Harness actors R, S and Q are relationship identities. The reference adapter answers a hold with a next-step that follows the framework (`expects` the originating propose type, `continuation: resubmit`, `inResponseTo` populated, same thread) and answers a resubmission on that thread with a further next-step while held, with the acceptance once the human accepted, and with `propose:declined` once declined (not asserted by a vector).
- **Gating:** the VRC vectors require the propose and issue Type URIs and `trigger.consent`, so an implementation that hosts neither (the VTI deployment) gets SKIP; a test runs the reference with VRC switched off and asserts it.
- **Holds:** framework SPEC.md 8.6 ("A hold is a next step") says a held task MUST be answered with `trust-task-next-step`, using `continuation: resubmit` when the consumer offers no status task, and never with an error. VRC-PRO-008 (Tier 1) requires the next-step and its shape; VRC-PRO-019 (Tier 2) adds the signature, authentication purpose and whole-second timestamps; VRC-PRO-020 and VRC-PRO-021 cover resubmission. None is CLARIFY. A hold that ends in a decline is answered as a refusal when the producer next asks (propose defines `propose:declined` for that).
- **Credential content:** the built credential carries issuer, subject, a `pairwise` `issuerScope` and an inner proof; the suite does not assert `issuerScope` (required by the credential specification, outside the two task specifications under test).

## 18. Spec-maturity channels and spec-drift (built)

Tests for a specification that is not yet merged must be includable and excludable, and must never be mistaken for a statement about the specification. Every vector therefore carries a channel and a pinned digest of the text it was derived from. Status: DRAFT proposal, like the rest of the suite.

### 18.1 The `source` member

```json
"source": {"slug": "credential-exchange/issue", "version": "0.1", "channel": "registry",
           "ref": "kit:specs/credential-exchange/issue/0.1", "pinnedDigest": "sha256:7a1a...",
           "tfRef": {"repoPath": "specs/credential-exchange/issue/0.1/spec.md", "commit": "0dbc98f1c059af300ff84eb1ab407edea16a16c1", "status": "draft"}}
```

| Member | Meaning |
|---|---|
| `slug`, `version` | The registry slug and version, or a name for a non-task document (`trust-task-framework` 0.6.0, `bindings/https` 0.3). |
| `channel` | `registry`, `pr`, `proposed` or `candidate` (18.2). |
| `ref` | Where the source text is, with a scheme: `kit:<path>` in the task-force checkout (a directory is digested as a whole: spec text, schemas, examples), `suite:<path>` in this repository, `pkg:@openvtc/trust-tasks@<version>#<type URI>` for the pinned package (payload schema, response schema and declared policy). |
| `pinnedDigest` | `sha256:<hex>` of that source as it stood when the vector was derived, or `null` when not yet pinned. |
| `pr` | Channel `pr` only: `{number, headSha}` of the open pull request. Required with `pr`, refused otherwise. |
| `tfRef` | **Required on every vector that is not a `candidate`** (18.7): the Trust Tasks repository artifact the vector cites. `{repoPath, commit, status}` for a file on main (`status` `draft` for a registry spec, `main` for a non-spec document such as `SPEC.md`, a binding or the ceremony meta schema, `retired` for a retired spec, which must also carry `supersededBy`); `{pr, head, status: "pr"}` for an open pull request (channel `pr`). Optional on a candidate (the Trust Tasks text it exercises in part). |
| `versionRole` | `older` when a later live version of the same task exists, `retired` when the cited specification is retired (O-09, D888). Absent on the newest live version. A specification that a later pin of the task-force repository retired while the pinned manifest lists it as draft (`vta/webvh/dids/list` 1.0, retired at bd0c05013) is labelled `retired` and says so in `source.note`; it still runs (D888). | Label only |
| `candidate` | Channel `candidate` only: `{implementedBy, localText, adoptionNote}` (18.2). |
| `profile` | Channel `proposed` only: the suite-defined profile the vector belongs to (`2L` or `ceremony-design`). |
| `note` | Optional free text (for example why the witness-share vectors are `candidate`, 18.6). |

The existing `spec` array is not duplicated: it holds the line-level citations (`SPEC.md:1015 ...`), `source.ref` the document they point into. The plain and emit probes derive from the pinned package and say so in `source.ref`. The schema is `schema/tt-conformance-vectors-0.1.schema.json`; the loader refuses a vector without a valid `source`, and a non-candidate vector without a valid `tfRef`. Three vector-level markers sit beside `source`: `excludedFromRun` (18.7), `synthetic` (18.8) and `probe`. `probe: true` marks a suite instrument rather than platform behaviour: the five governance probes (`vectors/governance/gov.json`, docs/17) carry it. It is allowed only on a `candidate` vector (an instrument never gates; the loaders refuse it elsewhere, and the governance loader refuses a probe without it), and wherever channel counts are shown such a vector is counted as `probe`, apart from the candidates (`countedClassOf` in `src/vectors/source.ts`; the families block of `results/README.md` gives the probes their own row), so the candidate figures hold only behaviour a platform may adopt.

### 18.2 Channels

Rule ([decision 79 by the project owner](decisions/02-specs-tiers-and-channels.md#d79), applied after the TF-source audit of 2026-11-15): **every vector cites a Trust Tasks (TF) repository artifact (main, a registry draft, an open pull request with its number and head; a retired one is flagged and excluded from run) or is explicitly a `candidate`. Anything else is removed or excluded from every run of all runs.**

| Channel | Meaning | Counted as |
|---|---|---|
| `registry` | The specification is in the Trust Tasks registry on main. Every registry specification is status draft, so this says where the text lives, not that it is ratified. | Gating (the existing counts) |
| `pr` | The specification is an open, unmerged pull request; `source.pr` and `tfRef` record its number and head SHA. | Advisory |
| `proposed` | A suite-defined profile or grouping over text that DOES exist in the TF repository. Two profiles: the 158 second-layer 2L vectors (`profile: "2L"`, docs/19), whose tasks are TF registry drafts that `tfRef` names with their real status (for example the notifications tasks merged in TF pull requests 1012 and 1017 are on main); and the 19 `ceremony-design` vectors (CER-003, 004, 006 to 014, 016, 2PC-001 to 005, 008, TIME-103; section 11.4), which apply framework text through the suite's own ceremony and two-phase design ([decision 39](decisions/04-ceremonies-governance-and-exceptions.md#d39)). Only the profile is our proposal, and that is what makes the vectors advisory. | Advisory |
| `candidate` | Behaviour with no home in the TF repository that one or a few platforms implement and that may be adopted later. Kept, never an endorsement. Requires `candidate: {implementedBy, localText, adoptionNote}`. A candidate marked `probe` (the governance probes) is a suite instrument and is counted as `probe`, not as a candidate (18.1). | Advisory |

`candidate` fields: `implementedBy` is the list of platforms that implement the subject, **derived from the recorded results** (`src/vectors/implemented-by.ts`: a platform counts when at least one recorded result for the group is executed, not SKIP; the suite's own reference adapters are never platforms), not hard-coded to one; it may be empty only with an `implementedByNote` saying why (the governance probes: no platform has a declaration path). `localText` is the repository path of the suite-local text the vector rests on (`docs/10-witness-share-profile.md` for witness-share, `docs/17-governance-probes.md` for the probes, `docs/04-suite-design.md` for CER-017 to 019, whose essential-governance declaration is section 19 of this document); it must exist. `adoptionNote` says where adoption stands (a TF issue or pull request, else "none filed"). For a candidate `source.ref` is `suite:<localText>`, so spec-drift tracks that document's digest. Not to be confused with the TF registry status `candidate`, which no registry spec has (docs/02).

The generators derive the channel from the citations (`classifyCitations` in `src/vectors/source.ts`): a vector that cites a registry spec, binding, ceremony schema or the framework is `registry`; the plain, emit and emit-more vectors are `registry` through the pinned package. The witness-share group (WSH) and the six TD vectors (the framework task-digest pairing rule exercised through the witness-share task, so their `requires` is the suite-local task) cite suite-local text and are `candidate` (18.6). The ceremony family is then split by `ceremonyChannel` (section 11.4): the `ceremony-design` vectors become `proposed` and CER-017 to 019 `candidate`. Today no vector derives from an open pull request, so none is `pr`.

### 18.3 The harness toggle

`--channels registry,pr,proposed,candidate` (default `registry`). A vector outside the selected channels is not run and not counted: it is reported as "excluded by channel" (run record `excludedByChannel`, a line in the matrix and on the console), never as SKIP. With the default, the results are those of the suite before channels existed, less the advisory and vectors excluded from run. A test pins the reference adapter's figures, unsalted. All channels (the vectors loaded): core 394 at tier 1 {PASS 257, CLARIFY 71, SKIP 66} and tier 2 {284, 69, 41}; leaving out the three candidates CER-017 to 019 gives the earlier 391 results unchanged ({254, 71, 66} and {281, 69, 41}). Default channel (registry): **core 343** at tier 1 {235, 61, 47} and tier 2 {246, 59, 38}: 394 less 32 candidates (WSH-001 to 023, TD-001 to 006, CER-017 to 019) and the 19 `ceremony-design` vectors (section 11.4); **plain 540** {435, 93, 12} and **emit 179** {168, 11} (543 and 183 loaded; PP-VLT-009 to 011 and EM-PSH-001, 003, 005 and EM-VLT-003 are excluded from every run, 18.7). Earlier steps: the default core figures first dropped by the 23 witness-share vectors (361 then 368 with CEX-033 to 039, which are registry: two gating PASS and five CLARIFY at tier 1 for the reference adapter), and the original 384 figures ({252, 66, 66} at tier 1) are those of the suite before `observe.pushed`.

### 18.4 Advisory results

Results of `pr`, `proposed` and `candidate` vectors are always advisory:

- never in a gating count, a headline total, the `conformance-matrix` of the run, or the exit code (a FAIL there does not fail the run);
- written to their own folder, `<out>-advisory/` (`conformance-matrix-pr.md`, `conformance-matrix-proposed.md`, `conformance-matrix-candidate.md`, `results-advisory.json`, `README.md`), with their own column set (one matrix per channel) and the banner: they are not an endorsement of any specification (the `candidate` banner says so in as many words), are not part of the gating counts or of any headline total, and a result never changes the exit code;
- printed on the console on lines starting `ADVISORY`, apart from the totals.

A result in `results.json` carries `channel`; with an advisory channel selected, the gating `results.json` holds registry results only.

### 18.5 Drift detection and refreshing pins

On each run the harness compares every selected vector's `pinnedDigest` with the digest of the source as available locally (`--kit <TF checkout>`, else `TT_KIT`, else a sibling `dtgwg-trust-tasks-tf`; `suite:` and `pkg:` sources need no checkout). A mismatch, a source that is not available, or a vector never pinned is reported once per source as `spec-drift` with reason `changed`, `missing-source` or `unpinned`, listing the vectors: an advisory finding that needs human review, in the run record (`drift`), the matrix and on the console. It is never a failure and never changes a count. The check reads the working tree of the checkout, so check out the commit you mean to compare (for the registry channel, main; for a `pr` vector, the head recorded in `source.pr`).

To accept what changed after reading it:

```
TT_KIT=<task-force checkout> npm run pins            # re-digest every source, write vectors/pins.json, regenerate the vectors
TT_KIT=<checkout> npm run pins -- --check            # list the pins that would change; writes nothing
npm run pins -- --ref kit:specs/credential-exchange  # limit to sources whose ref starts with this
```

Pins live in `vectors/pins.json` (ref to digest); the generators write them into each vector, so the vector files stay generated and a test checks they are current. A source not available locally keeps its old pin and is reported.

**Which TF commit the recorded runs read.** `vectors/tf-manifest.json` names two task-force commits. `main.commit` is `0dbc98f1c059af300ff84eb1ab407edea16a16c1` (`origin/main`, 2026-11-14): the commit every `tfRef` is resolved at and the one `npm run traceability` reads. `kit.commit` is `640d498909dc2e0a6b979b8189e8b845c6b86c62` (2026-10-29, the `@openvtc/trust-tasks-gen` 0.1.2 release commit): the earlier kit copy, an ancestor of main (234 commits behind it); the manifest's `inKit` flag says which cited paths it also holds. The `2026-11-16-` run folders were made with `--kit` pointing at a read-only export of main `0dbc98f1` (the README of each says so: "task-force checkout at the main commit in vectors/tf-manifest.json"), so the drift check compared the pins with main. Against main, 19 of the 20 `kit:` pins match and `kit:specs/trust-task-discovery/0.4` is reported `changed` (pinned from another revision of that spec; advisory, no count moves). Against `640d4989` the same check would report `trust-task-discovery/0.4` as `missing-source` (the spec is not in that commit) and `task-consent/decision/0.2` as `changed` (its payload schema differs by one line). Which commit is the suite's reference for recorded runs (main as pinned, or the kit copy) is the project owner's decision and is not yet made: [open decisions, section 4](open-decisions-from-reviews.md#4-which-task-force-commit-recorded-runs-read).

### 18.6 Promotion, and the witness-share and TF-source decisions (settled)

To promote a vector from `pr`, `proposed` or `candidate` to `registry`, change its tag and `tfRef` only: in the generator input set `channel: "registry"`, delete `pr` or `candidate`, point `ref`, `slug` and `version` at the merged location (the `tfRef` becomes `{repoPath, commit, status}`; a `pr` tfRef becomes the merge commit), run `npm run pins`, regenerate. No step, expectation or id changes; the vector then gates. Demotion is the same edit the other way.

Decided ([decision 78 by the project owner](decisions/02-specs-tiers-and-channels.md#d78), superseded for the vectors' tag by 79): the 23 WSH vectors (witness share, `docs/10`, a suite-local profile that is not a registry specification) left the grandfathered registry channel. Decision 79 added the channel `candidate` and moved them there, because the recorded results show them executed by more than one platform (keyring-wallet and the truststackers bridge; VTI skips every one). Consequence: the default (registry) core run was 361 vectors (368 after CEX-033 to 039, docs/20) and the 23 are advisory.

Decided by the project owner, from the TF-source audit: (a) TD-001 to 006, which test the framework task-digest pairing rule through the same suite-local task, are candidates; DIS-007 needed the witness-share type only as an advertised slug, so it is re-sourced to `vrc/relationships/propose/0.1` (pattern `vrc/relationships/pro*se`, same mutant) and stays registry; (b) the seven vectors that cite a retired TF spec are excluded from every run (18.7); (c) the 25 vectors with a synthetic carrier type are marked `synthetic` and kept (18.8); (d) the 158 2L vectors stay advisory through `profile: "2L"` (channel `proposed`) with `tfRef` set to the real status of each task; (e) the five governance probes are channel `candidate`, not `proposed`: the task text they rest on is in the registry package, but the declaration they probe is suite-local text with no task-force home (docs/17 section 4), and no platform implements a declaration path, so `implementedBy` is empty with a note; they carry the `probe` marker (18.1), so they are counted as probes, not in the candidate figures. Consequence, with the ceremony split of [decision 39](decisions/04-ceremonies-governance-and-exceptions.md#d39) (section 11.4): core is 394 = 343 registry + 32 candidate + 19 proposed (`ceremony-design`); the registry-channel vectors that are run, over the five families, are 343 + 540 + 179 + 75 + 28 = 1165. A test lists the candidates, the excluded-from-run and the synthetic vectors by id, with their notes, so none of the sets can grow unnoticed.

### 18.7 `tfRef`, `excludedFromRun` and the resolver

`tfRef` is what the vector cites in the Trust Tasks repository, so the citation rule is checkable. `repoPath` is a path in that repository (`specs/<slug>/<ver>/spec.md`, `SPEC.md`, `bindings/https/<ver>/spec.md`, `ceremonies/ceremony.meta.schema.json`); `commit` is the TF commit it was resolved at (`origin/main` 0dbc98f1c059af300ff84eb1ab407edea16a16c1, 2026-11-14; the kit copy `640d498909dc2e0a6b979b8189e8b845c6b86c62` of 2026-10-29 is an ancestor and the manifest records which paths it holds); `status` is `draft`, `main`, `pr` or `retired`. The citations in `spec` (suite docs, line numbers) are explanatory and are not the source for this rule. A `source.ref` of `pkg:` stays (the pinned package is a faithful copy of the TF schemas: 1390 of 1391 task versions equal in structure, one stale) but is always accompanied by `tfRef`.

The loader (`validateSource`) refuses a non-candidate vector with no valid `tfRef`, a retired `tfRef` without `supersededBy`, and a retired vector that is not `excludedFromRun`. `test/tfref.test.ts` enforces this across all families (framework, ceremony, dtg, plain, emit, emit-more, witness, 2L, governance probes). Resolution is offline: `vectors/tf-manifest.json` (written by `scripts/tf-manifest.ts` from a read-only local clone of the Trust Tasks repository at the two pinned commits above) lists every TF path, its status and whether the kit copy holds it; every `tfRef` must exist there with the status it names. `npm run resolve-tf-refs` (`scripts/resolve-tf-refs.ts`) also verifies the refs, and the manifest, against the clone itself (`git show <commit>:<path>`, front matter status). The clone is found by `--kit <dir>`, `TT_KIT`, or a sibling `dtgwg-trust-tasks-tf` of the checkout; **when it is absent, or does not hold the pinned commit, that check is skipped with a clear message (never a silent pass, never a failure) and the manifest check still runs.** Refresh the manifest only when pins move: `TT_KIT=<clone> node --experimental-strip-types scripts/tf-manifest.ts`.

`excludedFromRun: {reason, note?}` removes a vector from every run: it is never run, counted or reported as SKIP (run record `excludedFromRun`, a line in the matrix and on the console, so it is visible). It is set automatically on a vector whose `tfRef.status` is `retired`: reason "cites a retired TF spec; successor 0.2 is draft on main". Seven vectors: EM-PSH-001, 003, 005 (push/provision, register, wake 0.1), EM-VLT-003, PP-VLT-009, 010, 011 (vault/credentials/get 0.1). The successors (push/{provision,register,wake}/0.2, vault/credentials/get/0.2) are drafts on main and in the pinned package; re-source the vectors to them to bring them back. Recorded for the emit vectors: the keyring-wallet still emits the retired 0.1 versions (a finding about the wallet, not a verdict of this suite). Runs recorded before the field was named `excludedFromRun` call the run-record field `heldOut`; they are not edited, and nothing reads that field (at a glance takes exclusion from the current vector files, not from recorded results). Being excluded from a run is not retirement (section 20.3): an excluded vector is still current and returns to runs when its cause is removed.

### 18.8 Synthetic carrier types

Some vectors test a framework, consent or receipt rule with a stand-in task type that is not in the TF repository (`conformance/widget/0.1`, `conformance/gadget/0.1`, `conformance/receipt/other/0.1`, the deliberately unknown `trust-ceremony-receipt/1.0`; the reference adapter also serves `conformance/ceremony/*`). The rule under test still has a TF source (`tfRef` resolves to the framework or receipt text), so the vector is kept and marked `"synthetic": true` (set automatically when the vector uses such a type). Reports do not count a synthetic vector as a tested task: the at-a-glance task-type tally skips them. 25 vectors: TC-015 to 017, ENV-006, ENV-007 (type `conformance/Widget`, which the audit's list missed), ENV-009, DUP-101 to 113, ERR-004, ERR-005, BND-004, BND-007, RCPT-020, RCPT-069.

### 18.9 Promotion criteria and flaky vectors (quarantine)

Section 18.6 says how a promotion is made (the tag and `tfRef` edit). This section says when a vector may gate. Each criterion is checked by a reviewer in the promotion commit, which is its own commit, listed in `CHANGELOG.md` under a version that changes the gating set (major, section 20.2).

**From `candidate`, `proposed` or `pr` to `registry`.** A vector gates only when all of these hold:

1. **TF text exists.** The rule is in text merged on the TF repository's main branch (`tfRef` resolves there), and `spec` quotes the lines it rests on.
2. **The oracle passes and a mutant is caught.** The reference adapter passes the positive form; a negative vector names at least one mutant, and the non-vacuity test shows the vector fails it.
3. **It ran clean on recorded runs.** It ran (PASS, KNOWN-FAIL or FAIL, not SKIP) on three consecutive recorded runs, each with a `run.json`, on at least two surfaces (two implementations, or two carriers of one), with the same verdict on each surface every time, and every difference from the reference triaged in `results/vector-review.md`.
4. **It does not depend on live-network timing,** or it has a recorded retry policy (the adapter or the vector states the timeout and the number of retries, and the run README records them).
5. **It is not CLARIFY, not quarantined, and not excluded from runs.**

**From CLARIFY to asserted.** A CLARIFY vector asserts only when the unsettled point is settled in TF text: merged specification text, or a recorded task-force answer that a merged text cites. The generator's `clarify` becomes null; the expectation matches that text (the vector is changed first if it does not); the oracle and mutants are re-checked; the vector is re-run on the surfaces that recorded it, and every new FAIL is triaged before it gates. A changed expectation is a major change (section 20.2).

**Flaky vectors.** A vector is flaky when the same implementation, at the same version and inputs, gives different verdicts across runs. The first question is whether the suite causes it (timing in a vector, ordering, an unsalted id): then it is a suite bug and the vector is fixed, not quarantined. When the cause lies outside the rule under test (a live relay, a shared HTTPS service, network timing), the vector is quarantined:

- An entry in `exceptions/quarantine.json` (format `tt-conformance-quarantine/0.1`): `vector`, optional `impl` (capabilities name or platform; absent means every implementation) and `tier`, `reason` (the cause), `observedOn` (the run folders or dates where the verdicts differed, at least one), `owner` and `expires` (short: at most 30 days after the entry is written). `npm run suite` reads it by default (`--quarantine <file>` names another; a named file must exist), and `run.json` records its digest.
- While the entry is current the vector still runs, and its result is recorded as **QUARANTINED**, with the outcome observed in this run in the reason. QUARANTINED is advisory: it is in no count or roll-up, never in the exit code, and listed apart on the console, in the matrix ("Quarantined as flaky") and at a glance ("quarantined as flaky (advisory, not counted)").
- **Expiry fails.** After `expires` the result is FAIL ("quarantine expired on ...") whatever the outcome, as with an expired KNOWN-FAIL exception, so a vector cannot stay quarantined silently. The owner fixes the cause, renews the entry with a fresh observation, or removes it.
- Quarantine is not a KNOWN-FAIL (a reproducible, recorded difference) and not retirement (section 20.3): the vector stays current. A quarantined vector is not promoted; a gating vector quarantined twice is demoted to `candidate` until its cause is fixed.

### 18.10 CLARIFY classes, age and task-force questions

A CLARIFY vector is reported, never gating, because the text does not settle what it asserts. So that CLARIFY does not become a place where disagreement is parked, each CLARIFY vector carries three more members, copied by the generators from one hand file, `vectors-src/clarify-classes.json`:

- `clarifyClass`, why it is CLARIFY. **`spec-silent`**: the text does not decide the behaviour, and more than one answer is acceptable (Wycheproof's `acceptable`). **`spec-inconsistent`**: two texts (two documents, or a document and its schema or fixtures) say different things and the vector picks one; only the task force can settle it. **`vector-overreads`**: the text is clear and the vector expects more than it says (a SHOULD or MAY read as a MUST, a design or profile rule of the suite, a detail the text leaves to the implementation); the suite can fix it without the task force, by rewriting the vector, moving it to the candidate or proposed channel, or retiring it. **`unclassified`**: the clarify text does not support one of the three; the class is not guessed, and the vector's text needs rewriting first. The class is read from the vector's `clarify` text, which must state the ground.
- `clarifySince`, the vector's CLARIFY age: the date of the first commit in which it was CLARIFY, or the suite version `0.1.0-draft` for vectors that were already CLARIFY when the suite was first committed (the history does not say when). A vector moved to CLARIFY later gets the suite version it moved in.
- `clarifyQuestions`, the drafted task-force questions it waits on: `tfq:Q<n>` for question n of [the TF question list](proposals/tf-question-list.md), `d09:<n>` for Draft n of [docs/09](09-draft-questions-for-task-force.md). Empty until a question is drafted; nothing is sent ([decision 53](decisions/01-constraints-and-process.md#d53)). The validator checks the format and `test/clarify-classes.test.ts` checks that each id names a drafted question.

A CLARIFY vector without an entry in the hand file, or an entry for a vector that is not CLARIFY, fails `npm run regen` and `npm test`. The counts by class, for the vectors and for each surface's recorded CLARIFY results, are generated into results/README.md. A challenge upheld on one of the three grounds ([challenges.md](challenges.md)) moves the vector to CLARIFY with that class.

### 18.11 Reverse traceability

Forward citations show that each vector is grounded in the text; the reverse direction shows which requirements no vector cites. `npm run traceability -- --kit <clone>` (`scripts/traceability.ts`, `src/traceability/extract.ts`) writes [results/traceability.md](../results/traceability.md):

- **Texts**: the task-force texts the vectors cite by line or by numbered section, read at the commit pinned in `vectors/tf-manifest.json` from a local task-force clone (read-only git, no fetch). Each text's digest is compared with `vectors/pins.json` (the file for `SPEC.md`, the spec's directory otherwise, as `npm run pins` computes it); a text that differs is labelled, because its line citations may point at another revision. Texts referenced only through `tfRef`, with no line or section, are counted and not extracted.
- **Statements**: a block (paragraph, list item, table row or heading) that holds `MUST`, `MUST NOT`, `SHALL`, `SHALL NOT`, `SHOULD`, `SHOULD NOT`, `RECOMMENDED`, `NOT RECOMMENDED` or `REQUIRED` in upper case, outside front matter, fenced code and the BCP 14 boilerplate. Its id is `<path>:<first line>`.
- **Coverage**: cited by line (a vector cites a line or range that overlaps the block), by section only (a vector cites the block's numbered section or a parent, such as `SPEC.md 7.2 item 8`: weaker, listed apart) or not cited. Citations are read from every string of a vector.
- **Limits** (stated on the page): keyword detection (a quoted keyword counts, a requirement without a keyword is missed), line-based matching (a range covers every statement it overlaps; a multi-line statement counts when any line is cited), item numbers are not resolved, and spec files without numbered headings have no section coverage.

The page depends on a clone that is not tracked, so it is not part of `npm run check:docs`; it is re-run by hand after a vector or pin change, and `--check` says whether it is stale. "Not cited" directs vector work; it is not a statement that the requirement is untested by other means, and not a finding against any implementation.

## 19. Governance declaration (built; additive adapter contract, docs/17)

Status: DRAFT proposal. The suite never decides governance (docs/02 section 5.1). To check only whether a platform lets governance be declared and honours it, the adapter contract gains three additive members. An adapter that implements none of them is unaffected and its governance probes are reported as GOV-NOT-PROBED.

| Member | Shape | Meaning |
|---|---|---|
| `capabilities.governance.declaration` | `supported` / `none` / `unknown` (default `unknown`) | `supported`: the adapter implements `declareGovernance`. `none`: the platform has no declaration path the adapter can reach (`governance.reason` says why). `unknown`: the adapter says nothing. |
| `capabilities.governance.items` | list of `roles`, `authority`, `consent` | The declarable items `declareGovernance` accepts. A probe that needs another item is GOV-NOT-PROBED (reason `governance-undeclared`). |
| optional capability `governance.declare` | name in `capabilities.optional` | Declared together with `declaration: supported`. |
| `declareGovernance(decl)` | `{roles, principals[{vid, role}], authority?, consent?}` returns `{status: applied}` / `{status: rejected, reason}` / `{status: unsupported, reason?}` | Run the platform under the declaration. `principals` names which harness actor holds which role at the start; `authority` maps a role to the roles it may grant; `consent` is `{task, approverSet, minApprovals, excludeRequester}`. `reset` clears it. JSON-RPC method `declareGovernance`. |
| `capabilities.governance.essential` | `{source, principals?, consent?, evidence?, reason?}` | The platform's essential governance E (section 19.1). Unlike the members above it is not a declaration path: it states what the platform's governance already is, and the ceremony vectors and the honesty check run against it. |

The runner option "two runs with `--governance-profile`" in the audit is not used: a declaration is one call, and the same adapter process serves several probes.

`governance.roles` (the stand-in role values of the plain family, section 11.7) is unchanged. The probes' values are nonce names generated per run (`gov-<what>-<hex>`) and are never a role name a platform defines. A refusal (`rejected`) is reported as GOV-FIXED, because the platform was asked and answered; `unsupported` and `none` are GOV-NOT-PROBED, never a negative finding.

Reference adapter: `ReferenceAdapter({ governance: true })` (CLI spec `reference-governance`) honours a declaration for `acl/grant` 0.3, `acl/list` 0.4 and `policy/evaluate` 0.4; `governanceMutants` (CLI `governance-mutant:<id>`) are the seven governance mutants of `src/adapters/reference/governance.ts`. Without the option the reference declares no governance path and its answers are unchanged.

### 19.1 Essential governance, E (`capabilities.governance.essential`)

E is the part of governance that gates ([decision 39](decisions/04-ceremonies-governance-and-exceptions.md#d39); docs/02 section 5.1): the platform's **authority set** (the principals who may decide a held task) and **`minApprovals`** k (at least 1). Everything else is extended governance (X) and is reported only by the advisory probes (docs/17). The adapter states E in the shape of `GovernanceDeclaration`, so no new vocabulary is introduced:

| Member | Meaning |
|---|---|
| `source` | Where E comes from. `platform-config`: read from the platform's own configuration. `harness-configured`: the harness configured the platform this way for the run. `fixed-rule`: a built-in rule of the platform; it still fills E and is reported with the advisory GOV-FIXED, not as SKIP. `unreadable`: E cannot be read (`reason` required). An adapter that states nothing is treated as unreadable. |
| `principals` | `[{vid, role}]`. The authority set is every entry whose `role` is `consent.approverSet`. A `vid` is a harness actor token (`$A`, `$X`, `$B` ...), so the harness can drive approvals from it, or a DID (resolved to a harness actor where one has it). |
| `consent` | `{task, approverSet, minApprovals, excludeRequester}`; k is `minApprovals`. |
| `evidence` | Where the values were read: a file and line at a commit, a setting name, or the rule's citation for `fixed-rule`. |
| `reason` | For `unreadable`: why. |

The runner resolves E (`resolveEssential`, `src/runner/essential.ts`). It is unreadable, with the reason, when `source` is `unreadable`, when `consent` or `principals` is missing, when `minApprovals` is not an integer of at least 1, when no principal holds the approver role, or when k exceeds the size of the set. The suite never asserts what E should be: it records it, runs the ceremony vectors relative to it (section 11.4) and checks it against behaviour with the honesty check (section 11.4).

**Run record.** run.json records, for every implementation, `implementations[].essentialGovernance`: `{source, authority (the declared set, empty when unreadable), minApprovals (null when unreadable), singleParty (the set has exactly one member), evidence?, reason?, finding? (GOV-FIXED for fixed-rule, GOV-NOT-PROBED for unreadable)}`, and `implementations[].essentialProbe`, the honesty check's outcome (`{result: consistent | mismatch | not-probed | not-run, declared?, checks[{check, result, observed}], reason?, finding?}`) from the first tier run. `results.json` carries the same probe outcome as `essentialProbe`. Runs recorded before these members existed have neither.

**At a glance.** Each surface shows E as a label read from run.json: **single-party** for a declared authority set of one, "k of an authority set of n" otherwise, with its source (and GOV-FIXED for a fixed rule), or "E unreadable (GOV-NOT-PROBED)" with the reason, or "E not recorded" for a run that predates the record; then the honesty check: consistent, not probed, not run, or not recorded. A declaration mismatch leads the label in bold, "GOV-DECLARATION-MISMATCH (counts as FAIL)".

**Reference adapter.** By default the reference declares its own configuration: administrators `$A` and `$X`, k = 2, `source: platform-config`. `ReferenceOptions.essential` sets another authority set and k for the run (`source: harness-configured`; CLI spec `reference-e:<k>:<actors>`, for example `reference-e:3:B,C,D,F`); the begin template then names that set and the ceremony completes at the k-th distinct approval from it. The mutants `cerQuorumEarly` and `cerQuorumLate` complete one approval before or after the declared k; the lying variants of section 11.4 keep the declaration and behave otherwise.

**What the platform adapters state.** Each value cites the code it was read from:

| Platform / surface | `source` | Authority set | k |
|---|---|---|---|
| VTI, agent service (VTA) in process | `fixed-rule` (GOV-FIXED) | one: the adapter's operator DID, role admin (single-party): a deferred credential query is decided by one approval from a super admin | 1 |
| VTI, community service (VTC) in process, actors seeded as admin (`VTI_ACTOR_ROLE=admin`) | `fixed-rule` (GOV-FIXED) | seven: `$A`, `$X`, `$R`, `$S`, `$Q`, `$W` and the adapter's admin DID (the VTC admin-consent rule over the harness ACL; the requester excluded) | 1 (the VTC's default consent threshold) |
| VTI, VTC in process with member actors; VTC live; the emit surface | `unreadable` | the reason says why (the authority set is held outside the harness; the adapter reads neither ACL nor threshold; the surface serves nothing) | |
| keyring-wallet, stand-in carrier and DIDComm v1 and v2 | `fixed-rule` (GOV-FIXED) | one: the wallet's person (single-party) | 1 |
| witness server, v1 and v2 | `unreadable` | no witness task waits for approvals | |
| example server | `platform-config` | the reference's: `$A`, `$X` | 2 |

Not stated: truststackers (original) has no adapter.

No VTI or keyring-wallet adapter offers `optional:ceremony`, so for them the honesty check is not run: their declarations are recorded and shown, not exercised.

## 20. Releases, run provenance and vector ids (built)

### 20.1 Every run folder carries run.json

Every run folder (under `runs/` of the results directory, section 21) keeps the `run.json` its tool wrote: the suite runner (`npm run suite -- --out`) writes one beside each `results.json`, and the governance probes (`npm run governance -- --out`) and the VTI cross-check (`src/crosscheck/cli.ts --out`) write one beside their output. `run.json` holds `suite.commit` (the commit id of the suite tree, never a branch name), `suite.dirty` (whether tracked files differed from that commit) and `suite.version` (the `package.json` version, section 20.2); the suite runner adds the vector and exceptions digests, each adapter's capabilities and declared E (section 19.1), the minimum quiet period its no-reply verdicts were held to (section 3.3), the date exception expiry was judged against, the Node.js version and the redacted command line. Local paths are never recorded (`<path>`), so nothing needs to be removed before committing it. A dirty run is recorded as dirty, not hidden.

`test/run-records.test.ts` checks every run folder: at least one `run.json`, one beside every `results.json`, each with the current run format, a commit id, a dirty flag and a semver version. Folders recorded before run.json was written are listed in `runs-before-run-json.json` of the results directory (hand-kept; never add to it). They are not edited: their provenance is the prose in their README. The test fails when a listed folder gains a `run.json`, so the list shrinks as folders are re-recorded. The current run of every surface carries `run.json`, except two earlier recordings that are still the current measurement of their surface, named in the list's `currentEarlierRecordings` and checked by the same test: VTI live over HTTPS (`2026-11-14-vti-26d0da81-rcpt`; the community service needs a container runtime to run live) and truststackers (original) (`2026-11-15-truststackers-base`; not reachable, the folder records why). Older folders stay as they are; archiving them is a separate decision.

### 20.2 Suite versions (semver)

The suite version is the `version` in `package.json`, and every `run.json` records it (`suite.version`). Releases follow semantic versioning, read for a conformance suite:

- **major:** an expectation changes (a vector's verdict for the same behaviour), or the gating set changes (a vector promoted to or removed from `registry`, CLARIFY lifted or set on a gating vector, a vector retired), or the vector format or adapter contract changes incompatibly;
- **minor:** vectors are added outside the gating set (`candidate`, `pr`, `proposed`), or the runner, adapters or reports gain something additive;
- **patch:** documentation, generated pages and fixes that change no verdict.

Before 1.0.0 the suite is a draft (`0.y.z`, with a pre-release tag such as `0.1.0-draft`): a minor step may then carry what would be a major change, and the changelog says so. Changes are listed in [CHANGELOG.md](../CHANGELOG.md) (Keep a Changelog style) under the version that ships them. A release is a commit whose `package.json` version is that release; tagging it is the project owner's step.

### 20.3 Vector ids: never reused, retired rather than deleted, cited with the version

- **Never reused.** An id (`<GROUP>-<NNN>`) names one rule for the life of the suite. A new rule takes a new number, even in a group with gaps.
- **Retired, not deleted.** A vector that should no longer be run is retired: it stays in its file with `retired: {reason, since, replacedBy?}`, where `since` is the suite version that retires it and `replacedBy` names a successor id when there is one. A retired vector is a tombstone: never run, counted or reported as SKIP; the run record lists it under `retired` (id and "retired in <version>: <reason>"), and the console prints the ids. Generators keep the vector and add the marker; its steps stay as they were, so the history of the rule is readable in place.
- **Ledger.** `vectors-src/id-ledger.json` lists every id ever issued. `npm run regen` appends new ids (`scripts/id-ledger.ts`); `npm run check:docs` and `test/vector-ids.test.ts` fail when an issued id is no longer in `vectors/` (deleted instead of retired) or a vector id is not in the ledger.
- **Retirement is not exclusion from a run.** `excludedFromRun` (section 18.7) keeps a current vector out of every run for a cause outside it (its cited TF spec is retired) and it returns when the cause is gone; selecting channels (section 18.2) and quarantine (section 18.9) likewise leave the vector current. Retirement ends the id.
- **Citation.** Results and claims cite a vector as `<suite version>/<id>` (for example `0.1.0-draft/CER-017`), with the suite commit from `run.json` where exact reproduction matters. An id alone is ambiguous across versions once an expectation changes.

## 21. Where run records live (built)

Run records are kept outside this repository. This is the project owner's decision for now and it is reversible (section 21.4); [decisions](decisions/01-constraints-and-process.md#run-records-outside) registers it.

### 21.1 The results directory

Everything a run produces lives in one results directory, named by one configuration point: the environment variable `SUITE_RESULTS_DIR`, which every command line also takes as `--results-dir <dir>` (`src/results-dir.ts`). The default is `results-local/` at the suite root, which is git-ignored. The runner and the artifact-crossed replay write a run folder there with `--run <YYYY-MM-DD-label>` (the same as `--out <results dir>/runs/<label>`); the at-a-glance page, the documentation blocks, the interop pair matrix, the before/after baseline, the claims lint and `npm run regen` read it.

| Path in the results directory | What |
|---|---|
| `runs/<YYYY-MM-DD-label>/` | One folder per run: `run.json`, `results.json`, `conformance-matrix.*`, the run README, `draft-issues/` (section 20.1) |
| `runs/INDEX.md` | The run index, and the Superseded banner of each superseded run README, written by `npm run regen` |
| `runs-before-run-json.json` | Run folders recorded before `run.json` existed (`test/run-records.test.ts`) |
| `baseline-<commit>.json` | The before/after baseline, written once by `scripts/baseline.ts` |
| `interop/pair-matrix.json` | The conformance-implied pair matrix data (`scripts/interop-matrix.ts`) |

What stays in the repository under `results/` is hand input and the generated pages: `at-a-glance.config.json`, `skip-classes.json`, `findings.json`, `governance-evidence.json` (a static audit, not a run), `interop/ledger.json` and its schema, `vector-review.md`, `kw-task-coverage.md`, `traceability.md` (generated from the vectors and the specification text, not from runs), `TEMPLATE-run/`, and the generated snapshot pages of section 21.2. `.gitignore` lists `results-local/` and the run-record paths that used to be tracked (`results/runs/`, `results/runs-before-run-json.json`, `results/baseline-*.json`, `results/interop/pair-matrix.json`), so nothing run-derived is committed by accident.

A page refers to a run folder as a code span, `runs/<folder>/`, read relative to the results directory; never as a link, since the folder is not in the repository. A `ref` in `exceptions/exceptions.json` or `results/findings.json` written as `results/runs/<folder>/...` names the same folder in the results directory.

### 21.2 Generated pages are committed snapshots

`README.md`, `STATUS.md`, `platforms.md`, `results/README.md`, `results/AT-A-GLANCE.md`, `results/at-a-glance.html`, `results/independent-implementations.md`, `results/interop/pair-matrix.md` and `results/platforms/*.md` keep their generated figures in the repository as snapshots. Each snapshot names the run set it came from: a digest of the path and content of every `.json` and `.jsonl` file under `runs/` (`runSetId` in `src/results-dir.ts`; the Markdown files there are left out because the run index and the Superseded banners are generated). Every snapshot page names the same run set, which `test/docs-blocks.test.ts` checks with or without the results directory.

- **With run folders present**, `npm run regen` rewrites the snapshots, the run index and the Superseded banners, and `npm run check:docs` (and `npm run at-a-glance -- --check`) fails when any snapshot differs from what the run folders give, the run set stamp included.
- **Without run folders**, `npm run regen` leaves the snapshots as they are and `npm run check:docs` skips the run-derived generators with a message naming the directory it looked in; the vector generators, the id ledger, the exception expiries, the interop ledger view and the link, banner and claims checks still run and still fail on a difference.

The `implementedBy` of a `candidate` vector is derived from the run folders (`src/vectors/implemented-by.ts`). Without run folders the derivation keeps the value the committed vectors already carry, so the vectors regenerate unchanged; with them, `npm run check:docs` checks that committed value against the runs.

### 21.3 Tests

A test that reads run folders takes `NEEDS_RUNS` from `test/helpers.ts`: it skips, with the reason, when `SUITE_RESULTS_DIR` names no run folders, and runs against the named directory when it does. `npm test` and `npx tsc --noEmit` pass either way; the full set needs `SUITE_RESULTS_DIR` set to a results directory.

### 21.4 Reversing it

To keep run records in the repository again: copy the results directory's contents back under `results/` (`runs/`, `runs-before-run-json.json`, `baseline-<commit>.json`, `interop/pair-matrix.json`), remove the run-record lines from `.gitignore`, and make `results/` the default results directory in `src/results-dir.ts`. Nothing else depends on where the directory is.

### 21.5 The roll-up generator and its default inputs

The scope-relative roll-up (docs/14 section 10) is `src/glance/rollup.ts` (the rules: item states, P, M and floor, thresholds, headline text; pure, no file access beyond the record readers) and `scripts/rollup-prototype.ts` (the generator CLI). It reads its inputs the way the rest of the suite does, with no flag and no hand-made folder for the normal case:

- **Gating results** come from the at-a-glance surfaces of the results directory (as before) and, by default, from the run map `results/platform-run-map.json` (decision D300): every run folder the map lists for a component with a gating surface (`agent-gating`, `community-gating`, `community-gating-ported`, `shim-gating`, and the reference adapter's `promote-*-gating-reference` folders from `notPlatform`) is read under `<results dir>/runs/`. The component-to-surface table is `COMPONENTS[].runMap` in `src/glance/rollup.ts`. The promote-b1 and promote-b2 folders therefore feed gating without symlinks.
- **Promotions** come from `vectors-src/promotions.json` by default (`loadPromotedIds`). A record counts as gating only when its vector is promoted and the record itself carries the registry channel (docs/33); every other record is advisory and stays on the labelled second line.
- **Flags.** `--no-run-map` and `--no-promotions` restore the earlier behaviour (surfaces and `--advisory` roots only); `--promotions <file>` reads another promotions file; `--advisory <root>` and `--ceremony-extra <dir>` add roots as before (first record of a vector wins, run map folders first).
- **Tests.** `test/glance-rollup.test.ts` (rules) and `test/rollup-default-inputs.test.ts` (default inputs, evidence kinds, guardrails). They use temporary directories and the committed run map only.

The generator is still not part of `npm run regen`; wiring it in (generated blocks, `check:docs`) is the remaining step of the plan in `docs/proposals/rollup-design.md` section 5.

### 21.6 Reproducing the committed figures (release candidate)

The snapshot pages name one run set (`runSetId`). To reproduce them: build the results directory with `scripts/assemble-results-set.ts` from a base set and the overlay `results/ceremony-overlay.json` (CONTRIBUTING.md, "results directory"), keep the reference run `runs/2026-11-22-rc-reference` in it (re-recorded with the commands in its README), and run `SUITE_RESULTS_DIR=<dir> npm run check:docs`; it fails when any snapshot differs. The run records are about 140 MB (about 11 MB compressed) and are not committed (D801); some of them carry local paths in the participant command strings, so remove those before an archive of them leaves this machine. Without a results directory `npm run check:docs` still checks the vectors, ledgers, links, banners and claims, and the run-derived generators skip with a message.
