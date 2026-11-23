// SPDX-License-Identifier: Apache-2.0
// Reference adapter: the community-member-onboarding party (group FC-ONB, docs/25 section 6.5), after ceremonies/vtc/member-onboarding/0.1 in the Trust Tasks repository.
// One party plays any of the three roles. As the COMMUNITY it keeps a request record (a minted `requestId`, state pending, approved or rejected) opened by `submit`,
// pushes the `submit-receipt` and the `request-vmc` on its own, answers `status`, takes `decide` and `solicit-vmc` from the administrator it was told of and stores a
// reciprocal `vmc` only for an approved request. As the APPLICANT it discovers, applies with a presentation it holds, polls (at most three rounds), answers a
// request for the reciprocal credential and delivers it. As the ADMINISTRATOR it decides and solicits.
// It models only what a scenario observes and never VTC governance: no role is named and the administrator is whoever the community was TOLD (`trigger policy
// {administrator}`), there is no join policy (a presentation that verifies, is held by the submitter and is bound to the request is taken), no community credential
// is issued (the `vmc` of a decision and `credentialsDelivered` are not produced) and `deferred` is not modelled (the registry has no task to leave it).
import { digestMultibase } from "../../crypto/digest.ts";
import { ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import { signDocument, verifyDocumentProof } from "../../crypto/proof.ts";
import type { CeremonyState, InitiateParams, InitiateResult } from "../../adapter/contract.ts";
import { threadOf } from "../../adapter/pushed.ts";
import { errorOf, isDoc } from "./flow-part.ts";
import type { Doc, FlowHost, FlowPart, FlowSchema } from "./flow-part.ts";

const VTC = "https://trusttasks.org/spec/vtc";
export const ONB_MANIFEST = `${VTC}/join-requests/manifest/0.1`;
export const ONB_SUBMIT = `${VTC}/join-requests/submit/0.1`;
export const ONB_RECEIPT = `${VTC}/join-requests/submit-receipt/0.1`;
export const ONB_STATUS = `${VTC}/join-requests/status/0.1`;
export const ONB_DECIDE = `${VTC}/join-requests/decide/0.1`;
export const ONB_SOLICIT = `${VTC}/members/solicit-vmc/0.1`;
export const ONB_REQUEST_VMC = `${VTC}/members/request-vmc/0.1`;
export const ONB_VMC = `${VTC}/members/vmc/0.1`;
export const ONB_KINDS = ["onb-discover", "onb-apply", "onb-status", "onb-decide", "onb-solicit", "onb-vmc"];
export const ONB_ROLES = [{ ceremony: "FC-ONB", roles: ["applicant", "community", "administrator"] }];
const MAX_ROUNDS = 3;
const REJECTED_CODE = "rejectedByAdministrator";
const DID = "^did:";
const ALL = [ONB_MANIFEST, ONB_SUBMIT, ONB_RECEIPT, ONB_STATUS, ONB_DECIDE, ONB_SOLICIT, ONB_REQUEST_VMC, ONB_VMC];

type State = "pending" | "approved" | "rejected";
/** What a party keeps about a document it sent: errors that answer it are read from here. */
interface Sent { refused: Set<string>; kind: string }
/** The applicant's record of its application. */
interface App { peer: string; thread: string; requestId?: string; state: State; rounds: number; asked: boolean; delivered: boolean; refused: Set<string> }
/** The community's record of a join request. */
interface Req { applicant: string; thread: string; requestId: string; status: State; reason?: string; decidedAt?: string; vmc?: string; asked: boolean; refused: Set<string> }
/** The administrator's record of what it decided. */
interface Dec { peer: string; thread: string; answered?: State; solicited: boolean; refused: Set<string> }

const obj = { type: "object" as const };
const str = { type: "string" as const };

export class OnboardingParty implements FlowPart {
  readonly kinds = ONB_KINDS;
  readonly roles = ONB_ROLES;
  private readonly h: FlowHost;
  private readonly apps = new Map<string, App>();
  private readonly reqs = new Map<string, Req>();
  private readonly byId = new Map<string, Req>();
  private readonly decs = new Map<string, Dec>();
  private readonly discovered = new Map<string, string>();
  private readonly refusedSubmits = new Set<string>();
  private readonly vmcs = new Set<string>();
  private readonly sent = new Map<string, Sent>();
  /** The administrator this community was told of (`trigger policy {administrator}`): the only party whose decision and solicitation it takes. */
  private admin: string | undefined;
  constructor(host: FlowHost) {
    this.h = host;
  }

  reset(): void {
    this.apps.clear();
    this.reqs.clear();
    this.byId.clear();
    this.decs.clear();
    this.discovered.clear();
    this.refusedSubmits.clear();
    this.vmcs.clear();
    this.sent.clear();
    this.admin = undefined;
  }
  types(): string[] {
    return [...ALL];
  }
  schema(type: string): FlowSchema | undefined {
    const ext = { ext: obj };
    if (type === ONB_MANIFEST) return { required: [], properties: { ...ext } };
    if (type === ONB_SUBMIT) return { required: ["vp"], properties: { vp: obj, registryConsent: { type: "boolean" }, extensions: obj, ...ext } };
    if (type === ONB_RECEIPT) return { required: ["requestId", "status"], properties: { requestId: str, status: str, ...ext } };
    if (type === ONB_STATUS) return { required: [], properties: { requestId: str, resendCredentials: { type: "boolean" }, ...ext } };
    if (type === ONB_DECIDE) return { required: ["id", "decision"], properties: { id: str, decision: { type: "string", pattern: "^(approved|rejected)$" }, reason: str, ...ext } };
    if (type === ONB_SOLICIT) return { required: ["memberDid"], properties: { memberDid: str, reason: str, ...ext } };
    if (type === ONB_REQUEST_VMC) return { required: ["communityDid"], properties: { communityDid: str, reason: str, ...ext } };
    if (type === ONB_VMC) return { required: ["vc"], properties: { vc: obj, requestId: str, ...ext } };
    return undefined;
  }
  /** `trigger policy {administrator}`: the community is told which party administers it. */
  policy(args: Record<string, unknown>): boolean {
    if (typeof args.administrator !== "string") return false;
    this.admin = args.administrator;
    return true;
  }
  stored(kind: string): number | undefined {
    return kind === "vmc" ? this.vmcs.size : undefined;
  }

  private sign(doc: Doc): Doc {
    return signDocument(doc, this.h.signer, { created: this.h.now() });
  }
  private doc(type: string, to: string, thread: string | undefined, payload: Doc, id = this.h.newId()): Doc {
    return this.sign({ id, ...(thread === undefined ? {} : { threadId: thread }), type, issuer: this.h.did, recipient: to, issuedAt: this.h.stamp(), payload });
  }
  private note(doc: Doc, refused: Set<string>, kind: string): void {
    this.sent.set(String(doc.id), { refused, kind });
  }
  private appOf(thread: string | undefined, what: string): App {
    const a = thread === undefined ? undefined : this.apps.get(thread);
    if (a === undefined) throw new Error(`initiate ${what}: no application of this applicant on that thread`);
    return a;
  }

  // ---------------------------------------------------------------- the documents this party starts
  initiate(p: InitiateParams): InitiateResult {
    if (!this.h.isConnected(p.to)) throw new Error(`initiate: not connected to ${p.to} (call connect first)`);
    if (p.kind === "onb-discover") return this.discover(p);
    if (p.kind === "onb-apply") return this.apply(p);
    if (p.kind === "onb-status") return this.status(p);
    if (p.kind === "onb-decide") return this.decide(p);
    if (p.kind === "onb-solicit") return this.solicit(p);
    return this.vmc(p);
  }
  private out(doc: Doc, thread = String(doc.id)): InitiateResult {
    return { threadId: thread, documents: [JSON.stringify(doc)], sent: false };
  }

  /** `discover`: the applicant asks the community for its join criteria (a request with no members). */
  private discover(p: InitiateParams): InitiateResult {
    const doc = this.doc(ONB_MANIFEST, p.to, undefined, {});
    this.discovered.set(String(doc.id), p.to);
    this.note(doc, new Set(), "discover");
    return this.out(doc);
  }

  /** `apply`: the applicant's request to join, with a presentation bound to the request (its challenge is the request's id) and to the community (its domain). `args.holder: "other"` presents one held by another party. */
  private apply(p: InitiateParams): InitiateResult {
    const id = this.h.newId();
    const holder = p.args?.holder === "other" ? ed25519Signer(seedOf(0x45)) : this.h.signer;
    const vp = signDocument({ "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiablePresentation"], holder: holder.did, verifiableCredential: [] }, holder,
      { created: this.h.now(), purpose: "authentication", controllerMember: "holder", challenge: id, domain: p.to });
    const doc = this.doc(ONB_SUBMIT, p.to, undefined, { vp }, id);
    const app: App = { peer: p.to, thread: id, state: "pending", rounds: 0, asked: false, delivered: false, refused: new Set() };
    this.apps.set(id, app);
    this.note(doc, app.refused, "submit");
    return this.out(doc, id);
  }

  /** `supplement`: one poll of the request on its thread, at most three rounds (the definition's `maxRounds`). */
  private status(p: InitiateParams): InitiateResult {
    const app = this.appOf(p.thread, "onb-status");
    if (app.peer !== p.to) throw new Error("initiate onb-status: the peer is not the community applied to");
    if (app.rounds >= MAX_ROUNDS) throw new Error(`initiate onb-status: at most ${MAX_ROUNDS} rounds`);
    app.rounds++;
    const doc = this.doc(ONB_STATUS, p.to, app.thread, app.requestId === undefined ? {} : { requestId: app.requestId });
    this.note(doc, app.refused, "status");
    return this.out(doc, app.thread);
  }

  /** `decide` on the request's thread. `args`: `requestId` (the id the community minted), `decision` (approved or rejected), `reason`. */
  private decide(p: InitiateParams): InitiateResult {
    const requestId = p.args?.requestId, decision = p.args?.decision;
    if (typeof requestId !== "string" || (decision !== "approved" && decision !== "rejected")) throw new Error("initiate onb-decide: args {requestId, decision: approved|rejected}");
    if (p.thread === undefined) throw new Error("initiate onb-decide: a decision is on the request's thread");
    const dec = this.dec(p.thread, p.to);
    const doc = this.doc(ONB_DECIDE, p.to, p.thread, { id: requestId, decision, ...(typeof p.args?.reason === "string" ? { reason: p.args.reason } : {}) });
    this.note(doc, dec.refused, "decide");
    return this.out(doc, p.thread);
  }

  /** `solicit`: ask the community to request a reciprocal credential from `args.memberDid`, on the request's thread. */
  private solicit(p: InitiateParams): InitiateResult {
    if (typeof p.args?.memberDid !== "string" || p.thread === undefined) throw new Error("initiate onb-solicit: args {memberDid} on the request's thread");
    const dec = this.dec(p.thread, p.to);
    const doc = this.doc(ONB_SOLICIT, p.to, p.thread, { memberDid: p.args.memberDid, reason: "reciprocal membership credential" });
    this.note(doc, new Set(), "solicit");
    dec.solicited = true;
    return this.out(doc, p.thread);
  }
  private dec(thread: string, peer: string): Dec {
    let d = this.decs.get(thread);
    if (d === undefined) { d = { peer, thread, solicited: false, refused: new Set() }; this.decs.set(thread, d); }
    return d;
  }

  /** `reciprocate`: the member delivers a Membership Credential naming the community as subject, with the request id it closes. Only after the community asked (`args.unsolicited` sends without). */
  private vmc(p: InitiateParams): InitiateResult {
    const app = this.appOf(p.thread, "onb-vmc");
    if (app.peer !== p.to) throw new Error("initiate onb-vmc: the peer is not the community applied to");
    if (!app.asked && p.args?.unsolicited !== true) throw new Error("initiate onb-vmc: the community has not asked for a reciprocal credential");
    const vc = signDocument({ "@context": ["https://www.w3.org/ns/credentials/v2"], id: this.h.newId(), type: ["VerifiableCredential", "MembershipCredential"], issuer: this.h.did, validFrom: this.h.stamp(),
      credentialSubject: { id: app.peer } }, this.h.signer, { created: this.h.now(), purpose: "assertionMethod" });
    const doc = this.doc(ONB_VMC, p.to, app.thread, { vc, ...(app.requestId === undefined ? {} : { requestId: app.requestId }) });
    this.note(doc, app.refused, "vmc");
    return this.out(doc, app.thread);
  }

  // ---------------------------------------------------------------- the documents this party receives
  handle(doc: Doc): Doc | undefined {
    const t = doc.type;
    if (t === ONB_MANIFEST) return this.onManifest(doc);
    if (t === ONB_SUBMIT) return this.onSubmit(doc);
    if (t === ONB_RECEIPT) return this.onReceipt(doc);
    if (t === ONB_STATUS) return this.onStatus(doc);
    if (t === ONB_DECIDE) return this.onDecide(doc);
    if (t === ONB_SOLICIT) return this.onSolicit(doc);
    if (t === ONB_REQUEST_VMC) return this.onRequestVmc(doc);
    return this.onVmc(doc);
  }
  private reply(type: string, request: Doc, payload: Doc): Doc {
    return { id: this.h.newId(), threadId: threadOf(request), type: `${type}#response`, recipient: request.issuer, payload };
  }
  private pl(doc: Doc): Doc {
    return isDoc(doc.payload) ? doc.payload : {};
  }

  private onManifest(doc: Doc): Doc {
    return this.reply(ONB_MANIFEST, doc, { communityDid: this.h.did, criteria: [{ id: "join-policy", description: "A presentation held by the applicant (the reference has no join policy)", presentationDefinition: { id: "reference-join", input_descriptors: [] } }] });
  }

  /** `apply`: the presentation must verify, be held by the submitter and be bound to this request and this community; then the request is recorded, answered and acknowledged by a receipt of its own. */
  private onSubmit(doc: Doc): Doc {
    const thread = threadOf(doc);
    const known = this.reqs.get(thread);
    if (known !== undefined) return known.applicant === doc.issuer ? this.reply(ONB_SUBMIT, doc, { requestId: known.requestId, status: "pending" }) : this.h.refuse(doc, "permissionDenied", "not permitted");
    const vp = this.pl(doc).vp;
    const verdict = verifyDocumentProof(vp, { nowMs: this.h.now(), controllerMember: "holder" });
    const proof = isDoc(vp) && isDoc(vp.proof) ? vp.proof : {};
    const bad = (m: string): Doc => { this.refusedSubmits.add(thread); return this.h.refuse(doc, "vtc/join-requests/submit:presentationInvalid", m); };
    if (!verdict.valid) return bad("the presentation does not verify");
    if (!this.h.mutated("onbAcceptsForeignHolder") && (vp as Doc).holder !== doc.issuer) return bad("the presentation's holder is not the document's signer");
    if (proof.challenge !== thread || proof.domain !== this.h.did) return bad("the presentation is not bound to this request and this community");
    const req: Req = { applicant: String(doc.issuer), thread, requestId: this.h.newId(), status: "pending", asked: false, refused: new Set() };
    this.reqs.set(thread, req);
    this.byId.set(req.requestId, req);
    const id = this.h.newId();
    this.sent.set(id, { refused: req.refused, kind: "receipt" });
    this.h.pushDoc({ id, threadId: thread, type: ONB_RECEIPT, issuer: this.h.did, recipient: doc.issuer, payload: { requestId: req.requestId, status: "pending" } });
    return this.reply(ONB_SUBMIT, doc, { requestId: req.requestId, status: "pending" });
  }

  /** `acknowledge`, at the applicant: only from the community it applied to, on its own application. */
  private onReceipt(doc: Doc): Doc {
    const app = this.apps.get(threadOf(doc));
    const rid = this.pl(doc).requestId;
    if (app === undefined || app.peer !== doc.issuer || typeof rid !== "string" || (app.requestId !== undefined && app.requestId !== rid)) return this.h.refuse(doc, "vtc/join-requests/submit-receipt:unknownRequest", "no application of this applicant matches the receipt");
    app.requestId = rid;
    return this.reply(ONB_RECEIPT, doc, { acknowledged: true });
  }

  /** `supplement`, at the community: the request of the proof signer only (an unknown request and another applicant's are the same `notFound`). */
  private onStatus(doc: Doc): Doc {
    const rid = this.pl(doc).requestId;
    const req = typeof rid === "string" ? this.byId.get(rid) : [...this.reqs.values()].find((r) => r.applicant === doc.issuer);
    if (req === undefined || req.applicant !== doc.issuer) return this.h.refuse(doc, "vtc/join-requests/status:notFound", "no join request of the signer with that id");
    const rejected = req.status === "rejected";
    return this.reply(ONB_STATUS, doc, { requestId: req.requestId, status: req.status, ...(rejected ? { code: REJECTED_CODE, reason: req.reason ?? null, decidedAt: req.decidedAt } : {}) });
  }

  /** `decide`: from the declared administrator only, for a request that exists and is pending. */
  private onDecide(doc: Doc): Doc {
    if (!this.h.mutated("onbDecideByAnyone") && (this.admin === undefined || doc.issuer !== this.admin)) return this.h.refuse(doc, "permissionDenied", "the signer is not an administrator of this community");
    const p = this.pl(doc) as { id: string; decision: "approved" | "rejected"; reason?: string };
    const req = this.byId.get(p.id);
    if (req === undefined) {
      if (this.h.mutated("onbDecideUnknownAccepted")) return this.reply(ONB_DECIDE, doc, { requestId: p.id, status: p.decision });
      return this.h.refuse(doc, "vtc/join-requests/decide:notFound", "no join request with that id");
    }
    if (req.status !== "pending") return this.h.refuse(doc, "vtc/join-requests/decide:notPending", "the request is not pending");
    req.status = p.decision === "rejected" && !this.h.mutated("onbRejectAdmits") ? "rejected" : "approved";
    req.decidedAt = this.h.stamp();
    if (p.reason !== undefined) req.reason = p.reason;
    return this.reply(ONB_DECIDE, doc, { requestId: req.requestId, status: p.decision });
  }

  /** `solicit`: from the declared administrator, for an active member (an approved request): the community then asks the member itself (`ask`, pushed). */
  private onSolicit(doc: Doc): Doc {
    if (this.admin === undefined || doc.issuer !== this.admin) return this.h.refuse(doc, "permissionDenied", "the signer is not an administrator of this community");
    const member = this.pl(doc).memberDid;
    const req = [...this.reqs.values()].find((r) => r.applicant === member && r.status === "approved");
    if (req === undefined) return this.h.refuse(doc, "vtc/members/solicit-vmc:notFound", "no active member with that DID");
    req.asked = true;
    const id = this.h.newId();
    this.sent.set(id, { refused: req.refused, kind: "ask" });
    this.h.pushDoc({ id, threadId: req.thread, type: ONB_REQUEST_VMC, issuer: this.h.did, recipient: req.applicant, payload: { communityDid: this.h.did, reason: "reciprocal membership credential" } });
    return this.reply(ONB_SOLICIT, doc, { memberDid: req.applicant, requested: true, threadId: req.thread });
  }

  /** `ask`, at the member: only from the community it applied to, and only a party that knows it was approved considers itself a member. */
  private onRequestVmc(doc: Doc): Doc {
    const app = this.apps.get(threadOf(doc));
    if (app === undefined || app.peer !== doc.issuer || app.state !== "approved" || this.pl(doc).communityDid !== app.peer) return this.h.refuse(doc, "vtc/members/request-vmc:notAMember", "the recipient is not a member of the requesting community");
    app.asked = true;
    return this.reply(ONB_REQUEST_VMC, doc, { acknowledged: true });
  }

  /**
   * `reciprocate`, at the community. With a `requestId` the request is resolved first (not found, not the sender's, not approved: the closing rules of vtc/members/vmc);
   * without one the sender must be an active member. The credential must verify, be issued by the sender, be a MembershipCredential and name this community.
   */
  private onVmc(doc: Doc): Doc {
    const p = this.pl(doc) as { vc?: unknown; requestId?: string };
    const sender = String(doc.issuer);
    let req: Req | undefined;
    if (p.requestId !== undefined) {
      req = this.byId.get(p.requestId);
      if (req === undefined) return this.h.refuse(doc, "vtc/members/vmc:requestNotFound", "no join request with that id");
      if (req.applicant !== sender) return this.h.refuse(doc, "vtc/members/vmc:requestApplicantMismatch", "the request's applicant is not the sender");
      if (req.status !== "approved" && !this.h.mutated("onbVmcBeforeApproval")) return this.h.refuse(doc, "vtc/members/vmc:requestNotApproved", "the request is not approved: there is no membership to reciprocate");
    } else if (![...this.reqs.values()].some((r) => r.applicant === sender && r.status === "approved")) return this.h.refuse(doc, "vtc/members/vmc:notAMember", "the sender is not an active member");
    const vc = p.vc;
    if (!isDoc(vc) || !verifyDocumentProof(vc, { nowMs: this.h.now() }).valid || vc.issuer !== sender || !Array.isArray(vc.type) || !vc.type.includes("MembershipCredential")) return this.h.refuse(doc, "vtc/members/vmc:invalidCredential", "the credential does not verify, is not the sender's, or is not a MembershipCredential");
    const subject = isDoc(vc.credentialSubject) ? vc.credentialSubject : {};
    if (subject.id !== this.h.did) return this.h.refuse(doc, "vtc/members/vmc:subjectMismatch", "the credential's subject is not this community");
    const vmcId = digestMultibase(vc);
    if (!this.h.mutated("onbVmcNeverStored")) this.vmcs.add(vmcId);
    if (req !== undefined) req.vmc = vmcId;
    return this.reply(ONB_VMC, doc, { memberDid: sender, vmcId, status: "stored", ...(req === undefined ? {} : { requestId: req.requestId }) });
  }

  // ---------------------------------------------------------------- answers to what this party started
  owns(doc: Doc): boolean {
    const type = String(doc.type ?? "");
    if (errorOf(doc)) return this.sent.has(String(((doc.payload ?? {}) as { inResponseTo?: { id?: string } }).inResponseTo?.id));
    if (!type.endsWith("#response") || !ALL.includes(type.slice(0, -9))) return false;
    const th = threadOf(doc);
    return [this.apps.get(th)?.peer, this.reqs.get(th)?.applicant, this.decs.get(th)?.peer, this.discovered.get(th)].includes(String(doc.issuer));
  }

  receive(doc: Doc): Doc[] | undefined {
    const pl = this.pl(doc);
    if (errorOf(doc)) {
      const hit = this.sent.get(String((pl.inResponseTo as { id?: string } | undefined)?.id));
      if (hit !== undefined) hit.refused.add(hit.kind);
      return undefined;
    }
    const base = String(doc.type).slice(0, -9);
    const th = threadOf(doc);
    const app = this.apps.get(th), dec = this.decs.get(th);
    if (app !== undefined && typeof pl.requestId === "string" && (base === ONB_SUBMIT || base === ONB_STATUS)) app.requestId = pl.requestId;
    if (app !== undefined && base === ONB_STATUS && (pl.status === "pending" || pl.status === "approved" || pl.status === "rejected")) app.state = pl.status;
    if (app !== undefined && base === ONB_VMC) app.delivered = pl.status === "stored";
    if (dec !== undefined && base === ONB_DECIDE && (pl.status === "approved" || pl.status === "rejected")) dec.answered = pl.status;
    return undefined;
  }

  /** The party's own reading of the request thread. The applicant reads from `status` only (the definition's evidence recorders are the community and the administrator). */
  reading(thread: string): CeremonyState | undefined {
    const a = this.apps.get(thread), r = this.reqs.get(thread), d = this.decs.get(thread);
    if (a !== undefined) {
      if (this.h.mutated("ceremonyEarlyCompletion") && a.requestId !== undefined) return "completed";
      if (a.refused.size > 0 || (d?.refused.size ?? 0) > 0) return "refused";
      if (a.state === "rejected") return "declined";
      if (a.state === "approved") return a.asked && !a.delivered ? "held" : "completed";
      return "open";
    }
    if (r !== undefined) {
      if (this.h.mutated("ceremonyEarlyCompletion")) return "completed";
      if (r.status === "rejected") return "declined";
      if (r.status === "approved") return r.asked && r.vmc === undefined ? "held" : "completed";
      return "open";
    }
    if (d !== undefined) {
      if (d.refused.size > 0) return "refused";
      return d.answered === "approved" ? "completed" : d.answered === "rejected" ? "declined" : "open";
    }
    return this.refusedSubmits.has(thread) ? "refused" : undefined;
  }
}
