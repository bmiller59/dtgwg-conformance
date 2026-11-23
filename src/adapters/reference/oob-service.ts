// SPDX-License-Identifier: Apache-2.0
// Reference sign-in service for the sign-in ceremony (group FC-AUT, docs/26 section 4): the role of the community's service (the VTC's `auth/oob` handlers). It is the suite's oracle for the
// scenarios, written from the specification text (specs/auth/oob/*, CONVENTIONS.md section 4 state machine and section 5 rules), never from VTI's code: it opens a request for a starter key,
// takes the first claim, checks the identify the approver carries (membership before any DID is resolved, the entered number, one try), signs step 1 and step 2 with its assertionMethod key,
// stores the digest of the signed step 2, checks the grant against it, and gives the session to the starter key's holder at redeem. One request, one claim, one proof attempt, one decision,
// one redemption.
//
// Versions served: `current` is request 0.2, claim 0.2, prove 0.3, respond 0.3 (grant 0.3), redeem 0.2, cancel 0.1, the overlap with VTC and the wallet. `legacy` stands for a community at vtc 0.14
// or before: claim 0.1, prove/respond 0.1 and 0.2 (grant 0.1 and 0.2; instants as epoch seconds: `decisionDeadline`, `notAfter`). Either answers a type it does not serve with
// `unsupportedVersion` and `details.servedVersions`, before it touches the request. The starter of this suite opens requests at 0.2 only, so a legacy service answers request 0.2 too (the request
// version ladder is not exercised; named in docs/26).
//
// Class D stand-ins: the community's DID document is a did:key with the two services a wallet reads added (a did:webvh would publish them); the portal origin is https://portal.example; the
// service does not see an HTTP `Origin` header (the runner carries documents, no browser), so T19 (only the portal's own page may open a request) is not modelled; the redeem poll is answered at
// once, not held up to 25 s; the session is the returned description, with no cookie. Windows are read from the wall clock (120 s claim, 120 s decision).
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Adapter, Capabilities, ObserveQuery, ObserveResult, ProofVerifyResult, ProvisionedRole, SendParams, SendResult } from "../../adapter/contract.ts";
import { digestMultibase } from "../../crypto/digest.ts";
import { ed25519FromDidKey, ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import type { Ed25519Signer } from "../../crypto/didkey.ts";
import { signDocument, verifyDocumentProof } from "../../crypto/proof.ts";
import { sameDigest } from "../../crypto/stepdigest.ts";
import { isObject } from "../../util/json.ts";

const S = "https://trusttasks.org/spec/";
const OOB = `${S}auth/oob`;
const ERR = `${S}trust-task-error/0.6`;
export const PORTAL_ORIGIN = "https://portal.example";
export const COMMUNITY_SEED = 0xc7;
export const SERVICE_VERSIONS = {
  current: { request: ["0.2"], claim: ["0.2"], prove: ["0.3"], respond: ["0.3"], redeem: ["0.2"], cancel: ["0.1"] },
  legacy: { request: ["0.2"], claim: ["0.1"], prove: ["0.1", "0.2"], respond: ["0.1", "0.2"], redeem: ["0.2"], cancel: ["0.1"] },
} as const;
/** Deliberate breakages of the service, each aimed at one scenario (docs/26 section 4). */
export const OOB_SERVICE_MUTANTS = ["claimTwice", "noNumberCheck", "nonMemberAccepted", "claimAnswerUnsigned", "claimAnswerWrongOrigin", "cancelIgnored", "redeemAnyKey", "noDigestCheck", "wrongKeyRespond", "sessionBeforeApproval", "identifyNoProofCheck"] as const;
export type OobServiceMutant = (typeof OOB_SERVICE_MUTANTS)[number];
type Doc = Record<string, unknown>;
type State = "pending" | "claimed" | "identified" | "approved" | "consumed" | "declined" | "cancelled" | "expired";
interface Req {
  id: string; starter: string; state: State; claimClosesAt: number; decisionClosesAt?: number; lock?: string; match?: string; identifiedAs?: string; step2Digest?: string; step2Doc?: Doc;
  grant?: Doc; version?: "0.1" | "0.2" | "0.3"; scope?: string[];
}
const iso = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
const epoch = (ms: number): number => Math.floor(ms / 1000);
const b64url = (b: Buffer): string => b.toString("base64url");

export class OobServiceAdapter implements Adapter {
  private readonly signer: Ed25519Signer = ed25519Signer(seedOf(COMMUNITY_SEED));
  private readonly mutants: ReadonlySet<string>;
  private readonly profile: "current" | "legacy";
  private served: (typeof SERVICE_VERSIONS)[keyof typeof SERVICE_VERSIONS];
  private requests = new Map<string, Req>();
  private members = new Set<string>();
  private readonly inbox: Doc[] = [];
  constructor(o: { mutants?: string[]; profile?: "current" | "legacy" } = {}) { this.mutants = new Set(o.mutants ?? []); this.profile = o.profile ?? "current"; this.served = SERVICE_VERSIONS[this.profile]; }
  private m(id: OobServiceMutant): boolean { return this.mutants.has(id); }

  /** Class D: the community's DID document with the two services a wallet reads (VTI-LNK-102). */
  didDocument(): Doc {
    const did = this.signer.did;
    const vm = `${did}#${did.slice(8)}`;
    return {
      id: did, verificationMethod: [{ id: vm, type: "Multikey", controller: did, publicKeyMultibase: did.slice(8) }], authentication: [vm], assertionMethod: [vm],
      service: [{ id: `${did}#trust-tasks`, type: "TrustTaskHTTPS", serviceEndpoint: `${PORTAL_ORIGIN}/v1` }, { id: `${did}#sign-in-portal`, type: "SignInPortal", serviceEndpoint: `${PORTAL_ORIGIN}/members/` }],
    };
  }

  async capabilities(): Promise<Capabilities> {
    const v = this.served;
    const types = [...v.request.map((x) => `request/${x}`), ...v.claim.map((x) => `claim/${x}`), ...v.prove.map((x) => `prove/${x}`), ...v.respond.map((x) => `respond/${x}`), ...v.redeem.map((x) => `redeem/${x}`), ...v.cancel.map((x) => `cancel/${x}`)].map((t) => `${OOB}/${t}`);
    const tag = `${this.profile === "legacy" ? "+legacy" : ""}${this.mutants.size === 0 ? "" : `+${[...this.mutants].join("+")}`}`;
    return {
      name: `reference-service${tag}`, implementation: "reference-service", version: `suite reference, sign-in service (${this.profile}: ${types.map((t) => t.slice(OOB.length + 1)).join(", ")})`, tierMax: 1, bindings: ["in-process"], supportedTypes: types, carriers: [],
      cryptosuites: ["eddsa-jcs-2022"], optional: ["clockFree", "trigger.serveVersions"], ceremonyRoles: [{ ceremony: "FC-AUT", roles: ["service"] }], pins: { framework: "0.6.0", error: "0.6", binding: "none" },
    };
  }
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> {
    return Object.fromEntries(roles.map((r) => [r, { vid: this.signer.did, didDocument: this.didDocument(), transportAddress: "in-process", keyCustody: "iut" as const }]));
  }
  async trust(): Promise<void> { /* did:key resolves itself */ }
  async setClock(): Promise<void> { throw new Error("not supported"); }
  async advance(): Promise<void> { throw new Error("not supported"); }
  async restart(): Promise<void> { /* none */ }
  async snapshot(): Promise<string> { return `${this.requests.size}:${[...this.requests.values()].map((r) => r.state).join(",")}`; }
  async diff(id: string): Promise<{ changed: boolean }> { return { changed: id !== (await this.snapshot()) }; }
  async verifyProof(p: { bytes: string }): Promise<ProofVerifyResult> { try { return { valid: verifyDocumentProof(JSON.parse(p.bytes) as Doc, { nowMs: Date.now() }).valid }; } catch { return { valid: false }; } }
  async reset(): Promise<void> { this.requests.clear(); this.members.clear(); this.inbox.length = 0; this.served = SERVICE_VERSIONS[this.profile]; }

  /** `seedMember {vid}`: the community's records hold this DID as an active member. `serveVersions {profile}`: serve the `current` or `legacy` ladder from now on (a deployment's version, class D). */
  async trigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }> {
    if (action === "seedMember") { this.members.add(String(args.vid)); return { documents: [] }; }
    if (action === "serveVersions") {
      const p = String(args.profile);
      if (p !== "current" && p !== "legacy") throw new Error(`no version profile ${p}`);
      this.served = SERVICE_VERSIONS[p];
      return { documents: [] };
    }
    throw new Error(`the service has no trigger ${action}`);
  }

  private sign(doc: Doc, purpose: "assertionMethod" | "authentication" = "assertionMethod"): Doc { return signDocument(doc as Record<string, unknown>, this.signer, { created: Date.now(), purpose }) as unknown as Doc; }
  private answer(req: Doc, type: string, payload: Doc, signed = true): Doc {
    const d: Doc = { id: `urn:uuid:${randomUUID()}`, type, threadId: req.id, ...(typeof req.parentThreadId === "string" ? { parentThreadId: req.parentThreadId } : {}), issuer: this.signer.did, recipient: req.issuer, issuedAt: iso(Date.now()), payload };
    return signed ? this.sign(d) : d;
  }
  private error(req: Doc, code: string, message: string, details?: Doc): SendResult {
    const doc = this.answer(req, ERR, { code, message, retryable: false, ...(details === undefined ? {} : { details }) }, false);
    this.inbox.push(doc);
    return { replies: [JSON.stringify(doc)], transport: { status: 200, kind: "document" }, quiescentAfterMs: 0 };
  }
  private ok(req: Doc, type: string, payload: Doc, signed = true): SendResult {
    const doc = this.answer(req, type, payload, signed);
    return { replies: [JSON.stringify(doc)], transport: { status: 200, kind: "document" }, quiescentAfterMs: 0 };
  }
  private expire(r: Req, now: number): void {
    if (r.state === "pending" && now > r.claimClosesAt) r.state = "expired";
    if ((r.state === "claimed" || r.state === "identified" || r.state === "approved") && r.decisionClosesAt !== undefined && now > r.decisionClosesAt) r.state = "expired";
  }

  async send(p: SendParams): Promise<SendResult> {
    const d = JSON.parse(p.bytes) as Doc;
    this.inbox.push(d);
    const type = String(d.type ?? "");
    if (!type.startsWith(`${OOB}/`)) return this.error(d, "unsupportedType", "this service serves auth/oob only");
    const [task, version] = type.slice(OOB.length + 1).split("/");
    const served = (this.served as unknown as Record<string, readonly string[]>)[task!];
    if (served === undefined) return this.error(d, "unsupportedType", `auth/oob/${task} is not served here`);
    if (!served.includes(version!)) return this.error(d, "unsupportedVersion", `auth/oob/${task} ${version} is not served`, { requestedType: type, servedVersions: served.map((v) => `${OOB}/${task}/${v}`) }); // the specification names no members for this detail; the shape is the reference implementation's (docs/05) and VTI's, Type URIs
    const issuer = String(d.issuer ?? "");
    // the issuer of every request is an Ed25519 did:key and the envelope proof verifies (authentication)
    if (ed25519FromDidKey(issuer) === null) return this.error(d, "auth/oob:keyUnsupported", "the issuer is not an Ed25519 did:key");
    if (!(await this.proofOk(d, "authentication"))) return this.error(d, "auth/oob:notAuthorized", "the proof does not verify");
    const payload = isObject(d.payload) ? d.payload : {};
    const now = Date.now();
    switch (task) {
      case "request": return this.request(d, payload, now);
      case "claim": return this.claim(d, payload, version!, now);
      case "prove": return this.prove(d, payload, version as "0.1" | "0.2" | "0.3", now);
      case "respond": return this.respond(d, payload, version as "0.1" | "0.2" | "0.3", now);
      case "redeem": return this.redeem(d, payload, now);
      case "cancel": return this.cancel(d, payload, now);
      default: return this.error(d, "unsupportedType", `auth/oob/${task} is not served here`);
    }
  }
  private async proofOk(d: Doc, purpose: string): Promise<boolean> {
    const v = verifyDocumentProof(d, { nowMs: Date.now() });
    return v.valid && (d.proof as Doc).proofPurpose === purpose;
  }
  private find(d: Doc, payload: Doc): Req | SendResult {
    const id = typeof payload.requestId === "string" ? payload.requestId : "";
    const r = this.requests.get(id);
    if (r === undefined) return this.error(d, "auth/oob:requestNotFound", "no request has this requestId");
    this.expire(r, Date.now());
    return r;
  }

  private request(d: Doc, payload: Doc, now: number): SendResult {
    if (payload.purpose !== "login") return this.error(d, "auth/oob/request:purposeUnsupported", "this service implements purpose login only");
    if (payload.mode !== "scan") return this.error(d, "auth/oob/request:modeUnsupported", "this service implements mode scan only");
    const id = b64url(randomBytes(16));
    const r: Req = { id, starter: String(d.issuer), state: "pending", claimClosesAt: now + 120_000 };
    this.requests.set(id, r);
    return this.ok(d, `${OOB}/request/0.2#response`, { requestId: id, claimClosesAt: iso(r.claimClosesAt) }, false);
  }

  /** Step 1's members. `rfc3339`: claim 0.2 and prove 0.3 say `decisionClosesAt` (a date-time); earlier versions `decisionDeadline` (epoch seconds). */
  private step1(r: Req, rfc3339: boolean): Doc {
    const closes = r.decisionClosesAt!;
    return {
      requestId: r.id, service: { did: this.signer.did, name: "Reference Community" }, origin: this.m("claimAnswerWrongOrigin") ? "https://other.example" : PORTAL_ORIGIN, purpose: "login",
      ...(rfc3339 ? { decisionClosesAt: iso(closes) } : { decisionDeadline: epoch(closes) }),
    };
  }
  private claim(d: Doc, payload: Doc, version: string, now: number): SendResult {
    if (typeof d.parentThreadId !== "string" || d.parentThreadId !== payload.requestId) return this.error(d, "malformedRequest", "parentThreadId must equal payload.requestId");
    const r = this.find(d, payload);
    if (!("state" in r)) return r;
    const again = r.state === "claimed" && this.m("claimTwice"); // the mutant takes a second claim
    if (!again && r.state === "expired") return this.error(d, "auth/oob:requestExpired", "the request has ended");
    if (!again && r.state !== "pending") return this.error(d, "auth/oob/claim:alreadyClaimed", "this request was already claimed");
    r.state = "claimed"; r.lock = String(d.issuer); r.match = String(randomInt(0, 100)).padStart(2, "0"); r.decisionClosesAt = now + 120_000;
    const step1 = this.step1(r, version === "0.2");
    return this.ok(d, `${OOB}/claim/${version}#response`, step1, !this.m("claimAnswerUnsigned"));
  }

  private requester(r: Req): Doc { return { location: "Reference City, RC", browser: "Reference Browser 1", os: "Reference OS 1", createdAt: iso(r.claimClosesAt - 120_000), sameNetwork: "unknown" }; }
  private decline(r: Req): void { if (r.state === "claimed" || r.state === "identified") r.state = "declined"; }
  private prove(d: Doc, payload: Doc, version: "0.1" | "0.2" | "0.3", now: number): SendResult {
    const identify = isObject(payload.identify) ? payload.identify : undefined;
    const idPayload = identify !== undefined && isObject(identify.payload) ? identify.payload : {};
    const r = this.requests.get(String(idPayload.requestId ?? "")) ?? this.requests.get(String(d.parentThreadId ?? ""));
    if (r === undefined) return this.error(d, "auth/oob:requestNotFound", "no request has this requestId");
    this.expire(r, now);
    if (r.lock !== String(d.issuer)) return this.error(d, "auth/oob:notClaimant", "the prove is not signed by the lock key");
    if (r.state !== "claimed") return this.error(d, "auth/oob:requestExpired", "the request has ended or is not claimed");
    const fail = (code: string, message: string): SendResult => { this.decline(r); return this.error(d, code, message); };
    if (identify === undefined || idPayload.requestId !== r.id || idPayload.approverKey !== r.lock) return fail("auth/oob:notAuthorized", "the identify does not name this request and the lock");
    const member = String(identify.issuer ?? "");
    // membership first, before any DID is resolved (a non-member and a bad signature get the same answer)
    if (!this.members.has(member) && !this.m("nonMemberAccepted")) return fail("auth/oob:notAuthorized", "not authorized");
    const identifyProof = identify.proof !== undefined && verifyDocumentProof(identify, { nowMs: Date.now() }).valid && (identify.proof as Doc).proofPurpose === "authentication";
    if (identify.type !== `${OOB}/identify/0.1` || ed25519FromDidKey(member) === null || (!identifyProof && !this.m("identifyNoProofCheck"))) return fail("auth/oob:notAuthorized", "not authorized");
    if (idPayload.enteredNumber !== r.match && !this.m("noNumberCheck")) return fail("auth/oob/prove:numberMismatch", "the number does not match");
    r.state = "identified"; r.identifiedAs = member; r.version = version;
    const step2 = this.sign({
      id: `urn:uuid:${randomUUID()}`, type: `${OOB}/prove/${version}#response`, threadId: d.id, ...(typeof d.parentThreadId === "string" ? { parentThreadId: d.parentThreadId } : {}), issuer: this.signer.did, recipient: d.issuer, issuedAt: iso(now),
      payload: { ...this.step1(r, version === "0.3"), sessionKey: r.starter, requester: this.requester(r), identifiedAs: member },
    });
    r.step2Doc = step2; r.step2Digest = digestMultibase(step2);
    return { replies: [JSON.stringify(step2)], transport: { status: 200, kind: "document" }, quiescentAfterMs: 0 };
  }

  private respond(d: Doc, payload: Doc, version: "0.1" | "0.2" | "0.3", now: number): SendResult {
    const grant = isObject(payload.grant) ? payload.grant : undefined;
    const gp = grant !== undefined && isObject(grant.payload) ? grant.payload : {};
    const r = this.requests.get(String(gp.requestId ?? "")) ?? this.requests.get(String(d.parentThreadId ?? ""));
    if (r === undefined) return this.error(d, "auth/oob:requestNotFound", "no request has this requestId");
    this.expire(r, now);
    if (r.lock !== String(d.issuer) && !this.m("wrongKeyRespond")) return this.error(d, "auth/oob:notClaimant", "the respond is not signed by the lock key");
    if (r.state === "approved" || r.state === "declined" || r.state === "cancelled") return this.error(d, "auth/oob:alreadyDecided", "the request was already decided");
    if (r.state !== "identified") return this.error(d, "auth/oob:requestExpired", "the request has ended or is not identified");
    const bad = (code: string, message: string): SendResult => { this.decline(r); return this.error(d, code, message); };
    if (grant === undefined || grant.issuer !== r.identifiedAs || !(verifyDocumentProof(grant, { nowMs: Date.now() }).valid && (grant.proof as Doc).proofPurpose === "assertionMethod")) return bad("auth/oob:notAuthorized", "not authorized");
    if (!this.members.has(r.identifiedAs!)) return bad("auth/oob:notAuthorized", "not authorized");
    const digest = typeof gp.contextDigest === "string" ? gp.contextDigest : "";
    const ends = version === "0.3" ? gp.sessionEndsAt : gp.notAfter;
    if (gp.approverKey !== r.lock || gp.sessionKey !== r.starter || gp.origin !== PORTAL_ORIGIN || (!sameDigest(digest, r.step2Digest!) && !this.m("noDigestCheck")) || ends === undefined || version !== r.version) return bad("auth/oob/respond:contextMismatch", "the grant does not match what was shown");
    const decision = gp.decision === "decline" ? "declined" : "approved";
    r.state = decision === "declined" ? "declined" : "approved"; r.grant = grant;
    // The specification's examples carry no proof on this answer; VTI signs it (assertionMethod) and the wallet requires it, so the oracle signs it too (an attestation of the recorded status; spec-silent, noted in docs/26).
    return this.ok(d, `${OOB}/respond/${version}#response`, { status: decision });
  }

  private redeem(d: Doc, payload: Doc, now: number): SendResult {
    const r = this.find(d, payload);
    if (!("state" in r)) return r;
    if (r.starter !== String(d.issuer) && !this.m("redeemAnyKey")) return this.error(d, "auth/oob:notStarter", "the redeem is not signed by the starter key");
    if (r.state === "approved" || (this.m("sessionBeforeApproval") && r.state !== "declined" && r.state !== "cancelled" && r.state !== "expired" && r.state !== "consumed")) {
      const subject = String(r.identifiedAs ?? this.members.values().next().value ?? "did:key:unknown");
      if (r.state === "approved" && !this.members.has(subject)) return this.error(d, "auth/oob:notAuthorized", "not authorized");
      r.state = "consumed";
      return this.ok(d, `${OOB}/redeem/0.2#response`, { subject, displayName: "Ceremony member", sessionEndsAt: iso(now + 30 * 60_000), amr: ["did", "oob", "uv"] }, false);
    }
    if (r.state === "declined" || r.state === "cancelled") return this.error(d, "auth/oob/redeem:declined", "the request was declined or cancelled", { state: r.state });
    if (r.state === "expired" || r.state === "consumed") return this.error(d, "auth/oob:requestExpired", "the request has ended");
    // pending, claimed or identified: the starter alone is told the number, once the request is claimed
    return this.error(d, "auth/oob/redeem:pending", "the request is not yet approved", { state: r.state, ...(r.match !== undefined && r.state !== "pending" ? { matchNumber: r.match } : {}) });
  }

  private cancel(d: Doc, payload: Doc, now: number): SendResult {
    const r = this.find(d, payload);
    if (!("state" in r)) return r;
    const who = String(d.issuer);
    if (who !== r.starter && who !== r.lock) return this.error(d, "auth/oob:notAuthorized", "not authorized");
    if (r.state === "pending" || r.state === "claimed" || r.state === "identified") { if (!this.m("cancelIgnored")) r.state = "cancelled"; }
    else if (r.state === "approved" || r.state === "declined") return this.error(d, "auth/oob:alreadyDecided", "the request was already decided");
    else if (r.state === "expired" || r.state === "consumed") return this.error(d, "auth/oob:requestExpired", "the request has ended");
    void now;
    return this.ok(d, `${OOB}/cancel/0.1#response`, { status: "cancelled" }, false);
  }

  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "received") {
      const docs = this.inbox.filter((d) => (q.type === undefined || d.type === q.type) && (q.threadId === undefined || d.threadId === q.threadId || d.id === q.threadId));
      return { value: docs.length, documents: docs.map((x) => JSON.stringify(x)) };
    }
    if (q.query === "stored") {
      const m = /^request-state:(.+)$/.exec(q.kind);
      if (m !== null) return { value: [...this.requests.values()].filter((r) => r.state === m[1]).length };
      throw new Error(`the service does not answer stored ${q.kind}`);
    }
    throw new Error(`the service does not answer observe ${q.query}`);
  }
}
