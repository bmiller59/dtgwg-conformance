# 15. keyring-wallet's DIDComm v2 developer option

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This page records what the keyring-wallet code offers for DIDComm v2 and what it could mean for this suite's harness. It was written by reading the wallet's source only. Nothing was enabled, built or run, and nothing in the wallet was changed. Paths below are inside the keyring-wallet repository and are written `keyring-wallet: <path>:<line>`. Each claim is marked **verified** (read in the code) or **inferred** (a reading of the code, not observed running).

## What it is

A persisted switch in the wallet's Developer screen, labelled "Enable DIDComm v2 (experimental)". It is off by default.

- Label and default (verified): `keyring-wallet: app/src/localization/en/index.ts:202`; default `enableDidCommV2: false` in `keyring-wallet: app/src/store.tsx:110`; stored under the key `EnableDidCommV2` (`keyring-wallet: app/src/store.tsx:129`, `:195-198`) and read back at start-up (`keyring-wallet: app/container-imp.ts:401`).
- The toggle row (verified): `keyring-wallet: app/src/screens/Developer.tsx:349-360` (handler) and `:812-827` (row and switch). Test id `ToggleEnableDidCommV2`.
- Added in the wallet's git history by the commit "a developer setting for DIDComm v2, with its own mediation" (verified from `git log`, dated 2026-09-15).

## How to enable it

1. Open the wallet's Developer screen and turn on "Enable DIDComm v2 (experimental)" (verified, above).
2. Restart the app. The agent's `didcommVersions` list is fixed when the agent is built, so the toggle only takes full effect on restart; the handler's own comment says so (verified: `keyring-wallet: app/src/screens/Developer.tsx:352-358`). Only new relationship invitations read the flag live.
3. For a mediated v2 setup the build must also have `MEDIATOR_V2_URL` set (an invitation to a second, v2-capable mediator deployment). With the flag on and no URL, the wallet logs why and carries on with v1 only, and v2 invitations fall back to unmediated routing (verified: `keyring-wallet: app/src/hooks/useBCAgentSetup.ts:125-141`, `:160`). The variable is declared, empty, in `keyring-wallet: app/.env.sample:12`.
4. The wallet's own end-to-end runbook drives this with `yarn e2e:vrc:didcomm-v2` and related scripts, using a local mediator started with `--didcomm-v2` (verified: `keyring-wallet: e2e/README.md:13-16`, `:25`). Whether the flag can be set without the UI (for example by seeding the stored value) is **unknown**.

## What it changes

With the flag on (all verified unless marked):

- The agent is built with `didcommVersions: ['v1','v2']` instead of `['v1']`, uses `did:peer:2` for v2 out-of-band invitations ("the VTI stack resolves numalgo 2 only"), auto-creates the inviter's connection on the first v2 message (v2 out-of-band has no handshake), and lists `v2` for mediation protocol versions: `keyring-wallet: app/src/utils/bc-agent-modules.ts:111-121`, `:152-156`; wired from the stored flag at `keyring-wallet: app/src/hooks/useBCAgentSetup.ts:214`.
- Coordinate Mediation 2.0 is provisioned against `MEDIATOR_V2_URL` and a second Pickup 4.0 loop is started after the v1 pickup: `keyring-wallet: app/src/hooks/useBCAgentSetup.ts:116-160`, `:364`.
- New relationship invitations become Out-of-Band 2.0 on `did:peer:2`, but only if the agent was actually built with v2 support; otherwise the wallet logs a warning and mints a v1 invitation: `keyring-wallet: bifold/packages/core/src/modules/vrc/vrc-manager.ts:2815-2848`; flag state in `keyring-wallet: bifold/packages/core/src/modules/trust-tasks/ceremony.ts:107-119`.
- Carriage choice stays per connection: a connection that speaks v2 carries trust-task documents with the DIDComm v2 binding, a v1 connection with the v1 binding, and the separate TSP developer flag overrides both with a TSP envelope on whichever DIDComm version the connection uses: `keyring-wallet: bifold/packages/core/src/modules/trust-tasks/ceremony.ts:122-146`. The documents themselves are not rewritten between carriages (the code comment says byte-identical; inferred as to the claim's accuracy).
- The wallet's v2 binding rules (thread correlation, first contact) live in `keyring-wallet: bifold/packages/trust-tasks/src/v2Binding.ts:1-20`.

## The VTA leg: VtiMediatorTransport

`keyring-wallet: bifold/packages/core/src/modules/trust-tasks/module/VtiMediatorTransport.ts:1-40` is a DIDComm v2 transport for the mediator style that VTI agents advertise (challenge, authenticate, a socket per DID, Pickup 3.0 live delivery, Routing 2.0 forward), which also carries TSP frames on the same socket (verified from its header comment). It is a separate module from the developer switch: a search of the trust-tasks module for the switch's reader found no use of the flag inside this file (verified). Whether the transport is reached only when the flag is on, or whenever a peer advertises such a mediator, is **unknown**.

## What it could unlock for the harness (inferred, nothing tried)

| Harness piece | Possible effect |
|---|---|
| The VTA leg (adapters that today reach VTI only over HTTPS or in process) | A wallet with v2 on and a VTA's mediator reachable is the one path in the wallet code that speaks to a VTA over the carrier a VTA actually advertises. It could let a later run exercise a wallet-to-VTA exchange. Not tried. |
| The wallet's inbox handlers (today measured over a shim carrier) | A real v2 connection would carry documents to the same handlers the shim reaches, which could separate "logic follows the standard" from "the real wire does". Not tried. |
| TSP | The wallet carries TSP envelopes on a v2 connection when both flags are on; the wallet's runbook has scripts for it (`keyring-wallet: e2e/README.md:15-16`). |
| The witness server in v2 mode (`WITNESS_DIDCOMM_VERSIONS=v1,v2`, see [13-didcomm-carrier-and-witness-server.md](13-didcomm-carrier-and-witness-server.md) section 8) | The witness server accepts v2 connections and publishes an out-of-band/2.0 invitation when that variable lists v2 (`keyring-wallet: bifold/packages/witness-server/src/config.ts:24-28`, `:630-640`). The wallet's own end-to-end runs pair a v2 wallet with that server mode (`keyring-wallet: e2e/README.md:14`). That is a working reference for the suite's experimental v2 carrier, which in docs/13 saw no reply on 19 of 28 vectors in one run. A known-good wallet-side exchange could help tell a carrier fault from a server fault. |
| The DIDComm carrier of docs/13 | The wallet's `v2Binding.ts` rules (thread correlation, first contact with auto-created connection) are the consumer-side rules the carrier must also meet; the setting `autoCreateConnectionOnFirstMessage` is the kind of detail that can explain missing replies (the wallet's own comment records that it was the cause of an earlier finding). Inferred; not tested against the carrier. |

## What remains unknown

- Whether the option works end to end today (the code and its runbook say it was exercised on emulators; nothing here re-ran it).
- Whether the flag can be set outside the UI, and whether a headless harness can reach the same code paths.
- Which v2 mediator deployment to point `MEDIATOR_V2_URL` at for a harness run, and whether VTI's mediator style is reached only with the flag on.
- Whether the v2 binding the wallet sends matches `binding/didcomm` 0.2 as the carrier implements it, byte for byte.
- Anything about performance or stability beyond the word "experimental" in the label.

## How the suite measures the v2 row

The suite's DIDComm adapter for the wallet runs headlessly over v2 as well as v1 ([18-keyring-wallet-over-didcomm.md](18-keyring-wallet-over-didcomm.md)), as implementation `keyring-wallet-didcomm-v2`. Like the v1 row it declares `platform: keyring-wallet`, so the wallet's exceptions apply to it and an exception that a v2 result no longer meets fails as stale. A v2 run recorded with that declaration gates keyring-wallet like the v1 row: the at-a-glance generator refuses to show it as a not-gating experimental note and needs it listed as a surface (`recordedPlatform` in `src/glance/model.ts`). The recorded v2 folder predates the declaration and stays a not-gating experimental note.

Nothing else on this page is a result.
