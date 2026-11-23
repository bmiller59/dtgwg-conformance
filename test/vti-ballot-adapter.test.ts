// SPDX-License-Identifier: Apache-2.0
// The ballot-box adapter (src/adapters/vti-ballot/adapter.ts) against a stub of the host's control interface and door: it relays a document to the door unchanged, drives the election triggers and reads the board counts through the control interface.
// No Rust host is started here; the platform rows are run outside the repository.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { VtiBallotAdapter } from "../src/adapters/vti-ballot/adapter.ts";

async function stub(): Promise<{ url: string; calls: string[]; close: () => void }> {
  const calls: string[] = [];
  let casts = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      calls.push(`${req.url} ${body}`);
      res.setHeader("content-type", "application/json");
      if (req.url === "/ctl/info") return void res.end(JSON.stringify({ door: `http://127.0.0.1:${(server.address() as { port: number }).port}/trust-tasks`, boxDid: "did:key:z6MkBox", communityDid: "did:key:z6MkCommunity" }));
      if (req.url === "/ctl/observe") return void res.end(JSON.stringify({ value: casts }));
      if (req.url === "/ctl/close") return void res.end(JSON.stringify({ status: 200 }));
      if (req.url === "/trust-tasks") { casts++; res.statusCode = 200; return void res.end(JSON.stringify({ type: "x#response", echo: body.length })); }
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, calls, close: () => server.close() };
}

describe("VTI ballot-box adapter", () => {
  it("provisions the box's DID, relays a document to the door unchanged, drives the election and reads the counts", async () => {
    const s = await stub();
    try {
      const a = new VtiBallotAdapter({ controlUrl: s.url, version: "test" });
      const caps = await a.capabilities();
      assert.deepEqual(caps.ceremonyRoles, [{ ceremony: "FC-BAL", roles: ["ballot-box"] }]);
      assert.equal((await a.provision(["B"])).B!.vid, "did:key:z6MkBox");
      await a.trigger("openElection", { electionId: "e1", state: "voting", revote: "refuse" });
      await a.trigger("closeElection", { electionId: "e1" });
      const r = await a.send({ from: { kind: "actor", vid: "did:key:z6MkVoter" }, bytes: '{"id":"urn:uuid:1"}' });
      assert.equal(r.transport.status, 200);
      assert.equal(JSON.parse(r.replies[0]!).echo, '{"id":"urn:uuid:1"}'.length);
      assert.equal((await a.observe({ query: "stored", kind: "casts" })).value, 1);
      await assert.rejects(a.trigger("noSuchAction", {}), /no trigger/);
      assert.ok(s.calls.some((c) => c.startsWith("/ctl/election ")));
    } finally { s.close(); }
  });
});
