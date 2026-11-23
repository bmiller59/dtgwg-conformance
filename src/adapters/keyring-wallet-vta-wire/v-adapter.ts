// SPDX-License-Identifier: Apache-2.0
// The V participant of the keyring-wallet-vta-wire row: the live VTA container as the agent of a ceremony. Its state is read and configured through an
// operator identity over REST (class D, see operator.ts); a document handed to `send` (a replay, a tampered copy) travels over the wallet's wire, as the
// wallet's DID: the only identity that has keys on that wire. A document from any other identity is refused as not carried by this row, never faked.
import type { Adapter, Capabilities, ConnectResult, DeclareGovernanceResult, InitiateResult, ObserveQuery, ObserveResult, ProvisionedRole, SendParams, SendResult } from "../../adapter/contract.ts";
import { vCapabilities } from "./wire-caps.ts";
import type { WireInfo } from "./wire-caps.ts";
import type { Operator } from "./operator.ts";
import { VtaConsentDriver, KVC_KINDS, POLICY_UPSERT_TYPE } from "../vti-inprocess/consent.ts";
import type { Door } from "../vti-inprocess/consent.ts";
import { seedOf } from "../../crypto/didkey.ts";
import { APPROVALS_POLICY_ID, approvalsUpsertPayload } from "./approvals-row.ts";

export type HostCall = (method: string, params?: unknown) => Promise<any>;
const unsupported = (what: string): Error => new Error(`not offered by the wire row: ${what}`);
const POLICY_ID = "ceremony-step-up";

export class VWireAdapter implements Adapter {
  private readonly host: HostCall;
  private readonly op: Operator;
  private readonly vtaDid: string;
  private readonly info: Omit<WireInfo, "vtaTypes">;
  private walletDid = "";
  private baseline: Set<string> | undefined;
  private baselineRoles = new Map<string, string>();
  private types: string[] | undefined;
  private policyVersion = 0;
  /** The pause between two vault reads (a test sets it to 0). */
  settleMs = 700;
  /** FC-KVC: the executor track (the VTA's own gate, signed requests and decision handler; the requester is a harness identity over REST, class D). */
  private readonly consent: VtaConsentDriver;
  private requester: Operator | undefined;
  /** How long a pushed consent request may take to reach the wallet over the wire. */
  pushWaitMs = 12000;

  constructor(host: HostCall, op: Operator, vtaDid: string, info: Omit<WireInfo, "vtaTypes">) {
    this.host = host;
    this.op = op;
    this.vtaDid = vtaDid;
    this.info = info;
    // a live VTA keeps an approval for a payload until it is consumed: each run picks its own grantees, so an earlier run's approval cannot execute this run's gated task
    this.consent = new VtaConsentDriver(this.door(), { granteeBase: 0x20 + Math.floor(Math.random() * 0x40) });
  }

  /** The consent driver's door onto the live VTA: REST for the requester and the operator, the approvals row for the deployment's approver sets (written over the wire's own `policy/upsert`). */
  private door(): Door {
    return {
      vtaDid: async () => this.vtaDid,
      // the host's `/ctl/policy` of the in-process row: enforcement is already on in this stack (the starter's approvals seed); the approver sets are the approvals row
      ctl: async (_path, body) => {
        const sets = (body as { approverSets?: Record<string, string[]> } | undefined)?.approverSets;
        if (sets !== undefined) await this.writeApprovals(sets);
        return {};
      },
      post: async (bytes, from) => {
        if (from.kind !== "actor") throw unsupported("a requester without an identity");
        const r = await this.requesterOp().sendDocument(JSON.parse(bytes) as Record<string, unknown>);
        return { replies: r.text === "" ? [] : [r.text], transport: { kind: r.text === "" ? "none" : "document", status: r.status }, quiescentAfterMs: 0 };
      },
      operator: async (type, payload) => this.op.call(type, type === POLICY_UPSERT_TYPE && payload.expectedVersion === undefined ? { ...payload, expectedVersion: 0 } : payload),
    };
  }

  private requesterOp(): Operator {
    this.requester ??= this.op.as(seedOf(0x1c));
    return this.requester;
  }

  private async writeApprovals(sets: Record<string, string[]>): Promise<void> {
    let version = 0;
    try {
      const got = await this.op.call("policy/get/0.1", { id: APPROVALS_POLICY_ID });
      version = Number((got.policy as { version?: number } | undefined)?.version ?? 0);
    } catch (e) {
      if (!/not.?found/i.test(`${(e as { code?: string }).code ?? ""} ${(e as Error).message}`)) throw e;
    }
    await this.op.call("policy/upsert/0.3", approvalsUpsertPayload([], sets, version));
  }

  private async init(): Promise<void> {
    if (this.baseline !== undefined) return;
    await this.refreshWallet();
    let rows = await this.op.acl();
    // KW_WIRE_CLEAN_ACL=1 (a stack the harness owns): entries other than the operator's and the wallet's are leftovers of an earlier run and are removed, so the baseline is exact
    if (process.env.KW_WIRE_CLEAN_ACL === "1") {
      for (const r of rows) if (r.subject !== this.op.did && r.subject !== this.walletDid) await this.op.revoke(r.subject);
      rows = await this.op.acl();
    }
    // the baseline is what the deployment had before this adapter: the operator's own rows; the wallet's DID changes with every reset and is handled apart
    this.baseline = new Set(rows.map((r) => r.subject).filter((s) => s !== this.walletDid));
    this.baselineRoles = new Map(rows.filter((r) => r.subject !== this.walletDid).map((r) => [r.subject, r.role]));
  }

  /** The wallet's current manager DID (it is a new one after every reset of K). */
  private async refreshWallet(): Promise<void> {
    this.walletDid = String(((await this.host("provision", { roles: ["peer"] })) as { peer: { vid: string } }).peer.vid);
  }

  async capabilities(): Promise<Capabilities> {
    // what the agent serves, as its operator sees it (the wallet's identity changes with every reset and is not on the access list until V's reset grants it)
    if (this.types === undefined) {
      const d = await this.op.call("trust-task-discovery/0.3", {});
      this.types = (Array.isArray(d.supportedTypes) ? d.supportedTypes : []).map((t: unknown) => (typeof t === "string" ? t : String((t as { type?: unknown }).type ?? ""))).filter((t: string) => t !== "");
    }
    return vCapabilities({ ...this.info, vtaTypes: this.types });
  }

  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> {
    const out: Record<string, ProvisionedRole> = {};
    for (const r of roles) {
      if (r !== "peer" && r !== "iut") throw unsupported(`a harness actor ${r}: only the wallet's DID has keys on this wire`);
      out[r] = { vid: this.vtaDid, didDocument: { id: this.vtaDid }, transportAddress: "didcomm:mediator", keyCustody: "iut" };
    }
    await this.init();
    return out;
  }

  async trust(): Promise<void> { throw unsupported("trust"); }
  async setClock(): Promise<void> { throw unsupported("setClock (a real wire has real time)"); }
  async advance(): Promise<void> { throw unsupported("advance"); }
  async restart(): Promise<void> { throw unsupported("restart (the container is the deployment's)"); }
  async snapshot(): Promise<string> { throw unsupported("snapshot"); }
  async diff(): Promise<{ changed: boolean }> { throw unsupported("diff"); }
  async verifyProof(): Promise<{ valid: boolean }> { throw unsupported("verifyProof"); }
  async declareGovernance(): Promise<DeclareGovernanceResult> { return { status: "unsupported", reason: "the live VTA's policy is the deployment's" }; }
  /**
   * FC-KVC: the requester (a harness identity over REST) submits the gated task; the VTA refuses it for consent and PUSHES its signed request to the approver over the
   * mediator. The runner relays nothing: the wallet must receive the push itself (waited for here, bounded), so the request that the scenario's expectation reads is the one that
   * crossed the wire. A request for an outsider (a copy the VTA never sent) has no wire path and is refused as not offered.
   */
  async initiate(p: Parameters<VtaConsentDriver["initiate"]>[0]): Promise<InitiateResult> {
    await this.init();
    if (!KVC_KINDS.includes(p.kind)) throw unsupported(`initiate ${p.kind} (the agent starts nothing else in these scenarios)`);
    const r = await this.consent.initiate(p);
    if (p.kind === "consent-resubmit") return r;
    if (p.kind === "consent-request") throw unsupported("consent-request (a copy for a party the agent never asked has no wire path)");
    const id = r.documents[0] === undefined ? "" : String((JSON.parse(r.documents[0]) as { id?: string }).id);
    const t0 = Date.now();
    for (;;) {
      const got = (await this.host("wire.kvReceived")) as string[];
      if (got.some((t) => (JSON.parse(t) as { id?: string }).id === id)) return { threadId: r.threadId, documents: [], sent: true };
      if (Date.now() - t0 > this.pushWaitMs) return { threadId: r.threadId, documents: [], sent: true }; // not delivered: the expectation reads nothing at the wallet, and says so
      await new Promise((res) => setTimeout(res, 300));
    }
  }
  async connect(p?: { peer?: { vid?: string } }): Promise<ConnectResult> {
    if (p?.peer?.vid !== undefined) this.consent.connect(p.peer.vid);
    return { connected: true, detail: "the agent is reached through the wallet's session" };
  }

  /**
   * The cleanup between scenarios, after K has minted its new manager DID: the step-up gate is dropped first (it gates acl/grant for the operator too), every entry
   * that is neither the deployment's own nor the wallet's current DID is revoked (what the last scenario made, the wallet's earlier DIDs), the current DID is granted
   * the full admin entry the enrolment would have given it, and the vault is emptied.
   */
  async reset(): Promise<void> {
    await this.init();
    this.consent.reset();
    await this.op.dropPolicy("fc-kvc"); // the consent rule gates acl/grant for the operator's own restore below
    await this.dropPolicy();
    await this.refreshWallet();
    const rows = await this.op.acl();
    for (const r of rows) {
      if (this.baseline!.has(r.subject)) {
        if (this.baselineRoles.get(r.subject) !== r.role) {
          await this.op.revoke(r.subject);
          await this.op.grant(r.subject, String(this.baselineRoles.get(r.subject)), String(r.label ?? "restored"));
        }
      } else if (r.subject !== this.walletDid) await this.op.revoke(r.subject);
      else if (r.role !== "admin") await this.op.revoke(r.subject); // a demoted wallet (trigger actorRole): replaced below by the full entry
    }
    const kept = (await this.op.acl()).some((r) => r.subject === this.walletDid);
    if (!kept) await this.op.grant(this.walletDid, "admin", "keyring-wallet-vta-wire");
    await this.host("wire.vault", { op: "clear" });
  }

  private async dropPolicy(): Promise<void> {
    await this.op.dropPolicy(POLICY_ID);
  }

  async trigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }> {
    await this.init();
    if (action === "actorRole") {
      const vid = String(args.vid);
      const row = (await this.op.acl()).find((r) => r.subject === vid);
      if (row === undefined) throw new Error(`${vid} has no access-list entry to change the role of`);
      // `acl/change-role/0.2` carries the act scope across, and the VTA refuses `act: all` on the monitor role: the entry is replaced by one of the new role that acts nowhere
      await this.op.revoke(vid);
      await this.op.grant(vid, String(args.role), String(row.label ?? "demoted"), true);
      return { documents: [] };
    }
    if (action === "consentSetup") {
      // the requester is a harness identity with the admin role (so that only consent is missing); the rule and the approver set are the VTA's own policy surface
      await this.op.dropPolicy("fc-kvc");
      await this.dropPolicy();
      const req = this.requesterOp();
      if (!(await this.op.acl()).some((r) => r.subject === req.did)) await this.op.grant(req.did, "admin", "fc-kvc requester");
      await this.consent.setup(args);
      return { documents: [] };
    }
    if (action === "requireStepUp") {
      // An operator's policy (policy_gate.rs): the task type needs a step-up of the caller's session (acr aal2). Installed through the VTA's own policy/upsert.
      const type = `https://trusttasks.org/spec/${String(args.type)}`;
      const module = `package vta.policy\nimport rego.v1\ngated if input.request.typeUri == "${type}"\ndecision := {"decision": "requireStepUp"} if { gated; input.consumer.acr != "aal2" }\ndecision := {"decision": "allow"} if { gated; input.consumer.acr == "aal2" }\ndecision := {"decision": "allow"} if not gated`;
      await this.dropPolicy();
      await this.op.call("policy/upsert/0.3", { id: POLICY_ID, name: "ceremony step-up gate", module, priority: 100, enabled: true, expectedVersion: 0 });
      return { documents: [] };
    }
    throw unsupported(`trigger ${action}`);
  }

  async send(p: SendParams): Promise<SendResult> {
    await this.init();
    await this.refreshWallet();
    if (p.from.kind !== "actor" || p.from.vid !== this.walletDid) throw unsupported(`a document from ${p.from.kind === "none" ? "no identity" : p.from.vid}: only the wallet's DID has keys on this wire`);
    const r = (await this.host("wire.send", { bytes: p.bytes })) as { replies: string[] };
    return { replies: r.replies, transport: { kind: r.replies.length > 0 ? "document" : "none" }, quiescentAfterMs: 0 };
  }

  async observe(q: ObserveQuery): Promise<ObserveResult> {
    await this.init();
    if (q.query === "ceremony") {
      // a denial reaches the VTA over the wallet's wire, not through this adapter: the wallet's own record of the VTA's answer says it
      const denied = ((await this.host("wire.kvReplies")) as { thread: string; answer?: { status?: string } }[]).some((r) => r.answer?.status === "denied");
      const state = this.consent.ceremony(String(q.threadId));
      return denied && state.value === "held" ? { value: "aborted" } : state;
    }
    if (q.query === "received" && (q.type === undefined || q.type.includes("task-consent")) && Number(this.consent.received(q).value) > 0) return this.consent.received(q);
    if (q.query === "received") {
      const sent = ((await this.host("wire.sent")) as Record<string, any>[]).filter((d) => (q.type === undefined || d.type === q.type) && (q.threadId === undefined || d.threadId === q.threadId || d.id === q.threadId));
      return { value: sent.length, documents: sent.map((d) => JSON.stringify(d)) };
    }
    if (q.query === "stored") {
      const rows = await this.op.acl();
      if (q.kind === "acl-entry") return { value: rows.filter((r) => !this.baseline!.has(r.subject) && r.subject !== this.walletDid).length };
      if (q.kind.startsWith("acl-subject:")) return { value: rows.filter((r) => r.subject === q.kind.slice(12)).length };
      if (q.kind.startsWith("acl-label:")) { const [s, l] = q.kind.slice(10).split("|"); return { value: rows.filter((r) => r.subject === s && r.label === l).length }; }
      if (q.kind === "credential") return { value: await this.credentialCount() };
      if (q.kind === "ceremony-effect") return { value: await this.consent.effectsAny() };
      return { value: 0 };
    }
    throw unsupported(`observe ${q.query}`);
  }

  /** The credentials the agent's vault holds for the wallet's identity (the vault is the caller's own: read through the wallet's session, the VTA's answer is what is counted). */
  private async credentialCount(): Promise<number> {
    // read until two reads in a row agree (the vault answered 0 once, right after a completed keep, in a run: a stored card may not be visible to the next query at once)
    let last = Number(((await this.host("wire.vault", { op: "count" })) as { count: number }).count);
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, this.settleMs));
      const now = Number(((await this.host("wire.vault", { op: "count" })) as { count: number }).count);
      if (now === last) return now;
      last = now;
    }
    return last;
  }
}
