# Persona, directory and elections ceremonies (and where rooms stand): a phone with its agent or its community

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This page describes three ceremony groups run between a member's phone (keyring-wallet) and a VTI service: `FC-PER`, creating a persona on the member's agent (VTI's VTA); `FC-DIR`, the community's member directory (VTI's VTC); and `FC-VOT`, the member's reads of the community's elections (VTC built with the voting feature). It also records, with evidence, why the rooms ceremony and the casting of a ballot are not run. The groups use the scenario format and runner of [docs/25](25-ceremony-scenarios.md) and the pair pattern of [docs/26](26-paired-ceremonies.md) and [docs/30](30-onboarding-vetting-ceremonies.md).

## 1. What a run shows, and what it does not

- It shows that these platforms, at the versions they speak, completed this choreography (or ended in the refusal the scenario names) on this date, using the wallet's own request code and the VTI service's own handlers. The strongest wording allowed for two platforms is "ran against both with the same scenarios".
- It does not show conformance and is never added to a PASS count. A SKIP is reach, not failure, and is always classified (section 10).
- The carrier is the runner's relay (runner-carried mode): each signed document goes to the service's HTTPS door and each answer back to the wallet. No DIDComm packing, mediator or push gateway is exercised. This matters for one step (the persona's key borrowing, section 4).
- Where a ceremony needs a party the platform pair does not supply, a suite stand-in plays it and the step is labelled class D (section 10).

## 2. What was added

- Reference oracles written from the specification text: `reference-persona-agent` and `reference-persona-phone`, `reference-dir-community` and `reference-dir-member`, `reference-vote-community` and `reference-vote-member` (each community or agent with a labelled legacy profile and deliberate mutants).
- Wallet driver kinds that run the wallet's own code: its VTA client (`persona-mint`, `persona-context`, `persona-borrow-key`), its directory service (`dir-my-card`, `dir-set-name`, `dir-list-members`, `dir-show-member`, `dir-lookup-name`, `dir-member-by-did`) and the poll constants it reads elections with (`vote-list`, `vote-show`).
- Adapter observers and triggers on VTI's agent host (contexts, minted DIDs, released keys) and community host (the directory's second member, `dirMember`).
- Groups `FC-PER` (5 scenarios), `FC-DIR` (13) and `FC-VOT` (4), channel `proposed`, advisory, outside every count.

## 3. Reachability: which pairs exist in code

Read from the two source trees and measured on the hosts (a request at version 0.0 answers `unsupportedVersion` with the versions the host serves, or `unsupportedType` when it serves the type at none). Run records: `persona-rooms-elections-runs`.

| Ceremony | Wallet sends | VTI serves | Verdict |
|---|---|---|---|
| Persona (C07) | `vta/contexts/list` 1.0, `vta/webvh/servers/list` 1.0, `vta/webvh/dids/create` 1.2 down to 1.0, `keys/export-secret` 0.1; `contexts/create` exists in its VTA client but the app never sends it | agent host serves each (create at 1.2 only; contexts at 1.0; export-secret 0.1) | **Built**, serverless mint (no hosting server is registered). Key borrowing is refused over the runner's carrier (section 4). |
| Directory (C16) | `fields/list`, `card/show`, `card/update`, `entries/list` 0.2 (0.1 on refusal), `entries/show`, `query`, `images/get`, `images/upload` | community host serves each at the wallet's version | **Built** (images not exercised). |
| Elections (C14) | `vtc/elections/list` 0.5 and 0.3, `show` 0.6, 0.3 and 0.2 (reads); `voting/ballot/cast/0.1` | a community built with the voting feature serves the reads at every version the wallet sends; **no VTC handler serves `voting/ballot/cast`** | **Reads built.** Casting: see section 6. |
| Rooms (C15) | `vtc/rooms/offers/list` 0.4 to 0.2, `offers/accept` 0.1, `memberships/list` 0.1, `rooms/blobs/*` 0.2, `rooms/records/*` 0.1 to 0.4 (community side); `rooms/keys/*` (agent side) | community host answers offers list and memberships list (empty) and serves blobs begin 0.2; records put at 0.3 answers `unsupportedType` on this host; community rooms are `enabled: false` (configuring them needs a context at the community's agent and a room host); agent host serves `rooms/keys/*` at 0.1 to 0.10 | **Not built** (section 7). |

## 4. Persona (group FC-PER, 5 scenarios)

Wallet `K` (member-phone) against the agent `V`. Ordered steps of the wallet's own flow: contexts list, hosting servers list (none), serverless persona mint (`dids/create` at the newest version, its ladder walking down on a version refusal), and, as separate steps, a context create and a key release.

| Scenario | Steps and expected disposition |
|---|---|
| FC-PER-001 | list contexts, list servers, mint serverless: `completed`; one DID, a `did:webvh`, `serverless: true` (spec: MUST carry `serverless`) |
| FC-PER-002 | create the `keyring` context, then mint: `completed`; the DID is in that context |
| FC-PER-003 | create the `keyring` context twice: the second is refused with `idConflict`, the context unchanged; ends `refused` as specified |
| FC-PER-004 | mint, then ask the agent to release a persona key over the runner's carrier (not confidential to the two parties): refused, nothing released; ends `refused` as specified |
| FC-PER-005 | step-down: the agent serves 1.0 only (labelled legacy profile, needs `trigger.serveVersions`); the phone's ladder goes 1.2, 1.1, 1.0; one persona minted. Oracle only: VTI's host serves one version, so the row is SKIP (platform) |

Stand-ins (class D): no hosting server (the agent is registered with none, so the mint is serverless at a URL the member's base URL names); the context `ctx1` the host starts with; the host's harness actor holds the administrator role; the wallet's key borrowing (`keys/export-secret`, which the app does over DIDComm) cannot be shown, because the specification requires a channel confidential to the two parties and the runner's carrier is HTTPS, so FC-PER-004 records the refusal and the borrowing, the wallet's persona record and the key import are not run. Not exercised: `rotate-keys`, `contexts/delete` (step-up), any hosting server, the wallet's `ensurePersona` as one call.

## 5. Directory (group FC-DIR, 13 scenarios)

Wallet `K` against the community `V`; a second member (a stand-in for the community's own, `dirMember`, class D) writes a card with visibility choices and reads entries, because the wallet's directory client sets a name and a picture only.

| Scenario | What it checks |
|---|---|
| FC-DIR-001 | own card and schema before any write: revision 0, required name missing, base fields listed |
| FC-DIR-002 | name written (revision 1); the administrator sees it; another member finds the entry and reads the name but not the derived `did` field (default audience administrators) |
| FC-DIR-003 | a card missing its required name is not listed; listed once the name is written |
| FC-DIR-004 | the wallet reads another member's entry: the fields shown to members appear, the one kept for administrators is absent |
| FC-DIR-005 | a narrowing applies from the moment it executes |
| FC-DIR-006 | a hidden listing is absent from the list and `notFound` by entry id |
| FC-DIR-007 | a withheld name is not returned to the wallet's lookup; a request for a withheld field is `notFound`, not empty |
| FC-DIR-008 | an update naming a past revision is refused (`superseded`); the card keeps the earlier name |
| FC-DIR-009 | a persona that is not a member: `card/show:notMember`, list `permissionDenied` |
| FC-DIR-010 | unknown field, derived field and too-wide visibility each refused with the task's own code (`fieldUnknown`, `fieldNotWritable`, `aboveCeiling`), none clamped |
| FC-DIR-011 | replay (no second change), tamper (`proofInvalid`) and no proof (`proofRequired`) on the card update |
| FC-DIR-012 | wrong recipient (`wrongRecipient`) |
| FC-DIR-013 | step-down of the members list from 0.2 to 0.1 against a labelled legacy profile (oracle only; SKIP on the platforms, which serve 0.2) |

Not exercised: images, groups, connections, introductions, facets, paging, `external` publication, the administrator's field tasks. Defaults and ceilings in the oracle are the specification's worked example (an illustration, not a rule); a platform that differs there is not a difference from the specification text.

## 6. Elections (group FC-VOT, 4 scenarios) and the ballot cast

The reads: list at the newest version both sides serve (0.5), an unknown election (`vtc/elections/show:electionUnknown`), a caller not on the roll (an empty list: the specification requires an election be included only when the caller may see it and declares no error code, so a refusal is not required; an earlier reading of the scenario expected `permissionDenied` and was corrected, class B), and a step-down against a legacy profile (oracle only, SKIP on the platforms).

**Does the wallet's `voting/ballot/cast` have a VTC handler? No.** Evidence: the community host built with the voting feature answers `voting/ballot/cast` with `unsupportedType`, while it serves the election reads, creation, tickets and ballot-box list; in the VTI source the type is dispatched only by the separate ballot-box service (`vti-voting-service`) and built by the agent's `vta/pcs/vote` (`vta-service`), never by `vtc-service`. The wallet sends the cast to a ballot box over its own door.

The cast itself is run in [docs/32](32-rooms-ballot-ceremonies.md) section 2 (group FC-BAL). A KW to VTI election ceremony (register, ticket, cast, receipt) therefore needs three VTI parts the suite does not host: the community with the voting feature and a trusted ballot box (creating an election is refused without one), the agent with the `vetting-pcs` feature for `vta/pcs/voter/*` and `vta/pcs/vote`, and the ballot-box service. Elections can be created only through the administrator's `vtc/elections/create` with a manifest. This is **work, not a firm blocker** for the pair; it is firm for the cast against a VTC. No scenario here claims it.

## 7. Rooms (C15): not built here, with the evidence (built and run in [docs/32](32-rooms-ballot-ceremonies.md))

Rooms has two legs. Community leg: the wallet sends `vtc/rooms/offers/list`, `offers/accept`, `memberships/list`, blobs and records; the community host answers the two lists (empty) and serves blobs begin at 0.2, but the community's rooms are `enabled: false` (its own configuration names the agent context its room keys are minted in) and `rooms/records/put` at 0.3 answers `unsupportedType`. Without a configured community room there is nothing to offer, accept, upload to or put into, so an offers, blobs or records scenario would pass or skip vacuously. Agent leg: the agent host serves `rooms/keys/*` (act 0.8 to 0.10, key-package, welcome, seal, list, read, browse, backfill, file-key, present), a stateful MLS chain that needs a room host the suite does not run. Classification: **work** (configure a community room against an agent context and a room host, then drive offers, accept, keys, blobs and records, about the size of the persona and directory groups together); **firm** for any run on the current hosts for the offers, blobs and records scenarios (the room must exist first). Every rooms SKIP is classed platform (host configuration) and suite limit (no room host). Superseded for the community leg: the rooms host was configured (`VTC_HOST_ROOMS`) and the community leg was run, see [docs/32](32-rooms-ballot-ceremonies.md) section 5.

## 8. Non-vacuity

Each reference community or agent has deliberate mutants, and each ends the scenario that watches for it `failed` (tests `test/persona-pairs.test.ts`, `test/directory-pairs.test.ts`, `test/vote-pairs.test.ts`; run records `oracle-mutants`): persona `perContextMerges` (FC-PER-003), `perNoServerlessFlag` (001), `perExportOverRest` (004); directory `dirClampsSilently` and `dirDerivedWritable` (010), `dirHiddenStillListed` (006), `dirWithheldAsNull` (002), `dirNoRevisionCheck` (008), `dirServesNonMember` (009), `dirNarrowingDeferred` (005), `dirQueryEmptyNotNotFound` (007), `dirListsIncomplete` (003); elections `voteNonMemberServed` (003), `voteUnknownShownEmpty` (002).

## 9. Rows and results

Counts read from each folder's `scenario-result.json`. Label: ran together, one pair, one carrier (the runner's relay), one date (2026-11-19). Not conformance results.

| Row | completed | ended as specified | failed | skipped |
|---|---|---|---|---|
| FC-PER, oracle pair | 3 | 2 | 0 | 0 |
| FC-DIR, oracle pair | 11 | 2 | 0 | 0 |
| FC-VOT, oracle pair | 3 | 1 | 0 | 0 |

No platform rows are recorded here: the original VTI (26d0da81a) services' hosts were not built.

## 10. Differences, classes and skips

- **A (VTI differs from the specification text): FC-PER-003.** `vta/contexts/create` 1.0 requires an id that already exists to be refused with `idConflict` and never treated as an update; the agent answered `taskFailed` with `details.reason: conflict`.
- **B (vector over-read): FC-VOT-003** (an outsider's list is an empty list, not a refusal). Vector and oracle corrected before any platform row was recorded.
- **C (specification or framework conflict): none observed.** **Unsettled:** none.
- **D (stand-ins):** the runner's HTTPS carrier in place of DIDComm (so the key borrowing step is a refusal), no hosting server, the second directory member and the administrator (the community's own members, signed through its door), the legacy profiles of the oracle, the wallet's elections ladder walk (the kind walks the wallet's poll-generation constants; the wallet's poll service needs its record store).
- **Skips (platform rows): FC-PER-005, FC-DIR-013, FC-VOT-004**, all **platform** (the services serve one version, so a step-down against an older service cannot be arranged; `trigger.serveVersions` is not offered). Version overlap is complete in all three groups (agent create 1.2; members list 0.2; polls list 0.5 and show 0.6), so no "completed" is claimed beyond it.
- **Not built:** rooms, all sub-ceremonies (section 7: platform host configuration, suite limit); ballot cast, tickets and election creation (section 6: platform, no VTC handler for the cast; suite limit for the ballot box and agent hosts); wallet key borrowing and persona record (suite limit: carrier); directory images (scope).

## 11. How to run

```
node --experimental-strip-types src/ceremony/cli.ts --participant K=reference-persona-phone --participant V=reference-persona-agent --scenario FC-PER-001 --out <dir>
node --experimental-strip-types src/ceremony/cli.ts --participant K=reference-dir-member --participant V=reference-dir-community --scenario FC-DIR-001 --out <dir>
node --experimental-strip-types src/ceremony/cli.ts --participant K=reference-vote-member --participant V=reference-vote-community --scenario FC-VOT-001 --out <dir>
```

For the platforms the wallet is `stdio:KW_CEREMONY=on KW_ROOT=<keyring-wallet checkout> ... src/adapters/keyring-wallet/launcher.ts`, the community `stdio:VTI_VTC_CEREMONY=1 VTI_VTC_BIN=<host> ... src/adapters/vti/launcher.ts` (a host built with the voting feature for FC-VOT), the agent `stdio:VTI_ROOT=<VTI checkout> VTI_INPROCESS_BIN=<host> VTI_INPROCESS_CEREMONY=1 VTI_ACTOR_ROLE=admin ... src/adapters/vti-inprocess/launcher.ts`. Run one runner invocation per row with `--reuse`, under `nice -n 10`.
