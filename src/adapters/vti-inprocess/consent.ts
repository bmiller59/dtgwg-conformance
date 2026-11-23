// SPDX-License-Identifier: Apache-2.0
// The ceremony track (docs/25, group FC-KVC) for the VTA's task-consent flow, driven over the VTA's own HTTPS door. The VTA is the EXECUTOR: its policy gate refuses a
// gated task with `auth:consent_required` and VTA-signed `task-consent/request` documents; an approver's `task-consent/decision/0.2` is verified by the VTA's own handler;
// the requester's re-submit executes the task once. What is the VTI's own: the gate, the signed requests, the decision handler, the grant, the execution. What is the
// harness (class D, stated in every result): (a) the requester, a harness identity that holds the `admin` role and submits the gated task (`acl/grant/0.3`); (b) the
// deployment's consent configuration (`policy.enforcement`, `policy.approver_sets`), set through the host's `/ctl/policy` because a VTA reads it from its config file and
// nothing on the wire sets it, while the rule itself is written over the wire with `policy/upsert/0.3`; (c) the carrier: the runner relays the requests the refusal
// carries (`details.consentRequests`) instead of the VTA's mediator push. When the host has no `/ctl/policy` (a host built before it existed) the gate cannot be switched on:
// the adapter then offers only the role `executor-leg`, which runs the decision leg alone against a request the harness stands in for (class D), and the VTA's answer to
// it is `noPending`: that shows the approver's real signature and document are verified and routed, and nothing more.
import { randomUUID } from "node:crypto";
import { ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import type { Ed25519Signer } from "../../crypto/didkey.ts";
import { signDocument } from "../../crypto/proof.ts";
import type { CeremonyState, InitiateParams, InitiateResult, ObserveResult, SendResult } from "../../adapter/contract.ts";
import { isObject } from "../../util/json.ts";

export const CONSENT_REQUEST_TYPE = "https://trusttasks.org/spec/task-consent/request/0.1";
export const CONSENT_DECISION_TYPE = "https://trusttasks.org/spec/task-consent/decision/0.2";
export const ACL_GRANT_TYPE = "https://trusttasks.org/spec/acl/grant/0.3";
export const ACL_LIST_TYPE = "https://trusttasks.org/spec/acl/list/0.4";
export const POLICY_UPSERT_TYPE = "https://trusttasks.org/spec/policy/upsert/0.3";
export const KVC_KINDS = ["consent-gate", "consent-request", "consent-resubmit"];
export const APPROVER_SET = "fc-kvc";
/** The requester of the gated task: a harness identity of the adapter (never a participant's), holding `admin` so that the VTA's own authorisation passes and only consent is missing. */
const REQUESTER_SEED = 0x1c;
const GRANTEE_SEED_BASE = 0x90;

/** What the driver needs from the adapter that owns the door: a thin interface, so the driver is testable against a stub of the door. */
export interface Door {
  vtaDid(): Promise<string>;
  ctl(path: string, body?: unknown): Promise<Record<string, unknown>>;
  post(bytes: string, from: { kind: "actor"; vid: string } | { kind: "none" }, role?: string): Promise<SendResult>;
  operator(type: string, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
}

interface Held {
  thread: string;
  /** The gated task: its payload and the identity that will receive the effect. */
  grantee: Ed25519Signer;
  requests: Map<string, Record<string, unknown>>;
  digest: string;
  state: CeremonyState;
  /** Decision replies in order: `status` of a success, or the error code. */
  replies: { status?: string; code?: string }[];
  leg: boolean;
}
interface Inbox { from: string; type: string; threadId: string; text: string }

const parse = (t: string): Record<string, unknown> | undefined => {
  try {
    const v: unknown = JSON.parse(t);
    return isObject(v) ? v : undefined;
  } catch {
    return undefined;
  }
};
const stamp = (ms = Date.now()): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");

export class VtaConsentDriver {
  private readonly door: Door;
  private readonly peers = new Set<string>();
  private readonly held = new Map<string, Held>();
  private readonly alias = new Map<string, string>();
  private readonly inbox: Inbox[] = [];
  private approvers: string[] = [];
  private k = 1;
  private n = 0;
  /** Whether the host can switch the gate on (`/ctl/policy`); probed once. */
  private policy: boolean | undefined;

  /** First seed of the grantees (the identity the gated grant is for): fixed in-process; a live VTA keeps an approval for a payload until it is consumed, so a re-run there picks its own. */
  private readonly granteeBase: number;

  constructor(door: Door, opts: { granteeBase?: number } = {}) {
    this.door = door;
    this.granteeBase = opts.granteeBase ?? GRANTEE_SEED_BASE;
  }

  /** Does the host offer `/ctl/policy`? A host built before it existed answers HTTP 404 and the gate cannot be switched on. */
  async policyCapable(): Promise<boolean> {
    if (this.policy === undefined) {
      try {
        await this.door.ctl("policy", {});
        this.policy = true;
      } catch {
        this.policy = false;
      }
    }
    return this.policy;
  }

  reset(): void {
    this.peers.clear();
    this.held.clear();
    this.alias.clear();
    this.inbox.length = 0;
    this.approvers = [];
    this.k = 1;
  }

  connect(vid: string): void {
    this.peers.add(vid);
  }

  /** The deployment's consent policy: the approver set and k. Writes the rule over the wire (`policy/upsert/0.3`) and the configuration through the host. */
  async setup(args: Record<string, unknown>): Promise<void> {
    if (!(await this.policyCapable())) throw new Error("consentSetup: this host has no /ctl/policy (see the adapter header)");
    const approvers = args.approvers;
    if (!Array.isArray(approvers) || approvers.length === 0 || approvers.some((a) => typeof a !== "string")) throw new Error("consentSetup: args.approvers (identifiers) is required");
    const k = Number(args.minApprovals ?? 1);
    if (!Number.isInteger(k) || k < 1 || k > approvers.length) throw new Error(`consentSetup: minApprovals must be between 1 and ${approvers.length}`);
    this.approvers = approvers as string[];
    this.k = k;
    const rego = [
      "package vta.policy",
      "import rego.v1",
      `decision := {"decision": "requireConsent", "requireConsent": {"approverSet": "${APPROVER_SET}", "minApprovals": ${k}, "excludeRequester": false}} if { input.request.typeUri == "${ACL_GRANT_TYPE}" }`,
      `decision := {"decision": "allow", "explanation": "not a gated task"} if { input.request.typeUri != "${ACL_GRANT_TYPE}" }`,
    ].join("\n");
    // the rule first (enforcement is still off, so the write is not itself gated), then the configuration that switches the gate on
    await this.door.operator(POLICY_UPSERT_TYPE, { id: "fc-kvc", name: "FC-KVC consent for acl/grant", module: rego, priority: 100, enabled: true });
    await this.door.ctl("policy", { enforcement: true, approverSets: { [APPROVER_SET]: this.approvers } });
  }

  private requester(): Ed25519Signer {
    return ed25519Signer(seedOf(REQUESTER_SEED));
  }
  private grantee(n: number): Ed25519Signer {
    return ed25519Signer(seedOf(this.granteeBase + (n % 100)));
  }

  /** The gated task as the requester sends it: `acl/grant/0.3` for the grantee, a fresh envelope each time (the grant binds the payload, not the envelope id). */
  private async gatedTask(h: Held): Promise<SendResult> {
    const r = this.requester();
    const now = Date.now();
    const doc = signDocument({
      id: `urn:uuid:${randomUUID()}`, type: ACL_GRANT_TYPE, issuer: r.did, recipient: await this.door.vtaDid(), issuedAt: stamp(now),
      payload: { entry: { subject: h.grantee.did, role: "reader", act: { scope: "none" }, keys: { scope: "none" }, capabilities: { scope: "ceiling" }, purposes: { scope: "any" } } },
    }, r, { created: now });
    return this.door.post(JSON.stringify(doc), { kind: "actor", vid: r.did }, "admin");
  }

  async initiate(p: InitiateParams): Promise<InitiateResult> {
    if (!this.peers.has(p.to)) throw new Error(`initiate: not connected to ${p.to} (call connect first)`);
    if (p.kind === "consent-gate") return this.gate(p);
    if (p.kind === "consent-request") return this.request(p);
    if (p.kind === "consent-resubmit") return this.resubmit(p);
    throw new Error(`initiate: this adapter does not start ${p.kind}`);
  }

  private async gate(p: InitiateParams): Promise<InitiateResult> {
    const n = this.n++;
    const grantee = this.grantee(n);
    if (!(await this.policyCapable())) return this.standIn(p, grantee);
    if (this.approvers.length === 0) throw new Error("initiate consent-gate: call trigger consentSetup first");
    const h: Held = { thread: "", grantee, requests: new Map(), digest: "", state: "open", replies: [], leg: false };
    const res = await this.gatedTask(h);
    const body = res.replies[0] === undefined ? undefined : parse(res.replies[0]);
    const payload = body !== undefined && isObject(body.payload) ? body.payload : undefined;
    const details = payload !== undefined && isObject(payload.details) ? payload.details : undefined;
    const reqs = details !== undefined && Array.isArray(details.consentRequests) ? details.consentRequests : [];
    if (details?.reason !== "auth:consent_required" || reqs.length === 0) throw new Error(`consent-gate: the VTA did not refuse the gated task for consent (HTTP ${String(res.transport.status)}): ${(res.replies[0] ?? "").slice(0, 300)}`);
    for (const rq of reqs) if (isObject(rq) && typeof rq.recipient === "string") h.requests.set(rq.recipient, rq);
    h.digest = String(details.payloadDigest);
    const first = [...h.requests.values()][0]!;
    h.thread = String(first.id);
    h.state = "held";
    for (const rq of h.requests.values()) this.alias.set(String(rq.id), h.thread);
    this.held.set(h.thread, h);
    return this.deliver(h, p.to, p.thread ?? h.thread);
  }

  /** The decision leg alone: the VTA cannot raise a consent request on this host, so the request is the harness's (unsigned, fresh binding), class D. */
  private async standIn(p: InitiateParams, grantee: Ed25519Signer): Promise<InitiateResult> {
    const vta = await this.door.vtaDid();
    const challenge = `leg-challenge-${randomUUID()}`;
    const digest = `u${Buffer.from(randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "")).toString("base64url").slice(0, 43)}`;
    const doc = { id: `urn:uuid:${randomUUID()}`, type: CONSENT_REQUEST_TYPE, issuer: vta, recipient: p.to, issuedAt: stamp(),
      payload: { challenge, taskType: ACL_GRANT_TYPE, payloadDigest: digest, sideEffects: "mutating", exposure: { discloses: "none", actsAsSubject: false }, effects: [], requester: this.requester().did, approverSet: APPROVER_SET, minApprovals: 1, excludeRequester: false, expiresAt: stamp(Date.now() + 600_000) } };
    const h: Held = { thread: String(doc.id), grantee, requests: new Map([[p.to, doc]]), digest, state: "held", replies: [], leg: true };
    this.held.set(h.thread, h);
    return { threadId: h.thread, documents: [JSON.stringify(doc)], sent: false };
  }

  private deliver(h: Held, to: string, thread: string): InitiateResult {
    const mine = h.requests.get(to);
    if (mine !== undefined) {
      this.note({ from: String(mine.issuer), type: CONSENT_REQUEST_TYPE, threadId: h.thread, text: JSON.stringify(mine) }, false);
      // each approver's request is its own signed document with its own id and no shared thread member, so a receiver files it under its own id
      return { threadId: String(mine.id), documents: [JSON.stringify(mine)], sent: false };
    }
    // a party outside the set was never asked; the leaked copy (a harness stand-in, class D) is the first request re-addressed, its signature removed
    const first = [...h.requests.values()][0]!;
    const { proof: _p, ...rest } = first;
    void thread;
    return { threadId: h.thread, documents: [JSON.stringify({ ...rest, recipient: to })], sent: false };
  }

  private async request(p: InitiateParams): Promise<InitiateResult> {
    const h = this.heldOn(p.thread);
    return this.deliver(h, p.to, h.thread);
  }

  private heldOn(thread: string | undefined): Held {
    const h = thread === undefined ? undefined : this.held.get(this.alias.get(thread) ?? thread);
    if (h === undefined) throw new Error("no consent ceremony on that thread");
    return h;
  }

  /** The requester re-submits the same payload: the VTA executes it once when enough approvals were recorded. */
  private async resubmit(p: InitiateParams): Promise<InitiateResult> {
    const h = this.heldOn(p.thread);
    if (h.leg) throw new Error("consent-resubmit: a stand-in request has no task to re-submit");
    const res = await this.gatedTask(h);
    const body = res.replies[0] === undefined ? undefined : parse(res.replies[0]);
    const type = String(body?.type ?? "");
    this.note({ from: String(body?.issuer ?? ""), type, threadId: h.thread, text: res.replies[0] ?? "" }, true);
    if (res.transport.status === 200 && type === `${ACL_GRANT_TYPE}#response`) h.state = "completed";
    return { threadId: h.thread, documents: [], sent: true };
  }

  /** A document of the runner's relay that reached the VTA: record the VTA's reply to a decision. Called by the adapter after its own `send`. */
  afterSend(bytes: string, reply: SendResult): void {
    const doc = parse(bytes);
    if (doc === undefined || doc.type !== CONSENT_DECISION_TYPE || !isObject(doc.payload)) return;
    const digest = String(doc.payload.payloadDigest);
    const h = [...this.held.values()].find((x) => x.digest === digest);
    const rep = reply.replies[0] === undefined ? undefined : parse(reply.replies[0]);
    const pl = rep !== undefined && isObject(rep.payload) ? rep.payload : {};
    const isErr = String(rep?.type ?? "").includes("/trust-task-error/");
    const code = isErr ? String(pl.code ?? "error") : undefined;
    const status = !isErr && typeof pl.status === "string" ? pl.status : undefined;
    if (h === undefined) return;
    h.replies.push({ ...(code === undefined ? {} : { code }), ...(status === undefined ? {} : { status }) });
    if (status === "denied") h.state = "aborted";
    else if (h.leg && code !== undefined) h.state = "refused";
    this.note({ from: String(doc.issuer), type: String(doc.type), threadId: h.thread, text: bytes }, false);
  }

  private note(e: Inbox, _out: boolean): void {
    this.inbox.push(e);
  }

  received(q: { from?: string; type?: string; threadId?: string }): ObserveResult {
    const t = q.threadId === undefined ? undefined : (this.alias.get(q.threadId) ?? q.threadId);
    const docs = this.inbox.filter((e) => (q.from === undefined || e.from === q.from) && (q.type === undefined || e.type === q.type) && (t === undefined || e.threadId === t)).map((e) => e.text);
    return { value: docs.length, documents: docs };
  }

  ceremony(thread: string): ObserveResult {
    const h = this.held.get(this.alias.get(thread) ?? thread);
    return { value: h === undefined ? "unknown" : h.state };
  }

  /** The effect: how many times the gated task ran. Read from the VTA itself (the ACL the operator lists), never from the adapter's own record of a re-submit. */
  async effects(thread: string): Promise<number> {
    const h = this.held.get(this.alias.get(thread) ?? thread);
    if (h === undefined || h.leg) return 0;
    const r = await this.door.operator(ACL_LIST_TYPE, {});
    return JSON.stringify(r).split(h.grantee.did).length - 1 > 0 ? 1 : 0;
  }

  /** The newest held ceremony (the `stored` observation names no thread). */
  async effectsAny(): Promise<number> {
    let n = 0;
    for (const h of this.held.values()) n += await this.effects(h.thread);
    return n;
  }
}
