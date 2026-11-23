# Interoperability, interworking and meta-layer roles

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

This page does two things. Part 1 summarises a working-draft slide deck that separates three words people often mix up. Part 2 says how this suite uses those words and, platform by platform, what the recorded results do and do not show.

## Part 1. The deck (attributed summary)

**Source.** M. Kolpondinos (Kosma Connect, Trust Stackers, DTG), *Interoperability, Interworking, Meta-layer Roles — or something else? Making sure we are talking about the same thing*, Interopathon, CA, 9 Nov 2026. **Working draft for discussion**, 9 slides. Byline as printed on the deck. The deck is not copied into this repository; this is a summary, and everything in Part 1 is the deck's content, not this repository's. Credit: [CREDITS.md](CREDITS.md).

### The three words and the question each asks

| | Interoperability | Interworking | Meta-layer roles |
|---|---|---|---|
| If we say it, we are... | committing to a shared standard that every participant adopts | accepting that systems stay different and funding a translator | designing the layer above the systems: roles, accountabilities, governance |
| The decision it forces | Which standard, which profile, how conformance is tested | Who runs the gateway, what is lost in mapping, who can override it | Who may hold which role, and who can contest a role-holder's decision |
| Question | Can A and B exchange information and use it, directly? | Can A and B be made to work together, without changing either? | Who plays which role in the layer that lets many systems coexist, and under whose rules? |

### Definitions and who owns the term

- **Interoperability.** The degree to which two or more systems can exchange information and use what has been exchanged (ISO/IEC/IEEE 24765). ISO/IEC 2382 adds: with little or no knowledge of the other unit's unique characteristics. Both sides implement the same agreed standard; no translator in the middle. The term is owned by the general IT-standards world (ISO/IEC, IEEE, ETSI); telecom glossaries (ATIS, FCC) phrase it as resources providing and accepting services from each other.
- **Interworking.** The functions and requirements that let networks or services with different capabilities communicate (ITU-T I.501 / I.510). In practice: mapping a message, address or service in one protocol to its counterpart in another, done by an interworking function (IWF) or gateway. The vocabulary comes from telecommunications (ITU-T Study Group 13, network interworking, Y.1401; ISDN / B-ISDN recommendations; OSI gateway literature) and was later reused for SIP-H.323, GSM-TIA-41 and OAM interworking.
- **Meta-layer roles.** Not a standardized term. The deck's working definition (the author's): the set of roles, accountabilities and rules defined at a layer that spans several otherwise different systems, so they can coexist without adopting one standard or routing through one gateway. Two lineages are named: Cameron's identity metasystem (2005: one encapsulating protocol over many identity systems; roles identity provider, relying party, subject) and Trust over IP (a trust spanning layer, the hourglass model, with a governance metamodel that defines layer-specific roles).

### Distinctions that matter (as the deck lists them)

- **Interoperability** has degrees: *technical* (can the connections be established at all), *syntactic* (are the formats mutually parseable: XML, JSON, SQL), *semantic* (does the data mean the same on both sides), and *organizational / business-process* (do the institutions work together; ETSI ETR 130 adds protocol, service, application and user-perceived interoperability).
- **Interworking** has: network interworking (different networks carry the same service end to end); service interworking (the service itself is mapped, for example fax relay to voiceband data); native versus emulated interworking (how faithfully the IWF reproduces the far side); gateway versus bridge/router (gateways convert protocols; bridges and routers forward).
- **Meta-layer roles** include: Cameron roles (identity provider, relying party, subject); ToIP governance roles (governing authority, administering authority, <!-- lint:skip -->certification body<!-- /lint:skip -->, governed roles per layer); ToIP technical roles (endpoints, intermediaries, trust support services). Trust-triangle roles (issuer, holder, verifier) are layer roles, not meta-layer roles.

### Where the cost lands

- **Interoperability:** every participant. It is reached by adoption: each party implements the agreed standard and conformance profile. Nobody has to be trusted in the middle, but everyone waits for everyone else.
- **Interworking:** the middle party. Nobody changes their protocol; someone builds, runs and is trusted with the IWF. Mapping can be lossy, and the gateway becomes both a chokepoint and (in the deck's vocabulary) a paternalism point: it decides what crosses.
- **Meta-layer roles:** governance. No protocol changes; what everyone accepts is who may hold which role and who sets the rules. Failure mode: role-holders become de-facto gatekeepers, and the term stays vague enough that nobody can contest them.

### The comparison table (slide 7)

| | Interoperability | Interworking | Meta-layer roles |
|---|---|---|---|
| Core question | Do we speak the same standard? | Can something in the middle translate? | Who holds which role, and who sets the rules? |
| Where the difference lives | Nowhere, ideally: both sides conform | At the boundary, in the gateway / IWF | Below the layer: systems differ; the layer defines roles and rules |
| Who has to change | Every participant (adopt the standard) | Nobody: you add a translator | Nobody's protocol, but everyone accepts role definitions and governance |
| Typical artefacts | Specs, conformance profiles, test suites | Mapping tables, IWF / gateway specs, bridges | Role definitions, governance frameworks, spanning protocol |
| Strength | Scales cleanly; no middle party to trust | Fast; preserves existing investments | Lets different systems coexist without forcing one standard |
| Failure mode | Everyone waits for everyone else to adopt | Lossy mapping; gateway becomes a chokepoint and a paternalism point | Term stays vague; role-holders become de-facto gatekeepers |
| Lineage | ISO/IEC, IEEE, ETSI | ITU-T, OSI gateways, telecom | Cameron (2005) metasystem; ToIP stack and governance metamodel |

### Open points the deck itself lists (at time of drafting)

1. "Meta-layer roles" has no authoritative definition. No standard or widely cited source was found; the deck uses the two closest lineages and asks the group to confirm what it means before adopting that framing.
2. Interoperability versus interworking is not a universal split. Much industry writing uses the two interchangeably; the direct-versus-mediated distinction follows ITU-T / ETSI usage.
3. Name collision with the IETF "The Meta-Layer" draft (Oct 2025), which proposes a web annotation / presence / governance substrate: same words, different topic.
4. The ISO/IEC 2382 wording is second-hand: the standard is paywalled and the definition is taken from secondary sources that quote it.

### Sources the deck lists

ISO/IEC 2382 (via secondary sources); ISO/IEC/IEEE 24765:2009; ETSI ETR 130 (1994); ITU-T I.510 and I.501; ITU-T Y.1401; Cameron, K. (2005), *The Laws of Identity; Microsoft's Vision for an Identity Metasystem*; Trust over IP Foundation, Technology Architecture Specification v1.0 and Governance Metamodel Specification v1.0 (2021); the ToIP blog *The ToIP Trust Spanning Protocol* (2023) and Davie et al. (2019), *The Trust over IP Stack*, IEEE Communications Standards Magazine; IETF draft-meta-layer-overview-00 (Oct 2025), noted only to flag the name collision.

## Part 2. How this suite uses it (the repository's reading, not the deck's)

The layer model ([01-layer-model.md](01-layer-model.md)) used in the orientation diagram was proposed by Brendan A. Miller, built on the standard Trust over IP model. The mapping below is this repository's reading of the deck's vocabulary; the deck does not make it, and it should be read as proposed wording.

- **The suite measures conformance to the standard, platform by platform. It does not measure interoperation between platforms.** The suite writes the expected behaviour of a shared standard (the Trust Tasks framework, plus a proposed profile) as vectors, and checks each implementation against the same vectors with no translator in the measured path. The deck's four degrees are used as the way to say how far: technical, syntactic, semantic, organizational. Conformance-implied agreement (both platforms did what the vector expects, each measured alone) is recorded in the pair matrix ([14-interoperability-tracking.md](14-interoperability-tracking.md)); demonstrated interoperation (a recorded exchange between two platforms) has not been recorded.
- **Interworking is relevant where a gateway or translator sits between systems and is not what the suite measures.** Examples in this repository: an HTTPS carrier versus a DIDComm carrier, and the suite's shim carrier that stands in for a carrier a platform does not offer over HTTPS. A passing result through a shim says the platform's logic follows the standard; it does not say the platform's real wire does, and it says nothing about any gateway.
- **Meta-layer roles relate to the ceremony roles and governance parts of the layer model**, a different question from wire conformance: who may hold which role and who sets the rules. The suite's ceremony vectors check how ceremony documents behave (for example approvals and receipts); they do not check who is allowed to hold a role or how a role-holder's decision is contested. The suite does not measure meta-layer roles.

### Read this first

These tables describe what is recorded for each platform. They are not a ranking. The authority order is the specifications, then VTI, then keyring-wallet, then truststackers (original); VTI and keyring-wallet are the anchors. VTI's and keyring-wallet's SKIPs are limits of our adapters' reach, not defects. Where an authoritative implementation differs from a vector, the vector and the specification text are re-examined first (vector review: done, see [vector-review.md](../results/vector-review.md)).

### How to read the per-platform tables

Rows: the four degrees of interoperability, then interworking, then meta-layer roles. Status words, used only on recorded evidence:

| Status | Meaning here |
|---|---|
| Achieved in tests | The suite's vectors for that degree ran against this platform and the platform did what the vectors expect, for the part that ran (conformance measured, not interoperation demonstrated). Not a live exchange with another platform. |
| Partly | Conformance-implied only. Some vectors for that degree ran and matched; others differ, were not run (SKIP), or the path measured is not the real one. |
| Not shown | Nothing recorded demonstrates it (mostly because the vectors for it were SKIP). A SKIP is never counted as a PASS. |
| Not measured | The suite has no vectors for this question. |

The group-level counts in the Evidence columns below are historical: Tier 1, as PASS / CLARIFY / SKIP / KNOWN-FAIL / FAIL, written per surface on the earlier vector sets (on the 384-vector set, 2026-11-15; superseded; the VTI live-service row on the still earlier 364-vector set). They show which groups each surface reached; for current figures use the generated Coverage and Vector families tables and the platform pages under results/platforms/. A CLARIFY rests on a point the specifications leave open and is not a failure. Sources: results/README.md and the run folders under `<results dir>/runs/` (kept outside this repository, [docs/04 section 21](04-suite-design.md#21-where-run-records-live-built)), [05-reference-implementations.md](05-reference-implementations.md), and the maintainers' internal reports on the carriers and adapters. Degrees are assigned to vector groups by this repository (for example envelope, error, proof and time groups to syntactic; relationship-credential and witness-share groups to semantic; ceremony groups to organizational); that assignment is a judgement and is open to change.

### VTI (verifiable-trust-infrastructure)

- **Authority.** Most authoritative implementation after the specifications (anchor 1 of 2).
- **Independence of the result.** Not built against this suite. Where the specifications are silent, the suite takes VTI's existing behaviour as the expectation.
- **Reach.** VTI has two measured surfaces, shown as two rows and never added together or ranked, because they measure different services. The live community service over HTTPS (recorded earlier, not re-run on the current set): our adapter reaches only the HTTPS door and the service serves a small set of task types; it has no proof-verification entry on the wire and does not serve the relationship-credential, witness-share or ceremony types). The agent service's handlers run in process (it adds proof verification, credential issue, and the holder side of `credential-exchange/query` and `offer` 0.1). The rest were not run because of these limits of reach, not defects. Current reach for every surface: results/README.md.
- **Agreement on what ran.** Current verdicts per surface are generated in results/README.md; each recorded difference, with its class (A to D), is in [results/vector-review.md](../results/vector-review.md) and `exceptions/`. Most of the live service's differences come from one behaviour: a proof that does not verify is answered `permissionDenied` where the framework text asks for `proofInvalid`; the HTTPS door does not read the `Authorization` header (open in the text).
- **What this does and does not show.** Shows how VTI behaves on the two parts we could reach (the live service over HTTPS; the agent handlers in process), with a few narrow named differences. Each row measures a different service, so neither is a statement about VTI as a whole. Does not show VTI's DIDComm or TSP carriers, or any ceremony behaviour.

Two surfaces are measured; they are different services and are not added together or ranked. The first table is the live community service; the second is the agent handlers in process.

Surface 1, measured: a live VTC service (vtc-service 0.20.0) over its HTTPS door, framework behaviour only. Recorded earlier and not re-run on the current set; figures: results/README.md.

| Row | Status | Evidence (historical counts; superseded) | What is missing |
|---|---|---|---|
| Interoperability, technical | Partly (conformance-implied) | The service answers trust-task documents over HTTPS: envelope 13 of 14, binding 4 of 7, control 3 of 4 and discovery 8 of 17 pass. | DIDComm and TSP carriers were not exercised. The `Authorization` header is not read (BND-002, KNOWN-FAIL). No live exchange with another platform is recorded. |
| Interoperability, syntactic | Partly (conformance-implied) | Envelope group passes 13 of 14; errors 2 pass, 3 CLARIFY, 2 KNOWN-FAIL; proofs 2 pass. | 31 proof-verification vectors need a capability the service does not offer on its wire (SKIP). A proof that is present but does not verify is answered `permissionDenied` where the framework text asks for `proofInvalid` (6 Tier 1 vectors KNOWN-FAIL). |
| Interoperability, semantic | Not shown | Relationship-credential (44), witness-share (23), ceremony (16), credential-exchange (18), task-consent (18) and two-phase-commit (8) groups are all SKIP: the service does not serve those task types. | Whether VTI and another platform agree on what a credential, share or approval means is not measured. |
| Interoperability, organizational | Not shown | Ceremony groups are SKIP, as above. | Any multi-party ceremony behaviour. |
| Interworking | Not shown | No translator sits in the measured path; the adapter speaks HTTPS to VTI directly. Internal reports note that VTI also serves DIDComm, and that an HTTPS-only peer cannot reach keyring-wallet, which has no HTTPS trust-task path, so an HTTPS-DIDComm gateway would be needed. | No gateway is built or tested. |
| Meta-layer roles | Not measured | No suite vector covers who may hold a role or who sets rules. | All of it. |

Surface 2, measured: VTI's own agent-service (VTA) code run in one process (router, dispatcher, handlers, signer, through VTI's test-support constructor), reached over a loopback HTTPS door with a minted bearer; `vta-service` 0.72.0 at the same ref. Not a live deployment. Figures: results/README.md.

| Row | Status | Evidence (historical counts; superseded) | What is missing |
|---|---|---|---|
| Interoperability, technical | Partly (conformance-implied) | The handlers answer trust-task documents over loopback HTTPS with a bearer-authenticated sender: envelope 13 of 14 pass, control 3 pass and 1 CLARIFY, binding 3 of 7 pass (2 KNOWN-FAIL, 2 SKIP), discovery 8 pass and 1 CLARIFY. | DIDComm and TSP carriers; a real deployment. An `identityMismatch` refusal is addressed to the in-band issuer (ID-002, BND-002). |
| Interoperability, syntactic | Partly (conformance-implied) | Envelope 13 of 14, errors 4 pass and 3 CLARIFY, proofs 25 pass, 4 CLARIFY, 5 KNOWN-FAIL (shared proof fixtures PRF-008, 010, 011, 019, 029 differ from the fixture verdicts), 7 SKIP. | Receipts (70) are not offered by VTI. |
| Interoperability, semantic | Partly (conformance-implied) | `credential-exchange/issue`: 5 pass, 2 CLARIFY, 2 KNOWN-FAIL (CEX-001 and CEX-004), 9 SKIP. `query` and `offer` 0.1 (holder): 4 pass, 2 CLARIFY, 3 KNOWN-FAIL (CEX-022, 023, 027: a DCQL type query gathers nothing), 2 SKIP. | Relationship-credential (44), witness-share (23), task-consent (24) and ceremony (16) types are not offered; nor is an inbound `credential-exchange/request` 0.1. |
| Interoperability, organizational | Not shown | Ceremony, two-phase-commit and task-consent groups are SKIP or not offered. | Any multi-party ceremony behaviour. |
| Interworking | Not shown | No translator sits in the measured path. | No gateway is built or tested. |
| Meta-layer roles | Not measured | No suite vector covers it. | All of it. |

### keyring-wallet

- **Authority.** Second anchor, after VTI.
- **Independence of the result.** Not built against this suite. The wallet's own code is run as published behind a stand-in carrier.
- **Reach.** Current reach: results/README.md. Checks not run were not run because the stand-in carrier and our adapter cannot reach them (for example receipts, discovery 0.4, task-consent and the ceremony families are not served in this measurement, and on its peer leg the wallet serves `credential-exchange/query` 0.1 but not `offer`, `request`, `granted` or `decision` 0.1). These are limits of reach, not defects.
- **Agreement on what ran.** Current verdicts are generated in results/README.md. Classed by the vector review ([results/vector-review.md](../results/vector-review.md)), the recorded differences are mostly differences from the spec text (proof checked under a different identifier than the issuer, default policy accepts unverified documents, a lax proof verifier, no error for unserved types, held proposals get no reply, no bounded duplicate record, a deferred query is not answered `consentRequired`), some are vectors that may read more than the text says, a few are open in the text, and some are limits of the stand-in carrier, not wallet differences.
- **What this does and does not show.** Shows how the wallet's own trust-task logic compares with the vectors. Says nothing about its real wire (no DIDComm, mediator or key custody).

Measured: the wallet's own trust-task code, run as published behind an in-memory stand-in for the carrier ("logic over a shim carrier"); figures: results/README.md.

| Row | Status | Evidence (historical counts; superseded) | What is missing |
|---|---|---|---|
| Interoperability, technical | Not shown | Nothing about the real wire was exercised: no DIDComm, mediator or key custody. | The real carrier. Results through the shim say nothing about it. |
| Interoperability, syntactic | Partly (shim only; conformance-implied) | Envelope 7 of 14 pass, 6 KNOWN-FAIL; proofs 13 of 41 pass, 5 CLARIFY, 17 KNOWN-FAIL; errors 1 pass, 3 CLARIFY, 3 KNOWN-FAIL; identity 2 pass. Differences: proofs on an issue or witness-share document are checked under a different identifier than the issuer (32), some proofs that should be refused are accepted (13; four more that went beyond the text are now CLARIFY), the default policy accepts unverified documents (6), and an unregistered task type gets no error reply (10). | Real-wire behaviour; the differences above are recorded differences from the framework text, not yet discussed with the maintainers. |
| Interoperability, semantic | Partly (shim only; conformance-implied) | Relationship-credential groups: issue 4 pass, 5 CLARIFY, 11 KNOWN-FAIL, 3 SKIP (plus AUTHZ-001, CLARIFY and KNOWN-FAIL); propose 3 pass, 6 CLARIFY, 9 KNOWN-FAIL, 3 SKIP (plus the 5 held-proposal vectors, KNOWN-FAIL). Witness-share (wider run): 3 pass, 2 CLARIFY, 14 KNOWN-FAIL (the same proof-identifier rule as the issue rows; TD and WSH groups), 10 SKIP. A proposal held for the person gets no `next-step` reply, and some rejections send no error (15 vectors across groups). `credential-exchange/query` 0.1: 2 pass, 2 CLARIFY, 4 KNOWN-FAIL (the wallet sends nothing for a malformed, unmatched or deferred query), 1 SKIP. | Discovery (17), task-consent (24) and credential-exchange offer, request, issue and present are SKIP in this measurement; the witness-share proof and credential check is a stand-in. |
| Interoperability, organizational | Not shown | Ceremony, credential-exchange, task-consent and two-phase-commit groups are SKIP. | Any multi-party ceremony behaviour. |
| Interworking | Not shown | The wallet speaks DIDComm and TSP, not HTTPS, so an HTTPS peer needs a translator; the suite's stand-in plays that part only for measurement. | A real gateway or the real DIDComm carrier. A shim-carrier result says nothing about its real wire. A real-wire carrier is estimated by the maintainers' internal report at 1.5 to 3 weeks of work and is not built. |
| Meta-layer roles | Not measured | No suite vector covers it. | All of it. |

### truststackers (original)

- **Authority.** The original repository (upstream main).
- **Independence of the result.** Independent of the suite: the original code was not written against these vectors.
- **Reach.** None: no vector could be run, because the conformance adapter cannot load against upstream main (no trust-task boundary).
- **Agreement on what ran.** Nothing ran.
- **What this does and does not show.** Shows that upstream main has no trust-task boundary the suite can reach. It says nothing about the rest of the original.

Run: `<results dir>/runs/2026-11-19-final-truststackers-base/` (re-run on the final suite, same result as 2026-11-15; upstream `d7ebe8f2dc6cc1e7bbe4ff40d6debf2f9184b84c`, original repository [TrustStackers/p2p-trust-stack](https://github.com/TrustStackers/p2p-trust-stack)). Every row is "Not reachable" for what the suite measures, and "Not shown" where the suite has no vector. The truststackers original is not reachable by the suite: no trust-task boundary exists upstream, so no vector could be run.

| Row | Status | Evidence (historical counts; superseded) | What is missing |
|---|---|---|---|
| Interoperability, technical | Not reachable | No vector ran. | The trust-task boundary and its bindings. |
| Interoperability, syntactic | Not reachable | No vector ran. | Envelope, error, proof and receipt handling on a boundary. |
| Interoperability, semantic | Not reachable | No vector ran. | Handlers for the relationship-credential and witness-share types. |
| Interoperability, organizational | Not shown | No vector ran. | Ceremony, credential-exchange and task-consent handling. |
| Interworking | Not shown | None. | Any translator. |
| Meta-layer roles | Not measured | No suite vector covers it. | All of it. |

### Cross-platform picture (common vectors, not a live exchange)

No run in this repository has two platforms exchanging documents with each other; each platform is measured alone against the same vectors. "Both PASS" means both did what the standard-based vector expects on the same vector, which is the closest thing the suite records to two platforms agreeing: conformance-implied only, never demonstrated interoperation, and not a ranking. Each VTI surface is paired on its own, and truststackers (original), which ran no vectors, is in no pair. The figures are generated from the current run folders: results/interop/pair-matrix.md; demonstrated exchanges would be recorded in [results/interop/ledger.md](../results/interop/ledger.md) (none recorded).

Back to [docs/README.md](README.md).

## Layer 3a probes

Five separate families extend the suite below the core without changing it: the plain-task probe (`vectors/plain`, the proposed 2L-1 and 2L-2 profiles: auth, acl, policy, vault, device), the producer class (`vectors/emit` and `vectors/emit-more`: the documents an implementation sends) and the witness-server vectors (`vectors/witness`, over a DIDComm carrier; [13](13-didcomm-carrier-and-witness-server.md)). None is core and none adds to the core figures; a sixth family, the proposed 2L vectors (`vectors/2l`, [19](19-vti-emit-and-2l-vectors.md)), is also separate. Sizes by family and channel: results/README.md, Vector families. The suite fixes no governance in any of them (docs/02 section 5.1). Per-family, per-platform figures: results/README.md. See docs/04 sections 11.7, 11.8 and 18 and the runs `2026-11-15-integration-*`.

Back to [docs/README.md](README.md).
