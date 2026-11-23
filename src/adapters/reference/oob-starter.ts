// SPDX-License-Identifier: Apache-2.0
// Reference starter for the sign-in ceremony (group FC-AUT, docs/26 section 4): the role of the browser on the community's portal. It opens a request with the service
// (`auth/oob/request`), keeps the throwaway starter key K_b it signed with, reads the match number the service hands only to the starter key's holder, and redeems the
// request when the approver has decided (`auth/oob/redeem`). It models only what a scenario observes: no page, no QR code (the link is built from the service's answer,
// as TRIGGER-LINK.md section 1 composes it), no session use. It signs its own documents; the runner relays them.
import { randomUUID } from "node:crypto";
import type { Adapter, Capabilities, CeremonyState, InitiateParams, InitiateResult, ObserveQuery, ObserveResult, ProofVerifyResult, ProvisionedRole, SendParams, SendResult } from "../../adapter/contract.ts";
import { ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import type { Ed25519Signer } from "../../crypto/didkey.ts";
import { signDocument, verifyDocumentProof } from "../../crypto/proof.ts";
import { isObject } from "../../util/json.ts";

const S = "https://trusttasks.org/spec/auth/oob";
export const STARTER_KINDS = ["oob-request", "oob-redeem"];
/** A browser that did not open the request (class D): `oob-redeem` with `args.as = "stranger"` signs the redeem with a key of its own. */
export const STARTER_ROLES = ["FC-AUT"].map((ceremony) => ({ ceremony, roles: ["starter"] }));
type Doc = Record<string, unknown>;

interface Request { thread: string; key: Ed25519Signer; requestId?: string; claimClosesAt?: string; matchNumber?: string; state: CeremonyState; session?: Doc }

export class OobStarterAdapter implements Adapter {
  private readonly threads = new Map<string, Request>();
  private readonly inbox: Doc[] = [];
  private counter = 0;
  private readonly seed: number;
  constructor(seed = 0xb0) { this.seed = seed; }

  async capabilities(): Promise<Capabilities> {
    return {
      name: "reference-starter", implementation: "reference-starter", version: "suite reference, sign-in starter (browser role)", tierMax: 1, bindings: ["in-process"], supportedTypes: [], carriers: [], cryptosuites: ["eddsa-jcs-2022"],
      optional: ["clockFree", "initiate", "observe.ceremony", "observe.received"], initiates: STARTER_KINDS, ceremonyRoles: STARTER_ROLES,
      pins: { framework: "0.6.0", error: "0.6", binding: "none" },
    };
  }
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> {
    const s = ed25519Signer(seedOf(this.seed));
    return Object.fromEntries(roles.map((r) => [r, { vid: s.did, didDocument: { id: s.did }, transportAddress: "in-process", keyCustody: "iut" as const }]));
  }
  async trust(): Promise<void> { /* did:key resolves itself */ }
  async setClock(): Promise<void> { throw new Error("not supported"); }
  async advance(): Promise<void> { throw new Error("not supported"); }
  async trigger(): Promise<{ documents: string[] }> { throw new Error("the starter has no triggers"); }
  async restart(): Promise<void> { this.threads.clear(); }
  async snapshot(): Promise<string> { return `${this.threads.size}:${this.inbox.length}`; }
  async diff(id: string): Promise<{ changed: boolean }> { return { changed: id !== (await this.snapshot()) }; }
  async verifyProof(p: { bytes: string }): Promise<ProofVerifyResult> { try { return { valid: verifyDocumentProof(JSON.parse(p.bytes) as Doc, { nowMs: Date.now() }).valid }; } catch { return { valid: false }; } }
  async reset(): Promise<void> { this.threads.clear(); this.inbox.length = 0; this.counter = 0; }

  private doc(key: Ed25519Signer, to: string, type: string, payload: Doc, thread?: string): Doc {
    const now = Date.now();
    const id = `urn:uuid:${randomUUID()}`;
    return signDocument({ id, type, ...(thread === undefined ? {} : { threadId: thread }), issuer: key.did, recipient: to, issuedAt: new Date(Math.floor(now / 1000) * 1000).toISOString().replace(".000Z", "Z"), payload }, key, { created: now, purpose: "authentication" }) as unknown as Doc;
  }

  async initiate(p: InitiateParams): Promise<InitiateResult> {
    if (p.kind === "oob-request") {
      // K_b is made for this request and used nowhere else
      const key = ed25519Signer(seedOf((this.seed + 1 + this.counter++) & 0xff));
      const d = this.doc(key, p.to, `${S}/request/0.2`, { purpose: "login", mode: "scan", ...(isObject(p.args) ? (p.args.payload as Doc | undefined) ?? {} : {}) });
      this.threads.set(String(d.id), { thread: String(d.id), key, state: "open" });
      return { threadId: String(d.id), documents: [JSON.stringify(d)], sent: false, from: key.did };
    }
    if (p.kind === "oob-redeem") {
      const t = this.threads.get(String(p.thread));
      if (t === undefined || t.requestId === undefined) throw new Error("no request to redeem on this thread");
      if (isObject(p.args) && p.args.as === "stranger") {
        const key = ed25519Signer(seedOf((this.seed + 0x40 + this.counter++) & 0xff));
        const d = this.doc(key, p.to, `${S}/redeem/0.2`, { requestId: t.requestId });
        this.threads.set(String(d.id), { thread: String(d.id), key, requestId: t.requestId, state: "open" });
        return { threadId: String(d.id), documents: [JSON.stringify(d)], sent: false, from: key.did };
      }
      const d = this.doc(t.key, p.to, `${S}/redeem/0.2`, { requestId: t.requestId });
      t.thread = String(d.id);
      this.threads.set(String(d.id), t);
      return { threadId: String(d.id), documents: [JSON.stringify(d)], sent: false, from: t.key.did };
    }
    throw new Error(`the starter has no kind ${p.kind}`);
  }

  /** The service's answer to a document the starter sent. */
  async send(p: SendParams): Promise<SendResult> {
    const d = JSON.parse(p.bytes) as Doc;
    this.inbox.push(d);
    const payload = isObject(d.payload) ? d.payload : {};
    const t = this.threads.get(String(d.threadId));
    const type = String(d.type ?? "");
    if (t !== undefined) {
      if (type === `${S}/request/0.2#response`) { t.requestId = String(payload.requestId); t.claimClosesAt = String(payload.claimClosesAt); }
      else if (type === `${S}/redeem/0.2#response`) { t.state = "completed"; t.session = payload; }
      else if (type.includes("/trust-task-error/")) {
        const details = isObject(payload.details) ? payload.details : {};
        if (typeof details.matchNumber === "string") t.matchNumber = details.matchNumber;
        const code = String(payload.code ?? "");
        t.state = code === "auth/oob/redeem:pending" ? "held" : code === "auth/oob/redeem:declined" ? "declined" : code === "" ? "open" : "refused";
      }
    }
    return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 };
  }

  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "ceremony") {
      // a request and its redemptions are one ceremony for the starter: the newest reading of any thread of the request
      const t = this.threads.get(String(q.threadId));
      if (t === undefined) return { value: "unknown" };
      return { value: t.state };
    }
    if (q.query === "received") {
      const docs = this.inbox.filter((d) => (q.type === undefined || d.type === q.type) && (q.threadId === undefined || d.threadId === q.threadId) && (q.from === undefined || d.issuer === q.from));
      return { value: docs.length, documents: docs.map((d) => JSON.stringify(d)) };
    }
    if (q.query === "stored" && q.kind === "match-number") return { value: this.matchOf() === undefined ? 0 : 1 };
    throw new Error(`the starter does not answer observe ${q.query}`);
  }
  /** The match number the service handed the starter (for the person to type on the other device). */
  matchOf(): string | undefined { return [...this.threads.values()].find((t) => t.matchNumber !== undefined)?.matchNumber; }
}

