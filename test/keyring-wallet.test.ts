// SPDX-License-Identifier: Apache-2.0
// keyring-wallet adapter: the parts that need no keyring-wallet checkout (capabilities honesty, the shim's building blocks, the
// launch plan, the exceptions the recorded run depends on), plus an end-to-end test that starts the real jest host and is run
// only when KW_ADAPTER_E2E=1 (it needs the keyring-wallet checkout and takes about a minute cold).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import { launchPlan } from "../src/adapters/keyring-wallet/launcher.ts";
import {
  CARRIER_TYPE, ConnectionTable, KW_ADAPTER_NAME, QUERY_TYPE, KW_VERIFY_NAME, KW_WINDOW, Outbox, ROW_LABEL,
  DocStates, answers, exchangeStillOpen, capabilities, iutIdentity, provisionRoles, stateFromReply,
} from "../src/adapters/keyring-wallet/shim.ts";
import { loadExceptions, loadSuite } from "../src/vectors/load.ts";
import { gateReason } from "../src/runner/suite.ts";
import { ROOT, VECTORS } from "./helpers.ts";

const build = { commit: "abc123456", bifoldCommit: "def456789", walletTypes: ["https://trusttasks.org/spec/vrc/relationships/propose/0.1"], consent: true };

describe("keyring-wallet capabilities are honest", () => {
  const caps = capabilities(build);
  it("is named keyring-wallet and labelled as logic over a shim carrier", () => {
    assert.equal(caps.name, KW_ADAPTER_NAME);
    assert.match(caps.version, new RegExp(ROW_LABEL));
    assert.equal(ROW_LABEL, "logic over a shim carrier");
  });
  it("declares no HTTPS binding and no Tier 2 claim; the clock is settable only when the shim fakes Date, and the note says so", () => {
    assert.deepEqual(caps.bindings, ["in-process"]);
    assert.equal(caps.tierMax, 1);
    assert.ok(caps.optional.includes("clockFree"));
    assert.ok(!caps.optional.includes("clock"));
    const faked = capabilities({ ...build, fakeClock: true });
    assert.ok(faked.optional.includes("clock"));
    assert.ok(!faked.optional.includes("clockFree"));
    assert.match(faked.version, /shim-faked Date/);
    assert.ok(!caps.optional.includes("attested"));
  });
  it("declares only what the shim reaches: transport identity and restart, which the shim provides", () => {
    for (const o of ["transportIdentity", "restart"]) assert.ok(caps.optional.includes(o), o);
  });
  it("declares nothing the wallet cannot do (no ceremony family, retained text, fault hook, ES256)", () => {
    for (const o of ["ceremony", "observe.retained", "fault.claimStore", "trigger.twoPhase"]) assert.ok(!caps.optional.includes(o), o);
    assert.deepEqual(caps.cryptosuites, ["eddsa-jcs-2022"]);
  });
  it("declares only the skew the wallet enforces, not a maximum age", () => {
    assert.deepEqual(KW_WINDOW, { clockSkewSeconds: 300 });
    assert.deepEqual(caps.window, KW_WINDOW);
  });
  it("serves one consequential carrier and lists it as supported", () => {
    assert.deepEqual(caps.carriers.map((c) => [c.typeUri, c.class]), [[CARRIER_TYPE, "consequential"], [CARRIER_TYPE, "openPayload"]]);
    assert.ok(caps.supportedTypes.includes(CARRIER_TYPE));
  });
  it("declares the credential-exchange query helpers only when the query is served, and never a pre-trusted verifier", () => {
    assert.ok(!caps.optional.includes("trigger.holdCredential"));
    const q = capabilities({ ...build, walletTypes: [...build.walletTypes, QUERY_TYPE], query: true });
    for (const o of ["trigger.holdCredential", "trigger.queryDecision", "observe.deferred"]) assert.ok(q.optional.includes(o), o);
    assert.ok(!q.optional.includes("trigger.verifierTrust"));
    assert.ok(q.supportedTypes.includes(QUERY_TYPE));
    assert.match(q.version, /presentation signing is a suite stand-in/);
    const suite = loadSuite(VECTORS);
    const cex025 = suite.files.flatMap((f) => f.file.vectors).find((v) => v.id === "CEX-025");
    assert.ok(cex025);
    assert.match(gateReason(cex025, q, 1) ?? "", /trigger\.verifierTrust/);
  });
  it("the verify variant is a separate row name", () => {
    const v = capabilities({ ...build, carrierProof: "verify" });
    assert.equal(v.name, KW_VERIFY_NAME);
    assert.notEqual(v.implementation, caps.implementation);
  });
  it("the runner gates the BND vectors and the ES256 proofs to SKIP, never to a pass", () => {
    const suite = loadSuite(VECTORS);
    const all = suite.files.flatMap((f) => f.file.vectors);
    const bnd = all.filter((v) => v.id.startsWith("BND-"));
    assert.ok(bnd.length > 0);
    for (const v of bnd) assert.match(gateReason(v, caps, 2) ?? "", /binding:https|missing capability|claims tier 1/);
    const es = all.filter((v) => (v.requires ?? []).some((r) => r.startsWith("cryptosuite:ecdsa")));
    assert.ok(es.length > 0);
    for (const v of es) assert.match(gateReason(v, caps, 2) ?? "", /cryptosuite|claims tier 1/);
  });
});

describe("keyring-wallet shim building blocks", () => {
  it("provisions one deterministic did:key with a document for every role", () => {
    const a = provisionRoles(["iut"]);
    const b = provisionRoles(["iut", "x"]);
    assert.equal(a.iut!.vid, iutIdentity().vid);
    assert.equal(b.x!.vid, a.iut!.vid);
    assert.ok(a.iut!.vid.startsWith("did:key:z6Mk"));
    assert.equal(a.iut!.keyCustody, "iut");
    assert.match(a.iut!.transportAddress, /shim/);
  });
  it("keeps one connection per peer and maps ids back", () => {
    const t = new ConnectionTable("did:key:me");
    const a = t.forPeer("did:key:a");
    assert.equal(t.forPeer("did:key:a"), a);
    const b = t.forPeer("did:key:b");
    assert.notEqual(a.id, b.id);
    assert.equal(a.did, "did:key:me");
    assert.equal(t.get(b.id).theirDid, "did:key:b");
    assert.equal(t.all().length, 2);
    t.clear();
    assert.throws(() => t.get(a.id));
  });
  it("the outbox returns what was sent once and settles after quiet", async () => {
    const o = new Outbox();
    o.push("c", { id: "1" });
    o.push("c", { id: "2" });
    assert.deepEqual(o.take().map((x) => x.document.id), ["1", "2"]);
    assert.equal(o.take().length, 0);
    const late = setTimeout(() => o.push("c", { id: "3" }), 30);
    const waited = await o.settle(60, 1000);
    clearTimeout(late);
    assert.ok(waited >= 60);
    assert.equal(o.take().length, 1);
  });
  it("maps replies to the lifecycle state the harness asks about", () => {
    assert.equal(stateFromReply(undefined), "accepted");
    assert.equal(stateFromReply("https://trusttasks.org/spec/x/0.1#response"), "responded");
    assert.equal(stateFromReply("https://trusttasks.org/spec/trust-task-error/0.6"), "errored");
  });
  it("a next step leaves the request accepted (SPEC.md 4.12), it is not a response", () => {
    assert.equal(stateFromReply("https://trusttasks.org/spec/trust-task-next-step/0.1"), "accepted");
  });
  it("counts the three reply dispositions as replies (SPEC.md 4.4.1) and nothing else", () => {
    const base = { id: "urn:uuid:r", threadId: "urn:uuid:q" };
    for (const type of ["https://trusttasks.org/spec/x/0.1#response", "https://trusttasks.org/spec/trust-task-error/0.6", "https://trusttasks.org/spec/trust-task-next-step/0.1"]) {
      assert.equal(answers({ ...base, type }, "urn:uuid:q", "urn:uuid:q"), true, type);
      assert.equal(answers({ ...base, type }, "urn:uuid:other", undefined), false, `${type} on another thread`);
    }
    assert.equal(answers({ ...base, type: "https://trusttasks.org/spec/x/0.1" }, "urn:uuid:q", "urn:uuid:q"), false);
    const named = { type: "https://trusttasks.org/spec/trust-task-next-step/0.1", payload: { inResponseTo: { id: "urn:uuid:q" } } };
    assert.equal(answers(named, "urn:uuid:elsewhere", "urn:uuid:q"), true);
  });
  it("an exchange is still open while every reply so far is a next step (SPEC.md 4.4.1: a continuation does not close it), and closed by a response or an error", () => {
    const base = { id: "urn:uuid:r", threadId: "urn:uuid:q" };
    const next = { ...base, type: "https://trusttasks.org/spec/trust-task-next-step/0.1" };
    const response = { ...base, type: "https://trusttasks.org/spec/x/0.1#response" };
    const error = { ...base, type: "https://trusttasks.org/spec/trust-task-error/0.6" };
    assert.equal(exchangeStillOpen([]), false, "no reply is not an open exchange, only a quiet one");
    assert.equal(exchangeStillOpen([next]), true);
    assert.equal(exchangeStillOpen([next, next]), true);
    assert.equal(exchangeStillOpen([next, response]), false);
    assert.equal(exchangeStillOpen([response, next]), false);
    assert.equal(exchangeStillOpen([error]), false);
  });
  it("a later reply on the request's thread moves its state on; a next step does not; a resubmission does not take the thread", () => {
    const s = new DocStates();
    s.request("urn:uuid:q", "urn:uuid:q");
    s.set("urn:uuid:q", stateFromReply("https://trusttasks.org/spec/trust-task-next-step/0.1"));
    assert.equal(s.get("urn:uuid:q"), "accepted");
    s.note({ type: "https://trusttasks.org/spec/trust-task-next-step/0.1", threadId: "urn:uuid:q" });
    assert.equal(s.get("urn:uuid:q"), "accepted");
    s.note({ type: "https://trusttasks.org/spec/vrc/relationships/propose/0.1#response", threadId: "urn:uuid:q" });
    assert.equal(s.get("urn:uuid:q"), "responded");
    s.request("urn:uuid:q2", "urn:uuid:q");
    s.note({ type: "https://trusttasks.org/spec/trust-task-error/0.6", threadId: "urn:uuid:q" });
    assert.equal(s.get("urn:uuid:q"), "errored");
    assert.equal(s.get("urn:uuid:q2"), "unknown");
    s.note({ type: "https://trusttasks.org/spec/x/0.1#response", threadId: "urn:uuid:nobody" });
    assert.equal(s.get("urn:uuid:nobody"), "unknown");
  });
  it("the launch plan runs the host under the wallet's own jest, niced, and writes nothing into the checkout", () => {
    const p = launchPlan("/kw", "/scratch/port", "/scratch/cache", "/suite/src/adapters/keyring-wallet");
    assert.equal(p.command, "nice");
    assert.deepEqual(p.args.slice(0, 2), ["-n", "10"]);
    assert.ok(p.args.includes(join("/kw", "bifold/node_modules/.bin/jest")));
    assert.ok(p.args.includes("--runInBand"));
    assert.equal(p.env.KW_JEST_CACHE, "/scratch/cache");
    assert.equal(p.env.KW_ROOT, "/kw");
    assert.equal(p.cwd, "/kw/bifold/packages/core");
  });
});

describe("keyring-wallet shim container", () => {
  it("registers a DID resolver the way a real Credo agent does, so the wallet's own proof verifier can resolve an issuer", () => {
    const src = readFileSync(join(ROOT, "src/adapters/keyring-wallet/kw-host.jest.ts"), "utf8");
    assert.match(src, /singletons\.set\(credoCore\.DidResolverService,/);
  });
});

describe("keyring-wallet exceptions", () => {
  const suite = loadSuite(VECTORS);
  const ids = new Set([VECTORS, join(VECTORS, "emit"), join(VECTORS, "emit-more")].flatMap((d) => loadSuite(d).files.flatMap((f) => f.file.vectors.map((v) => v.id))));
  const mine = loadExceptions(join(ROOT, "exceptions", "exceptions.json")).exceptions.filter((e) => e.impl === KW_ADAPTER_NAME);
  it("each names a real vector, an owner and an expiry, and says it is a keyring-wallet deviation or a shim carrier limitation", () => {
    assert.ok(mine.length > 0);
    for (const e of mine) {
      assert.ok(ids.has(e.vector), e.vector);
      assert.equal(e.owner, "unassigned");
      assert.match(e.expires ?? "", /^\d{4}-\d{2}-\d{2}$/);
      assert.match(e.reason, /^\[(KW deviation|shim carrier)/);
    }
  });
  it("has no duplicate vector", () => {
    assert.equal(new Set(mine.map((e) => e.vector)).size, mine.length);
  });
});

describe("keyring-wallet end to end (KW_ADAPTER_E2E=1)", { skip: process.env.KW_ADAPTER_E2E !== "1" }, () => {
  it("runs the framework ENV group against the real wallet code through the launcher", () => {
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "src/runner/cli.ts"), "--adapter",
        `stdio:${process.execPath} --experimental-strip-types --disable-warning=ExperimentalWarning ${join(ROOT, "src/adapters/keyring-wallet/launcher.ts")}`,
        "--tier", "1", "--timeout", "120000"],
      { encoding: "utf8", timeout: 580_000 },
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /keyring-wallet tier 1: .*"PASS":/);
  });
});

describe("second wallet identity (harness)", () => {
  it("takes its identity from KW_IDENTITY_SEED and lists the TCA and MAT roles", async () => {
    const { identitySeed, CEREMONY_ROLES, iutIdentity } = await import("../src/adapters/keyring-wallet/shim.ts");
    assert.equal(identitySeed({}), 0x4b);
    assert.equal(identitySeed({ KW_IDENTITY_SEED: "145" }), 145);
    assert.throws(() => identitySeed({ KW_IDENTITY_SEED: "x" }));
    assert.throws(() => identitySeed({ KW_IDENTITY_SEED: "300" }));
    assert.ok(CEREMONY_ROLES.find((c) => c.ceremony === "FC-TCA")?.roles.includes("approver"));
    assert.deepEqual(CEREMONY_ROLES.find((c) => c.ceremony === "FC-ACL")?.roles, ["member-phone"]);
    assert.ok(iutIdentity().vid.startsWith("did:key:"));
  });
});
