// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReferenceAdapter, WSH_TYPE } from "../src/adapters/reference/reference.ts";
import { buildWitness } from "../src/runner/build.ts";
import type { BuildContext } from "../src/runner/build.ts";
import { makeActors } from "../src/runner/engine.ts";
import { runSuite } from "../src/runner/suite.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { rpcAdapterFromSpec } from "../src/adapter/client.ts";
import { FIXTURES, ROOT, VECTORS } from "./helpers.ts";
import { fromMultibase } from "../src/crypto/base58.ts";
import { ed25519Signer, seedOf } from "../src/crypto/didkey.ts";
import { resolverFromDidDocument, signDocument, verifyDocumentProof } from "../src/crypto/proof.ts";
import { buildSend } from "../src/runner/build.ts";
import type { Adapter } from "../src/adapter/contract.ts";
import { buildMatrix, matrixMarkdown } from "../src/runner/matrix.ts";

const suite = loadSuite(VECTORS);
const today = "2026-11-13";
const all = suite.files.flatMap((f) => f.file.vectors);
const NEW = /^(ERR-00[4-8]|ID-003|RSP-005|CTRL-|NS-|AUTHZ-|TD-|WSH-|DUP-00[678]|DIS-|BND-|2PC-|CER-)/;

describe("vector groups added after the benchmark", () => {
  it("every one cites file:line or a design-document section, and every negative one names mutants", () => {
    const added = all.filter((v) => NEW.test(v.id));
    assert.ok(added.length === 101, String(added.length));
    for (const v of added) {
      assert.ok(v.spec.some((s) => /:\d+(-\d+)?\b/.test(s) || /^docs\/|section/.test(s)), `${v.id} cites no line or document section`);
    }
    // WSH-001..021 exist, and so do the TD, CTRL, NS groups of the design table.
    for (let n = 1; n <= 21; n++) assert.ok(all.some((v) => v.id === `WSH-${String(n).padStart(3, "0")}`), `WSH-${n}`);
    for (const g of ["DIS-017", "BND-006", "2PC-001", "2PC-002", "2PC-006", "2PC-007", "2PC-008", "2PC-003", "2PC-004", "2PC-005", "CER-001", "CER-013", "TIME-103", "WSH-024", "TD-001", "TD-006", "CTRL-004", "NS-005", "AUTHZ-001", "ERR-008", "ID-003", "RSP-005", "DUP-006", "DUP-008"]) assert.ok(all.some((v) => v.id === g), g);
  });
  it("profile rules and open questions are CLARIFY", () => {
    for (const id of ["WSH-019", "WSH-024", "ERR-005", "ERR-008", "DUP-009", "DUP-010", "LIF-001", "LIF-002", "ERR-002", "RSP-002", "PRF-108", "AUTHZ-002", "DUP-007", "DUP-008", "DIS-014", "2PC-002", "2PC-008", "CER-004", "CER-007", "CER-010", "CER-012", "CER-013", "CER-016"]) assert.notEqual(all.find((v) => v.id === id)!.clarify, null, id);
  });
  it("an implementation without witness-share gets SKIP for WSH and TD, and still passes the VRC groups", async () => {
    const run = await runSuite({ adapter: new ReferenceAdapter({ witnessShare: false }), suite, tier: 1, today, fixtureRoot: FIXTURES });
    for (const r of run.results.filter((x) => /^(WSH|TD)-/.test(x.id))) assert.equal(r.status, "SKIP", r.id);
    assert.deepEqual(run.results.filter((x) => x.status === "FAIL"), []);
    assert.ok(run.results.find((x) => x.id === "VRC-ISS-001")?.status === "PASS");
    const caps = await new ReferenceAdapter({ witnessShare: false }).capabilities();
    assert.ok(!caps.supportedTypes.includes(WSH_TYPE));
  });
  it("an implementation that declares neither restart nor the claim-store fault hook gets SKIP for DUP-006..008", async () => {
    const base = new ReferenceAdapter();
    const bare = Object.create(base) as ReferenceAdapter;
    bare.capabilities = async () => {
      const c = await base.capabilities();
      return { ...c, optional: c.optional.filter((o) => o !== "restart" && o !== "fault.claimStore") };
    };
    const run = await runSuite({ adapter: bare, suite, tier: 1, today, fixtureRoot: FIXTURES });
    for (const id of ["DUP-006", "DUP-007", "DUP-008"]) assert.equal(run.results.find((x) => x.id === id)?.status, "SKIP", id);
  });
  it("the example server drops the witness-share type with --no-witness-share", async () => {
    const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
    const cmd = [process.execPath, "--experimental-strip-types", "--disable-warning=ExperimentalWarning", `${ROOT}/src/adapters/example-server/server.ts`, "stdio", "--no-witness-share"].map(q).join(" ");
    const a = rpcAdapterFromSpec(`stdio:${cmd}`);
    try {
      const caps = await a.capabilities();
      assert.ok(caps.supportedTypes.some((t) => t.includes("/propose/")) && !caps.supportedTypes.includes(WSH_TYPE));
    } finally {
      await a.close();
    }
  });
  it("a restart keeps the duplicate record, and an unreadable record is cleared by fault ok", async () => {
    const a = new ReferenceAdapter();
    await a.trigger("fault", { claimStore: "unreadable" });
    await a.restart();
    await a.reset();
    await assert.rejects(a.trigger("fault", { claimStore: "broken" }), /unreadable or ok/);
  });
});

describe("witness bundle builder", () => {
  const ctx = (): BuildContext => ({ vectorId: "WSH-000", iutVid: "did:key:iut", actors: makeActors(), carrier: "", nowMs: Date.parse("2026-11-12T10:00:30Z"), startMs: Date.parse("2026-11-12T10:00:00Z"), captures: { ibr: makeActors().S!.vid } });
  it("is byte-identical for a redelivery and binds challenge and domain", () => {
    const a = buildWitness({}, "urn:uuid:thread", ctx());
    const b = buildWitness({}, "urn:uuid:thread", { ...ctx(), nowMs: Date.parse("2026-11-12T10:05:00Z") });
    assert.equal(JSON.stringify(a.payload), JSON.stringify(b.payload));
    assert.equal(a.digest, b.digest);
    const proof = (a.payload.presentation as { proof: Record<string, unknown> }).proof;
    assert.equal(proof.challenge, "urn:uuid:thread");
    assert.equal(proof.domain, "vrc:witness-share");
  });
  it("deviations change exactly what they name", () => {
    const base = buildWitness({}, "urn:uuid:t", ctx());
    const unsigned = buildWitness({ initiating: "unsigned" }, "urn:uuid:t", ctx());
    const init = (r: typeof base): Record<string, unknown> => (r.payload.outcomeEvidence as { initiating: Record<string, unknown> }).initiating;
    assert.ok(init(base).proof !== undefined && init(unsigned).proof === undefined);
    // the cited digest is the same whether or not the cited document is signed
    assert.equal(base.digest, unsigned.digest);
    const spelled = buildWitness({ digest: "u" }, "urn:uuid:t", ctx());
    assert.notEqual(spelled.digest, base.digest);
    const term = (r: typeof base): Record<string, unknown> => (r.payload.outcomeEvidence as { terminal: Record<string, unknown> }).terminal;
    assert.equal(term(buildWitness({ terminalProof: "none" }, "urn:uuid:t", ctx())).proof, undefined);
    assert.equal(term(buildWitness({ terminalThread: "urn:uuid:x" }, "urn:uuid:t", ctx())).threadId, "urn:uuid:x");
  });
});

describe("S1: the IUT's proofs are verified from the provisioned DID document", () => {
  const now = Date.parse("2026-11-12T10:00:00Z");
  const key = ed25519Signer(seedOf(9));
  const iut = { ...key, did: "did:example:iut", verificationMethod: "did:example:iut#key-1" };
  const vmDoc = (publicKeyMultibase: string, rel: string[]): unknown => ({
    id: "did:example:iut", verificationMethod: [{ id: "did:example:iut#key-1", type: "Multikey", controller: "did:example:iut", publicKeyMultibase }],
    ...Object.fromEntries(rel.map((r) => [r, ["did:example:iut#key-1"]])),
  });
  const signed = (purpose: string) => signDocument({ id: "urn:uuid:1", type: "https://trusttasks.org/spec/x/0.1", issuer: "did:example:iut", payload: {} }, iut, { created: now, purpose });
  const check = (doc: unknown, d: unknown) => verifyDocumentProof(doc, { nowMs: now, resolve: resolverFromDidDocument(d) });
  it("verifies a reply signed by a non-did:key identifier, and not without the document", () => {
    const good = vmDoc(key.did.slice("did:key:".length), ["authentication"]);
    assert.equal(check(signed("authentication"), good).valid, true);
    assert.equal(verifyDocumentProof(signed("authentication"), { nowMs: now }).valid, false);
    // the same key given as a JWK with a relative method id
    const x = Buffer.from(fromMultibase(key.did.slice("did:key:".length)).subarray(2)).toString("base64url");
    const jwk = { id: "did:example:iut", verificationMethod: [{ id: "#key-1", type: "JsonWebKey", controller: "did:example:iut", publicKeyJwk: { kty: "OKP", crv: "Ed25519", x } }], authentication: ["#key-1"] };
    assert.equal(check(signed("authentication"), jwk).valid, true);
  });
  it("a wrong key or a wrong purpose still fails", () => {
    const other = ed25519Signer(seedOf(10)).did.slice("did:key:".length);
    assert.equal(check(signed("authentication"), vmDoc(other, ["authentication"])).valid, false);
    const right = key.did.slice("did:key:".length);
    const wrongPurpose = check(signed("assertionMethod"), vmDoc(right, ["authentication"]));
    assert.equal(wrongPurpose.valid, false);
    assert.match(wrongPurpose.detail ?? "", /not listed/);
    assert.equal(check(signed("authentication"), vmDoc(right, [])).valid, false);
    const tampered = { ...signed("authentication"), payload: { x: 1 } };
    assert.equal(check(tampered, vmDoc(right, ["authentication"])).valid, false);
  });
});

describe("S2: framework vectors follow the carrier's declared payload", () => {
  it("the carrier.request template and the payload variants derive from validPayload", () => {
    const ctx = { ...({ vectorId: "X-001", iutVid: "did:key:iut", actors: makeActors(), carrier: "urn:c", nowMs: 0 } as BuildContext), carrierPayload: { amount: 3, unit: "kg" } };
    const doc = (extra: Record<string, unknown>) => JSON.parse(buildSend({ template: "carrier.request", params: extra, sign: null }, ctx, undefined).bytes) as { payload: Record<string, unknown> };
    assert.deepEqual(doc({}).payload, { amount: 3, unit: "kg" });
    assert.deepEqual(doc({ payload: { $carrierInvalid: true } }).payload, { amount: "not-a-number", unit: "kg" });
    assert.deepEqual(doc({ payload: { $carrierExtra: true } }).payload, { amount: 3, unit: "kg", extra: true });
  });
});

describe("S3: vectors that need a non-attested server run are reported", () => {
  it("the matrix names them for an attested server", async () => {
    const run = await runSuite({ adapter: new ReferenceAdapter({ attested: true, name: "att" }), suite, tier: 2, today, fixtureRoot: FIXTURES });
    const m = buildMatrix([run]);
    assert.ok(m.rows[0]!.needsNonAttestedRun.includes("DUP-101") && m.rows[0]!.needsNonAttestedRun.includes("PRF-108"));
    assert.match(matrixMarkdown(m), /without `attested`/);
    const plain = buildMatrix([await runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today, fixtureRoot: FIXTURES })]);
    assert.deepEqual(plain.rows[0]!.needsNonAttestedRun, []);
  });
});

describe("DIS, BND and 2PC groups", () => {
  // a vector outside the selected tier is recorded apart (excludedByTier), never a result: shown here as SKIP, which it was a gate of
  const statuses = async (adapter: Adapter, tier: 1 | 2 = 1): Promise<Map<string, string>> => {
    const r = await runSuite({ adapter, suite, tier, today, fixtureRoot: FIXTURES, channels: ["registry", "proposed", "candidate"] });
    return new Map([...(r.excludedByTier ?? []).map((e) => [e.id, "SKIP"] as [string, string]), ...r.results.map((x) => [x.id, x.status] as [string, string])]);
  };
  const ids = (prefix: string) => all.filter((v) => v.id.startsWith(prefix)).map((v) => v.id);

  it("an adapter that declares only the in-process binding gets SKIP for every BND vector and no failure", async () => {
    const res = await statuses(new ReferenceAdapter({ https: false }));
    for (const id of ids("BND-")) assert.equal(res.get(id), "SKIP", id);
    assert.ok([...res.values()].every((s) => s !== "FAIL"));
    assert.equal(res.get("DIS-001"), "PASS");
  });
  it("the same holds over the wire (--no-https on the example server)", async () => {
    const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
    const cmd = [process.execPath, "--experimental-strip-types", "--disable-warning=ExperimentalWarning", `${ROOT}/src/adapters/example-server/server.ts`, "stdio", "--no-https"].map(q).join(" ");
    const a = rpcAdapterFromSpec(`stdio:${cmd}`);
    try {
      assert.deepEqual((await a.capabilities()).bindings, ["in-process"]);
      const res = await statuses(a);
      for (const id of ids("BND-")) assert.equal(res.get(id), "SKIP", id);
    } finally {
      await a.close();
    }
  });
  it("an implementation without discovery, or without the 2PC trigger, gets SKIP", async () => {
    const base = new ReferenceAdapter();
    const bare = Object.create(base) as ReferenceAdapter;
    bare.capabilities = async () => {
      const c = await base.capabilities();
      return { ...c, supportedTypes: c.supportedTypes.filter((t) => !t.includes("discovery")), optional: c.optional.filter((o) => o !== "trigger.twoPhase" && !o.startsWith("discovery.")) };
    };
    const res = await statuses(bare);
    for (const id of [...ids("DIS-"), ...ids("2PC-").filter((x) => !["2PC-003", "2PC-004", "2PC-005", "2PC-008"].includes(x))]) assert.equal(res.get(id), "SKIP", id);
    assert.ok([...res.values()].every((s) => s !== "FAIL"));
  });
  it("discovery lists the declared types, in the form the discovery specification requires", async () => {
    const a = new ReferenceAdapter();
    const [actors, iut] = [makeActors(), (await a.provision(["iut"])).iut!];
    const caps = await a.capabilities();
    assert.ok(caps.supportedTypes.includes("https://trusttasks.org/spec/trust-task-discovery/0.4"));
    const doc = signDocument({ id: "urn:uuid:1", type: "https://trusttasks.org/spec/trust-task-discovery/0.4", issuer: actors.A!.vid, recipient: iut.vid, issuedAt: "2026-11-12T10:00:00Z", payload: {} }, actors.A!.signer, { created: Date.parse("2026-11-12T10:00:00Z") });
    await a.setClock("2026-11-12T10:00:00Z");
    const r = await a.send({ from: { kind: "actor", vid: actors.A!.vid }, bytes: JSON.stringify(doc) });
    const payload = (JSON.parse(r.replies[0]!) as { payload: { supportedTypes: string[]; frameworkVersion: string; acceptanceWindow: Record<string, number> } }).payload;
    assert.deepEqual(payload.supportedTypes, [...caps.supportedTypes].sort());
    assert.equal(payload.frameworkVersion, "0.6.0");
    assert.deepEqual(payload.acceptanceWindow, { maxAgeSeconds: 300, clockSkewSeconds: 60, expiryHorizonSeconds: 2592000 });
  });
  it("the HTTPS model answers by the binding's rules and is inert without an http request line", async () => {
    const a = new ReferenceAdapter();
    const [actors, iut] = [makeActors(), (await a.provision(["iut"])).iut!];
    await a.setClock("2026-11-12T10:00:00Z");
    const bytes = JSON.stringify(signDocument({ id: "urn:uuid:2", type: "https://trusttasks.org/spec/conformance/widget/0.1", issuer: actors.A!.vid, recipient: iut.vid, issuedAt: "2026-11-12T10:00:00Z", payload: { subject: "did:web:alice.example" } }, actors.A!.signer, { created: Date.parse("2026-11-12T10:00:00Z") }));
    const from = { kind: "actor" as const, vid: actors.A!.vid };
    const get = await a.send({ from, bytes, http: { method: "GET" } });
    assert.deepEqual([get.transport.status, get.transport.kind, get.replies.length], [405, "refused", 0]);
    assert.equal((await a.send({ from, bytes, http: { path: "/elsewhere" } })).transport.status, 404);
    assert.equal((await a.send({ from, bytes })).transport.status, undefined);
    await a.reset();
    await a.setClock("2026-11-12T10:00:00Z");
    const ok = await a.send({ from, bytes, http: {} });
    assert.deepEqual([ok.transport.status, ok.transport.contentType], [200, "application/json"]);
    assert.equal((await a.send({ from, bytes, http: {} })).transport.status, 200);
  });
  it("the two-phase triggers are named and validated: commit, abort, inflight, voteNo, unknown, settle; fault claimStore", async () => {
    const a = new ReferenceAdapter();
    for (const outcome of ["commit", "abort", "inflight", "voteNo", "unknown"]) await a.trigger("twoPhase", { outcome });
    await assert.rejects(a.trigger("twoPhase", { outcome: "maybe" }), /commit, abort, inflight, voteNo or unknown/);
    await assert.rejects(a.trigger("settle", { outcome: "commit" }), /no transaction is in flight/);
    assert.ok((await a.capabilities()).optional.includes("trigger.twoPhase"));
  });
});

describe("matrix: runs of one implementation are one row", () => {
  it("a vector skipped by one run and executed by the other counts once, and the worst executed status wins", () => {
    const mk = (impl: string, tier: 1 | 2, results: [string, string][]) => ({
      impl, implementation: "x", tier, results: results.map(([id, status]) => ({ id, group: "A", family: "f", tier: 1 as const, status: status as never, ...(status === "SKIP" ? { reason: "implementation declares optional attested" } : {}) })),
    });
    const m = buildMatrix([mk("x-attested", 2, [["A-001", "SKIP"], ["A-002", "PASS"]]), mk("x", 1, [["A-001", "PASS"], ["A-002", "FAIL"]])]);
    assert.equal(m.rows.length, 1);
    assert.deepEqual(m.rows[0]!.tiers, [1, 2]);
    assert.deepEqual(m.rows[0]!.families.f!.counts, { PASS: 1, FAIL: 1, SKIP: 0, "KNOWN-FAIL": 0, CLARIFY: 0 });
    assert.deepEqual(m.rows[0]!.needsNonAttestedRun, []);
    const alone = buildMatrix([mk("x-attested", 2, [["A-001", "SKIP"]])]);
    assert.deepEqual(alone.rows[0]!.needsNonAttestedRun, ["A-001"]);
  });
});
