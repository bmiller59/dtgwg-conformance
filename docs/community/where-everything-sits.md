# Where everything sits

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

The layer, channel and platform map that the top-level README used to carry, kept here so the README can stay short. Moved unchanged apart from link paths; it describes what the suite has for each layer and how each platform is measured.

## Where everything sits (layers, channels, platforms)

The Trust over IP stack as this suite divides it ([docs/01](../01-layer-model.md)): where the trust tasks, the core, the application profiles (AP), the platforms and this suite sit. Plain text, so it reads the same in a terminal, an editor or a browser.

```
 TRUST OVER IP STACK (docs/01)             WHAT THE SUITE HAS FOR IT          CHANNEL (legend)
 ========================================  =================================  ==================
 L4  applications, SDKs (4a, 4b)           nothing: out of scope              -
 ----------------------------------------
 L3  AP  application profiles:             vectors/2l                         proposed  advisory
         notifications, push, directory,
         invitations, join, vetting, audit
         every other task version           vectors/coverage and gap          proposed  advisory
                                           (families, docs/22 and 28)
     3d  ceremony families                 ceremony scenarios (docs/25-27):   proposed  advisory
                                           outcomes, never conformance
     3c  CEREMONIES: VRC propose and       core vectors                       registry  gating
         issue, 2PC, ceremony documents,
         receipts, witness session and
         submit (group WIT, docs/29)
         witness share, task digest        core vectors                       candidate advisory
     3b  CORE TASKS: error, next-step,     core vectors                       registry  gating
         discovery, control, receipt;
         3b-DTG: credential-exchange,
         task-consent
     3a  TRUST TASKS: one signed JSON      core (framework groups),           registry  gating
         document each (envelope, proof,   vectors/plain (one task each),
         freshness, duplicates, errors)    vectors/emit and emit-more (sent)
 ----------------------------------------
 L2  carriers: HTTPS, DIDComm v1/v2, TSP   BND (HTTPS binding); witness       registry  gating
                                           vectors over real DIDComm
 ----------------------------------------
 L1  identifiers and keys                 nothing directly: relied on       -
                                           (indirectly PRF and ID)
 ========================================  =================================  ==================

 Trust Tasks TF repository --(tfRef)--> THIS SUITE: vectors --> runner --> adapter (JSON-RPC)
 (only tasks in the TF repository gate;  reference adapter + mutants = the suite's own
  the rest is candidate or proposed)     self-check, never a platform
                                                     |
                                                     | one surface at a time
        +-------------------+--------------------+---+
        v                   v                    v
 VTI                 keyring-wallet       truststackers
 agent (VTA) and     wallet logic on a    TrustStackers/
 community (VTC)     stand-in carrier;    p2p-trust-stack main
 services in         Credo agent over     d7ebe8f: no trust-task
 process; live VTC   real DIDComm v1 and  boundary, so NOT
 over HTTPS; VTI's   v2; witness server   REACHABLE (0 checks ran)
 own sender (emit)   over real DIDComm
```

Legend. **registry**: the check cites a Trust Tasks TF repository artifact and gates the run. **candidate** (behaviour with no TF home yet, not an endorsement) and **proposed** (the suite's own proposals: the AP profiles and the ceremony design) are advisory: written to `<out>-advisory`, never in a headline total. AP is part of layer 3, not layer 2. Results are per surface and never summed; between platforms only conformance-implied agreement exists (no demonstrated exchange is recorded, [docs/14](../14-interoperability-tracking.md)). Governance is never determined by these tests: platforms are checked only on what they declare ([docs/17](../17-governance-probes.md)).

**What is and is not tested today.** The suite tests individual ceremony documents and some short multi-step sequences against one implementation at a time (in process for the reference adapter; keyring-wallet's ceremony steps run behind a stand-in carrier or over real DIDComm, with the suite as the other party). It does not yet test a whole ceremony completed end to end between independent real parties, and no complete ceremony has been demonstrated across platforms: the ledger of demonstrated executions is empty ([docs/14](../14-interoperability-tracking.md)), so any agreement between platforms is conformance-implied only. A first end-to-end track now exists as ceremony scenarios ([docs/25](../25-ceremony-scenarios.md), [26](../26-paired-ceremonies.md), [27](../27-kw-vti-ceremonies.md), [30](../30-onboarding-vetting-ceremonies.md), which adds the onboarding group FC-MBR and the vetting-directory group FC-IDV): the wallet's own code and a VTI service play a scenario together through the runner's relay, and the suite's own oracle plays both sides. Their results are labelled outcomes (completed, ended as specified, failed, skipped) of ceremonies run together, never conformance, never counted, and not a demonstrated cross-platform exchange: the ledger stays empty. The remaining flows ([docs/16, section 8](../16-roadmap-and-decisions.md#8-what-remains-in-order)) are not built.

**Scope.** The suite covers everything in the Trust Tasks task force repository, including open pull requests and branches (decision by the project owner, 2026-11-19): core tasks came first, then VTI and keyring-wallet, with full ceremonies end to end as the most important layer and per-task vectors as the finer one. Non-core families are optional suites. A task's class in [docs/02](../02-core-trust-task-criteria.md#classification-is-not-scope) is a layer, not a scope rule. Every task and vector is flagged by spec maturity and by source. The complete table is results/coverage/README.md (matrix.json).
