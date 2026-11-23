// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ed25519Signer, seedOf } from "../src/crypto/didkey.ts";
import { toMultibase } from "../src/crypto/base58.ts";
import { AgentCtl, editPolicy } from "../src/adapters/vti-live/agent-ctl.ts";
import { Dock } from "../src/adapters/vti-live/docker.ts";
import type { Run } from "../src/adapters/vti-live/docker.ts";

const CONFIG = `vta_did = "did:webvh:X:localhost"\n\n[policy]\nenforcement = false\napprovals = []\nrequire_payload_schema = false\n\n[policy.approver_sets]\n\n[witness]\nx = 1\n`;

describe("live agent control layer", () => {
  let server: Server;
  let base = "";
  before(async () => {
    server = createServer((req, res) => {
      if (req.url === "/.well-known/did.jsonl") res.end(`${JSON.stringify({ state: { id: "did:webvh:X:localhost" } })}\n`);
      else res.end("{}");
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  after(() => server.close());

  const make = (calls: string[], cfg = CONFIG): AgentCtl => {
    const run: Run = async (cmd, args) => { calls.push(`${cmd} ${args.join(" ")}`); return args.join(" ").includes("cat /d/config.toml") ? cfg : ""; };
    const dock = new Dock({ kitDir: "/nonexistent", project: "p", env: { VTA_IMAGE: "vta-buildathon:26d0da81" }, service: "vta", snapshotDir: "/nonexistent-snap" }, run);
    return new AgentCtl({ dock, baseUrl: base, adminFile: "/nonexistent/admin.json" });
  };

  it("editPolicy switches enforcement on and writes the approver sets, leaving the rest alone", () => {
    const out = editPolicy(CONFIG, { enforcement: true, approverSets: { "fc-kvc": ["did:key:zA", "did:key:zB"] } });
    assert.match(out, /^enforcement = true$/m);
    assert.match(out, /\[policy\.approver_sets\]\nfc-kvc = \["did:key:zA", "did:key:zB"\]\n/);
    assert.match(out, /\[witness\]\nx = 1/);
    assert.match(out, /approvals = \[\]/);
    assert.equal(editPolicy(out, { enforcement: true }), out);
  });

  it("the adapter's probes change nothing: policy {} and enforce {on:false} restart no container", async () => {
    const calls: string[] = [];
    const ctl = make(calls);
    assert.deepEqual(await ctl.handle("policy", {}), { ok: true });
    assert.deepEqual(await ctl.handle("enforce", { on: false }), { ok: true, unchanged: true });
    assert.ok(calls.every((c) => !c.includes(" stop") && !c.includes(" start")), calls.join("\n"));
  });

  it("LIVE_RESET=restart: reset keeps the volume (no restore, no snapshot) and writes only the consent gate off, in one stop and start", async () => {
    const calls: string[] = [];
    const ctl = make(calls, CONFIG.replace("enforcement = false", "enforcement = true"));
    const dir = mkdtempSync(join(tmpdir(), "ttc-admin-"));
    const admin = ed25519Signer(seedOf(0x21));
    writeFileSync(join(dir, "admin.json"), JSON.stringify({ did: admin.did, privateKeyMultibase: toMultibase(seedOf(0x21)) }));
    (ctl as unknown as { c: { adminFile: string } }).c.adminFile = join(dir, "admin.json");
    (ctl as unknown as { adminBearer: () => Promise<string> }).adminBearer = async () => "t";
    process.env.LIVE_RESET = "restart";
    try { await ctl.handle("reset", {}); } finally { delete process.env.LIVE_RESET; }
    const all = calls.join("\n");
    assert.ok(!all.includes("tar xzf") && !all.includes("tar czf"), all);
    assert.ok(all.includes("enforcement = false"), all);
    assert.equal(calls.filter((c) => c.includes(" stop")).length, 1);
    assert.equal(calls.filter((c) => c.includes(" start")).length, 1);
  });

  it("enforce on gives the suite's identities their entries first (before the gate), then edits the config; enforce off does not", async () => {
    const calls: string[] = [];
    const ctl = make(calls);
    const dir = mkdtempSync(join(tmpdir(), "ttc-admin-"));
    writeFileSync(join(dir, "admin.json"), JSON.stringify({ did: ed25519Signer(seedOf(0x21)).did, privateKeyMultibase: toMultibase(seedOf(0x21)) }));
    (ctl as unknown as { c: { adminFile: string } }).c.adminFile = join(dir, "admin.json");
    const granted: string[] = [];
    const self = ctl as unknown as { adminBearer: () => Promise<string>; call: (s: unknown, t: string, p: { entry?: { subject: string } }) => Promise<{ status: number; body: Record<string, unknown> }> };
    self.adminBearer = async () => "t";
    self.call = async (_s, t, p) => { if (t.endsWith("acl/grant/0.2") && p.entry) granted.push(p.entry.subject); return { status: 200, body: { type: "x#response" } }; };
    await ctl.handle("enforce", { on: true });
    assert.ok(granted.includes(ed25519Signer(seedOf(0x4b)).did), "the wallet's stand-in key has its entry before the gate is on");
    assert.ok(granted.includes(ed25519Signer(seedOf(0x0a)).did), "the operator has its entry too");
    assert.ok(calls.some((c) => c.includes("enforcement = true")), calls.join("\n"));
  });

  it("the credential store is reported unobserved, which the adapter turns into an inconclusive scenario", async () => {
    const ctl = make([]);
    assert.equal((await ctl.handle("observe", { kind: "credentials" })).unobserved, true);
  });

  it("a session is refused for a DID whose key the suite does not hold", async () => {
    const ctl = make([]);
    await assert.rejects(ctl.handle("token", { did: "did:key:z6MkunknownunknownunknownunknownunknownunknownXXXXX", role: "admin" }), /no key held/);
  });

  it("the push engine and the proof verifier are reported as not offered", async () => {
    const ctl = make([]);
    assert.equal((await ctl.handle("pushed", {})).unobservable, true);
    assert.match(String((await ctl.handle("verify", {})).error), /class D/);
    assert.deepEqual(await ctl.handle("observe", { kind: "credentials" }), { value: 0, unobserved: true });
  });
});
