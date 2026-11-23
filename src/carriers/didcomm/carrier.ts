// SPDX-License-Identifier: Apache-2.0
// DIDComm carrier for the harness (docs/13-didcomm-carrier-and-witness-server.md). It packs a Trust Task document into a DIDComm message,
// sends it over an existing connection and hands back every Trust Task document the peer sends in return.
//
//   didcomm-v1  bindings/didcomm-v1 0.2 (draft): message type `.../binding/didcomm-v1/0.2/trust-task/1.0/task`, the document inline in a
//               `~attach` entry with `@id` `trust-task` (`data.json`), authcrypt, `~thread.thid` from the document's threadId or id when it
//               is representable (RFC 0008 shape), the connection's theirDid as the transport-authenticated sender (section 3).
//   didcomm-v2  binding/didcomm 0.2 (draft): message type `.../binding/didcomm/0.1/envelope`, `body` is the document verbatim, `thid` from
//               threadId (else id), `pthid` from parentThreadId, authcrypt (section 3.1).
//
// No cryptography is written here: packing, authcrypt, connections and transport are Credo-TS. The dependency is NOT a dependency of the
// suite; `root` names a directory whose node_modules hold @credo-ts/{core,didcomm,askar,node} and @openwallet-foundation/askar-nodejs
// (a keyring-wallet bifold checkout works). Nothing in this file knows any implementation under test.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { toMultibase } from "../../crypto/base58.ts";
import { jcsBytes } from "../../util/json.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export type DidCommVersion = "v1" | "v2";

export const V1_MESSAGE_TYPE = "https://trusttasks.org/binding/didcomm-v1/0.2/trust-task/1.0/task";
export const V1_ATTACHMENT_ID = "trust-task";
export const V2_MESSAGE_TYPE = "https://trusttasks.org/binding/didcomm/0.1/envelope";

/**
 * RFC 0008 thread id shape, which Credo enforces on `~thread` (bindings/didcomm-v1 0.2 section 3.1). Credo-TS applies the same check to a
 * DIDComm v2 `thid`/`pthid` (its v2 receiver normalises the plaintext to a v1 shape and validates `~thread`), so a document id such as
 * `urn:uuid:...` (colons) is not accepted there either. Credo also accepts a DID as the id.
 */
export function threadRepresentable(id: unknown): id is string {
  return typeof id === "string" && /^[-_./a-zA-Z0-9]{8,64}$/.test(id);
}

/** The thread headers a v2 envelope can carry for a document: `thid` from threadId (else id), `pthid` from parentThreadId, each only when representable. */
export function v2ThreadHeaders(d: Record<string, unknown>): { thid?: string; pthid?: string } {
  const out: { thid?: string; pthid?: string } = {};
  const thid = d.threadId ?? d.id;
  if (threadRepresentable(thid)) out.thid = thid;
  if (threadRepresentable(d.parentThreadId)) out.pthid = d.parentThreadId;
  return out;
}

/**
 * Remove the `Matches` constraint Credo-TS puts on `~thread.thid` / `~thread.pthid` (ThreadDecorator), in this process only. Returns how many
 * constraints were removed. A v2 `thid` is any string (DIDComm v2 section 2); the binding recommends the document's threadId, which is a URN.
 */
export function relaxThreadIdValidation(classValidator: Any): number {
  const storage = classValidator.getMetadataStorage();
  let removed = 0;
  for (const [target, metas] of storage.validationMetadatas as Map<Any, Any[]>) {
    if (target?.name !== "ThreadDecorator") continue;
    const keep = metas.filter((m: Any) => !((m.propertyName === "threadId" || m.propertyName === "parentThreadId") && m.name === "matches"));
    removed += metas.length - keep.length;
    storage.validationMetadatas.set(target, keep);
  }
  return removed;
}

export interface CarrierOptions {
  root: string;
  version: DidCommVersion;
  label?: string;
  /** Local port of the carrier's own inbound HTTP endpoint (the peer replies to it). */
  inboundPort: number;
  host?: string;
}

/** The DIDs of the connection an inbound document arrived on, as Credo resolved it (a rotating peer answers from another DID than the invitation's). */
export interface PeerInfo {
  myDid?: string;
  theirDid?: string;
}

export interface ConnectionInfo {
  connectionId: string;
  myDid: string;
  theirDid: string;
}

export class DidCommCarrier {
  readonly opts: CarrierOptions;
  private agent: Any;
  private dc: Any;
  private V1: Any;
  private V2: Any;
  private listeners: ((connectionId: string, text: string, peer: PeerInfo) => void)[] = [];

  constructor(opts: CarrierOptions) {
    this.opts = opts;
  }

  onDocument(fn: (connectionId: string, text: string, peer: PeerInfo) => void): void {
    this.listeners.push(fn);
  }

  async start(): Promise<void> {
    const req = createRequire(join(this.opts.root, "package.json"));
    // askar-nodejs registers the native binding when it is first required; Credo's ES modules snapshot the binding at link time, so it must come first.
    const { askar } = req("@openwallet-foundation/askar-nodejs");
    const core = req("@credo-ts/core");
    const dc = req("@credo-ts/didcomm");
    const { AskarModule } = req("@credo-ts/askar");
    const { agentDependencies, DidCommHttpInboundTransport } = req("@credo-ts/node");
    const { Expose } = req("class-transformer");
    this.dc = dc;
    const host = this.opts.host ?? "127.0.0.1";
    const v2 = this.opts.version === "v2";

    class V1Message extends dc.DidCommMessage {
      constructor(o?: { document: Record<string, unknown> }) {
        super();
        if (o !== undefined) {
          this.id = this.generateId();
          this.appendedAttachments = [
            new dc.DidCommAttachment({ id: V1_ATTACHMENT_ID, mimeType: "application/json", data: new dc.DidCommAttachmentData({ json: o.document }) }),
          ];
          const thid = o.document.threadId ?? o.document.id;
          if (threadRepresentable(thid)) this.setThread({ threadId: thid });
        }
      }
      get document(): Record<string, unknown> | undefined {
        const a = this.appendedAttachments?.find((x: Any) => x.id === V1_ATTACHMENT_ID);
        return a?.getDataAsJson();
      }
    }
    (V1Message as Any).type = dc.parseMessageType(V1_MESSAGE_TYPE);
    (V1Message.prototype as Any).type = V1_MESSAGE_TYPE;
    dc.IsValidMessageType((V1Message as Any).type)(V1Message.prototype, "type");
    this.V1 = V1Message;

    // v2: Credo's v2 packer calls toV2Plaintext(), so the wire shape is exactly the binding's. Inbound, Credo spreads `body` next to the
    // DIDComm members, so the document's own id/type/threadId/parentThreadId land on renamed fields and the document is reassembled.
    const LAYER = new Set(["from", "to", "created_time", "expires_time", "return_route", "from_prior"]);
    class V2Message extends dc.DidCommMessage {
      allowDidSovPrefix = false;
      supportedDidCommVersions = ["v2"];
      outbound?: Record<string, unknown>;
      documentId?: string;
      documentType?: string;
      documentThreadId?: string;
      documentParentThreadId?: string;
      constructor(o?: { document: Record<string, unknown> }) {
        super();
        if (o !== undefined) {
          this.id = this.generateId();
          this.outbound = o.document;
        }
      }
      toV2Plaintext(): Record<string, unknown> {
        const d = this.outbound!;
        const pt: Record<string, unknown> = { id: this.id, type: V2_MESSAGE_TYPE, body: d };
        // The binding says SHOULD for thid/pthid (section 3.1); a header the peer's Credo would reject as malformed is left out, and the
        // document's own threadId/parentThreadId inside `body` carry the correlation.
        return { ...pt, ...v2ThreadHeaders(d) };
      }
      get document(): Record<string, unknown> | undefined {
        if (this.outbound !== undefined) return this.outbound;
        const json = this.toJSON() as Record<string, unknown>;
        const doc: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(json)) {
          if (k.startsWith("@") || k.startsWith("~") || LAYER.has(k) || v === undefined) continue;
          doc[k] = v;
        }
        return typeof doc.id === "string" && typeof doc.type === "string" ? doc : undefined;
      }
    }
    (V2Message as Any).type = dc.parseMessageType(V2_MESSAGE_TYPE);
    (V2Message.prototype as Any).type = V2_MESSAGE_TYPE;
    dc.IsValidMessageType((V2Message as Any).type)(V2Message.prototype, "type");
    Expose({ name: "id" })(V2Message.prototype, "documentId");
    Expose({ name: "type" })(V2Message.prototype, "documentType");
    Expose({ name: "threadId" })(V2Message.prototype, "documentThreadId");
    Expose({ name: "parentThreadId" })(V2Message.prototype, "documentParentThreadId");
    this.V2 = V2Message;
    // The peer's replies carry `thid` = the document's threadId (a request id such as `urn:uuid:...`), which Credo's `~thread` check rejects:
    // the message is dropped before any handler runs and the sender is sent a problem report. The check is RFC 0008 (v1) hygiene that the
    // binding does not impose on a v2 `thid`, so on this client it is lifted for the thread ids only (see `relaxThreadIdValidation`).
    if (v2) relaxThreadIdValidation(req("class-validator"));

    const agent = new core.Agent({
      config: { logger: new core.ConsoleLogger(core.LogLevel.Error) },
      dependencies: agentDependencies,
      modules: {
        askar: new AskarModule({ askar, store: { id: `carrier-${Date.now()}-${process.pid}`, key: "carrier-key", database: { type: "sqlite", config: { inMemory: true } } } }),
        didcomm: new dc.DidCommModule({
          endpoints: [`http://${host}:${this.opts.inboundPort}`],
          didcommVersions: v2 ? ["v1", "v2"] : ["v1"],
          connections: { autoAcceptConnections: true, autoCreateConnectionOnFirstMessage: v2 },
        }),
      },
    });
    agent.modules.didcomm.registerInboundTransport(new DidCommHttpInboundTransport({ port: this.opts.inboundPort }));
    agent.modules.didcomm.registerOutboundTransport(new dc.DidCommHttpOutboundTransport());
    const registry = agent.dependencyManager.container.resolve(dc.DidCommMessageHandlerRegistry);
    const on = (cls: Any) =>
      registry.registerMessageHandler({
        supportedMessages: [cls],
        handle: async (ctx: Any) => {
          const doc = ctx.message.document;
          if (doc !== undefined && ctx.connection !== undefined) for (const l of this.listeners) l(ctx.connection.id, JSON.stringify(doc), { myDid: ctx.connection.did, theirDid: ctx.connection.theirDid });
          return undefined;
        },
      });
    on(this.V1);
    if (v2) on(this.V2);
    await agent.initialize();
    this.agent = agent;
  }

  /** Accept an out-of-band invitation URL (v1 `oob=` or v2 `_oob=`) and wait for the connection. */
  async connect(invitationUrl: string, timeoutMs = 20000): Promise<ConnectionInfo> {
    const res = await this.agent.modules.didcomm.oob.receiveInvitationFromUrl(invitationUrl, { label: this.opts.label ?? "conformance-harness" });
    let rec = res.connectionRecord;
    if (rec === undefined) throw new Error("invitation produced no connection record");
    rec = await this.agent.modules.didcomm.connections.returnWhenIsConnected(rec.id, { timeoutMs });
    return { connectionId: rec.id, myDid: rec.did, theirDid: rec.theirDid };
  }

  /** Pack and send one document. The caller supplies the exact text; it is parsed only to be placed in the message. */
  async send(connectionId: string, documentText: string): Promise<void> {
    const dc = this.dc;
    const document = JSON.parse(documentText) as Record<string, unknown>;
    const connection = await this.agent.modules.didcomm.connections.getById(connectionId);
    const sender = this.agent.dependencyManager.container.resolve(dc.DidCommMessageSender);
    const message = this.opts.version === "v2" ? new this.V2({ document }) : new this.V1({ document });
    await sender.sendMessage(new dc.DidCommOutboundMessageContext(message, { agentContext: this.agent.context, connection }));
  }

  /**
   * Sign a document with the key behind this connection's own DID (the DID the peer takes as the document's issuer): a Data Integrity
   * proof, eddsa-jcs-2022 (the suite's `src/crypto/proof.ts` form), `proofPurpose` as given. The key stays in Credo's key store.
   */
  async signAs(connectionId: string, doc: Record<string, unknown>, opts: { purpose?: string; created?: string } = {}): Promise<Record<string, unknown>> {
    const connection = await this.agent.modules.didcomm.connections.getById(connectionId);
    const did: string = connection.did;
    const resolved = await this.agent.dids.resolveDidDocument(did);
    const purpose = opts.purpose ?? "authentication";
    const rel = purpose === "assertionMethod" ? resolved.assertionMethod : resolved.authentication;
    const first = (rel ?? resolved.authentication ?? [])[0];
    const vmId: string = typeof first === "string" ? first : first.id;
    const full = vmId.startsWith("#") ? `${did}${vmId}` : vmId;
    const created = (await this.agent.dids.getCreatedDids({ did }))[0];
    const key = created?.keys?.find((k: Any) => full.endsWith(k.didDocumentRelativeKeyId) || k.didDocumentRelativeKeyId === vmId);
    if (key === undefined) throw new Error(`no key for ${full} in the created DID record`);
    const { proof: _drop, ...body } = doc;
    const config: Record<string, unknown> = { type: "DataIntegrityProof", cryptosuite: "eddsa-jcs-2022", created: opts.created ?? new Date().toISOString().replace(/\.\d+Z$/, "Z"), verificationMethod: full, proofPurpose: purpose };
    const sha = (b: Uint8Array): Uint8Array => new Uint8Array(createHash("sha256").update(b).digest());
    const data = new Uint8Array([...sha(jcsBytes(config)), ...sha(jcsBytes(body))]);
    const signed = await this.agent.kms.sign({ keyId: key.kmsKeyId, algorithm: "EdDSA", data });
    return { ...body, proof: { ...config, proofValue: toMultibase(new Uint8Array(signed.signature)) } };
  }

  async stop(): Promise<void> {
    if (this.agent !== undefined) await this.agent.shutdown();
  }
}
