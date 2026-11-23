// SPDX-License-Identifier: Apache-2.0
// keyring-wallet adapter: the parts that do not touch keyring-wallet code (capabilities, the loopback carrier's outbox, the
// connection table). The host (kw-host.jest.ts) runs inside keyring-wallet's own jest setup and wraps its real trust-task code;
// everything here is plain TypeScript so it is unit-tested with the suite's own runner (test/keyring-wallet.test.ts).
//
// The row this adapter produces is "keyring-wallet: logic over a shim carrier". keyring-wallet has no HTTP trust-task server; its
// peer ceremonies ride DIDComm. The shim replaces only the carrier below the `Carriage` port (an in-memory DidCommMessageSender and
// message-handler registry); the registry, the consume pipeline, the handlers and the document proofs are keyring-wallet's own.
// It does NOT exercise the real wire: no DIDComm packing, no mediator, no pickup, no HTTPS.
import { cited } from "../../adapter/contract.ts";
import type { AcceptanceWindow, Capabilities, EssentialGovernance, ProvisionedRole } from "../../adapter/contract.ts";
import { didKeyFromEd25519, ed25519Signer, seedOf } from "../../crypto/didkey.ts";

export const KW_ADAPTER_NAME = "keyring-wallet";
export const ROW_LABEL = "logic over a shim carrier";

export const CARRIER_TYPE = "https://trusttasks.org/spec/conformance/widget/0.1";
export const PROPOSE_TYPE = "https://trusttasks.org/spec/vrc/relationships/propose/0.1";
export const ISSUE_TYPE = "https://trusttasks.org/spec/vrc/relationships/issue/0.1";
export const WITNESS_SHARE_TYPE = "https://trusttasks.org/spec/vrc/relationships/witness-share/0.1";
/** The wallet's peer-leg handler for it is `handleInboundCredentialExchangeQuery` (ceremony.ts), dispatched before the registry fallback. */
export const QUERY_TYPE = "https://trusttasks.org/spec/credential-exchange/query/0.1";

export interface KwBuild {
  /** Type URIs the wallet's own builders can emit (producer class). */
  emits?: string[];
  /** Short commit of the keyring-wallet checkout and of its bifold submodule; "unknown" when it cannot be read. */
  commit: string;
  bifoldCommit: string;
  /** Task types the wallet's own registry serves in addition to the shim's carrier (read from the wallet at start). */
  walletTypes: string[];
  /** Serve the VRC propose consent trigger (`trigger.consent`). */
  consent: boolean;
  /** How the carrier handler sets the proof policy: the wallet's module default, or the verifier its issue handler installs. */
  carrierProof?: "default" | "verify";
  /** The shim fakes the process Date (jest fake timers, as the wallet's own pinClock helper does) so the harness can set the clock. A shim choice: the wallet has no injectable clock. */
  fakeClock?: boolean;
  /** Serve witness-share: the pairing logic is the wallet's; the presentation and credential crypto is a stand-in (see kw-host.jest.ts). */
  witnessShare?: boolean;
  /**
   * Serve credential-exchange query 0.1 through the wallet's own handler, with the holder helpers it supports: `holdCredential` (a
   * record in the wallet's credential store), `queryDecision` (the wallet's own `respondToCredentialExchangeQuery`) and
   * `observe.deferred` (the wallet's pending prompts). Never `verifierTrust`: the wallet has no pre-trusted verifiers, every matched
   * query waits for its user. The presentation signature is a suite stand-in (see kw-host.jest.ts).
   */
  query?: boolean;
  /** Ceremony track (docs/26): the kinds the wallet's driver can start. */
  ceremony?: { initiates: string[] };
}

/**
 * keyring-wallet enforces a clock allowance of five minutes (`KEYRING_CONSUME_CHECKS.freshness.skewMs`) and no maximum age and no
 * expiry horizon of its own. Only the skew is a number the wallet has, so only it is declared; the other members stay at the profile
 * pins, which means the suite's stale-document vectors measure the absence of a window (docs/05 K2), not a window of five minutes.
 */
export const KW_WINDOW: Partial<AcceptanceWindow> = { clockSkewSeconds: 300 };

/** The supplementary run in which the carrier installs the wallet's verifier is a separate row name, so the main row's exceptions do not apply to it. */
export const KW_VERIFY_NAME = "keyring-wallet-carrier-verify";

/**
 * Requirements keyring-wallet itself does not offer, each checked in the wallet source (read only, <keyring-wallet checkout>,
 * bifold/packages/core/src/modules/trust-tasks) on 2026-11-15. A vector gated on one is SKIP with this reason, not "adapter lacks it".
 */
const INBOUND = "the wallet's inbound trust-task registry serves vrc propose and issue, witness-share, discovery 0.1, continuity and credential-exchange query only (ceremony.ts registrations and SUPPORTED_TASK_TYPES)";
export const KW_NOT_OFFERED: Record<string, string> = {
  "optional:receiptVerify": "the wallet has no trust-ceremony-receipt code at all, neither recorder nor verifier (no reference to the type in app/ or bifold/packages/*/src); a verifier supplied by the harness (the reference's) would measure the reference, not the wallet",
  discovery: "the wallet answers trust-task-discovery 0.1 only (ceremony.ts handleInboundDiscovery consumes the 0.1 payload spec; it asks for 0.3 as a client in pcsVtaPayloads.ts but serves no 0.3 or 0.4); the DIS vectors are written against 0.3 or 0.4",
  "https://trusttasks.org/spec/task-consent/decision/0.1": `the wallet is the approver and sends task-consent/decision as a client of a VTA (VtaClient.ts consentDecision, approvalRules.ts); ${INBOUND}`,
  "https://trusttasks.org/spec/task-consent/decision/0.2": `the wallet is the approver and sends task-consent/decision as a client of a VTA (VtaClient.ts, approvalRules.ts); ${INBOUND}`,
  "https://trusttasks.org/spec/task-consent/request/0.1": `the wallet receives task-consent/request as an approver device of a VTA (VtaClient.ts, hiddenVetting.ts), not through the trust-task registry; ${INBOUND}`,
  "https://trusttasks.org/spec/task-consent/granted/0.1": `the wallet receives task-consent/granted as a requester of a VTA (VtaClient.ts), not through the trust-task registry; ${INBOUND}`,
  "https://trusttasks.org/spec/credential-exchange/issue/0.1": `a delivered credential arrives in the persona inbox as a DIDComm message handled by vtiInbox.receiveIssue/vtiPersonaInbox (a different pipeline, bare message shape), not the registry; ${INBOUND}`,
  "https://trusttasks.org/spec/credential-exchange/offer/0.1": "an offer reaches the persona inbox (vtiPersonaInbox.ownedByInbox, invitationOfferOfMessage) and is redeemed by an HTTP POST to the community's VTCRest endpoint (vtiInvitationOffer.redeemInvitationOffer): the wallet pushes no request document, so there is nothing for a pushed-document observation to see",
  "https://trusttasks.org/spec/credential-exchange/request/0.1": "the wallet is the holder: it never receives a request (an issuer's task); its redeem path is an HTTP request to the community (vtiInvitationOffer.ts)",
  "https://trusttasks.org/spec/credential-exchange/present/0.1": "the wallet is the holder: it sends present (ceremony.ts respondToCredentialExchangeQuery) and has no inbound handler for it",
  "optional:ceremony": "no ceremony begin, approve or reset task type is registered in the wallet (the registrations are vrc propose and issue, discovery, witness-share and continuity)",
  "optional:trigger.twoPhase": "the wallet has no two-phase-commit issue transaction (no two-phase code in modules/trust-tasks)",
  "optional:fault.claimStore": "the wallet keeps no accepted-id (duplicate) record to make unreadable: TrustTasksService stores documents only as diagnostic and outcome evidence (TrustTasksService.ts record save); the service takes only a document repository (constructor, TrustTasksService.ts:89) and no accepted-id store",
  "binding:https": "the wallet has no HTTP trust-task surface; its peer ceremonies ride DIDComm (see the DIDComm row)",
  "cryptosuite:ecdsa-jcs-2019": "the wallet verifies and signs eddsa-jcs-2022 only (documentProof.ts)",
  "optional:trigger.verifierTrust": "the wallet has no pre-trust policy for verifiers: every matched credential-exchange query waits for its user (respondToCredentialExchangeQuery is the only path to a present)",
};

/** The 2L probe vectors (vectors/2l) address the community and agent services: types the wallet's inbound registry does not serve (same fact as `INBOUND`; a vector that sends one of them to the wallet has nothing to talk to). */
export const KW_NOT_OFFERED_2L: Record<string, string> = Object.fromEntries([
  "https://trusttasks.org/spec/audit/list/0.2",
  "https://trusttasks.org/spec/audit/verify/0.1",
  "https://trusttasks.org/spec/notifications/notify/0.1",
  "https://trusttasks.org/spec/notifications/relay/0.1",
  "https://trusttasks.org/spec/push/register/0.2",
  "https://trusttasks.org/spec/vetting/attestation/0.1",
  "https://trusttasks.org/spec/vetting/decline/0.1",
  "https://trusttasks.org/spec/vetting/request/0.1",
  "https://trusttasks.org/spec/vta/notifications/deposit/0.1",
  "https://trusttasks.org/spec/vta/notifications/dismiss/0.1",
  "https://trusttasks.org/spec/vta/notifications/list/0.1",
  "https://trusttasks.org/spec/vta/notifications/show/0.1",
  "https://trusttasks.org/spec/vtc/directory/card/show/0.1",
  "https://trusttasks.org/spec/vtc/directory/card/update/0.1",
  "https://trusttasks.org/spec/vtc/directory/entries/list/0.2",
  "https://trusttasks.org/spec/vtc/directory/entries/show/0.1",
  "https://trusttasks.org/spec/vtc/directory/fields/list/0.1",
  "https://trusttasks.org/spec/vtc/directory/images/get/0.1",
  "https://trusttasks.org/spec/vtc/directory/images/upload/0.1",
  "https://trusttasks.org/spec/vtc/directory/query/0.1",
  "https://trusttasks.org/spec/vtc/invitations/deliver/0.1",
  "https://trusttasks.org/spec/vtc/invitations/issue/0.1",
  "https://trusttasks.org/spec/vtc/invitations/list/0.1",
  "https://trusttasks.org/spec/vtc/invitations/revoke/0.1",
  "https://trusttasks.org/spec/vtc/join-requests/manifest/0.4",
  "https://trusttasks.org/spec/vtc/join-requests/status/0.1",
  "https://trusttasks.org/spec/vtc/join-requests/submit/0.3",
  "https://trusttasks.org/spec/vtc/join-requests/supplement/0.1",
  "https://trusttasks.org/spec/vtc/join-requests/withdraw/0.1",
  "https://trusttasks.org/spec/vtc/members/request-vmc/0.1",
  "https://trusttasks.org/spec/vtc/members/vmc/0.1",
  "https://trusttasks.org/spec/vtc/notifications/list/0.1",
  "https://trusttasks.org/spec/vtc/notifications/relay/0.1",
  "https://trusttasks.org/spec/vtc/notifications/show/0.1",
].map((t) => [t, `not served by the wallet: ${INBOUND}`]));

/** The roles the wallet plays in the paired ceremonies (docs/26): the member's phone (the admin manager of its agent, the approver of a sign-in). */
export const CEREMONY_ROLES_BASE = ["FC-ACL", "FC-DEV", "FC-VLT", "FC-STU", "FC-AUT", "FC-PER", "FC-MBR", "FC-ONB", "FC-IDV", "FC-DIR", "FC-VOT", "FC-BAL", "FC-RMS"].map((ceremony) => ({ ceremony, roles: ["member-phone"] }));
/** FC-TCA: the wallet as one of several approvers (the same task-consent approver the FC-KVC track drives); the outsider slot is a device that is no approver. Class D harness role. FC-MAT: the first and second person; the wallet offers no credential-exchange offer, so the scenarios skip on the missing type, and the role is listed so the skip names that, not the role. */
export const CEREMONY_ROLES = [...CEREMONY_ROLES_BASE, { ceremony: "FC-TCA", roles: ["approver", "outsider"] }, { ceremony: "FC-MAT", roles: ["first-person", "second-person"] }, { ceremony: "FC-VRC", roles: ["proposer", "responder"] }, { ceremony: "FC-WSH", roles: ["proposer", "responder"] }];

export function capabilities(b: KwBuild): Capabilities {
  const types = [...new Set([CARRIER_TYPE, ...b.walletTypes])];
  return {
    name: b.carrierProof === "verify" ? KW_VERIFY_NAME : KW_ADAPTER_NAME,
    implementation: b.carrierProof === "verify" ? KW_VERIFY_NAME : KW_ADAPTER_NAME,
    version: `keyring-wallet ${b.commit} (bifold ${b.bifoldCommit}), ${ROW_LABEL}${b.fakeClock === true ? "; clock: shim-faked Date" : ""}${b.witnessShare === true ? "; witness-share: presentation crypto is a suite stand-in" : ""}${b.query === true ? "; credential-exchange query: presentation signing is a suite stand-in" : ""}${b.carrierProof === "verify" ? "; carrier proof policy: verify" : ""}`,
    tierMax: 1,
    // No `https`: the wallet has no HTTP trust-task surface, so the BND vectors are SKIP. The binding the shim stands in for is DIDComm.
    bindings: ["in-process"],
    supportedTypes: types,
    // The carrier is a conformance-only task type registered into the wallet's own open registry (the documented extension point for
    // a new task type); its handler is shim code, the consume pipeline and dispatch around it are the wallet's.
    // The carrier's payload schema is open (additionalProperties true), so it is declared in both classes, as the reference adapter does.
    carriers: [
      { typeUri: CARRIER_TYPE, class: "consequential", validPayload: { subject: "did:web:alice.example" } },
      { typeUri: CARRIER_TYPE, class: "openPayload", validPayload: { subject: "did:web:alice.example" } },
    ],
    // The wallet verifies and signs eddsa-jcs-2022 only (documentProof.ts); ES256 is not declared.
    cryptosuites: ["eddsa-jcs-2022"],
    optional: [
      // The wallet has no injectable clock (its pipeline reads Date.now() and new Date()). With fakeClock the SHIM sets the process Date
      // (jest fake timers) so the harness can set the clock; without it the runner rebases on real time.
      b.fakeClock === true ? "clock" : "clockFree",
      "proofVerify",
      // Every document the wallet sends on its own initiative is recorded by the host (kw-host.jest.ts `pushedBox`).
      "observe.pushed",
      // The shim's `from` is a connection the wallet knows by its authenticated DIDComm peer; the wallet's identity check against
      // that connection is its own code.
      "transportIdentity",
      // Restart rebuilds the in-memory agent and keeps the stored records, as a wallet reopening its store would.
      "restart",
      ...(b.consent ? ["trigger.consent"] : []),
      // No trigger.verifierTrust: the wallet has no pre-trust policy for verifiers.
      // Producer class: the documents the wallet's own request builders emit (see `emit` in kw-host.jest.ts).
      ...((b.emits ?? []).length > 0 ? ["emit"] : []),
      ...(b.query === true ? ["trigger.holdCredential", "trigger.queryDecision", "observe.deferred"] : []),
      ...(b.ceremony !== undefined ? ["initiate", "peer.connect", "observe.ceremony", "observe.received", "initiate.reciprocate", "initiate.foreignPresentation", "castFutureVersion"] : []),
    ],
    ...(b.ceremony !== undefined ? { initiates: b.ceremony.initiates, ceremonyRoles: CEREMONY_ROLES } : {}),
    ...((b.emits ?? []).length > 0 ? { emits: b.emits } : {}),
    // Cited (docs/04 section 8): each entry was checked in the wallet source, read only; the file or function is named in the reason.
    notOffered: cited({ ...KW_NOT_OFFERED_2L, ...KW_NOT_OFFERED }, `keyring-wallet source, bifold/packages/core/src/modules/trust-tasks (registrations in ceremony.ts, SUPPORTED_TASK_TYPES; the file or function is named in the reason); measured row keyring-wallet ${b.commit} (bifold ${b.bifoldCommit})`),
    governance: { essential: kwEssential() },
    window: KW_WINDOW as AcceptanceWindow,
    pins: { framework: "0.6.0", error: "0.6", binding: "none" },
  };
}

/**
 * The wallet's essential governance, E (docs/04 section 19). The tasks the wallet holds for a decision (an inbound
 * `vrc/relationships/propose`, a deferred `credential-exchange/query`) wait for its own person: one Accept or Decline
 * (`respondToRelationshipProposal`, `respondToCredentialExchangeQuery`) decides, and no setting names other approvers or a count.
 * A built-in rule, so the source is `fixed-rule` (advisory GOV-FIXED), with a set of one: the wallet's person, acting as the IUT
 * (the harness drives the decision through `trigger.consent`). The wallet serves no ceremony task (`optional:ceremony`), so nothing
 * drives this E as a ceremony and the honesty check does not run.
 */
export function kwEssential(): EssentialGovernance {
  return {
    source: "fixed-rule",
    principals: [{ vid: iutIdentity().vid, role: "wallet-holder" }],
    consent: { task: PROPOSE_TYPE, approverSet: "wallet-holder", minApprovals: 1, excludeRequester: true },
    evidence: "keyring-wallet 62af4d2d4, bifold 7e14c5124: bifold/packages/core/src/modules/trust-tasks/ceremony.ts:916-924 (pending proposals await the user's consent), :1131 respondToRelationshipProposal (one accept or decline), :2186 respondToCredentialExchangeQuery",
  };
}

/** The seed byte of the wallet identity: 0x4b, or KW_IDENTITY_SEED for a second wallet instance with its own identity (class D harness choice). */
export function identitySeed(env: Record<string, string | undefined> = process.env): number {
  const v = env.KW_IDENTITY_SEED;
  if (v === undefined || v === "") return 0x4b;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error(`KW_IDENTITY_SEED must be an integer byte, got ${v}`);
  return n;
}

/** The identity the harness addresses: a deterministic did:key (the wallet's own connection DIDs are did:peer:4, which no vector needs). */
export function iutIdentity(): { vid: string; didDocument: unknown } {
  const signer = ed25519Signer(seedOf(identitySeed()));
  const did = didKeyFromEd25519(signer.publicKey);
  const vm = `${did}#${did.slice("did:key:".length)}`;
  return {
    vid: did,
    didDocument: { id: did, verificationMethod: [{ id: vm, type: "Multikey", controller: did, publicKeyMultibase: did.slice("did:key:".length) }], authentication: [vm], assertionMethod: [vm] },
  };
}

export function provisionRoles(roles: string[]): Record<string, ProvisionedRole> {
  const id = iutIdentity();
  const out: Record<string, ProvisionedRole> = {};
  for (const r of roles) out[r] = { vid: id.vid, didDocument: id.didDocument, transportAddress: "in-process (DIDComm shim carrier)", keyCustody: "iut" };
  return out;
}

/** One connection per transport-authenticated peer, as the wallet keeps them: `did` is this side, `theirDid` the peer. */
export interface Connection {
  id: string;
  did: string;
  theirDid: string;
  theirLabel: string;
}

export class ConnectionTable {
  private readonly byPeer = new Map<string, Connection>();
  private readonly byId = new Map<string, Connection>();
  private readonly myDid: string;
  constructor(myDid: string) {
    this.myDid = myDid;
  }
  forPeer(peer: string): Connection {
    let c = this.byPeer.get(peer);
    if (c === undefined) {
      c = { id: `conn-${this.byPeer.size + 1}`, did: this.myDid, theirDid: peer, theirLabel: `peer ${this.byPeer.size + 1}` };
      this.byPeer.set(peer, c);
      this.byId.set(c.id, c);
    }
    return c;
  }
  all(): Connection[] {
    return [...this.byId.values()];
  }
  get(id: string): Connection {
    const c = this.byId.get(id);
    if (c === undefined) throw new Error(`no connection ${id}`);
    return c;
  }
  clear(): void {
    this.byPeer.clear();
    this.byId.clear();
  }
}

/** What the wallet sent out, in order: the loopback carrier's outbox. A document the wallet sends is a reply or an unsolicited message. */
export class Outbox {
  private docs: { connectionId: string; document: Record<string, unknown> }[] = [];
  private version = 0;
  push(connectionId: string, document: Record<string, unknown>): void {
    this.docs.push({ connectionId, document });
    this.version++;
  }
  /** Take everything sent since the last take. */
  take(): { connectionId: string; document: Record<string, unknown> }[] {
    const out = this.docs;
    this.docs = [];
    return out;
  }
  get size(): number {
    return this.docs.length;
  }
  clear(): void {
    this.docs = [];
    this.version++;
  }
  /** Resolve once nothing has been sent for `quietMs` (and at most `maxMs`): the wallet's fire-and-forget sends are then finished. */
  async settle(quietMs: number, maxMs: number): Promise<number> {
    const start = performance.now();
    let seen = this.version;
    let quietSince = performance.now();
    while (performance.now() - start < maxMs) {
      await new Promise((r) => setTimeout(r, Math.min(10, quietMs)));
      if (this.version !== seen) {
        seen = this.version;
        quietSince = performance.now();
      } else if (performance.now() - quietSince >= quietMs) break;
    }
    return performance.now() - start;
  }
}

/** The lifecycle state the harness asks about (`observe documentState`). */
export type DocState = "unknown" | "accepted" | "responded" | "errored";

export const NEXT_STEP_SLUG = "/trust-task-next-step/";

/**
 * The state a reply puts its request in. SPEC.md 4.4.1 and 8.6: a `trust-task-next-step` reports the request understood and blocked,
 * and the originating document stays `accepted` (4.12), so a next step is not "responded".
 */
export function stateFromReply(replyType: string | undefined): DocState {
  if (replyType === undefined) return "accepted";
  if (replyType.includes("/trust-task-error/")) return "errored";
  if (replyType.includes(NEXT_STEP_SLUG)) return "accepted";
  return "responded";
}

type Doc = Record<string, unknown>;

/**
 * Is `d` a reply to the request `id` on `thread`? SPEC.md 4.4.1: a reply has one of three dispositions, told by its `type` alone: the
 * request's `#response`, a `trust-task-error` or a `trust-task-next-step` (a blocked task is neither of the other two). A reply is
 * matched to its request by its thread or by the id its payload names in `inResponseTo`.
 */
export function answers(d: Doc, thread: string, id: string | undefined): boolean {
  const type = String(d.type ?? "");
  if (!type.endsWith("#response") && !type.includes("/trust-task-error/") && !type.includes(NEXT_STEP_SLUG)) return false;
  const irt = (d.payload as { inResponseTo?: { id?: string } } | undefined)?.inResponseTo;
  return d.threadId === thread || (id !== undefined && irt?.id === id);
}

/**
 * Has the exchange not yet closed? SPEC.md 4.4.1: a `trust-task-next-step` (continuation) does NOT close the exchange, the originating
 * document stays `accepted` and blocked; SPEC.md 4.4 (threadId) names the sequence a request, an interim next step and the final
 * result. So when every reply so far is a next step, the final result may still follow. No reply at all is quiet, not open.
 */
export function exchangeStillOpen(replies: Doc[]): boolean {
  return replies.length > 0 && replies.every((d) => String(d.type ?? "").includes(NEXT_STEP_SLUG));
}

/**
 * Document lifecycle states for `observe documentState`. The state is not only that of the immediate reply to `send`: a document the
 * wallet sends later on the request's thread (the answer to a trigger such as the person's consent, a straggler) moves the request on
 * (SPEC.md 4.12: `accepted` to a terminal response or error; a next step leaves it `accepted`). `request` registers what the harness
 * sent before it is sent; `note` sees every document that leaves the wallet.
 */
export class DocStates {
  private readonly byId = new Map<string, DocState>();
  private readonly threads = new Map<string, string>();
  clear(): void {
    this.byId.clear();
    this.threads.clear();
  }
  request(id: string, thread: string): void {
    // The first request on a thread owns it: a resubmission (SPEC.md 1417) joins the thread and does not take it over.
    if (!this.threads.has(thread)) this.threads.set(thread, id);
    if (!this.threads.has(id)) this.threads.set(id, id);
  }
  set(id: string, state: DocState): void {
    this.byId.set(id, state);
  }
  [Symbol.iterator](): IterableIterator<[string, DocState]> {
    return this.byId.entries();
  }
  get(id: string): DocState {
    return this.byId.get(id) ?? "unknown";
  }
  note(d: Doc): void {
    const type = typeof d.type === "string" ? d.type : "";
    if (type === "" || type.includes(NEXT_STEP_SLUG)) return;
    const irt = (d.payload as { inResponseTo?: { id?: string } } | undefined)?.inResponseTo?.id;
    const target = typeof irt === "string" && this.threads.has(irt) ? this.threads.get(irt) : typeof d.threadId === "string" ? this.threads.get(d.threadId) : undefined;
    if (target === undefined) return;
    if (type.includes("/trust-task-error/")) this.byId.set(target, "errored");
    else if (type.endsWith("#response")) this.byId.set(target, "responded");
  }
}
