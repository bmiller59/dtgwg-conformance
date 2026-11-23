// SPDX-License-Identifier: Apache-2.0
// The VTA consent driver (src/adapters/vti-inprocess/consent.ts) against a stub of the VTA's door. This tests the driver's plumbing (what it sends, how it reads the refusal, which request goes
// to which approver, when it reads completed, refused and aborted), NOT VTI: the stub is the suite's reading of the gate, and nothing here is a statement about VTI. The real gate is
// exercised only by a host that has the policy endpoint (docs/27, run records).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACL_GRANT_TYPE, ACL_LIST_TYPE, CONSENT_DECISION_TYPE, CONSENT_REQUEST_TYPE, POLICY_UPSERT_TYPE, VtaConsentDriver } from "../src/adapters/vti-inprocess/consent.ts";
import type { Door } from "../src/adapters/vti-inprocess/consent.ts";

const VTA = "did:key:z6MkVTA";
const K1 = "did:key:z6MkK1", K2 = "did:key:z6MkK2";

function stub(opts: { policy: boolean; k?: number }): { door: Door; calls: string[]; executed: string[]; setApprovals: (n: number) => void } {
  const calls: string[] = [];
  const executed: string[] = [];
  let approvals = 0;
  let approvers: string[] = [];
  const door: Door = {
    vtaDid: async () => VTA,
    ctl: async (path, body) => {
      calls.push(`ctl ${path}`);
      if (path !== "policy" || !opts.policy) throw new Error("host policy: HTTP 404");
      const b = body as { approverSets?: Record<string, string[]> };
      if (b.approverSets !== undefined) approvers = Object.values(b.approverSets)[0] ?? [];
      return { enforcement: true };
    },
    operator: async (type) => {
      calls.push(`operator ${type}`);
      return type === ACL_LIST_TYPE ? { type: `${ACL_LIST_TYPE}#response`, payload: { entries: executed.map((subject) => ({ subject })) } } : { ok: true };
    },
    post: async (bytes) => {
      const doc = JSON.parse(bytes) as { id: string; type: string; payload: { entry?: { subject: string } } };
      calls.push(`post ${doc.type}`);
      if (doc.type !== ACL_GRANT_TYPE) return { replies: [], transport: { kind: "none", status: 202 }, quiescentAfterMs: 0 };
      if (approvals >= (opts.k ?? 1)) {
        if (!executed.includes(doc.payload.entry!.subject)) executed.push(doc.payload.entry!.subject);
        return { replies: [JSON.stringify({ type: `${ACL_GRANT_TYPE}#response`, issuer: VTA, payload: { entry: doc.payload.entry } })], transport: { kind: "document", status: 200 }, quiescentAfterMs: 0 };
      }
      const requests = approvers.map((a, i) => ({ id: `urn:uuid:req-${i}`, type: CONSENT_REQUEST_TYPE, issuer: VTA, recipient: a, payload: { challenge: "c".repeat(20), payloadDigest: "uDIGEST", minApprovals: opts.k ?? 1 }, proof: { type: "DataIntegrityProof" } }));
      return { replies: [JSON.stringify({ type: "https://trusttasks.org/spec/trust-task-error/0.6", payload: { code: "taskFailed", details: { reason: "auth:consent_required", payloadDigest: "uDIGEST", consentRequests: requests } } })], transport: { kind: "document", status: 422 }, quiescentAfterMs: 0 };
    },
  };
  return { door, calls, executed, setApprovals: (n) => void (approvals = n) };
}
const decision = (from: string) => JSON.stringify({ id: `urn:uuid:${from}`, type: CONSENT_DECISION_TYPE, issuer: from, payload: { challenge: "c".repeat(20), payloadDigest: "uDIGEST", decision: "approve" } });
const reply = (status: string) => ({ replies: [JSON.stringify({ type: `${CONSENT_DECISION_TYPE}#response`, payload: { status } })], transport: { kind: "document" as const, status: 200 }, quiescentAfterMs: 0 });

describe("VtaConsentDriver: the gated flow", () => {
  it("writes the rule over the wire and the configuration through the host, refuses for consent, hands each approver its own request, and executes once after the re-submit", async () => {
    const s = stub({ policy: true, k: 2 });
    const d = new VtaConsentDriver(s.door);
    d.connect(K1); d.connect(K2);
    await d.setup({ approvers: [K1, K2], minApprovals: 2 });
    assert.deepEqual(s.calls.filter((c) => c.startsWith("operator") || c.startsWith("ctl policy")).slice(-2), [`operator ${POLICY_UPSERT_TYPE}`, "ctl policy"]);
    const g = await d.initiate({ kind: "consent-gate", to: K1 });
    assert.equal(JSON.parse(g.documents[0]!).recipient, K1);
    assert.equal(d.ceremony(g.threadId).value, "held");
    const r2 = await d.initiate({ kind: "consent-request", to: K2, thread: g.threadId });
    assert.equal(JSON.parse(r2.documents[0]!).recipient, K2);
    assert.equal(await d.effects(g.threadId), 0);
    d.afterSend(decision(K1), reply("pending"));
    d.afterSend(decision(K2), reply("granted"));
    assert.equal(d.ceremony(g.threadId).value, "held", "granted but not yet executed: still held");
    s.setApprovals(2);
    await d.initiate({ kind: "consent-resubmit", to: K1, thread: g.threadId });
    assert.equal(d.ceremony(g.threadId).value, "completed");
    assert.equal(await d.effects(g.threadId), 1);
  });
  it("an outsider is handed the first request re-addressed and unsigned (a stand-in), and a denial reads aborted", async () => {
    const s = stub({ policy: true });
    const d = new VtaConsentDriver(s.door);
    for (const v of [K1, "did:key:z6MkO"]) d.connect(v);
    await d.setup({ approvers: [K1], minApprovals: 1 });
    const g = await d.initiate({ kind: "consent-gate", to: K1 });
    const leaked = JSON.parse((await d.initiate({ kind: "consent-request", to: "did:key:z6MkO", thread: g.threadId })).documents[0]!);
    assert.equal(leaked.recipient, "did:key:z6MkO");
    assert.equal(leaked.proof, undefined);
    d.afterSend(decision(K1), reply("denied"));
    assert.equal(d.ceremony(g.threadId).value, "aborted");
  });
  it("a refusal that does not carry the consent requirement is an error, not a held ceremony", async () => {
    const s = stub({ policy: true });
    s.door.post = async () => ({ replies: ['{"type":"x","payload":{"code":"permissionDenied"}}'], transport: { kind: "document", status: 403 }, quiescentAfterMs: 0 });
    const d = new VtaConsentDriver(s.door);
    d.connect(K1);
    await d.setup({ approvers: [K1], minApprovals: 1 });
    await assert.rejects(d.initiate({ kind: "consent-gate", to: K1 }), /did not refuse the gated task for consent/);
  });
  it("setup validates k and the approver set", async () => {
    const d = new VtaConsentDriver(stub({ policy: true }).door);
    await assert.rejects(d.setup({ approvers: [], minApprovals: 1 }), /approvers/);
    await assert.rejects(d.setup({ approvers: [K1], minApprovals: 2 }), /between 1 and 1/);
  });
});

describe("VtaConsentDriver: a host without the policy endpoint", () => {
  it("is not policy capable, refuses setup, and raises a stand-in request whose decision answered with an error reads refused (the leg alone)", async () => {
    const d = new VtaConsentDriver(stub({ policy: false }).door);
    assert.equal(await d.policyCapable(), false);
    await assert.rejects(d.setup({ approvers: [K1], minApprovals: 1 }), /no \/ctl\/policy/);
    d.connect(K1);
    const g = await d.initiate({ kind: "consent-gate", to: K1 });
    const req = JSON.parse(g.documents[0]!);
    assert.equal(req.type, CONSENT_REQUEST_TYPE);
    assert.equal(req.proof, undefined, "the stand-in is unsigned: it is the harness's, not the VTA's");
    d.afterSend(JSON.stringify({ id: "urn:uuid:d", type: CONSENT_DECISION_TYPE, issuer: K1, payload: { challenge: req.payload.challenge, payloadDigest: req.payload.payloadDigest, decision: "approve" } }),
      { replies: [JSON.stringify({ type: "https://trusttasks.org/spec/trust-task-error/0.6", payload: { code: "task-consent/decision:noPending" } })], transport: { kind: "document", status: 422 }, quiescentAfterMs: 0 });
    assert.equal(d.ceremony(g.threadId).value, "refused");
    assert.equal(d.received({ threadId: g.threadId, type: CONSENT_DECISION_TYPE }).value, 1);
    await assert.rejects(d.initiate({ kind: "consent-resubmit", to: K1, thread: g.threadId }), /stand-in request has no task/);
  });
  it("an initiate towards a peer that was not connected is an error", async () => {
    const d = new VtaConsentDriver(stub({ policy: false }).door);
    await assert.rejects(d.initiate({ kind: "consent-gate", to: K1 }), /not connected/);
  });
});
