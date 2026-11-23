# keyring-wallet roles: evidence for the `kw_role` column

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

Evidence for the `kw_role` column of [task-census.tsv](task-census.tsv): what keyring-wallet (KW) does with each of the 191 task types its source names. The column exists so the KW denominator of the coverage figures counts the types KW **sends**, not the types it only receives or only names.

- `sent`: a non-test code path builds and sends a document of this type, or names it in a version ladder the wallet steps down through (it is sent at that version when the agent refuses a newer one).
- `received`: the wallet only reads it inbound (an unsolicited-document list, an inbound handler).
- `both`: both of the above, each shown.
- `declared-only`: named in a rule list, capability table, phrase table, unused constant or comment, and neither sent nor received.

Counts: sent 153, declared-only 13, received 14, both 11. KW sends = sent + both = 164.

## Method

Each type was looked up in KW's non-test source: the full type string, the `${SPEC}slug/version` form, the `@openvtc/trust-tasks/<slug>/<version>/payload` imports, and the slug-plus-version builders (`joinWire`, `TASK_ERROR` plus version). Then each hit was read: a builder or a send call (sent), a comparison on an inbound type or the `UNSOLICITED` set (received), a list, rule or comment (declared-only). The version ladders (`VTA_TASK_VERSIONS`, `KEYS_ACT_TYPES`, `OFFERS_LIST_TYPES`, `POLL_GENERATIONS`, `approveResponseTypesFor`, the device and vault ladders) count as sent, because the wallet sends the older entry on a step-down. Test files were not read as evidence.

Paths below are relative to `<kw tree>/bifold/packages/core/src/`, except those starting with `app/`, which are relative to `<kw tree>/`. Evidence is by file and identifier, not line number.

## Corrections to the emit report's list

The list the emit-hooks work recorded (types the wallet only receives or has no sender for) was checked, not taken on trust. Differences:

- `trust-task-error/0.5`: listed with no sender. It is sent (vtiVetting.ts refusals). Role `both`.
- `credential-exchange/present/0.1`: listed with no sender. It is sent (ceremony.ts, the holder's reply to a verifier query; `respondToCredentialExchangeQuery`). Role `sent`.
- `credential-exchange/issue/0.1`: listed with no sender. The wallet as vetter sends it to the applicant. Role `both`.
- `credential-exchange/query/0.1`: no sender, correct; it is received (holder side). Role `received`.
- `credential-exchange/request/0.1`: the report listed no document sender, which is right for a DIDComm document; the wallet does send a request of this type, as a REST `POST` with the type in the `Trust-Task` header (vtiInvitationOffer.ts). Role changed from `declared-only` to `sent` (see its row).
- `rooms/keys/browse/0.2`: listed as received. The source says it is only held in the read-lane list. Role `declared-only`.
- `vta/contexts/get/1.0`, `vta/webvh/dids/delete/1.0`: listed with the received types. Neither is received; both are declared-only.
- Not on the list, found declared-only: `vtc/vetting/revoke-statement/0.1`, `vtc/vetting/vetters/list/0.1`.
- Confirmed as listed: the five step-up approve-request versions, task-consent request and granted, submit-receipt, removal-notice, request-vmc, credential-exchange offer (received); rooms/keys/present/0.2, rooms/records/put/0.4, join-requests/decide, invitations issue and deliver, keys/sign and keys/revoke, vetting/vetters/grant, trust-task-error 0.1 and 0.6 (no sender).

## Types

| Type | Role | Evidence |
|---|---|---|
| `config/show/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `provision/vta/claim/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/vtaClaim.ts`. |
| `provision/vta/redeem/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/vtaClaim.ts`. |
| `vta/contexts/create/1.0` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `vta/contexts/delete/1.0` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `vta/contexts/delete/1.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `vta/contexts/get/1.0` | declared-only | modules/trust-tasks/screens/requestWords.ts only: a table of plain-language phrases for requests the phone may be shown. No builder, no handler. |
| `vta/contexts/list/1.0` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `vta/webvh/dids/create/1.0` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `vta/webvh/dids/create/1.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `vta/webvh/dids/create/1.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `vta/webvh/dids/delete/1.0` | declared-only | modules/trust-tasks/module/approvalRules.ts `OFFERED_TASKS`: a task type the "Ask me before" screen may put a rule on; the file says "None is sent by this phone". No builder. |
| `vta/webvh/dids/list/1.0` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `vta/webvh/dids/rotate-keys/1.0` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/vtaRotation.ts`. |
| `vta/webvh/servers/list/1.0` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `auth/step-up/approve-request/0.1` | received | modules/trust-tasks/module/stepUp.ts: `STEP_UP_REQUEST_TYPES` lists the request versions the phone reads; modules/trust-tasks/module/VtaClient.ts: `UNSOLICITED` set takes them as inbound documents. No code builds one. |
| `auth/step-up/approve-request/0.2` | received | modules/trust-tasks/module/stepUp.ts: `STEP_UP_REQUEST_TYPES` lists the request versions the phone reads; modules/trust-tasks/module/VtaClient.ts: `UNSOLICITED` set takes them as inbound documents. No code builds one. |
| `auth/step-up/approve-request/0.3` | received | modules/trust-tasks/module/stepUp.ts: `STEP_UP_REQUEST_TYPES` lists the request versions the phone reads; modules/trust-tasks/module/VtaClient.ts: `UNSOLICITED` set takes them as inbound documents. No code builds one. |
| `auth/step-up/approve-request/0.4` | received | modules/trust-tasks/module/stepUp.ts: `STEP_UP_REQUEST_TYPES` lists the request versions the phone reads; modules/trust-tasks/module/VtaClient.ts: `UNSOLICITED` set takes them as inbound documents. No code builds one. |
| `auth/step-up/approve-request/0.5` | received | modules/trust-tasks/module/stepUp.ts: `STEP_UP_REQUEST_TYPES` lists the request versions the phone reads; modules/trust-tasks/module/VtaClient.ts: `UNSOLICITED` set takes them as inbound documents. No code builds one. |
| `auth/step-up/approve-response/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/stepUp.ts`. |
| `auth/step-up/approve-response/0.5` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/stepUp.ts`. |
| `auth/step-up/approve-response/0.6` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/stepUp.ts`. |
| `auth/step-up/approve-response/0.7` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/stepUp.ts`. |
| `task-consent/decision/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `task-consent/decision/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/oobSignInAgent.ts`, `modules/trust-tasks/module/VtaClient.ts`. |
| `task-consent/granted/0.1` | received | modules/trust-tasks/module/VtaClient.ts: in `UNSOLICITED` and read by the inbound check (`body.type === consentGranted`); vtaAgent.ts reads it. Never built. |
| `task-consent/request/0.1` | received | modules/trust-tasks/module/VtaClient.ts: in `UNSOLICITED` (pushed by the agent); modules/trust-tasks/module/vtaAgent.ts and consentCheck.ts read it. The wallet answers with `task-consent/decision`; it builds no request. |
| `trust-task-discovery/0.1` | both | Sent: modules/trust-tasks/ceremony.ts `sendDiscoveryQuery` builds the query (`type: discovery.TYPE_URI`, from `@openvtc/trust-tasks/trust-task-discovery/0.1/payload`); modules/trust-tasks/module/VtaClient.ts lists it in the discovery ladder (`discovery: [DISCOVERY_TASK_03, DISCOVERY_TASK]`, `DISCOVERY_TASK` from pcsVtaPayloads.ts) so it is sent when an agent does not serve 0.3. Received: ceremony.ts `handleInboundDiscovery` answers a peer's query with `discovery.RESPONSE_SPEC`. Family FW (framework row). The 0.3 version has its own row below. |
| `trust-task-discovery/0.3` | sent | Sent: modules/trust-tasks/module/pcsVtaPayloads.ts `DISCOVERY_TASK_03` (`https://trusttasks.org/spec/trust-task-discovery/0.3`) is the first entry of the discovery ladder in modules/trust-tasks/module/VtaClient.ts (`discovery: [DISCOVERY_TASK_03, DISCOVERY_TASK]`, comment "0.3 first"), so the wallet asks the agent for 0.3 and steps down to 0.1 only when the agent refuses it. Never received: no inbound handler names it (`handleInboundDiscovery` in ceremony.ts answers with the 0.1 response spec). Family FW (framework row, not a coverage family). The row was added to the wallet's used_by on 2026-11-18; before that the census held it for VTA and VTC only. |
| `trust-task-error/0.1` | received | No non-test source names the string `trust-task-error/0.1`, so the wallet never sends this version. It reads every version of the family by prefix in the inbound paths: modules/trust-tasks/module/VtaClient.ts (`String(body?.type ?? '').startsWith(TASK_ERROR)` in the ask path), modules/trust-tasks/module/vtiAgent.ts, modules/trust-tasks/module/hiddenVetterRounds.ts (`askCommunity`: `answered.startsWith(TASK_ERROR)`), modules/trust-tasks/module/vtiVetting.ts (`type.startsWith(TASK_ERROR)`; its `refused` handler reads only 0.5, 0.3 until `LEGACY_ERROR_03_UNTIL`, and 0.6 as 0.5, so a 0.1 refusal is logged "not read" there but is read as a refusal in the other paths). Role unchanged (`received`), re-checked 2026-11-18. |
| `trust-task-error/0.5` | both | Sent: modules/trust-tasks/module/vtiVetting.ts `TASK_ERROR_TYPE` (0.5) is the type of the refusal the vetter signs and sends (`refuse`). Received: the same file reads a peer's 0.5 refusal. The emit report listed it as having no sender; the source shows one. |
| `trust-task-error/0.6` | received | modules/trust-tasks/module/vtiVetting.ts: `TASK_ERROR_EXTENDS` reads 0.6 as 0.5 and the code comment says "Keyring reads 0.6 but does not send it". |
| `trust-task-next-step/0.1` | both | Sent: modules/trust-tasks/ceremony.ts `buildHoldNextStep` builds the next-step (`type: nextStep.TYPE_URI`, imported from `@openvtc/trust-tasks/trust-task-next-step/0.1/payload`) for a propose held for consent, sent from the hold path that calls it (`buildHoldNextStep(document, context, utils.uuid())`). Received: modules/trust-tasks/module/vtaClaim.ts `NEXT_STEP_TASK` (`'https://trusttasks.org/spec/trust-task-next-step/0.1'`) is the type the Farm answers a claim with, checked in the claim handler (`body.type !== NEXT_STEP_TASK`). Family FW (framework row). |
| `vtc/directory/card/show/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/directory/wire.ts`. |
| `vtc/directory/card/update/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/directory/wire.ts`. |
| `vtc/directory/entries/list/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/directory/wire.ts`. |
| `vtc/directory/entries/list/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/directory/wire.ts`. |
| `vtc/directory/entries/show/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/directory/wire.ts`. |
| `vtc/directory/fields/list/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/directory/wire.ts`. |
| `vtc/directory/images/get/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/directory/wire.ts`. |
| `vtc/directory/images/upload/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/directory/wire.ts`. |
| `vtc/directory/query/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/directory/wire.ts`. |
| `vtc/invitations/deliver/0.1` | declared-only | Appears only in the comment of modules/trust-tasks/module/vtiInvitationOffer.ts, which describes how the community delivers; the phone reads the resulting offer (see credential-exchange/offer). No builder, no handler. |
| `vtc/invitations/issue/0.1` | declared-only | Appears only in the comment of modules/trust-tasks/module/vtiInvitation.ts (an admin console issues it; the phone opens a link). No builder, no handler. |
| `vtc/join-requests/decide/0.1` | declared-only | Appears only in a comment of modules/trust-tasks/module/vtiJoin.ts. No builder, no handler. |
| `vtc/join-requests/manifest/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `app/src/screens/Developer.tsx`. |
| `vtc/join-requests/manifest/0.3` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/joinManifest.ts`, `modules/trust-tasks/module/vtiAgent.ts`. |
| `vtc/join-requests/manifest/0.4` | sent | modules/trust-tasks/module/joinWire.ts: `MANIFEST_WIRES = ['0.4', '0.3', '0.2']` (newest first) and `manifestTaskType`, `JOIN_MANIFEST_TYPES` ("every manifest `type` this wallet may send: each is a read"); `manifestWiresToTry` asks 0.4 first. The census held 0.4 as a community-only type (VTC); the wallet's own version list names it, so KW is added to `used_by`. |
| `vtc/join-requests/status/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/vtiAgent.ts`. |
| `vtc/join-requests/submit-receipt/0.1` | received | modules/trust-tasks/module/vtiCommunityNotices.ts: `receiveCommunityNotice` reads it; modules/trust-tasks/module/vtiPersonaInbox.ts routes it. The community sends it; no wallet builder. |
| `vtc/join-requests/submit/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `app/src/screens/Developer.tsx`. |
| `vtc/join-requests/submit/0.3` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/hiddenVetting.ts`. |
| `vtc/join-requests/supplement/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/vtiAgent.ts`. |
| `vtc/join-requests/withdraw/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/vtiAgent.ts`. |
| `vtc/members/removal-notice/0.1` | received | modules/trust-tasks/module/vtiCommunityNotices.ts (`REMOVAL_NOTICE`, read by `receiveCommunityNotice`); vtiPersonaInbox.ts routes it. No wallet builder. |
| `vtc/members/renew/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/vtiCardRenewal.ts`. |
| `vtc/members/request-vmc/0.1` | received | modules/trust-tasks/module/vtiReciprocate.ts: answers an inbound request (`message.type !== REQUEST_VMC`); vtiPersonaInbox.ts routes it. The wallet replies with `vtc/members/vmc`; it never sends request-vmc. |
| `vtc/members/self-remove/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/vtiAgent.ts`. |
| `vtc/members/vmc/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/vtiMemberVmc.ts`. |
| `vrc/relationships/issue/0.1` | both | Sent: modules/trust-tasks/ceremony.ts (`type: issue.TYPE_URI`). Received: registered with `handleInboundIssue` (`registerBuiltinTrustTasks`). |
| `vrc/relationships/propose/0.1` | both | Sent: modules/trust-tasks/ceremony.ts builds and sends `propose.TYPE_URI`. Received: the same file registers `handleInboundPropose` in the type registry (`registerBuiltinTrustTasks`). |
| `vrc/relationships/witness-share/0.1` | both | Sent: modules/trust-tasks/ceremony.ts (`type: witnessShare.TYPE_URI`). Received: registered with `handleInboundWitnessShare` (`registerBuiltinTrustTasks`). |
| `witness/session/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/ceremony.ts`, `modules/trust-tasks/witnessCeremony.ts`. |
| `witness/session/submit/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/ceremony.ts`, `modules/trust-tasks/witnessCeremony.ts`. |
| `rooms/blobs/chunk/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`. |
| `rooms/blobs/get/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`. |
| `rooms/blobs/upload/abort/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/files/upload.ts`. |
| `rooms/blobs/upload/begin/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/files/upload.ts`. |
| `rooms/blobs/upload/chunk/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/files/upload.ts`. |
| `rooms/blobs/upload/commit/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/files/upload.ts`. |
| `rooms/keys/act/0.5` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`. |
| `rooms/keys/act/0.6` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`. |
| `rooms/keys/act/0.8` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`. |
| `rooms/keys/act/0.9` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`. |
| `rooms/keys/backfill/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`. |
| `rooms/keys/browse/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/capabilities.ts`, `modules/rooms/real/wire.ts`. |
| `rooms/keys/browse/0.2` | declared-only | modules/trust-tasks/module/vtaReadLane.ts `VTA_READ_LANE_TYPES` names it; the comment there says "browse 0.2 is held here, and the ladder (`browseType`) sends 0.3 or 0.1". The emit report listed it as received; it is neither sent nor received. |
| `rooms/keys/browse/0.3` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/capabilities.ts`, `modules/rooms/real/wire.ts`. |
| `rooms/keys/file-key/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/capabilities.ts`, `modules/rooms/real/wire.ts`. |
| `rooms/keys/key-package/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`. |
| `rooms/keys/list/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/capabilities.ts`, `modules/rooms/real/wire.ts`. |
| `rooms/keys/list/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/capabilities.ts`, `modules/rooms/real/wire.ts`. |
| `rooms/keys/present/0.2` | declared-only | modules/rooms/capabilities.ts `agentAccess` capability declaration only. No builder, no handler. |
| `rooms/keys/read/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/capabilities.ts`, `modules/rooms/real/wire.ts`. |
| `rooms/keys/seal/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`. |
| `rooms/keys/welcome/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`. |
| `rooms/records/curate/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`. |
| `rooms/records/put/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`. |
| `rooms/records/put/0.3` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`. |
| `rooms/records/put/0.4` | declared-only | Appears only in a comment of modules/rooms/real/wire.ts. The record-write ladder in modules/rooms/real/agentRoomsService.ts holds `recordsPut03` and `recordsPut` only. |
| `vtc/rooms/memberships/list/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`, `modules/trust-tasks/module/vtiAgent.ts`. |
| `vtc/rooms/offers/accept/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`. |
| `vtc/rooms/offers/list/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`. |
| `vtc/rooms/offers/list/0.3` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`. |
| `vtc/rooms/offers/list/0.4` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`. |
| `acl/grant/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `acl/grant/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `acl/list/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`, `modules/trust-tasks/module/vtaDevices.ts`. |
| `acl/list/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`, `modules/trust-tasks/module/vtaDevices.ts`. |
| `acl/list/0.3` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`, `modules/trust-tasks/module/vtaDevices.ts`. |
| `acl/revoke/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`, `modules/trust-tasks/module/vtaDevices.ts`. |
| `acl/revoke/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`, `modules/trust-tasks/module/vtaDevices.ts`. |
| `acl/swap-key/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `acl/update/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `acl/update/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `auth/oob/cancel/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/oobSignIn.ts`. |
| `auth/oob/claim/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/oobSignIn.ts`. |
| `auth/oob/claim/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/oobSignIn.ts`. |
| `auth/oob/grant/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/oobSignIn.ts`. |
| `auth/oob/grant/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/oobSignIn.ts`. |
| `auth/oob/grant/0.3` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/oobSignIn.ts`. |
| `auth/oob/identify/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/oobSignIn.ts`. |
| `auth/oob/prove/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/oobSignIn.ts`. |
| `auth/oob/prove/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/oobSignIn.ts`. |
| `auth/oob/prove/0.3` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/oobSignIn.ts`. |
| `auth/oob/respond/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/oobSignIn.ts`. |
| `auth/oob/respond/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/oobSignIn.ts`. |
| `auth/oob/respond/0.3` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/oobSignIn.ts`. |
| `auth/revoke-session/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `auth/whoami/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `credential-exchange/issue/0.1` | both | Sent: modules/trust-tasks/module/vtiVetting.ts sends it to the applicant (`vtiAgent.send(..., CREDENTIAL_EXCHANGE_ISSUE, ...)`). Received: vtiVetting.ts `receiveStatement` and modules/trust-tasks/module/vtiInbox.ts (`isIssue`). The emit report listed it as having no sender. |
| `credential-exchange/offer/0.1` | received | modules/trust-tasks/module/vtiInvitationOffer.ts: reads a pushed offer (`plaintext.type !== CREDENTIAL_EXCHANGE_OFFER`); nothing builds one. |
| `credential-exchange/present/0.1` | sent | Sent: modules/trust-tasks/ceremony.ts `respondToCredentialExchangeQuery` builds a `type: credentialExchangePresent.TYPE_URI` document on the query's thread after the person consents. The emit report listed it as having no sender. |
| `credential-exchange/query/0.1` | received | modules/trust-tasks/ceremony.ts: inbound handler (`type === credentialExchangeQuery.TYPE_URI`) and advertised in `SUPPORTED_TASK_TYPES`; the holder side. No code sends a query. |
| `credential-exchange/request/0.1` | sent | modules/trust-tasks/module/vtiInvitationOffer.ts: `CREDENTIAL_EXCHANGE_REQUEST` is the type the wallet puts in the `Trust-Task` header of the `POST {VTCRest}/v1/credential-exchange/request` it makes in the invitation-redeem function (`fetchWaitingIfBusy(... vtcRestUrl(base, 'credential-exchange/request') ...)`), with a bare `{ credential_request }` body carrying the signed `openid4vci-proof+jwt`. The file's own header comment says the wallet redeems the offer "the way the community takes it" by this request. A request of this type is sent on the wire, in the REST form of a Trust Task (type in the header, payload as the body). Role changed from `declared-only` to `sent` on 2026-11-18 (the project owner's decision: follow the wallet source); it is not a document an emit check on the DIDComm side sees. |
| `device/heartbeat/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/vtaReadLane.ts`, `modules/trust-tasks/module/vtaDevices.ts`. |
| `device/heartbeat/0.3` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/vtaReadLane.ts`, `modules/trust-tasks/module/vtaDevices.ts`. |
| `device/list/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/vtaDevices.ts`. |
| `device/list/0.3` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/vtaDevices.ts`. |
| `device/register/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/vtaDevices.ts`. |
| `device/set-wake/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/vtaDevices.ts`. |
| `device/wipe/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/vtaDevices.ts`. |
| `keys/export-secret/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `keys/revoke/0.1` | declared-only | modules/trust-tasks/module/approvalRules.ts `OFFERED_TASKS` only (a rule target the phone never sends); screens/requestWords.ts phrase table. No builder. |
| `keys/sign/0.1` | declared-only | Appears only in a comment of modules/trust-tasks/module/EphemeralKeyManagementService.ts. No builder, no handler. |
| `policy/get/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `policy/upsert/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `policy/upsert/0.3` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `push/register/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `app/src/push/pushGateway.ts`. |
| `vault/credentials/get/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`, `modules/trust-tasks/module/vtiCardVault.ts`. |
| `vault/credentials/get/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`, `modules/trust-tasks/module/vtiCardVault.ts`. |
| `vault/credentials/query/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/real/wire.ts`, `modules/trust-tasks/module/vtiCardVault.ts`. |
| `vault/credentials/receive/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/rooms/capabilities.ts`, `modules/rooms/real/wire.ts`. |
| `vault/list/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `vault/list/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `vault/list/0.3` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `vault/list/0.4` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `vault/sign-trust-task/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `vault/sign-trust-task/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `vault/upsert/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `vault/upsert/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `vault/upsert/0.3` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `vault/upsert/0.4` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/VtaClient.ts`. |
| `vetting/attestation/0.1` | both | Sent: modules/trust-tasks/module/vtiVetting.ts (`vtiAgent.send(..., VETTING.attestation, ...)`). Received: same file (`receiveAttestation`). |
| `vetting/decline/0.1` | both | Sent: modules/trust-tasks/module/vtiVetting.ts (vetter declines: `signedDocument(..., VETTING.decline, ...)`). Received: same file (the applicant reads it). |
| `vetting/request/0.1` | both | Sent: modules/trust-tasks/module/vtiVetting.ts (applicant asks a vetter: `signedDocument(..., VETTING.request, ...)` then `vtiAgent.send`). Received: same file (`isVettingRequest`, the vetter side). |
| `vetting/session/0.1` | both | Sent: modules/trust-tasks/module/vtiVetting.ts (vetter opens the session, `vtiAgent.send(..., VETTING.session, ...)`). Received: same file (`sessionOpened`, the applicant side). |
| `vetting/vetters/grant/0.1` | declared-only | Appears only in a comment of modules/trust-tasks/module/vtiInbox.ts. No builder, no handler. |
| `voting/ballot/cast/0.1` | sent | modules/polls/pollTasks.ts `POLL_TASK.cast` (`${SPEC}/voting/ballot/cast/0.1`); modules/polls/ballotBox.ts `postCast` checks `cast.recipient`, then sends the cast document with `door.post(await door.endpointOf(ballotBoxDid), cast)` and reads the answer only as `${POLL_TASK.cast}#response` (the reply to its own send, not an unsolicited inbound). The agent builds and signs the cast; the wallet stores it (`pollService.ts`, stage `cast`) and is the party that puts it on the wire. Role unchanged (`sent`), re-checked 2026-11-18. |
| `vta/pcs/applications/create/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/pcsVtaPayloads.ts`. |
| `vta/pcs/applications/delete/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/pcsVtaPayloads.ts`. |
| `vta/pcs/applications/show/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/pcsVtaPayloads.ts`. |
| `vta/pcs/attest/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/pcsVetterTasks.ts`. |
| `vta/pcs/prove/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/pcsVtaPayloads.ts`. |
| `vta/pcs/root-accept/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/pcsVetterTasks.ts`. |
| `vta/pcs/root-request/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/pcsVetterTasks.ts`. |
| `vta/pcs/tokens/abandon/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/pcsVetterTasks.ts`. |
| `vta/pcs/tokens/accept/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/pcsVetterTasks.ts`. |
| `vta/pcs/tokens/request/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/pcsVetterTasks.ts`. |
| `vta/pcs/verify-attestation/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/pcsVtaPayloads.ts`. |
| `vta/pcs/vetter/show/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/pcsVetterTasks.ts`. |
| `vta/pcs/vote/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/polls/pollTasks.ts`. |
| `vta/pcs/vote/0.3` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/polls/pollTasks.ts`. |
| `vta/pcs/vote/0.4` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/polls/pollTasks.ts`. |
| `vta/pcs/voter/accept/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/polls/pollTasks.ts`. |
| `vta/pcs/voter/receipt/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/polls/pollTasks.ts`. |
| `vta/pcs/voter/register/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/polls/pollTasks.ts`. |
| `vta/pcs/voter/register/0.3` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/polls/pollTasks.ts`. |
| `vta/pcs/voter/register/0.5` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/polls/pollTasks.ts`. |
| `vtc/elections/list/0.3` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/polls/pollTasks.ts`, `modules/trust-tasks/module/vtiAgent.ts`. |
| `vtc/elections/list/0.5` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/polls/pollTasks.ts`, `modules/trust-tasks/module/vtiAgent.ts`. |
| `vtc/elections/show/0.2` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/polls/pollTasks.ts`, `modules/trust-tasks/module/vtiAgent.ts`. |
| `vtc/elections/show/0.3` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/polls/pollTasks.ts`, `modules/trust-tasks/module/vtiAgent.ts`. |
| `vtc/elections/show/0.6` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/polls/pollTasks.ts`, `modules/trust-tasks/module/vtiAgent.ts`. |
| `vtc/vetting/pcs-challenge/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/pcsChallenge.ts`. |
| `vtc/vetting/revoke-statement/0.1` | declared-only | modules/trust-tasks/module/vtiVetting.ts: a member of the `VETTING` constant that nothing else references. Not in the emit report's list; found by this check. |
| `vtc/vetting/vetters/list/0.1` | declared-only | modules/trust-tasks/module/vtiVetting.ts: a member of the `VETTING` constant that nothing else references. Not in the emit report's list; found by this check. |
| `vtc/vetting/vetters/pcs-root/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/pcsVetterTasks.ts`. |
| `vtc/vetting/vetters/pcs-tokens/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/pcsVetterTasks.ts`. |
| `vtc/vetting/vetters/profile/0.1` | sent | The type string is defined or imported in the code that sends it (version ladders included): `modules/trust-tasks/module/vtiVetting.ts`. |
