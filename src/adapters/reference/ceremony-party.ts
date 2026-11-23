// SPDX-License-Identifier: Apache-2.0
// Reference adapter: the ceremony-scenario members (optional capabilities `initiate`, `peer.connect`, `observe.received`, `observe.ceremony`;
// docs/25). They let the reference be a PARTICIPANT in a scenario of the separate ceremony runner (src/ceremony/): it starts a step of the VRC
// ceremony (propose, issue) towards a connected peer, takes the answers to what it started, keeps an inbox of everything that reached it and
// reports its own reading of a ceremony thread. Two reference instances with different keys (`reference` and `reference-peer`) can then play
// the proposer and the responder.
//
// What this is not: the reference is the suite's oracle, so a run between two of them shows that the scenario format and the runner work. It is
// never evidence about a platform and never a conformance count (docs/25 section 1).
//
// The deliberate mutants (CEREMONY_MUTANTS) each break one rule of a ceremony step; the scenario runner must end a scenario in `failed` for each.
import { digestMultibase } from "../../crypto/digest.ts";
import { signDocument } from "../../crypto/proof.ts";
import type { ed25519Signer } from "../../crypto/didkey.ts";
import { threadOf } from "../../adapter/pushed.ts";
import { isTamperMode, tamperDecision } from "../../ceremony/tamper.ts";
import { ed25519Signer as signerOf, seedOf } from "../../crypto/didkey.ts";
import type { CeremonyState, ConnectParams, ConnectResult, InitiateParams, InitiateResult, ObserveResult } from "../../adapter/contract.ts";

const VRC = "https://trusttasks.org/spec/vrc/relationships";
export const VRC_PROPOSE = `${VRC}/propose/0.1`;
export const VRC_ISSUE = `${VRC}/issue/0.1`;
const WSH = "https://trusttasks.org/spec/vrc/relationships/witness-share/0.1";
const WITNESS = "https://trusttasks.org/spec/witness";
export const WITNESS_SESSION = `${WITNESS}/session/0.1`;
export const WITNESS_SUBMIT = `${WITNESS}/session/submit/0.1`;
const WSH_DOMAIN = "vrc:witness-share";
/** Requests whose acceptance is a receipt with no digest of a credential in it (vetting/request, vtc/join-requests/submit): the receipt mutants that drop it or move it to another thread apply to them. */
const RECEIPT_ONLY = ["https://trusttasks.org/spec/vetting/request/0.1", "https://trusttasks.org/spec/vtc/join-requests/submit/0.1"];
const PROPOSE_DECLINED = "vrc/relationships/propose:declined";

/** The kinds of step the reference can start (`Capabilities.initiates`) and the scenario group and roles it can play (`Capabilities.ceremonyRoles`). */
export const PARTY_KINDS = ["vrc-propose", "vrc-issue", "witness-session", "witness-session-submit", "vrc-witness-share"];
/** FC-WSH (witnessed VRC with witness-share, channel candidate): the same two roles; the witness is a third participant (the oracle in its labelled mode, witness-oracle.ts). */
export const PARTY_ROLES = [{ ceremony: "FC-VRC", roles: ["proposer", "responder"] }, { ceremony: "FC-WSH", roles: ["proposer", "responder"] }];
/** The task-consent approval kinds (group FC-TCA): the requester's held begin, the executor's request to an approver, an approver's decision. Offered by a party that serves the ceremony and DTG families. */
export const CONSENT_KINDS = ["consent-begin", "consent-request", "consent-decision", "consent-gate", "consent-resubmit"];
export const CONSENT_ROLES = [{ ceremony: "FC-TCA", roles: ["executor", "approver", "outsider"] }, { ceremony: "FC-KVC", roles: ["executor", "approver", "outsider"] }];
/** The credential-exchange kinds (group FC-CEX): the issuer's offer, the verifier's query. The holder's request and issue, and the holder's presentation, are pushed by the reference's own handlers and relayed by the runner (`relayPushed`). */
export const CEX_KINDS = ["cex-offer", "cex-query"];
export const CEX_ROLES = [
  { ceremony: "FC-CEX", roles: ["issuer", "holder", "verifier"] },
  { ceremony: "FC-KVX", roles: ["issuer", "holder", "verifier"] },
  // mutual attestation (ceremonies/mutual-attestation/0.1): each person is issuer in one direction and holder in the other, so it needs no kind of its own
  { ceremony: "FC-MAT", roles: ["first-person", "second-person"] },
];
const CEX = "https://trusttasks.org/spec/credential-exchange";
export const CEX_ISSUE = `${CEX}/issue/0.1`;
const CEX_QUERY = `${CEX}/query/0.1`;
const CEX_PRESENT = `${CEX}/present/0.1`;
const CEX_OFFER = `${CEX}/offer/0.1`;
const QUERY_CRED_TYPE = "https://example.org/conformance#ConformanceCredential";
const CONSENT = "https://trusttasks.org/spec/task-consent";
export const CONSENT_REQUEST = `${CONSENT}/request/0.1`;
export const CONSENT_DECISION = `${CONSENT}/decision/0.2`;
const isDoc = (x: unknown): boolean => typeof x === "object" && x !== null && !Array.isArray(x);
const NEXT_STEP = "https://trusttasks.org/spec/trust-task-next-step/0.1";
const CER_BEGIN = "https://trusttasks.org/spec/conformance/ceremony/begin/0.1";

/** Deliberate breakages of one rule of a ceremony step, each the subject of a mutant test of the scenario runner (docs/25 section 6). */
export const CEREMONY_MUTANTS = {
  ceremonyDropReceipt: "keeps the credential it was sent but never sends the delivery receipt",
  ceremonyReceiptWrongThread: "sends the delivery receipt on a new thread instead of the thread of the credential",
  ceremonyReceiptWrongDigest: "sends a delivery receipt whose digest is not the digest of the credential it received",
  ceremonyEarlyCompletion: "reports the ceremony completed as soon as the proposal is accepted, before any credential was delivered",
  // FC-VET (identity vetting, vetting-party.ts)
  vetCardUnbound: "the applicant's card carries a challenge that is not the session's (not bound to the session)",
  vetAcceptsUnboundCard: "the vetter accepts a card whose challenge, domain or community is not the session's",
  vetAcceptsUncitedStatement: "the applicant accepts a Vetting Statement that cites no session of the vetting (an attest without a session)",
  vetAcceptsDeclineAfterAttest: "the applicant accepts a decline after it already holds the vetter's statement",
  // FC-ONB (community member onboarding, onboarding-party.ts)
  onbAcceptsForeignHolder: "the community accepts an application whose presentation is held by another party than the document's signer",
  onbDecideUnknownAccepted: "the community answers a decision on a request id it never minted as if it had decided it",
  onbDecideByAnyone: "the community takes a decision from a party that is not the administrator it was told of",
  onbRejectAdmits: "the community records a rejection as an approval",
  onbVmcBeforeApproval: "the community stores a reciprocal credential for a request that is not approved",
  onbVmcNeverStored: "the community answers a delivered reciprocal credential as stored but does not keep it",
} as const;
export type CeremonyMutantId = keyof typeof CEREMONY_MUTANTS;
export const isCeremonyMutantId = (id: string): id is CeremonyMutantId => Object.prototype.hasOwnProperty.call(CEREMONY_MUTANTS, id);

type Signer = ReturnType<typeof ed25519Signer>;
type Doc = Record<string, unknown>;

/** What the party reads of the reference's exchange record for a thread (the reference owns the record; the party only reads it, or adopts one). */
export interface ExchangeView {
  peer: string;
  theirRel: string;
  myRel: string;
  state: "held" | "accepted" | "declined";
  stored: string[];
  /** Digests of the witnessed credentials the party's exchange record holds (witness-share). */
  shared?: string[];
}
export interface PartyHost {
  did: string;
  signer: Signer;
  now(): number;
  newId(): string;
  stamp(): string;
  mutated(id: CeremonyMutantId): boolean;
  /** Hand a document to this party's own consumer as if it came from `from` (the gate stand-in below: the requester's submission of the gated task). */
  deliver(bytes: string, from: string): Promise<void>;
  /** A fresh relationship identity for a proposal this party starts (its own seed range, so two references never share one). */
  mintRel(): Signer;
  /** The signing key of a relationship DID this reference minted as a responder. */
  relSigner(did: string): Signer | undefined;
  exchange(thread: string): ExchangeView | undefined;
  /** The proposal was accepted: the proposer now holds an accepted exchange, so an inbound issue on the thread is handled by the ordinary issue path. */
  adopt(thread: string, ex: ExchangeView & { proposal: Doc }): void;
  /** The executor's record of a ceremony held for approvals (task-consent): its binding, requester, k and state. Undefined: no such ceremony here. */
  /** The issuer pushes an offer to `to` (the reference's own issuer handler); returns its thread and the document. */
  makeOffer(to: string): { thread: string; doc: string };
  /** The verifier mints the nonce it will accept once on a new presentation thread. */
  newNonce(): { thread: string; nonce: string };
  holdsCredential(digest: string): boolean;
  keptPresentation(digest: string): boolean;
  pushed(q: { threadId: string; type: string }): number;
  presentedOn(thread: string): boolean;
  /** The person declined the deferred query on this thread. */
  declinedOn(thread: string): boolean;
  deferredOn(thread: string): boolean;
  /** A witness participant's reading of an exchange (the oracle in mode mint-on-verified); undefined for every other participant. */
  witnessReading?(thread: string): CeremonyState | undefined;
  held(thread: string): { challenge: string; payloadDigest: string; requester: string; k: number; status: "pending" | "committed" | "failed" | "expired" | "aborted" } | undefined;
}

/** What a party keeps of a witnessed exchange (FC-WSH): its own session, the credential the witness minted for it with the retained terminal document, what it shared and what it received. */
interface WshState {
  session?: Doc;
  vrc?: Doc;
  vwc?: Doc;
  terminal?: Doc;
  /** Digests of the credentials this party sent in a share, and whether a receipt for one of them came back matching. */
  sharedDigests: Set<string>;
  receiptMatched: boolean;
  /** The last bundle that reached this party in a witness-share: the credential with its evidence. */
  received?: { vwc: Doc; initiating: Doc; terminal: Doc };
}
interface Thread {
  /** Witnessed exchange state (the thread is the exchange's). */
  w?: WshState;
  /** A witness session thread: the exchange it belongs to and what the witness answered to open it. */
  sess?: { exchange: string; challenge?: string; domain?: string };
  initiated: boolean;
  peer: string;
  accepted: boolean;
  declined: boolean;
  refused: boolean;
  /** Digests of the credentials this party issued on the thread, and whether the delivery receipt for one of them came back matching. */
  issued: Set<string>;
  receiptMatched: boolean;
  relSigner?: Signer;
  /** Further peers whose answers to this thread are owned (the executor asks several approvers on one thread). */
  peers?: Set<string>;
  /** Task-consent view of the thread: the binding an approver was shown, and what the executor answered to its decision. */
  /** Role in a credential exchange on this thread: the issuer that made an offer, the verifier that asked a query, or the holder that received either. */
  cex?: "issuer" | "holder" | "verifier";
  consent?: { challenge: string; payloadDigest: string; outcome?: string; refusedCode?: string };
}
interface Received { from: string; type: string; threadId: string; text: string }

export class CeremonyParty {
  private readonly host: PartyHost;
  private readonly connected = new Set<string>();
  private readonly threads = new Map<string, Thread>();
  private readonly inbox: Received[] = [];
  constructor(host: PartyHost) {
    this.host = host;
  }

  reset(): void {
    this.connected.clear();
    this.threads.clear();
    this.inbox.length = 0;
  }

  /** True once this party has started a step: only then are replies to it, and the receipts of what it issued, handled here rather than as unsolicited documents. */
  active(): boolean {
    return this.threads.size > 0;
  }

  isConnected(vid: string): boolean {
    return this.connected.has(vid);
  }

  async connect(p: ConnectParams): Promise<ConnectResult> {
    if (typeof p.peer?.vid !== "string" || p.peer.vid === "") throw new Error("connect: peer.vid is required");
    this.connected.add(p.peer.vid);
    return { connected: true, detail: "in-process peer recorded (the reference has no carrier to set up)" };
  }

  async initiate(p: InitiateParams): Promise<InitiateResult> {
    if (!this.connected.has(p.to)) throw new Error(`initiate: not connected to ${p.to} (call connect first)`);
    if (p.kind === "vrc-propose") return this.propose(p);
    if (p.kind === "vrc-issue") return this.issue(p);
    if (p.kind === "witness-session") return this.witnessSession(p);
    if (p.kind === "witness-session-submit") return this.witnessSubmit(p);
    if (p.kind === "vrc-witness-share") return this.witnessShare(p);
    if (p.kind === "cex-offer") return this.cexOffer(p);
    if (p.kind === "cex-query") return this.cexQuery(p);
    if (p.kind === "consent-begin") return this.consentBegin(p);
    if (p.kind === "consent-request") return this.consentRequest(p);
    if (p.kind === "consent-decision") return this.consentDecision(p);
    if (p.kind === "consent-gate") return this.consentGate(p);
    if (p.kind === "consent-resubmit") return { threadId: p.thread ?? "", documents: [], sent: true };
    throw new Error(`initiate: this adapter does not start ${p.kind}`);
  }

  private fresh(peer: string, initiated: boolean): Thread {
    return { initiated, peer, accepted: false, declined: false, refused: false, issued: new Set(), receiptMatched: false };
  }

  private cexOffer(p: InitiateParams): InitiateResult {
    const { thread, doc } = this.host.makeOffer(p.to);
    this.threads.set(thread, { ...this.fresh(p.to, true), cex: "issuer" });
    return { threadId: thread, documents: [doc], sent: false };
  }

  /** The verifier's query, bound to a nonce it minted: the holder's presentation (at once, or after its human decides) must answer it. */
  private cexQuery(p: InitiateParams): InitiateResult {
    const { thread, nonce } = this.host.newNonce();
    const doc = this.sign({ id: thread, threadId: thread, type: CEX_QUERY, issuer: this.host.did, recipient: p.to, issuedAt: this.host.stamp(), payload: {
      dcql_query: { credentials: [{ id: "membership", format: "ldp_vc", meta: { type_values: [[QUERY_CRED_TYPE]] } }] }, nonce, purpose: "to confirm your membership before admitting you to the community" } });
    this.threads.set(thread, { ...this.fresh(p.to, true), cex: "verifier" });
    return { threadId: thread, documents: [JSON.stringify(doc)], sent: false };
  }

  /** The requester's begin of a ceremony held for approvals: `args.name`, `args.admins` (the declared approver set, as DIDs). */
  private consentBegin(p: InitiateParams): InitiateResult {
    const admins = p.args?.admins;
    if (typeof p.args?.name !== "string" || !Array.isArray(admins) || admins.some((a) => typeof a !== "string")) throw new Error("initiate consent-begin: args.name and args.admins (strings) are required");
    const doc = this.sign({ id: this.host.newId(), type: CER_BEGIN, issuer: this.host.did, recipient: p.to, issuedAt: this.host.stamp(), payload: { name: p.args.name, admins } });
    this.threads.set(String(doc.id), this.fresh(p.to, true));
    return { threadId: String(doc.id), documents: [JSON.stringify(doc)], sent: false };
  }

  /** The executor asks one approver to decide the ceremony it holds, on the ceremony's thread. */
  private consentRequest(p: InitiateParams): InitiateResult {
    const held = p.thread === undefined ? undefined : this.host.held(p.thread);
    if (p.thread === undefined || held === undefined || held.status !== "pending") throw new Error("initiate consent-request: no ceremony held for approvals on that thread");
    const th = this.threads.get(p.thread) ?? this.fresh(p.to, true);
    (th.peers ??= new Set()).add(p.to);
    this.threads.set(p.thread, th);
    const payload: Doc = {
      challenge: held.challenge, taskType: CER_BEGIN, payloadDigest: held.payloadDigest, sideEffects: "mutating", exposure: { discloses: "none", actsAsSubject: false },
      effects: [], consequences: ["The ceremony's establishing effect runs once enough approvers have decided."], requester: held.requester,
      approverSet: "ceremony-administrator", minApprovals: held.k, excludeRequester: false, expiresAt: new Date(this.host.now() + 600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
    const doc = this.sign({ id: this.host.newId(), threadId: p.thread, type: CONSENT_REQUEST, issuer: this.host.did, recipient: p.to, issuedAt: this.host.stamp(), payload });
    return { threadId: p.thread, documents: [JSON.stringify(doc)], sent: false };
  }

  /**
   * An approver's decision (`args.decision`, default approve) on the binding of the request it was shown, signed under assertionMethod. `args.tamper` changes one
   * thing in it afterwards (src/ceremony/tamper.ts: a harness stand-in for the negative scenarios) and `args.repeat` returns it twice (a replay of the same id).
   */
  private consentDecision(p: InitiateParams): InitiateResult {
    const th = p.thread === undefined ? undefined : this.threads.get(p.thread);
    if (p.thread === undefined || th?.consent === undefined) throw new Error("initiate consent-decision: no consent request was received on that thread");
    const decision = p.args?.decision === "deny" ? "deny" : "approve";
    const doc = signDocument({ id: this.host.newId(), threadId: p.thread, type: CONSENT_DECISION, issuer: this.host.did, recipient: p.to, issuedAt: this.host.stamp(), payload: { challenge: th.consent.challenge, payloadDigest: th.consent.payloadDigest, decision } }, this.host.signer, { created: this.host.now(), purpose: "assertionMethod" });
    let text = JSON.stringify(doc);
    if (p.args?.tamper !== undefined) {
      if (!isTamperMode(p.args.tamper)) throw new Error(`initiate consent-decision: unknown tamper ${String(p.args.tamper)}`);
      text = tamperDecision(text, p.args.tamper, this.host.signer, this.host.now());
    }
    return { threadId: p.thread, documents: p.args?.repeat === true ? [text, text] : [text], sent: false };
  }

  /**
   * The executor starts a ceremony held for approvals and asks `p.to` (FC-KVC, the executor-side step shared with a platform that mints its own request). A hidden requester
   * (a harness stand-in, class D: the requester's submission of the gated task; it is one of the ceremony's administrators, as a begin requires, and never decides) submits the held begin to this executor's own consumer; the request for `p.to` is then
   * built as `consent-request` builds it. `args.approvers`: the declared approver set as identifiers.
   */
  private async consentGate(p: InitiateParams): Promise<InitiateResult> {
    const admins = p.args?.approvers;
    if (!Array.isArray(admins) || admins.some((a) => typeof a !== "string")) throw new Error("initiate consent-gate: args.approvers (strings) is required");
    const requester = signerOf(seedOf(0x66));
    const begin = signDocument({ id: this.host.newId(), type: CER_BEGIN, issuer: requester.did, recipient: this.host.did, issuedAt: this.host.stamp(), payload: { name: "fc-kvc", admins: [...admins, requester.did] } }, requester, { created: this.host.now() });
    await this.host.deliver(JSON.stringify(begin), requester.did);
    return this.consentRequest({ ...p, thread: String(begin.id) });
  }

  private sign(doc: Doc): Doc {
    return signDocument(doc, this.host.signer, { created: this.host.now() });
  }

  private propose(p: InitiateParams): InitiateResult {
    const rel = this.host.mintRel();
    const payload: Doc = { relationshipDid: rel.did, ...(p.args?.witnessed === true ? { witnessed: true } : {}) };
    const doc = this.sign({ id: this.host.newId(), type: VRC_PROPOSE, issuer: this.host.did, recipient: p.to, issuedAt: this.host.stamp(), payload });
    const id = String(doc.id);
    this.threads.set(id, { initiated: true, peer: p.to, accepted: false, declined: false, refused: false, issued: new Set(), receiptMatched: false, relSigner: rel, ...(p.args?.witnessed === true ? { w: this.emptyW() } : {}) });
    return { threadId: id, documents: [JSON.stringify(doc)], sent: false };
  }

  private issue(p: InitiateParams): InitiateResult {
    const thread = p.thread;
    const ex = thread === undefined ? undefined : this.host.exchange(thread);
    if (thread === undefined || ex === undefined || ex.state !== "accepted" || ex.peer !== p.to) throw new Error("initiate: no accepted proposal with that peer on that thread");
    let th = this.threads.get(thread);
    if (th === undefined) {
      th = { initiated: false, peer: p.to, accepted: true, declined: false, refused: false, issued: new Set(), receiptMatched: false };
      this.threads.set(thread, th);
    }
    const signer = th.relSigner ?? this.host.relSigner(ex.myRel);
    if (signer === undefined) throw new Error("initiate: no key for this party's relationship DID");
    const vrc = th.w?.vrc ?? this.makeVrc(ex, signer);
    const digest = digestMultibase(vrc);
    th.issued.add(digest);
    const doc = this.sign({ id: this.host.newId(), threadId: thread, type: VRC_ISSUE, issuer: this.host.did, recipient: p.to, issuedAt: this.host.stamp(), payload: { vrc, vrcDigestMultibase: digest } });
    return { threadId: thread, documents: [JSON.stringify(doc)], sent: false };
  }

  private emptyW(): WshState {
    return { sharedDigests: new Set(), receiptMatched: false };
  }

  /** The relationship credential this party issues to the peer's relationship DID. A witnessed party builds it when it presents it to the witness and issues that same credential later. */
  private makeVrc(ex: ExchangeView, signer: Signer): Doc {
    return signDocument({
      "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiableCredential", "VerifiableRelationshipCredential"],
      issuer: ex.myRel, validFrom: this.host.stamp(), issuerScope: "pairwise", credentialSubject: { id: ex.theirRel },
    }, signer, { created: this.host.now(), purpose: "assertionMethod" });
  }

  /** The accepted exchange a witnessed step belongs to, this party's relationship key and its witnessed state. */
  private witnessed(thread: string | undefined, what: string): { thread: string; th: Thread; ex: ExchangeView; signer: Signer; w: WshState } {
    const ex = thread === undefined ? undefined : this.host.exchange(thread);
    if (thread === undefined || ex === undefined || ex.state !== "accepted") throw new Error(`initiate ${what}: no accepted proposal on that thread`);
    const th = this.threads.get(thread);
    if (th === undefined) throw new Error(`initiate ${what}: this party knows nothing of that thread`);
    const signer = th.relSigner ?? this.host.relSigner(ex.myRel);
    if (signer === undefined) throw new Error(`initiate ${what}: no key for this party's relationship DID`);
    return { thread, th, ex, signer, w: (th.w ??= this.emptyW()) };
  }

  /** witness/session, towards the witness: opened under this party's relationship DID, naming the two relationship DIDs of the exchange, on a thread of its own that points at the exchange (`parentThreadId`). */
  private witnessSession(p: InitiateParams): InitiateResult {
    const { thread, ex, signer, w } = this.witnessed(p.thread, "witness-session");
    const sid = this.host.newId();
    const doc = signDocument({ id: sid, threadId: sid, parentThreadId: thread, type: WITNESS_SESSION, issuer: ex.myRel, recipient: p.to, issuedAt: this.host.stamp(), payload: { parties: [ex.myRel, ex.theirRel] } }, signer, { created: this.host.now() });
    w.session = doc;
    this.threads.set(sid, { ...this.fresh(p.to, true), sess: { exchange: thread } });
    return { threadId: sid, documents: [JSON.stringify(doc)], sent: false, from: ex.myRel };
  }

  /**
   * witness/session/submit: a presentation held by the relationship DID that carries the relationship credential this party will issue, bound to the
   * challenge and domain the witness answered the session with. `args.challengeOf` (a session thread of this party) binds it to that other session's challenge instead:
   * a replayed binding, which a witness must refuse.
   */
  private witnessSubmit(p: InitiateParams): InitiateResult {
    const sess = p.thread === undefined ? undefined : this.threads.get(p.thread)?.sess;
    if (p.thread === undefined || sess === undefined) throw new Error("initiate witness-session-submit: no witness session of this party on that thread");
    const { thread, ex, signer, w } = this.witnessed(sess.exchange, "witness-session-submit");
    const from = typeof p.args?.challengeOf === "string" ? this.threads.get(p.args.challengeOf)?.sess : sess;
    if (from?.challenge === undefined || from.domain === undefined) throw new Error("initiate witness-session-submit: the witness has not answered that session");
    w.vrc ??= this.makeVrc(ex, signer);
    const vp = signDocument({ "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiablePresentation"], holder: ex.myRel, verifiableCredential: [w.vrc] }, signer,
      { created: this.host.now(), purpose: "authentication", controllerMember: "holder", challenge: from.challenge, domain: from.domain });
    const doc = signDocument({ id: this.host.newId(), threadId: p.thread, parentThreadId: thread, type: WITNESS_SUBMIT, issuer: ex.myRel, recipient: p.to, issuedAt: this.host.stamp(), payload: { vp } }, signer, { created: this.host.now() });
    return { threadId: p.thread, documents: [JSON.stringify(doc)], sent: false, from: ex.myRel };
  }

  /**
   * vrc/relationships/witness-share, to the counterparty on the exchange's thread: this party's credential (the one the witness minted for it) in a presentation
   * bound to the exchange and to the share domain, with the retained pair (the session document and the witness's terminal answer). `args.of: "received"` sends
   * the credential and evidence that reached this party instead (the counterparty's own, bounced back), which the counterparty must refuse.
   */
  private witnessShare(p: InitiateParams): InitiateResult {
    const { thread, ex, signer, w } = this.witnessed(p.thread, "vrc-witness-share");
    if (ex.peer !== p.to) throw new Error("initiate vrc-witness-share: the peer is not the exchange's counterparty");
    const own = w.vwc !== undefined && w.session !== undefined && w.terminal !== undefined ? { vwc: w.vwc, initiating: w.session, terminal: w.terminal } : undefined;
    const bundle = p.args?.of === "received" ? w.received : own;
    if (bundle === undefined) throw new Error(`initiate vrc-witness-share: this party holds no ${p.args?.of === "received" ? "received" : "witnessed"} credential to share`);
    const vp = signDocument({ "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiablePresentation"], holder: ex.myRel, verifiableCredential: [bundle.vwc] }, signer,
      { created: this.host.now(), purpose: "authentication", controllerMember: "holder", challenge: thread, domain: WSH_DOMAIN });
    w.sharedDigests.add(digestMultibase(bundle.vwc));
    const doc = this.sign({ id: this.host.newId(), threadId: thread, type: WSH, issuer: this.host.did, recipient: p.to, issuedAt: this.host.stamp(), payload: { presentation: vp, outcomeEvidence: { initiating: bundle.initiating, terminal: bundle.terminal } } });
    return { threadId: thread, documents: [JSON.stringify(doc)], sent: false };
  }

  /** Every document that reaches the reference is kept in the inbox, whatever happens to it next. */
  note(doc: Doc, from: string): void {
    this.inbox.push({ from, type: String(doc.type ?? ""), threadId: threadOf(doc), text: JSON.stringify(doc) });
    if (doc.type === CONSENT_REQUEST && typeof (doc.payload as Doc | undefined)?.challenge === "string") {
      const th = this.threads.get(threadOf(doc)) ?? this.fresh(from, false);
      th.consent = { challenge: String((doc.payload as Doc).challenge), payloadDigest: String((doc.payload as Doc).payloadDigest) };
      this.threads.set(threadOf(doc), th);
    }
    if ((doc.type === CEX_OFFER || doc.type === CEX_QUERY) && !this.threads.has(threadOf(doc))) this.threads.set(threadOf(doc), { ...this.fresh(from, false), cex: "holder" });
    // a proposal that reaches this party as responder opens its thread record, so `ceremony` can read it
    if (doc.type === VRC_PROPOSE && !this.threads.has(threadOf(doc))) {
      this.threads.set(threadOf(doc), { initiated: false, peer: from, accepted: false, declined: false, refused: false, issued: new Set(), receiptMatched: false, ...((doc.payload as Doc | undefined)?.witnessed === true ? { w: this.emptyW() } : {}) });
    }
    // a witness-share that reaches this party: keep what it carried (the credential with its evidence), whether or not it was accepted
    if (doc.type === WSH) {
      const th = this.threads.get(threadOf(doc));
      const pl = (doc.payload ?? {}) as Doc;
      const ev = (pl.outcomeEvidence ?? {}) as Doc;
      const vwc = (((pl.presentation ?? {}) as Doc).verifiableCredential as Doc[] | undefined)?.[0];
      if (th?.w !== undefined && vwc !== undefined && ev.initiating !== undefined && ev.terminal !== undefined) th.w.received = { vwc, initiating: ev.initiating as Doc, terminal: ev.terminal as Doc };
    }
  }

  /** Whether this document is the answer to a step this party started (a reply, a receipt, or an error on one of its threads): handled here, never answered. */
  owns(doc: Doc): boolean {
    const th = this.threads.get(threadOf(doc));
    const type = String(doc.type ?? "");
    return th !== undefined && (th.peer === doc.issuer || th.peers?.has(String(doc.issuer)) === true) && (type.endsWith("#response") || type.includes("/trust-task-error/") || type === NEXT_STEP);
  }

  /** Handle an owned reply: record what it means for the thread. Nothing is sent back. */
  receive(doc: Doc): void {
    const thread = threadOf(doc);
    const th = this.threads.get(thread)!;
    const type = String(doc.type ?? "");
    const p = (doc.payload ?? {}) as Doc;
    if (type === NEXT_STEP) return; // a hold: the thread stays open
    if (th.sess !== undefined) {
      // a witness session thread: the witness's answers to it
      const x = this.threads.get(th.sess.exchange);
      if (type === `${WITNESS_SESSION}#response` && typeof p.challenge === "string" && typeof p.domain === "string") { th.sess.challenge = p.challenge; th.sess.domain = p.domain; return; }
      if (type === `${WITNESS_SUBMIT}#response` && x?.w !== undefined && isDoc(p.vwc) && digestMultibase(p.vwc as never) === p.vwcDigestMultibase && (p.vwc as Doc).taskContext === threadOf(doc)) { x.w.vwc = p.vwc as Doc; x.w.terminal = doc; return; }
      if (type.includes("/trust-task-error/") && x !== undefined) x.refused = true;
      return;
    }
    if (type === `${WSH}#response`) {
      if (th.w !== undefined && typeof p.vwcDigestMultibase === "string" && th.w.sharedDigests.has(p.vwcDigestMultibase)) th.w.receiptMatched = true;
      return;
    }
    if (type === `${CONSENT_DECISION}#response`) {
      if (th.consent !== undefined && typeof p.status === "string") th.consent.outcome = p.status;
      return;
    }
    if (type.includes("/trust-task-error/") && typeof p.code === "string" && (p.code.startsWith("task-consent/decision:") || th.consent !== undefined)) {
      // a refusal of this approver's decision: a ceremony code, or a framework one (proofInvalid, wrongRecipient, expired, ...)
      if (th.consent !== undefined) th.consent.refusedCode = p.code;
      return;
    }
    if (type.includes("/trust-task-error/")) {
      if (p.code === PROPOSE_DECLINED) th.declined = true;
      else th.refused = true;
      return;
    }
    if (type === `${VRC_PROPOSE}#response` && th.initiated && p.accept === true && typeof p.relationshipDid === "string" && p.relationshipDid !== th.peer) {
      th.accepted = true;
      const proposal = JSON.parse(this.inbox.find((r) => r.threadId === thread && r.type === VRC_PROPOSE)?.text ?? "{}") as Doc;
      this.host.adopt(thread, { peer: th.peer, theirRel: p.relationshipDid, myRel: th.relSigner!.did, state: "accepted", stored: [], proposal });
      return;
    }
    if (type === `${VRC_ISSUE}#response` && typeof p.vrcDigestMultibase === "string" && th.issued.has(p.vrcDigestMultibase)) th.receiptMatched = true;
  }

  /** Mutants that break the receipt this implementation sends for a credential it was handed. */
  mutateReplies(request: Doc, replies: string[]): string[] {
    if (request.type !== VRC_ISSUE && request.type !== WSH && !RECEIPT_ONLY.includes(String(request.type))) return replies;
    const out: string[] = [];
    const digestMember = request.type === WSH ? "vwcDigestMultibase" : "vrcDigestMultibase";
    for (const text of replies) {
      const r = JSON.parse(text) as Doc;
      if (r.type !== `${String(request.type)}#response`) { out.push(text); continue; }
      if (this.host.mutated("ceremonyDropReceipt")) continue;
      if (this.host.mutated("ceremonyReceiptWrongThread")) r.threadId = this.host.newId();
      if (this.host.mutated("ceremonyReceiptWrongDigest") && !RECEIPT_ONLY.includes(String(request.type))) r.payload = { ...(r.payload as Doc), [digestMember]: digestMultibase({ tampered: true }) };
      out.push(JSON.stringify(r));
    }
    return out;
  }

  /**
   * The reading of a credential-exchange thread, from what this party itself holds. Holder: completed when it holds the credential that was issued to it on
   * the thread (an offer) or has presented on it (a query), held while a query waits for its human. Issuer: completed when it has issued on the thread
   * (the issue has no answer: accepted is silence). Verifier: completed when it kept the presentation that arrived on the thread.
   */
  private cexReading(thread: string, role: "issuer" | "holder" | "verifier"): CeremonyState {
    const inbound = (type: string): Doc[] => this.inbox.filter((r) => r.threadId === thread && r.type === type).map((r) => JSON.parse(r.text) as Doc);
    if (role === "issuer") return this.host.pushed({ threadId: thread, type: CEX_ISSUE }) > 0 ? "completed" : "open";
    if (role === "verifier") {
      const kept = inbound(CEX_PRESENT).some((d) => this.host.keptPresentation(digestMultibase(((d.payload ?? {}) as Doc).vp_token as never)));
      return kept ? "completed" : "open";
    }
    // the verifier refused what this holder presented (an error that reached the holder on the thread after it presented): the exchange did not complete
    if (this.host.presentedOn(thread) && this.threads.get(thread)?.refused === true) return "refused";
    const issued = inbound(CEX_ISSUE).some((d) => {
      const c = (((d.payload ?? {}) as Doc).credential_response as Doc | undefined)?.credential;
      return c !== undefined && this.host.holdsCredential(digestMultibase(c as never));
    });
    if (issued || this.host.presentedOn(thread) && !this.host.deferredOn(thread)) return "completed";
    if (this.host.declinedOn(thread)) return "declined";
    return this.host.deferredOn(thread) ? "held" : "open";
  }

  received(q: { from?: string; threadId?: string; type?: string }): ObserveResult {
    const documents = this.inbox
      .filter((r) => (q.from === undefined || r.from === q.from) && (q.type === undefined || r.type === q.type) && (q.threadId === undefined || r.threadId === q.threadId))
      .map((r) => r.text);
    return { value: documents.length, documents };
  }

  /**
   * This party's own reading of a thread. `completed`: it holds the other party's credential and the delivery receipt for the one it issued matched its
   * digest. A thread it knows nothing about is `unknown`, never invented.
   */
  ceremony(thread: string): ObserveResult {
    const th = this.threads.get(thread);
    const ex = this.host.exchange(thread);
    const held = this.host.held(thread);
    const witness = this.host.witnessReading?.(thread);
    if (witness !== undefined) return { value: witness };
    if (held !== undefined) {
      // the executor of a ceremony held for approvals: its own record is the reading
      const value: CeremonyState = held.status === "committed" ? "completed" : held.status === "pending" ? "held" : held.status === "expired" ? "expired" : held.status === "aborted" ? "aborted" : "refused";
      return { value };
    }
    if (th?.cex !== undefined) return { value: this.cexReading(thread, th.cex) };
    if (th?.consent !== undefined) {
      // an approver: it reads what the executor answered to its own decision (held while more approvals are awaited)
      const o = th.consent.outcome;
      const value: CeremonyState = o === "granted" ? "completed" : o === "denied" ? "aborted" : o === "pending" ? "held" : th.consent.refusedCode !== undefined ? "refused" : "open";
      return { value };
    }
    let value: CeremonyState = "unknown";
    if (th !== undefined || ex !== undefined) {
      if (th?.declined === true || ex?.state === "declined") value = "declined";
      else if (th?.refused === true) value = "refused";
      else if (this.host.mutated("ceremonyEarlyCompletion") && (th?.accepted === true || ex?.state === "accepted")) value = "completed";
      else if (th?.w !== undefined) {
        // a witnessed exchange: the credential the counterparty issued, the receipt for the one issued, the counterparty's witnessed credential held and the share receipt matching its digest
        value = ex?.state === "accepted" && ex.stored.length > 0 && th.receiptMatched && (ex.shared?.length ?? 0) > 0 && th.w.receiptMatched ? "completed" : "open";
      }
      else if (ex?.state === "accepted" && ex.stored.length > 0 && th?.receiptMatched === true) value = "completed";
      else if (ex?.state === "held") value = "held";
      else value = "open";
    }
    return { value };
  }
}
