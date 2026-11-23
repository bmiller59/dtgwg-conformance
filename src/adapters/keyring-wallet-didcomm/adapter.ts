// SPDX-License-Identifier: Apache-2.0
// keyring-wallet over real DIDComm v1 (docs/18-keyring-wallet-over-didcomm.md). The data path is the suite's DIDComm carrier talking to a
// real Credo agent that runs the wallet's own inbound registration inside keyring-wallet's jest (kw-didcomm-host.jest.ts). The control
// plane (triggers, observes, clock, reset, emit) cannot ride DIDComm: it is the shim adapter's own host code, reached on loopback HTTP.
//
// Identity mapping is the witness-server adapter's (docs/13 section 4): an actor's document identity over a DIDComm v1 connection is that
// connection's own DID, so each actor that sends gets its own connection; harness did:keys are rewritten to connection DIDs in what is
// sent, and the wallet's DIDs to the IUT's vid, and the actors' DIDs back, in what comes back. A document the harness signed is signed
// again with the key behind the connection DID (a valid proof stays valid; a proof the harness had broken is broken again).
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import type { Adapter, Capabilities, ObserveQuery, ObserveResult, ProvisionedRole, SendParams, SendResult } from "../../adapter/contract.ts";
import { PushedBox } from "../../adapter/pushed.ts";
import { rpcAdapterFromSpec } from "../../adapter/client.ts";
import { DidCommCarrier } from "../../carriers/didcomm/carrier.ts";
import type { ConnectionInfo } from "../../carriers/didcomm/carrier.ts";
import { toMultibase } from "../../crypto/base58.ts";
import { verifyDocumentProof as suiteVerify } from "../../crypto/proof.ts";
import { makeActors } from "../../runner/engine.ts";
import { jcsBytes } from "../../util/json.ts";
import { DocStates, answers, exchangeStillOpen, stateFromReply, KW_ADAPTER_NAME } from "../keyring-wallet/shim.ts";

/** The first free loopback port at or after `from` (the carrier's inbound HTTP listens on all addresses, so probe the same way). */
async function freePort(from: number): Promise<number> {
  for (let p = from; p < from + 200; p++) {
    const ok = await new Promise<boolean>((res) => {
      const s = createServer();
      s.once("error", () => res(false));
      s.listen(p, () => s.close(() => res(true)));
    });
    if (ok) return p;
  }
  throw new Error(`no free port from ${from}`);
}

export const DIDCOMM_ADAPTER_NAME = "keyring-wallet-didcomm";
/** Actors that send over the wire get a connection; R and S are relationship identities that appear in payloads and stay did:key. */
const SENDERS = ["A", "X", "Q", "W"];

export interface KwDidCommOptions {
  root: string;
  invitationUrl: string;
  /** Loopback URL of the host's control plane (the shim host's HTTP JSON-RPC). */
  controlUrl: string;
  inboundPort: number;
  /** DIDComm version of the carrier and invitation: v1 (default) or v2 (experimental; uses the fixed carrier copy). */
  version?: "v1" | "v2";
  replyWaitMs?: number;
  settleMs?: number;
  /** Quiet (ms) awaited after a next step that is the only answer so far, for the result that may follow (default 1500). */
  interimWaitMs?: number;
  /** Append every wire exchange (request, replies) as a JSON line here, for the run record. */
  tracePath?: string;
}

type Doc = Record<string, unknown>;
export class KeyringWalletDidCommAdapter implements Adapter {
  private readonly o: KwDidCommOptions;
  private readonly control;
  private readonly actors = makeActors();
  private readonly carriers = new Map<string, DidCommCarrier>();
  private readonly conns = new Map<string, ConnectionInfo>();
  private inbox: { connectionId: string; text: string; peerDid?: string; at: number }[] = [];
  readonly unsolicited: string[] = [];
  /**
   * observe.pushed over the real wire: the loopback receiver is the actors' own carriers. A document that arrives at an actor's carrier and
   * is not the answer to what the harness sent (or the answer a trigger waits for, which is recorded too: the wallet sent it on its own
   * initiative) is a pushed document. `to` is the actor whose connection it arrived on, not the connection DID the wallet addressed.
   */
  private readonly pushed = new PushedBox();
  private recordPushed(text: string, connectionId: string): void {
    const actor = [...this.conns].find(([, c]) => c.connectionId === connectionId)?.[0];
    this.pushed.record(this.rewriteIn(text), actor === undefined ? undefined : this.actors[actor]!.vid);
  }
  private readonly states = new DocStates();
  private readonly snaps = new Map<string, string>();
  private iutVid = "";
  private iutDoc: unknown;
  private snapN = 0;
  /** Count of vectors' sends that the carrier could not place in a DIDComm message (not JSON, not an object). */
  refused = 0;

  constructor(o: KwDidCommOptions) {
    this.o = o;
    this.control = rpcAdapterFromSpec(`http:${o.controlUrl}`, { timeoutMs: 120000 });
  }

  private async connectionOf(actor: string): Promise<ConnectionInfo> {
    let c = this.conns.get(actor);
    if (c === undefined) {
      const v2 = this.o.version === "v2";
      const carrier = new DidCommCarrier({ root: this.o.root, version: v2 ? "v2" : "v1", label: `conformance-harness-${actor}`, inboundPort: await freePort(this.o.inboundPort + this.carriers.size) });
      carrier.onDocument((connectionId, text, peer?: { theirDid?: string }) => {
        // Every document the wallet sends is seen here, so a later reply on a request's thread (the answer to a trigger, a straggler) moves that request's state on.
        try {
          this.states.note(JSON.parse(text) as Doc);
        } catch {
          /* not JSON: nothing to note */
        }
        this.inbox.push({ connectionId, text, at: Date.now(), ...(peer?.theirDid === undefined ? {} : { peerDid: peer.theirDid }) });
      });
      await carrier.start();
      this.carriers.set(actor, carrier as DidCommCarrier);
      c = await carrier.connect(this.o.invitationUrl);
      if (v2) c = await this.prime(carrier as DidCommCarrier, c);
      this.conns.set(actor, c);
    }
    return c;
  }

  /**
   * DIDComm v2 has no handshake and the wallet answers from a DID of its own for the connection (Credo creates the connection record on
   * first contact). A first recipient-less discovery request is sent so the reply arrives, and the DID it arrives from is taken as the wallet's.
   */
  private async prime(carrier: DidCommCarrier, c: ConnectionInfo): Promise<ConnectionInfo> {
    const id = `prime-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await carrier.send(c.connectionId, JSON.stringify({ id, type: "https://trusttasks.org/spec/trust-task-discovery/0.1", issuedAt: new Date().toISOString(), payload: {} }));
    const t0 = Date.now();
    const mine = () => this.inbox.find((m) => m.connectionId === c.connectionId);
    while (mine() === undefined && Date.now() - t0 < 12000) await new Promise((r) => setTimeout(r, 50));
    const rotated = mine()?.peerDid;
    this.inbox = this.inbox.filter((x) => x.connectionId !== c.connectionId);
    return typeof rotated === "string" ? { ...c, theirDid: rotated } : c;
  }

  private actorOfVid(vid: string): string | undefined {
    return Object.values(this.actors).find((a) => a.vid === vid)?.name;
  }

  async capabilities(): Promise<Capabilities> {
    // The type set, carriers, window, emit list, cryptosuites and pins are the wallet's own (the host computes them, as for the shim row).
    const c = await this.control.capabilities();
    const optional = c.optional;
    const v2 = this.o.version === "v2";
    return {
      ...c,
      // Both rows are the wallet over real DIDComm: each declares the wallet as its platform, so the wallet's exceptions apply to v1 and v2 alike
      // (docs/18 section 6) and an exception that no longer matches a v2 result fails as stale; an entry whose difference v2 does not carry
      // names the v2 row in `notOn` (ENV-003: the wallet's v2 binding drops a document with no id).
      platform: KW_ADAPTER_NAME,
      name: v2 ? `${DIDCOMM_ADAPTER_NAME}-v2` : DIDCOMM_ADAPTER_NAME,
      implementation: v2 ? `${DIDCOMM_ADAPTER_NAME}-v2` : DIDCOMM_ADAPTER_NAME,
      version: `${c.version.replace(/, logic over a shim carrier/, "")}, real DIDComm ${v2 ? "v2 (experimental)" : "v1"} (Credo agent, HTTP, authcrypt); control plane out of band (loopback)`,
      bindings: ["didcomm", v2 ? "didcomm-v2" : "didcomm-v1"],
      optional,
      pins: { ...c.pins, binding: v2 ? "didcomm/0.2" : "didcomm-v1/0.2" },
    };
  }

  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> {
    const out: Record<string, ProvisionedRole> = {};
    for (const r of roles) {
      if (r !== "iut") throw new Error(`role ${r} is not provisionable: actors are mapped to connections on first use`);
      const c = await this.connectionOf("A");
      this.iutVid = c.theirDid;
      this.iutDoc ??= await (this.carriers.get("A") as any).agent.dids.resolveDidDocument(c.theirDid).then((d: any) => JSON.parse(JSON.stringify(d)));
      out.iut = { vid: c.theirDid, didDocument: this.iutDoc, transportAddress: "didcomm-v1 over http (127.0.0.1)", keyCustody: "iut" };
    }
    return out;
  }

  async trust(): Promise<void> {}
  async setClock(iso: string): Promise<void> {
    await this.control.setClock(iso);
  }
  async advance(ms: number): Promise<void> {
    await this.control.advance(ms);
  }

  private async rewriteOut(text: string): Promise<string> {
    let t = text;
    for (const n of SENDERS) {
      const a = this.actors[n]!;
      if (t.includes(a.vid)) t = t.split(a.vid).join((await this.connectionOf(n)).myDid);
    }
    return t;
  }

  private rewriteIn(text: string): string {
    let t = text;
    for (const [actor, c] of this.conns) {
      t = t.split(c.myDid).join(this.actors[actor]!.vid);
      if (c.theirDid !== this.iutVid) t = t.split(c.theirDid).join(this.iutVid);
    }
    return t;
  }

  /**
   * Sign `doc` (proof removed) again, keeping the original proof's configuration members: with the key behind a connection's DID for a
   * sending actor, with the suite's own key for an actor that is a relationship identity (R, S), which has no connection.
   */
  private async reSign(signerName: string, doc: Doc, original: Record<string, unknown>, corrupt: boolean): Promise<Doc> {
    const purpose = typeof original.proofPurpose === "string" ? original.proofPurpose : "authentication";
    const { proof: _drop, ...body } = doc;
    const { proofValue: _pv, verificationMethod: _vm, ...rest } = original;
    let full: string;
    let sign: (data: Uint8Array) => Promise<Uint8Array>;
    if (this.conns.has(signerName)) {
      const agent = (this.carriers.get(signerName) as any).agent;
      const did = this.conns.get(signerName)!.myDid;
      const resolved = await agent.dids.resolveDidDocument(did);
      const rel = purpose === "assertionMethod" ? resolved.assertionMethod : resolved.authentication;
      const first = (rel ?? resolved.authentication ?? [])[0];
      const vmId: string = typeof first === "string" ? first : first.id;
      full = vmId.startsWith("#") ? `${did}${vmId}` : vmId;
      const rec = (await agent.dids.getCreatedDids({ did }))[0];
      const key = rec?.keys?.find((k: any) => full.endsWith(k.didDocumentRelativeKeyId) || k.didDocumentRelativeKeyId === vmId);
      if (key === undefined) throw new Error(`no key for ${full}`);
      sign = async (data) => new Uint8Array((await agent.kms.sign({ keyId: key.kmsKeyId, algorithm: "EdDSA", data })).signature);
    } else {
      const signer = this.actors[signerName]!.signer;
      full = signer.verificationMethod;
      sign = async (data) => signer.sign(data);
    }
    const config: Record<string, unknown> = { ...rest, verificationMethod: full, proofPurpose: purpose };
    const sha = (b: Uint8Array): Uint8Array => new Uint8Array(createHash("sha256").update(b).digest());
    const data = new Uint8Array([...sha(jcsBytes(config)), ...sha(jcsBytes(body))]);
    let pv = toMultibase(await sign(data));
    if (corrupt) pv = pv.slice(0, -2) + (pv.endsWith("A") ? "B" : "A") + pv.slice(-1);
    return { ...body, proof: { ...config, proofValue: pv } };
  }

  /** `from none`: an anoncrypt message to the wallet's service, which carries no sender identity (the wallet then sees no authenticated connection). */
  private async sendAnonymous(actor: string, conn: ConnectionInfo, text: string): Promise<void> {
    const carrier = this.carriers.get(actor) as any;
    const agent = carrier.agent;
    const dc = carrier.dc;
    const doc = await agent.dids.resolveDidDocument(conn.theirDid);
    const svc = doc.didCommServices[0];
    const service = { id: svc.id, serviceEndpoint: svc.serviceEndpoint, recipientKeys: doc.recipientKeys, routingKeys: [] };
    const message = new carrier.V1({ document: JSON.parse(text) });
    const sender = agent.dependencyManager.container.resolve(dc.DidCommMessageSender);
    await sender.sendMessage(new dc.DidCommOutboundMessageContext(message, { agentContext: agent.context, serviceParams: { service, senderKey: undefined, returnRoute: false } }));
  }

  async send(p: SendParams): Promise<SendResult> {
    // `none`: sent anonymously (anoncrypt) from actor A's agent; the document is the harness's, identities mapped as for any other send.
    const anonymous = p.from.kind === "none";
    const actor = p.from.kind === "none" ? "A" : this.actorOfVid(p.from.vid);
    if (actor === undefined || !SENDERS.includes(actor)) throw new Error(`unknown sending actor ${p.from.kind === "none" ? "" : p.from.vid}`);
    const conn = await this.connectionOf(actor);
    let original: Doc | undefined;
    try {
      const j = JSON.parse(p.bytes);
      if (typeof j === "object" && j !== null && !Array.isArray(j)) original = j as Doc;
    } catch {
      /* not JSON */
    }
    if (original === undefined) {
      // The carrier places a JSON object in a DIDComm attachment; bytes that are not one cannot be sent over this carrier at all.
      this.refused++;
      return { replies: [], transport: { kind: "refused" }, quiescentAfterMs: 0 };
    }
    for (const m of this.inbox.filter((x) => x.connectionId === conn.connectionId)) {
      this.unsolicited.push(m.text);
      this.recordPushed(m.text, m.connectionId);
    }
    this.inbox = this.inbox.filter((m) => m.connectionId !== conn.connectionId);
    // The iut's DID on THIS connection is the wallet's DID there.
    let text = (await this.rewriteOut(p.bytes)).split(this.iutVid).join(conn.theirDid);
    let doc = JSON.parse(text) as Doc;
    const op = original.proof;
    if (typeof op === "object" && op !== null && !Array.isArray(op)) {
      const proof = op as Record<string, unknown>;
      const vmController = String(proof.verificationMethod ?? "").split("#")[0] ?? "";
      const signer = this.actorOfVid(vmController ?? "");
      if (signer !== undefined) {
        if (SENDERS.includes(signer)) await this.connectionOf(signer);
        const ok = suiteVerify(original, { nowMs: Date.now() + 10 * 365 * 86400000, skewMs: 10 * 365 * 86400000 }).valid;
        const rp = JSON.parse(await this.rewriteOut(JSON.stringify(proof))) as Record<string, unknown>;
        doc = await this.reSign(signer, doc, rp, !ok);
      }
    }
    text = JSON.stringify(doc);
    const id = typeof doc.id === "string" ? doc.id : undefined;
    const thread = String(doc.threadId ?? doc.id);
    const t0 = Date.now();
    if (id !== undefined) this.states.request(id, thread);
    if (anonymous) await this.sendAnonymous(actor, conn, text);
    else await this.carriers.get(actor)!.send(conn.connectionId, text);
    const first = this.o.replyWaitMs ?? 2500;
    const settle = this.o.settleMs ?? 400;
    const mine = () => this.inbox.filter((m) => m.connectionId === conn.connectionId);
    const isAnswer = (m: { text: string }): boolean => {
      try {
        return answers(JSON.parse(m.text) as Doc, thread, id);
      } catch {
        return false;
      }
    };
    // The wait ends when an answer to this send has arrived, or when nothing at all has arrived for `first` ms. A document that arrives
    // and answers nothing (a refusal of a request that has no id to name, a straggler) is not an answer and does not end the wait: the
    // quiet that justifies "no reply" is counted from the last arrival, not from the send.
    const lastArrival = (): number => Math.max(t0, ...mine().map((m) => m.at));
    while (!mine().some(isAnswer) && Date.now() - lastArrival() < first) await new Promise((r) => setTimeout(r, 25));
    if (mine().some(isAnswer)) await new Promise((r) => setTimeout(r, settle));
    // SPEC.md 4.4.1: a next step does not close the exchange, and 4.4 (threadId) names request, interim next step, final result. When
    // only next steps have arrived, the result may still follow (a wallet under load takes longer than `settle` to produce it), so the
    // wait continues until nothing has arrived for `interim` ms; a hold that is the whole answer costs that quiet once. Arrival order is
    // kept as it came: the runner's reply-set rule, not this adapter, decides what an interim next step before the result means.
    const interim = this.o.interimWaitMs ?? 1500;
    const openNow = (): boolean => exchangeStillOpen(mine().flatMap((m) => { try { const d = JSON.parse(m.text) as Doc; return answers(d, thread, id) ? [d] : []; } catch { return []; } }));
    while (openNow() && Date.now() - lastArrival() < interim) await new Promise((r) => setTimeout(r, 25));
    const quietFrom = lastArrival();
    const replies: string[] = [];
    for (const m of mine()) {
      const d = JSON.parse(m.text) as Doc;
      if (answers(d, thread, id)) replies.push(this.rewriteIn(m.text));
      else this.unsolicited.push(m.text);
    }
    this.inbox = this.inbox.filter((m) => m.connectionId !== conn.connectionId);
    if (id !== undefined) this.states.set(id, stateFromReply(replies[0] === undefined ? undefined : (JSON.parse(replies[0]).type as string)));
    if (this.o.tracePath !== undefined) (await import("node:fs")).appendFileSync(this.o.tracePath, JSON.stringify({ from: actor, request: doc, replies: replies.map((r) => JSON.parse(r)) }) + "\n");
    return { replies, transport: { kind: replies.length > 0 ? "document" : "none" }, quiescentAfterMs: replies.length > 0 ? Date.now() - t0 : Date.now() - quietFrom };
  }

  async trigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }> {
    for (const m of this.inbox) {
      this.unsolicited.push(m.text);
      this.recordPushed(m.text, m.connectionId);
    }
    this.inbox = [];
    const waits = action === "consent" || action === "queryDecision";
    await this.control.trigger(action, args);
    if (!waits) return { documents: [] };
    const t0 = Date.now();
    while (this.inbox.length === 0 && Date.now() - t0 < (this.o.replyWaitMs ?? 2500)) await new Promise((r) => setTimeout(r, 25));
    if (this.inbox.length > 0) await new Promise((r) => setTimeout(r, this.o.settleMs ?? 400));
    const documents: string[] = [];
    for (const m of this.inbox) {
      const d = JSON.parse(m.text) as Doc;
      const ok = action === "consent" ? answers(d, String(args.exchangeId), undefined) : d.threadId === String(args.thread);
      if (ok) documents.push(this.rewriteIn(m.text));
      else this.unsolicited.push(m.text);
      this.recordPushed(m.text, m.connectionId);
    }
    this.inbox = [];
    return { documents };
  }

  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "documentState") return { value: this.states.get(q.id) };
    if (q.query === "pushed") {
      // Whatever has arrived since the last send or trigger is not a reply to anything: it is pushed.
      for (const m of this.inbox) {
        this.unsolicited.push(m.text);
        this.recordPushed(m.text, m.connectionId);
      }
      this.inbox = [];
      return this.pushed.observe(q);
    }
    return this.control.observe(q);
  }

  async restart(): Promise<void> {
    await this.control.restart();
    await new Promise((r) => setTimeout(r, 500));
    this.inbox = [];
  }
  async reset(): Promise<void> {
    await this.control.reset();
    await new Promise((r) => setTimeout(r, 300));
    this.inbox = [];
    this.states.clear();
    this.pushed.clear();
  }
  async snapshot(): Promise<string> {
    const id = `ksnap-${this.snapN++}`;
    this.snaps.set(id, `${await this.control.snapshot()}|${JSON.stringify([...this.states])}`);
    return id;
  }
  async diff(snapshotId: string): Promise<{ changed: boolean; detail?: string }> {
    const mine = this.snaps.get(snapshotId) ?? "";
    const [hostId, st] = [mine.slice(0, mine.indexOf("|")), mine.slice(mine.indexOf("|") + 1)];
    const d = await this.control.diff(hostId);
    const now = JSON.stringify([...this.states]);
    return d.changed || st !== now ? { changed: true, detail: d.detail ?? `${st} -> ${now}` } : { changed: false };
  }
  async verifyProof(p: { bytes: string }): Promise<{ valid: boolean }> {
    return this.control.verifyProof(p);
  }
  async emit(p: { type: string; args?: Record<string, unknown> }): Promise<{ documents: string[] }> {
    return this.control.emit(p);
  }

  async close(): Promise<void> {
    for (const c of this.carriers.values()) await c.stop();
  }
}
