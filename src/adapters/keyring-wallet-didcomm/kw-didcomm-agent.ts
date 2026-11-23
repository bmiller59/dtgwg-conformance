// SPDX-License-Identifier: Apache-2.0
// @ts-nocheck
// The real-agent half of the keyring-wallet-didcomm host. Loaded (by KW_REAL_AGENT) by ../keyring-wallet/kw-host.jest.ts, which then
// serves the same trigger / observe / clock helpers over loopback it serves for the shim adapter, but against THIS agent: a real Credo
// agent (askar-nodejs, in-memory store, DIDComm v1 over HTTP) with the wallet's own ceremony.setupTrustTasksInbound registered.
// Only the control plane is out of band; the data path is real DIDComm.
//
// The inbound transport is a port of @credo-ts/node's DidCommHttpInboundTransport bound to the wallet's NESTED @credo-ts/didcomm copy
// (the hoisted node package resolves the other copy, whose DI tokens differ).
import { writeFileSync } from "node:fs";

const KW_ROOT = process.env.KW_ROOT;
const CORE = `${KW_ROOT}/bifold/packages/core`;
const TT = `${CORE}/src/modules/trust-tasks`;
const PORT = Number(process.env.KW_DIDCOMM_PORT ?? 38201);
const V2 = process.env.KW_DIDCOMM_VERSIONS === "v1,v2";
const nested = (m: string) => require(require.resolve(m, { paths: [CORE] }));

let instance: any;

export async function agent(): Promise<any> {
  if (instance !== undefined) return instance;
  const { askar } = nested("@openwallet-foundation/askar-nodejs");
  const core = nested("@credo-ts/core");
  const dc = nested("@credo-ts/didcomm");
  const { AskarModule } = nested("@credo-ts/askar");
  const { agentDependencies } = nested("@credo-ts/node");
  const { createServer } = require("node:http");
  const { ReplaySubject, filter, firstValueFrom, take, timeout } = nested("rxjs");

  class WalletHttpInbound {
    port: number;
    server: any;
    constructor(port: number) {
      this.port = port;
    }
    async start(agentContext: any) {
      const transportService = agentContext.dependencyManager.resolve(dc.DidCommTransportService);
      const types = [dc.DidCommMimeType.V0, dc.DidCommMimeType.V1];
      this.server = createServer((rq: any, rs: any) => {
        let body = "";
        rq.on("data", (c: any) => (body += c));
        rq.on("end", async () => {
          const ct = rq.headers["content-type"];
          if (!ct || !types.includes(ct)) {
            rs.statusCode = 415;
            return rs.end("unsupported");
          }
          const session = {
            id: core.utils.uuid(),
            type: "http",
            close: async () => {
              if (!rs.headersSent) rs.end();
            },
            send: async (_ctx: any, enc: any) => {
              rs.statusCode = 200;
              rs.setHeader("content-type", ct);
              rs.end(JSON.stringify(enc));
            },
          };
          try {
            const enc = JSON.parse(body);
            const ee = agentContext.dependencyManager.resolve(core.EventEmitter);
            const subject = new ReplaySubject(1);
            ee.observable(dc.DidCommEventTypes.DidCommMessageProcessed).pipe(filter((e: any) => e.payload.encryptedMessage === enc), timeout({ first: 10000 }), take(1)).subscribe(subject);
            ee.emit(agentContext, { type: dc.DidCommEventTypes.DidCommMessageReceived, payload: { message: enc, session } });
            await firstValueFrom(subject);
            if (!rs.headersSent) (rs.statusCode = 200), rs.end();
          } catch (e: any) {
            console.error("wallet inbound error:", e.message);
            if (!rs.headersSent) (rs.statusCode = 500), rs.end("err");
          } finally {
            transportService.removeSession(session);
          }
        });
      });
      this.server.listen(this.port, "127.0.0.1");
    }
    async stop() {
      // Keep-alive connections from the carriers would hold close() open for ever.
      this.server.closeAllConnections?.();
      await new Promise<void>((r) => this.server.close(() => r()));
    }
  }

  const a = new core.Agent({
    config: { logger: new core.ConsoleLogger(process.env.KW_LOG === "warn" ? core.LogLevel.Warn : core.LogLevel.Error) },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({ askar, store: { id: `kw-didcomm-${Date.now()}-${process.pid}`, key: "kw-didcomm-key", database: { type: "sqlite", config: { inMemory: false, path: require("node:path").join(process.env.KW_STORE_DIR ?? require("node:os").tmpdir(), `kw-didcomm-${process.pid}.sqlite`) } } } }),
      relationshipDid: new (require(`${CORE}/src/modules/vrc/module/RelationshipDidModule`).RelationshipDidModule)(),
      didcomm: new dc.DidCommModule({
        endpoints: [`http://127.0.0.1:${PORT}`],
        useDidSovPrefixWhereAllowed: true,
        didcommVersions: V2 ? ["v1", "v2"] : ["v1"],
        ...(V2 ? { peerDidNumAlgoForV2OOB: core.PeerDidNumAlgo.MultipleInceptionKeyWithoutDoc } : {}),
        connections: { autoAcceptConnections: true, autoCreateConnectionOnFirstMessage: V2 },
      }),
    },
  });
  a.modules.didcomm.registerInboundTransport(new WalletHttpInbound(PORT));
  a.modules.didcomm.registerOutboundTransport(new dc.DidCommHttpOutboundTransport());
  await a.initialize();
  instance = a;
  return a;
}

/** Called once by the host after the wallet's inbound registration: publish the (multi-use) OOB invitation. */
export async function publishInvitation(a: any): Promise<string> {
  const oob = await a.modules.didcomm.oob.createInvitation(V2 ? { didCommVersion: "v2" } : { multiUseInvitation: true });
  const url = oob.outOfBandInvitation.toUrl({ domain: `http://127.0.0.1:${PORT}` });
  if (process.env.KW_INVITATION_FILE) writeFileSync(process.env.KW_INVITATION_FILE, JSON.stringify({ invitationUrl: url }));
  return url;
}

export async function shutdown(): Promise<void> {
  if (instance !== undefined) await Promise.race([instance.shutdown().catch(() => undefined), new Promise((r) => setTimeout(r, 8000))]);
  instance = undefined;
}

/** A restart of the wallet process: the agent stops and starts again over the same (file-backed) store, as a wallet reopening its store would. */
export async function restart(): Promise<void> {
  await instance.shutdown();
  await instance.initialize();
}
