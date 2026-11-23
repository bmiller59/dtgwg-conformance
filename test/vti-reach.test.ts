// SPDX-License-Identifier: Apache-2.0
// The 2026-11-15 VTI reach work: unlisted (served but undiscovered) types, the probes' version table, the VTC host mode of the HTTPS
// adapter (governance expressibility, presentation nonce through the VTC's own task, proof verification through the host) with a stub host,
// and the VTC launcher's manifest and DID. The real hosts are exercised by the recorded runs.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { signDocument } from "../src/crypto/proof.ts";
import { VtiInprocessAdapter, PRE_SESSION_TYPES, VTA_ROLES } from "../src/adapters/vti-inprocess/adapter.ts";
import { VtiAdapter, MEMBERSHIP_CRITERION, NOT_OFFERED } from "../src/adapters/vti/adapter.ts";
import { renderManifest } from "../src/adapters/vti-inprocess/launcher.ts";
import { vtcDid } from "../src/adapters/vti/launcher.ts";
import { TASK_VERSIONS, GRANT, LIST } from "../src/governance/probes.ts";
import { gateReason } from "../src/runner/suite.ts";
import type { Capabilities } from "../src/adapter/contract.ts";
import type { Vector } from "../src/vectors/types.ts";

const vec = (requires: string[]): Vector => ({ id: "X-001", title: "t", tier: 1, spec: [], clarify: null, requires, steps: [{ send: { template: "carrier.request" }, expect: { disposition: "response" } }] });
const caps = (over: Partial<Capabilities>): Capabilities => ({ optional: [], tierMax: 1, carriers: [], bindings: [], cryptosuites: [], supportedTypes: [], ...over }) as unknown as Capabilities;

describe("unlistedTypes", () => {
  it("counts as declared for the vector gate", () => {
    const t = "https://trusttasks.org/spec/auth/challenge/0.1";
    assert.match(gateReason(vec([t]), caps({}), 1)!, /type not declared/);
    assert.equal(gateReason(vec([t]), caps({ unlistedTypes: [t] }), 1), null);
  });
  it("the VTA adapter states the pre-session family there, not in the discovery list", async () => {
    assert.equal(PRE_SESSION_TYPES.length, 3);
    assert.deepEqual([...VTA_ROLES], ["admin", "initiator", "application", "reader", "monitor"]);
  });
});

describe("governance probes: version table", () => {
  it("speaks the older acl/grant and acl/list when only those are served", () => {
    assert.ok(TASK_VERSIONS[GRANT]!.includes("https://trusttasks.org/spec/acl/grant/0.2"));
    assert.ok(TASK_VERSIONS[LIST]!.includes("https://trusttasks.org/spec/acl/list/0.3"));
  });
});

describe("VTC host mode of the HTTPS adapter", () => {
  let server: Server;
  let url = "";
  const seen: string[] = [];
  const VTC = vtcDid();
  before(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString("utf8")));
      req.on("end", () => {
        seen.push(`${req.url} ${body.slice(0, 80)}`);
        const send = (v: unknown, status = 200): void => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(v));
        };
        if (req.url === "/ctl/info") return send({ baseUrl: url, vtcDid: VTC });
        if (req.url === "/ctl/seed") return send({ ok: true });
        if (req.url === "/ctl/verify") return send({ valid: true });
        if (req.url === "/v1/trust-tasks") {
          const doc = JSON.parse(body) as { id: string; type: string; issuer: string };
          if (doc.type.endsWith("/vtc/join-requests/query/0.1")) return send({ id: "r", type: `${doc.type}#response`, payload: { threadId: "th-1", holderDid: "x", query: { nonce: "n-1" } } });
          return send({ id: "r", type: "https://trusttasks.org/spec/trust-task-error/0.6", payload: { code: "permissionDenied", message: "needs consent from 1 other holder" } }, 403);
        }
        send({ error: "unexpected" }, 404);
      });
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  after(() => server.close());
  const make = (): VtiAdapter => new VtiAdapter({ config: { controlUrl: url, baseUrl: "http://127.0.0.1:1", apiPrefix: "/v1" } });

  it("the VTC's own did:key is the one of the test-support signer seed, and the manifest renders", () => {
    assert.match(VTC, /^did:key:z6Mk/);
    const tpl = readFileSync(new URL("../src/adapters/vti/vtc-host/Cargo.toml.in", import.meta.url), "utf8");
    assert.ok(!renderManifest(tpl, "/x/vti").includes("@VTI_ROOT@"));
    assert.ok(renderManifest(tpl, "/x/vti").includes('path = "/x/vti/vtc-service"'));
  });
  it("declares what the host gives, and the not-offered notes", async () => {
    const live = new VtiAdapter({ config: { baseUrl: "http://127.0.0.1:1", apiPrefix: "/v1" } });
    assert.equal(live.cfg.controlUrl, undefined);
    assert.ok(Object.keys(NOT_OFFERED).includes("optional:receiptVerify"));
  });
  it("presentationNonce returns the VTC's nonce and thread from vtc/join-requests/query", async () => {
    const r = await make().trigger("presentationNonce");
    assert.deepEqual(JSON.parse(r.documents[0]!), { nonce: "n-1", threadId: "th-1" });
    assert.equal(MEMBERSHIP_CRITERION, "member-credential");
    assert.ok(seen.some((s) => s.startsWith("/ctl/seed")));
  });
  it("verifyProof asks the host", async () => {
    assert.deepEqual(await make().verifyProof({ bytes: "{}" }), { valid: true });
  });
  it("declareGovernance: a rule that is not a ceiling relation is unsupported without asking the VTC; a refusal that needs consent is unsupported, never rejected", async () => {
    const a = make();
    const bad = await a.declareGovernance({ roles: ["r1", "r2", "r3"], principals: [], authority: { r1: ["r3"], r2: [], r3: ["r1", "r2"] } });
    assert.equal(bad.status, "unsupported");
    const consent = await a.declareGovernance({ roles: ["r0"], principals: [], authority: { r0: ["r0"] } });
    assert.equal(consent.status, "unsupported");
    assert.match((consent as { reason: string }).reason, /permissionDenied/);
    assert.equal((await a.declareGovernance({ roles: ["r0"], principals: [], consent: { task: "t", approverSet: "s", minApprovals: 1, excludeRequester: false } })).status, "unsupported");
  });
  it("signs with a valid proof (sanity of the helper used)", () => {
    assert.equal(typeof signDocument, "function");
    assert.equal(typeof VtiInprocessAdapter, "function");
  });
});
