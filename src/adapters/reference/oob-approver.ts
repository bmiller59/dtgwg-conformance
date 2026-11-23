// SPDX-License-Identifier: Apache-2.0
// Reference approver for the sign-in ceremony (group FC-AUT, docs/26 section 4): the role of the member's wallet and agent, written from the specification text (specs/auth/oob/*), not from
// keyring-wallet. It claims a request with a fresh lock key K_a, checks the community's signed step 1 (proof against the DID document's assertionMethod, threads to the claim, addressed to K_a,
// names the request, the community, purpose login, the origin of the document's `SignInPortal` service and a deadline ahead), has "its agent" sign identify and grant as the member, proves with the
// number the person typed, and responds with the grant. Version step-down, as the wallet does it: claim 0.2 then 0.1; prove 0.3 then 0.2 then 0.1, with the grant and respond of the version
// that prove was accepted at; a refusal that names an unserved type or version is the only thing that makes it step down, and a refusal is never resent at another version.
//
// Class D stand-ins: the member's agent (identify and grant are signed here with the member's own did:key, as the wallet driver's stand-in agent does), the phone's user-verification approval (none).
// Tamper kinds (declared as the capability `initiate.oobTamper`, so a wallet is skipped for the scenarios that need them): `oob-respond-wrong-key` signs respond with a key other than the lock,
// `oob-respond-wrong-digest` carries a grant whose contextDigest names something else, `oob-prove-bad-signature` carries an identify whose proof is broken.
import { randomUUID } from "node:crypto";
import type { Adapter, Capabilities, CeremonyState, InitiateParams, InitiateResult, ObserveQuery, ObserveResult, ProofVerifyResult, ProvisionedRole, SendParams, SendResult } from "../../adapter/contract.ts";
import { digestMultibase } from "../../crypto/digest.ts";
import { ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import type { Ed25519Signer } from "../../crypto/didkey.ts";
import { resolverFromDidDocument, signDocument, verifyDocumentProof } from "../../crypto/proof.ts";
import { isObject } from "../../util/json.ts";

const S = "https://trusttasks.org/spec/";
const OOB = `${S}auth/oob`;
export const APPROVER_KINDS = ["oob-claim", "oob-prove", "oob-approve", "oob-cancel", "oob-respond-wrong-key", "oob-respond-wrong-digest", "oob-prove-bad-signature"];
export const TAMPER_KINDS = ["oob-respond-wrong-key", "oob-respond-wrong-digest", "oob-prove-bad-signature"];
export const MEMBER_SEED = 0x6d;
type Doc = Record<string, unknown>;
type Version = "0.1" | "0.2" | "0.3";
interface Claimed { requestId: string; vtcDid: string; key: Ed25519Signer; step1: Doc }
interface Proved { claimed: Claimed; version: Version; step2: Doc }
interface Flow { kind: string; thread: string; args: Doc; to: string; state: CeremonyState; received: Doc[]; sent: Doc[]; attempt: number; detail?: string }
const iso = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
const originOf = (u: string): string | undefined => { try { return new URL(u).origin; } catch { return undefined; } };
/** The wallet reads only https service endpoints without a port (triggerLink.ts isCandidateEndpoint). */
export const httpsEndpoint = (e: unknown): string | undefined => (typeof e === "string" && /^https:\/\/[^/?#@\s]+([/?#]|$)/i.test(e) ? e : undefined);
const unsupported = (d: Doc): boolean => /(^|[:/])unsupported(Type|Version)$/.test(String(isObject(d.payload) ? d.payload.code ?? "" : ""));
const isError = (d: Doc): boolean => String(d.type ?? "").includes("/trust-task-error/");

export class OobApproverAdapter implements Adapter {
  readonly member: Ed25519Signer;
  private flows: Flow[] = [];
  private claimed: Claimed | undefined;
  private proved: Proved | undefined;
  private doc: Doc | undefined;
  private n = 0;
  constructor(seed = MEMBER_SEED) { this.member = ed25519Signer(seedOf(seed)); }

  async capabilities(): Promise<Capabilities> {
    return {
      name: "reference-approver", implementation: "reference-approver", version: "suite reference, sign-in approver (wallet and agent role)", tierMax: 1, bindings: ["in-process"], supportedTypes: [], carriers: [], cryptosuites: ["eddsa-jcs-2022"],
      optional: ["clockFree", "initiate", "initiate.oobTamper", "observe.ceremony", "observe.received"], initiates: APPROVER_KINDS, ceremonyRoles: [{ ceremony: "FC-AUT", roles: ["member-phone"] }], pins: { framework: "0.6.0", error: "0.6", binding: "none" },
    };
  }
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> { return Object.fromEntries(roles.map((r) => [r, { vid: this.member.did, didDocument: { id: this.member.did }, transportAddress: "in-process", keyCustody: "iut" as const }])); }
  async trust(): Promise<void> { /* did:key */ }
  async setClock(): Promise<void> { throw new Error("not supported"); }
  async advance(): Promise<void> { throw new Error("not supported"); }
  async trigger(): Promise<{ documents: string[] }> { throw new Error("the approver has no triggers"); }
  async restart(): Promise<void> { /* none */ }
  async snapshot(): Promise<string> { return String(this.flows.length); }
  async diff(id: string): Promise<{ changed: boolean }> { return { changed: id !== String(this.flows.length) }; }
  async verifyProof(p: { bytes: string }): Promise<ProofVerifyResult> { try { return { valid: verifyDocumentProof(JSON.parse(p.bytes) as Doc, { nowMs: Date.now() }).valid }; } catch { return { valid: false }; } }
  async reset(): Promise<void> { this.flows = []; this.claimed = undefined; this.proved = undefined; this.doc = undefined; this.n = 0; }

  private envelope(key: Ed25519Signer, to: string, type: string, payload: Doc, purpose: "authentication" | "assertionMethod", parent?: string): Doc {
    const now = Date.now();
    return signDocument({ id: `urn:uuid:${randomUUID()}`, type, ...(parent === undefined ? {} : { parentThreadId: parent }), issuer: key.did, recipient: to, issuedAt: iso(now), payload }, key, { created: now, purpose }) as unknown as Doc;
  }
  private fail(f: Flow, detail: string, state: CeremonyState = "refused"): undefined { f.state = state; f.detail = detail; return undefined; }

  /** The next document of a flow, given what the service answered to the last one (undefined: the flow is over). */
  private next(f: Flow, reply?: Doc): Doc | undefined {
    const a = f.args;
    if (reply !== undefined && isError(reply)) {
      // only an unserved type or version makes the approver step down; any other refusal ends the flow
      if (!unsupported(reply)) return this.fail(f, `refused: ${String((reply.payload as Doc).code ?? "")}`);
    }
    switch (f.kind) {
      case "oob-claim": {
        // a wallet asks 0.2 first and steps down to 0.1; `args.only` (class D: tamper capability) sends only the versions it names
        const versions = (Array.isArray(f.args.only) ? (f.args.only as string[]) : ["0.2", "0.1"]) as ("0.1" | "0.2")[];
        if (reply === undefined) { f.attempt = 0; return this.claimDoc(f, versions[0]!); }
        if (isError(reply)) { f.attempt++; return f.attempt < versions.length ? this.claimDoc(f, versions[f.attempt]!) : this.fail(f, "refused: no served claim version"); }
        const c = this.checkStep1(f, reply);
        if (typeof c === "string") return this.fail(f, c);
        this.claimed = c; this.proved = undefined;
        f.state = "completed";
        return undefined;
      }
      case "oob-prove": case "oob-prove-bad-signature": {
        const c = this.claimed;
        if (c === undefined) return this.fail(f, "no claimed sign-in: claim first");
        const versions: Version[] = ["0.3", "0.2", "0.1"];
        if (reply === undefined) { f.attempt = 0; return this.proveDoc(f, c, versions[0]!); }
        if (isError(reply)) { f.attempt++; return f.attempt < versions.length ? this.proveDoc(f, c, versions[f.attempt]!) : this.fail(f, "no served prove version"); }
        const version = versions[f.attempt]!;
        const p = this.checkStep2(f, reply, c, version);
        if (typeof p === "string") return this.fail(f, p);
        this.proved = p; f.state = "completed";
        return undefined;
      }
      case "oob-approve": case "oob-respond-wrong-key": case "oob-respond-wrong-digest": {
        const p = this.proved;
        if (p === undefined) return this.fail(f, "no proved sign-in: prove first");
        if (reply === undefined) return this.respondDoc(f, p);
        if (isObject(reply.payload) && reply.payload.status === "approved") { f.state = "completed"; return undefined; }
        return this.fail(f, "the service did not approve");
      }
      case "oob-cancel": {
        const c = this.claimed;
        if (c === undefined) return this.fail(f, "no claimed sign-in to cancel");
        if (reply === undefined) return this.envelope(c.key, c.vtcDid, `${OOB}/cancel/0.1`, { requestId: c.requestId }, "authentication", c.requestId);
        if (isObject(reply.payload) && reply.payload.status === "cancelled") { f.state = "completed"; return undefined; }
        return this.fail(f, "not cancelled");
      }
      default: void a; return this.fail(f, `no kind ${f.kind}`);
    }
  }

  private claimDoc(f: Flow, version: "0.1" | "0.2"): Doc {
    if (f.attempt === 0) { this.doc = isObject(f.args.doc) ? f.args.doc : undefined; }
    const key = this.claimedKey(f);
    return this.envelope(key, String(f.args.from), `${OOB}/claim/${version}`, { requestId: String(f.args.id) }, "authentication", String(f.args.id));
  }
  /** A fresh K_a for each claim flow (the same key for a step-down resend of one claim). */
  private pendingKey: Ed25519Signer | undefined;
  private claimedKey(f: Flow): Ed25519Signer {
    if (f.attempt === 0 || this.pendingKey === undefined) this.pendingKey = ed25519Signer(seedOf(0xa0 + (this.n++ % 0x40)));
    return this.pendingKey;
  }
  private checkStep1(f: Flow, reply: Doc): Claimed | string {
    const sent = f.sent.at(-1)!;
    const doc = this.doc;
    if (doc === undefined) return "no DID document for the community";
    const vtcDid = String(f.args.from);
    const services = Array.isArray(doc.service) ? (doc.service as Doc[]) : [];
    const portal = services.filter((s) => s.type === "SignInPortal").map((s) => httpsEndpoint(s.serviceEndpoint)).find((e) => e !== undefined);
    const https = services.filter((s) => s.type === "TrustTaskHTTPS").map((s) => httpsEndpoint(s.serviceEndpoint)).find((e) => e !== undefined);
    if (portal === undefined || https === undefined || originOf(portal) === undefined) return "noSignIn: the DID document offers no https sign-in endpoints";
    const v = verifyDocumentProof(reply, { nowMs: Date.now(), resolve: resolverFromDidDocument(doc) });
    if (!v.valid || (reply.proof as Doc).proofPurpose !== "assertionMethod") return "badAnswer: not signed under the community's assertionMethod";
    if (reply.threadId !== sent.id) return "badAnswer: does not thread to the claim";
    if (reply.recipient !== sent.issuer) return "badAnswer: not addressed to the claim key";
    const p = isObject(reply.payload) ? reply.payload : {};
    if (p.requestId !== f.args.id) return "badAnswer: names another request";
    if (!isObject(p.service) || p.service.did !== vtcDid) return "badAnswer: names another community";
    if (p.purpose !== "login") return "badAnswer: not for signing in";
    if (p.origin !== originOf(portal)) return "badAnswer: origin is not the sign-in portal's";
    const deadline = typeof p.decisionClosesAt === "string" ? Date.parse(p.decisionClosesAt) : typeof p.decisionDeadline === "number" ? p.decisionDeadline * 1000 : NaN;
    if (!Number.isFinite(deadline) || deadline <= Date.now()) return "badAnswer: no decision deadline ahead";
    return { requestId: String(f.args.id), vtcDid, key: this.pendingKey!, step1: p };
  }

  private proveDoc(f: Flow, c: Claimed, version: Version): Doc {
    const typed = f.args.offset === undefined || Number(f.args.offset) === 0 ? String(f.args.number) : String((Number(f.args.number) + Number(f.args.offset)) % 100).padStart(2, "0");
    let identify = this.envelope(this.member, c.vtcDid, `${OOB}/identify/0.1`, { requestId: c.requestId, approverKey: c.key.did, enteredNumber: typed }, "authentication");
    if (f.kind === "oob-prove-bad-signature") { const proof = identify.proof as Doc; identify = { ...identify, proof: { ...proof, proofValue: String(proof.proofValue).slice(0, -2) + (String(proof.proofValue).endsWith("11") ? "22" : "11") } }; }
    return this.envelope(c.key, c.vtcDid, `${OOB}/prove/${version}`, { identify }, "authentication", c.requestId);
  }
  private checkStep2(f: Flow, reply: Doc, c: Claimed, version: Version): Proved | string {
    const doc = this.doc!;
    const v = verifyDocumentProof(reply, { nowMs: Date.now(), resolve: resolverFromDidDocument(doc) });
    if (!v.valid || (reply.proof as Doc).proofPurpose !== "assertionMethod") return "badAnswer: step 2 not signed under the community's assertionMethod";
    const p = isObject(reply.payload) ? reply.payload : {};
    for (const k of ["requestId", "origin", "purpose"]) if (p[k] !== c.step1[k]) return `badAnswer: step 2 changed ${k}`;
    if (p.identifiedAs !== this.member.did) return "badAnswer: identifiedAs is not the member";
    void f; void version;
    return { claimed: c, version, step2: reply };
  }

  private respondDoc(f: Flow, p: Proved): Doc {
    const c = p.claimed;
    const s2 = isObject(p.step2.payload) ? p.step2.payload : {};
    const base: Doc = { requestId: c.requestId, decision: "approve", sessionKey: s2.sessionKey, approverKey: c.key.did, origin: s2.origin, contextDigest: f.kind === "oob-respond-wrong-digest" ? digestMultibase({ not: "what was shown" }) : digestMultibase(p.step2) };
    const when = Date.now() + 30 * 60_000;
    // Step 2's `signingScope` is copied unchanged into the grant (as the wallet's grant does, from version 0.2 on); a community that offered one holds the two equal (auth/oob/respond item 3), so a grant without it is refused (contextMismatch)
    const scope = p.version !== "0.1" && Array.isArray(s2.signingScope) ? { signingScope: [...(s2.signingScope as string[])] } : {};
    const payload: Doc = p.version === "0.3" ? { ...base, ...scope, sessionEndsAt: iso(when) } : { ...base, ...scope, notAfter: Math.floor(when / 1000) };
    const grant = this.envelope(this.member, c.vtcDid, `${OOB}/grant/${p.version}`, payload, "assertionMethod");
    const signer = f.kind === "oob-respond-wrong-key" ? ed25519Signer(seedOf(0xee)) : c.key;
    return this.envelope(signer, c.vtcDid, `${OOB}/respond/${p.version}`, { grant }, "authentication", c.requestId);
  }

  async initiate(ip: InitiateParams): Promise<InitiateResult> {
    if (!APPROVER_KINDS.includes(ip.kind)) throw new Error(`the approver has no kind ${ip.kind}`);
    const f: Flow = { kind: ip.kind, thread: "", args: ip.args ?? {}, to: ip.to, state: "open", received: [], sent: [], attempt: 0 };
    const d = this.next(f);
    if (d === undefined) { f.thread = `urn:uuid:${randomUUID()}`; this.flows.push(f); return { threadId: f.thread, documents: [], sent: false, from: this.member.did }; }
    f.thread = String(d.id); f.sent.push(d); this.flows.push(f);
    return { threadId: f.thread, documents: [JSON.stringify(d)], sent: false, continues: true, from: String(d.issuer) };
  }
  async send(p: SendParams): Promise<SendResult> {
    const d = JSON.parse(p.bytes) as Doc;
    const f = this.flows.find((x) => x.sent.some((s) => s.id === d.threadId));
    if (f === undefined) return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 };
    f.received.push(d);
    const nxt = this.next(f, d);
    if (nxt === undefined) { if (f.state === "open") f.state = isError(d) ? "refused" : "completed"; return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 }; }
    f.sent.push(nxt);
    return { replies: [JSON.stringify(nxt)], transport: { status: 200, kind: "document" }, quiescentAfterMs: 0 };
  }
  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "ceremony") { const f = this.flows.find((x) => x.thread === q.threadId); return f === undefined ? { value: "unknown" } : { value: f.state, ...(f.detail === undefined ? {} : { documents: [f.detail] }) }; }
    if (q.query === "received") {
      const f = this.flows.find((x) => x.thread === q.threadId);
      const docs = (f?.received ?? []).filter((d) => q.type === undefined || d.type === q.type);
      return { value: docs.length, documents: docs.map((d) => JSON.stringify(d)) };
    }
    throw new Error(`the approver does not answer observe ${q.query}`);
  }
}
