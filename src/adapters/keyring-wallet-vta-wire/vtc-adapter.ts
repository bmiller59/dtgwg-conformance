// SPDX-License-Identifier: Apache-2.0
// The V participant of the keyring-wallet-vta-wire row for the community ceremonies (FC-MBR, FC-IDV): the live, original VTC container behind the loopback mediator.
// Its state is read and configured through an operator identity over REST (class D, see operator.ts: the community's administrator console, signed as the deployment's
// own admin); what the wallet sends (join, status, withdraw, vetter profile) travels over the wallet's wire, as the wallet's DID. A document handed to `send` (a replay)
// from any other identity is refused as not carried by this row, never faked. Requests, members and vetters are read for the wallet's CURRENT DID only: a live community
// keeps every earlier scenario's records, and each scenario starts with a new wallet DID.
import type { Adapter, Capabilities, ConnectResult, DeclareGovernanceResult, ObserveQuery, ObserveResult, ProvisionedRole, SendParams, SendResult } from "../../adapter/contract.ts";
import { communityCapabilities } from "./wire-caps.ts";
import type { WireInfo } from "./wire-caps.ts";
import { OperatorRefused } from "./operator.ts";
import type { Operator } from "./operator.ts";
import { seedOf } from "../../crypto/didkey.ts";

export type HostCall = (method: string, params?: unknown) => Promise<any>;
const unsupported = (what: string): Error => new Error(`not offered by the wire row: ${what}`);
const MEMBER_SEED = 0x47; // the member with no administrative authority (FC-MBR-012)
const STATUSES = ["pending", "approved", "rejected", "withdrawn", "deferred"];

export class VtcWireAdapter implements Adapter {
  private readonly host: HostCall;
  private readonly vtc: Operator;
  private readonly vta: Operator;
  private readonly vtcDid: string;
  private readonly info: Omit<WireInfo, "vtaTypes">;
  private walletDid = "";
  private types: string[] | undefined;
  private adminLog: { action: string; code: string }[] = [];
  private oldWallets = new Set<string>();
  private memberOp: Operator | undefined;
  /** How long a push from the community may take to reach the wallet (bounded), and the settle after the first one. */
  pushWaitMs = 20000;
  settleMs = 6000;

  constructor(host: HostCall, vtc: Operator, vta: Operator, vtcDid: string, info: Omit<WireInfo, "vtaTypes">) {
    this.host = host;
    this.vtc = vtc;
    this.vta = vta;
    this.vtcDid = vtcDid;
    this.info = info;
  }

  private async refreshWallet(): Promise<void> {
    this.walletDid = String(((await this.host("provision", { roles: ["peer"] })) as { peer: { vid: string } }).peer.vid);
  }

  async capabilities(): Promise<Capabilities> {
    if (this.types === undefined) {
      const d = await this.vtc.call("trust-task-discovery/0.3", {});
      this.types = (Array.isArray(d.supportedTypes) ? d.supportedTypes : []).map((t: unknown) => (typeof t === "string" ? t : String((t as { type?: unknown }).type ?? ""))).filter((t: string) => t !== "");
    }
    return communityCapabilities({ ...this.info, vtaTypes: this.types });
  }

  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> {
    const out: Record<string, ProvisionedRole> = {};
    for (const r of roles) {
      if (r !== "peer" && r !== "iut") throw unsupported(`a harness actor ${r}: only the wallet's DID has keys on this wire`);
      out[r] = { vid: this.vtcDid, didDocument: { id: this.vtcDid }, transportAddress: "didcomm:mediator", keyCustody: "iut" };
    }
    await this.refreshWallet();
    return out;
  }

  async trust(): Promise<void> { throw unsupported("trust"); }
  async setClock(): Promise<void> { throw unsupported("setClock (a real wire has real time)"); }
  async advance(): Promise<void> { throw unsupported("advance"); }
  async restart(): Promise<void> { throw unsupported("restart (the container is the deployment's)"); }
  async snapshot(): Promise<string> { throw unsupported("snapshot"); }
  async diff(): Promise<{ changed: boolean }> { throw unsupported("diff"); }
  async verifyProof(): Promise<{ valid: boolean }> { throw unsupported("verifyProof"); }
  async declareGovernance(): Promise<DeclareGovernanceResult> { return { status: "unsupported", reason: "the live community's policy is the deployment's" }; }
  async connect(): Promise<ConnectResult> { return { connected: true, detail: "the community is reached through the wallet's session" }; }

  /**
   * Between scenarios, after the wallet minted its new manager DID: the new DID is granted on the VTA (its mediator session needs an access-list entry there, as in the
   * other wire rows), the earlier wallet DIDs' entries are removed, and the administrator's log is cleared. The community's own records are not touched (the live
   * deployment keeps them; every read names the current DID).
   */
  async reset(): Promise<void> {
    this.adminLog = [];
    const before = this.walletDid;
    await this.refreshWallet();
    if (before !== "" && before !== this.walletDid) this.oldWallets.add(before);
    const rows = await this.vta.acl();
    for (const r of rows) if (this.oldWallets.has(r.subject)) await this.vta.revoke(r.subject);
    if (!rows.some((r) => r.subject === this.walletDid)) await this.vta.grant(this.walletDid, "admin", "keyring-wallet-vta-wire (community leg)");
  }

  private async requests(status?: string): Promise<Record<string, any>[]> {
    const out: Record<string, any>[] = [];
    for (const st of status === undefined ? STATUSES : [status]) {
      const r = await this.vtc.call("vtc/join-requests/list/0.2", { status: st });
      if (Array.isArray(r.items)) out.push(...(r.items as Record<string, any>[]));
    }
    return out.filter((x) => x.applicantDid === this.walletDid);
  }

  /** The member with no administrative authority: admitted as a member (so it holds a role), then signs as itself. */
  private async member(): Promise<Operator> {
    if (this.memberOp === undefined) {
      this.memberOp = this.vtc.as(seedOf(MEMBER_SEED));
      try { await this.vtc.call("vtc/members/admit/0.1", { subject: this.memberOp.did, role: "member" }); } catch (e) { if (!/already|exists|conflict/i.test(String((e as Error).message))) throw e; }
    }
    return this.memberOp;
  }

  private codeOf(e: unknown): string {
    return e instanceof OperatorRefused ? (e.code ?? `HTTP ${e.status}`) : "error";
  }

  async trigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }> {
    await this.refreshWallet();
    if (action === "knowApplicant") return { documents: [] }; // the live community resolves the applicant's DID itself (no cache to seed)
    if (action === "seedMember") {
      // deployment state: the community already holds this DID as a member (the administrator's own admit: the ACL row and the member record)
      await this.vtc.call("vtc/members/admit/0.1", { subject: String(args.vid), role: "member" });
      return { documents: [] };
    }
    if (action === "decide") {
      const as = args.as === "member" ? await this.member() : this.vtc;
      const items = await this.requests();
      const latest = [...items].sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))[0];
      const id = args.request === "unknown" ? "00000000-0000-4000-8000-0000000000aa" : String(latest?.id ?? "00000000-0000-4000-8000-0000000000bb");
      let code = "ok";
      try { await (args.as === "member" ? as.callSigned : as.call).call(as, "vtc/join-requests/decide/0.1", { id, decision: String(args.decision), ...(args.reason === undefined ? {} : { reason: String(args.reason) }) }); } catch (e) { code = this.codeOf(e); }
      this.adminLog.push({ action: "decide", code });
      return { documents: [] };
    }
    if (action === "grantVetter") {
      let code = "ok";
      try { await this.vtc.call("vtc/vetting/vetters/grant/0.1", { memberDid: String(args.vid) }); } catch (e) { code = this.codeOf(e); }
      this.adminLog.push({ action: "grantVetter", code });
      return { documents: [] };
    }
    throw unsupported(`trigger ${action}`);
  }

  async send(p: SendParams): Promise<SendResult> {
    await this.refreshWallet();
    if (p.from.kind !== "actor" || p.from.vid !== this.walletDid) throw unsupported(`a document from ${p.from.kind === "none" ? "no identity" : p.from.vid}: only the wallet's DID has keys on this wire`);
    const r = (await this.host("wire.sendTo", { bytes: p.bytes, to: this.vtcDid })) as { replies: string[] };
    return { replies: r.replies, transport: { kind: r.replies.length > 0 ? "document" : "none" }, quiescentAfterMs: 0 };
  }

  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (this.walletDid === "") await this.refreshWallet();
    if (q.query === "received") {
      // what reached the community is what the wallet sent over the wire
      const sent = ((await this.host("wire.sent")) as Record<string, any>[]).filter((d) => (q.type === undefined || d.type === q.type) && (q.threadId === undefined || d.threadId === q.threadId || d.id === q.threadId));
      return { value: sent.length, documents: sent.map((d) => JSON.stringify(d)) };
    }
    if (q.query !== "stored") throw unsupported(`observe ${q.query}`);
    const kind = q.kind;
    if (kind === "join-request") return { value: (await this.requests()).length };
    if (kind.startsWith("join-request:")) return { value: (await this.requests(kind.slice(13))).length };
    if (kind.startsWith("member:")) {
      const r = await this.vtc.call("vtc/members/list/0.2", {});
      return { value: (Array.isArray(r.items) ? (r.items as Record<string, any>[]) : []).filter((m) => m.did === kind.slice(7)).length };
    }
    if (kind.startsWith("admin:")) return { value: this.adminLog.filter((x) => `${x.action}:${x.code}` === kind.slice(6)).length };
    if (kind.startsWith("pushed:")) {
      // what the community sent the wallet on its own (the wallet's wire received it): documents from the community, not answers to a request of the wallet. The community's
      // outbox retries on a few seconds' rhythm: read until something has arrived (bounded), then once more after a short settle for the second push.
      const count = async (): Promise<number> => {
        const inbound = (await this.host("wire.inbound")) as Record<string, any>[];
        const asked = new Set(((await this.host("wire.sent")) as Record<string, any>[]).map((d) => d.id));
        return inbound.filter((d) => d.issuer === this.vtcDid && String(d.type).includes(kind.slice(7)) && !asked.has(d.threadId)).length;
      };
      const t0 = Date.now();
      let n = await count();
      while (n === 0 && Date.now() - t0 < this.pushWaitMs) { await new Promise((r) => setTimeout(r, 1000)); n = await count(); }
      if (n > 0) { await new Promise((r) => setTimeout(r, this.settleMs)); n = await count(); }
      return { value: n };
    }
    if (kind.startsWith("vetter:")) {
      const r = await this.vtc.call("vtc/vetting/vetters/list/0.1", {});
      return { value: (Array.isArray(r.vetters) ? (r.vetters as Record<string, any>[]) : []).filter((v) => v.did === kind.slice(7) || v.vetterDid === kind.slice(7)).length };
    }
    throw unsupported(`observe stored ${kind}`);
  }
}
