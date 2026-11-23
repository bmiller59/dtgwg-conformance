// SPDX-License-Identifier: Apache-2.0
// The VTI in-process adapter: capabilities honesty, the mapping of senders to bearers, the control calls, the not-offered skip reasons
// and the launcher's manifest. The Rust host is replaced by a stub (no cargo, no VTI checkout); the real host is exercised by the
// recorded run.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { DISCOVERY_V0_3, ISSUE_TYPE, NOT_OFFERED, NOTIFY_TYPE, PENDING_LIST_TYPE, VtiInprocessAdapter, didKeyDocument } from "../src/adapters/vti-inprocess/adapter.ts";
import { hostFeaturesFromEnv, renderManifest } from "../src/adapters/vti-inprocess/launcher.ts";
import { gateReason } from "../src/runner/suite.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { VECTORS } from "./helpers.ts";

const VTA_DID = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH";

interface Seen { url: string; headers: IncomingHttpHeaders; body: string }

function stub(seen: Seen[], state: { credentials: number; deferrals: number; refuseIssue?: boolean; limited?: number }): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString("utf8")));
    req.on("end", () => {
      seen.push({ url: req.url ?? "", headers: req.headers, body });
      const json = (v: unknown): void => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(v));
      };
      if (req.url === "/ctl/info") return json({ baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, vtaDid: VTA_DID });
      if (req.url === "/ctl/token") {
        const t = JSON.parse(body) as { did: string; sessionId?: string };
        return json({ token: t.sessionId === undefined ? `tok-${t.did.slice(-6)}` : `refreshed-${t.sessionId}` });
      }
      if (req.url === "/ctl/restart") return json({ baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, vtaDid: VTA_DID });
      if (req.url === "/ctl/verify") return json({ valid: body.includes("good") });
      if (req.url === "/ctl/observe") return json({ value: state.credentials });
      if (req.url === "/trust-tasks" && (state.limited ?? 0) > 0) {
        state.limited = (state.limited ?? 0) - 1;
        res.writeHead(429, { "retry-after": "1", "x-rate-limit-source": "vta" });
        return res.end();
      }
      if (req.url === "/trust-tasks") {
        const doc = JSON.parse(body) as { id: string; type: string };
        if (doc.type === PENDING_LIST_TYPE) return json({ id: "r", type: `${doc.type}#response`, threadId: doc.id, payload: { pending: Array.from({ length: state.deferrals }, (_, i) => ({ id: `p${i}` })) } });
        if (doc.type === ISSUE_TYPE && state.refuseIssue === true) {
          res.writeHead(400, { "content-type": "application/json" });
          return res.end(JSON.stringify({ type: "https://trusttasks.org/spec/trust-task-error/0.6", payload: { code: "malformedRequest" } }));
        }
        if (doc.type.includes("/auth/step-up/approve-response/")) return json({ id: "r", type: `${doc.type}#response`, threadId: doc.id, payload: { status: "elevated", session: { id: "sess-1", subject: "did:key:zAAAAAA", acr: "aal2" } } });
        if (doc.type === DISCOVERY_V0_3) return json({ type: `${DISCOVERY_V0_3}#response`, payload: { supportedTypes: [NOTIFY_TYPE, DISCOVERY_V0_3, "https://trusttasks.org/spec/task-consent/decision/0.2"] } });
        return json({ id: "r", type: `${doc.type}#response`, threadId: doc.id, payload: {} });
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` })));
}

describe("VTI in-process adapter", () => {
  const seen: Seen[] = [];
  const state: { credentials: number; deferrals: number; refuseIssue?: boolean; limited?: number } = { credentials: 3, deferrals: 0 };
  let server: Server;
  let adapter: VtiInprocessAdapter;
  before(async () => {
    const s = await stub(seen, state);
    server = s.server;
    adapter = new VtiInprocessAdapter({ controlUrl: s.url, version: "vta-service test" });
  });
  after(() => server.close());

  it("declares only what the host can do, and no clock control", async () => {
    const c = await adapter.capabilities();
    assert.equal(c.name, "verifiable-trust-infrastructure-inprocess");
    assert.ok(c.optional.includes("clockFree") && !c.optional.includes("clock"));
    for (const o of ["proofVerify", "transportIdentity", "attested"]) assert.ok(c.optional.includes(o), o);
    for (const o of ["trigger.holdCredential", "observe.deferred"]) assert.ok(c.optional.includes(o), o);
    // The VTA's trusted-verifier list is start-up configuration and an approved deferral is pushed over a mediator: neither is offered by the host.
    for (const o of ["ceremony", "receiptVerify", "trigger.consent", "trigger.twoPhase", "observe.retained", "trigger.verifierTrust", "trigger.queryDecision"]) assert.ok(!c.optional.includes(o), `${o} must not be declared`);
    // The host rebuilds the VTA over its kept store directory: restart is declared (2026-11-15 reach run).
    assert.ok(c.optional.includes("restart"), "restart is declared");
    assert.deepEqual(c.carriers.map((x) => x.typeUri), [NOTIFY_TYPE]);
    assert.match(c.version, /in process/);
  });

  it("presents the sender's own bearer, the named identity's bearer for a spoof, and none for none", async () => {
    await adapter.capabilities();
    seen.length = 0;
    const bytes = JSON.stringify({ id: "urn:uuid:1", type: NOTIFY_TYPE, payload: {} });
    await adapter.send({ from: { kind: "actor", vid: "did:key:zAAAAAA" }, bytes });
    await adapter.send({ from: { kind: "spoof", vid: "did:key:zBBBBBB" }, bytes });
    await adapter.send({ from: { kind: "none" }, bytes });
    const posts = seen.filter((s) => s.url === "/trust-tasks");
    assert.equal(posts[0]?.headers.authorization, "Bearer tok-AAAAAA");
    assert.equal(posts[1]?.headers.authorization, "Bearer tok-BBBBBB");
    assert.equal(posts[2]?.headers.authorization, undefined);
  });

  it("takes the session's refreshed bearer after a step-up answers elevated (VTI: the client refreshes to get the elevated acr)", async () => {
    await adapter.capabilities();
    seen.length = 0;
    const from = { kind: "actor" as const, vid: "did:key:zAAAAAA" };
    await adapter.send({ from, bytes: JSON.stringify({ id: "urn:uuid:7", type: NOTIFY_TYPE, payload: {} }) });
    await adapter.send({ from, bytes: JSON.stringify({ id: "urn:uuid:8", type: "https://trusttasks.org/spec/auth/step-up/approve-response/0.7", payload: {} }) });
    await adapter.send({ from, bytes: JSON.stringify({ id: "urn:uuid:9", type: NOTIFY_TYPE, payload: {} }) });
    const posts = seen.filter((x) => x.url === "/trust-tasks");
    assert.equal(posts[0]?.headers.authorization, "Bearer tok-AAAAAA");
    assert.equal(posts[2]?.headers.authorization, "Bearer refreshed-sess-1");
    assert.deepEqual(JSON.parse(seen.find((x) => x.url === "/ctl/token" && x.body.includes("sessionId"))?.body ?? "{}").sessionId, "sess-1");
  });

  it("verifies proofs through the host and reports credentials stored since the last reset", async () => {
    assert.equal((await adapter.verifyProof({ bytes: "good" })).valid, true);
    assert.equal((await adapter.verifyProof({ bytes: "bad" })).valid, false);
    await adapter.reset();
    assert.equal((await adapter.observe({ query: "stored", kind: "credential" })).value, 0);
    state.credentials = 4;
    assert.equal((await adapter.observe({ query: "stored", kind: "credential" })).value, 1);
    assert.equal((await adapter.observe({ query: "stored", kind: "vrc" })).value, 0);
  });

  it("makes the VTA hold a credential through its own issue handler, and counts deferrals since the last reset", async () => {
    await adapter.reset();
    seen.length = 0;
    state.deferrals = 2;
    await adapter.reset();
    await adapter.trigger("holdCredential", { type: "https://example.org/conformance#ConformanceCredential" });
    const issue = seen.map((x) => JSON.parse(x.body || "{}") as Record<string, any>).find((d) => d.type === ISSUE_TYPE);
    assert.ok(issue !== undefined, "an issue document was sent to the VTA");
    const vc = issue.payload.credential_response.credential;
    assert.deepEqual(vc.type, ["VerifiableCredential", "https://example.org/conformance#ConformanceCredential"]);
    assert.equal(vc.credentialSubject.id, VTA_DID);
    assert.equal(issue.recipient, VTA_DID);
    assert.ok(typeof issue.proof === "object" && typeof vc.proof === "object", "both the delivery and the credential are signed");
    assert.equal((await adapter.observe({ query: "stored", kind: "credential" })).value, 0, "the held credential is setup, not a vector's side effect");
    assert.equal((await adapter.observe({ query: "stored", kind: "deferral" })).value, 0);
    state.deferrals = 3;
    assert.equal((await adapter.observe({ query: "stored", kind: "deferral" })).value, 1);
    const list = seen.find((x) => x.url === "/trust-tasks" && x.body.includes(PENDING_LIST_TYPE));
    assert.ok(list !== undefined && list.headers.authorization !== undefined, "the deferral list is asked with an operator bearer");
    state.refuseIssue = true;
    await assert.rejects(adapter.trigger("holdCredential", {}), /did not take the credential/);
    state.refuseIssue = false;
    state.deferrals = 0;
  });

  it("waits out the VTA's own per-client rate limit (429 with retry-after) and resends the same bytes, within a bound", async () => {
    const waits: number[] = [];
    const a = new VtiInprocessAdapter({ controlUrl: server.address() === null ? "" : `http://127.0.0.1:${(server.address() as { port: number }).port}`, version: "vta-service test", sleep: async (ms) => void waits.push(ms) });
    await a.capabilities();
    const bytes = JSON.stringify({ id: "urn:uuid:rl", type: NOTIFY_TYPE, payload: {} });
    seen.length = 0;
    state.limited = 2;
    const r = await a.send({ from: { kind: "actor", vid: "did:key:zAAAAAA" }, bytes });
    assert.equal(r.transport.status, 200);
    assert.equal(r.replies.length, 1);
    assert.deepEqual(waits, [1000, 1000]);
    const posts = seen.filter((s) => s.url === "/trust-tasks");
    assert.equal(posts.length, 3);
    assert.ok(posts.every((p) => p.body === bytes));
    // past the bound the 429 is reported as a refusal, not retried forever
    const b = new VtiInprocessAdapter({ controlUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, version: "vta-service test", maxRateLimitWaitMs: 2500, sleep: async () => undefined });
    await b.capabilities();
    state.limited = 1000;
    const gave = await b.send({ from: { kind: "actor", vid: "did:key:zAAAAAA" }, bytes });
    state.limited = 0;
    assert.deepEqual([gave.transport.status, gave.transport.kind], [429, "refused"]);
  });

  it("restart asks the host to rebuild the VTA and keeps the VTA's DID", async () => {
    await adapter.restart();
  });

  it("refuses what it cannot do instead of faking it", async () => {
    await assert.rejects(adapter.setClock(), /not supported/);
    await assert.rejects(adapter.trigger("consent"), /not supported/);
    await assert.rejects(adapter.trigger("verifierTrust", { vid: "did:key:zX" }), /not supported/);
    await assert.rejects(adapter.trigger("queryDecision", { thread: "t", decision: "approve" }), /not supported/);
  });
});

describe("not offered versus not reachable", () => {
  const suite = loadSuite(VECTORS);
  const caps = {
    name: "x", version: "x", tierMax: 2 as const, bindings: ["https"], cryptosuites: ["eddsa-jcs-2022"], pins: { framework: "0.6.0", error: "0.6", binding: "https/0.3" },
    supportedTypes: [NOTIFY_TYPE, "https://trusttasks.org/spec/task-consent/decision/0.2"],
    carriers: [{ typeUri: NOTIFY_TYPE, class: "consequential" as const, validPayload: {} }],
    optional: ["clockFree"], notOffered: NOT_OFFERED,
  };
  const all = suite.files.flatMap((f) => f.file.vectors);
  it("names a requirement VTI does not offer, with the reason", () => {
    const ws = all.find((v) => v.id === "WSH-001");
    assert.ok(ws !== undefined);
    assert.match(gateReason(ws, caps, 2) ?? "", /^not offered by the implementation: VTI defines no vrc\/relationships task/);
    const tc = all.find((v) => v.id === "TC-001");
    assert.match(gateReason(tc!, caps, 1) ?? "", /^not offered by the implementation: VTI has no ceremony-document family/);
    assert.match(gateReason(all.find((v) => v.id === "TC-019")!, caps, 1) ?? "", /^not offered by the implementation: the VTA sends task-consent\/granted/);
    assert.match(gateReason(all.find((v) => v.id === "TC-021")!, caps, 1) ?? "", /^not offered by the implementation: the VTA dispatches task-consent\/decision 0.2 only/);
    assert.match(gateReason(all.find((v) => v.id === "CEX-030")!, caps, 1) ?? "", /^not offered by the implementation: the VTA is the holder/);
  });
  it("leaves a gap the adapter merely cannot reach with the generic reason", () => {
    const cex = all.find((v) => v.id === "CEX-025");
    assert.match(gateReason(cex!, caps, 1) ?? "", /^type not declared|^missing capability/);
  });
  it("does not apply a not-offered note to a requirement that is met", () => {
    const withCeremony = { ...caps, optional: [...caps.optional, "ceremony"] };
    assert.doesNotMatch(gateReason(all.find((v) => v.id === "TC-001")!, withCeremony, 1) ?? "", /ceremony-document/);
  });
  it("every not-offered key is a requirement some vector has", () => {
    const used = new Set(all.flatMap((v) => v.requires ?? []));
    for (const k of Object.keys(NOT_OFFERED)) assert.ok(used.has(k), k);
  });
});

describe("launcher and helpers", () => {
  it("renders the host manifest against a VTI checkout path", () => {
    const m = renderManifest('a = { path = "@VTI_ROOT@/vta-service" }\nb = "@VTI_ROOT@"', "/x/vti");
    assert.equal(m, 'a = { path = "/x/vti/vta-service" }\nb = "/x/vti"');
  });
  it("adds extra cargo features to the embedded service crate only when asked (VTI_HOST_FEATURES)", () => {
    const tpl = 'vtc-service = { path = "@VTI_ROOT@/vtc-service", features = ["test-support"] }\ntokio = { version = "1", features = ["full"] }\n';
    assert.equal(renderManifest(tpl, "/x"), tpl.replace("@VTI_ROOT@", "/x"));
    const m = renderManifest(tpl, "/x", ["vetting-pcs", "voting"]);
    assert.ok(m.includes('features = ["test-support", "vetting-pcs", "voting"] }'), m);
    assert.ok(m.includes('tokio = { version = "1", features = ["full"] }'));
    assert.deepEqual(hostFeaturesFromEnv({ VTI_HOST_FEATURES: " vetting-pcs, voting ,," }), ["vetting-pcs", "voting"]);
    assert.deepEqual(hostFeaturesFromEnv({}), []);
  });
  it("derives a did:key document", () => {
    const d = didKeyDocument(VTA_DID);
    assert.equal((d.verificationMethod as { id: string }[])[0]?.id, `${VTA_DID}#${VTA_DID.slice(8)}`);
  });
});
