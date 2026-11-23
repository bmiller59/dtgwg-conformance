// SPDX-License-Identifier: Apache-2.0
// @ts-nocheck
// The wallet-side half of the keyring-wallet-vta-wire adapter. Loaded under keyring-wallet's own jest (babel, module mapping), because the
// wallet's trust-task code is TypeScript with React Native and Credo imports that run only there ("jest-hosted real code", decision 42).
//
// What is the wallet's own, original code: VtaClient (the phone as the manager of a VTA), VtiMediatorSession and
// VtiMediatorTransport (the mediator login with `affinidi.com/atm/1.0/authenticate`, the bearer WebSocket, messagepickup 3.0 live
// delivery, Routing 2.0 forward, authcrypt through Credo's DidCommV2EnvelopeService), the trust-task registry and the reply handling.
//
// What is a stand-in (class D, named in every run record):
//  - a `did:webvh` resolver over plain HTTP for the mediator's DID (Credo's own resolver set has none here and a loopback host is not a public
//    host); it reads the last log entry's `state` and does NOT verify the log;
//  - the VTA's mediator is handed to the client (a `did:key` VTA publishes no `DIDCommMessaging` service to read it from);
//  - the wallet's manager DID is granted on the VTA's ACL by the admin over REST (the enrolment ceremony is not run);
//  - an in-memory identity store and a throw-away Askar store.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { jweSummary, webvhLogUrl } from "./wire-util.ts";

const KW_ROOT = process.env.KW_ROOT ?? "../keyring-wallet";
const CORE = `${KW_ROOT}/bifold/packages/core`;
const TT = `${CORE}/src/modules/trust-tasks`;
const nested = (m: string) => require(require.resolve(m, { paths: [CORE] }));

export interface WireOptions {
  vtaDid: string;
  mediatorDid: string;
  /** JSON-lines wire trace; every line is {t, dir, kind, ...}. */
  tracePath?: string;
  storeDir?: string;
  /**
   * `shim` (default): the stand-in did:webvh resolver over plain HTTP (log not verified, service types normalised).
   * `real`: the wallet's own RetryingWebVhDidResolver (@credo-ts/webvh, didwebvh-ts: log verified); the only stand-in left is the scheme of its one
   * fetch (https -> http for a loopback host, because the loopback stack has no TLS). Whether the real path reads the mediator 0.48 document is the
   * subject of resolver-check.jest.ts and the ledger row for the wallet.
   */
  resolver?: "shim" | "real";
}

export function makeTracer(path?: string) {
  if (path !== undefined) mkdirSync(dirname(path), { recursive: true });
  const lines: any[] = [];
  const t0 = Date.now();
  return {
    lines,
    log(entry: Record<string, unknown>) {
      const e = { t: Date.now() - t0, ...entry };
      lines.push(e);
      if (path !== undefined) appendFileSync(path, JSON.stringify(e) + "\n");
    },
  };
}

export async function buildWireAgent(o: WireOptions) {
  const trace = makeTracer(o.tracePath);
  const { askar } = nested("@openwallet-foundation/askar-nodejs");
  const core = nested("@credo-ts/core");
  const dc = nested("@credo-ts/didcomm");
  const { AskarModule } = nested("@credo-ts/askar");
  const { agentDependencies } = nested("@credo-ts/node");

  // Stand-in: did:webvh over HTTP, no log verification.
  class WebvhHttpResolver {
    allowsCaching = false;
    allowsLocalDidRecord = false;
    supportedMethods = ["webvh"];
    async resolve(_ctx: any, did: string) {
      try {
        // a loopback VTA answers a burst of reads now and then with something that is not its log (a rate limit): read again, a few times, before giving up
        let state: any, res: any;
        for (let attempt = 0; state === undefined && attempt < 4; attempt++) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
          res = await fetch(webvhLogUrl(did));
          const text = await res.text();
          try { state = text.trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.state !== undefined).pop()?.state; } catch { state = undefined; }
        }
        if (state === undefined) throw new Error(`no did:webvh state in the log of ${did} (HTTP ${res?.status})`);
        // Mediator 0.48 writes `service[].type` as an array (["DIDCommMessaging"]); Credo's DidCommV2Service wants a string.
        for (const s of state.service ?? []) if (Array.isArray(s.type)) s.type = s.type[0];
        trace.log({ dir: "http", kind: "did-resolve", did, url: webvhLogUrl(did), status: res.status, standIn: "webvh-over-http-unverified" });
        return { didResolutionMetadata: {}, didDocument: core.JsonTransformer.fromJSON(state, core.DidDocument), didDocumentMetadata: {} };
      } catch (e: any) {
        return { didResolutionMetadata: { error: "notFound", message: e.message }, didDocument: null, didDocumentMetadata: {} };
      }
    }
  }

  // The wire log: HTTP calls to the mediator and every WebSocket frame, with JWE headers only.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    const res = await realFetch(input, init);
    if (url.includes("/mediator/v1/")) trace.log({ dir: "http", kind: "mediator", method: init?.method ?? "GET", url, status: res.status });
    return res;
  };
  const BaseWebSocket = globalThis.WebSocket ?? require(require.resolve("undici", { paths: [`${KW_ROOT}/bifold`] })).WebSocket;
  globalThis.WebSocket = class extends BaseWebSocket {
    constructor(url: string, protocols?: any) {
      super(url, protocols);
      trace.log({ dir: "ws", kind: "open", url, subprotocols: (Array.isArray(protocols) ? protocols : [protocols]).map((p: string) => (String(p).startsWith("bearer.") ? "bearer.<jwt>" : p)) });
      this.addEventListener("message", (ev: any) => trace.log({ dir: "ws<-", kind: "frame", ...frameSummary(ev.data) }));
      this.addEventListener("close", (ev: any) => trace.log({ dir: "ws", kind: "close", code: ev.code }));
    }
    send(data: any) {
      trace.log({ dir: "ws->", kind: "frame", ...frameSummary(data) });
      return super.send(data);
    }
  };
  const frameSummary = (data: any) => {
    const text = typeof data === "string" ? data : Buffer.from(data instanceof ArrayBuffer ? data : data.buffer ?? data).toString("utf8");
    return { bytes: text.length, jwe: jweSummary(text) };
  };

  if (o.resolver === "real") {
    const realFetch2 = globalThis.fetch;
    globalThis.fetch = (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      return realFetch2(url.replace(/^https:\/\/(localhost|127\.0\.0\.1)/, "http://$1"), init);
    };
  }
  const { RetryingWebVhDidResolver } = o.resolver === "real" ? require(`${CORE}/src/utils/RetryingWebVhDidResolver`) : ({} as any);
  const agent = new core.Agent({
    config: { logger: new core.ConsoleLogger(process.env.KW_LOG === "info" ? core.LogLevel.Info : core.LogLevel.Error) },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({ askar, store: { id: `kw-vta-wire-${Date.now()}-${process.pid}`, key: "kw-vta-wire-key", database: { type: "sqlite", config: { inMemory: true } } } }),
      dids: new core.DidsModule({ resolvers: [o.resolver === "real" ? new RetryingWebVhDidResolver() : new WebvhHttpResolver(), new core.KeyDidResolver(), new core.PeerDidResolver()] }),
      didcomm: new dc.DidCommModule({ didcommVersions: ["v2"], endpoints: [], connections: { autoAcceptConnections: true } }),
    },
  });
  await agent.initialize();
  // The jest tree nests two copies of @credo-ts/core: the proof code in @bifold/trust-tasks resolves its own copy's DI tokens (the app's Metro
  // bundle has one copy). Alias that copy's tokens to this agent's instances, as the shim host does.
  const proofCore = require(require.resolve("@credo-ts/core", { paths: [`${KW_ROOT}/bifold/packages/trust-tasks`] }));
  if (proofCore.Kms.KeyManagementApi !== core.Kms.KeyManagementApi) agent.dependencyManager.registerInstance(proofCore.Kms.KeyManagementApi, agent.kms);
  if (proofCore.DidResolverService !== core.DidResolverService) agent.dependencyManager.registerInstance(proofCore.DidResolverService, agent.dependencyManager.resolve(core.DidResolverService));

  // The plaintext leg: what Credo packs and what it opens (type, id, thread, from, to; the body only by key names).
  const EnvelopeService = dc.DidCommV2EnvelopeService;
  const realPack = EnvelopeService.prototype.pack;
  const realUnpack = EnvelopeService.prototype.unpack;
  const plainSummary = (m: any) => ({ type: m?.type, id: m?.id, thid: m?.thid, from: m?.from, to: m?.to, bodyKeys: m?.body && typeof m.body === "object" ? Object.keys(m.body) : undefined, taskType: m?.body?.type, taskId: m?.body?.id });
  EnvelopeService.prototype.pack = async function (ctx: any, plaintext: any, ...rest: any[]) {
    const out = await realPack.call(this, ctx, plaintext, ...rest);
    trace.log({ dir: "pack", kind: "authcrypt", plaintext: plainSummary(plaintext), jwe: jweSummary(out) });
    return out;
  };
  EnvelopeService.prototype.unpack = async function (ctx: any, enc: any, ...rest: any[]) {
    const out = await realUnpack.call(this, ctx, enc, ...rest);
    trace.log({ dir: "unpack", kind: "jwe", jwe: jweSummary(enc), plaintext: plainSummary(out?.plaintext ?? out) });
    return out;
  };

  const { VtaClient, VtaClientError } = require(`${TT}/module/VtaClient`);
  const { resolveVtiMediator } = require(`${TT}/module/VtiMediatorTransport`);
  const managers = new Map<string, any>();
  const store = {
    getManager: async (vta: string) => managers.get(vta),
    setManager: async (id: any) => void managers.set(id.vtaDid, id),
    forgetManager: async (vta: string) => void managers.delete(vta),
    listManagers: async () => [...managers.values()],
  };
  const client = new VtaClient(agent, o.vtaDid, store, { connectDrainMs: 500, onError: (e: Error) => trace.log({ dir: "client", kind: "error", message: e.message }) });
  // Stand-in: the VTA is a did:key and publishes no DIDCommMessaging service, so the mediator is handed over.
  client.mediator = await resolveVtiMediator(agent, o.mediatorDid);
  // Taps: every Trust Task document the wallet's session sends (the real class, its prototype) and every plaintext message that reaches the client.
  const tap: { onSend?: (to: string, plaintext: any) => void; onReceive?: (plaintext: any) => void } = {};
  const { VtiMediatorSession } = require(`${TT}/module/VtiMediatorTransport`);
  const realSendTo = VtiMediatorSession.prototype.sendTo;
  VtiMediatorSession.prototype.sendTo = async function (to: string, plaintext: any, ...rest: any[]) {
    try { tap.onSend?.(to, plaintext); } catch { /* a tap never breaks the wallet */ }
    return realSendTo.call(this, to, plaintext, ...rest);
  };
  const realDeliver = client.deliver.bind(client);
  client.deliver = (plaintext: any) => {
    try { tap.onReceive?.(plaintext); } catch { /* ditto */ }
    return realDeliver(plaintext);
  };
  trace.log({ dir: "client", kind: "mediator-endpoints", did: client.mediator.did, auth: client.mediator.authEndpoint, ws: client.mediator.wsEndpoint });
  return { agent, client, trace, core, dc, tap, forgetManagers: () => managers.clear() };
}
