// SPDX-License-Identifier: Apache-2.0
// The harness's own acl/list call steps down to the version the host serves (class D request step, no platform change). Stub hosts: one serving
// acl/list 0.3 only (as the pinned VTA does), one serving 0.4, one serving none; and the ladder function alone.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { describe, it } from "node:test";
import { VtiInprocessAdapter } from "../src/adapters/vti-inprocess/adapter.ts";
import { TaskRefusal, VERSION_LADDERS, askSteppingDown, servedVersions } from "../src/adapters/vti-inprocess/step-down.ts";

const VTA_DID = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH";
const L = "https://trusttasks.org/spec/acl/list";
const LIST4 = `${L}/0.4`;

/** A stub VTA that serves the listed acl/list versions and refuses the others as the pin does (unsupportedVersion with servedVersions). */
function host(served: string[], asked: string[]): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString("utf8")));
    req.on("end", () => {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const send = (status: number, v: unknown): void => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
      if (req.url === "/ctl/info" || req.url === "/ctl/restart") return send(200, { baseUrl: url, vtaDid: VTA_DID });
      if (req.url === "/ctl/token") return send(200, { token: "tok" });
      if (req.url === "/trust-tasks") {
        const doc = JSON.parse(body) as { id: string; type: string };
        if (doc.type.includes("trust-task-discovery")) return send(200, { type: `${doc.type}#response`, payload: { supportedTypes: [doc.type] } });
        asked.push(doc.type);
        if (doc.type.startsWith(`${L}/`) && !served.includes(doc.type)) {
          return send(422, { id: "e", type: "https://trusttasks.org/spec/trust-task-error/0.5", payload: { code: "unsupportedVersion", details: { requestedType: doc.type, servedVersions: served } } });
        }
        if (doc.type.startsWith(`${L}/`)) return send(200, { id: "r", type: `${doc.type}#response`, threadId: doc.id, payload: { entries: [{ subject: "did:key:zX", role: "admin" }, { subject: "did:key:zY", role: "reader" }] } });
        return send(200, { id: "r", type: `${doc.type}#response`, threadId: doc.id, payload: {} });
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` })));
}

describe("acl/list step-down in the VTI in-process adapter", () => {
  it("measures a host that serves acl/list 0.3 only: asks 0.4, steps down to 0.3, reads the entries, and remembers the rung", async () => {
    const asked: string[] = [];
    const { server, url } = await host([`${L}/0.3`], asked);
    try {
      const adapter = new VtiInprocessAdapter({ controlUrl: url, version: "vta-service test" });
      await adapter.capabilities();
      const v = await adapter.observe({ query: "stored", kind: "acl-subject:did:key:zX" });
      assert.equal(v.value, 1);
      assert.deepEqual(asked.filter((t) => t.startsWith(L)), [LIST4, `${L}/0.3`]);
      asked.length = 0;
      await adapter.observe({ query: "stored", kind: "acl-subject:did:key:zY" });
      assert.deepEqual(asked.filter((t) => t.startsWith(L)), [`${L}/0.3`], "the served rung is kept, the next read does not ask 0.4 again");
    } finally { server.close(); }
  });

  it("asks 0.4 once and does not step down on a host that serves it", async () => {
    const asked: string[] = [];
    const { server, url } = await host([LIST4, `${L}/0.3`], asked);
    try {
      const adapter = new VtiInprocessAdapter({ controlUrl: url, version: "vta-service test" });
      await adapter.capabilities();
      await adapter.observe({ query: "stored", kind: "acl-subject:did:key:zX" });
      assert.deepEqual(asked.filter((t) => t.startsWith(L)), [LIST4]);
    } finally { server.close(); }
  });

  it("fails with the host's own refusal when it serves none of the rungs (no stand-in answer)", async () => {
    const asked: string[] = [];
    const { server, url } = await host([`${L}/0.1`], asked);
    try {
      const adapter = new VtiInprocessAdapter({ controlUrl: url, version: "vta-service test" });
      await adapter.capabilities();
      await assert.rejects(adapter.observe({ query: "stored", kind: "acl-subject:did:key:zX" }), /unsupportedVersion/);
      assert.deepEqual(asked.filter((t) => t.startsWith(L)), [LIST4], "no rung the host lists as served, so no further ask");
    } finally { server.close(); }
  });
});

describe("askSteppingDown", () => {
  const refusal = (served?: string[]): TaskRefusal => new TaskRefusal("x", "unsupportedVersion", served === undefined ? undefined : { servedVersions: served });
  it("passes a type with no ladder straight through", async () => {
    const memo = new Map<string, string>();
    assert.equal(await askSteppingDown("https://trusttasks.org/spec/device/list/0.3", async (t) => t, memo), "https://trusttasks.org/spec/device/list/0.3");
    assert.equal(memo.size, 0);
  });
  it("steps to the next lower rung when the refusal names no served versions, and tells the step", async () => {
    const steps: string[] = [];
    const out = await askSteppingDown(LIST4, async (t) => { if (t === LIST4) throw refusal(); return t; }, new Map(), (a, b) => steps.push(`${a}>${b}`));
    assert.equal(out, `${L}/0.3`);
    assert.deepEqual(steps, [`${LIST4}>${L}/0.3`]);
  });
  it("skips a rung the refusal does not list as served", async () => {
    const out = await askSteppingDown(LIST4, async (t) => { if (t !== `${L}/0.2`) throw refusal([`${L}/0.2`]); return t; }, new Map());
    assert.equal(out, `${L}/0.2`);
  });
  it("does not step on another code, and rethrows when the ladder is spent", async () => {
    await assert.rejects(askSteppingDown(LIST4, async () => { throw new TaskRefusal("x", "permissionDenied"); }, new Map()), /x/);
    let n = 0;
    await assert.rejects(askSteppingDown(LIST4, async () => { n++; throw refusal(); }, new Map()), TaskRefusal);
    assert.equal(n, VERSION_LADDERS[LIST4]!.length);
  });
  it("reads servedVersions from details", () => {
    assert.deepEqual(servedVersions(refusal(["a"])), ["a"]);
    assert.equal(servedVersions(refusal()), undefined);
  });
});
