// SPDX-License-Identifier: Apache-2.0
// The sign-in ceremony (group FC-AUT, docs/26 section 4) on the suite's own oracle: a starter, a reference service and a reference approver, all written from the specification text.
// The oracle trio completes every scenario, each deliberate breakage of the service ends the scenario that watches for it `failed`, and the version step-down scenario really steps down
// (claim 0.2 then 0.1, prove 0.3 then 0.2, respond at 0.2). The VTI adapter's Origin and DID-document rules are tested against stubs (no host, no wallet). Runs against VTI and the wallet are
// recorded outside the repository and are never part of this test. Never a statement about a platform, never a conformance count.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { HOST_PUBLIC_URL, VtiAdapter, configFromEnv } from "../src/adapters/vti/adapter.ts";
import { OOB_SERVICE_MUTANTS, OobServiceAdapter, PORTAL_ORIGIN } from "../src/adapters/reference/oob-service.ts";
import { loadScenarios } from "../src/ceremony/scenario.ts";
import { runScenarios } from "../src/ceremony/runner.ts";
import { makeAdapter } from "../src/runner/adapters.ts";
import { ed25519Signer, seedOf } from "../src/crypto/didkey.ts";
import { signDocument } from "../src/crypto/proof.ts";
import { VECTORS } from "./helpers.ts";

const IDS = Array.from({ length: 12 }, (_, i) => `FC-AUT-${String(i + 1).padStart(3, "0")}`);
const files = () => loadScenarios(join(VECTORS, "ceremony-scenarios")).files.map((f) => f.file);
const run = async (ids: string[], v = "reference-service", k = "reference-approver") => {
  const specs = { S: "reference-starter", V: v, K: k };
  return runScenarios(files(), { make: (s) => makeAdapter(specs[s as "S" | "V" | "K"]), specs, today: "2026-11-19", only: ids });
};

describe("sign-in ceremony: the oracle trio", () => {
  it("the group has twelve scenarios, channel proposed, evidence complete-ceremony, each step citing a specification", () => {
    const g = files().find((f) => f.group === "FC-AUT")!;
    assert.equal(g.scenarios.length, 12);
    assert.equal(g.ceremony.channel, "proposed");
    assert.equal(g.evidence, "complete-ceremony");
    for (const s of g.scenarios) for (const st of s.steps) if (st.do.initiate !== undefined) assert.ok(st.source !== undefined, `${s.id}/${st.id} has no source`);
  });
  it("every scenario ends as specified, never a conformance count", async () => {
    const r = await run(IDS);
    assert.equal(r.results.length, 12);
    for (const x of r.results) {
      assert.ok(x.status === "completed" || x.status === "ended-as-specified", `${x.id}: ${x.status} ${x.reason} (${x.failedStep})`);
      assert.equal(x.countedAsConformance, false);
      assert.equal(x.evidence, "complete-ceremony");
    }
    assert.deepEqual(r.results.filter((x) => x.status === "completed").map((x) => x.id), ["FC-AUT-001", "FC-AUT-005", "FC-AUT-011", "FC-AUT-012"]);
  });
  it("FC-AUT-011 steps down against a legacy community: claim 0.2 then 0.1, prove 0.3 then 0.2, respond and grant at 0.2, and never resends a refusal at the same version", async () => {
    const r = await run(["FC-AUT-011"]);
    assert.equal(r.results[0]!.status, "completed", r.results[0]!.reason);
    const built = r.transcript.filter((t) => t.kind === "built").map((t) => `${t.step}:${(JSON.parse(t.bytes) as { type: string }).type.split("/spec/")[1]}`);
    assert.deepEqual(built.filter((b) => /^(claim|prove|respond)/.test(b)), ["claim:auth/oob/claim/0.2", "claim:auth/oob/claim/0.1", "prove:auth/oob/prove/0.3", "prove:auth/oob/prove/0.2", "respond:auth/oob/respond/0.2"]);
    const grant = r.transcript.filter((t) => t.step === "respond" && t.kind === "built").map((t) => JSON.parse(t.bytes) as { payload: { grant: { type: string; payload: Record<string, unknown> } } })[0]!.payload.grant;
    assert.equal(grant.type, "https://trusttasks.org/spec/auth/oob/grant/0.2");
    assert.ok(typeof grant.payload.notAfter === "number" && grant.payload.sessionEndsAt === undefined, "a 0.2 grant carries notAfter in epoch seconds");
  });
  it("a community of the current ladder refuses claim 0.1 as unsupportedVersion with servedVersions (Type URIs, as VTI answers), and the request stays claimable (FC-AUT-012)", async () => {
    const r = await run(["FC-AUT-012"]);
    assert.equal(r.results[0]!.status, "completed", r.results[0]!.reason);
    const refusal = r.transcript.find((t) => t.kind === "reply" && t.step === "claim-old");
    const p = (JSON.parse(refusal!.bytes) as { payload: { code: string; details: { servedVersions: string[] } } }).payload;
    assert.equal(p.code, "unsupportedVersion");
    assert.deepEqual(p.details.servedVersions, ["https://trusttasks.org/spec/auth/oob/claim/0.2"]);
  });
  it("the service's DID document carries the two sign-in services on https, and the portal origin has no port", async () => {
    const doc = new OobServiceAdapter().didDocument() as { service: { type: string; serviceEndpoint: string }[] };
    const by = Object.fromEntries(doc.service.map((s) => [s.type, s.serviceEndpoint]));
    assert.equal(by.SignInPortal, `${PORTAL_ORIGIN}/members/`);
    assert.match(by.TrustTaskHTTPS!, /^https:\/\/[^/:]+\//);
  });
});

describe("sign-in ceremony: deliberate breakages of the service end the scenario that watches for them `failed`", () => {
  const WATCH: Record<(typeof OOB_SERVICE_MUTANTS)[number], string[]> = {
    claimTwice: ["FC-AUT-003"], noNumberCheck: ["FC-AUT-002"], nonMemberAccepted: ["FC-AUT-004"], claimAnswerUnsigned: ["FC-AUT-001"], claimAnswerWrongOrigin: ["FC-AUT-001"], cancelIgnored: ["FC-AUT-007"],
    redeemAnyKey: ["FC-AUT-006"], noDigestCheck: ["FC-AUT-009"], wrongKeyRespond: ["FC-AUT-008"], sessionBeforeApproval: ["FC-AUT-001"], identifyNoProofCheck: ["FC-AUT-010"],
  };
  for (const m of OOB_SERVICE_MUTANTS) for (const id of WATCH[m]) {
    it(`${m} is caught by ${id}`, async () => {
      const r = await run([id], `reference-service:mut=${m}`);
      assert.equal(r.results[0]!.status, "failed", `${m} should end ${id} failed, got ${r.results[0]!.status}`);
    });
  }
  it("every breakage is watched by at least one scenario", () => { for (const m of OOB_SERVICE_MUTANTS) assert.ok(WATCH[m].length > 0, m); });
});

describe("sign-in ceremony: scenarios a wallet cannot play are SKIP with a reason, not a failure", () => {
  it("the tamper scenarios are skipped for a participant that does not declare initiate.oobTamper, and FC-AUT-011 for a service that cannot be told its version", async () => {
    const noTamper = { async capabilities() { const c = await new (await import("../src/adapters/reference/oob-approver.ts")).OobApproverAdapter().capabilities(); return { ...c, optional: c.optional.filter((o) => o !== "initiate.oobTamper") }; } };
    const k = await makeAdapter("reference-approver");
    const caps = await noTamper.capabilities();
    const specs = { S: "reference-starter", V: "reference-service", K: "reference-approver" };
    const r = await runScenarios(files(), { make: async (s) => (s === "K" ? Object.assign(Object.create(k) as object, { capabilities: async () => caps }) as typeof k : makeAdapter(specs[s as "S" | "V"])), specs, today: "2026-11-19", only: ["FC-AUT-008", "FC-AUT-009", "FC-AUT-010", "FC-AUT-012"] });
    for (const x of r.results) { assert.equal(x.status, "skipped", x.id); assert.match(x.reason, /initiate\.oobTamper/); }
  });
});

interface Seen { url: string; headers: IncomingHttpHeaders; body: string }
describe("VTI adapter, ceremony track: the Origin of auth/oob/request and the sign-in services of the community's DID document", () => {
  let door: Server, ctl: Server, doorUrl = "", ctlUrl = "", info: Record<string, unknown> = {};
  const seen: Seen[] = [];
  const listen = (handler: Parameters<typeof createServer>[1]): Promise<{ s: Server; url: string }> => new Promise((ok) => { const s = createServer(handler); s.listen(0, "127.0.0.1", () => { const a = s.address(); ok({ s, url: `http://127.0.0.1:${typeof a === "object" && a !== null ? a.port : 0}` }); }); });
  before(async () => {
    ({ s: door, url: doorUrl } = await listen((req, res) => { let b = ""; req.on("data", (c: Buffer) => (b += c.toString())); req.on("end", () => { seen.push({ url: req.url ?? "", headers: req.headers, body: b }); res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); }); }));
    ({ s: ctl, url: ctlUrl } = await listen((req, res) => { req.resume(); req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(req.url === "/ctl/info" ? { baseUrl: doorUrl, vtcDid: "did:key:z6MkhXim6Hetcxrfi1DTuxo4XojsKcMtBFvYU7yDF652hL5n", ...info } : {})); }); }));
  });
  after(() => { door.close(); ctl.close(); });
  const key = ed25519Signer(seedOf(0x77));
  const req = (type: string): string => JSON.stringify(signDocument({ id: "urn:uuid:1", type, issuer: key.did, recipient: "did:key:z6MkhXim6Hetcxrfi1DTuxo4XojsKcMtBFvYU7yDF652hL5n", issuedAt: "2026-11-19T00:00:00Z", payload: {} }, key, { created: Date.now() }));
  const make = (extra: Record<string, unknown> = {}) => new VtiAdapter({ config: { controlUrl: ctlUrl, baseUrl: "http://127.0.0.1:0", apiPrefix: "/v1", version: "test", ceremony: true, ...extra }, sleep: async () => undefined });

  it("sends the portal's own origin, the public URL the host reports, not the loopback address, on auth/oob/request only", async () => {
    info = { publicUrl: "https://vtc.test" };
    const a = make();
    await a.provision(["peer"]);
    seen.length = 0;
    await a.send({ from: { kind: "none" }, bytes: req("https://trusttasks.org/spec/auth/oob/request/0.2") });
    await a.send({ from: { kind: "none" }, bytes: req("https://trusttasks.org/spec/auth/oob/claim/0.2") });
    assert.equal(seen[0]!.headers.origin, "https://vtc.test");
    assert.notEqual(seen[0]!.headers.origin, doorUrl);
    assert.equal(seen[1]!.headers.origin, undefined);
  });
  it("a host that does not report its public URL is the prebuilt host: its fixed http://vtc.test is used, and an environment value overrides it", async () => {
    info = {};
    const a = make();
    await a.provision(["peer"]);
    seen.length = 0;
    await a.send({ from: { kind: "none" }, bytes: req("https://trusttasks.org/spec/auth/oob/request/0.2") });
    assert.equal(seen[0]!.headers.origin, new URL(HOST_PUBLIC_URL).origin);
    assert.equal(configFromEnv({ VTI_PUBLIC_URL: "https://community.example" }).publicUrl, "https://community.example");
    const b = make({ publicUrl: "https://community.example" });
    await b.provision(["peer"]);
    seen.length = 0;
    await b.send({ from: { kind: "none" }, bytes: req("https://trusttasks.org/spec/auth/oob/request/0.2") });
    assert.equal(seen[0]!.headers.origin, "https://community.example");
  });
  it("the community's DID document names TrustTaskHTTPS and SignInPortal on the public URL, as VTI's own service entries do", async () => {
    info = { publicUrl: "https://vtc.test" };
    const out = await make().provision(["peer"]);
    const svc = (out.peer!.didDocument as { service: { type: string; serviceEndpoint: string }[] }).service;
    assert.equal(svc.find((s) => s.type === "SignInPortal")!.serviceEndpoint, "https://vtc.test/members/");
    assert.equal(svc.find((s) => s.type === "TrustTaskHTTPS")!.serviceEndpoint, "https://vtc.test/v1");
  });
  it("outside the ceremony track no Origin is sent", async () => {
    const a = make({ ceremony: false, baseUrl: doorUrl });
    seen.length = 0;
    await a.send({ from: { kind: "none" }, bytes: req("https://trusttasks.org/spec/auth/oob/request/0.2") });
    assert.equal(seen[0]!.headers.origin, undefined);
  });
});
