// SPDX-License-Identifier: Apache-2.0
/**
 * @jest-environment node
 *
 * One-shot check (not a suite test): does the wallet's REAL did:webvh resolver path (RetryingWebVhDidResolver from @credo-ts/webvh, the one
 * utils/agent.ts registers) and its REAL mediator resolution (resolveVtiMediator) cope with the mediator 0.48 DID document, whose
 * `service[].type` is an array (["DIDCommMessaging"])? No test shim in the path. Needs the live mediator (KW_WIRE_MEDIATOR_DID).
 *   KW_WIRE_MEDIATOR_DID, KW_WIRE_OUT (results.json)
 */
// @ts-nocheck
import { writeFileSync } from "node:fs";

jest.setTimeout(5 * 60 * 1000);
const KW_ROOT = process.env.KW_ROOT ?? "../keyring-wallet";
const CORE = `${KW_ROOT}/bifold/packages/core`;
const nested = (m: string) => require(require.resolve(m, { paths: [CORE] }));

it("the wallet's real resolver path reads the mediator's DID document (array-typed service type)", async () => {
  jest.restoreAllMocks();
  const did = process.env.KW_WIRE_MEDIATOR_DID!;
  const { askar } = nested("@openwallet-foundation/askar-nodejs");
  const core = nested("@credo-ts/core");
  const dc = nested("@credo-ts/didcomm");
  const { AskarModule } = nested("@credo-ts/askar");
  const { agentDependencies } = nested("@credo-ts/node");
  const { RetryingWebVhDidResolver } = require(`${CORE}/src/utils/RetryingWebVhDidResolver`);
  const { resolveVtiMediator } = require(`${CORE}/src/modules/trust-tasks/module/VtiMediatorTransport`);
  // didwebvh-ts (inside the wallet's real resolver) always fetches https://<host>/...; the loopback stack serves http. The only stand-in here is
  // the scheme of that one fetch (https -> http for localhost); the response is the mediator's real did.jsonl and the real resolver verifies it.
  const realFetch = globalThis.fetch;
  const fetched: string[] = [];
  globalThis.fetch = (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    fetched.push(url);
    return realFetch(url.replace(/^https:\/\/localhost/, "http://localhost"), init);
  };
  const out: any = { fetched, did, resolver: "RetryingWebVhDidResolver (@credo-ts/webvh, didwebvh-ts, log verified)" };
  const agent = new core.Agent({
    config: { logger: new core.ConsoleLogger(core.LogLevel.Error) },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({ askar, store: { id: `resolver-check-${process.pid}`, key: "k", database: { type: "sqlite", config: { inMemory: true } } } }),
      dids: new core.DidsModule({ resolvers: [new RetryingWebVhDidResolver(), new core.KeyDidResolver(), new core.PeerDidResolver()] }),
      didcomm: new dc.DidCommModule({ didcommVersions: ["v2"], endpoints: [], connections: { autoAcceptConnections: true } }),
    },
  });
  await agent.initialize();
  try {
    const res = await agent.dids.resolve(did);
    out.resolveError = res.didResolutionMetadata?.error ?? null;
    out.resolveMessage = res.didResolutionMetadata?.message ?? null;
    out.docResolved = res.didDocument !== null && res.didDocument !== undefined;
    if (out.docResolved) out.services = (res.didDocument.service ?? []).map((s: any) => ({ cls: s.constructor.name, type: s.type, endpoint: JSON.stringify(s.serviceEndpoint) }));
    try {
      const m = await resolveVtiMediator(agent, did);
      out.resolveVtiMediator = { ok: true, authEndpoint: m.authEndpoint, wsEndpoint: m.wsEndpoint, kid: m.kid };
    } catch (e: any) {
      out.resolveVtiMediator = { ok: false, error: e.message };
    }
  } finally {
    await agent.shutdown().catch(() => undefined);
    writeFileSync(process.env.KW_WIRE_OUT!, JSON.stringify(out, null, 2));
  }
  expect(out).toBeDefined();
});
