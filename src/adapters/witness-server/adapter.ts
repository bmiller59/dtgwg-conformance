// SPDX-License-Identifier: Apache-2.0
// Black-box adapter for a witness server reached over DIDComm (docs/13-didcomm-carrier-and-witness-server.md). It knows the wire only:
// an out-of-band invitation URL and the Trust Task types the witness specifications define. It reads nothing of the server's code and
// hard-codes no deployment choice (locality policy, event window, issuer): whatever the server is configured to do is what is measured.
//
// Identity mapping. The harness names parties by actor (A, X, ...), each with a did:key. A DIDComm v1 envelope authenticates a verkey that
// the connection binds to a DID (bindings/didcomm-v1 0.2 section 3), so an actor's document identity over this carrier is its
// connection's own DID. The adapter therefore gives each actor its own connection and rewrites, in the bytes it sends, every actor did:key
// to that actor's connection DID and the IUT's vid to the witness's DID on the sending actor's connection; replies are rewritten back.
// A vector never sees a peer DID, and the server sees consistent ones.
import { readFileSync } from "node:fs";
import type { Adapter, Capabilities, EssentialGovernance, ObserveQuery, ObserveResult, ProvisionedRole, SendParams, SendResult } from "../../adapter/contract.ts";
import { DidCommCarrier } from "../../carriers/didcomm/carrier.ts";
import type { ConnectionInfo, DidCommVersion, PeerInfo } from "../../carriers/didcomm/carrier.ts";
import { makeActors } from "../../runner/engine.ts";

/** The latest versions (decision D290): witness/session 0.2, witness/session/submit 0.2 (the pair), trust-task-discovery 0.4. */
export const LATEST_WITNESS_VERSION = "0.2";
export const SESSION_TYPE = `https://trusttasks.org/spec/witness/session/${LATEST_WITNESS_VERSION}`;
export const SUBMIT_TYPE = `https://trusttasks.org/spec/witness/session/submit/${LATEST_WITNESS_VERSION}`;
/** The Type URIs of the witness pair at `version` ("0.2" the latest, "0.1" the older one). */
export const witnessTypesAt = (version: string): string[] => [`https://trusttasks.org/spec/witness/session/${version}`, `https://trusttasks.org/spec/witness/session/submit/${version}`];
/** What the witness adapter states about essential governance: nothing readable, and why. */
export const WITNESS_ESSENTIAL = {
  source: "unreadable",
  reason: "black-box witness server: the adapter reads none of its configuration, and neither witness/session nor session/submit waits for an approval from a set of principals, so no authority set or minApprovals applies",
} as const satisfies EssentialGovernance;
export const DISCOVERY_TYPE = "https://trusttasks.org/spec/trust-task-discovery/0.4";

export interface WitnessAdapterOptions {
  /** Directory whose node_modules hold Credo-TS (see the carrier). */
  root: string;
  version: DidCommVersion;
  /** The out-of-band invitation URL of the witness for `version` (v1 `?oob=`, v2 `?_oob=`). */
  invitationUrl: string;
  inboundPort: number;
  /** Wait for a first reply this long, then this long again for more (ms). */
  replyWaitMs?: number;
  settleMs?: number;
  /**
   * The versions of the witness pair the server is declared to serve, newest first (default: the latest only, "0.2"). A black-box adapter cannot read
   * them from the server, so the operator states them (`WITNESS_VERSIONS`, for example "0.2,0.1"); the vectors for a version not listed are SKIP.
   */
  versions?: string[];
  /** The row name (default "witness-server"; a build that serves the 0.2 pair is its own row, `witness-server-latest`). */
  name?: string;
}

export function invitationFromFile(path: string, version: DidCommVersion): string {
  const j = JSON.parse(readFileSync(path, "utf8")) as { invitationUrl?: string; invitationV2Url?: string };
  const u = version === "v2" ? j.invitationV2Url : j.invitationUrl;
  if (u === undefined) throw new Error(`${path} has no invitation for ${version}`);
  return u;
}

export class WitnessServerAdapter implements Adapter {
  private readonly o: WitnessAdapterOptions;
  /** One Credo agent (one wallet, one inbound port) per actor: an agent receives a given invitation once. */
  private readonly carriers = new Map<string, DidCommCarrier>();
  private readonly actors = makeActors();
  private readonly conns = new Map<string, ConnectionInfo>();
  private iutVid = "";
  private inbox: { connectionId: string; text: string; peer: PeerInfo }[] = [];
  private repliesSeen = 0;

  constructor(o: WitnessAdapterOptions) {
    this.o = o;
  }

  private async connectionOf(actor: string): Promise<ConnectionInfo> {
    let c = this.conns.get(actor);
    if (c === undefined) {
      const carrier = new DidCommCarrier({ root: this.o.root, version: this.o.version, label: `conformance-harness-${actor}`, inboundPort: this.o.inboundPort + this.carriers.size });
      carrier.onDocument((connectionId, text, peer) => this.inbox.push({ connectionId, text, peer }));
      await carrier.start();
      this.carriers.set(actor, carrier);
      c = await carrier.connect(this.o.invitationUrl);
      if (this.o.version === "v2") c = await this.prime(carrier, c);
      this.conns.set(actor, c);
    }
    return c;
  }

  /**
   * DIDComm v2 has no handshake: the connection exists from the invitation's `from` DID, and a witness whose invitation is reusable
   * answers from a DID of its own for this connection (Credo-TS rotates it on first contact). The witness checks a document's `recipient`
   * against that DID, not the invitation's, and does not name it in the document (an error reply's `issuer` is the invitation DID). The DID
   * is learned from the connection the first reply arrives on: Credo updates the connection's `theirDid` to the DID of the reply's `from`.
   * A first, recipient-less discovery request is sent for that (the witness answers it with an error). If nothing arrives the invitation
   * DID is kept.
   */
  private async prime(carrier: DidCommCarrier, c: ConnectionInfo): Promise<ConnectionInfo> {
    const id = `prime-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await carrier.send(c.connectionId, JSON.stringify({ id, type: DISCOVERY_TYPE, issuedAt: new Date().toISOString(), payload: {} }));
    const t0 = Date.now();
    const mine = () => this.inbox.find((m) => m.connectionId === c.connectionId);
    while (mine() === undefined && Date.now() - t0 < (this.o.replyWaitMs ?? 4000) + 4000) await new Promise((r) => setTimeout(r, 50));
    const rotated = mine()?.peer.theirDid;
    this.inbox = this.inbox.filter((x) => x.connectionId !== c.connectionId);
    return typeof rotated === "string" ? { ...c, theirDid: rotated } : c;
  }

  private actorOfVid(vid: string): string | undefined {
    return Object.values(this.actors).find((a) => a.vid === vid)?.name;
  }

  async capabilities(): Promise<Capabilities> {
    return {
      name: this.o.name ?? "witness-server",
      version: "unversioned",
      tierMax: 1,
      bindings: ["didcomm", this.o.version === "v2" ? "didcomm-v2" : "didcomm-v1"],
      // The served set the witness documents: the two witness types at each version it is declared to serve. That it also answers discovery is not declared here (WSD-009).
      supportedTypes: (this.o.versions ?? [LATEST_WITNESS_VERSION]).flatMap(witnessTypesAt),
      carriers: [],
      cryptosuites: [],
      optional: ["clockFree"],
      // Essential governance (docs/04 section 19): this black-box adapter reads nothing of the server's configuration, and no task of the two witness
      // types it measures waits for an approval from a set of principals, so there is no authority set to state.
      governance: { essential: WITNESS_ESSENTIAL },
      pins: { framework: "0.6.0", error: "0.6", binding: this.o.version === "v2" ? "didcomm/0.2" : "didcomm-v1/0.2" },
    };
  }

  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> {
    const out: Record<string, ProvisionedRole> = {};
    for (const r of roles) {
      if (r !== "iut") throw new Error(`role ${r} is not provisionable: actors are mapped to connections on first use`);
      const c = await this.connectionOf("A");
      this.iutVid = c.theirDid;
      out.iut = { vid: c.theirDid, transportAddress: "didcomm", keyCustody: "iut" };
    }
    return out;
  }

  async trust(): Promise<void> {}
  async setClock(): Promise<void> {
    throw new Error("the clock of a remote witness cannot be set");
  }
  async advance(): Promise<void> {
    throw new Error("the clock of a remote witness cannot be advanced");
  }

  /** Rewrite harness identities to the connection identities for a send from `actor`. */
  private async rewriteOut(text: string, actor: string): Promise<string> {
    let t = text;
    for (const a of Object.values(this.actors)) {
      if (t.includes(a.vid)) t = t.split(a.vid).join((await this.connectionOf(a.name)).myDid);
    }
    const own = await this.connectionOf(actor);
    return t.split(this.iutVid).join(own.theirDid);
  }

  private rewriteIn(text: string): string {
    let t = text;
    for (const [actor, c] of this.conns) {
      t = t.split(c.myDid).join(this.actors[actor]!.vid);
      t = t.split(c.theirDid).join(this.iutVid);
    }
    return t;
  }

  async send(p: SendParams): Promise<SendResult> {
    if (p.from.kind !== "actor") throw new Error(`a DIDComm connection always authenticates its sender: from.kind ${p.from.kind} is not available over this carrier`);
    const actor = this.actorOfVid(p.from.vid);
    if (actor === undefined) throw new Error(`unknown actor ${p.from.vid}`);
    const conn = await this.connectionOf(actor);
    this.inbox = this.inbox.filter((m) => m.connectionId !== conn.connectionId);
    let text = await this.rewriteOut(p.bytes, actor);
    let doc: unknown;
    try {
      doc = JSON.parse(text);
      // A document the harness signed carries the actor's did:key proof, which the rewrite invalidated: re-originate it, signed with the
      // key behind the connection DID (the identity the witness resolves for the issuer), keeping purpose and created.
      const o = doc as { proof?: { proofPurpose?: string; created?: string } };
      if (typeof o === "object" && o !== null && o.proof !== undefined) {
        doc = await this.carriers.get(actor)!.signAs(conn.connectionId, doc as Record<string, unknown>, { ...(o.proof.proofPurpose === undefined ? {} : { purpose: o.proof.proofPurpose }), ...(o.proof.created === undefined ? {} : { created: o.proof.created }) });
        text = JSON.stringify(doc);
      }
    } catch {
      return { replies: [], transport: { kind: "refused" }, quiescentAfterMs: 0 };
    }
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return { replies: [], transport: { kind: "refused" }, quiescentAfterMs: 0 };
    const t0 = Date.now();
    await this.carriers.get(actor)!.send(conn.connectionId, text);
    const first = this.o.replyWaitMs ?? 4000;
    const settle = this.o.settleMs ?? 500;
    const mine = () => this.inbox.filter((m) => m.connectionId === conn.connectionId);
    while (mine().length === 0 && Date.now() - t0 < first) await new Promise((r) => setTimeout(r, 50));
    if (mine().length > 0) await new Promise((r) => setTimeout(r, settle));
    const replies = mine().map((m) => this.rewriteIn(m.text));
    this.repliesSeen += replies.length;
    return { replies, transport: { kind: replies.length > 0 ? "document" : "none" }, quiescentAfterMs: Date.now() - t0 };
  }

  async trigger(): Promise<{ documents: string[] }> {
    throw new Error("trigger is not offered by this adapter");
  }

  async observe(q: ObserveQuery): Promise<ObserveResult> {
    // A remote witness exposes no state to a black-box harness; the vectors of this group assert none.
    if (q.query === "handled") return { value: this.repliesSeen };
    if (q.query === "documentState") return { value: "unknown" };
    if (q.query === "retained") return { value: "" };
    return { value: 0 };
  }

  async restart(): Promise<void> {
    throw new Error("restart is not offered by this adapter");
  }
  async reset(): Promise<void> {
    this.inbox = [];
  }
  async snapshot(): Promise<string> {
    return "none";
  }
  async diff(): Promise<{ changed: boolean; detail?: string }> {
    return { changed: false };
  }
  async verifyProof(): Promise<{ valid: boolean }> {
    throw new Error("verifyProof is not offered by this adapter");
  }

  async close(): Promise<void> {
    for (const c of this.carriers.values()) await c.stop();
  }
}
