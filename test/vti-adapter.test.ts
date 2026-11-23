// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { dispatch } from "../src/adapter/contract.ts";
import { DISCOVERY_V0_3, NOTIFY_TYPE, VTI_ADAPTER_NAME, VtiAdapter, configFromEnv } from "../src/adapters/vti/adapter.ts";
import { verifyDocumentProof } from "../src/crypto/proof.ts";
import { makeActors } from "../src/runner/engine.ts";
import { gateReason } from "../src/runner/suite.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { VECTORS } from "./helpers.ts";

const SERVICE_DID = "did:webvh:QmExample:localhost%3A8200";
const DID_DOC = { id: SERVICE_DID, verificationMethod: [{ id: `${SERVICE_DID}#key-0`, type: "Multikey", controller: SERVICE_DID, publicKeyMultibase: "z6Mkexample" }], authentication: [`${SERVICE_DID}#key-0`] };

interface Seen { method: string; url: string; headers: IncomingHttpHeaders; body: string }

/** A stand-in for the VTC's door: just enough of its observable behaviour (paths, statuses, answers) to test the adapter's mapping. */
function stubVtc(state: { seen: Seen[]; limited: number }): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString("utf8")));
    req.on("end", () => {
      state.seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      const json = (status: number, v: unknown): void => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(v));
      };
      if (req.url === "/.well-known/did.jsonl") {
        res.writeHead(200, { "content-type": "text/jsonl" });
        res.end(`${JSON.stringify({ versionId: "1-a", state: { id: "did:webvh:old" } })}\n${JSON.stringify({ versionId: "2-b", state: DID_DOC })}\n`);
        return;
      }
      if (req.url === "/health") return json(200, { status: "ok" });
      if (req.url !== "/v1/trust-tasks") {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }
      if (state.limited > 0) {
        state.limited--;
        res.writeHead(429, { "retry-after": "1" });
        res.end();
        return;
      }
      let doc: { id?: string; type?: string } = {};
      try {
        doc = JSON.parse(body) as typeof doc;
      } catch {
        return json(400, { type: "https://trusttasks.org/spec/trust-task-error/0.6", payload: { code: "malformedRequest", retryable: false } });
      }
      if (doc.type === DISCOVERY_V0_3) {
        return json(200, { type: `${DISCOVERY_V0_3}#response`, payload: { supportedTypes: [NOTIFY_TYPE, { type: DISCOVERY_V0_3 }], acceptanceWindow: { maxAgeSeconds: 600, clockSkewSeconds: 60 } } });
      }
      if (doc.type === NOTIFY_TYPE) {
        if (doc.id?.includes("bad")) return json(422, { type: "https://trusttasks.org/spec/trust-task-error/0.6", payload: { code: "proofInvalid", retryable: false } });
        if (doc.id?.includes("accepted-late")) return json(202, {});
        return json(200, { type: `${NOTIFY_TYPE}#response`, payload: { notificationId: "x", revision: 1 } });
      }
      return json(422, { type: "https://trusttasks.org/spec/trust-task-error/0.6", payload: { code: "unsupportedType", retryable: false } });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const a = server.address();
    resolve({ server, url: `http://127.0.0.1:${typeof a === "object" && a !== null ? a.port : 0}` });
  }));
}

const state = { seen: [] as Seen[], limited: 0 };
let url = "";
let server: Server;
before(async () => {
  ({ server, url } = await stubVtc(state));
});
after(() => server.close());

const doc = (id: string, type = NOTIFY_TYPE): string => JSON.stringify({ id, type, issuer: "did:key:zX", payload: {} });
const make = (extra: Partial<ConstructorParameters<typeof VtiAdapter>[0]> = {}): VtiAdapter => new VtiAdapter({ config: { baseUrl: url, version: "test" }, sleep: async () => undefined, ...extra });

describe("VTI adapter: identity and capabilities", () => {
  it("declares the exact name, clockFree (never clock), attested and https, and no capability VTI cannot back", async () => {
    const caps = await make().capabilities();
    assert.equal(caps.name, VTI_ADAPTER_NAME);
    assert.equal(caps.name, "verifiable-trust-infrastructure");
    assert.deepEqual(caps.bindings, ["https"]);
    assert.ok(caps.optional.includes("clockFree") && caps.optional.includes("attested"));
    assert.ok(caps.optional.includes("discovery.acceptanceWindow"));
    for (const never of ["clock", "proofVerify", "restart", "trigger.consent", "trigger.twoPhase", "ceremony", "observe.retained", "discovery.expiryHorizon", "transportIdentity"]) {
      assert.ok(!caps.optional.includes(never), `${never} must not be declared`);
    }
    assert.deepEqual(caps.carriers.map((c) => [c.typeUri, c.class]), [[NOTIFY_TYPE, "consequential"]]);
    assert.deepEqual(caps.window, { maxAgeSeconds: 600, clockSkewSeconds: 60, expiryHorizonSeconds: 2_592_000 });
    assert.deepEqual(caps.cryptosuites, ["eddsa-jcs-2022"]);
  });
  it("takes supportedTypes from a signed discovery 0.3 query addressed to the service", async () => {
    state.seen.length = 0;
    const caps = await make().capabilities();
    assert.deepEqual(caps.supportedTypes, [NOTIFY_TYPE, DISCOVERY_V0_3]);
    const q = state.seen.find((s) => s.url === "/v1/trust-tasks");
    assert.ok(q !== undefined);
    const sent = JSON.parse(q.body) as Record<string, unknown>;
    assert.equal(sent.type, DISCOVERY_V0_3);
    assert.equal(sent.recipient, SERVICE_DID);
    assert.equal(sent.issuer, makeActors().A!.vid);
    assert.equal(verifyDocumentProof(sent, { nowMs: Date.now(), skewMs: 60_000 }).valid, true);
    assert.equal(q.headers.authorization, undefined);
  });
  it("declares restart only when a compose directory is configured", async () => {
    const caps = await make({ config: { baseUrl: url, version: "t", composeDir: "/nonexistent" } }).capabilities();
    assert.ok(caps.optional.includes("restart"));
  });
  it("serves discovery 0.3 only, so the discovery vectors run against 0.3 and the horizon row is SKIP", async () => {
    const caps = await make().capabilities();
    assert.ok(!caps.supportedTypes.includes("https://trusttasks.org/spec/trust-task-discovery/0.4"));
    const vectors = loadSuite(VECTORS).files.flatMap((f) => f.file.vectors);
    const gate = (id: string): string | null => gateReason(vectors.find((v) => v.id === id)!, caps, 1, { clockless: true });
    assert.equal(gate("DIS-001"), null);
    assert.equal(gate("DIS-012"), null);
    assert.match(gate("DIS-013") ?? "", /trust-task-discovery\/0\.4/); // DIS-013 is a discovery 0.4 vector (the 0.3 window is closed)
    assert.match(gate("DIS-015") ?? "", /attested/);
  });
  it("is SKIP for the vectors that spoof the transport sender, since the VTC authenticates none", async () => {
    const caps = await make().capabilities();
    const vectors = loadSuite(VECTORS).files.flatMap((f) => f.file.vectors);
    for (const id of ["ID-002", "ID-004"]) assert.match(gateReason(vectors.find((v) => v.id === id)!, caps, 2, { clockless: true }) ?? "", /optional:transportIdentity/, id);
  });
  it("gates the vectors that need what VTI lacks: VRC types, 2PC, consent triggers and verifyProof rows", async () => {
    const caps = await make().capabilities();
    const vectors = loadSuite(VECTORS).files.flatMap((f) => f.file.vectors);
    for (const id of ["VRC-PRO-001", "WSH-006", "2PC-003", "PRF-001"]) {
      const v = vectors.find((x) => x.id === id);
      if (v === undefined) continue;
      const r = gateReason(v, caps, 2, { clockless: true });
      assert.ok(r !== null, `${id} must not be selected for VTI`);
    }
  });
});

describe("VTI adapter: provision", () => {
  it("returns the service DID and the last log state for iut, and the runner's did:key actors for harness roles", async () => {
    const p = await make().provision(["iut", "A", "W"]);
    assert.equal(p.iut!.vid, SERVICE_DID);
    assert.deepEqual(p.iut!.didDocument, DID_DOC);
    assert.equal(p.iut!.keyCustody, "iut");
    assert.equal(p.A!.vid, makeActors().A!.vid);
    assert.equal(p.W!.vid, makeActors().W!.vid);
    assert.equal(p.A!.keyCustody, "harness");
  });
  it("refuses an unknown role and a configured DID the VTC does not serve", async () => {
    await assert.rejects(make().provision(["nobody"]), /unknown harness role/);
    await assert.rejects(make({ config: { baseUrl: url, serviceDid: "did:webvh:other" } }).provision(["iut"]), /not the one the VTC serves/);
  });
});

describe("VTI adapter: send", () => {
  it("POSTs the bytes verbatim to /v1/trust-tasks with no Authorization header, whoever the sender is", async () => {
    const a = make();
    for (const from of [{ kind: "actor", vid: "did:key:zA" }, { kind: "none" }, { kind: "spoof", vid: "did:key:zX" }] as const) {
      state.seen.length = 0;
      const bytes = doc(`urn:uuid:${from.kind}`);
      const r = await a.send({ from, bytes });
      assert.equal(r.transport.status, 200);
      assert.equal(r.transport.kind, "document");
      assert.equal(r.transport.contentType, "application/json");
      const s = state.seen[0]!;
      assert.equal(s.method, "POST");
      assert.equal(s.url, "/v1/trust-tasks");
      assert.equal(s.body, bytes);
      assert.equal(s.headers.authorization, undefined);
      assert.equal(s.headers["content-type"], "application/json");
    }
  });
  it("maps the binding request line: other methods and paths are forwarded and reported as refused, with no reply document", async () => {
    const a = make();
    const get = await a.send({ from: { kind: "none" }, bytes: doc("u1"), http: { method: "GET" } });
    assert.deepEqual([get.transport.status, get.transport.kind, get.replies], [405, "refused", []]);
    const path = await a.send({ from: { kind: "none" }, bytes: doc("u2"), http: { path: "/trust-task" } });
    assert.deepEqual([path.transport.status, path.transport.kind, path.replies], [404, "refused", []]);
    assert.equal(state.seen.at(-1)!.url, "/v1/trust-task");
    state.seen.length = 0;
    await a.send({ from: { kind: "none" }, bytes: doc("u3"), http: { path: "/trust-tasks", contentType: "text/plain" } });
    assert.equal(state.seen[0]!.url, "/v1/trust-tasks");
    assert.equal(state.seen[0]!.headers["content-type"], "text/plain");
  });
  it("reports 202 as no document and keeps error documents as replies", async () => {
    const a = make();
    const late = await a.send({ from: { kind: "none" }, bytes: doc("accepted-late") });
    assert.deepEqual([late.transport.status, late.transport.kind, late.replies.length], [202, "none", 0]);
    const bad = await a.send({ from: { kind: "none" }, bytes: doc("bad-proof") });
    assert.deepEqual([bad.transport.status, bad.transport.kind, bad.replies.length], [422, "document", 1]);
  });
  it("waits out a 429 and resends the same bytes, within a bound", async () => {
    state.limited = 2;
    state.seen.length = 0;
    const waits: number[] = [];
    const a = make({ sleep: async (ms) => void waits.push(ms) });
    const r = await a.send({ from: { kind: "none" }, bytes: doc("urn:uuid:limited") });
    assert.equal(r.transport.status, 200);
    assert.deepEqual(waits, [1000, 1000]);
    assert.equal(state.seen.length, 3);
    assert.ok(state.seen.every((s) => s.body === state.seen[0]!.body));
    state.limited = 1000;
    const b = make({ config: { baseUrl: url, maxRateLimitWaitMs: 2500 }, sleep: async () => undefined });
    const gave = await b.send({ from: { kind: "none" }, bytes: doc("urn:uuid:limited2") });
    state.limited = 0;
    assert.deepEqual([gave.transport.status, gave.transport.kind], [429, "refused"]);
  });
});

describe("VTI adapter: pacing", () => {
  it("spaces sends by paceMs (waits only the remainder) and not at all when unset", async () => {
    const waits: number[] = [];
    const paced = make({ config: { baseUrl: url, paceMs: 400 }, sleep: async (ms) => void waits.push(ms) });
    await paced.send({ from: { kind: "none" }, bytes: doc("urn:uuid:p1") });
    assert.deepEqual(waits, []);
    await paced.send({ from: { kind: "none" }, bytes: doc("urn:uuid:p2") });
    assert.equal(waits.length, 1);
    assert.ok(waits[0]! > 0 && waits[0]! <= 400);
    const more: number[] = [];
    const free = make({ sleep: async (ms) => void more.push(ms) });
    await free.send({ from: { kind: "none" }, bytes: doc("urn:uuid:p3") });
    await free.send({ from: { kind: "none" }, bytes: doc("urn:uuid:p4") });
    assert.deepEqual(more, []);
  });
  it("reads VTI_PACE_MS from the environment and ignores a bad value", () => {
    assert.equal(configFromEnv({ VTI_PACE_MS: "260" }).paceMs, 260);
    assert.equal(configFromEnv({ VTI_PACE_MS: "x" }).paceMs, undefined);
    assert.equal(configFromEnv({ VTI_PACE_MS: "-1" }).paceMs, undefined);
  });
});

describe("VTI adapter: observe", () => {
  it("counts each carrier id once when VTI answers it, never refusals or other types, and reset zeroes it", async () => {
    const a = make();
    const handled = async (): Promise<number> => Number((await a.observe({ query: "handled" })).value);
    assert.equal(await handled(), 0);
    await a.send({ from: { kind: "none" }, bytes: doc("urn:uuid:h1") });
    assert.equal(await handled(), 1);
    await a.send({ from: { kind: "none" }, bytes: doc("urn:uuid:h1") }); // a redelivery of the same id
    assert.equal(await handled(), 1);
    await a.send({ from: { kind: "none" }, bytes: doc("urn:uuid:bad") });
    await a.send({ from: { kind: "none" }, bytes: doc("urn:uuid:other", "https://trusttasks.org/spec/conformance/gadget/0.1") });
    assert.equal(await handled(), 1);
    await a.send({ from: { kind: "none" }, bytes: doc("urn:uuid:h2") });
    assert.equal(await handled(), 2);
    assert.equal((await a.observe({ query: "documentState", id: "urn:uuid:h1" })).value, "responded");
    assert.equal((await a.observe({ query: "documentState", id: "urn:uuid:bad" })).value, "errored");
    assert.equal((await a.observe({ query: "documentState", id: "urn:uuid:never" })).value, "unknown");
    await a.reset();
    assert.equal(await handled(), 0);
    assert.equal((await a.observe({ query: "documentState", id: "urn:uuid:h1" })).value, "unknown");
  });
  it("answers stored vrc with zero (VTI hosts none) and refuses what it cannot see", async () => {
    const a = make();
    assert.equal((await a.observe({ query: "stored", kind: "vrc" })).value, 0);
    await assert.rejects(a.observe({ query: "stored", kind: "ceremony-effect" }), /not supported/);
    await assert.rejects(a.observe({ query: "retained", id: "x", side: "request" }), /not supported/);
  });
});

describe("VTI adapter: refusals and restart", () => {
  it("refuses over JSON-RPC every method it cannot honestly implement", async () => {
    const a = make();
    const calls: [string, unknown][] = [["trust", { vid: "did:key:zA" }], ["setClock", { iso: "2026-01-01T00:00:00Z" }], ["advance", { ms: 1 }], ["snapshot", {}], ["diff", { snapshotId: "s" }], ["verifyProof", { bytes: "{}" }], ["trigger", { action: "consent", args: {} }]];
    for (const [method, params] of calls) {
      const r = await dispatch(a, { jsonrpc: "2.0", id: 1, method, params });
      assert.ok("error" in r && r.error.code === -32000 && /not supported/.test(r.error.message), method);
    }
  });
  it("restart runs docker compose restart for the service with the project's profile, then waits for /health", async () => {
    const ran: [string, string[], string][] = [];
    const a = make({ config: { baseUrl: url, composeDir: "/kit", composeService: "vtc", composeProfile: "vtc" }, run: async (c, args, cwd) => void ran.push([c, args, cwd]) });
    await a.restart();
    assert.deepEqual(ran, [["docker", ["compose", "--profile", "vtc", "restart", "vtc"], "/kit"]]);
    await assert.rejects(make().restart(), /no compose directory/);
  });
  it("reads its configuration from the VTI_* environment", () => {
    assert.deepEqual(configFromEnv({ VTI_BASE_URL: "http://h:1", VTI_COMPOSE_DIR: "/k", VTI_VERSION: "v" }), { baseUrl: "http://h:1", composeDir: "/k", version: "v" });
  });
});

import { harnessDids, seedSteps } from "../src/adapters/vti/seed.ts";

describe("VTI harness ACL seeding", () => {
  it("covers exactly the runner's connection and relationship actors, as members, and brackets the adds with stop and start", () => {
    // B, C, D, F, G and H are the further members an essential-governance authority set may name; VTI declares no E that uses them yet.
    const actors = Object.entries(makeActors()).filter(([k]) => ["A", "X", "R", "S", "Q", "W"].includes(k));
    assert.deepEqual(harnessDids().map((d) => [d.role, d.did]), actors.map(([k, a]) => [k, a.vid]));
    const steps = seedSteps();
    assert.deepEqual(steps[0]!.args, ["compose", "--profile", "vtc", "stop", "vtc"]);
    assert.deepEqual(steps.at(-1)!.args, ["compose", "--profile", "vtc", "start", "vtc"]);
    const adds = steps.slice(1, -1);
    assert.equal(adds.length, 6);
    for (const s of adds) {
      assert.ok(s.args.includes("--no-deps") && s.args.includes("add"));
      assert.equal(s.args[s.args.indexOf("--role") + 1], "member");
    }
  });
});

describe("VTI adapter: rooms offer (ceremony track)", () => {
  it("records the administrator's step-up for exactly the payload of each gated rooms task before sending it", async () => {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const host = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString("utf8")));
      req.on("end", () => {
        const parsed = body === "" ? {} : (JSON.parse(body) as Record<string, unknown>);
        calls.push({ path: req.url ?? "", body: parsed });
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url === "/ctl/info") return void res.end(JSON.stringify({ baseUrl: `http://127.0.0.1:${(host.address() as { port: number }).port}`, vtcDid: SERVICE_DID }));
        if ((req.url ?? "").endsWith("/trust-tasks") && String(parsed.type).includes("community/create")) return void res.end(JSON.stringify({ type: `${String(parsed.type)}#response`, payload: { room: { room: { roomId: "did:key:zRoom" } } } }));
        if ((req.url ?? "").endsWith("/trust-tasks")) return void res.end(JSON.stringify({ type: `${String(parsed.type)}#response`, payload: {} }));
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((ok) => host.listen(0, "127.0.0.1", ok));
    try {
      const controlUrl = `http://127.0.0.1:${(host.address() as { port: number }).port}`;
      const a = new VtiAdapter({ config: { baseUrl: controlUrl, controlUrl, ceremony: true, version: "test" }, sleep: async () => undefined });
      await a.trigger("offerRoom", { vid: "did:key:zMember" });
      const steps = calls.filter((c) => c.path === "/ctl/stepup" || c.path.endsWith("/trust-tasks"));
      assert.deepEqual(steps.map((c) => (c.path === "/ctl/stepup" ? `stepup ${String(c.body.type).split("/rooms/")[1]}` : `send ${String(c.body.type).split("/rooms/")[1]}`)), [
        "stepup community/create/0.4", "send community/create/0.4", "stepup community/members/add/0.2", "send community/members/add/0.2",
      ]);
      const sent = calls.filter((c) => c.path.endsWith("/trust-tasks"));
      const stepped = calls.filter((c) => c.path === "/ctl/stepup");
      for (const i of [0, 1]) assert.deepEqual(stepped[i]?.body.payload, (sent[i]?.body as { payload?: unknown }).payload, "the gesture is for exactly the payload that is sent");
      assert.equal((sent[1]?.body as { payload: { roomId: string } }).payload.roomId, "did:key:zRoom");
    } finally {
      host.close();
    }
  });

  it("the community host declares the verifier seat of FC-KVX and of FC-CEX (same cex-query choreography)", async () => {
    const a = new VtiAdapter({ config: { baseUrl: "http://127.0.0.1:1", controlUrl: "http://127.0.0.1:1", version: "test" }, sleep: async () => undefined });
    (a as unknown as { discoverTypes: () => Promise<string[]> }).discoverTypes = async () => [];
    (a as unknown as { builtInRoles: () => Promise<string[]> }).builtInRoles = async () => [];
    const roles = (await a.capabilities()).ceremonyRoles ?? [];
    for (const c of ["FC-KVX", "FC-CEX"]) assert.deepEqual(roles.find((r) => r.ceremony === c)?.roles, ["verifier"]);
  });

  it("the ceremony host serves the community seat of FC-ONB (the administrator is its own console, not a participant)", async () => {
    const a = new VtiAdapter({ config: { baseUrl: "http://127.0.0.1:1", controlUrl: "http://127.0.0.1:1", ceremony: true, version: "test" }, sleep: async () => undefined });
    (a as unknown as { discoverTypes: () => Promise<string[]> }).discoverTypes = async () => [];
    (a as unknown as { builtInRoles: () => Promise<string[]> }).builtInRoles = async () => [];
    const roles = (await a.capabilities()).ceremonyRoles ?? [];
    assert.deepEqual(roles.find((r) => r.ceremony === "FC-ONB")?.roles, ["community"]);
  });
});
