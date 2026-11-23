// SPDX-License-Identifier: Apache-2.0
// The control interface the community adapter (src/adapters/vti/adapter.ts, `controlUrl`) expects from its host, served over a LIVE vtc container
// instead of the in-process host. Each route is answered with what the real service offers, or refused with the reason (a refusal is the finding,
// never a pretended answer). Nothing in VTI is changed; a route either uses the service's own door and its operator commands, or is not offered.
//   info      the service's DID, door and public URL, and its DID document from the log it serves (a did:webvh, not the host's did:key)
//   seed      an ACL entry (`vtc acl add` on the stopped daemon) and, for a member, a member record made the way the service makes one: the DID applies
//             and the community's administrator (the kit's, whose key the kit wrote) approves. Known keys only (known.ts).
//   observe   joinRequests: the administrator's own listing; nothing else is readable
//   reset     the data volume restored from the snapshot taken once after set-up (same identity, no members beyond the pre-seeded ones)
//   verify, resolve, pushed, stepup, defaults: not offered by a live service (class D; the scenario that needs one says so)
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { ed25519Signer } from "../../crypto/didkey.ts";
import type { Ed25519Signer } from "../../crypto/didkey.ts";
import { fromMultibase } from "../../crypto/base58.ts";
import { signDocument } from "../../crypto/proof.ts";
import { isObject } from "../../util/json.ts";
import { Dock } from "./docker.ts";
import { knownSigners } from "./known.ts";

const TT = "https://trusttasks.org/spec/";
const J = `${TT}vtc/join-requests/`;
const stamp = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");

export interface CommunityCtlConfig {
  dock: Dock;
  /** The door's origin, for example http://127.0.0.1:18400. */
  baseUrl: string;
  /** The kit's administrator file (`.vta/admin.json`): the community's own administrator, whose key the kit wrote. */
  adminFile: string;
  /** Identities to make members before the snapshot is taken (the harness's own), as [seed byte, role]. */
  preseed?: readonly (readonly [number, string])[];
}

/** The DID document with every service endpoint that starts with `from` (the door's origin) moved to `to` (the public origin); `from` is matched with localhost and 127.0.0.1 alike. */
export function republish(doc: Record<string, unknown>, from: string, to: string): Record<string, unknown> {
  if (from === to) return doc;
  const hosts = (o: string): string[] => { const u = new URL(o); const alt = u.hostname === "127.0.0.1" ? "localhost" : u.hostname === "localhost" ? "127.0.0.1" : u.hostname; return [`${u.protocol}//${u.host}`, `${u.protocol}//${alt}${u.port === "" ? "" : `:${u.port}`}`]; };
  const olds = hosts(from);
  const service = Array.isArray(doc.service) ? (doc.service as Record<string, unknown>[]).map((sv) => {
    const e = sv.serviceEndpoint;
    const hit = typeof e === "string" ? olds.find((o) => e === o || e.startsWith(`${o}/`)) : undefined;
    return hit === undefined ? sv : { ...sv, serviceEndpoint: `${to.replace(/\/$/, "")}${(e as string).slice(hit.length)}` };
  }) : doc.service;
  return { ...doc, service };
}

export class CommunityCtl {
  private readonly c: CommunityCtlConfig;
  private readonly known = knownSigners();
  private seeded = new Set<string>();
  private vtcDid = "";
  private didDocument: Record<string, unknown> | undefined;
  private publicUrl = "";
  private snapshotted = false;
  constructor(c: CommunityCtlConfig) {
    this.c = c;
  }

  private admin(): Ed25519Signer {
    const j = JSON.parse(readFileSync(this.c.adminFile, "utf8")) as { did: string; privateKeyMultibase: string };
    const raw = fromMultibase(j.privateKeyMultibase);
    const seed = raw.length === 32 ? raw : raw.slice(raw.length - 32);
    const s = ed25519Signer(seed);
    if (s.did !== j.did) throw new Error("the kit's admin.json key does not derive its DID");
    return s;
  }

  /** One signed task to the door. */
  async call(signer: Ed25519Signer, type: string, payload: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
    const now = Date.now();
    const doc = signDocument({ id: `urn:uuid:${randomUUID()}`, type, issuer: signer.did, recipient: this.vtcDid, issuedAt: stamp(now), payload }, signer, { created: now });
    let r = await fetch(`${this.c.baseUrl}/v1/trust-tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(doc), signal: AbortSignal.timeout(30_000) });
    // the door charges a signer with no entry to a per-address budget (10 documents, then one every 5 s): wait it out, as the live adapter does (HTTP 429, Retry-After)
    for (let i = 0; i < 40 && r.status === 429; i++) {
      await new Promise((ok) => setTimeout(ok, (Number(r.headers.get("retry-after")) || 5) * 1000));
      r = await fetch(`${this.c.baseUrl}/v1/trust-tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(doc), signal: AbortSignal.timeout(30_000) });
    }
    const text = await r.text();
    let body: Record<string, unknown> = {};
    try { const j = JSON.parse(text) as unknown; if (isObject(j)) body = j; } catch { /* not JSON */ }
    return { status: r.status, body };
  }

  /** Read the service's identity and DID document from its public door. */
  async load(): Promise<void> {
    if (this.vtcDid !== "") return;
    const h = (await (await fetch(`${this.c.baseUrl}/health`)).json()) as { vtc_did?: string };
    this.vtcDid = String(h.vtc_did);
    const log = await (await fetch(`${this.c.baseUrl}/.well-known/did.jsonl`)).text();
    const last = JSON.parse(log.split("\n").filter((l) => l.trim() !== "").at(-1) ?? "{}") as { state?: Record<string, unknown> };
    this.didDocument = last.state;
    const cfg = await this.c.dock.edit("cat /d/config.toml").catch(() => "");
    this.publicUrl = /public_url\s*=\s*"([^"]+)"/.exec(cfg)?.[1] ?? this.c.baseUrl;
    // Class D: the kit mints the DID document with http service endpoints at its own address; the config's public_url is edited to https (the origin the service checks)
    // and the document handed to the ceremony is read as the community would publish it after the transport change its own docs describe
    // (`did-log install`, which needs the VTA that manages the DID): the endpoints on the door's origin move to the public origin. Keys and the DID are untouched.
    this.didDocument = this.didDocument === undefined ? undefined : republish(this.didDocument, this.c.baseUrl, this.publicUrl);
  }

  /** ACL entry on the stopped daemon, then the daemon back up. */
  private async acl(entries: readonly { did: string; role: string; label: string }[]): Promise<void> {
    const d = this.c.dock;
    await d.stop();
    try {
      for (const e of entries) await d.offline(["acl", "add", "--did", e.did, "--role", e.role, "--label", e.label]);
    } finally {
      await d.start();
    }
    await d.waitHealthy(this.c.baseUrl);
  }

  /** A member record, the way the service makes one: the DID applies under the review criterion and the administrator approves. */
  private async makeMember(did: string): Promise<number> {
    const s = this.known.get(did);
    if (s === undefined || s.did !== did) throw new Error(`seed: no key held for ${did}; a member record cannot be made through the harness (class D)`);
    const man = await this.call(s, `${J}manifest/0.4`, {});
    const crit = (Array.isArray((man.body.payload as { criteria?: unknown[] } | undefined)?.criteria) ? (man.body.payload as { criteria: Record<string, unknown>[] }).criteria : []).find((x) => x.id === "review");
    const sub = await this.call(s, `${J}submit/0.3`, { vp: { "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiablePresentation"], holder: did, verifiableCredential: [] }, registryConsent: false, criterion: String(crit?.requirementsDigest ?? "") });
    if ((sub.body.payload as { code?: string } | undefined)?.code === "vtc/join-requests/submit:alreadyMember") return 0;
    const rid = (sub.body.payload as { requestId?: string } | undefined)?.requestId;
    if (typeof rid !== "string") throw new Error(`seed: ${did} could not apply (HTTP ${sub.status}: ${JSON.stringify(sub.body).slice(0, 200)})`);
    const dec = await this.call(this.admin(), `${J}decide/0.1`, { id: rid, decision: "approved" });
    if (!String(dec.body.type ?? "").endsWith("#response")) throw new Error(`seed: the administrator's approval of ${did} was refused (HTTP ${dec.status}: ${JSON.stringify(dec.body).slice(0, 200)})`);
    return 1;
  }

  private preseedKeys(): string[] {
    return (this.c.preseed ?? []).map(([n, r]) => `${ed25519Signer(new Uint8Array(32).fill(n)).did}|${r}`);
  }

  /** Make the pre-seeded identities and take the snapshot every `reset` restores. Idempotent; an existing snapshot (data.tgz in the snapshot directory) is kept, so one directory belongs to one fresh stack. */
  async prepare(): Promise<void> {
    await this.load();
    if (this.snapshotted) return;
    if (existsSync(`${this.c.dock.cfg.snapshotDir}/data.tgz`)) { this.snapshotted = true; this.seeded = new Set(this.preseedKeys()); return; }
    const entries = (this.c.preseed ?? []).map(([n, role]) => ({ did: ed25519Signer(new Uint8Array(32).fill(n)).did, role, label: `ttc-live-${n.toString(16)}` }));
    // an approved join writes the member's own ACL entry (role member); an offline entry is only for a role a join does not give (admin)
    const offline = entries.filter((e) => e.role !== "member");
    if (offline.length > 0) await this.acl(offline);
    for (const e of entries) if (e.role === "member") await this.makeMember(e.did);
    for (const e of entries) this.seeded.add(`${e.did}|${e.role}`);
    await this.c.dock.stop();
    try { await this.c.dock.snapshot(); } finally { await this.c.dock.start(); }
    await this.c.dock.waitHealthy(this.c.baseUrl);
    this.snapshotted = true;
  }

  async handle(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.load();
    switch (path) {
      case "info":
        await this.prepare();
        return { baseUrl: this.c.baseUrl, vtcDid: this.vtcDid, publicUrl: this.publicUrl, didDocument: this.didDocument, live: true };
      case "seed": {
        const did = String(body.did), role = String(body.role);
        if (this.seeded.has(`${did}|${role}`)) return { ok: true, already: true };
        let added = 0;
        if (role === "member") added = await this.makeMember(did);
        else await this.acl([{ did, role, label: String(body.label ?? "ttc-live") }]);
        this.seeded.add(`${did}|${role}`);
        return { ok: true, ...(added > 0 ? { joinRequests: { approved: added } } : {}) };
      }
      case "resolve":
        // the live community resolves a holder by the DID alone: a did:key carries no service, so it cannot plan a push to it (class D; nothing to inject)
        return { ok: true, injected: false };
      case "observe": {
        if (body.kind !== "joinRequests") return { error: `observe ${String(body.kind)}: not readable on a live service` };
        let n = 0;
        for (const st of ["pending", "approved", "rejected", "withdrawn", "deferred"]) {
          const r = await this.call(this.admin(), `${J}list/0.2`, { status: st });
          const items = (r.body.payload as { items?: unknown[] } | undefined)?.items;
          if (Array.isArray(items)) n += items.length;
        }
        return { value: n };
      }
      case "pushed":
        // the push engine's records are in the service's store, not on its wire, and a live service without a mediator plans no push to a did:key
        return { pushes: [], unobservable: true };
      case "reset": {
        const d = this.c.dock;
        await this.prepare();
        // LIVE_RESET=restart: one container restart with the state left in place (the one-stack run, no snapshot restore); default: restore the snapshot
        if (process.env.LIVE_RESET === "restart") await d.restart();
        else {
          await d.stop();
          try { await d.restore(); } finally { await d.start(); }
        }
        await d.waitHealthy(this.c.baseUrl);
        this.seeded = new Set(this.preseedKeys());
        return { ok: true };
      }
      case "shutdown":
        return { ok: true };
      case "verify": case "stepup": case "defaults":
        return { error: `${path}: a live service has no such entry (class D)` };
      default:
        return { error: `unknown control route ${path}` };
    }
  }
}
