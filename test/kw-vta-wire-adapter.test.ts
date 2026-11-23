// SPDX-License-Identifier: Apache-2.0
// The stdio/JSON-RPC adapter of the keyring-wallet-vta-wire row: capabilities, the operator client against a stub VTA, the V participant against
// stubs, and the launcher's jest command. Nothing here touches the wallet checkout, a mediator or a container.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { test } from "node:test";
import { OPTIONAL_CAPABILITIES } from "../src/adapter/contract.ts";
import { ed25519Signer, seedOf } from "../src/crypto/didkey.ts";
import { base58Encode } from "../src/crypto/base58.ts";
import { hostPlan } from "../src/adapters/keyring-wallet-vta-wire/host-control.ts";
import { Operator, OperatorRefused, seedFromMultibase } from "../src/adapters/keyring-wallet-vta-wire/operator.ts";
import { VWireAdapter } from "../src/adapters/keyring-wallet-vta-wire/v-adapter.ts";
import { approvalsUpsertPayload, synthesizeRego, regoString } from "../src/adapters/keyring-wallet-vta-wire/approvals-row.ts";
import { VtcWireAdapter } from "../src/adapters/keyring-wallet-vta-wire/vtc-adapter.ts";
import { COMMUNITY_GROUPS, WIRE_GROUPS, WIRE_MODE, communityCapabilities, kCapabilities, vCapabilities } from "../src/adapters/keyring-wallet-vta-wire/wire-caps.ts";

const seed = seedOf(0x61);
const vtaDid = "did:key:z6MkVtaStub";

test("seedFromMultibase reads a multicodec Ed25519 private key and refuses anything else", () => {
  const mb = "z" + base58Encode(Uint8Array.from([0x80, 0x26, ...seed]));
  assert.deepEqual(seedFromMultibase(mb), seed);
  assert.throws(() => seedFromMultibase("z" + base58Encode(Uint8Array.from([0x80, 0x24, ...seed]))), /not an Ed25519 private key/);
  assert.throws(() => seedFromMultibase("abc"), /must start with z/);
});

test("capabilities: both participants declare initiate and the ceremony roles, in the wire mode, with only known optional names", () => {
  const k = kCapabilities({ walletCommit: "abc", resolver: "shim", kinds: ["acl-list", "acl-grant"] });
  const v = vCapabilities({ walletCommit: "abc", vtaImage: "vta:1", mediatorImage: "med:1", resolver: "shim", vtaTypes: ["https://trusttasks.org/spec/acl/list/0.3"] });
  for (const c of [k, v]) {
    for (const o of c.optional) assert.ok((OPTIONAL_CAPABILITIES as readonly string[]).includes(o), `unknown optional capability ${o}`);
    for (const need of ["initiate", "observe.ceremony", "observe.received", "peer.connect"]) assert.ok(c.optional.includes(need), `${c.name} lacks ${need}`);
    assert.equal(c.mode, WIRE_MODE);
    assert.ok(c.bindings.includes("didcomm-v2"));
    assert.deepEqual(c.ceremonyRoles?.map((r) => r.ceremony), [...WIRE_GROUPS, "FC-KVC", ...(c === k ? COMMUNITY_GROUPS : [])]);
  }
  assert.deepEqual(k.initiates, ["acl-list", "acl-grant", "consent-decision"]);
  assert.ok(k.ceremonyRoles?.filter((r) => r.ceremony !== "FC-KVC").every((r) => r.roles.join() === "member-phone"));
  assert.ok(k.ceremonyRoles?.some((r) => r.ceremony === "FC-MBR") && k.ceremonyRoles?.some((r) => r.ceremony === "FC-IDV"), "the wallet is the member of the community ceremonies");
  assert.ok(v.ceremonyRoles?.filter((r) => r.ceremony !== "FC-KVC" && !(COMMUNITY_GROUPS as readonly string[]).includes(r.ceremony)).every((r) => r.roles.join() === "agent"));
  assert.equal(k.ceremonyRoles?.find((r) => r.ceremony === "FC-KVC")?.roles.join(), "approver", "the wallet is the approver of FC-KVC");
  assert.equal(v.ceremonyRoles?.find((r) => r.ceremony === "FC-KVC")?.roles.join(), "executor", "the VTA is the executor of FC-KVC");
  assert.ok(k.optional.includes("trigger.consentEnrol") && v.optional.includes("trigger.consentSetup"));
  assert.deepEqual(v.initiates, ["consent-gate", "consent-request", "consent-resubmit"]);
  assert.deepEqual(v.supportedTypes, ["https://trusttasks.org/spec/acl/list/0.3"]);
  assert.ok(!v.optional.includes("clock"), "a real wire has no movable clock");
});

test("hostPlan: nice, the wallet's own jest, this folder's configuration, the host file only", () => {
  const p = hostPlan("/kw", "/cache");
  assert.equal(p.command, "nice");
  assert.deepEqual(p.args.slice(0, 3), ["-n", "10", "/kw/bifold/node_modules/.bin/jest"]);
  assert.ok(p.args.includes("--runInBand") && p.args.includes("wire-host"));
  assert.equal(p.cwd, "/kw/bifold/packages/core");
  assert.equal(p.args[p.args.indexOf("--cacheDirectory") + 1], "/cache");
});

/** A stub VTA over REST: `auth/challenge`, `auth/authenticate`, an ACL it keeps, and refusals it can be told to give. */
function stubVta(): Promise<{ url: string; server: Server; calls: { type: string; payload: Record<string, any>; auth: string | undefined }[]; acl: Record<string, any>[]; refuse: Set<string> }> {
  const calls: { type: string; payload: Record<string, any>; auth: string | undefined }[] = [];
  const acl: Record<string, any>[] = [{ subject: "did:key:admin", role: "admin" }];
  const refuse = new Set<string>();
  const server = createServer((req: IncomingMessage, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const doc = JSON.parse(body);
      calls.push({ type: doc.type, payload: doc.payload, auth: req.headers.authorization });
      const reply = (type: string, payload: unknown, status = 200) => { res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ id: "r", type, payload })); };
      const slug = String(doc.type).replace("https://trusttasks.org/spec/", "");
      if (refuse.has(slug)) return reply("https://trusttasks.org/spec/trust-task-error/0.6", { code: "permissionDenied", message: "no" }, 403);
      if (slug === "auth/challenge/0.1") return reply(`${doc.type}#response`, { challenge: "c", sessionId: "s" });
      if (slug === "auth/authenticate/0.3") return reply(`${doc.type}#response`, { tokens: { accessToken: "tok" } });
      if (slug === "trust-task-discovery/0.3") return reply(`${doc.type}#response`, { supportedTypes: ["https://trusttasks.org/spec/acl/list/0.3", { type: "https://trusttasks.org/spec/acl/grant/0.2" }] });
      if (slug === "acl/list/0.3") return reply(`${doc.type}#response`, { entries: acl });
      if (slug === "acl/grant/0.2") { acl.push(doc.payload.entry); return reply(`${doc.type}#response`, { entry: doc.payload.entry }); }
      if (slug === "acl/revoke/0.2") { const i = acl.findIndex((e) => e.subject === doc.payload.subject); if (i >= 0) acl.splice(i, 1); return reply(`${doc.type}#response`, { entry: null }); }
      return reply(`${doc.type}#response`, {});
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, server, calls, acl, refuse })));
}

test("Operator: authenticates once, signs every document, lists, grants (full and narrowed) and revokes; a trust-task-error is OperatorRefused", async () => {
  const v = await stubVta();
  try {
    const op = new Operator(v.url, vtaDid, seed);
    assert.equal(op.did, ed25519Signer(seed).did);
    assert.deepEqual((await op.acl()).map((r) => r.subject), ["did:key:admin"]);
    await op.grant("did:key:w", "admin", "wallet");
    await op.grant("did:key:m", "monitor", "mon", true);
    assert.deepEqual(v.acl.find((e) => e.subject === "did:key:w")?.act, { scope: "all" });
    assert.deepEqual(v.acl.find((e) => e.subject === "did:key:m")?.act, { scope: "none" });
    assert.deepEqual(v.acl.find((e) => e.subject === "did:key:m")?.keys, { scope: "none" });
    await op.revoke("did:key:m");
    assert.equal(v.acl.some((e) => e.subject === "did:key:m"), false);
    assert.equal(v.calls.filter((c) => c.type.endsWith("auth/challenge/0.1")).length, 1, "one login for all calls");
    assert.equal(v.calls.find((c) => c.type.endsWith("acl/list/0.3"))?.auth, "Bearer tok");
    v.refuse.add("acl/revoke/0.2");
    await assert.rejects(() => op.revoke("did:key:w"), (e: unknown) => e instanceof OperatorRefused && e.code === "permissionDenied" && e.status === 403);
  } finally { v.server.close(); }
});

function stubHost(sent: Record<string, any>[] = []) {
  const log: { method: string; params: any }[] = [];
  const call = async (method: string, params?: any) => {
    log.push({ method, params });
    if (method === "provision") return { peer: { vid: "did:key:wallet" } };
    if (method === "wire.discover") return ["https://trusttasks.org/spec/acl/list/0.3"];
    if (method === "wire.send") return { replies: ['{"type":"x#response"}'] };
    if (method === "wire.sent") return sent;
    if (method === "wire.kvReceived") return [];
    if (method === "wire.kvReplies") return [];
    if (method === "wire.vault") return { count: params.op === "count" ? 2 : 0 };
    throw new Error(`unexpected ${method}`);
  };
  return { call, log };
}

test("VWireAdapter: provisions the agent, reads the ACL for observe, resets by removing what the scenario made and restoring a demoted wallet", async () => {
  const v = await stubVta();
  try {
    v.acl.push({ subject: "did:key:wallet", role: "admin", label: "wallet" });
    const op = new Operator(v.url, vtaDid, seed);
    const host = stubHost([{ type: "https://trusttasks.org/spec/acl/grant/0.2", threadId: "t1", id: "d1" }]);
    const a = new VWireAdapter(host.call, op, vtaDid, { walletCommit: "abc", vtaImage: "vta:1", mediatorImage: "med:1", resolver: "shim" });
    const caps = await a.capabilities();
    assert.deepEqual(caps.supportedTypes, ["https://trusttasks.org/spec/acl/list/0.3", "https://trusttasks.org/spec/acl/grant/0.2"], "strings and {type} entries of the operator's discovery answer");
    const prov = await a.provision(["peer"]);
    assert.equal(prov.peer!.vid, vtaDid);
    await assert.rejects(() => a.provision(["A"]), /only the wallet's DID has keys/);
    // a scenario's effects
    await op.grant("did:key:subject", "admin", "S");
    assert.equal((await a.observe({ query: "stored", kind: "acl-subject:did:key:subject" })).value, 1);
    assert.equal((await a.observe({ query: "stored", kind: "acl-entry" })).value, 1);
    assert.equal((await a.observe({ query: "stored", kind: "acl-label:did:key:subject|S" })).value, 1);
    assert.equal((await a.observe({ query: "received", type: "https://trusttasks.org/spec/acl/grant/0.2" })).value, 1);
    assert.equal((await a.observe({ query: "ceremony", threadId: "t" })).value, "unknown");
    // a demotion, then the reset puts everything back
    await a.trigger("actorRole", { vid: "did:key:wallet", role: "monitor" });
    assert.equal(v.acl.find((e) => e.subject === "did:key:wallet")?.role, "monitor");
    await a.reset();
    assert.equal(v.acl.some((e) => e.subject === "did:key:subject"), false);
    assert.equal(v.acl.find((e) => e.subject === "did:key:wallet")?.role, "admin");
    assert.deepEqual(v.acl.find((e) => e.subject === "did:key:wallet")?.act, { scope: "all" });
    assert.equal(v.acl.some((e) => e.subject === "did:key:admin"), true, "the deployment's own entry is never touched");
  } finally { v.server.close(); }
});

test("VWireAdapter.send: only the wallet's DID is carried over the wire; any other identity is refused as not offered, never faked", async () => {
  const v = await stubVta();
  try {
    v.acl.push({ subject: "did:key:wallet", role: "admin" });
    const host = stubHost();
    const a = new VWireAdapter(host.call, new Operator(v.url, vtaDid, seed), vtaDid, { walletCommit: "abc", vtaImage: "v", mediatorImage: "m", resolver: "shim" });
    const ok = await a.send({ from: { kind: "actor", vid: "did:key:wallet" }, bytes: "{}" });
    assert.equal(ok.transport.kind, "document");
    assert.equal(host.log.filter((l) => l.method === "wire.send").length, 1);
    await assert.rejects(() => a.send({ from: { kind: "actor", vid: "did:key:other" }, bytes: "{}" }), /not offered by the wire row/);
    await assert.rejects(() => a.send({ from: { kind: "none" }, bytes: "{}" }), /not offered by the wire row/);
    assert.equal(host.log.filter((l) => l.method === "wire.send").length, 1, "nothing was sent for the refused identities");
    await assert.rejects(() => a.setClock(), /real time/);
  } finally { v.server.close(); }
});

test("VWireAdapter.trigger requireStepUp installs the gate through policy/upsert after dropping an old one", async () => {
  const v = await stubVta();
  try {
    v.acl.push({ subject: "did:key:wallet", role: "admin" });
    const a = new VWireAdapter(stubHost().call, new Operator(v.url, vtaDid, seed), vtaDid, { walletCommit: "abc", vtaImage: "v", mediatorImage: "m", resolver: "shim" });
    await a.trigger("requireStepUp", { type: "acl/grant/0.2" });
    const up = v.calls.find((c) => c.type.endsWith("policy/upsert/0.3"));
    assert.ok(up !== undefined);
    assert.match(String(up.payload.module), /acl\/grant\/0\.2/);
    assert.equal(up.payload.expectedVersion, 0);
    await assert.rejects(() => a.trigger("clockOffset", {}), /not offered/);
  } finally { v.server.close(); }
});

test("VWireAdapter: the credential count is read through the wallet's session, and reset empties the vault", async () => {
  const v = await stubVta();
  try {
    v.acl.push({ subject: "did:key:wallet", role: "admin" });
    const host = stubHost();
    const a = new VWireAdapter(host.call, new Operator(v.url, vtaDid, seed), vtaDid, { walletCommit: "abc", vtaImage: "v", mediatorImage: "m", resolver: "shim" });
    a.settleMs = 0;
    assert.equal((await a.observe({ query: "stored", kind: "credential" })).value, 2);
    await a.reset();
    assert.deepEqual(host.log.filter((l) => l.method === "wire.vault").map((l) => l.params.op), ["count", "count", "clear"], "two agreeing reads, then the clear");
  } finally { v.server.close(); }
});

test("VWireAdapter.reset follows the wallet's new DID: it is granted, the earlier DID and the scenario's entries are revoked, the step-up gate goes first", async () => {
  const v = await stubVta();
  try {
    v.acl.push({ subject: "did:key:wallet1", role: "admin" });
    let wallet = "did:key:wallet1";
    const host = async (method: string, params?: any) => (method === "provision" ? { peer: { vid: wallet } } : method === "wire.discover" ? [] : method === "wire.vault" ? { count: 0 } : (() => { throw new Error(method); })());
    const a = new VWireAdapter(host, new Operator(v.url, vtaDid, seed), vtaDid, { walletCommit: "abc", vtaImage: "v", mediatorImage: "m", resolver: "shim" });
    await a.provision(["peer"]);
    wallet = "did:key:wallet2"; // K was reset: a new manager DID
    await a.reset();
    assert.deepEqual(v.acl.map((e) => e.subject).sort(), ["did:key:admin", "did:key:wallet2"]);
    const order = v.calls.map((c) => c.type.replace("https://trusttasks.org/spec/", ""));
    const firstGrant = order.indexOf("acl/grant/0.2");
    assert.ok(order.indexOf("policy/get/0.1") >= 0 && order.indexOf("policy/get/0.1") < firstGrant, "the gate is looked at before any grant");
  } finally { v.server.close(); }
});

test("VWireAdapter: a vault count that changes between reads is read again until two reads agree", async () => {
  const v = await stubVta();
  try {
    v.acl.push({ subject: "did:key:wallet", role: "admin" });
    const reads = [0, 1, 1];
    const host = async (method: string) => (method === "provision" ? { peer: { vid: "did:key:wallet" } } : method === "wire.vault" ? { count: reads.shift() ?? 1 } : (() => { throw new Error(method); })());
    const a = new VWireAdapter(host, new Operator(v.url, vtaDid, seed), vtaDid, { walletCommit: "abc", vtaImage: "v", mediatorImage: "m", resolver: "shim" });
    a.settleMs = 0;
    assert.equal((await a.observe({ query: "stored", kind: "credential" })).value, 1);
  } finally { v.server.close(); }
});

test("approvals row: the synthesized Rego is the VTA's byte-for-byte shape (pinned at 26d0da81), an empty rule list abstains, a name cannot break out of its literal", () => {
  const head = "package vta.policy\n\nimport rego.v1\n\n# Generated from the declarative approvals rules \u2014 do not hand-edit.\n#\n# The VTA re-derives this module from ext[\"openvtc.approvals\"] on every upsert\n# and refuses the write if the two disagree, so an edit here is not a way to\n# change behaviour: change the rules instead.\n";
  assert.equal(synthesizeRego([]), head);
  const rego = synthesizeRego([{ taskType: "https://trusttasks.org/spec/acl/grant/0.2", requires: "reauth" }, { taskType: "https://trusttasks.org/spec/vta/webvh/dids/update/1.0", requires: "consent", approverSet: "webvh-approvers", excludeRequester: true, contexts: ["openvtc"] }]);
  assert.ok(rego.startsWith(head));
  assert.ok(rego.includes("decision := {\n\t\"decision\": \"requireStepUp\",\n} if input.request.typeUri == \"https://trusttasks.org/spec/acl/grant/0.2\"\n"));
  assert.ok(rego.includes("\t\"requireConsent\": {\"approverSet\": \"webvh-approvers\", \"minApprovals\": 1, \"excludeRequester\": true},\n"));
  assert.ok(rego.includes("\tinput.contextId in {\"openvtc\"}\n}"));
  assert.equal(regoString("a\", \"decision\": \"allow"), "\"a\\\", \\\"decision\\\": \\\"allow\"");
  const up = approvalsUpsertPayload([], { "fc-kvc": ["did:key:z6MkA"] }, 3) as { id: string; expectedVersion: number; ext: Record<string, unknown>; priority: number };
  assert.equal(up.id, "approvals");
  assert.equal(up.expectedVersion, 3);
  assert.equal(up.priority, 200);
  assert.deepEqual(up.ext, { "openvtc.approvals": [], "openvtc.approver-sets": { "fc-kvc": ["did:key:z6MkA"] } });
});

test("VWireAdapter FC-KVC: consentSetup grants the requester admin, installs the consent rule and the approvers' row; initiate waits for the wallet to receive the push; reset drops the rule first", async () => {
  const v = await stubVta();
  try {
    v.acl.push({ subject: "did:key:wallet", role: "admin" });
    const host = stubHost();
    const a = new VWireAdapter(host.call, new Operator(v.url, vtaDid, seed), vtaDid, { walletCommit: "abc", vtaImage: "v", mediatorImage: "m", resolver: "shim" });
    a.pushWaitMs = 200;
    await a.trigger("consentSetup", { approvers: ["did:key:wallet"], minApprovals: 1 });
    const types = v.calls.map((c) => c.type.replace("https://trusttasks.org/spec/", ""));
    assert.ok(types.includes("acl/grant/0.2"), "the requester is made an admin");
    const rule = v.calls.find((c) => c.type.endsWith("policy/upsert/0.3") && c.payload.id === "fc-kvc");
    assert.ok(rule !== undefined && rule.payload.expectedVersion === 0 && /requireConsent/.test(String(rule.payload.module)));
    const row = v.calls.find((c) => c.type.endsWith("policy/upsert/0.3") && c.payload.id === "approvals");
    assert.deepEqual((row?.payload.ext as Record<string, unknown>)["openvtc.approver-sets"], { "fc-kvc": ["did:key:wallet"] });
    await assert.rejects(() => a.initiate({ kind: "consent-request", to: "x", thread: "t" } as never), /not connected|not offered/);
    await assert.rejects(() => a.initiate({ kind: "acl-grant", to: "x" } as never), /not offered/);
    const before = v.calls.length;
    await a.reset();
    const after = v.calls.slice(before).map((c) => `${c.type.replace("https://trusttasks.org/spec/", "")}:${String(c.payload.id ?? "")}`);
    assert.ok(after.indexOf("policy/get/0.1:fc-kvc") >= 0 && after.indexOf("policy/get/0.1:fc-kvc") < after.findIndex((t) => t.startsWith("acl/")), "the consent rule is dropped before the access list is restored");
  } finally { v.server.close(); }
});

/** A fake operator: records every call and answers from a table (a thrown OperatorRefused for the codes it is told to refuse). */
function fakeOp(did: string, answers: Record<string, any> = {}, refuse: Record<string, string> = {}): Operator & { calls: { type: string; payload: any; how: string }[] } {
  const calls: { type: string; payload: any; how: string }[] = [];
  const run = (how: string) => async (type: string, payload: any = {}) => {
    calls.push({ type, payload, how });
    if (refuse[type] !== undefined) throw new OperatorRefused(type, 403, refuse[type], `${refuse[type]}: refused`);
    const a = answers[type];
    return typeof a === "function" ? a(payload) : (a ?? {});
  };
  return { did, calls, call: run("session"), callSigned: run("signed"), as: () => fakeOp("did:key:member", answers, refuse), acl: async () => [], revoke: async () => undefined, grant: async () => undefined } as unknown as Operator & { calls: { type: string; payload: any; how: string }[] };
}

test("VtcWireAdapter: the community's capabilities, reads for the wallet's current DID only, admin triggers and the member's sessionless refusal", async () => {
  const c = communityCapabilities({ walletCommit: "a", vtaImage: "vta", mediatorImage: "med", resolver: "shim", vtaTypes: ["https://trusttasks.org/spec/vtc/join-requests/submit/0.3"] });
  assert.deepEqual(c.ceremonyRoles, [{ ceremony: "FC-MBR", roles: ["community"] }, { ceremony: "FC-IDV", roles: ["community"] }]);
  assert.equal(c.mode, WIRE_MODE);
  for (const o of c.optional) assert.ok((OPTIONAL_CAPABILITIES as readonly string[]).includes(o), `unknown optional capability ${o}`);
  assert.ok(!c.optional.includes("clock"));

  const wallet = "did:peer:2.wallet";
  const host = async (m: string) => {
    if (m === "provision") return { peer: { vid: wallet } };
    if (m === "wire.sent") return [];
    return null;
  };
  const items = [
    { id: "r-old", applicantDid: "did:peer:2.earlier", status: "pending", submittedAt: "2026-01-01T00:00:00Z" },
    { id: "r-new", applicantDid: wallet, status: "pending", submittedAt: "2026-01-02T00:00:00Z" },
  ];
  const vtc = fakeOp("did:key:admin", {
    "vtc/join-requests/list/0.2": (p: any) => ({ items: items.filter((x) => x.status === p.status) }),
    "vtc/members/list/0.2": { items: [{ did: wallet }, { did: "did:peer:2.other" }] },
    "vtc/vetting/vetters/list/0.1": { vetters: [{ vetterDid: wallet }] },
  }, {});
  const vta = fakeOp("did:key:vtaadmin");
  const a = new VtcWireAdapter(host, vtc, vta, "did:webvh:vtc", { walletCommit: "a", vtaImage: "vta", mediatorImage: "med", resolver: "shim" });
  const T = (kind: string) => a.observe({ query: "stored", kind });
  assert.equal((await T("join-request")).value, 1, "the earlier scenario's request is not this wallet's");
  assert.equal((await T("join-request:pending")).value, 1);
  assert.equal((await T("join-request:approved")).value, 0);
  assert.equal((await T(`member:${wallet}`)).value, 1);
  assert.equal((await T(`vetter:${wallet}`)).value, 1);

  // seedMember is the administrator's own admit; decide names the wallet's newest request; the result is logged by code
  await a.trigger("seedMember", { vid: wallet });
  assert.deepEqual(vtc.calls.find((x) => x.type === "vtc/members/admit/0.1")?.payload, { subject: wallet, role: "member" });
  await a.trigger("decide", { decision: "approved", request: "latest" });
  assert.deepEqual(vtc.calls.find((x) => x.type === "vtc/join-requests/decide/0.1")?.payload, { id: "r-new", decision: "approved" });
  assert.equal((await T("admin:decide:ok")).value, 1);
  await a.trigger("decide", { decision: "approved", request: "unknown" });
  assert.equal(vtc.calls.filter((x) => x.type === "vtc/join-requests/decide/0.1").at(-1)?.payload.id, "00000000-0000-4000-8000-0000000000aa");
  await assert.rejects(() => a.trigger("revokeVetterGrant", {}), /not offered by the wire row/);
  await assert.rejects(() => a.send({ from: { kind: "actor", vid: "did:key:other" }, bytes: "{}" } as never), /only the wallet's DID has keys/);
  await assert.rejects(() => a.provision(["someone"]), /only the wallet's DID has keys/);

  // the member with no administrative authority signs with no session and its refusal is the answer
  const refusing = fakeOp("did:key:admin", { "vtc/join-requests/list/0.2": { items } }, { "https://trusttasks.org/spec/vtc/join-requests/decide/0.1": "permissionDenied" });
  const b = new VtcWireAdapter(host, refusing, vta, "did:webvh:vtc", { walletCommit: "a", vtaImage: "vta", mediatorImage: "med", resolver: "shim" });
  await b.trigger("decide", { decision: "approved", request: "latest", as: "member" }).catch(() => undefined);
  assert.equal((await b.observe({ query: "stored", kind: "admin:decide:permissionDenied" })).value, 0, "the stub refuses by full type; the adapter asks by slug");
});

test("Operator.callSigned: signs and sends no bearer; the answer's refusal code is thrown", async () => {
  const seen: { auth: string | undefined; type: string }[] = [];
  const op = new Operator("http://stub/v1", "did:key:vtc", seed, (async (_u: string, init: { headers: Record<string, string>; body: string }) => {
    const doc = JSON.parse(init.body);
    seen.push({ auth: init.headers.authorization, type: doc.type });
    return { status: 403, text: async () => JSON.stringify({ type: "https://trusttasks.org/spec/trust-task-error/0.6", payload: { code: "permissionDenied", message: "no" } }) } as Response;
  }) as unknown as typeof fetch);
  await assert.rejects(() => op.callSigned("vtc/join-requests/decide/0.1", {}), (e: unknown) => e instanceof OperatorRefused && e.code === "permissionDenied");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.auth, undefined, "no session");
  assert.ok(seen[0]!.type.endsWith("vtc/join-requests/decide/0.1"));
});
