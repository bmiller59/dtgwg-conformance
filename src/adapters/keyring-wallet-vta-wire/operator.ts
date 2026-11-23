// SPDX-License-Identifier: Apache-2.0
// An operator identity for a live VTA over REST (`POST <base>/trust-tasks`): the harness's stand-in for an operator console (class D). It
// authenticates with `auth/challenge/0.1` then `auth/authenticate/0.3` (a did:key admin), and sends signed Trust Task documents. Used to read the
// agent's state for `observe stored`, to seed it (`actorRole`, `requireStepUp`) and to make the wallet's DID an admin (the enrolment ceremony
// is not run). The ceremony steps themselves never go through this client: they go over the wallet's DIDComm wire.
import { randomUUID } from "node:crypto";
import { ed25519Signer } from "../../crypto/didkey.ts";
import type { Ed25519Signer } from "../../crypto/didkey.ts";
import { signDocument } from "../../crypto/proof.ts";
import { base58Decode } from "../../crypto/base58.ts";

const TT = "https://trusttasks.org/spec/";

/** The seed of a `privateKeyMultibase` (`z` + base58btc of 0x80 0x26 + 32-byte seed), as the VTA starter's admin.json holds it. */
export function seedFromMultibase(mb: string): Uint8Array {
  if (!mb.startsWith("z")) throw new Error("privateKeyMultibase must start with z");
  const raw = base58Decode(mb.slice(1));
  if (raw.length !== 34 || raw[0] !== 0x80 || raw[1] !== 0x26) throw new Error("privateKeyMultibase is not an Ed25519 private key (multicodec 0x1300)");
  return raw.slice(2);
}

export interface Reply { status: number; doc: Record<string, any> | undefined; text: string }

export class OperatorRefused extends Error {
  readonly type: string;
  readonly status: number;
  readonly code: string | undefined;
  constructor(type: string, status: number, code: string | undefined, message: string) {
    super(message);
    this.type = type;
    this.status = status;
    this.code = code;
  }
}

export class Operator {
  private token: string | undefined;
  readonly signer: Ed25519Signer;
  private readonly base: string;
  private readonly vtaDid: string;
  private readonly fetchImpl: typeof fetch;
  /** How often a rate-limited (429) document is asked again (a test sets it to 0). */
  maxRetries = 8;
  constructor(base: string, vtaDid: string, seed: Uint8Array, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
    this.base = base.replace(/\/+$/, "");
    this.vtaDid = vtaDid;
    this.fetchImpl = fetchImpl;
    this.signer = ed25519Signer(seed);
  }
  get did(): string { return this.signer.did; }

  build(type: string, payload: Record<string, unknown>): Record<string, unknown> {
    const purpose = "authentication";
    return signDocument({ id: `urn:uuid:${randomUUID()}`, type, issuer: this.did, recipient: this.vtaDid, issuedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"), payload }, this.signer, { created: Date.now(), purpose });
  }

  private async post(doc: Record<string, unknown>, bearer: boolean): Promise<Reply> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (bearer && this.token !== undefined) headers.authorization = `Bearer ${this.token}`;
    let res = await this.fetchImpl(`${this.base}/trust-tasks`, { method: "POST", headers, body: JSON.stringify(doc) });
    // a live deployment rate-limits each signer (HTTP 429 with Retry-After): wait the period it names (bounded) and ask again, so a long run is slowed, not broken
    for (let i = 0; i < this.maxRetries && res.status === 429; i++) {
      const after = Number(res.headers?.get?.("retry-after"));
      await new Promise((r) => setTimeout(r, Math.min(30000, (Number.isFinite(after) && after > 0 ? after : 2) * 1000 + 200)));
      res = await this.fetchImpl(`${this.base}/trust-tasks`, { method: "POST", headers, body: JSON.stringify(doc) });
    }
    const text = await res.text();
    let parsed: Record<string, any> | undefined;
    try { parsed = text === "" ? undefined : JSON.parse(text); } catch { parsed = undefined; }
    return { status: res.status, doc: parsed, text };
  }

  async authenticate(): Promise<void> {
    const ch = await this.post(this.build(`${TT}auth/challenge/0.1`, { subject: this.did }), false);
    const p = ch.doc?.payload as { challenge?: string; sessionId?: string } | undefined;
    if (p?.challenge === undefined || p.sessionId === undefined) throw new Error(`auth/challenge was refused (HTTP ${ch.status}): ${ch.text.slice(0, 200)}`);
    const au = await this.post(this.build(`${TT}auth/authenticate/0.3`, { challenge: p.challenge, sessionId: p.sessionId }), false);
    const token = (au.doc?.payload as { tokens?: { accessToken?: string } } | undefined)?.tokens?.accessToken;
    if (token === undefined) throw new Error(`auth/authenticate was refused (HTTP ${au.status}): ${au.text.slice(0, 200)}`);
    this.token = token;
  }

  /** One task; the answer's payload, or `OperatorRefused` for a `trust-task-error`. A lost session is re-opened once. */
  async call(typeOrSlug: string, payload: Record<string, unknown> = {}): Promise<Record<string, any>> {
    const type = typeOrSlug.startsWith("https://") ? typeOrSlug : `${TT}${typeOrSlug}`;
    if (this.token === undefined) await this.authenticate();
    let r = await this.post(this.build(type, payload), true);
    if (r.status === 401) { await this.authenticate(); r = await this.post(this.build(type, payload), true); }
    if (r.doc === undefined) {
      if (r.status >= 200 && r.status < 300) return {};
      throw new OperatorRefused(type, r.status, undefined, `HTTP ${r.status}: ${r.text.slice(0, 200)}`);
    }
    if (typeof r.doc.type === "string" && r.doc.type.includes("trust-task-error")) {
      const p = (r.doc.payload ?? {}) as { code?: string; message?: string };
      throw new OperatorRefused(type, r.status, p.code, `${p.code ?? "error"}: ${p.message ?? ""}`);
    }
    return (r.doc.payload ?? {}) as Record<string, any>;
  }

  /**
   * One task signed by this identity and sent with NO session (the door of a VTC reads the sender from the signature, routes/trust_tasks.rs): the answer's payload, or
   * `OperatorRefused` with the answer's code. For an identity that may not sign in at all (a member with no administrative authority), whose refusal is the answer.
   */
  async callSigned(typeOrSlug: string, payload: Record<string, unknown> = {}): Promise<Record<string, any>> {
    const type = typeOrSlug.startsWith("https://") ? typeOrSlug : `${TT}${typeOrSlug}`;
    const r = await this.post(this.build(type, payload), false);
    if (r.doc === undefined) throw new OperatorRefused(type, r.status, undefined, `HTTP ${r.status}: ${r.text.slice(0, 200)}`);
    if (typeof r.doc.type === "string" && r.doc.type.includes("trust-task-error")) {
      const p = (r.doc.payload ?? {}) as { code?: string; message?: string };
      throw new OperatorRefused(type, r.status, p.code, `${p.code ?? "error"}: ${p.message ?? ""}`);
    }
    return (r.doc.payload ?? {}) as Record<string, any>;
  }

  /** A second identity on the same VTA (a harness requester, FC-KVC): it signs and authenticates as itself. */
  as(seed: Uint8Array): Operator {
    return new Operator(this.base, this.vtaDid, seed, this.fetchImpl);
  }

  /** A document signed by the caller, sent as this identity's session; the raw reply (a re-opened session once on a 401). */
  async sendDocument(doc: Record<string, unknown>): Promise<Reply> {
    if (this.token === undefined) await this.authenticate();
    let r = await this.post(doc, true);
    if (r.status === 401) { await this.authenticate(); r = await this.post(doc, true); }
    return r;
  }

  async acl(): Promise<{ subject: string; role: string; label?: string }[]> {
    const p = await this.call("acl/list/0.3", {});
    return (Array.isArray(p.entries) ? p.entries : []) as { subject: string; role: string; label?: string }[];
  }

  /** acl/grant/0.2 with a full-authority entry of `role` (the harness grants the wallet's DID `admin`). */
  async grant(subject: string, role: string, label: string, narrow = false): Promise<void> {
    // `narrow`: an entry that may act nowhere and holds no keys (the role a demoted manager is given; the VTA refuses to carry `act: all` onto the monitor role)
    const scopes = narrow ? { act: { scope: "none" }, keys: { scope: "none" } } : { act: { scope: "all" }, keys: { scope: "all" } };
    await this.call("acl/grant/0.2", { entry: { subject, role, ...scopes, capabilities: { scope: "ceiling" }, label }, reason: "keyring-wallet-vta-wire harness (the enrolment ceremony is not run)" });
  }

  /** Remove a policy row if there is one (a policy gate left by an earlier run also gates this operator's own grants). */
  async dropPolicy(id: string): Promise<void> {
    try {
      const got = await this.call("policy/get/0.1", { id });
      const version = (got.policy as { version?: number } | undefined)?.version;
      if (typeof version === "number") await this.call("policy/delete/0.1", { id, expectedVersion: version });
    } catch (e) {
      if (!/not.?found/i.test(`${(e as { code?: string }).code ?? ""} ${(e as Error).message}`)) throw e;
    }
  }

  async revoke(subject: string): Promise<void> {
    await this.call("acl/revoke/0.2", { subject, revocation: { kind: "entry" } });
  }
}
