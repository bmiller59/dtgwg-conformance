// SPDX-License-Identifier: Apache-2.0
// Reference adapter: the identity-vetting party (group FC-VET, docs/25 section 6.6), after ceremonies/vetting/identity-vetting/0.1 in the Trust Tasks repository.
// One party plays either role. As the VETTER it keeps a request record (a minted `requestId`), opens sessions with a challenge and a domain it minted (at most
// three rounds), checks the signed Vetting Card the applicant answers a session with, and ends the request with a Vetting Statement (`attest`) or a `decline`.
// As the APPLICANT it asks, answers a session with a card bound to that session and holds the statement the vetter issues. It models only what the scenario
// observes: it is never a model of a community's vetter policy, eligibility, tickets or the match code (not exercised).
// The statement is the vetting/session specification's: a StatementCredential under the `vetted` predicate that cites the session by `taskContext` and
// `taskDigestMultibase`, the same outcome-evidence citation as FC-WSH. The applicant refuses a statement that cites no session of its own.
import { randomBytes } from "node:crypto";
import type { CeremonyState, InitiateParams, InitiateResult } from "../../adapter/contract.ts";
import { threadOf } from "../../adapter/pushed.ts";
import { digestMultibase } from "../../crypto/digest.ts";
import { signDocument, verifyDocumentProof } from "../../crypto/proof.ts";
import { errorOf, isDoc } from "./flow-part.ts";
import type { Doc, FlowHost, FlowPart, FlowSchema } from "./flow-part.ts";

const VET = "https://trusttasks.org/spec/vetting";
export const VET_REQUEST = `${VET}/request/0.1`;
export const VET_SESSION = `${VET}/session/0.1`;
export const VET_DECLINE = `${VET}/decline/0.1`;
const CEX_ISSUE = "https://trusttasks.org/spec/credential-exchange/issue/0.1";
export const VET_PREDICATE = "https://registry.trustoverip.org/dtg/vsc/vetted/1";
export const VET_KINDS = ["vetting-request", "vetting-session", "vetting-answer", "vetting-attest", "vetting-decline"];
export const VET_ROLES = [{ ceremony: "FC-VET", roles: ["applicant", "vetter"] }];
const MAX_ROUNDS = 3;
const SESSION_MS = 15 * 60_000;
const DID = "^did:";
const REQUIRED_CLAIMS = ["name.legal"];

interface Sess {
  id: string;
  doc: Doc;
  challenge: string;
  domain: string;
  expiresAt: string;
  /** Vetter: the card was checked and accepted. */
  cardOk: boolean;
  cardDigest?: string;
  identityCommitment?: string;
}
interface Req {
  role: "applicant" | "vetter";
  peer: string;
  thread: string;
  community: string;
  joinDid: string;
  requestId?: string;
  sessions: Sess[];
  /** Applicant: the commitment salt, one per application. */
  salt?: string;
  attested: boolean;
  statement?: string;
  declined: boolean;
  /** The kind of document that was answered with an error, by what this party started (vetter: attest, decline, session; applicant: card). */
  refused: Set<string>;
}

const withoutProof = (d: Doc): Doc => { const { proof: _p, ...rest } = d; return rest; };
const b64 = (): string => randomBytes(32).toString("base64url");
const commitment = (salt: string, claims: { type: string; value: unknown }[]): string =>
  digestMultibase({ salt, claims: claims.filter((c) => REQUIRED_CLAIMS.includes(c.type)).map(({ type, value }) => ({ type, value })).sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : JSON.stringify(a.value) < JSON.stringify(b.value) ? -1 : 1)) });

export class VettingParty implements FlowPart {
  readonly kinds = VET_KINDS;
  readonly roles = VET_ROLES;
  private readonly h: FlowHost;
  private readonly reqs = new Map<string, Req>();
  private readonly bySession = new Map<string, Req>();
  /** The documents this party sent: id to the record and the kind. An error that answers one of them is read from here. */
  private readonly sent = new Map<string, { req: Req; kind: string }>();
  constructor(host: FlowHost) {
    this.h = host;
  }

  reset(): void {
    this.reqs.clear();
    this.bySession.clear();
    this.sent.clear();
  }
  types(): string[] {
    return [VET_REQUEST, VET_SESSION, VET_DECLINE];
  }
  schema(type: string): FlowSchema | undefined {
    if (type === VET_REQUEST) return { required: ["community", "joinDid"], properties: { community: { type: "string", pattern: DID }, joinDid: { type: "string", pattern: DID }, message: { type: "string" }, ext: { type: "object" } } };
    if (type === VET_SESSION) {
      return { required: ["requestId", "challenge", "domain", "method", "requiredClaims", "expiresAt"], properties: { requestId: { type: "string" }, challenge: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" }, domain: { type: "string", pattern: DID },
        method: { type: "string", pattern: "^(inPerson|video|priorAcquaintance)$" }, requiredClaims: { type: "array", itemType: "string" }, optionalClaims: { type: "array", itemType: "string" }, expiresAt: { type: "string" }, ext: { type: "object" } } };
    }
    if (type === VET_DECLINE) return { required: ["requestId"], properties: { requestId: { type: "string" }, code: { type: "string", pattern: "^(couldNotVerify|documentMismatch|livenessFailed|notComfortable|other)$" }, message: { type: "string" }, ext: { type: "object" } } };
    return undefined;
  }

  private sign(doc: Doc): Doc {
    return signDocument(doc, this.h.signer, { created: this.h.now() });
  }
  private reqOf(thread: string | undefined, role: Req["role"], what: string): Req {
    const r = thread === undefined ? undefined : this.reqs.get(thread);
    if (r === undefined || r.role !== role) throw new Error(`initiate ${what}: no vetting request of this ${role} on that thread`);
    return r;
  }

  // ---------------------------------------------------------------- the documents this party starts
  initiate(p: InitiateParams): InitiateResult {
    if (!this.h.isConnected(p.to)) throw new Error(`initiate: not connected to ${p.to} (call connect first)`);
    if (p.kind === "vetting-request") return this.request(p);
    if (p.kind === "vetting-session") return this.session(p);
    if (p.kind === "vetting-answer") return this.answer(p);
    if (p.kind === "vetting-attest") return this.attest(p);
    return this.decline(p);
  }

  /** The applicant asks `to` to vet it for `args.community`; the join DID is its own. */
  private request(p: InitiateParams): InitiateResult {
    const community = typeof p.args?.community === "string" ? p.args.community : "did:example:vetting-community";
    const doc = this.sign({ id: this.h.newId(), type: VET_REQUEST, issuer: this.h.did, recipient: p.to, issuedAt: this.h.stamp(), payload: { community, joinDid: this.h.did } });
    const thread = String(doc.id);
    this.reqs.set(thread, { role: "applicant", peer: p.to, thread, community, joinDid: this.h.did, sessions: [], attested: false, declined: false, refused: new Set() });
    return { threadId: thread, documents: [JSON.stringify(doc)], sent: false };
  }

  /** The vetter opens a session for the request it accepted: its own thread, a fresh challenge, the request's community as domain, `parentThreadId` the request exchange. At most three rounds. */
  private session(p: InitiateParams): InitiateResult {
    const req = this.reqOf(p.thread, "vetter", "vetting-session");
    if (req.peer !== p.to || req.requestId === undefined) throw new Error("initiate vetting-session: the request was not accepted from that peer");
    if (req.sessions.length >= MAX_ROUNDS) throw new Error(`initiate vetting-session: at most ${MAX_ROUNDS} rounds`);
    if (req.attested || req.declined) throw new Error("initiate vetting-session: the request has ended");
    const id = this.h.newId();
    const expiresAt = new Date(this.h.now() + SESSION_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
    const doc = this.sign({ id, threadId: id, parentThreadId: req.thread, type: VET_SESSION, issuer: this.h.did, recipient: p.to, issuedAt: this.h.stamp(),
      payload: { requestId: req.requestId, challenge: b64(), domain: req.community, method: "video", requiredClaims: REQUIRED_CLAIMS, expiresAt } });
    const pl = doc.payload as Doc;
    const s: Sess = { id, doc, challenge: String(pl.challenge), domain: req.community, expiresAt, cardOk: false };
    req.sessions.push(s);
    this.bySession.set(id, req);
    this.sent.set(id, { req, kind: "session" });
    return { threadId: id, documents: [JSON.stringify(doc)], sent: false };
  }

  /** The applicant's answer to a session: the signed Vetting Card, bound to the session's challenge and domain and addressed to the vetter. `args.bind: "other"` binds it to a challenge of no session. */
  private answer(p: InitiateParams): InitiateResult {
    const req = p.thread === undefined ? undefined : this.bySession.get(p.thread);
    const s = req?.sessions.find((x) => x.id === p.thread);
    if (req === undefined || s === undefined || req.role !== "applicant") throw new Error("initiate vetting-answer: no session was received on that thread");
    req.salt ??= b64();
    const claims = [{ type: "name.legal", value: "Example Applicant", provenance: "selfAsserted" }];
    const other = p.args?.bind === "other" || this.h.mutated("vetCardUnbound");
    const card = signDocument({
      type: ["VerifiableDataStructure", "RelationshipCard", "VettingCard"], id: this.h.newId(), publisher: this.h.did, cardVersion: 1, audience: req.peer, community: s.domain,
      challenge: other ? b64() : s.challenge, domain: s.domain, issuedAt: this.h.stamp(), expiresAt: s.expiresAt, claims, identityCommitment: commitment(req.salt, claims), commitmentSalt: req.salt,
    }, this.h.signer, { created: this.h.now(), purpose: "assertionMethod", controllerMember: "publisher" });
    const doc = this.sign({ id: this.h.newId(), threadId: s.id, parentThreadId: req.thread, type: `${VET_SESSION}#response`, issuer: this.h.did, recipient: p.to, issuedAt: this.h.stamp(), payload: { card } });
    this.sent.set(String(doc.id), { req, kind: "card" });
    return { threadId: s.id, documents: [JSON.stringify(doc)], sent: false };
  }

  /** The vetter's Vetting Statement over credential-exchange/issue, on the request's thread. It cites the session whose card it accepted. `args.without: "session"` issues it with no session (citing the request exchange), which an applicant must refuse. */
  private attest(p: InitiateParams): InitiateResult {
    const req = this.reqOf(p.thread, "vetter", "vetting-attest");
    if (req.peer !== p.to) throw new Error("initiate vetting-attest: the peer is not the request's applicant");
    const without = p.args?.without === "session";
    const s = [...req.sessions].reverse().find((x) => x.cardOk);
    if (s === undefined && !without) throw new Error("initiate vetting-attest: no session with an accepted card to cite");
    if (req.declined && !without) throw new Error("initiate vetting-attest: the request was declined");
    const cited = s === undefined ? { id: req.thread, digest: digestMultibase({ request: req.thread }) } : { id: s.id, digest: digestMultibase(withoutProof(s.doc)) };
    const vc = signDocument({
      "@context": ["https://www.w3.org/ns/credentials/v2", "https://registry.trustoverip.org/dtg/context/v1"], id: this.h.newId(),
      type: ["VerifiableCredential", "DTGCredential", "StatementCredential"], issuer: this.h.did, issuerScope: "directed", validFrom: this.h.stamp(), taskContext: cited.id, taskDigestMultibase: cited.digest,
      credentialSubject: { id: req.joinDid, predicate: VET_PREDICATE, object: { value: { community: req.community, method: "video", claimsVerified: REQUIRED_CLAIMS, livenessConfirmed: true,
        identityCommitment: s?.identityCommitment ?? digestMultibase({ none: req.thread }), cardDigestMultibase: s?.cardDigest ?? digestMultibase({ none: req.thread }), declaredRelationship: "none" } } },
    }, this.h.signer, { created: this.h.now(), purpose: "assertionMethod" });
    const doc = this.sign({ id: this.h.newId(), threadId: req.thread, type: CEX_ISSUE, issuer: this.h.did, recipient: p.to, issuedAt: this.h.stamp(), payload: { credential_response: { credential: vc } } });
    req.attested = true;
    this.sent.set(String(doc.id), { req, kind: "attest" });
    return { threadId: req.thread, documents: [JSON.stringify(doc)], sent: false };
  }

  /** The vetter's decline. After a statement the request has ended: an honest vetter does not send one (`args.force` sends it anyway, which an applicant must refuse). */
  private decline(p: InitiateParams): InitiateResult {
    const req = this.reqOf(p.thread, "vetter", "vetting-decline");
    if (req.peer !== p.to || req.requestId === undefined) throw new Error("initiate vetting-decline: the request was not accepted from that peer");
    if ((req.attested || req.declined) && p.args?.force !== true) throw new Error("initiate vetting-decline: the request has already ended");
    const doc = this.sign({ id: this.h.newId(), parentThreadId: req.thread, type: VET_DECLINE, issuer: this.h.did, recipient: p.to, issuedAt: this.h.stamp(), payload: { requestId: req.requestId, code: "couldNotVerify" } });
    if (!req.attested) req.declined = true;
    this.sent.set(String(doc.id), { req, kind: "decline" });
    return { threadId: String(doc.id), documents: [JSON.stringify(doc)], sent: false };
  }

  // ---------------------------------------------------------------- the documents this party receives
  handle(doc: Doc): Doc | undefined {
    if (doc.type === VET_REQUEST) return this.onRequest(doc);
    if (doc.type === VET_SESSION) return this.onSession(doc);
    return this.onDecline(doc);
  }

  private onRequest(doc: Doc): Doc {
    const pl = doc.payload as { community: string; joinDid: string };
    if (pl.joinDid !== doc.issuer) return this.h.refuse(doc, "malformedRequest", "joinDid must equal the document's issuer");
    const thread = threadOf(doc);
    let req = this.reqs.get(thread);
    if (req === undefined) {
      req = { role: "vetter", peer: String(doc.issuer), thread, community: pl.community, joinDid: pl.joinDid, requestId: this.h.newId(), sessions: [], attested: false, declined: false, refused: new Set() };
      this.reqs.set(thread, req);
    } else if (req.peer !== doc.issuer) return this.h.refuse(doc, "permissionDenied", "not permitted");
    return { id: this.h.newId(), threadId: thread, type: `${VET_REQUEST}#response`, recipient: doc.issuer, payload: { requestId: req.requestId } };
  }

  /** A session reaches the applicant: only one from the vetter that accepted the request, naming that request's id. The card is answered later (`vetting-answer`), when its person has seen the match code. */
  private onSession(doc: Doc): Doc | undefined {
    const req = typeof doc.parentThreadId === "string" ? this.reqs.get(doc.parentThreadId) : undefined;
    const pl = doc.payload as { requestId: string; challenge: string; domain: string; expiresAt: string };
    if (req === undefined || req.role !== "applicant" || req.peer !== doc.issuer || req.requestId === undefined || req.requestId !== pl.requestId) return this.h.refuse(doc, "vetting/session:unknownRequest", "no accepted vetting request from this vetter with that requestId");
    const id = String(doc.id);
    if (!req.sessions.some((s) => s.id === id)) {
      req.sessions.push({ id, doc, challenge: pl.challenge, domain: pl.domain, expiresAt: pl.expiresAt, cardOk: false });
      this.bySession.set(id, req);
    }
    return undefined;
  }

  private onDecline(doc: Doc): Doc | undefined {
    const req = typeof doc.parentThreadId === "string" ? this.reqs.get(doc.parentThreadId) : undefined;
    if (req === undefined || req.role !== "applicant" || req.peer !== doc.issuer || req.requestId !== (doc.payload as { requestId: string }).requestId) return this.h.refuse(doc, "taskFailed", "no accepted vetting request from this vetter with that requestId");
    if (req.statement !== undefined && !this.h.mutated("vetAcceptsDeclineAfterAttest")) return this.h.refuse(doc, "taskFailed", "the request already ended with a statement");
    req.declined = true;
    return undefined;
  }

  /**
   * The statement the vetter issues (credential-exchange/issue on the request's thread), checked before the ordinary holder path stores it: it must cite a session
   * of this request by `taskContext` and by the digest of that session document, under the `vetted` predicate, issued by the vetter that holds the request.
   * Returns the reason to refuse, or undefined (the statement is then recorded as the request's outcome).
   */
  checkStatement(doc: Doc): string | undefined {
    const req = this.reqs.get(threadOf(doc));
    if (req === undefined || req.role !== "applicant") return undefined;
    const vc = (((doc.payload ?? {}) as Doc).credential_response as Doc | undefined)?.credential;
    if (!isDoc(vc) || doc.issuer !== req.peer || vc.issuer !== req.peer) return "the statement is not the vetter's";
    const subject = isDoc(vc.credentialSubject) ? vc.credentialSubject : {};
    if (subject.predicate !== VET_PREDICATE) return "the statement is not under the vetted predicate";
    if (!this.h.mutated("vetAcceptsUncitedStatement")) {
      const s = req.sessions.find((x) => x.id === vc.taskContext);
      if (s === undefined) return "the statement cites no session of this vetting";
      if (vc.taskDigestMultibase !== digestMultibase(withoutProof(s.doc))) return "the statement's task digest is not that of the session it cites";
    }
    req.statement = digestMultibase(vc);
    return undefined;
  }

  // ---------------------------------------------------------------- answers to what this party started
  owns(doc: Doc): boolean {
    const type = String(doc.type ?? "");
    if (errorOf(doc)) return this.sent.has(String(((doc.payload ?? {}) as { inResponseTo?: { id?: string } }).inResponseTo?.id));
    if (!type.endsWith("#response")) return false;
    const req = this.reqs.get(threadOf(doc)) ?? this.bySession.get(threadOf(doc));
    return req !== undefined && req.peer === doc.issuer && (type === `${VET_REQUEST}#response` || type === `${VET_SESSION}#response`);
  }

  receive(doc: Doc): Doc[] | undefined {
    const pl = (doc.payload ?? {}) as Doc;
    if (errorOf(doc)) {
      const hit = this.sent.get(String((pl.inResponseTo as { id?: string } | undefined)?.id));
      if (hit !== undefined && hit.req.peer === doc.issuer) hit.req.refused.add(hit.kind);
      return undefined;
    }
    if (doc.type === `${VET_REQUEST}#response`) {
      const req = this.reqs.get(threadOf(doc))!;
      if (req.role === "applicant" && typeof pl.requestId === "string") req.requestId = pl.requestId;
      return undefined;
    }
    return this.onCard(doc, pl);
  }

  /** The vetter checks the card before it accepts it (vetting/session, Conformance vetter 5); a card that fails is refused and no statement may follow. */
  private onCard(doc: Doc, pl: Doc): Doc[] {
    const s = this.bySession.get(threadOf(doc))?.sessions.find((x) => x.id === threadOf(doc));
    const req = this.bySession.get(threadOf(doc));
    if (s === undefined || req === undefined || req.role !== "vetter") return [this.h.refuse(doc, "taskFailed", "no session of this vetter on that thread")];
    const card = pl.card;
    const bad = (m: string): Doc[] => [this.h.refuse(doc, "taskFailed", m)];
    if (!isDoc(card)) return bad("no card");
    if (!verifyDocumentProof(doc, { nowMs: this.h.now() }).valid) return bad("the response proof does not verify");
    const v = verifyDocumentProof(card, { nowMs: this.h.now(), controllerMember: "publisher" });
    if (!v.valid || v.purpose !== "assertionMethod") return bad("the card's proof does not verify under an assertionMethod key of its publisher");
    if (card.publisher !== req.joinDid || card.publisher !== doc.issuer || card.audience !== this.h.did) return bad("the card's publisher or audience is not the applicant's or this vetter's");
    if (!this.h.mutated("vetAcceptsUnboundCard") && (card.community !== s.domain || card.challenge !== s.challenge || card.domain !== s.domain)) return bad("the card is not bound to this session's challenge, domain and community");
    const exp = Date.parse(String(card.expiresAt));
    if (!(exp > this.h.now()) || exp > Date.parse(s.expiresAt)) return bad("the card has expired or outlives the session");
    const claims = Array.isArray(card.claims) ? (card.claims as { type: string; value: unknown }[]) : [];
    if (!REQUIRED_CLAIMS.every((t) => claims.some((c) => c.type === t))) return bad("a required claim is missing");
    if (card.identityCommitment !== commitment(String(card.commitmentSalt), claims)) return bad("the identity commitment does not recompute");
    s.cardOk = true;
    s.cardDigest = digestMultibase(card);
    s.identityCommitment = String(card.identityCommitment);
    return [];
  }

  /** The party's own reading of a request thread (or of one of its session threads). */
  reading(thread: string): CeremonyState | undefined {
    const req = this.reqs.get(thread) ?? this.bySession.get(thread);
    if (req === undefined) return undefined;
    if (this.h.mutated("ceremonyEarlyCompletion") && req.requestId !== undefined) return "completed";
    if (req.role === "applicant") {
      if (req.refused.has("card")) return "refused";
      if (req.statement !== undefined && this.h.holdsCredential(req.statement)) return "completed";
      if (req.declined) return "declined";
      return req.sessions.length > 0 ? "held" : "open";
    }
    if (req.attested && req.refused.has("attest")) return "refused";
    if (req.attested) return "completed";
    if (req.declined) return "declined";
    return req.sessions.some((s) => s.cardOk) ? "held" : "open";
  }
}
