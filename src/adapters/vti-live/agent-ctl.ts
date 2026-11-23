// SPDX-License-Identifier: Apache-2.0
// The control interface the in-process AGENT adapter (src/adapters/vti-inprocess/adapter.ts, consent.ts; `controlUrl`) expects from its host, served over a LIVE
// vta container instead. Every route is answered with what the real service offers, or refused with the reason (a refusal is the finding). Nothing in VTI is changed.
//   info      the service's DID, door, DID document (the log it serves) and the ACL entries that are the deployment's own (`aclIgnore`: the kit's administrator and app)
//   token     a REAL login (auth/challenge, auth/authenticate/0.3 over the door, signed by the DID's key); the ACL entry first, on the wire as the kit's administrator
//             (`acl/grant/0.2`) or, when the grant is gated or refused, offline (`vta acl create` on the stopped daemon). Keys the suite holds only (known.ts): class D
//   policy    `policy.enforcement` and `[policy.approver_sets]` of the config file in the data volume (what an operator edits), then a restart; the rule itself is written
//             over the wire by consent.ts. Idempotent: a call that changes nothing restarts nothing (the adapter probes with `enforce {on:false}` and `policy {}`).
//   reset     the data volume restored from the snapshot taken once after set-up (same identity, config and ACL as booted)
//   restart   stop and start with the volume kept
//   observe credentials: not readable on the wire here (0, class D); pushed, verify, trust-verifier: not offered (a live VTA without a mediator pushes nothing observable)
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
const stamp = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");

export interface AgentCtlConfig {
  dock: Dock;
  baseUrl: string;
  /** The kit's administrator file (`.vta/admin.json`). */
  adminFile: string;
  /** The role given to a DID that asks for a token without naming one. */
  defaultRole?: string;
}

/** Rewrite the `[policy]` settings of a config.toml text: enforcement, and the approver sets (when given). */
export function editPolicy(toml: string, p: { enforcement?: boolean; approverSets?: Record<string, string[]> }): string {
  let out = toml;
  if (p.enforcement !== undefined) {
    if (/^enforcement\s*=.*$/m.test(out)) out = out.replace(/^enforcement\s*=.*$/m, `enforcement = ${p.enforcement}`);
    else out = out.replace(/^\[policy\]\s*$/m, `[policy]\nenforcement = ${p.enforcement}`);
  }
  if (p.approverSets !== undefined) {
    const lines = Object.entries(p.approverSets).map(([k, v]) => `${k} = [${v.map((d) => JSON.stringify(d)).join(", ")}]`).join("\n");
    // the table header, then its entries up to the next table header or the end
    out = out.replace(/^\[policy\.approver_sets\][^\n]*\n(?:(?!\[)[^\n]*\n?)*/m, `[policy.approver_sets]\n${lines}\n\n`);
  }
  return out;
}

export class AgentCtl {
  private readonly c: AgentCtlConfig;
  private readonly known = knownSigners();
  private tokens = new Map<string, { token: string; at: number }>();
  private acls = new Set<string>();
  private adminToken: { token: string; at: number } | undefined;
  private vtaDid = "";
  private didDocument: Record<string, unknown> | undefined;
  private snapshotted = false;
  private enforcement = false;
  constructor(c: AgentCtlConfig) {
    this.c = c;
  }

  private admin(): Ed25519Signer {
    const j = JSON.parse(readFileSync(this.c.adminFile, "utf8")) as { did: string; privateKeyMultibase: string };
    const raw = fromMultibase(j.privateKeyMultibase);
    const s = ed25519Signer(raw.length === 32 ? raw : raw.slice(raw.length - 32));
    if (s.did !== j.did) throw new Error("the kit's admin.json key does not derive its DID");
    return s;
  }

  /** One signed task to the door, with an optional bearer; waits out an HTTP 429. */
  async call(signer: Ed25519Signer, type: string, payload: Record<string, unknown>, bearer?: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const now = Date.now();
    const doc = signDocument({ id: `urn:uuid:${randomUUID()}`, type, issuer: signer.did, recipient: this.vtaDid, issuedAt: stamp(now), payload }, signer, { created: now });
    const send = (): Promise<Response> => fetch(`${this.c.baseUrl}/trust-tasks`, { method: "POST", headers: { "content-type": "application/json", ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }) }, body: JSON.stringify(doc), signal: AbortSignal.timeout(30_000) });
    let r = await send();
    for (let i = 0; i < 40 && r.status === 429; i++) {
      await new Promise((ok) => setTimeout(ok, Math.max(1, Number(r.headers.get("retry-after")) || 2) * 1000));
      r = await send();
    }
    let body: Record<string, unknown> = {};
    try { const j = JSON.parse(await r.text()) as unknown; if (isObject(j)) body = j; } catch { /* not JSON */ }
    return { status: r.status, body };
  }

  /** The real login of `signer`: challenge, then authenticate, no bearer. */
  async login(signer: Ed25519Signer): Promise<string> {
    const ch = await this.call(signer, `${TT}auth/challenge/0.1`, { subject: signer.did });
    const cp = ch.body.payload as { challenge?: string; sessionId?: string } | undefined;
    if (cp?.challenge === undefined) throw new Error(`login: no challenge for ${signer.did} (HTTP ${ch.status}: ${JSON.stringify(ch.body).slice(0, 240)})`);
    const au = await this.call(signer, `${TT}auth/authenticate/0.3`, { challenge: cp.challenge, sessionId: cp.sessionId });
    const tok = (au.body.payload as { tokens?: { accessToken?: string } } | undefined)?.tokens?.accessToken;
    if (tok === undefined) throw new Error(`login: ${signer.did} was not authenticated (HTTP ${au.status}: ${JSON.stringify(au.body).slice(0, 240)})`);
    return tok;
  }

  private async adminBearer(): Promise<string> {
    if (this.adminToken !== undefined && Date.now() - this.adminToken.at < 600_000) return this.adminToken.token;
    const token = await this.login(this.admin());
    this.adminToken = { token, at: Date.now() };
    return token;
  }

  async load(): Promise<void> {
    if (this.vtaDid !== "") return;
    const log = await (await fetch(`${this.c.baseUrl}/.well-known/did.jsonl`)).text();
    const last = JSON.parse(log.split("\n").filter((l) => l.trim() !== "").at(-1) ?? "{}") as { state?: Record<string, unknown> };
    this.didDocument = last.state;
    this.vtaDid = String(last.state?.id ?? "");
    if (this.vtaDid === "") throw new Error("the VTA's did.jsonl has no readable last entry");
    const cfg = await this.c.dock.edit("cat /d/config.toml").catch(() => "");
    this.enforcement = /^enforcement\s*=\s*true/m.test(cfg);
  }

  /** Give `did` an ACL entry of `role`: on the wire as the kit's administrator, else offline. */
  private async ensureAcl(did: string, role: string): Promise<void> {
    if (this.acls.has(did)) return;
    const entry = role === "admin"
      ? { subject: did, role, act: { scope: "all" }, keys: { scope: "all" }, capabilities: { scope: "ceiling" }, label: "ttc-live" }
      : { subject: did, role, act: { scope: "none" }, keys: { scope: "none" }, capabilities: { scope: "ceiling" }, label: "ttc-live" };
    let ok = false;
    let why = "";
    try {
      const r = await this.call(this.admin(), `${TT}acl/grant/0.2`, { entry, reason: "live-container ceremony row" }, await this.adminBearer());
      ok = String(r.body.type ?? "").endsWith("#response") || (r.body.payload as { code?: string } | undefined)?.code?.includes("alreadyExists") === true;
      if (!ok) why = `HTTP ${r.status} ${JSON.stringify(r.body.payload ?? r.body).slice(0, 900)}`;
    } catch (e) { why = (e as Error).message; }
    if (!ok) {
      const d = this.c.dock;
      await d.stop();
      try { await d.offline(["acl", "create", "--did", did, "--role", role, "--label", "ttc-live"]); } catch (e) { throw new Error(`acl entry for ${did}: the grant on the wire failed (${why}) and the offline command failed (${(e as Error).message.slice(-200)})`); } finally { await d.start(); }
      await d.waitHealthy(this.c.baseUrl);
    }
    this.acls.add(did);
  }

  private async bearerFor(did: string, role: string): Promise<string> {
    const hit = this.tokens.get(did);
    if (hit !== undefined && Date.now() - hit.at < 600_000) return hit.token;
    const s = this.known.get(did);
    if (s === undefined || s.did !== did) throw new Error(`token: no key held for ${did}; a session cannot be had through the harness (class D)`);
    await this.ensureAcl(did, role);
    const token = await this.login(s);
    this.tokens.set(did, { token, at: Date.now() });
    return token;
  }

  /**
   * The identities a scenario may send from, given their entries while `acl/grant` is still open: a sealed VTA has no offline command, and with the gate on a grant is itself held
   * for consent. The administrators of the adapter first (the operator and the requester of the gated task), then the reference parties, the wallet's stand-in keys and the approvers named.
   */
  private async provisionBeforeGate(sets: Record<string, string[]> | undefined): Promise<void> {
    const role = this.c.defaultRole ?? "monitor";
    for (const n of [0x1a, 0x1c]) await this.ensureAcl(ed25519Signer(new Uint8Array(32).fill(n)).did, "admin");
    const seeds = [0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x47, 0x4b, 0x5c, 0x61, 0x62, 0x63, 0x64, 0x65, ...Array.from({ length: 16 }, (_, i) => 0x70 + i)];
    for (const n of seeds) await this.ensureAcl(ed25519Signer(new Uint8Array(32).fill(n)).did, role);
    for (const dids of Object.values(sets ?? {})) for (const d of dids) if (this.known.has(d)) await this.ensureAcl(d, role);
  }

  private async restartVta(): Promise<void> {
    const d = this.c.dock;
    await d.stop();
    await d.start();
    await d.waitHealthy(this.c.baseUrl);
    this.adminToken = undefined;
  }

  /** The restart reset's clean-up on the wire (gate off): every ACL entry whose subject is a key the suite holds is revoked, so a scenario starts without the previous one's grants or its stand-in logins. The kit's own entries are kept. */
  private async revokeSuiteEntries(): Promise<void> {
    const keep = this.admin().did;
    const known = knownSigners();
    const bearer = await this.adminBearer();
    const listed = await this.call(this.admin(), `${TT}acl/list/0.3`, {}, bearer);
    const entries = isObject(listed.body.payload) && Array.isArray((listed.body.payload as { entries?: unknown }).entries) ? ((listed.body.payload as { entries: unknown[] }).entries).filter(isObject) : [];
    for (const e of entries) {
      const subject = String(e.subject ?? "");
      if (subject === keep || !known.has(subject)) continue;
      await this.call(this.admin(), `${TT}acl/revoke/0.2`, { subject, revocation: { kind: "entry" } }, bearer);
    }
    this.acls = new Set();
  }

  private async editConfig(p: { enforcement?: boolean; approverSets?: Record<string, string[]> }): Promise<void> {
    const d = this.c.dock;
    await d.stop();
    try {
      const cur = await d.edit("cat /d/config.toml");
      const next = editPolicy(cur, p);
      if (next !== cur) await d.edit(`cat > /d/config.toml <<'__TTC_EOF__'\n${next}__TTC_EOF__`);
    } finally {
      await d.start();
    }
    await d.waitHealthy(this.c.baseUrl);
    this.adminToken = undefined;
  }

  async prepare(): Promise<void> {
    await this.load();
    if (this.snapshotted) return;
    if (process.env.LIVE_RESET !== "restart" && !existsSync(`${this.c.dock.cfg.snapshotDir}/data.tgz`)) {
      await this.c.dock.stop();
      try { await this.c.dock.snapshot(); } finally { await this.c.dock.start(); }
      await this.c.dock.waitHealthy(this.c.baseUrl);
    }
    this.snapshotted = true;
  }

  async handle(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.load();
    switch (path) {
      case "info":
        await this.prepare();
        return { baseUrl: this.c.baseUrl, vtaDid: this.vtaDid, didDocument: this.didDocument, live: true, aclIgnore: [this.admin().did] };
      case "token": {
        const did = String(body.did);
        return { token: await this.bearerFor(did, String(body.role ?? this.c.defaultRole ?? "monitor")) };
      }
      case "policy": {
        const sets = isObject(body.approverSets) ? (body.approverSets as Record<string, string[]>) : undefined;
        const enf = typeof body.enforcement === "boolean" ? body.enforcement : undefined;
        if (sets === undefined && enf === undefined) return { ok: true };
        // the approvers get their entries and sessions BEFORE the gate is on: once it is, an `acl/grant` is itself held for consent
        if (sets !== undefined || enf === true) await this.provisionBeforeGate(sets);
        await this.editConfig({ ...(enf === undefined ? {} : { enforcement: enf }), ...(sets === undefined ? {} : { approverSets: sets }) });
        if (enf !== undefined) this.enforcement = enf;
        return { ok: true };
      }
      case "enforce": {
        const on = body.on === true;
        if (on === this.enforcement) return { ok: true, unchanged: true };
        // as in `policy`: the suite's identities get their entries before the gate is on, since a grant is itself held for step-up afterwards (and the offline command is refused once the service is sealed)
        if (on) await this.provisionBeforeGate(undefined);
        await this.editConfig({ enforcement: on });
        this.enforcement = on;
        return { ok: true };
      }
      case "restart":
        await this.restartVta();
        return { baseUrl: this.c.baseUrl, vtaDid: this.vtaDid };
      case "reset": {
        await this.prepare();
        const d = this.c.dock;
        // LIVE_RESET=restart (the one-stack run): the state stays in place (ACL entries, rules, sessions are the service's); the one thing a scenario must not inherit, the
        // consent gate, is switched off in the config as part of the single restart, and the next login is made again. Default: the snapshot is restored.
        if (process.env.LIVE_RESET === "restart") {
          await this.editConfig({ enforcement: false }); // one stop and start; the config line is only written when it differs
          await this.revokeSuiteEntries();
          this.tokens = new Map();
          this.enforcement = false;
          return { baseUrl: this.c.baseUrl, vtaDid: this.vtaDid };
        }
        await d.stop();
        try { await d.restore(); } finally { await d.start(); }
        await d.waitHealthy(this.c.baseUrl);
        this.tokens = new Map();
        this.acls = new Set();
        this.adminToken = undefined;
        this.enforcement = false;
        return { baseUrl: this.c.baseUrl, vtaDid: this.vtaDid };
      }
      case "observe":
        if (body.kind === "credentials") return { value: 0, unobserved: true };
        return { error: `observe ${String(body.kind)}: not readable on a live service` };
      case "pushed":
        return { pushes: [], unobservable: true };
      case "shutdown":
        return { ok: true };
      case "verify": case "trust-verifier": case "stepup":
        return { error: `${path}: a live service has no such entry (class D)` };
      default:
        return { error: `unknown control route ${path}` };
    }
  }
}
