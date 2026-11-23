// SPDX-License-Identifier: Apache-2.0
// The control layer over a live vtc container (src/adapters/vti-live): no docker, no real service. A stub door answers the few tasks the layer sends,
// and a recording runner stands in for `docker`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { CommunityCtl, republish } from "../src/adapters/vti-live/community-ctl.ts";
import { Dock } from "../src/adapters/vti-live/docker.ts";
import type { Run } from "../src/adapters/vti-live/docker.ts";
import { serveCtl } from "../src/adapters/vti-live/server.ts";
import { ed25519Signer, seedOf } from "../src/crypto/didkey.ts";
import { knownSigners } from "../src/adapters/vti-live/known.ts";
import { makeAdapter } from "../src/runner/adapters.ts";
import { runScenarios } from "../src/ceremony/runner.ts";
import { loadScenarios } from "../src/ceremony/scenario.ts";
import { fromMultibase, toMultibase } from "../src/crypto/base58.ts";

const DID = "did:webvh:QmExample:localhost%3A18400";
const adminSigner = ed25519Signer(seedOf(0x99));

describe("live community control layer", () => {
  let door: Server;
  let url = "";
  let dir = "";
  const seen: { type: string; issuer: string; limited?: boolean }[] = [];
  let limitFirst = 0;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "live-ctl-"));
    mkdirSyncKit(dir);
    door = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        if (req.url === "/health") return void res.end(JSON.stringify({ status: "ok", vtc_did: DID }));
        if (req.url === "/.well-known/did.jsonl") return void res.end(`${JSON.stringify({ state: { id: DID, verificationMethod: [] } })}\n`);
        const doc = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { type: string; issuer: string; payload: Record<string, unknown> };
        seen.push({ type: doc.type, issuer: doc.issuer });
        if (limitFirst > 0) { limitFirst--; res.statusCode = 429; res.setHeader("retry-after", "0"); return void res.end("{}"); }
        const ok = (payload: Record<string, unknown>): void => void res.end(JSON.stringify({ type: `${doc.type}#response`, payload }));
        if (doc.type.endsWith("manifest/0.4")) return ok({ criteria: [{ id: "review", requirementsDigest: "zDigest" }] });
        if (doc.type.endsWith("submit/0.3")) return ok({ requestId: "r1" });
        if (doc.type.endsWith("decide/0.1")) return ok({});
        if (doc.type.endsWith("list/0.2")) return ok({ items: [{}, {}] });
        res.end("{}");
      });
    });
    await new Promise<void>((ok) => door.listen(0, "127.0.0.1", ok));
    url = `http://127.0.0.1:${(door.address() as { port: number }).port}`;
  });
  after(() => { door.close(); rmSync(dir, { recursive: true, force: true }); });

  const make = (calls: string[], preseed: readonly (readonly [number, string])[] = [[0x0a, "member"], [0x1c, "admin"]]): CommunityCtl => {
    const run: Run = async (cmd, args) => {
      calls.push(`${cmd} ${args.join(" ")}`);
      return "version = 1\npublic_url = \"https://localhost:18400\"\n";
    };
    const dock = new Dock({ kitDir: dir, project: "p", env: { VTC_IMAGE: "vtc-buildathon:26d0da81", VTC_PORT: "18400" }, service: "vtc", snapshotDir: join(dir, "snap") }, run);
    return new CommunityCtl({ dock, baseUrl: url, adminFile: join(dir, ".vta/admin.json"), preseed });
  };
  const short = (calls: string[]): string[] => calls.map((c) => (c.includes(" stop ") || c.endsWith(" stop vtc") ? "stop" : c.includes(" restart ") || c.endsWith(" restart vtc") ? "restart" : c.includes(" start ") || c.endsWith(" start vtc") ? "start" : c.includes("acl add") ? "acl" : c.includes("tar czf") ? "snapshot" : c.includes("tar xzf") ? "restore" : c.includes("cat /d/config") ? "config" : "other"));

  it("info reports the live DID, the https public URL read from the service's config, and the log's document", async () => {
    const calls: string[] = [];
    const c = make(calls);
    const i = await c.handle("info", {});
    assert.equal(i.vtcDid, DID);
    assert.equal(i.publicUrl, "https://localhost:18400");
    assert.equal(i.live, true);
    assert.equal((i.didDocument as { id: string }).id, DID);
  });

  it("prepare: an offline ACL entry only for a role a join does not give, a member made by applying and being approved, then one snapshot", async () => {
    seen.length = 0;
    const calls: string[] = [];
    const c = make(calls);
    await c.prepare();
    const s = short(calls);
    assert.equal(s.filter((x) => x === "acl").length, 1, "one offline entry (the admin)");
    assert.ok(calls.some((x) => x.includes("--role admin")) && !calls.some((x) => x.includes("--role member")));
    assert.ok(s.includes("snapshot"));
    const types = seen.map((x) => x.type.split("/").slice(-2).join("/"));
    assert.deepEqual(types, ["manifest/0.4", "submit/0.3", "decide/0.1"], "applied under review, approved by the community's administrator");
    assert.equal(seen[2]!.issuer, adminSigner.did, "the administrator is the one whose key the kit wrote");
  });

  it("seed is remembered; a member of a known key is made on demand and reported as one approved join request; an unknown key is refused", async () => {
    const calls: string[] = [];
    const c = make(calls);
    await c.prepare();
    const before = calls.length;
    assert.deepEqual(await c.handle("seed", { did: ed25519Signer(seedOf(0x0a)).did, role: "member" }), { ok: true, already: true });
    assert.equal(calls.length, before);
    const r = await c.handle("seed", { did: ed25519Signer(seedOf(0x47)).did, role: "member" });
    assert.deepEqual(r.joinRequests, { approved: 1 });
    await assert.rejects(c.handle("seed", { did: "did:key:z6MkunknownKeyNotInTheSeedSet", role: "member" }), /no key held/);
  });

  it("the door's anonymous budget (HTTP 429) is waited out", async () => {
    limitFirst = 2;
    const c = make([]);
    const r = await c.call(ed25519Signer(seedOf(1)), "https://trusttasks.org/spec/vtc/join-requests/manifest/0.4", {});
    assert.equal(r.status, 200);
  });

  it("reset restores the snapshot with the daemon stopped; pushed is unobservable; verify, stepup, defaults are not offered", async () => {
    const calls: string[] = [];
    const c = make(calls);
    await c.prepare();
    calls.length = 0;
    await c.handle("reset", {});
    const s = short(calls);
    assert.ok(s.indexOf("stop") < s.indexOf("restore") && s.indexOf("restore") < s.lastIndexOf("start"));
    assert.deepEqual(await c.handle("pushed", {}), { pushes: [], unobservable: true });
    for (const p of ["verify", "stepup", "defaults"]) assert.match(String((await c.handle(p, {})).error), /no such entry/);
    assert.deepEqual(await c.handle("observe", { kind: "joinRequests" }), { value: 10 });
    assert.match(String((await c.handle("observe", { kind: "roomRecords" })).error), /not readable/);
  });

  it("republish moves the service endpoints on the door's origin to the public origin and leaves keys and other endpoints alone", () => {
    const doc = { id: DID, verificationMethod: [{ id: `${DID}#key-0` }], service: [{ id: "a", type: "TrustTaskHTTPS", serviceEndpoint: "http://localhost:18400/v1" }, { id: "b", type: "SignInPortal", serviceEndpoint: "http://127.0.0.1:18400/members/" }, { id: "c", type: "Other", serviceEndpoint: "http://elsewhere.example/x" }, { id: "d", type: "Obj", serviceEndpoint: { uri: "http://localhost:18400/v1" } }] };
    const out = republish(doc, "http://127.0.0.1:18400", "https://localhost:18400") as typeof doc;
    assert.deepEqual(out.service.map((x) => x.serviceEndpoint), ["https://localhost:18400/v1", "https://localhost:18400/members/", "http://elsewhere.example/x", { uri: "http://localhost:18400/v1" }]);
    assert.deepEqual(out.verificationMethod, doc.verificationMethod);
    assert.equal(republish(doc, "http://x:1", "http://x:1"), doc);
  });

  it("LIVE_RESET=restart: reset is one container restart, no stop and no restore (state stays in place)", async () => {
    const calls: string[] = [];
    const c = make(calls);
    await c.prepare();
    calls.length = 0;
    process.env.LIVE_RESET = "restart";
    try { await c.handle("reset", {}); } finally { delete process.env.LIVE_RESET; }
    const s = short(calls);
    assert.ok(s.includes("restart"), s.join(","));
    assert.ok(!s.includes("stop") && !s.includes("restore"), s.join(","));
  });

  it("the control server answers a route's refusal as an error body, not a crash", async () => {
    const { url: u, server } = await serveCtl({ handle: async () => { throw new Error("boom"); } });
    try {
      const out = (await (await fetch(`${u}/ctl/x`, { method: "POST", body: "{}" })).json()) as { error: string };
      assert.equal(out.error, "boom");
    } finally { server.close(); }
  });

  it("knownSigners holds the suite's one-byte identities, as did:key", () => {
    const m = knownSigners();
    assert.equal(m.get(ed25519Signer(seedOf(0x4b)).did)?.did, ed25519Signer(seedOf(0x4b)).did);
    assert.equal(m.has("did:key:z6MkunknownKeyNotInTheSeedSet"), false);
  });

  it("the ceremony runner records a scenario inconclusive, not failed, when an adapter says an observation is unobservable", async () => {
    const files = loadScenarios(join(import.meta.dirname, "..", "vectors", "ceremony-scenarios")).files.map((f) => f.file);
    const specs = { K: "reference-joiner", V: "reference-community" };
    const make = async (slot: string): Promise<Awaited<ReturnType<typeof makeAdapter>>> => {
      const a = await makeAdapter(specs[slot as "K" | "V"]);
      if (slot !== "V") return a;
      return new Proxy(a, { get: (t, k) => {
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        if (k === "observe") return async (q: { query: string }) => { if (q.query === "stored") throw new Error("unobservable: the live service's records are not readable"); return (v as (x: unknown) => unknown).call(t, q); };
        return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      } });
    };
    const out = await runScenarios(files, { make, specs, today: "2026-11-20", only: ["FC-MBR-002"] });
    assert.equal(out.results[0]!.status, "inconclusive");
    assert.match(out.results[0]!.reason, /unobservable:/);
  });
});

function mkdirSyncKit(dir: string): void {
  // the kit's administrator file, written the way the kit writes it (a did:key and the private key as multibase)
  const seed = new Uint8Array(32).fill(0x99);
  const { mkdirSync } = require_fs();
  mkdirSync(join(dir, ".vta"), { recursive: true });
  writeFileSync(join(dir, ".vta/admin.json"), JSON.stringify({ did: adminSigner.did, privateKeyMultibase: toMultibase(seed) }));
  void fromMultibase;
}
function require_fs(): typeof import("node:fs") {
  return process.getBuiltinModule("node:fs");
}
