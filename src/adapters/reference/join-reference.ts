// SPDX-License-Identifier: Apache-2.0
// Reference oracle for the onboarding and vetting-directory ceremonies (docs/30): a community that serves the join family and the vetting directory, and a member who joins and
// publishes a vetter profile, each written from the Trust Tasks specification text (the community serves manifest 0.4 and submit 0.3 as the task force and the platforms now do; the
// retired submit 0.1 is not served). They exist to validate the scenarios (the oracle pair completes; each deliberate mutant of the community ends the scenario that watches for it
// `failed`) and to separate a platform's difference from the specification from a scenario that over-reads it. They model only what a scenario observes: no policy engine, no
// credential issue (an admission records that the membership credential was handed to delivery, nothing more) and no governance.
import { randomUUID } from "node:crypto";
import type { Adapter, Capabilities, InitiateParams, InitiateResult, ObserveQuery, ObserveResult, ProofVerifyResult, ProvisionedRole, SendParams, SendResult } from "../../adapter/contract.ts";
import { digestMultibase } from "../../crypto/digest.ts";
import { ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import { signDocument, verifyDocumentProof } from "../../crypto/proof.ts";
import { isObject } from "../../util/json.ts";

type Doc = Record<string, unknown>;
const S = "https://trusttasks.org/spec/";
const J = "vtc/join-requests/";
const V = "vtc/vetting/";
const COMMUNITY_SEED = 0xb3, JOINER_SEED = 0x4c, ADMIN_SEED = 0x1c;
/** The criterion the reference publishes: a review by an administrator (the digest is the reference's own). */
export const REVIEW_DIGEST = "zQmReferenceReviewCriterionDigest000000000000000000";
export const COMMUNITY_MUTANTS = ["joinAdmitsOnSubmit", "joinDecidesUnknown", "joinDecideByAnyone", "joinNoProofCheck", "joinWithdrawKeepsPending", "joinSecondOpen", "joinDecideTwice", "vetProfileWithoutGrant", "vetUnlistedStillListed", "vetShowAlwaysLive", "vetRevokeNotIdempotent", "joinWrongRecipientAccepted", "joinSupplementPending", "joinVmcBeforeApproval", "joinVmcNeverStored"] as const;
export type CommunityMutant = (typeof COMMUNITY_MUTANTS)[number];
export const JOINER_KINDS = ["join-manifest", "join-apply", "join-apply-foreign", "join-status", "join-withdraw", "join-supplement", "vetter-profile", "vetters-list", "vetters-show", "vetting-revoke-statement", "vetting-request", "join-vmc"];
const GROUPS = ["FC-MBR", "FC-IDV", "FC-ONB"];

const stamp = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
const dig = (d: Doc): string => digestMultibase(d as never);
const pl = (d: Doc): Doc => (isObject(d.payload) ? (d.payload as Doc) : {});

interface Req { id: string; applicant: string; status: "pending" | "approved" | "rejected" | "withdrawn"; reason?: string; decidedAt?: string; at: number }
interface Profile { listed: boolean }

/** The community: the join family and the vetting directory. */
export class JoinCommunity implements Adapter {
  readonly signer = ed25519Signer(seedOf(COMMUNITY_SEED));
  private readonly mutants: ReadonlySet<string>;
  private reqs: Req[] = [];
  private members = new Set<string>();
  private vetters = new Set<string>();
  private profiles = new Map<string, Profile>();
  private revoked = new Map<string, string>();
  private pushes: string[] = [];
  private vmcs = new Set<string>();
  private adminLog: string[] = [];
  private seen = new Map<string, { digest: string; reply: string }>();
  constructor(o: { mutants?: string[] } = {}) { this.mutants = new Set(o.mutants ?? []); }
  private m(id: CommunityMutant): boolean { return this.mutants.has(id); }

  async capabilities(): Promise<Capabilities> {
    const types = ["vtc/members/solicit-vmc/0.1", "vtc/members/vmc/0.1", `${J}manifest/0.4`, `${J}submit/0.3`, `${J}status/0.1`, `${J}withdraw/0.1`, `${J}supplement/0.1`, `${J}decide/0.1`, `${V}vetters/list/0.1`, `${V}vetters/profile/0.1`, `${V}vetters/show/0.1`, `${V}vetters/grant/0.1`, `${V}revoke-statement/0.1`].map((t) => `${S}${t}`);
    return { name: this.mutants.size === 0 ? "reference-community" : `reference-community+${[...this.mutants].join("+")}`, implementation: "reference-community", version: "suite reference, community (join family, vetting directory)", tierMax: 1, bindings: ["in-process"],
      supportedTypes: types, carriers: [], cryptosuites: ["eddsa-jcs-2022"], optional: ["clockFree"], ceremonyRoles: GROUPS.map((ceremony) => ({ ceremony, roles: ["community"] })), pins: { framework: "0.6.0", error: "0.6", binding: "none" } };
  }
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> { return Object.fromEntries(roles.map((r) => [r, { vid: this.signer.did, didDocument: { id: this.signer.did }, transportAddress: "in-process", keyCustody: "iut" as const }])); }
  async trust(): Promise<void> { /* did:key */ }
  async setClock(): Promise<void> { throw new Error("not supported"); }
  async advance(): Promise<void> { throw new Error("not supported"); }
  async restart(): Promise<void> { /* in memory */ }
  async snapshot(): Promise<string> { return `${this.reqs.length}:${this.members.size}`; }
  async diff(id: string): Promise<{ changed: boolean }> { return { changed: id !== (await this.snapshot()) }; }
  async verifyProof(p: { bytes: string }): Promise<ProofVerifyResult> { try { return { valid: verifyDocumentProof(JSON.parse(p.bytes) as Doc, { nowMs: Date.now() }).valid }; } catch { return { valid: false }; } }
  async reset(): Promise<void> { this.reqs = []; this.members.clear(); this.vetters.clear(); this.profiles.clear(); this.revoked.clear(); this.pushes = []; this.vmcs.clear(); this.adminLog = []; this.seen.clear(); }

  /** The harness' stand-ins for what a deployment does out of band: the administrator's decision, a member who already joined, a vetter grant. */
  async trigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }> {
    if (action === "knowApplicant") return { documents: [] };
    if (action === "seedMember") { this.members.add(String(args.vid)); return { documents: [] }; }
    if (action === "decide") {
      const code = this.decide(String(args.decision), args.request === "unknown" ? undefined : this.reqs.at(-1)?.id, args.as === "member", args.reason === undefined ? undefined : String(args.reason));
      this.adminLog.push(`decide:${code}`);
    } else if (action === "solicit") {
      // the administrator asks the community to request a reciprocal credential from an active member (vtc/members/solicit-vmc): the community then asks the member (request-vmc, pushed)
      if (this.members.has(String(args.member))) { this.pushes.push(`${S}vtc/members/request-vmc/0.1`); this.adminLog.push("solicit:ok"); } else this.adminLog.push("solicit:vtc/members/solicit-vmc:notFound");
    } else if (action === "grantVetter") {
      this.vetters.add(String(args.vid));
      this.members.add(String(args.vid));
      this.adminLog.push("grantVetter:ok");
    } else throw new Error(`the community has no trigger ${action}`);
    return { documents: [] };
  }
  private decide(decision: string, id: string | undefined, asMember: boolean, reason?: string): string {
    if (asMember && !this.m("joinDecideByAnyone")) return "permissionDenied";
    const req = this.reqs.find((r) => r.id === id);
    if (req === undefined) return this.m("joinDecidesUnknown") ? "ok" : `${J}decide:notFound`;
    if (req.status !== "pending" && !this.m("joinDecideTwice")) return `${J}decide:notPending`;
    req.status = decision === "approved" ? "approved" : "rejected";
    req.decidedAt = stamp(Date.now());
    if (reason !== undefined) req.reason = reason;
    if (req.status === "approved") { this.members.add(req.applicant); this.pushes.push(`${S}credential-exchange/issue/0.1`, `${S}credential-exchange/issue/0.1`); }
    return "ok";
  }

  private reply(req: Doc, type: string, payload: Doc): Doc {
    const now = Date.now();
    return signDocument({ id: `urn:uuid:${randomUUID()}`, type, threadId: String(req.threadId ?? req.id), issuer: this.signer.did, recipient: String(req.issuer), issuedAt: stamp(now), payload }, this.signer, { created: now, purpose: "assertionMethod" }) as unknown as Doc;
  }
  private refuse(req: Doc, code: string, message: string, details?: Doc): Doc {
    return this.reply(req, `${S}trust-task-error/0.6`, { code, message, retryable: false, ...(details === undefined ? {} : { details }), inResponseTo: { id: req.id, typeUri: req.type } });
  }
  private out(d: Doc): SendResult { const t = String(d.type); return { replies: [JSON.stringify(d)], transport: { status: t.includes("/trust-task-error/") ? 422 : 200, kind: "document" }, quiescentAfterMs: 0 }; }

  async send(p: SendParams): Promise<SendResult> {
    let doc: Doc;
    try { doc = JSON.parse(p.bytes) as Doc; } catch { return { replies: [], transport: { status: 400, kind: "refused" }, quiescentAfterMs: 0 }; }
    const now = Date.now();
    const type = String(doc.type);
    const key = String(doc.id);
    const digest = dig(doc);
    const prior = this.seen.get(key);
    if (prior !== undefined) return prior.digest !== digest ? this.out(this.refuse(doc, "idConflict", "the id was used by a different document")) : { replies: [prior.reply], transport: { status: 200, kind: "document" }, quiescentAfterMs: 0 };
    if (doc.recipient !== this.signer.did && !this.m("joinWrongRecipientAccepted")) return this.out(this.refuse(doc, "wrongRecipient", "the recipient is another party"));
    if (doc.proof === undefined && !this.m("joinNoProofCheck")) return this.out(this.refuse(doc, "proofRequired", "a proof is required"));
    if (!this.m("joinNoProofCheck") && !verifyDocumentProof(doc, { nowMs: now }).valid) return this.out(this.refuse(doc, "proofInvalid", "the proof did not verify"));
    if (!(Math.abs(now - Date.parse(String(doc.issuedAt))) <= 300_000)) return this.out(this.refuse(doc, "expired", "issuedAt is outside the acceptance window"));
    const result = this.dispatch(doc, type, now);
    this.seen.set(key, { digest, reply: JSON.stringify(result) });
    return this.out(result);
  }

  private open(who: string): Req | undefined { return this.reqs.find((r) => r.applicant === who && r.status === "pending"); }
  private dispatch(doc: Doc, type: string, now: number): Doc {
    const who = String(doc.issuer), p = pl(doc);
    const t = type.replace(S, "");
    const served: Record<string, string> = { "vtc/members/vmc": "0.1", [`${J}manifest`]: "0.4", [`${J}submit`]: "0.3", [`${J}status`]: "0.1", [`${J}withdraw`]: "0.1", [`${J}supplement`]: "0.1", [`${J}decide`]: "0.1", [`${V}vetters/list`]: "0.1", [`${V}vetters/profile`]: "0.1", [`${V}vetters/show`]: "0.1", [`${V}vetters/grant`]: "0.1", [`${V}revoke-statement`]: "0.1" };
    const slug = t.slice(0, t.lastIndexOf("/")), version = t.slice(t.lastIndexOf("/") + 1);
    if (served[slug] === undefined) return this.refuse(doc, "unsupportedType", `unsupported type: ${type}`);
    if (served[slug] !== version) return this.refuse(doc, "unsupportedVersion", `unsupported version: ${type}`, { requestedType: type, servedVersions: [`${S}${slug}/${served[slug]}`] });
    if (slug === `${J}manifest`) return this.reply(doc, `${type}#response`, { communityDid: this.signer.did, criteria: [{ id: "review", admission: "review", description: "Reviewed by an administrator", requirementsDigest: REVIEW_DIGEST }] });
    if (slug === `${J}submit`) {
      const vp = isObject(p.vp) ? (p.vp as Doc) : undefined;
      if (vp === undefined || vp.holder !== who) return this.refuse(doc, `${J}submit:presentationInvalid`, "a join presentation must be the applicant's own");
      if (this.members.has(who)) return this.refuse(doc, `${J}submit:alreadyMember`, "already a member");
      const open = this.open(who);
      if (open !== undefined && !this.m("joinSecondOpen")) return this.refuse(doc, `${J}submit:requestAlreadyOpen`, "an open join request already exists", { requestId: open.id, status: "pending" });
      const req: Req = { id: randomUUID(), applicant: who, status: this.m("joinAdmitsOnSubmit") ? "approved" : "pending", at: now };
      this.reqs.push(req);
      if (req.status === "approved") this.members.add(who);
      return this.reply(doc, `${type}#response`, { requestId: req.id, verdict: { effect: "refer", with: { queue: "admin-review" } } });
    }
    if (slug === `${J}status` || slug === `${J}withdraw` || slug === `${J}supplement`) {
      const rid = typeof p.requestId === "string" ? p.requestId : undefined;
      const mine = rid === undefined ? this.reqs.filter((r) => r.applicant === who && (r.status !== "withdrawn")).at(-1) : this.reqs.find((r) => r.id === rid && (r.applicant === who));
      const base = slug.slice(J.length);
      if (mine === undefined || (base !== "status" && mine.status !== "pending")) return this.refuse(doc, `${J}${base}:notFound`, "no open join request for the signer");
      if (base === "withdraw") { if (!this.m("joinWithdrawKeepsPending")) mine.status = "withdrawn"; return this.reply(doc, `${type}#response`, { requestId: mine.id, status: "withdrawn" }); }
      if (base === "supplement" && !this.m("joinSupplementPending")) return this.refuse(doc, `${J}supplement:notAwaitingEvidence`, "the request is not awaiting evidence");
      if (base === "supplement") return this.reply(doc, `${type}#response`, { requestId: mine.id, verdict: { effect: "refer", with: { queue: "admin-review" } } });
      return this.reply(doc, `${type}#response`, { requestId: mine.id, status: mine.status, ...(mine.status === "rejected" ? { code: "rejectedByAdministrator", reason: mine.reason ?? null, decidedAt: mine.decidedAt } : {}) });
    }
    if (slug === "vtc/members/vmc") {
      // the member delivers its Membership Credential naming this community; a requestId closes the approved request (vtc/members/vmc 0.1)
      const rid = typeof p.requestId === "string" ? p.requestId : undefined;
      if (rid !== undefined) {
        const req = this.reqs.find((r) => r.id === rid);
        if (req === undefined) return this.refuse(doc, "vtc/members/vmc:requestNotFound", "no join request with that id");
        if (req.applicant !== who) return this.refuse(doc, "vtc/members/vmc:requestApplicantMismatch", "the request's applicant is not the sender");
        if (req.status !== "approved" && !this.m("joinVmcBeforeApproval")) return this.refuse(doc, "vtc/members/vmc:requestNotApproved", "the request is not approved: there is no membership to reciprocate");
      } else if (!this.members.has(who)) return this.refuse(doc, "vtc/members/vmc:notAMember", "the sender is not an active member");
      const vc = isObject(p.vc) ? (p.vc as Doc) : undefined;
      if (vc === undefined || !verifyDocumentProof(vc, { nowMs: now }).valid || vc.issuer !== who || !Array.isArray(vc.type) || !vc.type.includes("MembershipCredential")) return this.refuse(doc, "vtc/members/vmc:invalidCredential", "the credential does not verify, is not the sender's, or is not a MembershipCredential");
      if (!isObject(vc.credentialSubject) || (vc.credentialSubject as Doc).id !== this.signer.did) return this.refuse(doc, "vtc/members/vmc:subjectMismatch", "the credential's subject is not this community");
      const vmcId = dig(vc);
      if (!this.m("joinVmcNeverStored")) this.vmcs.add(vmcId);
      return this.reply(doc, `${type}#response`, { memberDid: who, vmcId, status: "stored", ...(rid === undefined ? {} : { requestId: rid }) });
    }
    if (slug === `${V}vetters/profile`) {
      if (!this.vetters.has(who) && !this.m("vetProfileWithoutGrant")) return this.refuse(doc, `${V}vetters/profile:notAVetter`, "the signer holds no live vetter grant");
      this.profiles.set(who, { listed: p.listed === true });
      return this.reply(doc, `${type}#response`, { listed: p.listed === true });
    }
    if (slug === `${V}vetters/list`) return this.reply(doc, `${type}#response`, { vetters: [...this.profiles].filter(([, pr]) => pr.listed || this.m("vetUnlistedStillListed")).map(([did]) => ({ vetterDid: did })) });
    if (slug === `${V}vetters/show`) {
      const d = String(p.vetterDid);
      return this.reply(doc, `${type}#response`, { vetterDid: d, status: this.m("vetShowAlwaysLive") || this.vetters.has(d) ? "live" : "none" });
    }
    if (slug === `${V}revoke-statement`) {
      const id = String(p.statementId);
      const first = this.revoked.get(id) ?? stamp(now);
      this.revoked.set(id, this.m("vetRevokeNotIdempotent") ? stamp(now + 1000 * (this.revoked.size + this.seen.size)) : first);
      return this.reply(doc, `${type}#response`, { recordedAt: this.revoked.get(id) });
    }
    return this.refuse(doc, "permissionDenied", "not an administrator");
  }

  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "ceremony") return { value: "unknown" };
    if (q.query !== "stored") throw new Error(`the community does not answer observe ${q.query}`);
    const k = q.kind;
    if (k === "join-request") return { value: this.reqs.length };
    if (k.startsWith("join-request:")) return { value: this.reqs.filter((r) => r.status === k.slice(13)).length };
    if (k.startsWith("member:")) return { value: this.members.has(k.slice(7)) ? 1 : 0 };
    if (k.startsWith("admin:")) return { value: this.adminLog.filter((x) => x === k.slice(6)).length };
    if (k.startsWith("pushed:")) return { value: this.pushes.filter((x) => x.includes(k.slice(7))).length };
    if (k === "vmc") return { value: this.vmcs.size };
    if (k.startsWith("vetter:")) { const d = k.slice(7); return { value: this.profiles.get(d)?.listed === true || (this.m("vetUnlistedStillListed") && this.profiles.has(d)) ? 1 : 0 }; }
    throw new Error(`the community does not answer stored ${k}`);
  }
}

/** The member: joins the community and publishes a vetter profile, with the versions the specification names, and reads the answers. */
export class JoinMember implements Adapter {
  readonly signer = ed25519Signer(seedOf(JOINER_SEED));
  private queue: { kind: string; step: number; args: Record<string, unknown>; to: string; thread: string; state: "open" | "completed" | "refused"; received: Doc[]; sent: Doc[]; scratch: Doc }[] = [];
  private lastStatus: Doc = {};
  private lastShow = "";
  private lastRid: string | undefined;
  private idlessNotMisleading = false;
  private lastList = -1;
  private recorded: string[] = [];
  private n = 0;
  async capabilities(): Promise<Capabilities> {
    return { name: "reference-joiner", implementation: "reference-joiner", version: "suite reference, member (join, vetter profile)", tierMax: 1, bindings: ["in-process"], supportedTypes: [], carriers: [], cryptosuites: ["eddsa-jcs-2022"],
      optional: ["clockFree", "initiate", "observe.ceremony", "observe.received", "initiate.vetterDirectory", "initiate.foreignPresentation", "initiate.reciprocate"], initiates: JOINER_KINDS, ceremonyRoles: GROUPS.map((ceremony) => ({ ceremony, roles: ["member-phone"] })), pins: { framework: "0.6.0", error: "0.6", binding: "none" } };
  }
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> { return Object.fromEntries(roles.map((r) => [r, { vid: this.signer.did, didDocument: { id: this.signer.did }, transportAddress: "in-process", keyCustody: "iut" as const }])); }
  async trust(): Promise<void> { /* did:key */ }
  async setClock(): Promise<void> { throw new Error("not supported"); }
  async advance(): Promise<void> { throw new Error("not supported"); }
  async restart(): Promise<void> { /* none */ }
  async snapshot(): Promise<string> { return String(this.queue.length); }
  async diff(id: string): Promise<{ changed: boolean }> { return { changed: id !== String(this.queue.length) }; }
  async verifyProof(p: { bytes: string }): Promise<ProofVerifyResult> { try { return { valid: verifyDocumentProof(JSON.parse(p.bytes) as Doc, { nowMs: Date.now() }).valid }; } catch { return { valid: false }; } }
  async reset(): Promise<void> { this.queue = []; this.lastStatus = {}; this.lastShow = ""; this.lastRid = undefined; this.idlessNotMisleading = false; this.lastList = -1; this.recorded = []; this.clockOffsetMs = 0; }
  private clockOffsetMs = 0;
  async trigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }> {
    if (action !== "clockOffset") throw new Error(`the member has no trigger ${action}`);
    this.clockOffsetMs = Number(args.seconds ?? 0) * 1000;
    return { documents: [] };
  }
  private doc(to: string, type: string, payload: Doc, thread: string): Doc {
    const now = Date.now() + this.clockOffsetMs;
    return signDocument({ id: `urn:uuid:${randomUUID()}`, type: `${S}${type}`, threadId: thread, issuer: this.signer.did, recipient: to, issuedAt: stamp(now), payload }, this.signer, { created: now, purpose: "authentication" }) as unknown as Doc;
  }
  private vp(foreign: boolean): Doc { return { "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiablePresentation"], holder: foreign ? ed25519Signer(seedOf(0x45)).did : this.signer.did, verifiableCredential: [] }; }
  private next(f: PairJoinFlow): Doc | undefined {
    const a = f.args, to = String(a.recipient ?? f.to), last = f.received.at(-1), lp = last === undefined ? {} : pl(last);
    const refused = String(last?.type ?? "").includes("/trust-task-error/");
    const apply = f.kind === "join-apply" || f.kind === "join-apply-foreign";
    switch (f.kind) {
      case "join-manifest": return f.step === 0 ? this.doc(to, `${J}manifest/0.4`, {}, f.thread) : undefined;
      case "join-apply": case "join-apply-foreign": {
        if (f.step === 0) return this.doc(to, `${J}manifest/0.4`, {}, f.thread);
        const wire = String(f.scratch.wire ?? a.wire ?? "0.3");
        // the criterion is read from the manifest the community answered (its own digest), as the wallet does
        const crit = ((pl(f.received[0] ?? {}).criteria as Doc[] | undefined) ?? []).find((c) => c.id === "review");
        const digest = typeof crit?.requirementsDigest === "string" ? crit.requirementsDigest : REVIEW_DIGEST;
        if (f.step === 1 && !refused) return this.doc(to, `${J}submit/${wire}`, { vp: this.vp(f.kind === "join-apply-foreign"), registryConsent: false, ...(wire === "0.3" ? { criterion: digest } : { extensions: { requirementsDigest: digest } }) }, f.thread);
        // the member's own version step: a community that names what it serves is asked in that version, once
        if (apply && f.step === 2 && refused && lp.code === "unsupportedVersion" && f.scratch.wire === undefined && a.wire !== undefined) { f.scratch.wire = "0.3"; return this.doc(to, `${J}submit/0.3`, { vp: this.vp(false), registryConsent: false, criterion: ((pl(f.received[0] ?? {}).criteria as Doc[] | undefined) ?? []).find((c) => c.id === "review")?.requirementsDigest ?? REVIEW_DIGEST }, f.thread); }
        return undefined;
      }
      case "join-status": { const id = a.requestId ?? (a.idless === true ? undefined : this.lastRid); return f.step === 0 ? this.doc(to, `${J}status/0.1`, id === undefined ? {} : { requestId: String(id) }, f.thread) : undefined; }
      case "join-vmc": {
        if (f.step !== 0) return undefined;
        const now = Date.now() + this.clockOffsetMs;
        const vc = signDocument({ "@context": ["https://www.w3.org/ns/credentials/v2"], id: `urn:uuid:${randomUUID()}`, type: ["VerifiableCredential", "MembershipCredential"], issuer: this.signer.did, validFrom: stamp(now), credentialSubject: { id: to } }, this.signer, { created: now, purpose: "assertionMethod" });
        return this.doc(to, "vtc/members/vmc/0.1", { vc, ...(this.lastRid === undefined ? {} : { requestId: this.lastRid }) }, f.thread);
      }
      case "join-withdraw": return f.step === 0 ? this.doc(to, `${J}withdraw/0.1`, {}, f.thread) : undefined;
      case "join-supplement": return f.step === 0 ? this.doc(to, `${J}supplement/0.1`, { vp: this.vp(false) }, f.thread) : undefined;
      case "vetter-profile": return f.step === 0 ? this.doc(to, `${V}vetters/profile/0.1`, { listed: a.listed !== false, languages: ["en"], methods: ["inPerson", "video"], acceptsDocumentation: [], events: [] }, f.thread) : undefined;
      case "vetters-list": return f.step === 0 ? this.doc(to, `${V}vetters/list/0.1`, {}, f.thread) : undefined;
      case "vetters-show": return f.step === 0 ? this.doc(to, `${V}vetters/show/0.1`, { vetterDid: String(a.vetterDid ?? this.signer.did) }, f.thread) : undefined;
      // `vetting/request/0.1` is addressed to a vetter (an applicant to a vetter); here it is addressed to the community, which is not one
      case "vetting-request": return f.step === 0 ? this.doc(to, "vetting/request/0.1", { communityDid: to, requestedMethods: ["inPerson"] }, f.thread) : undefined;
      case "vetting-revoke-statement": return f.step === 0 ? this.doc(to, `${V}revoke-statement/0.1`, { statementId: String(a.statementId ?? "urn:uuid:7e5d3c1b-9f8a-4b6c-a2d1-e0f9a8b7c601"), statementDigestMultibase: "zQmbbYmkMsiznb5v6ZKZyjtmcpxGf6Ka6QhAX9A6hALcoM8", reason: "mistake" }, f.thread) : undefined;
      default: return undefined;
    }
  }
  async initiate(p: InitiateParams): Promise<InitiateResult> {
    const thread = `urn:uuid:${randomUUID()}`;
    const f: PairJoinFlow = { kind: p.kind, step: 0, args: p.args ?? {}, to: p.to, thread, state: "open", received: [], sent: [], scratch: {} };
    this.queue.push(f);
    this.n++;
    const d = this.next(f);
    if (d === undefined) throw new Error(`the member has no kind ${p.kind}`);
    f.sent.push(d);
    return { threadId: thread, documents: [JSON.stringify(d)], sent: false, continues: true };
  }
  async send(p: SendParams): Promise<SendResult> {
    const d = JSON.parse(p.bytes) as Doc;
    const f = this.queue.find((x) => x.thread === d.threadId);
    if (f === undefined) return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 };
    f.received.push(d);
    f.step++;
    const refused = String(d.type).includes("/trust-task-error/");
    const code = refused ? String(pl(d).code ?? "") : "";
    if (!refused && String(d.type).includes("/status/0.1#response")) { this.lastStatus = pl(d); this.idlessNotMisleading = pl(d).status === "rejected"; }
    if (refused && String(d.type).includes("/trust-task-error/") && code.endsWith("status:notFound")) { this.lastStatus = {}; this.idlessNotMisleading = true; }
    if (!refused && String(d.type).includes("/submit/0.3#response") && typeof pl(d).requestId === "string") this.lastRid = String(pl(d).requestId);
    if (!refused && String(d.type).includes("/vetters/list/0.1#response")) this.lastList = Array.isArray(pl(d).vetters) ? (pl(d).vetters as unknown[]).length : -1;
    if (!refused && String(d.type).includes("/vetters/show/0.1#response")) this.lastShow = String(pl(d).status);
    if (!refused && String(d.type).includes("/revoke-statement/0.1#response")) this.recorded.push(String(pl(d).recordedAt));
    const stepping = refused && code === "unsupportedVersion" && f.args.wire !== undefined && f.scratch.wire === undefined;
    const nxt = refused && !stepping ? undefined : this.next(f);
    if (nxt !== undefined) { f.sent.push(nxt); return { replies: [JSON.stringify(nxt)], transport: { status: 200, kind: "document" }, quiescentAfterMs: 0 }; }
    // a status of a request the community does not hold is the member's own reading "no request" (completed), as the wallet reads it
    f.state = refused && !(f.kind === "join-status" && code.endsWith(":notFound")) ? "refused" : "completed";
    return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 };
  }
  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "ceremony") { const f = this.queue.find((x) => x.thread === q.threadId); return { value: f === undefined ? "unknown" : f.state }; }
    if (q.query === "received") {
      const f = this.queue.find((x) => x.thread === q.threadId);
      const docs = (f?.received ?? []).filter((d) => q.type === undefined || d.type === q.type);
      return { value: docs.length, documents: docs.map((d) => JSON.stringify(d)) };
    }
    if (q.query === "stored" && q.kind.startsWith("join-status:")) return { value: this.lastStatus.status === q.kind.slice(12) ? 1 : 0 };
    if (q.query === "stored" && q.kind === "join-status-not-misleading") return { value: this.idlessNotMisleading ? 1 : 0 };
    if (q.query === "stored" && q.kind.startsWith("list-count:")) return { value: this.lastList === Number(q.kind.slice(11)) ? 1 : 0 };
    if (q.query === "stored" && q.kind.startsWith("show-status:")) return { value: this.lastShow === q.kind.slice(12) ? 1 : 0 };
    if (q.query === "stored" && q.kind === "revoke-recorded-twice-same") return { value: this.recorded.length >= 2 && this.recorded.at(-1) === this.recorded.at(-2) ? 1 : 0 };
    if (q.query === "stored" && q.kind.startsWith("join-status-reason:")) return { value: this.lastStatus.reason === q.kind.slice(19) ? 1 : 0 };
    throw new Error(`the member does not answer observe ${q.query}`);
  }
}
interface PairJoinFlow { kind: string; step: number; args: Record<string, unknown>; to: string; thread: string; state: "open" | "completed" | "refused"; received: Doc[]; sent: Doc[]; scratch: Doc }
