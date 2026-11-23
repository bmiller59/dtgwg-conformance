# Rooms and ballot cast ceremonies: a phone with its community, its agent and the election's ballot box

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This page describes two ceremony groups run between a member's phone (keyring-wallet) and VTI services: `FC-RMS`, joining and using a community's room (the community and room host, and the member's agent as key holder), and `FC-BAL`, casting a ballot with the election's ballot box. It follows [docs/31](31-persona-rooms-elections-ceremonies.md), which recorded why both were not built, and uses the scenario format and runner of [docs/25](25-ceremony-scenarios.md) and the pair pattern of [docs/26](26-paired-ceremonies.md).

## 1. What a run shows, and what it does not

- It shows that these platforms, at the versions they speak, completed this choreography (or ended in the refusal the scenario names) on this date, using the wallet's own request code. The strongest wording allowed for two platforms is "ran against both with the same scenarios". It does not show conformance and is never added to a PASS count. A SKIP is reach, not failure, and is always classified (section 7).
- The carrier is the runner's relay (runner-carried mode). No DIDComm packing, mediator or push gateway is exercised, so the wallet's key borrowing (the persona's keys held by its agent, released over a confidential channel) is not run. That fact decides the shape of the rooms rows (section 4).
- Both groups have two kinds of row: the reference oracle (written from the specification text) and the platform rows. Both legs of rooms and the ballot box are now recorded against VTI's hosts (sections 2, 5 and 7; run folders `rms-vti-*`, `bal-vti-*`), after the hosts were compiled and the first passes had been corrected (class B and D defects of the suite, one class A difference). All outcomes are outcomes of ceremonies run together, never conformance and never counted.

## 2. Ballot cast (group FC-BAL, 14 scenarios)

A voter's client (keyring-wallet, `K`) sends the cast its agent built (`voting/ballot/cast` 0.1) to the election's ballot box (VTI's `vti-voting-service`, `B`) over the box's HTTPS door and keeps the receipt. Channel `proposed`, advisory, outside every count.

**Does keyring-wallet send the cast in its own code? Yes.** The wallet's poll service builds nothing itself (the member's agent holds the voter key and builds the cast with `vta/pcs/vote`), stores the built cast, and `postCast` (`polls/ballotBox.ts`) sends it unchanged to the ballot box named in the manifest, on its own connection with no session, then believes the answer only once it is the ballot box's (signed by it, threaded to this cast, addressed to the cast's one-time key, for this poll). The wallet checks the recipient before sending, so a cast addressed to another ballot box is never sent. No VTC handler serves the type (docs/31 section 6): the ballot box does.

What the group runs: the wallet's own `postCast` with the cast taken from a source the scenario names. What it does not run: the wallet's poll service end to end (register, ticket, accept, vote and receipt through the agent), election creation through the community's `vtc/elections/create`, ticket issuance by a community's registrar. Those are class D stand-ins: the cast is built by the platform's own voting library (`vti-voting`'s `Voter` and `Registrar`, in the ballot host) or, for the oracle, by a modelled attestation (a keyed digest over the election class, the ballot and the tag: the checks and their order are modelled, the zero-knowledge proof is not).

| Scenario | What it checks (spec step) |
|---|---|
| FC-BAL-001 | open election, accepted cast: outcome `counted`, leaf 0, receipt kept by the client (steps 1 to 12) |
| FC-BAL-002 | the same cast resent unchanged, then the same ballot cast again under a new one-time key: counted once, appended once, `alreadyCounted` with the first receipt (retry safety, steps 7 and 10) |
| FC-BAL-003 | voting not yet open: `notOpen` (step 3) |
| FC-BAL-004 | election the box does not hold: `electionUnknown` (step 2) |
| FC-BAL-005 | ballot binds another manifest digest: `manifestMismatch` (step 4) |
| FC-BAL-006 | ballot answers a question the manifest does not ask: `ballotInvalid` (step 5) |
| FC-BAL-007 | attestation under another election's class: `classMismatch` (step 6) |
| FC-BAL-008 | ballot changed after attestation, and an attestation from no ticket this election issued: `castInvalid` (step 9) |
| FC-BAL-009 | different ballot under a counted tag, revote `refuse`: `alreadyVoted`, first stays counted (step 8) |
| FC-BAL-010 | same under revote `replace`: outcome `replaced`, earlier cast stays on the board, one ballot counted (step 11) |
| FC-BAL-011 | accepted cast delivered again with a value changed and with its proof removed: `proofInvalid`, `proofRequired`, board unchanged (step 1) |
| FC-BAL-012 | cast addressed to another ballot box: never sent by the client, nothing counted (recipient rule) |
| FC-BAL-013 | voting closed: `notOpen`, count unchanged (step 3, closed) |
| FC-BAL-014 | cast at a version the box does not serve (0.2): `unsupportedVersion`, the box names 0.1; needs a client that can send another version (`optional:castFutureVersion`; the wallet sends 0.1 only, so its row is skipped, class scope) |

A non-member, an outsider and an expired ticket are the community's checks at ticket issuance (`vtc/elections/tickets/issue`), not the ballot box's: the box sees only the attestation, so these are not scenarios of this group (scope).

Non-vacuity: eleven mutants of the reference ballot box (`ballotCountsTwice`, `ballotNoOpenCheck`, `ballotNoManifestCheck`, `ballotNoAnswerCheck`, `ballotNoClassCheck`, `ballotAcceptsForged`, `ballotRevoteIgnored`, `ballotReplaceKeepsBoth`, `ballotNoProofCheck`, `ballotReceiptWrongThread`, `ballotReceiptToWrongKey`) each end the scenario that watches for them `failed` (run records `ballot-oracle-mutants`). The two receipt mutants watch the client's receipt checks.

| Row (run folder) | completed | ended as specified | failed | skipped |
|---|---|---|---|---|
| `ballot-oracle` (reference voter, reference box) | 4 | 10 | 0 | 0 |
| `ballot-kw-original-oracle-box` (wallet, reference box) | 4 | 9 | 0 | 1 (FC-BAL-014, scope) |

The wallet row shows the wallet's `postCast` against the oracle box only, a reading of the specification, not VTI.

**Against VTI's ballot box** (`vti-voting-service`'s own router in process, host `src/adapters/vti-ballot/host`, compiled 2026-11-20 on the first attempt; cast source: the host's `/ctl/cast`, built by `vti-voting`'s own Voter; class D stand-in for the agent's `vta/pcs/vote`):

| Row (run folder) | completed | ended as specified | failed | skipped |
|---|---|---|---|---|
| `bal-vti-reference-voter` | 4 | 10 | 0 | 0 |
| `bal-vti-kw-original` (wallet 62af4d2d) | 4 | 9 | 0 | 1 (FC-BAL-014, scope) |

The two rows agree on every scenario they share. No difference between VTI's ballot box and the specification text was found: every refusal code, the retry answer (`alreadyCounted` with the first receipt), the replace-on-revote outcome and the proof checks match. The first passes failed for suite defects, listed in section 7 (the pass folders `*-pass1`, `*-pass2`, `*-pass3`, `*-pass4`, `*-pass5` keep them). What remains unrun here: the wallet's poll service end to end, election creation through the community, and the agent-built cast (section 8). An agent with the `vetting-pcs` feature needs no rebuild: `vta-service` always compiles the voter role and the agent host serves `vta/pcs/voter/*` and `vta/pcs/vote` at the versions the wallet sends.

## 3. Rooms: reachability, and what was configured

docs/31 recorded that the community host's rooms were `enabled: false`, so the offers and memberships lists were empty and a write had nothing to join. That was host configuration, not a platform limit, and it is now configurable. The host (`src/adapters/vti/vtc-host`) reads `VTC_HOST_ROOMS=<context id>` and starts the community with `[rooms.community]` on and the community's key holder as a stand-in (`rooms.rs`), exactly as VTI's own community-rooms tests do (a `VtaChannel` that keeps a real room key and signs the membership, authority and invitation credentials as a real VTA would; no MLS). Everything the host serves is VTI's own handler: the offers list and accept, the memberships list, the records and blobs of the room it hosts. A control observer (`roomRecords`) counts the records the host holds. Absent the variable the host starts as before.

Measured on the existing prebuilt hosts (a request at version 0.0 answers `unsupportedVersion` with the versions served): the community serves offers list 0.4, accept 0.1, memberships list 0.1 and 0.2, records put 0.3 and 0.4, get 0.2, blobs begin/get/chunk 0.2/0.2/0.1; the agent serves keys act 0.8, 0.9 and 0.10, list 0.2, key-package 0.2, welcome 0.1, seal 0.2, read 0.1, browse 0.3, backfill 0.2, file-key 0.2, present 0.2, open 0.2, label, commit and chain 0.2. (docs/31 said `rooms/records/put` 0.3 answered `unsupportedType`; it answers `unsupportedVersion` listing 0.3 and 0.4: the earlier probe was not at a served version.)

| Tier | Why it is or is not run |
|---|---|
| `open` | no group, so accepting records the take-up, no KeyPackage is sent (offers/accept item 2) and no Welcome exists. Run. |
| `attributed`, `private` | the community's VTA adds the member's KeyPackage to an MLS group and the member's key holder processes a Welcome. The host's stand-in key holder runs no MLS (its Welcome is an opaque token), and a real community VTA needs a messaging link. Not run: suite limit (a real MLS owner is not hosted), and the key holder's acts need the persona's keys, which the carrier cannot release (section 4). |

## 4. Rooms (group FC-RMS, 18 scenarios): what runs where

Participants: the wallet `K` (role member-phone), the community and room host `V`, the member's agent `A`. Community-leg scenarios use `K` and `V`; agent-leg scenarios use `K` and `A`. The wallet's own code runs: its offers ladder (0.4, 0.3, 0.2), parsers, memberships list, accept, the put payload, its file sealing and manifest (`sealFile`), its keys ladders (list 0.2 then 0.1, act 0.9, 0.8, 0.6, 0.5) and its act document. Host-bound requests are signed as the persona by the wallet's community controller with the presentation of the offer's credentials: **class D**, because in the app the member's agent completes and signs them with `rooms/keys/act` and holds the persona's keys, which this carrier cannot release (docs/31 section 4). The agent leg therefore asks the agent what it answers without a member it can act as.

| Scenario | What it checks |
|---|---|
| FC-RMS-001 | the offers list (0.4) holds one open offer with the credentials the room issued |
| FC-RMS-002 | accept without a KeyPackage on an open room: admitted; the memberships list shows it admitted |
| FC-RMS-003 | a write with the offer's presentation (put 0.3): one record stored, key and version answered |
| FC-RMS-004 | an upload opened with the wallet's own manifest (begin 0.2, proxied): one upload, the chunks it lacks |
| FC-RMS-005 | replay: the signed write delivered again unchanged (no second write), changed (`proofInvalid`), proofless (`proofRequired`); one record, one write |
| FC-RMS-006 | the same key written again as a new document: `rooms/records/put:versionConflict`, the first record kept |
| FC-RMS-007 | the offer's end passed: `offers/accept:offerExpired` |
| FC-RMS-008 | accept addressed to another community: `wrongRecipient` |
| FC-RMS-009 | a persona not an active member asks for offers: `offers/list:notAMember` |
| FC-RMS-010 | outsider: credentials issued to someone else (or altered): `permissionDenied`, nothing stored |
| FC-RMS-011 | an upload manifest that does not add up: `begin:invalidManifest`, no upload |
| FC-RMS-012 | step-down: offers 0.4 then 0.3 against a community serving 0.3 only (labelled legacy profile) |
| FC-RMS-013 | the agent's keys list (0.2): no rooms (an open room has no group) |
| FC-RMS-014 | KeyPackage against a well-formed invitation no room issued: `key-package:notInvited` |
| FC-RMS-015 | act on a type outside the task's table: `act:typeNotActable` |
| FC-RMS-016 | act naming an issuer the agent holds no keys for: `act:issuerNotPrincipal` |
| FC-RMS-017 | step-down: act 0.9 then 0.8 against an agent serving 0.8 only (labelled legacy profile) |
| FC-RMS-018 | KeyPackage against text that is not a credential: the specification names `notInvited` for an invitation that does not verify; a platform that refuses it earlier as malformed is a difference the run records |

Each step cites the specification of the document it sends. Not exercised: sealed tiers, the upload's chunk and commit (a digest-addressed transfer the scenario does not carry), `rooms/records/get` and list, curate, the community's own administration (the scenarios use the community's administrator through its door only to create the room and offer it).

Non-vacuity: eight mutants (`rmsListsToNonMember`, `rmsExpiredAccepted`, `rmsPutWithoutPresentation`, `rmsNoVersionCheck`, `rmsReplayWrites`, `rmsInvalidManifestAccepted`, `rmsActsAnyType`, `rmsKeyPackageUninvited`) each end the scenario that watches for them `failed` (`test/rooms-pairs.test.ts`; run records `oracle-mutants`). The oracle's credentials are its own compact form (the member passes them on unchanged and only the host reads them); the platform's are VTI's.

## 5. Rows and results

Counts are read from each folder's `scenario-result.json`. One pair, one carrier (the runner's relay), one date (2026-11-19). Not conformance results.

| Row (run folder) | completed | ended as specified | failed | skipped |
|---|---|---|---|---|
| FC-RMS oracle trio (`rms-oracle`) | 7 | 11 | 0 | 0 |
| FC-RMS wallet vs the oracle community and agent (`rms-kw-original-vs-oracle`) | 7 | 11 | 0 | 0 |

The agent leg (FC-RMS-013 to 018) has no recorded row against the original VTI agent.

**Community leg (FC-RMS-001 to 012) against VTI's community: recorded.** The VTC host was rebuilt with `/ctl/stepup` (suite commit c9b5d6d; the administrator's second factor for `community/create` and `members/add` is a class D stand-in) and the first row ran. Outcomes by row, after the corrections of section 7 (folders `rms-vti-reference-member`, `rms-vti-kw-original`; the first passes are kept as `*-pass1-before-fixes`, `*-pass2-before-uploadkey`):

| Row, FC-RMS-001 to 012 | completed | ended as specified | failed | skipped |
|---|---|---|---|---|
| Reference member | 5 | 6 | 0 | 1 (012) |
| Wallet | 5 | 6 | 0 | 1 (012) |

Before the corrections the reference member failed 004, 005 and 006 and the wallet row failed 005 and 006 (004 completed for the wallet). Those failures were one class A difference (006), two class B defects of the reference member (004) and one class D defect of the VTI adapter's observer (005), section 7.

## 6. Version overlap

Offers list: the wallet asks 0.4 and the community serves 0.4, so the overlap is complete and the step-down (FC-RMS-012) is oracle only. Keys act: the wallet asks 0.9, the agent serves 0.8, 0.9 and 0.10: complete, so FC-RMS-017 is oracle only. Keys list 0.2, key-package 0.2: complete. No "completed" is claimed beyond the overlap.

## 7. Differences, classes and skips

- **A (VTI differs from the specification text): FC-RMS-014 and FC-RMS-018, `rooms/keys/key-package`.** Item 1 of the recipient's requirements (`rooms/keys/key-package/0.2` spec.md, Recipient): a request whose invitation does not verify, was not issued by the room `roomId` names, or has expired MUST be refused with `notInvited`. The agent answered `malformedRequest` ("the invitation was issued by ..., not by room ...") for a well-formed invitation another party issued (014), and for text that is not a credential at all (018: a document that does not verify is an invitation that does not verify). VTI never emitted the code (it appears only in its error-code census). 018 was first recorded as unsettled; reading "does not verify" to include a value that is not a credential, which the specification text supports and nothing in it contradicts, it is class A too.
- **A (VTI differs from the specification text): FC-RMS-006, `rooms/records/put` 0.3.** The payload schema gives `expectedVersion` 0 the meaning "create-only and fails if the key exists" and says that on mismatch the host returns `rooms/records/put:versionConflict` carrying the current version and record; the specification's consumer item 6 repeats it and declares the code. VTI's community answered the generic `taskFailed` (`details.reason` conflict, "record already exists (create-only requested)") for a second create of the same key; the same mapping is in the room host crate.
- **B (the suite over-read or misbuilt, corrected before the recorded rows): FC-RMS-004 (reference member), FC-BAL-001, 002, 005, 010.** The reference member's `rooms/blobs/upload/begin` carried a 4096-byte chunk size, below the 16384 minimum of `ChunkSize` (`vta/_shared` backup-transfer schema, which the blob manifest uses), and no `uploadKey` or `directParts` (producer item 2: offer at least one mode, so the host answered `noTransferMode`); it now sends a 20000-byte, two-chunk manifest at 16384 and a fresh upload key, and the oracle host refuses a chunk size outside the schema's bounds. The wallet row completed 004 before and after. For the ballot box: `cast:leaf:0` assumed the first cast is board index 0, but the board also holds lifecycle entries before any cast (VTI's first cast is leaf 1) and the cast task says only that `leafIndex` is the cast's board index, so `cast:leaf:<n>` now counts from the first receipt the voter kept (001, 002, 010); the `wrongDigest` variant used a string that is not a multihash, which the box refused on the schema (`malformedRequest`) before reaching the digest check (005), and is now a well-formed digest of another manifest, for the box and the oracle alike.
- **D (harness stand-ins and defects, corrected): FC-RMS-005 and the ballot rows.** The VTI adapter counted `rooms-writes` per successful reply; a document delivered again is answered with the same reply (same id) and was counted twice though the room held one record, so it now counts distinct reply ids. The ballot host's cast carried the oracle's community DID in `payload.community` (the box answered `electionUnknown`); it now carries the host's community. The ballot host's `counted` observation looked for a board entry of kind `replacement`, the schema's kind is `replaced`. The reference voter's and the wallet driver's calls to the cast source sent no `Content-Type` (the control interface answered text, which the callers parsed as JSON). None of these is a platform result.
- **B (the suite over-read the specification, corrected before any platform row): FC-RMS-015 and 016.** The first reading used `rooms/records/list/0.5` as a type outside the act table (it is in the table; the scenario now uses `rooms/keys/list/0.2`) and expected `notAMember` for an act naming an issuer (the specification's `issuerNotPrincipal` is the answer for a named issuer the key holder may not act as; `notAMember` is for no named issuer). The act document also lacked the id and issuedAt the task requires (the wallet's `actAndSend` carries them; the wallet kind and the oracle member now build it the same way). The first agent rows failed on these; they were corrected, not recorded as differences.
- **C (specification or framework conflict): none observed. D (stand-ins):** the runner's carrier in place of DIDComm (the persona's keys cannot be released, so the act-signed requests are signed by the wallet as the persona with the offer's presentation), the community's key holder (VTI's own test double, `VTC_HOST_ROOMS`), the oracle's compact credentials, legacy profiles for step-down, the ballot ceremony's agent and ticket issuance (section 2).
- **Skips (platform rows): FC-RMS-017 and FC-RMS-012** (the agent serves 0.8, 0.9, 0.10 and the community serves offers 0.4, so the wallet's first rung is served; `trigger.serveVersions` is not offered, so the skew cannot be arranged). FC-BAL-014: scope (section 2).

## 8. Blockers

- **Resource gate (resolved).** The VTC host (with `/ctl/stepup`), the agent host and the ballot-box host were built on 2026-11-20 (about 2 and 1 minutes incremental; the ballot host's first compile succeeded) with about 29 GiB free on `/`, and the community leg and the ballot box were run (sections 2 and 5). No resource gate remains for these rows.
- **Firm on this carrier:** act-signed requests by the real agent as the real persona (the keys cannot be released over a non-confidential carrier); the sealed tiers (a real MLS owner and Welcome); the cast through the wallet's whole poll service.
- **Work after the builds:** the agent's membership credentials from the offers list into the member's vault (`vault/credentials/receive`) so the real agent can act; a real community VTA link; election creation through `vtc/elections/create` with a trusted ballot box (a `BallotBoxChannel` stand-in).

## 9. Suite host changes

Suite host source (this repository): the community host's rooms option and observer (compiled 2026-11-19 without change), and `/ctl/stepup` with the adapter's use of it for `community/create` and `members/add` (class D stand-in for the administrator's second factor: a mark in VTI's step-up keyspace under VTI's own `operation_digest`, spent by the operation; committed, adapter-tested, not yet built).

## 10. How to run

```
node --experimental-strip-types src/ceremony/cli.ts --participant K=reference-rooms-member --participant V=reference-rooms-community --participant A=reference-rooms-agent --scenario FC-RMS-001 --out <dir>
node --experimental-strip-types src/ceremony/cli.ts --participant K=reference-ballot-voter --participant B=reference-ballot-box --scenario FC-BAL-001 --out <dir>
```

For the platforms the wallet is `stdio:KW_CEREMONY=on KW_ROOT=<keyring-wallet checkout> ... src/adapters/keyring-wallet/launcher.ts`, the community `stdio:VTC_HOST_ROOMS=<context> VTI_VTC_CEREMONY=1 VTI_VTC_BIN=<host> ... src/adapters/vti/launcher.ts`, the agent `stdio:VTI_ROOT=<VTI checkout> VTI_INPROCESS_BIN=<host> VTI_INPROCESS_CEREMONY=1 VTI_ACTOR_ROLE=admin ... src/adapters/vti-inprocess/launcher.ts`. One runner invocation per row with `--reuse`, under `nice -n 10`.
