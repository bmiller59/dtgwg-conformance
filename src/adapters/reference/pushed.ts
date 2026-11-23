// SPDX-License-Identifier: Apache-2.0
// Reference adapter: pushed documents (optional capability `observe.pushed`, docs/20). The credential-exchange tasks that are answered not by
// a reply but by the next task pushed to the counterparty on the same thread. Spec-stated behaviour only (all three specs are status draft,
// kit specs/credential-exchange/{offer,request,present}/0.1):
//   offer   : the holder reads the offer "then reply on-thread" with `request` (offer Conformance; request Conformance: "Reply on the offer's thread").
//   request : the issuer verifies and "Answer on-thread with `issue`" (request Conformance).
//   present : "for a deferred query, present on the original thread once approval lands" (present Conformance).
// The reference does not mint a real OID4VCI key-binding proof: the request it pushes carries a structural stand-in, which vectors never assert.
import { ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import { signDocument } from "../../crypto/proof.ts";
import { PushedBox, threadOf } from "../../adapter/pushed.ts";
import { isoSeconds } from "../../util/json.ts";
import type { MutantId } from "./mutants.ts";

const T = "https://trusttasks.org/spec/credential-exchange";
const OFFER = `${T}/offer/0.1`, REQUEST = `${T}/request/0.1`, ISSUE = `${T}/issue/0.1`, QUERY = `${T}/query/0.1`;
const STAND_IN_JWT = "eyJhbGciOiJFZERTQSIsInR5cCI6Im9wZW5pZDR2Y2ktcHJvb2Yrand0In0.e30.c2ln";

type Doc = Record<string, unknown>;

/** What the reference adapter lends: its identity, clock, id source, mutant switch and the finishing (issuedAt, signing when attested) of every document it emits. */
export interface PushHost {
  did: string;
  now(): number;
  newId(): string;
  m(id: MutantId): boolean;
  signer: Parameters<typeof signDocument>[1];
  finish(doc: Doc): Doc;
}

export class ReferencePush {
  readonly box = new PushedBox();
  /** Threads of offers this implementation (as issuer) made. */
  private readonly offers = new Set<string>();

  private readonly host: PushHost;
  constructor(host: PushHost) {
    this.host = host;
  }

  clear(): void {
    this.box.clear();
    this.offers.clear();
  }

  /** Record one pushed document, after the mutants that break its addressing. */
  private push(doc: Doc): void {
    const h = this.host;
    if (h.m("noPush")) return;
    const d: Doc = { ...doc };
    if (h.m("pushedWrongThread")) d.threadId = h.newId();
    if (h.m("pushedWrongRecipient")) d.recipient = ed25519Signer(seedOf(0x44)).did;
    if (h.m("pushedWrongType")) d.type = QUERY;
    this.box.record(h.finish(d));
  }

  private base(type: string, to: unknown, thread: string, payload: Doc): Doc {
    return { id: this.host.newId(), threadId: thread, type, issuer: this.host.did, recipient: to, payload };
  }

  /** Record a document exactly as given, bypassing the finishing that would sign it again (the tamper stand-in of the ceremony scenarios, src/ceremony/tamper.ts, class D). */
  recordRaw(doc: Doc, to: string): void {
    this.box.record(doc, to);
  }

  /** A document a ceremony party pushes on its own (its recipient and thread are in the document); the pushed mutants apply as to every pushed document. */
  pushDoc(doc: Doc): void {
    this.push(doc);
  }

  /** The IUT (holder) accepted an offer: its answer is a `request` to the issuer on the offer's thread. */
  onOfferAccepted(offer: Doc, configurationId: string): void {
    this.push(this.base(REQUEST, offer.issuer, threadOf(offer), { credential_request: { credential_configuration_id: configurationId, proofs: { jwt: [STAND_IN_JWT] } } }));
  }

  /** The IUT refused an offer. Nothing is pushed; the mutant `pushOnRefusal` pushes the request anyway. */
  onOfferRefused(offer: Doc, configurationId: string): void {
    if (this.host.m("pushOnRefusal")) this.onOfferAccepted(offer, configurationId);
  }

  /** Helper `makeOffer {to}`: the IUT (issuer) opens an issuance thread by pushing an offer to `to`; returns the thread. */
  makeOffer(to: string, configurationId: string): string {
    const thread = this.host.newId();
    this.offers.add(thread);
    this.push(this.base(OFFER, to, thread, { credential_offer: { credential_issuer: "https://issuer.example", credential_configuration_ids: [configurationId] } }));
    return thread;
  }

  /** A request arrived. Whether it corresponds to an offer made here decides the answer: `issue` to the holder on the same thread (true), or none (false). */
  onRequest(request: Doc): boolean {
    const known = this.offers.has(threadOf(request));
    if (known || this.host.m("pushOnRefusal")) {
      const h = this.host;
      const vc = signDocument({ "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiableCredential", "ConformanceCredential"], issuer: h.did, validFrom: isoSeconds(h.now()), credentialSubject: { id: request.issuer } }, h.signer, { created: h.now(), purpose: "assertionMethod" });
      this.push(this.base(ISSUE, request.issuer, threadOf(request), { credential_response: { credential: vc } }));
    }
    return known;
  }

  /** The IUT's human approved a deferred query: the presentation (already built and finished) goes to the verifier on the query's thread. A decline pushes nothing (mutant `pushOnDecline` pushes it). */
  onQueryDecision(presentation: Doc, approved: boolean): void {
    if (approved || this.host.m("pushOnDecline")) this.push(presentation);
  }
}

